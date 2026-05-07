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
import { auditLogger }   from '../services/AuditLogger.js';
import { UAParser }      from 'ua-parser-js';

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
        await pool.query(`DELETE FROM aluno_portal_sessions WHERE expires_at < NOW()`).catch(() => {});

        await pool.query(`
            CREATE TABLE IF NOT EXISTS reabertura_solicitacoes (
                id                SERIAL PRIMARY KEY,
                aluno_email       TEXT        NOT NULL,
                aluno_nome        TEXT,
                curso_id          TEXT        NOT NULL,
                curso_nome        TEXT,
                coursework_id     TEXT        NOT NULL,
                coursework_titulo TEXT,
                submission_link   TEXT,
                justificativa     TEXT,
                status            TEXT        NOT NULL DEFAULT 'pendente',
                resposta          TEXT,
                criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                respondido_em     TIMESTAMPTZ,
                respondido_por    TEXT,
                UNIQUE(aluno_email, coursework_id)
            )
        `);
        /* Notificações do aluno — bloqueantes na tela */
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes_aluno (
                id          SERIAL PRIMARY KEY,
                aluno_email TEXT        NOT NULL,
                tipo        VARCHAR(30) NOT NULL,
                referencia  TEXT,
                titulo      TEXT        NOT NULL,
                mensagem    TEXT        NOT NULL,
                dados       JSONB,
                lida        BOOLEAN     NOT NULL DEFAULT false,
                criado_em   TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        console.log('[ALUNOS-PORTAL] Tabelas OK');
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
    const uri = `${req.protocol}://${req.get('host')}/api/classroom/callback`;

    /* 1. Tenta banco de dados (token mais recente de qualquer professor conectado) */
    let token    = null;
    let cpfFromDb = null;
    try {
        const { rows } = await pool.query(
            `SELECT cpf, tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
        );
        if (rows[0]) { token = rows[0].tokens; cpfFromDb = rows[0].cpf; }
    } catch (_) {}

    /* 2. Fallback: arquivo legado */
    if (!token) token = loadTeacherToken();
    if (!token) return null;

    const client = new google.auth.OAuth2(id, sec, uri);
    client.setCredentials(token);
    if (token.expiry_date && token.expiry_date < Date.now()) {
        try {
            const { credentials } = await client.refreshAccessToken();
            if (cpfFromDb) {
                await pool.query(
                    `UPDATE classroom_tokens SET tokens = $1, atualizado = NOW() WHERE cpf = $2`,
                    [JSON.stringify(credentials), cpfFromDb]
                );
            } else {
                saveTeacherToken(credentials);
            }
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

/* ── Detecção Quizizz (mesmo critério do classroom.routes.js) ─────── */
function detectarQuizizzId(cw) {
    const materiais = cw.materials || [];
    for (const mat of materiais) {
        const url = mat.link?.url || mat.driveFile?.driveFile?.alternateLink || '';
        if (/quizizz\.com/i.test(url)) {
            const match = url.match(/\/quiz\/([0-9a-f]{24})/i);
            return match ? match[1] : 'LINK';
        }
    }
    if (/quiziz{1,2}/i.test(cw.title || '')) return 'TITULO';
    return null;
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

function prazoProximo(prazoIso) {
    if (!prazoIso) return false;
    const limite = new Date(prazoIso).getTime();
    const diffMs = limite - Date.now();
    return diffMs > 0 && diffMs < 2 * 60 * 60 * 1000; /* menos de 2 horas */
}

async function criarNotif(email, tipo, referencia, titulo, mensagem, dados = {}) {
    try {
        await pool.query(
            `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
             SELECT $1, $2, $3, $4, $5, $6::jsonb
             WHERE NOT EXISTS (
                 SELECT 1 FROM notificacoes_aluno
                 WHERE aluno_email=$1 AND tipo=$2 AND referencia=$3 AND lida=false
             )`,
            [email, tipo, referencia, titulo, mensagem, JSON.stringify(dados)]
        );
    } catch (_) { /* silencia erros de notificação */ }
}

/* ── Audit helper ─────────────────────────────────────────────────── */
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

function logAluno(req, email, nome, acao, detalhes = {}) {
    const ua  = req?.headers?.['user-agent'] || null;
    const ip  = req?.ip || null;
    auditLogger.registrar({
        usuarioId:   null,
        usuarioNome: nome || email,
        acao,
        modulo:      'portal_aluno',
        detalhes:    { email, ...parseUA(ua), ...detalhes },
        ip,
    }).catch(() => {});
}

/* ── Router ───────────────────────────────────────────────────────── */
export function createAlunosPortalRouter() {
    const router = Router();

    /* GET /api/alunos-portal/status — estado da conexão */
    router.get('/alunos-portal/status', async (req, res) => {
        const aluno = await getAlunoSession(req);
        res.json({
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
                [sessionId, email, nome, foto, expiresAt]
            );

            res.cookie('aluno_sid', sessionId, {
                httpOnly: true,
                secure:   process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge:   SESSION_TTL_MS,
                path:     '/',
            });
            console.log('[ALUNOS-PORTAL] Login:', email);
            logAluno(req, email, nome, 'LOGIN');
            res.redirect('/alunos/');
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro no callback:', e.message);
            res.redirect('/alunos/?erro=falha_auth');
        }
    });

    /* POST /api/alunos-portal/logout */
    router.post('/alunos-portal/logout', async (req, res) => {
        const sid   = req.cookies?.aluno_sid;
        const aluno = sid ? await getAlunoSession(req) : null;
        if (sid) await pool.query('DELETE FROM aluno_portal_sessions WHERE id = $1', [sid]).catch(() => {});
        res.clearCookie('aluno_sid', { path: '/' });
        if (aluno) logAluno(req, aluno.email, aluno.nome, 'LOGOUT');
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

            /* 2. Para cada curso: submissions pendentes + zeradas + coursework — em paralelo */
            const resultados = await Promise.all(todosCursos.map(async (curso) => {
                try {
                    const [subsPendResp, subsZerResp, subsAguardResp, cwResp] = await Promise.all([
                        /* Pendentes: nunca abriu / abriu mas não entregou / recolheu */
                        classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',
                            userId:       aluno.email,
                            states:       ['NEW', 'CREATED', 'RECLAIMED_BY_STUDENT'],
                            pageSize:     100,
                        }),
                        /* Devolvidas: RETURNED — filtraremos as zeradas (assignedGrade=0) */
                        classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',
                            userId:       aluno.email,
                            states:       ['RETURNED'],
                            pageSize:     100,
                        }),
                        /* Entregues mas sem nota: TURNED_IN */
                        classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',
                            userId:       aluno.email,
                            states:       ['TURNED_IN'],
                            pageSize:     100,
                        }),
                        /* Metadados de todos os courseworks publicados */
                        classroom.courses.courseWork.list({
                            courseId:         curso.id,
                            courseWorkStates: ['PUBLISHED'],
                            orderBy:          'dueDate asc',
                            pageSize:         100,
                        }),
                    ]);

                    const cwMap = {};
                    (cwResp.data.courseWork || []).forEach(cw => { cwMap[cw.id] = cw; });

                    const sortPrazo = (a, b) => {
                        if (!a.prazoIso && !b.prazoIso) return 0;
                        if (!a.prazoIso) return 1;
                        if (!b.prazoIso) return -1;
                        return a.prazoIso.localeCompare(b.prazoIso);
                    };

                    /* ── Atividades pendentes ─────────────────────────── */
                    const pendingSubs = subsPendResp.data.studentSubmissions || [];
                    const atividades  = pendingSubs
                        .map(sub => {
                            const cw = cwMap[sub.courseWorkId];
                            if (!cw) return null;
                            const prazo   = formatarPrazo(cw.dueDate, cw.dueTime);
                            const vencida = prazoVencido(cw.dueDate);
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
                                quizizzId: detectarQuizizzId(cw),
                            };
                        })
                        .filter(Boolean)
                        .sort(sortPrazo);

                    /* ── Atividades zeradas (RETURNED OU TURNED_IN com nota=0) ─
                       Equivale ao "Entrou (0 pts)" da visão do professor:
                       nota === 0 && (state === 'TURNED_IN' || state === 'RETURNED'). */
                    const returnedSubs = [
                        ...(subsZerResp.data.studentSubmissions    || []),
                        ...(subsAguardResp.data.studentSubmissions || []),
                    ];
                    const zeradas = returnedSubs
                        .filter(sub => (sub.assignedGrade ?? sub.draftGrade ?? null) === 0)
                        .map(sub => {
                            const cw = cwMap[sub.courseWorkId];
                            if (!cw) return null;
                            const prazo   = formatarPrazo(cw.dueDate, cw.dueTime);
                            const vencida = prazoVencido(cw.dueDate);
                            return {
                                id:        cw.id,
                                titulo:    cw.title,
                                tipo:      cw.workType || 'ASSIGNMENT',
                                prazo:     prazo?.br  || null,
                                prazoIso:  prazo?.iso || null,
                                vencida,
                                pontos:    cw.maxPoints ?? null,
                                link:      cw.alternateLink || '',
                                quizizzId: detectarQuizizzId(cw),
                            };
                        })
                        .filter(Boolean)
                        .sort(sortPrazo);

                    /* ── Aguardando correção (TURNED_IN sem nota atribuída) ─ */
                    const aguardSubs = subsAguardResp.data.studentSubmissions || [];
                    const aguardando = aguardSubs
                        .filter(sub => sub.assignedGrade == null && sub.draftGrade == null)
                        .map(sub => {
                            const cw = cwMap[sub.courseWorkId];
                            if (!cw) return null;
                            const prazo   = formatarPrazo(cw.dueDate, cw.dueTime);
                            const vencida = prazoVencido(cw.dueDate);
                            return {
                                id:        cw.id,
                                titulo:    cw.title,
                                tipo:      cw.workType || 'ASSIGNMENT',
                                prazo:     prazo?.br  || null,
                                prazoIso:  prazo?.iso || null,
                                vencida,
                                pontos:    cw.maxPoints ?? null,
                                link:      cw.alternateLink || '',
                                quizizzId: detectarQuizizzId(cw),
                                aguardando: true,
                            };
                        })
                        .filter(Boolean)
                        .sort(sortPrazo);

                    if (!atividades.length && !zeradas.length && !aguardando.length) return null;

                    /* ── Anota grupo de cada atividade (pendentes + zeradas + aguardando) ── */
                    let temGrupos = false;
                    try {
                        const { rows: cursoPossuiGrupos } = await pool.query(
                            `SELECT 1 FROM classroom_grupos
                             WHERE curso_id = $1 AND tipo = 'normal'
                             LIMIT 1`,
                            [String(curso.id)]
                        );

                        if (cursoPossuiGrupos.length > 0) {
                            temGrupos = true;

                            const todosIds = [
                                ...atividades.map(a => a.id),
                                ...zeradas.map(a => a.id),
                                ...aguardando.map(a => a.id),
                            ];

                            let grupoMap = {};
                            if (todosIds.length > 0) {
                                const { rows: grupoRows } = await pool.query(
                                    `SELECT ga.atividade_id::text, g.id as grupo_id, g.nome as grupo_nome, g.data_fechamento
                                     FROM classroom_grupo_atividades ga
                                     JOIN classroom_grupos g ON g.id = ga.grupo_id
                                     WHERE ga.atividade_id = ANY($1::text[])
                                       AND g.curso_id = $2
                                       AND g.tipo = 'normal'`,
                                    [todosIds, String(curso.id)]
                                );
                                grupoRows.forEach(r => {
                                    grupoMap[r.atividade_id] = {
                                        id: r.grupo_id,
                                        nome: r.grupo_nome,
                                        fechado: !!r.data_fechamento,
                                        dataFechamento: r.data_fechamento ? r.data_fechamento.toISOString() : null,
                                    };
                                });
                            }

                            const anotarGrupo = (a) => {
                                const g = grupoMap[String(a.id)];
                                if (g) {
                                    a.grupoId = g.id;
                                    a.grupoNome = g.nome;
                                    a.grupoFechado = g.fechado;
                                    a.grupoDataFechamento = g.dataFechamento;
                                }
                            };

                            atividades.forEach(anotarGrupo);
                            atividades.splice(0, atividades.length, ...atividades.filter(a => a.grupoId));

                            zeradas.forEach(anotarGrupo);
                            zeradas.splice(0, zeradas.length, ...zeradas.filter(a => a.grupoId));

                            aguardando.forEach(anotarGrupo);
                            aguardando.splice(0, aguardando.length, ...aguardando.filter(a => a.grupoId));
                        }
                    } catch (e) {
                        console.warn('[ALUNOS-PORTAL] Erro ao buscar grupos:', e.message);
                    }

                    if (!atividades.length && !zeradas.length && !aguardando.length) return null;

                    return {
                        cursoId:   curso.id,
                        nome:      curso.name,
                        secao:     curso.section || '',
                        link:      curso.alternateLink || '',
                        temGrupos,
                        atividades,
                        zeradas,
                        aguardando,
                    };
                } catch (e) {
                    console.warn(`[ALUNOS-PORTAL] Curso ${curso.id} ignorado:`, e.message);
                    return null;
                }
            }));

            const cursos = resultados.filter(Boolean);

            /* ── Notificações de prazo próximo (< 2 horas) ────────── */
            const todasAtiv = cursos.flatMap(c => [
                ...(c.atividades || []),
                ...(c.zeradas   || []),
            ]);
            const HORAS_2   = 2  * 60 * 60 * 1000;
            const DIAS_AVISO = 3;
            const hoje = new Date().toISOString().slice(0, 10); /* YYYY-MM-DD */

            for (const ativ of todasAtiv) {
                if (!ativ.prazoIso || ativ.vencida) continue;
                const limite = new Date(ativ.prazoIso).getTime();
                const diffMs = limite - Date.now();
                if (diffMs <= 0) continue; /* já vencida */

                /* Alerta imediato: menos de 2 horas */
                if (diffMs < HORAS_2) {
                    await criarNotif(
                        aluno.email,
                        'prazo_proximo',
                        String(ativ.id),
                        '⚠️ Prazo encerrando em breve!',
                        `A atividade "${ativ.titulo}" fecha em menos de 2 horas. Complete-a antes que o prazo se encerre!`,
                        { coursework_id: String(ativ.id), titulo: ativ.titulo }
                    );
                }

                /* Lembrete diário: de 2 horas até 3 dias antes
                   referencia inclui a data de hoje → 1 notif por dia por atividade */
                const diasMs = DIAS_AVISO * 24 * 60 * 60 * 1000;
                if (diffMs >= HORAS_2 && diffMs <= diasMs) {
                    const diasRestantes = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                    const refDiaria     = `${ativ.id}_${hoje}`;
                    const titulo = diasRestantes === 1
                        ? '📅 Prazo encerra amanhã!'
                        : `📅 Prazo em ${diasRestantes} dias`;
                    const mensagem = diasRestantes === 1
                        ? `A atividade "${ativ.titulo}" fecha amanhã. Realize-a antes que o prazo se encerre!`
                        : `A atividade "${ativ.titulo}" fecha em ${diasRestantes} dias. Não deixe acumular!`;
                    await criarNotif(
                        aluno.email,
                        'prazo_dias',
                        refDiaria,
                        titulo,
                        mensagem,
                        { coursework_id: String(ativ.id), titulo: ativ.titulo }
                    );
                }
            }

            res.json({
                aluno:            { email: aluno.email, nome: aluno.nome, foto: aluno.foto },
                cursos,
                totalPendentes:   cursos.reduce((s, c) => s + c.atividades.length,  0),
                totalZeradas:     cursos.reduce((s, c) => s + c.zeradas.length,     0),
                totalAguardando:  cursos.reduce((s, c) => s + c.aguardando.length,  0),
            });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao buscar atividades:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar atividades. Tente novamente.' });
        }
    });

    /* POST /api/alunos-portal/solicitar-reabertura */
    router.post('/alunos-portal/solicitar-reabertura', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const { courseworkId, courseworkTitulo, cursoId, cursoNome, submissionLink, justificativa } = req.body;
        if (!courseworkId || !cursoId) return res.status(400).json({ erro: 'Dados incompletos.' });
        if (justificativa && justificativa.length > 600)
            return res.status(400).json({ erro: 'Justificativa muito longa (máx 600 caracteres).' });

        try {
            const { rows } = await pool.query(
                `INSERT INTO reabertura_solicitacoes
                    (aluno_email, aluno_nome, curso_id, curso_nome, coursework_id, coursework_titulo, submission_link, justificativa)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (aluno_email, coursework_id)
                    DO UPDATE SET
                        justificativa   = EXCLUDED.justificativa,
                        status          = 'pendente',
                        resposta        = NULL,
                        respondido_em   = NULL,
                        respondido_por  = NULL,
                        criado_em       = NOW()
                 RETURNING id, status`,
                [aluno.email, aluno.nome, cursoId, cursoNome, courseworkId, courseworkTitulo, submissionLink || null, justificativa || null]
            );
            logAluno(req, aluno.email, aluno.nome, 'SOLICITAR_REABERTURA', {
                courseworkId, courseworkTitulo, cursoId, cursoNome,
            });
            res.json({ ok: true, id: rows[0].id });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao solicitar reabertura:', e.message);
            res.status(500).json({ erro: 'Não foi possível registrar a solicitação. Tente novamente.' });
        }
    });

    /* GET /api/alunos-portal/notificacoes — retorna não lidas */
    router.get('/alunos-portal/notificacoes', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const { rows } = await pool.query(
                `SELECT id, tipo, referencia, titulo, mensagem, dados, criado_em
                 FROM notificacoes_aluno
                 WHERE aluno_email=$1 AND lida=false
                 ORDER BY criado_em ASC`,
                [aluno.email]
            );
            res.json({ notificacoes: rows });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao buscar notificações:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar notificações.' });
        }
    });

    /* POST /api/alunos-portal/notificacoes/:id/ler — marca como lida */
    router.post('/alunos-portal/notificacoes/:id/ler', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            await pool.query(
                `UPDATE notificacoes_aluno SET lida=true WHERE id=$1 AND aluno_email=$2`,
                [req.params.id, aluno.email]
            );
            logAluno(req, aluno.email, aluno.nome, 'NOTIF_LIDA', { notifId: req.params.id });
            res.json({ ok: true });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao marcar notificação:', e.message);
            res.status(500).json({ erro: 'Erro interno ao atualizar notificação.' });
        }
    });

    /* GET /api/alunos-portal/minhas-solicitacoes */
    router.get('/alunos-portal/minhas-solicitacoes', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        try {
            const { rows } = await pool.query(
                `SELECT id, curso_nome, coursework_id, coursework_titulo,
                        submission_link, justificativa, status, resposta,
                        criado_em, respondido_em
                 FROM reabertura_solicitacoes
                 WHERE aluno_email = $1
                 ORDER BY criado_em DESC`,
                [aluno.email]
            );
            res.json({ solicitacoes: rows });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao buscar solicitações:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar solicitações.' });
        }
    });

    /* ══════════════════════════════════════════════════════════════════
       CONQUISTAS — calcula se o aluno atingiu nota teto do grupo
    ══════════════════════════════════════════════════════════════════ */

    /* GET /api/alunos-portal/conquistas */
    router.get('/alunos-portal/conquistas', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const auth = await getTeacherAuth(req);
        if (!auth) return res.json({ conquistas: [] });

        try {
            const classroom = google.classroom({ version: 'v1', auth });

            /* 1. Cursos onde o aluno está matriculado */
            const cursosRes = await classroom.courses.list({
                studentId:    aluno.email,
                courseStates: ['ACTIVE'],
                pageSize:     50,
            });
            const cursos = cursosRes.data.courses || [];
            if (!cursos.length) return res.json({ conquistas: [] });

            const cursosIds    = cursos.map(c => c.id);
            const cursoNomeMap = Object.fromEntries(cursos.map(c => [c.id, c.name || '']));

            /* 2. Grupos e atividades dos cursos (do BD) */
            const { rows: grupos } = await pool.query(`
                SELECT g.id, g.nome, g.curso_id, g.pontos_meta, g.cor,
                       array_agg(ga.atividade_id) FILTER (WHERE ga.atividade_id IS NOT NULL) AS atividade_ids
                FROM   classroom_grupos g
                LEFT JOIN classroom_grupo_atividades ga ON ga.grupo_id = g.id
                WHERE  g.curso_id = ANY($1::text[])
                  AND  g.tipo     = 'normal'
                GROUP  BY g.id, g.nome, g.curso_id, g.pontos_meta, g.cor
                HAVING COUNT(ga.atividade_id) > 0
                   AND g.pontos_meta > 0
            `, [cursosIds]);

            if (!grupos.length) return res.json({ conquistas: [] });

            /* 3. Submissions RETURNED do aluno em todos os cursos (em paralelo) */
            const submissionsMap = {}; /* courseWorkId → assignedGrade */
            await Promise.all(cursos.map(async (curso) => {
                try {
                    let pToken;
                    do {
                        const r = await classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',
                            userId:       aluno.email,
                            states:       ['RETURNED'],
                            pageSize:     250,
                            pageToken:    pToken,
                        });
                        (r.data.studentSubmissions || []).forEach(sub => {
                            if (sub.assignedGrade != null) {
                                submissionsMap[sub.courseWorkId] = sub.assignedGrade;
                            }
                        });
                        pToken = r.data.nextPageToken;
                    } while (pToken);
                } catch { /* ignora curso com erro */ }
            }));

            /* 4. Calcula conquistas */
            const conquistas = [];
            for (const grupo of grupos) {
                const ids       = grupo.atividade_ids || [];
                const notaTeto  = Number(grupo.pontos_meta);
                let   somaNotas = 0;

                ids.forEach(atId => {
                    if (submissionsMap[atId] != null) somaNotas += submissionsMap[atId];
                });

                if (somaNotas < notaTeto) continue;

                /* UPSERT — preserva conquistado_em original */
                const { rows: [row] } = await pool.query(`
                    INSERT INTO conquistas_aluno
                        (aluno_email, aluno_nome, grupo_id, grupo_nome, curso_id, curso_nome, nota_teto)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)
                    ON CONFLICT (aluno_email, grupo_id) DO UPDATE
                        SET grupo_nome = EXCLUDED.grupo_nome,
                            curso_nome = EXCLUDED.curso_nome,
                            nota_teto  = EXCLUDED.nota_teto
                    RETURNING *, (notificado = false) AS nova
                `, [aluno.email, aluno.nome, grupo.id, grupo.nome,
                    grupo.curso_id, cursoNomeMap[grupo.curso_id] || '', notaTeto]);

                conquistas.push({
                    id:            row.id,
                    grupoId:       row.grupo_id,
                    grupoNome:     row.grupo_nome,
                    cursoId:       row.curso_id,
                    cursoNome:     row.curso_nome,
                    notaTeto:      Number(row.nota_teto),
                    cor:           grupo.cor  || '#4285F4',
                    conquistadoEm: row.conquistado_em,
                    nova:          row.nova,
                });
            }

            res.json({ conquistas });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao calcular conquistas:', e.message);
            res.status(500).json({ erro: 'Erro ao calcular conquistas.', conquistas: [] });
        }
    });

    /* PATCH /api/alunos-portal/conquistas/notificado — marca todas como vistas */
    router.patch('/alunos-portal/conquistas/notificado', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            await pool.query(
                `UPDATE conquistas_aluno SET notificado = true WHERE aluno_email = $1`,
                [aluno.email]
            );
            res.json({ ok: true });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao marcar conquistas:', e.message);
            res.status(500).json({ erro: 'Erro interno.' });
        }
    });

    /* GET /api/alunos-portal/mural — nomes dos achievers por grupo (sem notas) */
    router.get('/alunos-portal/mural', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const auth = await getTeacherAuth(req);
        if (!auth) return res.json({ grupos: [] });

        try {
            const classroom = google.classroom({ version: 'v1', auth });

            const cursosRes = await classroom.courses.list({
                studentId:    aluno.email,
                courseStates: ['ACTIVE'],
                pageSize:     50,
            });
            const cursos    = cursosRes.data.courses || [];
            if (!cursos.length) return res.json({ grupos: [] });

            const cursosIds = cursos.map(c => c.id);

            /* Grupos dos cursos */
            const { rows: grupos } = await pool.query(`
                SELECT id, nome, cor
                FROM   classroom_grupos
                WHERE  curso_id = ANY($1::text[])
                  AND  tipo = 'normal'
            `, [cursosIds]);

            if (!grupos.length) return res.json({ grupos: [] });

            const grupoIds = grupos.map(g => g.id);

            /* Achievers já registrados na tabela */
            const { rows: achievers } = await pool.query(`
                SELECT grupo_id, aluno_nome, conquistado_em
                FROM   conquistas_aluno
                WHERE  grupo_id = ANY($1::int[])
                ORDER  BY grupo_id, conquistado_em ASC
            `, [grupoIds]);

            const grupoMap = Object.fromEntries(grupos.map(g => [g.id, { ...g, achievers: [] }]));
            achievers.forEach(a => {
                if (grupoMap[a.grupo_id]) grupoMap[a.grupo_id].achievers.push(a.aluno_nome);
            });

            const resultado = Object.values(grupoMap)
                .filter(g => g.achievers.length > 0)
                .map(g => ({
                    grupoId:   g.id,
                    grupoNome: g.nome,
                    cor:       g.cor || '#4285F4',
                    achievers: g.achievers,
                }));

            res.json({ grupos: resultado });
        } catch (e) {
            console.error('[ALUNOS-PORTAL] Erro ao buscar mural:', e.message);
            res.json({ grupos: [] });
        }
    });

    /* ── Projetos: aluno submete link ──────────────────────────────────── */

    router.post('/alunos-portal/projetos/sugerir', async (req, res) => {
        const session = await getAlunoSession(req);
        if (!session) return res.status(401).json({ erro: 'Não autenticado' });
        const { nome, url } = req.body;
        if (!nome || !url) return res.status(400).json({ erro: 'nome e url são obrigatórios' });
        try {
            const { inferirTipo } = await import('../services/projectMonitorService.js');
            const tipo = inferirTipo(url);
            await pool.query(
                `INSERT INTO aluno_projeto_sugestoes (aluno_email, aluno_nome, nome, tipo, url)
                 VALUES ($1, $2, $3, $4, $5)`,
                [session.email, session.nome || '', nome.slice(0, 120), tipo, url]
            );
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.get('/alunos-portal/projetos/minhas-sugestoes', async (req, res) => {
        const session = await getAlunoSession(req);
        if (!session) return res.status(401).json({ erro: 'Não autenticado' });
        try {
            const { rows } = await pool.query(
                `SELECT * FROM aluno_projeto_sugestoes WHERE aluno_email = $1 ORDER BY criado_em DESC`,
                [session.email]
            );
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
