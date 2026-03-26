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

/* ══════════════════════════════════════════════════════════════ */
export function createClassroomRouter(deps = {}) {
    const { rcoApiService } = deps;
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
            res.json(allStudents.map(s => ({
                userId: s.userId, nome: s.profile?.name?.fullName || '—',
                email: s.profile?.emailAddress || '', foto: s.profile?.photoUrl || null,
            })));
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
                return { id: w.id, titulo: w.title, descricao: w.description || '', tipo: w.workType,
                    pontos: w.maxPoints ?? null, prazo, link: w.alternateLink || '', criadoEm: w.creationTime };
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
                    ) FILTER (WHERE ga.id IS NOT NULL), '[]') AS atividades
                FROM classroom_grupos g
                LEFT JOIN classroom_grupo_atividades ga ON ga.grupo_id = g.id
                WHERE g.curso_id = $1
                GROUP BY g.id
                ORDER BY g.id
            `, [courseId]);
            res.json(rows.map(g => ({
                id:          g.id,
                nome:        g.nome,
                pontosMeta:  Number(g.pontos_meta),
                cor:         g.cor,
                atividades:  g.atividades,
            })));
        } catch (e) {
            console.error('[CLASSROOM] Erro ao listar grupos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Criar grupo ── */
    router.post('/classroom/groups', async (req, res) => {
        const { courseId, nome, pontosMeta, cor } = req.body;
        if (!courseId || !nome) return res.status(400).json({ erro: 'courseId e nome obrigatórios' });
        try {
            const { rows } = await pool.query(
                `INSERT INTO classroom_grupos (curso_id, nome, pontos_meta, cor) VALUES ($1,$2,$3,$4) RETURNING id`,
                [courseId, nome.trim(), pontosMeta || 40, cor || '#4285F4']
            );
            res.json({ id: rows[0].id });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao criar grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar grupo ── */
    router.put('/classroom/groups/:id', async (req, res) => {
        const { nome, pontosMeta, cor } = req.body;
        if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
        try {
            await pool.query(
                `UPDATE classroom_grupos SET nome=$1, pontos_meta=$2, cor=$3 WHERE id=$4`,
                [nome.trim(), pontosMeta || 40, cor || '#4285F4', req.params.id]
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
            const { rows: ativs } = await pool.query(
                `SELECT * FROM classroom_grupo_atividades WHERE grupo_id=$1 ORDER BY id`,
                [req.params.id]
            );
            if (!ativs.length) return res.json({ atividades: [], alunos: [] });

            const classroom = google.classroom({ version: 'v1', auth });

            const results = await Promise.all(ativs.map(async (a) => {
                try {
                    const allSubs = [];
                    let pageToken;
                    do {
                        const resp = await classroom.courses.courseWork.studentSubmissions.list({
                            courseId, courseWorkId: a.atividade_id, pageSize: 100, pageToken,
                        });
                        allSubs.push(...(resp.data.studentSubmissions || []));
                        pageToken = resp.data.nextPageToken;
                    } while (pageToken);
                    return { atividade: a, submissions: allSubs };
                } catch (e) {
                    return { atividade: a, submissions: [], erro: e.message };
                }
            }));

            const alunoMap = {};
            results.forEach(({ atividade, submissions }) => {
                submissions.forEach(s => {
                    if (!alunoMap[s.userId]) {
                        alunoMap[s.userId] = { userId: s.userId, soma: 0, pendentes: 0, atividades: {} };
                    }
                    const nota     = s.assignedGrade ?? null;
                    const entregue = s.state === 'TURNED_IN' || s.state === 'RETURNED';
                    alunoMap[s.userId].atividades[atividade.atividade_id] = {
                        nota, estado: s.state, entregue, atrasado: s.late || false,
                    };
                    if (nota !== null) {
                        alunoMap[s.userId].soma += nota;
                    } else if (!entregue) {
                        alunoMap[s.userId].pendentes++;
                    }
                });
            });

            res.json({
                atividades: ativs.map(a => ({
                    id: a.atividade_id, titulo: a.atividade_titulo, pontos: a.pontos_max !== null ? Number(a.pontos_max) : null,
                })),
                alunos: Object.values(alunoMap),
            });
        } catch (e) {
            console.error('[CLASSROOM] Erro no resumo de grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
