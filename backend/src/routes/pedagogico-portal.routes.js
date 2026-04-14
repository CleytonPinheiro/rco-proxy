import { Router }        from 'express';
import { google }        from 'googleapis';
import fs                from 'fs';
import path              from 'path';
import { fileURLToPath } from 'url';
import pkg               from 'pg';
import crypto            from 'crypto';
import { auditLogger }   from '../services/AuditLogger.js';
import { UAParser }      from 'ua-parser-js';

const { Pool }   = pkg;
const pool       = new Pool({ connectionString: process.env.DATABASE_URL });
const __dirname  = path.dirname(fileURLToPath(import.meta.url));

const TEACHER_TOKEN_FILE = path.join(__dirname, '../../data/classroom_token.json');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PEDAGOGO_SCOPES = ['openid', 'email', 'profile'];

async function migrarTabela() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedagogo_portal_sessions (
                id         TEXT        PRIMARY KEY,
                email      TEXT        NOT NULL,
                nome       TEXT        NOT NULL DEFAULT '',
                foto       TEXT,
                expires_at TIMESTAMPTZ NOT NULL,
                criado_em  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`DELETE FROM pedagogo_portal_sessions WHERE expires_at < NOW()`).catch(() => {});
        console.log('[PEDAGOGICO-PORTAL] Tabelas OK');
    } catch (e) {
        console.warn('[PEDAGOGICO-PORTAL] Erro na migração:', e.message);
    }
}

migrarTabela();

function getPedagogoOAuth2(req) {
    const id  = process.env.GOOGLE_CLIENT_ID;
    const sec = process.env.GOOGLE_CLIENT_SECRET;
    if (!id || !sec) return null;
    const uri = `${req.protocol}://${req.get('host')}/api/pedagogico-portal/callback`;
    return new google.auth.OAuth2(id, sec, uri);
}

function loadTeacherToken() {
    try {
        if (fs.existsSync(TEACHER_TOKEN_FILE))
            return JSON.parse(fs.readFileSync(TEACHER_TOKEN_FILE, 'utf8'));
    } catch (_) {}
    return null;
}

