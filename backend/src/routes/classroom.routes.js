/**
 * Rotas do Google Classroom — autenticação via Puppeteer (sessão de primeira parte).
 *
 * Elimina a dependência de OAuth de app externo (bloqueado pelo SEED-PR).
 * O token é interceptado da sessão autêntica do classroom.google.com —
 * idêntico ao token usado pelo browser do professor, sem restrições de Workspace.
 */

import { Router }         from 'express';
import { googleSession }  from '../services/GoogleSession.js';
import { ClassroomApiError } from '../../../packages/classroom-scraper/src/ClassroomClient.js';

// ── Helper: resposta de erro padronizada ─────────────────────────────────────

function apiErr(res, e, context = '') {
    if (e instanceof ClassroomApiError) {
        console.error(`[CLASSROOM]${context ? ' ' + context : ''}: [${e.statusCode}] ${e.message}`);
        return res.status(e.statusCode || 500).json({ erro: e.message });
    }
    console.error(`[CLASSROOM]${context ? ' ' + context : ''}:`, e.message);
    return res.status(500).json({ erro: e.message });
}

// ── Helper: garante cliente autenticado ──────────────────────────────────────

function requireClient(res) {
    if (!googleSession.isConfigured()) {
        res.status(401).json({
            erro: 'Credenciais Google não configuradas. Defina GOOGLE_EMAIL e GOOGLE_PASSWORD.',
        });
        return null;
    }
    return googleSession.getClient();
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createClassroomRouter() {
    const router = Router();

    /* ── Status da conexão ── */
    router.get('/classroom/status', (_req, res) => {
        res.json({
            configured:     googleSession.isConfigured(),
            authenticated:  googleSession.isAuthenticated(),
            email:          googleSession.getEmail(),
            // Mantido por compatibilidade com frontend legado
            hasCredentials: googleSession.isConfigured(),
            connected:      googleSession.isAuthenticated(),
        });
    });

    /* ── Conectar — recebe email e senha digitados pela professora na UI ── */
    router.post('/classroom/connect', async (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                erro: 'E-mail e senha são obrigatórios.',
            });
        }

        try {
            googleSession.setCredentials(email.trim(), password);
            await googleSession.warmUp();
            res.json({
                ok:    true,
                email: googleSession.getEmail(),
                msg:   'Conectado ao Google Classroom com sucesso.',
            });
        } catch (e) {
            return apiErr(res, e, 'connect');
        }
    });

    /* ── Desconectar ── */
    router.post('/classroom/disconnect', (_req, res) => {
        googleSession.disconnect();
        res.json({ ok: true });
    });

    /* ── Listar cursos ── */
    router.get('/classroom/courses', async (_req, res) => {
        const client = requireClient(res);
        if (!client) return;
        try {
            const cursos = await client.listCourses();
            res.json(cursos);
        } catch (e) {
            return apiErr(res, e, 'listCourses');
        }
    });

    /* ── Listar alunos de um curso ── */
    router.get('/classroom/courses/:courseId/students', async (req, res) => {
        const client = requireClient(res);
        if (!client) return;
        try {
            const alunos = await client.listStudents(req.params.courseId);
            res.json(alunos);
        } catch (e) {
            return apiErr(res, e, 'listStudents');
        }
    });

    /* ── Listar atividades (courseWork) ── */
    router.get('/classroom/courses/:courseId/coursework', async (req, res) => {
        const client = requireClient(res);
        if (!client) return;
        try {
            const atividades = await client.listCourseWork(req.params.courseId);
            res.json(atividades);
        } catch (e) {
            return apiErr(res, e, 'listCourseWork');
        }
    });

    /* ── Listar entregas/notas de uma atividade ── */
    router.get('/classroom/courses/:courseId/coursework/:cwId/submissions', async (req, res) => {
        const client = requireClient(res);
        if (!client) return;
        try {
            const subs = await client.listSubmissions(req.params.courseId, req.params.cwId);
            res.json(subs);
        } catch (e) {
            return apiErr(res, e, 'listSubmissions');
        }
    });

    /* ── Atualizar nota de uma entrega ── */
    router.patch(
        '/classroom/courses/:courseId/coursework/:cwId/submissions/:subId/grade',
        async (req, res) => {
            const client = requireClient(res);
            if (!client) return;

            const { nota } = req.body;
            if (nota === undefined) {
                return res.status(400).json({ erro: 'Campo "nota" obrigatório.' });
            }

            try {
                const result = await client.patchGrade(
                    req.params.courseId,
                    req.params.cwId,
                    req.params.subId,
                    nota,
                );
                res.json(result);
            } catch (e) {
                return apiErr(res, e, 'patchGrade');
            }
        },
    );

    /* ── Devolver entrega ao aluno ── */
    router.post(
        '/classroom/courses/:courseId/coursework/:cwId/submissions/:subId/return',
        async (req, res) => {
            const client = requireClient(res);
            if (!client) return;
            try {
                const result = await client.returnSubmission(
                    req.params.courseId,
                    req.params.cwId,
                    req.params.subId,
                );
                res.json(result);
            } catch (e) {
                return apiErr(res, e, 'returnSubmission');
            }
        },
    );

    return router;
}
