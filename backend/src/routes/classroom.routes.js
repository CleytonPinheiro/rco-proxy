import { Router } from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '../../data/classroom_token.json');

const SCOPES = [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me',
    'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
    'https://www.googleapis.com/auth/classroom.rosters.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
];

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
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        }
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

    // Atualiza token se expirado
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

export function createClassroomRouter() {
    const router = Router();

    /* ── Status da conexão ── */
    router.get('/classroom/status', (req, res) => {
        const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const token = loadToken();
        res.json({
            hasCredentials,
            connected: !!token,
            email: token?.email || null,
        });
    });

    /* ── URL de autorização OAuth ── */
    router.get('/classroom/auth-url', (req, res) => {
        const oauth2Client = getOAuth2Client(req);
        if (!oauth2Client) {
            return res.status(400).json({ erro: 'Credenciais do Google não configuradas. Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.' });
        }
        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent',
        });
        res.json({ url });
    });

    /* ── Callback OAuth ── */
    router.get('/classroom/callback', async (req, res) => {
        const { code, error } = req.query;
        if (error) {
            return res.redirect('/pages/classroom/?erro=acesso_negado');
        }
        const oauth2Client = getOAuth2Client(req);
        if (!oauth2Client) {
            return res.redirect('/pages/classroom/?erro=sem_credenciais');
        }
        try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);

            // Busca email do usuário
            try {
                const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
                const { data } = await oauth2.userinfo.get();
                tokens.email = data.email;
            } catch (_) {}

            saveToken(tokens);
            console.log('[CLASSROOM] Conectado com sucesso. Email:', tokens.email || '(sem email)');
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
                const resp = await classroom.courses.list({
                    teacherId: 'me',
                    courseStates: ['ACTIVE'],
                    pageSize: 100,
                    pageToken,
                });
                allCourses.push(...(resp.data.courses || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            res.json(allCourses.map(c => ({
                id:          c.id,
                nome:        c.name,
                secao:       c.section || '',
                descricao:   c.description || '',
                sala:        c.room || '',
                turmaCode:   c.enrollmentCode || '',
                link:        c.alternateLink || '',
                alunos:      c.courseState,
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
                const resp = await classroom.courses.students.list({
                    courseId: req.params.courseId,
                    pageSize: 100,
                    pageToken,
                });
                allStudents.push(...(resp.data.students || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            res.json(allStudents.map(s => ({
                userId:  s.userId,
                nome:    s.profile?.name?.fullName || '—',
                email:   s.profile?.emailAddress || '',
                foto:    s.profile?.photoUrl || null,
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
                    courseId: req.params.courseId,
                    orderBy: 'dueDate desc',
                    pageSize: 50,
                    pageToken,
                });
                allWork.push(...(resp.data.courseWork || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            res.json(allWork.map(w => {
                let prazo = null;
                if (w.dueDate) {
                    prazo = `${String(w.dueDate.day).padStart(2,'0')}/${String(w.dueDate.month).padStart(2,'0')}/${w.dueDate.year}`;
                }
                return {
                    id:          w.id,
                    titulo:      w.title,
                    descricao:   w.description || '',
                    tipo:        w.workType,
                    pontos:      w.maxPoints ?? null,
                    prazo,
                    link:        w.alternateLink || '',
                    criadoEm:    w.creationTime,
                };
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
                    courseId:     req.params.courseId,
                    courseWorkId: req.params.cwId,
                    pageSize:     100,
                    pageToken,
                });
                allSubs.push(...(resp.data.studentSubmissions || []));
                pageToken = resp.data.nextPageToken;
            } while (pageToken);

            res.json(allSubs.map(s => ({
                id:            s.id,
                userId:        s.userId,
                estado:        s.state,
                entregue:      s.state === 'TURNED_IN' || s.state === 'RETURNED',
                nota:          s.assignedGrade ?? null,
                notaRascunho:  s.draftGrade ?? null,
                atrasado:      s.late || false,
                atualizadoEm:  s.updateTime,
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
        if (nota === undefined || nota === null) {
            return res.status(400).json({ erro: 'Campo "nota" obrigatório.' });
        }

        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const resp = await classroom.courses.courseWork.studentSubmissions.patch({
                courseId:     req.params.courseId,
                courseWorkId: req.params.cwId,
                id:           req.params.subId,
                updateMask:   'assignedGrade',
                requestBody:  { assignedGrade: nota === '' ? null : Number(nota) },
            });
            res.json({ ok: true, nota: resp.data.assignedGrade });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao atualizar nota:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Devolver (return) entrega para aluno ── */
    router.post('/classroom/courses/:courseId/coursework/:cwId/submissions/:subId/return', async (req, res) => {
        const auth = await getAuthenticatedClient(req);
        if (!auth) return res.status(401).json({ erro: 'Não autenticado.' });

        try {
            const classroom = google.classroom({ version: 'v1', auth });
            await classroom.courses.courseWork.studentSubmissions.return({
                courseId:     req.params.courseId,
                courseWorkId: req.params.cwId,
                id:           req.params.subId,
                requestBody:  {},
            });
            res.json({ ok: true });
        } catch (e) {
            console.error('[CLASSROOM] Erro ao devolver entrega:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