function saveTeacherToken(t) {
    fs.mkdirSync(path.dirname(TEACHER_TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TEACHER_TOKEN_FILE, JSON.stringify(t, null, 2));
}

async function getTeacherAuth(req) {
    const id  = process.env.GOOGLE_CLIENT_ID;
    const sec = process.env.GOOGLE_CLIENT_SECRET;
    if (!id || !sec) return null;
    const token = loadTeacherToken();
    if (!token) return null;
    const uri = `${req.protocol}://${req.get('host')}/api/classroom/callback`;
    const client = new google.auth.OAuth2(id, sec, uri);
    client.setCredentials(token);
    if (token.expiry_date && token.expiry_date < Date.now()) {
        try {
            const { credentials } = await client.refreshAccessToken();
            saveTeacherToken(credentials);
            client.setCredentials(credentials);
        } catch (e) {
            console.error('[PEDAGOGICO-PORTAL] Erro ao renovar token do professor:', e.message);
            return null;
        }
    }
    return client;
}

async function getPedagogoSession(req) {
    const sid = req.cookies?.pedagogo_sid;
    if (!sid) return null;
    try {
        const { rows } = await pool.query(
            `SELECT * FROM pedagogo_portal_sessions WHERE id = $1 AND expires_at > NOW()`,
            [sid]
        );
        return rows[0] || null;
    } catch (_) { return null; }
}

function parseUA(uaString) {
    if (!uaString) return {};
    try {
        const r = new UAParser(uaString).getResult();
        return {
            navegador:   [r.browser.name, r.browser.version].filter(Boolean).join(' ') || null,
            so:          [r.os.name,      r.os.version     ].filter(Boolean).join(' ') || null,
            dispositivo: r.device.type || 'desktop',
        };
    } catch { return {}; }
}

function logPedagogo(req, email, nome, acao, detalhes = {}) {
    const ua  = req?.headers?.['user-agent'] || null;
    const ip  = req?.ip || null;
    auditLogger.registrar({
        usuarioId:   null,
        usuarioNome: nome || email,
        acao,
        modulo:      'portal_pedagogico',
        detalhes:    { email, ...parseUA(ua), ...detalhes },
        ip,
    }).catch(() => {});
}

export function createPedagogicoPortalRouter() {
    const router = Router();

    router.get('/pedagogico-portal/status', async (req, res) => {
        const sess = await getPedagogoSession(req);
        res.json({
            pedagogo: sess
                ? { email: sess.email, nome: sess.nome, foto: sess.foto }
                : null,
        });
    });

    router.get('/pedagogico-portal/auth-url', (req, res) => {
        const oauth2 = getPedagogoOAuth2(req);
        if (!oauth2) return res.status(400).json({ erro: 'Google não configurado.' });
        const state = crypto.randomBytes(16).toString('hex');
        res.cookie('pp_oauth_state', state, {
            httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/',
            secure: process.env.NODE_ENV === 'production',
        });
        const url = oauth2.generateAuthUrl({
            access_type: 'online',
            scope:       PEDAGOGO_SCOPES,
            prompt:      'select_account',
            state,
            hd:          'escola.pr.gov.br',
        });
        res.json({ url });
    });

    router.get('/pedagogico-portal/callback', async (req, res) => {
        const { code, error, state } = req.query;
        if (error) return res.redirect('/pedagogico-portal/?erro=acesso_negado');

        const savedState = req.cookies?.pp_oauth_state;
        res.clearCookie('pp_oauth_state', { path: '/' });
        if (!state || !savedState || state !== savedState) {
            return res.redirect('/pedagogico-portal/?erro=falha_auth');
        }

        const oauth2 = getPedagogoOAuth2(req);
        if (!oauth2 || !code) return res.redirect('/pedagogico-portal/?erro=falha_auth');
        try {
            const { tokens } = await oauth2.getToken(code);
            const ticket = await oauth2.verifyIdToken({
                idToken: tokens.id_token,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            const email = (payload.email || '').toLowerCase();
            const nome  = payload.name  || email;
            const foto  = payload.picture || null;

            if (!email) return res.redirect('/pedagogico-portal/?erro=sem_email');
            if (!payload.email_verified) return res.redirect('/pedagogico-portal/?erro=email_nao_verificado');

            const dominiosPermitidos = ['escola.pr.gov.br', 'seed.pr.gov.br'];
            const dominio = email.split('@')[1];
            if (!dominiosPermitidos.includes(dominio)) {
                logPedagogo(req, email, nome, 'login_pedagogo_portal_negado', { motivo: 'dominio_invalido', dominio });
                return res.redirect('/pedagogico-portal/?erro=dominio_invalido');
            }

            const sid = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

            await pool.query(
                `INSERT INTO pedagogo_portal_sessions (id, email, nome, foto, expires_at)
                 VALUES ($1, $2, $3, $4, $5)`,
                [sid, email, nome, foto, expiresAt]
            );

            logPedagogo(req, email, nome, 'login_pedagogo_portal');

            res.cookie('pedagogo_sid', sid, {
                httpOnly: true,
                sameSite: 'lax',
                maxAge:   SESSION_TTL_MS,
                path:     '/',
                secure:   process.env.NODE_ENV === 'production',
            });
            res.redirect('/pedagogico-portal/');
        } catch (e) {
            console.error('[PEDAGOGICO-PORTAL] Erro callback:', e.message);
            res.redirect('/pedagogico-portal/?erro=falha_auth');
        }
    });

    router.post('/pedagogico-portal/logout', async (req, res) => {
        const sid = req.cookies?.pedagogo_sid;
        if (sid) {
            await pool.query(`DELETE FROM pedagogo_portal_sessions WHERE id = $1`, [sid]).catch(() => {});
        }
        res.clearCookie('pedagogo_sid', { path: '/' });
        res.json({ ok: true });
    });

    router.get('/pedagogico-portal/cursos', async (req, res) => {
        const sess = await getPedagogoSession(req);
        if (!sess) return res.status(401).json({ erro: 'Não autenticado.' });

        const auth = await getTeacherAuth(req);
        if (!auth) return res.status(503).json({ erro: 'Token do professor não disponível.' });

        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const cursos = [];
            let pageToken;
            do {
                const resp = await classroom.courses.list({
                    courseStates: ['ACTIVE'],
                    pageSize: 100,
                    pageToken,
                });
                cursos.push(...(resp.data.courses || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            res.json(cursos.map(c => ({
                id:   c.id,
                nome: c.name,
                secao: c.section || '',
                link: c.alternateLink,
            })));
        } catch (e) {
            console.error('[PEDAGOGICO-PORTAL] Erro ao listar cursos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    router.get('/pedagogico-portal/grupos', async (req, res) => {
        const sess = await getPedagogoSession(req);
        if (!sess) return res.status(401).json({ erro: 'Não autenticado.' });

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
                dataFechamento: g.data_fechamento ? g.data_fechamento.toISOString() : null,
                recuperacaoId:  g.rec_id      ?? null,
                recuperacaoNome:g.rec_nome    ?? null,
                codClasseRco:   g.cod_classe_rco_efetivo || null,
            })));
        } catch (e) {
            console.error('[PEDAGOGICO-PORTAL] Erro ao listar grupos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    router.get('/pedagogico-portal/grupos/:id/summary', async (req, res) => {
        const sess = await getPedagogoSession(req);
        if (!sess) return res.status(401).json({ erro: 'Não autenticado.' });

        const { courseId } = req.query;
        if (!courseId) return res.status(400).json({ erro: 'courseId obrigatório' });

        const auth = await getTeacherAuth(req);
        if (!auth) return res.status(503).json({ erro: 'Token do professor não disponível.' });

        try {
            const { rows: [grupoInfo] } = await pool.query(
                `SELECT tipo, grupo_origem_id, data_inicio, data_fechamento FROM classroom_grupos WHERE id = $1`,
                [req.params.id]
            );
            const isRecuperacao = grupoInfo?.tipo === 'recuperacao';
            const dataInicio = grupoInfo?.data_inicio ? new Date(grupoInfo.data_inicio) : null;

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

                    try {
                        const cwResp = await classroom.courses.courseWork.get({
                            courseId, id: a.atividade_id,
                        });
                        if (pontosMaxReal === null && cwResp.data.maxPoints > 0) {
                            pontosMaxReal = Number(cwResp.data.maxPoints);
                        }
                    } catch (_) {}

                    const allSubs = [];
                    let pageToken;
                    do {
                        const resp = await classroom.courses.courseWork.studentSubmissions.list({
                            courseId, courseWorkId: a.atividade_id, pageSize: 100, pageToken,
                        });
                        allSubs.push(...(resp.data.studentSubmissions || []));
                        pageToken = resp.data.nextPageToken;
                    } while (pageToken);

                    return { atividade: { ...a, _pontosMaxReal: pontosMaxReal }, submissions: allSubs };
                } catch (e) {
                    return { atividade: { ...a, _pontosMaxReal: null }, submissions: [], erro: e.message };
                }
            }));

            const atividadesOut = results.map(r => ({
                id:     r.atividade.atividade_id,
                titulo: r.atividade.atividade_titulo,
                pontos: r.atividade._pontosMaxReal ?? (r.atividade.pontos_max ? Number(r.atividade.pontos_max) : null),
            }));

            let totalPossivel = 0;
            atividadesOut.forEach(a => { if (a.pontos != null) totalPossivel += a.pontos; });

            const alunoMap = {};
            results.forEach(({ atividade, submissions }) => {
                const pontosMax = atividade._pontosMaxReal
                    ?? (atividade.pontos_max ? Number(atividade.pontos_max) : null);

                submissions.forEach(s => {
                    if (!alunoMap[s.userId]) {
                        alunoMap[s.userId] = { userId: s.userId, totalGanho: 0, pendentes: 0, atividades: {} };
                    }

                    const nota     = s.assignedGrade != null ? Number(s.assignedGrade) : null;
                    const entregue = s.state === 'TURNED_IN' || s.state === 'RETURNED';
                    const atrasado = !!s.late;
                    const updateTime = s.updateTime ? new Date(s.updateTime) : null;

                    const eDeRecuperacao = (!isRecuperacao && dataCorteOriginal && updateTime)
                        ? updateTime >= dataCorteOriginal
                        : false;

                    const dataFechGrupo = grupoInfo?.data_fechamento
                        ? new Date(grupoInfo.data_fechamento)
                        : null;

                    let eTardia = false;
                    if (!eDeRecuperacao && dataFechGrupo && entregue && updateTime && updateTime > dataFechGrupo) {
                        const histEntrega = (s.submissionHistory || [])
                            .filter(h => h.stateHistory?.state === 'TURNED_IN')
                            .map(h => new Date(h.stateHistory.stateTimestamp))
                            .sort((a, b) => b - a);

                        if (histEntrega.length > 0) {
                            eTardia = histEntrega[0] > dataFechGrupo;
                        } else {
                            eTardia = true;
                        }
                    }

                    alunoMap[s.userId].atividades[atividade.atividade_id] = {
                        nota, estado: s.state, entregue, atrasado, updateTime,
                        eDeRecuperacao, eTardia,
                    };

                    if (pontosMax === null) {
                    } else if (eDeRecuperacao) {
                    } else if (eTardia) {
                    } else if (nota !== null) {
                        alunoMap[s.userId].totalGanho += Math.min(nota, pontosMax);
                    } else if (!entregue) {
                        alunoMap[s.userId].pendentes++;
                    }
                });
            });

            let alunos = Object.values(alunoMap).map(a => ({
                userId:      a.userId,
                mediaIndice: totalPossivel > 0 ? (a.totalGanho / totalPossivel) * 100 : 0,
                pendentes:   a.pendentes,
                atividades:  a.atividades,
            }));

            if (isRecuperacao && dataInicio) {
                alunos = alunos.filter(a => {
                    return Object.values(a.atividades).some(at => {
                        if (!at.entregue || !at.updateTime) return false;
                        return new Date(at.updateTime) >= dataInicio;
                    });
                });
            }

            logPedagogo(req, sess.email, sess.nome, 'consultar_resumo_grupo', {
                grupoId: req.params.id, courseId, totalAlunos: alunos.length,
            });

            res.json({
                atividades: atividadesOut,
                alunos,
                isRecuperacao,
                dataInicio:       grupoInfo?.data_inicio ? new Date(grupoInfo.data_inicio).toISOString() : null,
                dataCorteOriginal: dataCorteOriginal ? dataCorteOriginal.toISOString() : null,
                dataFechamento:   grupoInfo?.data_fechamento ? new Date(grupoInfo.data_fechamento).toISOString() : null,
                grupoOrigemId:    grupoInfo?.grupo_origem_id ?? null,
            });
        } catch (e) {
            console.error('[PEDAGOGICO-PORTAL] Erro resumo grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    router.post('/pedagogico-portal/grupos/:id/abrir', async (req, res) => {
        const sess = await getPedagogoSession(req);
        if (!sess) return res.status(401).json({ erro: 'Não autenticado.' });

        try {
            const { rows: [grupo] } = await pool.query(
                `SELECT id, data_fechamento FROM classroom_grupos WHERE id = $1`, [req.params.id]
            );
            if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado.' });
            if (!grupo.data_fechamento) return res.json({ ok: true, mensagem: 'Grupo já está aberto.' });

            await pool.query(
                `UPDATE classroom_grupos SET data_fechamento = NULL WHERE id = $1`,
                [req.params.id]
            );

            logPedagogo(req, sess.email, sess.nome, 'reabrir_grupo_pedagogo', {
                grupoId: req.params.id,
            });

            res.json({ ok: true });
        } catch (e) {
            console.error('[PEDAGOGICO-PORTAL] Erro ao abrir grupo:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    router.get('/pedagogico-portal/alunos', async (req, res) => {
        const sess = await getPedagogoSession(req);
        if (!sess) return res.status(401).json({ erro: 'Não autenticado.' });

        const { courseId } = req.query;
        if (!courseId) return res.status(400).json({ erro: 'courseId obrigatório' });

        const auth = await getTeacherAuth(req);
        if (!auth) return res.status(503).json({ erro: 'Token do professor não disponível.' });

        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const students = [];
            let pageToken;
            do {
                const resp = await classroom.courses.students.list({
                    courseId, pageSize: 100, pageToken,
                });
                students.push(...(resp.data.students || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            const map = {};
            students.forEach(s => {
                map[s.userId] = {
                    nome:  s.profile?.name?.fullName || 'Aluno',
                    email: s.profile?.emailAddress || '',
                    foto:  s.profile?.photoUrl || '',
                };
            });
            res.json(map);
        } catch (e) {
            console.error('[PEDAGOGICO-PORTAL] Erro ao listar alunos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    router.get('/pedagogico-portal/tardias', async (req, res) => {
        const sess = await getPedagogoSession(req);
        if (!sess) return res.status(401).json({ erro: 'Não autenticado.' });

        const { grupoId } = req.query;
        if (!grupoId) return res.status(400).json({ erro: 'grupoId obrigatório' });

        try {
            const { rows } = await pool.query(
                `SELECT * FROM classroom_entregas_tardias WHERE grupo_id = $1 ORDER BY data_entrega DESC`,
                [grupoId]
            );
            res.json(rows);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
