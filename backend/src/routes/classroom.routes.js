import { Router }         from 'express';
import { google }          from 'googleapis';
import fs                  from 'fs';
import path                from 'path';
import { fileURLToPath }   from 'url';
import pkg                 from 'pg';

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE  = path.join(__dirname, '../../data/classroom_token.json');

const SCOPES = [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me',
    'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
    'https://www.googleapis.com/auth/classroom.rosters.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
];

/* ── Migração das tabelas ── */
async function migrarTabelas() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_grupos (
                id          SERIAL PRIMARY KEY,
                curso_id    TEXT        NOT NULL,
                nome        TEXT        NOT NULL,
                pontos_meta NUMERIC     NOT NULL DEFAULT 40,
                cor         TEXT        NOT NULL DEFAULT '#4285F4',
                criado_em   TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_grupo_atividades (
                id               SERIAL  PRIMARY KEY,
                grupo_id         INTEGER NOT NULL REFERENCES classroom_grupos(id) ON DELETE CASCADE,
                atividade_id     TEXT    NOT NULL,
                atividade_titulo TEXT    NOT NULL DEFAULT '',
                pontos_max       NUMERIC,
                UNIQUE(grupo_id, atividade_id)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_ausencias (
                id              SERIAL PRIMARY KEY,
                curso_id        TEXT        NOT NULL,
                atividade_id    TEXT        NOT NULL,
                user_id         TEXT        NOT NULL,
                nome_aluno      TEXT,
                data_atividade  TEXT,
                cod_classe      TEXT,
                criado_em       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(curso_id, atividade_id, user_id)
            )
        `);
        /* Migração incremental: cod_classe_rco para vincular ao RCO */
        await pool.query(`ALTER TABLE classroom_grupos ADD COLUMN IF NOT EXISTS cod_classe_rco TEXT`);
        console.log('[CLASSROOM] Tabelas OK (grupos + ausências)');
    } catch (e) {
        console.warn('[CLASSROOM] Erro na migração:', e.message);
    }
}

migrarTabelas();

/* ── Helpers OAuth ── */
function getOAuth2Client(req) {
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri  = process.env.GOOGLE_REDIRECT_URI ||
        `${req.protocol}://${req.get('host')}/api/classroom/callback`;
    if (!clientId || !clientSecret) return null;
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function loadToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    } catch (_) {}
    return null;
}

function saveToken(token) {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
}

function deleteToken() {
    try { fs.unlinkSync(TOKEN_FILE); } catch (_) {}
}

async function getAuthenticatedClient(req) {
    const oauth2Client = getOAuth2Client(req);
    if (!oauth2Client) return null;
    const token = loadToken();
    if (!token) return null;
    oauth2Client.setCredentials(token);
    if (token.expiry_date && token.expiry_date < Date.now()) {
        try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            saveToken(credentials);
            oauth2Client.setCredentials(credentials);
        } catch (e) {
            console.error('[CLASSROOM] Erro ao renovar token:', e.message);
            deleteToken();
            return null;
        }
    }
    return oauth2Client;
}

/* ── Helpers de nome ── */
const PREPOSICOES = new Set(['DE','DA','DO','DAS','DOS','E','A','O','AS','OS','EM','NO','NA','NOS','NAS']);

