/**
 * Portal do Aluno — rotas PÚBLICAS (sem requireAuth do EduSync)
 *
 * Fluxo:
 * 1. Aluno acessa /alunos/ e clica "Entrar com Google"
 * 2. OAuth minimal (openid + email + profile) para provar identidade
 * 3. Token do PROFESSOR já armazenado é usado para consultar
 *    quais disciplinas/cursos têm esse email matriculado
 * 4. Retorna atividades pendentes agrupadas por disciplina
 */

import { Router }        from 'express';
import { google }        from 'googleapis';
import fs                from 'fs';
import path              from 'path';
import { fileURLToPath } from 'url';
import pkg               from 'pg';
import crypto            from 'crypto';

const { Pool }   = pkg;
const pool       = new Pool({ connectionString: process.env.DATABASE_URL });
const __dirname  = path.dirname(fileURLToPath(import.meta.url));

/* Mesmo arquivo do token do professor usado por classroom.routes.js */
const TEACHER_TOKEN_FILE = path.join(__dirname, '../../data/classroom_token.json');

/* Sessão do aluno válida por 24 h */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/* Scopes mínimos: só precisamos do email/nome do aluno */
const STUDENT_SCOPES = ['openid', 'email', 'profile'];

/* ── Migração ─────────────────────────────────────────────────────── */
async function migrarTabela() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_portal_sessions (
                id         TEXT        PRIMARY KEY,
                email      TEXT        NOT NULL,
                nome       TEXT        NOT NULL DEFAULT '',
                foto       TEXT,
                expires_at TIMESTAMPTZ NOT NULL,
                criado_em  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        /* Limpa sessões expiradas periodicamente */
        await pool.query(`DELETE FROM aluno_portal_sessions WHERE expires_at < NOW()`).catch(() => {});
        console.log('[ALUNOS-PORTAL] Tabela aluno_portal_sessions OK');
    } catch (e) {
        console.warn('[ALUNOS-PORTAL] Erro na migração:', e.message);
    }
}

migrarTabela();

/* ── OAuth helpers ────────────────────────────────────────────────── */
function getStudentOAuth2(req) {
    const id  = process.env.GOOGLE_CLIENT_ID;
    const sec = process.env.GOOGLE_CLIENT_SECRET;
    if (!id || !sec) return null;
    const uri = `${req.protocol}://${req.get('host')}/api/alunos-portal/callback`;
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
    /* Usa a mesma redirect URI do classroom.routes.js para o refresh funcionar */
    const uri = `${req.protocol}://${req.get('host')}/api/classroom/callback`;
    const client = new google.auth.OAuth2(id, sec, uri);
    client.setCredentials(token);
    if (token.expiry_date && token.expiry_date < Date.now()) {
        try {
            const { credentials } = await client.refreshAccessToken();
            saveTeacherToken(credentials);
            client.setCredentials(credentials);
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao renovar token do professor:', e.message);
            return null;
        }
    }
    return client;
}

/* ── Sessão do aluno ──────────────────────────────────────────────── */
async function getAlunoSession(req) {
    const sid = req.cookies?.aluno_sid;
    if (!sid) return null;
    try {
        const { rows } = await pool.query(
            `SELECT * FROM aluno_portal_sessions WHERE id = $1 AND expires_at > NOW()`,
            [sid]
        );
        return rows[0] || null;
    } catch (_) { return null; }
}

/* ── Formatação de prazo ──────────────────────────────────────────── */
function formatarPrazo(dueDate, dueTime) {
    if (!dueDate?.year) return null;
    const d  = String(dueDate.day).padStart(2, '0');
    const m  = String(dueDate.month).padStart(2, '0');
    const y  = dueDate.year;
    const hh = String(dueTime?.hours  || 23).padStart(2, '0');
    const mm = String(dueTime?.minutes || 59).padStart(2, '0');
    return { br: `${d}/${m}/${y} às ${hh}:${mm}`, iso: `${y}-${m}-${d}T${hh}:${mm}` };
}