function normNome(nome) {
    return (nome || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function palavrasSignificativas(nomeNorm) {
    return nomeNorm.split(' ').filter(w => w.length > 1 && !PREPOSICOES.has(w));
}

function encontrarMatchAluno(nomeClNorm, mapaAlunosRco) {
    const palavrasCl = new Set(palavrasSignificativas(nomeClNorm));
    let melhor = null;
    let melhorScore = 0;
    for (const [nomeRcoNorm, aluno] of Object.entries(mapaAlunosRco)) {
        const palavrasRco = palavrasSignificativas(nomeRcoNorm);
        const intersecao  = palavrasRco.filter(p => palavrasCl.has(p)).length;
        if (intersecao > melhorScore) {
            melhorScore = intersecao;
            melhor      = aluno;
        }
    }
    return melhorScore >= 2 ? melhor : null;
}

export function createClassroomRouter(deps = {}) {
    const { rcoApiService, supabaseAdmin } = deps;
    const router = Router();

    /* ── Status da conexão ── */
    router.get('/classroom/status', (req, res) => {
        const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const token = loadToken();
        res.json({ hasCredentials, connected: !!token, email: token?.email || null });
    });

    /* ── URL de autorização OAuth ── */
    router.get('/classroom/auth-url', (req, res) => {
        const oauth2Client = getOAuth2Client(req);
        if (!oauth2Client) return res.status(400).json({ erro: 'Credenciais do Google não configuradas.' });
        const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
        res.json({ url });
    });

    /* ── Callback OAuth ── */
    router.get('/classroom/callback', async (req, res) => {
        const { code, error } = req.query;
        if (error) return res.redirect('/pages/classroom/?erro=acesso_negado');
        const oauth2Client = getOAuth2Client(req);
        if (!oauth2Client) return res.redirect('/pages/classroom/?erro=sem_credenciais');
        try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            try {
                const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
                const { data } = await oauth2.userinfo.get();
                tokens.email = data.email;
            } catch (_) {}
            saveToken(tokens);
            console.log('[CLASSROOM] Conectado. Email:', tokens.email || '(sem email)');
            res.redirect('/pages/classroom/?sucesso=conectado');
        } catch (e) {
            console.error('[CLASSROOM] Erro no callback:', e.message);
            res.redirect('/pages/classroom/?erro=falha_auth');
        }
    });

    /* ── Desconectar ── */
    router.post('/classroom/disconnect', (req, res) => {
        deleteToken();
        res.json({ ok: true });
    });

    /* ── Listar cursos ── */
    router.get('/classroom/courses', async (req, res) => {
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado com Google Classroom.' });
        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const allCourses = [];
            let pageToken;
            do {
                const resp = await classroom.courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken });
                allCourses.push(...(resp.data.courses || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);
            res.json(allCourses.map(c => ({
                id: c.id, nome: c.name, secao: c.section || '', descricao: c.description || '',
                sala: c.room || '', turmaCode: c.enrollmentCode || '', link: c.alternateLink || '',
            })));
        } catch (e) {
            console.error('[CLASSROOM] Erro ao listar cursos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Listar alunos de um curso ── */
    router.get('/classroom/courses/:courseId/students', async (req, res) => {
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const allStudents = [];
            let pageToken;
            do {
                const resp = await classroom.courses.students.list({ courseId: req.params.courseId, pageSize: 100, pageToken });
                allStudents.push(...(resp.data.students || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            // Busca numChamada e codMatrizAluno do Supabase por nome normalizado
            // A chave única é `registro` (= String(codMatrizAluno)), não `codmatrizaluno`
            let numChamadaMap     = {};
            let codMatrizAlunoMap = {};
            if (supabaseAdmin) {
                const { data: alunosRCO, error: eRCO } = await supabaseAdmin
                    .from('alunos')
                    .select('nome, numchamada, registro');
                if (eRCO) console.warn('[CLASSROOM] Supabase alunos erro:', eRCO.message);
                (alunosRCO || []).forEach(a => {
                    const chave = normNome(a.nome);
                    numChamadaMap[chave]     = a.numchamada;
                    // registro é String(codMatrizAluno) — convertemos de volta para number
                    codMatrizAlunoMap[chave] = a.registro ? Number(a.registro) : null;
                });
            }

            res.json(allStudents.map(s => {
                const nome  = s.profile?.name?.fullName || '—';
                const chave = normNome(nome);
                return {
                    userId:         s.userId,
                    nome,
                    email:          s.profile?.emailAddress || '',
                    foto:           s.profile?.photoUrl || null,
                    numChamada:     numChamadaMap[chave]     ?? null,
                    codMatrizAluno: codMatrizAlunoMap[chave] ?? null,
                };
            }));
        } catch (e) {
            console.error('[CLASSROOM] Erro ao listar alunos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Listar atividades (courseWork) ── */
    router.get('/classroom/courses/:courseId/coursework', async (req, res) => {
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const allWork = [];
            let pageToken;
            do {
                const resp = await classroom.courses.courseWork.list({
                    courseId: req.params.courseId, orderBy: 'dueDate desc', pageSize: 50, pageToken,
                });
                allWork.push(...(resp.data.courseWork || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);
            res.json(allWork.map(w => {
                let prazo = null;
                if (w.dueDate) {
                    prazo = `${String(w.dueDate.day).padStart(2,'0')}/${String(w.dueDate.month).padStart(2,'0')}/${w.dueDate.year}`;
                }
                const materiais = (w.materials || [])
                    .map(m => m.link?.url || m.driveFile?.alternateLink || null)
                    .filter(Boolean);
                return { id: w.id, titulo: w.title, descricao: w.description || '', tipo: w.workType,
                    pontos: w.maxPoints ?? null, prazo, link: w.alternateLink || '', criadoEm: w.creationTime,
                    materiais };
            }));
        } catch (e) {
            console.error('[CLASSROOM] Erro ao listar atividades:', e.message);
            const status = e.code === 403 || e.message?.includes('permission') ? 403 : 500;
            res.status(status).json({ erro: e.message, tipo: status === 403 ? 'sem_permissao' : 'erro' });
        }
    });

    /* ── Listar entregas/notas de uma atividade ── */
    router.get('/classroom/courses/:courseId/coursework/:cwId/submissions', async (req, res) => {
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const allSubs = [];
            let pageToken;
            do {
                const resp = await classroom.courses.courseWork.studentSubmissions.list({
                    courseId: req.params.courseId, courseWorkId: req.params.cwId, pageSize: 100, pageToken,
                });
                allSubs.push(...(resp.data.studentSubmissions || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            // Buscar ausências marcadas para esta atividade
            const { rows: ausRows } = await pool.query(
                `SELECT user_id FROM classroom_ausencias WHERE curso_id=$1 AND atividade_id=$2`,
                [req.params.courseId, req.params.cwId]
            );
            const ausentes = new Set(ausRows.map(r => r.user_id));

            res.json(allSubs.map(s => ({
                id: s.id, userId: s.userId, estado: s.state,
                entregue: s.state === 'TURNED_IN' || s.state === 'RETURNED',
                nota: s.assignedGrade ?? null, notaRascunho: s.draftGrade ?? null,
                atrasado: s.late || false, atualizadoEm: s.updateTime,
                ausente: ausentes.has(s.userId),
            })));
        } catch (e) {
            console.error('[CLASSROOM] Erro ao listar entregas:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar nota de uma entrega ── */
    router.patch('/classroom/courses/:courseId/coursework/:cwId/submissions/:subId/grade', async (req, res) => {
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado.' });
        const { nota } = req.body;
        if (nota === undefined || nota === null) return res.status(400).json({ erro: 'Campo "nota" obrigatório.' });
        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const resp = await classroom.courses.courseWork.studentSubmissions.patch({
                courseId: req.params.courseId, courseWorkId: req.params.cwId, id: req.params.subId,
                updateMask: 'assignedGrade', requestBody: { assignedGrade: nota === '' ? null : Number(nota) },
            });
            res.json({ ok: true, nota: resp.data.assignedGrade });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao atualizar nota:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Devolver entrega ── */
    router.post('/classroom/courses/:courseId/coursework/:cwId/submissions/:subId/return', async (req, res) => {
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const classroom = google.classroom({ version: 'v1', auth });
            await classroom.courses.courseWork.studentSubmissions.return({
                courseId: req.params.courseId, courseWorkId: req.params.cwId, id: req.params.subId, requestBody: {},
            });
            res.json({ ok: true });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao devolver entrega:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ════════════════════════════════════════════════════════════
       AUDITORIA DE FREQUÊNCIA
    ════════════════════════════════════════════════════════════ */

    /* ── Executar auditoria: cruza faltas do RCO com atividades do Classroom ── */
    router.get('/classroom/audit', async (req, res) => {
        const { courseId, codClasse, codPeriodoAvaliacao = 9, codPeriodoLetivo = 261 } = req.query;
        if (!courseId || !codClasse) {
            return res.status(400).json({ erro: 'courseId e codClasse são obrigatórios' });
        }
        if (!rcoApiService) {
            return res.status(503).json({ erro: 'Serviço RCO indisponível.' });
        }
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado com Google.' });

        try {
            /* 1. Buscar frequências do RCO */
            const freqPath = `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`;
            const freqResp = await rcoApiService.get(freqPath);
            if (freqResp.status !== 200) {
                return res.status(502).json({ erro: `RCO retornou ${freqResp.status}` });
            }
            const rawFreq = Array.isArray(freqResp.data) ? freqResp.data : [];

            /* 2. Descobrir codAulas */
            const aulaSet = new Set();
            rawFreq.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));
            const codAulas = [...aulaSet].sort((a, b) => parseInt(a) - parseInt(b));

            /* 3. Buscar datas das aulas em paralelo */
            const aulaDatas = {};
            await Promise.all(codAulas.map(async (cod) => {
                try {
                    const r = await rcoApiService.get(`/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPeriodoLetivo}`);
                    const dataRaw = r?.data?.aula?.dataAula || r?.data?.dataAula || null;
                    if (dataRaw) {
                        const d  = new Date(dataRaw);
                        const dd = String(d.getUTCDate()).padStart(2, '0');
                        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                        aulaDatas[cod] = `${dd}/${mm}`;
                    }
                } catch (_) {}
            }));

            /* 4. Montar mapa de alunos do RCO: nomeNorm → { nome, frequencias } */
            const mapaRco = {};
            rawFreq.forEach(a => {
                const chave = normNome(a.nome);
                if (!mapaRco[chave]) {
                    const frequencias = {};
                    codAulas.forEach(cod => { frequencias[cod] = a[cod] || null; });
                    mapaRco[chave] = { nome: a.nome, frequencias };
                } else {
                    codAulas.forEach(cod => {
                        if (a[cod] === 'C') mapaRco[chave].frequencias[cod] = 'C';
                        else if (!mapaRco[chave].frequencias[cod] && a[cod]) {
                            mapaRco[chave].frequencias[cod] = a[cod];
                        }
                    });
                }
            });

            /* 5. Mapa data → codAulas */
            const datePorCodAulas = {};
            for (const [cod, data] of Object.entries(aulaDatas)) {
                if (!datePorCodAulas[data]) datePorCodAulas[data] = [];
                datePorCodAulas[data].push(cod);
            }

            /* 6. Buscar alunos e atividades do Classroom */
            const classroom = google.classroom({ version: 'v1', auth });

            const [studentsResp, workResp] = await Promise.all([
                (async () => {
                    const all = [];
                    let pt;
                    do {
                        const r = await classroom.courses.students.list({ courseId, pageSize: 100, pageToken: pt });
                        all.push(...(r.data.students || []));
                        pt = r.data.nextPageToken;
                    } while (pt);
                    return all;
                })(),
                (async () => {
                    const all = [];
                    let pt;
                    do {
                        const r = await classroom.courses.courseWork.list({ courseId, pageSize: 50, pageToken: pt });
                        all.push(...(r.data.courseWork || []));
                        pt = r.data.nextPageToken;
                    } while (pt);
                    return all;
                })(),
            ]);

            /* 7. Para cada atividade, verificar ausentes */
            const atividades   = [];
            const semCorrespondencia = [];

            for (const w of workResp) {
                if (!w.creationTime) continue;
                const d   = new Date(w.creationTime);
                const dd  = String(d.getUTCDate()).padStart(2, '0');
                const mm  = String(d.getUTCMonth() + 1).padStart(2, '0');
                const dataDDMM = `${dd}/${mm}`;

                const codAulasNoDia = datePorCodAulas[dataDDMM] || [];
                if (!codAulasNoDia.length) {
                    semCorrespondencia.push({ id: w.id, titulo: w.title, data: dataDDMM });
                    continue;
                }

                const ausentes      = [];
                const semMatchNome  = [];

                for (const st of studentsResp) {
                    const nomeClNorm = normNome(st.profile?.name?.fullName || '');
                    const matchRco   = encontrarMatchAluno(nomeClNorm, mapaRco);

                    if (!matchRco) {
                        semMatchNome.push(st.profile?.name?.fullName || st.userId);
                        continue;
                    }

                    // Determinar se estava ausente naquele dia
                    const aulasDoDia = codAulasNoDia.filter(cod =>
                        matchRco.frequencias[cod] !== null && matchRco.frequencias[cod] !== undefined
                    );
                    if (!aulasDoDia.length) continue; // sem registro de presença neste dia

                    const presente = aulasDoDia.some(cod => matchRco.frequencias[cod] === 'C');
                    if (!presente) {
                        ausentes.push({
                            userId:        st.userId,
                            nomeClassroom: st.profile?.name?.fullName || '—',
                            nomeRco:       matchRco.nome,
                        });
                    }
                }

                let prazo = null;
                if (w.dueDate) {
                    prazo = `${String(w.dueDate.day).padStart(2,'0')}/${String(w.dueDate.month).padStart(2,'0')}/${w.dueDate.year}`;
                }

                atividades.push({
                    id:           w.id,
                    titulo:       w.title,
                    data:         dataDDMM,
                    prazo,
                    pontos:       w.maxPoints ?? null,
                    ausentes,
                    semMatchNome: [...new Set(semMatchNome)],
                });
            }

            res.json({ atividades, semCorrespondencia });
        } catch (e) {
            console.error('[CLASSROOM] Erro na auditoria:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Registrar ausências (após aplicar zeros) ── */
    router.post('/classroom/ausencias', async (req, res) => {
        const { courseId, atividadeId, userId, nomeAluno, dataAtividade, codClasse } = req.body;
        if (!courseId || !atividadeId || !userId) {
            return res.status(400).json({ erro: 'courseId, atividadeId e userId são obrigatórios' });
        }
        try {
            await pool.query(`
                INSERT INTO classroom_ausencias (curso_id, atividade_id, user_id, nome_aluno, data_atividade, cod_classe)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (curso_id, atividade_id, user_id) DO NOTHING
            `, [courseId, atividadeId, userId, nomeAluno || null, dataAtividade || null, codClasse || null]);
            res.json({ ok: true });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao salvar ausência:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Remover registro de ausência (desfazer) ── */
    router.delete('/classroom/ausencias', async (req, res) => {
        const { courseId, atividadeId, userId } = req.query;
        if (!courseId || !atividadeId || !userId) {
            return res.status(400).json({ erro: 'courseId, atividadeId e userId são obrigatórios' });
        }
        try {
            await pool.query(
                `DELETE FROM classroom_ausencias WHERE curso_id=$1 AND atividade_id=$2 AND user_id=$3`,
                [courseId, atividadeId, userId]
            );
            res.json({ ok: true });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao remover ausência:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Listar ausências de um curso/atividade ── */
    router.get('/classroom/ausencias', async (req, res) => {
        const { courseId, atividadeId } = req.query;
        if (!courseId) return res.status(400).json({ erro: 'courseId obrigatório' });
        try {
            let q = `SELECT * FROM classroom_ausencias WHERE curso_id=$1`;
            const params = [courseId];
            if (atividadeId) { q += ` AND atividade_id=$2`; params.push(atividadeId); }
            const { rows } = await pool.query(q + ' ORDER BY criado_em DESC', params);
            res.json(rows);
        } catch (e) {
            console.error('[CLASSROOM] Erro ao listar ausências:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ════════════════════════════════════════════════════════════
       GRUPOS DE ATIVIDADES
    ════════════════════════════════════════════════════════════ */

    /* ── Listar grupos de um curso ── */
    router.get('/classroom/groups', async (req, res) => {
        const { courseId } = req.query;
        if (!courseId) return res.status(400).json({ erro: 'courseId obrigatório' });
        try {
            const { rows } = await pool.query(`
                SELECT g.*,
                    COALESCE(json_agg(
                        json_build_object(
                            'atividade_id',     ga.atividade_id,
                            'atividade_titulo', ga.atividade_titulo,
                            'pontos_max',       ga.pontos_max
                        ) ORDER BY ga.id
                    ) FILTER (WHERE ga.id IS NOT NULL), '[]') AS atividades,
                    (SELECT id   FROM classroom_grupos r WHERE r.grupo_origem_id = g.id AND r.tipo = 'recuperacao' AND r.curso_id = $1 LIMIT 1) AS rec_id,
                    (SELECT nome FROM classroom_grupos r WHERE r.grupo_origem_id = g.id AND r.tipo = 'recuperacao' AND r.curso_id = $1 LIMIT 1) AS rec_nome,
                    COALESCE(g.cod_classe_rco, gorigem.cod_classe_rco) AS cod_classe_rco_efetivo
                FROM classroom_grupos g
                LEFT JOIN classroom_grupo_atividades ga ON ga.grupo_id = g.id
                LEFT JOIN classroom_grupos gorigem ON gorigem.id = g.grupo_origem_id
                WHERE g.curso_id = $1
                GROUP BY g.id, gorigem.cod_classe_rco
                ORDER BY g.id
            `, [courseId]);
            res.json(rows.map(g => ({
                id:             g.id,
                nome:           g.nome,
                pontosMeta:     Number(g.pontos_meta),
                cor:            g.cor,
                atividades:     g.atividades,
                lancadoLivro:   g.lancado_livro ?? false,
                lancadoEm:      g.lancado_em ?? null,
                tipo:           g.tipo || 'normal',
                grupoOrigemId:  g.grupo_origem_id ?? null,
                dataInicio:     g.data_inicio ? g.data_inicio.toISOString() : null,
                recuperacaoId:  g.rec_id      ?? null,
                recuperacaoNome:g.rec_nome    ?? null,
                codClasseRco:   g.cod_classe_rco_efetivo || null,
            })));
        } catch (e) {
            console.error('[CLASSROOM] Erro ao listar grupos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Criar grupo ── */
    router.post('/classroom/groups', async (req, res) => {
        const { courseId, nome, pontosMeta, cor, tipo, grupoOrigemId, dataInicio, codClasseRco } = req.body;
        if (!courseId || !nome) return res.status(400).json({ erro: 'courseId e nome obrigatórios' });
        const tipoVal = tipo === 'recuperacao' ? 'recuperacao' : 'normal';
        const dataInicioVal = tipoVal === 'recuperacao' && dataInicio ? dataInicio : null;
        try {
            const { rows } = await pool.query(
                `INSERT INTO classroom_grupos (curso_id, nome, pontos_meta, cor, tipo, grupo_origem_id, data_inicio, cod_classe_rco)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                [courseId, nome.trim(), pontosMeta || 40, cor || '#4285F4',
                 tipoVal, grupoOrigemId || null, dataInicioVal, codClasseRco || null]
            );
            res.json({ id: rows[0].id });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao criar grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar grupo ── */
    router.put('/classroom/groups/:id', async (req, res) => {
        const { nome, pontosMeta, cor, tipo, grupoOrigemId, dataInicio, codClasseRco } = req.body;
        if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
        const tipoVal = tipo === 'recuperacao' ? 'recuperacao' : 'normal';
        const dataInicioVal = tipoVal === 'recuperacao' && dataInicio ? dataInicio : null;
        try {
            await pool.query(
                `UPDATE classroom_grupos SET nome=$1, pontos_meta=$2, cor=$3, tipo=$4, grupo_origem_id=$5, data_inicio=$6, cod_classe_rco=$7 WHERE id=$8`,
                [nome.trim(), pontosMeta || 40, cor || '#4285F4', tipoVal,
                 grupoOrigemId || null, dataInicioVal, codClasseRco || null, req.params.id]
            );
            res.json({ ok: true });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao atualizar grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Excluir grupo ── */
    router.delete('/classroom/groups/:id', async (req, res) => {
        try {
            await pool.query(`DELETE FROM classroom_grupos WHERE id=$1`, [req.params.id]);
            res.json({ ok: true });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao excluir grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Marcar/desmarcar "lançado no livro" ── */
    router.patch('/classroom/groups/:id/livro', async (req, res) => {
        const { lancado } = req.body;          // boolean
        if (typeof lancado !== 'boolean') return res.status(400).json({ erro: 'lancado (boolean) obrigatório.' });
        try {
            const { rows } = await pool.query(
                `UPDATE classroom_grupos
                    SET lancado_livro = $1,
                        lancado_em    = $2
                  WHERE id = $3
                  RETURNING id, lancado_livro, lancado_em`,
                [lancado, lancado ? new Date() : null, req.params.id]
            );
            if (!rows.length) return res.status(404).json({ erro: 'Grupo não encontrado.' });
            res.json({
                ok:           true,
                lancadoLivro: rows[0].lancado_livro,
                lancadoEm:    rows[0].lancado_em,
            });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao marcar livro:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar pontos_max de uma atividade em todos os grupos do curso ── */
    router.patch('/classroom/courses/:courseId/activities/:activityId/pontos_max', async (req, res) => {
        const { courseId, activityId } = req.params;
        const { pontos_max } = req.body;
        if (pontos_max === undefined) return res.status(400).json({ erro: 'pontos_max obrigatório' });
        try {
            const { rowCount } = await pool.query(
                `UPDATE classroom_grupo_atividades
                 SET pontos_max = $1
                 WHERE atividade_id = $2
                   AND grupo_id IN (SELECT id FROM classroom_grupos WHERE curso_id = $3)`,
                [pontos_max === null ? null : Number(pontos_max), activityId, courseId]
            );
            res.json({ ok: true, gruposAfetados: rowCount });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao atualizar pontos_max da atividade:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Salvar atividades de um grupo (substitui todas) ── */
    router.put('/classroom/groups/:id/activities', async (req, res) => {
        const { atividades } = req.body;
        try {
            await pool.query(`DELETE FROM classroom_grupo_atividades WHERE grupo_id=$1`, [req.params.id]);
            for (const a of (atividades || [])) {
                await pool.query(
                    `INSERT INTO classroom_grupo_atividades (grupo_id, atividade_id, atividade_titulo, pontos_max)
                     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                    [req.params.id, a.atividade_id, a.atividade_titulo || '', a.pontos_max ?? null]
                );
            }
            res.json({ ok: true });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao salvar atividades do grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Resumo por grupo: soma de notas por aluno ── */
    router.get('/classroom/groups/:id/summary', async (req, res) => {
        const { courseId } = req.query;
        if (!courseId) return res.status(400).json({ erro: 'courseId obrigatório' });
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            /* Carrega metadados do grupo para saber se é recuperação */
            const { rows: [grupoInfo] } = await pool.query(
                `SELECT tipo, grupo_origem_id, data_inicio FROM classroom_grupos WHERE id = $1`,
                [req.params.id]
            );
            const isRecuperacao = grupoInfo?.tipo === 'recuperacao';
            /* Data de corte: submissions com updateTime >= data_inicio são "de recuperação" */
            const dataInicio = grupoInfo?.data_inicio
                ? new Date(grupoInfo.data_inicio)
                : null;

            /* Para grupos NORMAIS (avaliação principal): busca a data_inicio do grupo de
               recuperação vinculado. Submissions com updateTime >= esse corte NÃO entram
               no cálculo do grupo original — foram re-enviadas para a recuperação e a nota
               atual reflete a recuperação, não a avaliação original. */
            let dataCorteOriginal = null;
            if (!isRecuperacao) {
                const { rows: recRows } = await pool.query(
                    `SELECT data_inicio FROM classroom_grupos
                     WHERE grupo_origem_id = $1 AND tipo = 'recuperacao' AND data_inicio IS NOT NULL
                     ORDER BY data_inicio ASC LIMIT 1`,
                    [req.params.id]
                );
                if (recRows.length && recRows[0].data_inicio) {
                    dataCorteOriginal = new Date(recRows[0].data_inicio);
                }
            }

            const { rows: ativs } = await pool.query(
                `SELECT * FROM classroom_grupo_atividades WHERE grupo_id=$1 ORDER BY id`,
                [req.params.id]
            );
            if (!ativs.length) return res.json({ atividades: [], alunos: [] });

            const classroom = google.classroom({ version: 'v1', auth });

            const results = await Promise.all(ativs.map(async (a) => {
                try {
                    let pontosMaxReal = (a.pontos_max != null && Number(a.pontos_max) > 0)
                        ? Number(a.pontos_max)
                        : null;
                    let quizizzId    = null;

                    /* Sempre busca o courseWork para:
                       1. Obter maxPoints real quando o DB não tem
                       2. Detectar link Quizizz nos materiais */
                    try {
                        const cwResp = await classroom.courses.courseWork.get({
                            courseId, id: a.atividade_id,
                        });
                        if (pontosMaxReal === null && cwResp.data.maxPoints > 0) {
                            pontosMaxReal = Number(cwResp.data.maxPoints);
                        }
                        const materiais = cwResp.data.materials || [];
                        for (const m of materiais) {
                            const url = m.link?.url || '';
                            if (/quizizz\.com/i.test(url)) {
                                const match = url.match(/([0-9a-f]{24})/i);
                                quizizzId = match ? match[1] : 'LINK';
                                break;
                            }
                        }
                    } catch (_) { /* mantém valores já resolvidos */ }

                    /* Fallback: detecta pelo título (ex: "Quizziz — Funções C") */
                    if (!quizizzId && /quiziz{1,2}/i.test(a.atividade_titulo)) {
                        quizizzId = 'TITULO';
                    }

                    const allSubs = [];
                    let pageToken;
                    do {
                        const resp = await classroom.courses.courseWork.studentSubmissions.list({
                            courseId, courseWorkId: a.atividade_id, pageSize: 100, pageToken,
                        });
                        allSubs.push(...(resp.data.studentSubmissions || []));
                        pageToken = resp.data.nextPageToken;
                    } while (pageToken);
                    return { atividade: { ...a, _pontosMaxReal: pontosMaxReal, _quizizzId: quizizzId }, submissions: allSubs };
                } catch (e) {
                    return { atividade: { ...a, _pontosMaxReal: null, _quizizzId: null }, submissions: [], erro: e.message };
                }
            }));

            /* pontosMaxEfetivo: usa valor do DB se disponível, senão maxPoints do Classroom,
               senão null (atividade sem escala → excluída do denominador para não distorcer) */
            const resolverPontosMax = (atividade) => atividade._pontosMaxReal;

            // totalPossivel = soma dos pontos_max efetivos de TODAS as atividades do grupo
            // Atividades sem maxPoints em lugar nenhum (ex: atividades sem pontuação) são excluídas
            const totalPossivel = results.reduce((acc, { atividade }) => {
                const pm = resolverPontosMax(atividade);
                return acc + (pm !== null ? pm : 0);
            }, 0);

            const alunoMap = {};
            results.forEach(({ atividade, submissions }) => {
                // pontos_max efetivo: DB → Classroom → null (excluída da contagem)
                const pontosMax = resolverPontosMax(atividade);
                submissions.forEach(s => {
                    if (!alunoMap[s.userId]) {
                        alunoMap[s.userId] = {
                            userId: s.userId,
                            totalGanho: 0,   // soma bruta das notas obtidas
                            pendentes:  0,
                            atividades: {},
                        };
                    }
                    // Usa APENAS assignedGrade (nota publicada/devolvida ao aluno).
                    // draftGrade (rascunho não publicado) é ignorado: não deve inflacionar
                    // a média enquanto o aluno ainda não viu a nota.
                    const nota     = s.assignedGrade ?? null;
                    const entregue = s.state === 'TURNED_IN' || s.state === 'RETURNED';
                    const atrasado = s.late || false;

                    /* updateTime → detectar submissões pós data de recuperação */
                    const updateTime = s.updateTime ? new Date(s.updateTime) : null;

                    /* Submission pertence à recuperação se ultrapassou o corte do grupo original */
                    const eDeRecuperacao = dataCorteOriginal && updateTime
                        ? updateTime >= dataCorteOriginal
                        : false;

                    alunoMap[s.userId].atividades[atividade.atividade_id] = {
                        nota, estado: s.state, entregue, atrasado, updateTime,
                        eDeRecuperacao,
                    };

                    if (pontosMax === null) {
                        /* Atividade sem escala de pontos definida em nenhum lugar:
                           não participa do cálculo de nota (ignorada no numerador e denominador) */
                    } else if (eDeRecuperacao) {
                        /* Submission foi re-enviada após o início da recuperação:
                           a nota atual reflete a recuperação, não a avaliação original.
                           Exclui do totalGanho do grupo original (mantém avaliação original intacta).
                           Esta submission será contabilizada somente no grupo de recuperação. */
                    } else if (nota !== null) {
                        // Soma os pontos brutos obtidos (capped no máximo da atividade)
                        alunoMap[s.userId].totalGanho += Math.min(nota, pontosMax);
                    } else if (!entregue) {
                        // Atividade não entregue / atrasada sem nota = 0 pontos + conta como pendente
                        alunoMap[s.userId].pendentes++;
                        // totalGanho não cresce → pontos ficam em 0 para esta atividade
                    }
                });
            });

            // mediaIndice = porcentagem dos pontos ganhos sobre o total possível do grupo
            // Inclui atividades faltantes como 0, refletindo o desempenho real
            let alunos = Object.values(alunoMap).map(a => ({
                userId:      a.userId,
                mediaIndice: totalPossivel > 0 ? (a.totalGanho / totalPossivel) * 100 : 0,
                pendentes:   a.pendentes,
                atividades:  a.atividades,
            }));

            /* ─── Filtro de recuperação por data ───────────────────────────────────
               Para grupos de recuperação com data_inicio definida:
               - "Fez recuperação" = entregou APÓS a data de corte (updateTime >= dataInicio)
               - Apenas esses alunos aparecem no resumo do grupo de recuperação
               Sem data_inicio definida: cai no comportamento legado (qualquer entrega).
            ─────────────────────────────────────────────────────────────────────── */
            const alunoFezRecuperacao = (a) => {
                const atvs = Object.values(a.atividades);
                if (dataInicio) {
                    return atvs.some(atv => atv.entregue && atv.updateTime && atv.updateTime >= dataInicio);
                }
                return atvs.some(atv => atv.entregue);
            };

            if (isRecuperacao) {
                alunos = alunos.filter(a => alunoFezRecuperacao(a));
            }

            /* Marca per-submission se é uma entrega de recuperação.
               - Em grupos de recuperação: usa data_inicio do próprio grupo.
               - Em grupos normais: usa dataCorteOriginal (data_inicio do grupo de rec. vinculado).
               O flag fezRec = true indica que a submission pertence à recuperação. */
            const dataCorte = isRecuperacao ? dataInicio : dataCorteOriginal;
            alunos = alunos.map(a => ({
                ...a,
                atividades: Object.fromEntries(
                    Object.entries(a.atividades).map(([id, atv]) => [
                        id,
                        {
                            ...atv,
                            fezRec: atv.eDeRecuperacao || (
                                dataCorte && atv.entregue && atv.updateTime
                                    ? atv.updateTime >= dataCorte
                                    : false
                            ),
                            updateTime: atv.updateTime ? atv.updateTime.toISOString() : null,
                        }
                    ])
                ),
            }));

            res.json({
                atividades: results.map(({ atividade: a }) => ({
                    id: a.atividade_id, titulo: a.atividade_titulo,
                    pontos: a._pontosMaxReal !== null ? a._pontosMaxReal : null,
                    quizizzId: a._quizizzId || null,
                })),
                alunos,
                isRecuperacao,
                dataInicio:         dataInicio         ? dataInicio.toISOString()         : null,
                dataCorteOriginal:  dataCorteOriginal  ? dataCorteOriginal.toISOString()  : null,
                grupoOrigemId: grupoInfo?.grupo_origem_id ?? null,
            });
        } catch (e) {
            console.error('[CLASSROOM] Erro no resumo de grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Proxy para API pública do Quizizz ── */
    router.get('/classroom/quizizz/quiz/:quizId', async (req, res) => {
        const { quizId } = req.params;
        if (!/^[0-9a-f]{24}$/i.test(quizId)) {
            return res.status(400).json({ erro: 'Quiz ID inválido' });
        }
        try {
            const resp = await fetch(`https://quizizz.com/api/v2/quiz/${quizId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; EduSync/1.0)',
                    'Accept': 'application/json',
                },
                signal: AbortSignal.timeout(8000),
            });
            if (!resp.ok) {
                return res.status(resp.status).json({ erro: `Quizizz retornou ${resp.status}` });
            }
            const data = await resp.json();
            const quiz = data?.data?.quiz;
            if (!quiz) return res.status(404).json({ erro: 'Quiz não encontrado no Quizizz' });

            const info      = quiz.info || {};
            const questoes  = info.questions || [];
            const pontosTot = questoes.reduce((s, q) => s + (Number(q.points) || 0), 0);

            res.json({
                quizId    : quiz._id,
                titulo    : info.name || info.title || '(sem título)',
                totalQ    : questoes.length,
                pontosTotal: pontosTot,
                assunto   : (info.subjects || [])[0] || null,
                topico    : (info.topics   || [])[0] || null,
                criador   : info.createdBy?.local?.username || null,
                questoes  : questoes.map((q, i) => ({
                    num    : i + 1,
                    tipo   : q.type,
                    pontos : Number(q.points) || 0,
                    tempo  : q.time,
                })),
            });
        } catch (e) {
            console.error('[QUIZIZZ] Erro ao buscar quiz:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ─── Solicitações de reabertura ──────────────────────────────── */

    /* GET /api/classroom/solicitacoes/badge — contagem de pendentes */
    router.get('/classroom/solicitacoes/badge', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT COUNT(*)::int AS total FROM reabertura_solicitacoes WHERE status = 'pendente'`
            );
            res.json({ total: rows[0]?.total ?? 0 });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* GET /api/classroom/solicitacoes — lista todas com filtros */
    router.get('/classroom/solicitacoes', async (req, res) => {
        const { status, cursoId } = req.query;
        try {
            let q = `SELECT * FROM reabertura_solicitacoes WHERE 1=1`;
            const params = [];
            if (status && status !== 'todas') { params.push(status); q += ` AND status = $${params.length}`; }
            if (cursoId) { params.push(cursoId); q += ` AND curso_id = $${params.length}`; }
            q += ` ORDER BY criado_em DESC`;
            const { rows } = await pool.query(q, params);
            res.json({ solicitacoes: rows });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* POST /api/classroom/solicitacoes/:id/responder */
    router.post('/classroom/solicitacoes/:id/responder', async (req, res) => {
        const { id } = req.params;
        const { acao, resposta } = req.body;  /* acao: 'aprovar' | 'negar' */
        if (!['aprovar', 'negar'].includes(acao)) return res.status(400).json({ erro: 'Ação inválida.' });

        try {
            const novoStatus = acao === 'aprovar' ? 'aprovada' : 'negada';
            const { rows } = await pool.query(
                `UPDATE reabertura_solicitacoes
                 SET status='${novoStatus}', resposta=$1, respondido_em=NOW(), respondido_por='professor'
                 WHERE id=$2
                 RETURNING *`,
                [resposta || null, id]
            );
            if (!rows.length) return res.status(404).json({ erro: 'Solicitação não encontrada.' });

            /* Notifica o aluno — bloqueante na próxima visita ao portal */
            const sol = rows[0];
            const tipo    = acao === 'aprovar' ? 'reabertura_aprovada' : 'reabertura_negada';
            const titulo  = acao === 'aprovar' ? '✅ Reabertura aprovada!' : '❌ Reabertura negada';
            const msgBase = acao === 'aprovar'
                ? `Sua solicitação para "${sol.coursework_titulo}" foi aprovada. Acesse a atividade e complete-a agora!`
                : `Sua solicitação para "${sol.coursework_titulo}" foi negada.${resposta ? ` Motivo: ${resposta}` : ''}`;
            pool.query(
                `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
                 SELECT $1, $2, $3, $4, $5, $6::jsonb
                 WHERE NOT EXISTS (
                     SELECT 1 FROM notificacoes_aluno
                     WHERE aluno_email=$1 AND tipo=$2 AND referencia=$3 AND lida=false
                 )`,
                [sol.aluno_email, tipo, sol.coursework_id, titulo, msgBase,
                 JSON.stringify({ coursework_id: sol.coursework_id, curso_nome: sol.curso_nome })]
            ).catch(() => {});

            res.json({ ok: true, solicitacao: rows[0] });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