function prazoVencido(dueDate) {
    if (!dueDate?.year) return false;
    const limite = new Date(dueDate.year, dueDate.month - 1, dueDate.day, 23, 59);
    return limite < new Date();
}

/* ── Router ───────────────────────────────────────────────────────── */
export function createAlunosPortalRouter() {
    const router = Router();

    /* GET /api/alunos-portal/status — estado da conexão */
    router.get('/alunos-portal/status', async (req, res) => {
        const hasCredentials   = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const professorConect  = !!loadTeacherToken();
        const aluno            = await getAlunoSession(req);
        res.json({
            hasCredentials,
            professorConectado: professorConect,
            aluno: aluno
                ? { email: aluno.email, nome: aluno.nome, foto: aluno.foto }
                : null,
        });
    });

    /* GET /api/alunos-portal/auth-url — URL OAuth para o aluno */
    router.get('/alunos-portal/auth-url', (req, res) => {
        const oauth2 = getStudentOAuth2(req);
        if (!oauth2) return res.status(400).json({ erro: 'Google não configurado.' });
        const state = crypto.randomBytes(16).toString('hex');
        const url   = oauth2.generateAuthUrl({
            access_type: 'online',
            scope:       STUDENT_SCOPES,
            prompt:      'select_account',
            state,
        });
        res.json({ url });
    });

    /* GET /api/alunos-portal/callback — callback OAuth do aluno */
    router.get('/alunos-portal/callback', async (req, res) => {
        const { code, error } = req.query;
        if (error) return res.redirect('/alunos/?erro=acesso_negado');
        const oauth2 = getStudentOAuth2(req);
        if (!oauth2) return res.redirect('/alunos/?erro=sem_credenciais');
        try {
            const { tokens } = await oauth2.getToken(code);

            /* Decodifica o id_token JWT diretamente — mais robusto que userinfo API */
            let email = '', nome = '', foto = null;
            if (tokens.id_token) {
                try {
                    const payload = JSON.parse(
                        Buffer.from(tokens.id_token.split('.')[1], 'base64').toString('utf8')
                    );
                    email = payload.email   || '';
                    nome  = payload.name    || '';
                    foto  = payload.picture || null;
                } catch (decodeErr) {
                    console.warn('[ALUNOS-PORTAL] Falha ao decodificar id_token:', decodeErr.message);
                }
            }

            /* Fallback: tenta access_token via userinfo endpoint */
            if (!email && tokens.access_token) {
                try {
                    const uResp = await fetch(
                        'https://www.googleapis.com/oauth2/v3/userinfo',
                        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
                    );
                    const ud = await uResp.json();
                    email = ud.email   || '';
                    nome  = ud.name    || nome;
                    foto  = ud.picture || foto;
                } catch (_) {}
            }

            if (!email) return res.redirect('/alunos/?erro=sem_email');

            const sessionId = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

            await pool.query(
                `INSERT INTO aluno_portal_sessions (id, email, nome, foto, expires_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET email=$2, nome=$3, foto=$4, expires_at=$5`,
                [sessionId, email, data.name || '', data.picture || null, expiresAt]
            );

            res.cookie('aluno_sid', sessionId, {
                httpOnly: true,
                secure:   process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge:   SESSION_TTL_MS,
                path:     '/',
            });
            console.log('[ALUNOS-PORTAL] Login:', email);
            res.redirect('/alunos/');
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro no callback:', e.message);
            res.redirect('/alunos/?erro=falha_auth');
        }
    });

    /* POST /api/alunos-portal/logout */
    router.post('/alunos-portal/logout', async (req, res) => {
        const sid = req.cookies?.aluno_sid;
        if (sid) await pool.query('DELETE FROM aluno_portal_sessions WHERE id = $1', [sid]).catch(() => {});
        res.clearCookie('aluno_sid', { path: '/' });
        res.json({ ok: true });
    });

    /* GET /api/alunos-portal/atividades — atividades pendentes do aluno */
    router.get('/alunos-portal/atividades', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const auth = await getTeacherAuth(req);
        if (!auth) return res.status(503).json({
            erro: 'Nenhum professor conectou o Google Classroom ainda. Peça ao seu professor para configurar a integração.',
        });

        try {
            const classroom = google.classroom({ version: 'v1', auth });

            /* 1. Cursos onde o aluno está matriculado */
            let todosCursos = [];
            let pageToken;
            do {
                const r = await classroom.courses.list({
                    studentId:    aluno.email,
                    courseStates: ['ACTIVE'],
                    pageSize:     50,
                    pageToken,
                });
                todosCursos.push(...(r.data.courses || []));
                pageToken = r.data.nextPageToken;
            } while (pageToken);

            if (!todosCursos.length) {
                return res.json({ aluno: { email: aluno.email, nome: aluno.nome, foto: aluno.foto }, cursos: [] });
            }

            /* 2. Para cada curso: submissions pendentes + lista de coursework — em paralelo */
            const resultados = await Promise.all(todosCursos.map(async (curso) => {
                try {
                    const [subsResp, cwResp] = await Promise.all([
                        /* Submissions pendentes deste aluno neste curso */
                        classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',        // wildcard = todos os courseworks
                            userId:       aluno.email,
                            states:       ['CREATED', 'RECLAIMED'],
                            pageSize:     100,
                        }),
                        /* Metadados de todos os courseworks publicados */
                        classroom.courses.courseWork.list({
                            courseId:          curso.id,
                            courseWorkStates:  ['PUBLISHED'],
                            orderBy:           'dueDate asc',
                            pageSize:          100,
                        }),
                    ]);

                    const pendingSubs = subsResp.data.studentSubmissions || [];
                    if (!pendingSubs.length) return null;

                    const cwMap = {};
                    (cwResp.data.courseWork || []).forEach(cw => { cwMap[cw.id] = cw; });

                    const atividades = pendingSubs
                        .map(sub => {
                            const cw = cwMap[sub.courseWorkId];
                            if (!cw) return null;
                            const prazo    = formatarPrazo(cw.dueDate, cw.dueTime);
                            const vencida  = prazoVencido(cw.dueDate);
                            return {
                                id:        cw.id,
                                titulo:    cw.title,
                                tipo:      cw.workType || 'ASSIGNMENT',
                                prazo:     prazo?.br  || null,
                                prazoIso:  prazo?.iso || null,
                                vencida,
                                pontos:    cw.maxPoints ?? null,
                                link:      cw.alternateLink || '',
                                devolvida: sub.state === 'RECLAIMED',
                            };
                        })
                        .filter(Boolean)
                        .sort((a, b) => {
                            if (!a.prazoIso && !b.prazoIso) return 0;
                            if (!a.prazoIso) return 1;
                            if (!b.prazoIso) return -1;
                            return a.prazoIso.localeCompare(b.prazoIso);
                        });

                    if (!atividades.length) return null;

                    return {
                        cursoId: curso.id,
                        nome:    curso.name,
                        secao:   curso.section || '',
                        link:    curso.alternateLink || '',
                        atividades,
                    };
                } catch (e) {
                    /* Ignora cursos onde o professor não tem acesso aos dados do aluno */
                    console.warn(`[ALUNOS-PORTAL] Curso ${curso.id} ignorado:`, e.message);
                    return null;
                }
            }));

            const cursos = resultados.filter(Boolean);
            res.json({
                aluno:  { email: aluno.email, nome: aluno.nome, foto: aluno.foto },
                cursos,
                totalPendentes: cursos.reduce((s, c) => s + c.atividades.length, 0),
            });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao buscar atividades:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
