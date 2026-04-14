/**
 * Rotas de administração: gerenciamento de usuários e log de auditoria.
 * Acesso restrito ao perfil 'admin'.
 */
import { Router }          from 'express';
import pg                  from 'pg';
import fs                  from 'fs';
import path                from 'path';
import { fileURLToPath }   from 'url';
import { google }          from 'googleapis';
import { requireAuth, requirePerfil } from '../middleware/auth.middleware.js';
import { auditLogger }     from '../services/AuditLogger.js';
import { LISTA_PERFIS }    from '../config/permissions.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEACHER_TOKEN_FILE = path.join(__dirname, '../../data/classroom_token.json');

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

function getTeacherAuth() {
    const id  = process.env.GOOGLE_CLIENT_ID;
    const sec = process.env.GOOGLE_CLIENT_SECRET;
    if (!id || !sec) return null;
    try {
        if (!fs.existsSync(TEACHER_TOKEN_FILE)) return null;
        const token  = JSON.parse(fs.readFileSync(TEACHER_TOKEN_FILE, 'utf8'));
        const client = new google.auth.OAuth2(id, sec);
        client.setCredentials(token);
        return client;
    } catch { return null; }
}

export function createAdminRouter({ supabaseAdmin } = {}) {
    const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
    const router = Router();

    /* Todos os endpoints exigem autenticação e perfil admin */
    router.use(requireAuth, requirePerfil('admin'));

    /* ── Perfis disponíveis ── */
    router.get('/admin/perfis', (_req, res) => {
        res.json(LISTA_PERFIS);
    });

    /* ── Listar usuários ── */
    router.get('/admin/usuarios', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT id, nome, cpf, perfil, ativo, criado_em,
                        plano, plano_inicio, plano_renovacao, plano_obs
                 FROM edusync_usuarios ORDER BY nome`,
            );
            res.json(rows);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar plano individual de um professor ── */
    router.patch('/admin/usuarios/:id/plano', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const { plano, plano_inicio, plano_renovacao, plano_obs } = req.body;

        const planosValidos = ['trial', 'basico', 'completo', 'classroom-individual', null];
        if (!planosValidos.includes(plano)) {
            return res.status(400).json({ erro: `Plano inválido. Valores aceitos: ${planosValidos.filter(Boolean).join(', ')} ou null.` });
        }

        try {
            const { rows } = await pool.query(
                `UPDATE edusync_usuarios
                    SET plano           = $1,
                        plano_inicio    = $2,
                        plano_renovacao = $3,
                        plano_obs       = $4
                  WHERE id = $5
                  RETURNING id, nome, plano, plano_inicio, plano_renovacao, plano_obs`,
                [plano ?? null, plano_inicio ?? null, plano_renovacao ?? null, plano_obs ?? null, id],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'USUARIO_PLANO_ALTERADO',
                modulo:      'admin',
                detalhes:    { usuarioId: id, planoNovo: plano },
                ip:          req.ip,
            });

            res.json(rows[0]);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Criar usuário ── */
    router.post('/admin/usuarios', async (req, res) => {
        const { nome, cpf, perfil } = req.body;
        if (!nome || !cpf || !perfil) {
            return res.status(400).json({ erro: 'nome, cpf e perfil são obrigatórios.' });
        }
        const cpfLimpo = cpf.replace(/\D/g, '');
        try {
            const { rows } = await pool.query(
                `INSERT INTO edusync_usuarios (nome, cpf, perfil, criado_por)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, nome, cpf, perfil, ativo, criado_em`,
                [nome.trim(), cpfLimpo, perfil, req.userSession.userId],
            );
            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'USUARIO_CRIADO',
                modulo:      'admin',
                detalhes:    { usuarioCriado: { id: rows[0].id, nome, perfil } },
                ip:          req.ip,
            });
            res.status(201).json(rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ erro: 'CPF já cadastrado.' });
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar usuário ── */
    router.put('/admin/usuarios/:id', async (req, res) => {
        const { nome, perfil, ativo } = req.body;
        const id = parseInt(req.params.id, 10);

        // Impede que o admin remova seu próprio perfil de admin
        if (id === req.userSession.userId && perfil && perfil !== 'admin') {
            return res.status(400).json({ erro: 'Você não pode alterar seu próprio perfil de administrador.' });
        }

        try {
            const sets   = [];
            const params = [];
            if (typeof nome === 'string') { params.push(nome.trim()); sets.push(`nome   = $${params.length}`); }
            if (perfil !== undefined) { params.push(perfil);        sets.push(`perfil = $${params.length}`); }
            if (ativo  !== undefined) { params.push(ativo);         sets.push(`ativo  = $${params.length}`); }

            if (!sets.length) return res.status(400).json({ erro: 'Nada para atualizar.' });

            params.push(id);
            const { rows } = await pool.query(
                `UPDATE edusync_usuarios SET ${sets.join(', ')}
                 WHERE id = $${params.length}
                 RETURNING id, nome, cpf, perfil, ativo`,
                params,
            );
            if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'USUARIO_ATUALIZADO',
                modulo:      'admin',
                detalhes:    { usuarioId: id, alteracoes: req.body },
                ip:          req.ip,
            });
            res.json(rows[0]);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Desativar usuário (soft delete) ── */
    router.delete('/admin/usuarios/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (id === req.userSession.userId) {
            return res.status(400).json({ erro: 'Você não pode desativar sua própria conta.' });
        }
        try {
            const { rows } = await pool.query(
                `UPDATE edusync_usuarios SET ativo = false WHERE id = $1 RETURNING id, nome`,
                [id],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'USUARIO_DESATIVADO',
                modulo:      'admin',
                detalhes:    { usuarioDesativado: rows[0] },
                ip:          req.ip,
            });
            res.json({ sucesso: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Log de auditoria ── */
    router.get('/admin/audit-log', async (req, res) => {
        try {
            const { usuario_id, modulo, limite = 100, offset = 0 } = req.query;
            const logs = await auditLogger.consultar({
                usuarioId: usuario_id ? parseInt(usuario_id, 10) : null,
                modulo:    modulo || null,
                limite:    Math.min(parseInt(limite, 10) || 100, 500),
                offset:    parseInt(offset, 10) || 0,
            });
            res.json(logs);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ════════════════════════════════════════════════════════
       ESCOLAS — whitelist de estabelecimentos autorizados
    ════════════════════════════════════════════════════════ */

    /* ── Listar escolas da whitelist ── */
    router.get('/admin/escolas', async (_req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT id, nome, codigo_estabelecimento, permite_auto_cadastro, ativo, criado_em,
                        plano, plano_inicio, plano_renovacao, plano_obs
                 FROM edusync_escolas ORDER BY nome`,
            );
            res.json(rows);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar plano de uma escola ── */
    router.patch('/admin/escolas/:id/plano', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const { plano, plano_inicio, plano_renovacao, plano_obs } = req.body;

        const planosValidos = ['inicial', 'profissional', 'rede', null];
        if (!planosValidos.includes(plano)) {
            return res.status(400).json({ erro: `Plano inválido. Valores aceitos: ${planosValidos.filter(Boolean).join(', ')} ou null.` });
        }

        try {
            const { rows } = await pool.query(
                `UPDATE edusync_escolas
                    SET plano           = $1,
                        plano_inicio    = $2,
                        plano_renovacao = $3,
                        plano_obs       = $4
                  WHERE id = $5
                  RETURNING id, nome, plano, plano_inicio, plano_renovacao, plano_obs`,
                [plano ?? null, plano_inicio ?? null, plano_renovacao ?? null, plano_obs ?? null, id],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Escola não encontrada.' });

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'ESCOLA_PLANO_ALTERADO',
                modulo:      'admin',
                detalhes:    { escolaId: id, planoAnterior: null, planoNovo: plano },
                ip:          req.ip,
            });

            res.json(rows[0]);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Lookup de estabelecimentos sincronizados do RCO (para preencher o formulário) ── */
    router.get('/admin/rco-estabelecimentos', async (_req, res) => {
        if (!supabaseAdmin) return res.json([]);
        try {
            const { data, error } = await supabaseAdmin
                .from('rco_estabelecimentos')
                .select('cod_estabelecimento, nome_estabelecimento')
                .order('nome_estabelecimento');
            if (error) return res.status(500).json({ erro: error.message });
            res.json(data || []);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Adicionar escola à whitelist ── */
    router.post('/admin/escolas', async (req, res) => {
        const { nome, codigo_estabelecimento, permite_auto_cadastro = true } = req.body;
        if (!nome || !codigo_estabelecimento) {
            return res.status(400).json({ erro: 'nome e codigo_estabelecimento são obrigatórios.' });
        }
        const codigo = parseInt(codigo_estabelecimento, 10);
        if (isNaN(codigo)) {
            return res.status(400).json({ erro: 'codigo_estabelecimento deve ser numérico.' });
        }
        try {
            const { rows } = await pool.query(
                `INSERT INTO edusync_escolas (nome, codigo_estabelecimento, permite_auto_cadastro)
                 VALUES ($1, $2, $3)
                 RETURNING id, nome, codigo_estabelecimento, permite_auto_cadastro, ativo, criado_em`,
                [nome.trim(), codigo, permite_auto_cadastro],
            );
            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'ESCOLA_ADICIONADA',
                modulo:      'admin',
                detalhes:    { escola: rows[0] },
                ip:          req.ip,
            });
            res.status(201).json(rows[0]);
        } catch (e) {
            if (e.code === '23505') return res.status(409).json({ erro: 'Escola já cadastrada (código duplicado).' });
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atualizar escola ── */
    router.put('/admin/escolas/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const { nome, permite_auto_cadastro, ativo } = req.body;
        try {
            const sets   = [];
            const params = [];
            if (typeof nome === 'string')                { params.push(nome.trim());            sets.push(`nome                  = $${params.length}`); }
            if (typeof permite_auto_cadastro === 'boolean') { params.push(permite_auto_cadastro); sets.push(`permite_auto_cadastro = $${params.length}`); }
            if (typeof ativo === 'boolean')              { params.push(ativo);                  sets.push(`ativo                 = $${params.length}`); }

            if (!sets.length) return res.status(400).json({ erro: 'Nada para atualizar.' });

            params.push(id);
            const { rows } = await pool.query(
                `UPDATE edusync_escolas SET ${sets.join(', ')} WHERE id = $${params.length}
                 RETURNING id, nome, codigo_estabelecimento, permite_auto_cadastro, ativo`,
                params,
            );
            if (!rows.length) return res.status(404).json({ erro: 'Escola não encontrada.' });

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'ESCOLA_ATUALIZADA',
                modulo:      'admin',
                detalhes:    { escolaId: id, alteracoes: req.body },
                ip:          req.ip,
            });
            res.json(rows[0]);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Remover escola da whitelist (soft delete) ── */
    router.delete('/admin/escolas/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        try {
            const { rows } = await pool.query(
                `UPDATE edusync_escolas SET ativo = false WHERE id = $1
                 RETURNING id, nome, codigo_estabelecimento`,
                [id],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Escola não encontrada.' });

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'ESCOLA_REMOVIDA',
                modulo:      'admin',
                detalhes:    { escola: rows[0] },
                ip:          req.ip,
            });
            res.json({ sucesso: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ════════════════════════════════════════════════════════
       IMPERSONAÇÃO — visualizar o sistema como outro perfil
       Segurança: requirePerfil usa o perfil REAL da sessão,
       portanto o admin continua protegido mesmo enquanto impersona.
    ════════════════════════════════════════════════════════ */

    /* ── Ativar impersonação ── */
    router.post('/admin/impersonar', async (req, res) => {
        const { perfil } = req.body;
        if (!perfil) {
            return res.status(400).json({ erro: 'perfil é obrigatório.' });
        }

        const perfilConfig = LISTA_PERFIS.find(p => p.id === perfil);
        if (!perfilConfig) {
            return res.status(400).json({ erro: 'Perfil inválido.' });
        }

        if (perfil === 'admin') {
            return res.status(400).json({ erro: 'Não é possível impersonar o perfil admin.' });
        }

        req.userSession.impersonar(perfil, perfilConfig.nome);

        await auditLogger.registrar({
            usuarioId:   req.userSession.userId,
            usuarioNome: req.userSession.nome,
            acao:        'IMPERSONACAO_INICIADA',
            modulo:      'admin',
            detalhes:    { perfilSimulado: perfil },
            ip:          req.ip,
        });

        res.json({ sucesso: true, usuario: req.userSession.toPublic() });
    });

    /* ── Sair da impersonação ── */
    router.post('/admin/impersonar/sair', async (req, res) => {
        const estaImpersonando = req.userSession.isImpersonando;
        req.userSession.sairImpersonacao();

        if (estaImpersonando) {
            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'IMPERSONACAO_ENCERRADA',
                modulo:      'admin',
                ip:          req.ip,
            });
        }

        res.json({ sucesso: true, usuario: req.userSession.toPublic() });
    });

    /* ════════════════════════════════════════════════════════
       PREVIEW PORTAL DO ALUNO — visualização pelo admin
       Permite ao admin ver as atividades de qualquer aluno
       ou disciplina sem precisar de login Google.
    ════════════════════════════════════════════════════════ */

    /* GET /api/admin/portal-aluno/cursos — lista cursos do Classroom do professor */
    router.get('/admin/portal-aluno/cursos', async (_req, res) => {
        const auth = getTeacherAuth();
        if (!auth) return res.status(503).json({ erro: 'Google Classroom não conectado.' });

        try {
            const classroom = google.classroom({ version: 'v1', auth });
            let cursos = [], pageToken;
            do {
                const r = await classroom.courses.list({
                    courseStates: ['ACTIVE'],
                    teacherId:    'me',
                    pageSize:     100,
                    pageToken,
                });
                cursos.push(...(r.data.courses || []));
                pageToken = r.data.nextPageToken;
            } while (pageToken);

            res.json(cursos.map(c => ({ id: c.id, nome: c.name, secao: c.section || '' })));
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* GET /api/admin/portal-aluno/preview — atividades de um aluno
       Aceita ?email=xxx  OU  ?userId=xxx (Google Classroom userId) */
    router.get('/admin/portal-aluno/preview', async (req, res) => {
        const { email, userId } = req.query;
        const studentId = (email || userId || '').trim();
        if (!studentId) return res.status(400).json({ erro: 'email ou userId é obrigatório.' });

        const auth = getTeacherAuth();
        if (!auth) return res.status(503).json({ erro: 'Google Classroom não conectado.' });

        try {
            const classroom = google.classroom({ version: 'v1', auth });

            /* Busca em paralelo: cursos do professor e cursos do aluno */
            const [profResp, alunoResp] = await Promise.all([
                (async () => {
                    const cursos = []; let pt;
                    do {
                        const r = await classroom.courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken: pt });
                        cursos.push(...(r.data.courses || []));
                        pt = r.data.nextPageToken;
                    } while (pt);
                    return cursos;
                })(),
                (async () => {
                    const cursos = []; let pt;
                    do {
                        const r = await classroom.courses.list({ studentId, courseStates: ['ACTIVE'], pageSize: 50, pageToken: pt });
                        cursos.push(...(r.data.courses || []));
                        pt = r.data.nextPageToken;
                    } while (pt);
                    return cursos;
                })(),
            ]);

            /* Intersecção: só cursos onde o titular leciona E o aluno está matriculado */
            const profIds = new Set(profResp.map(c => c.id));
            const todosCursos = alunoResp.filter(c => profIds.has(c.id));

            if (!todosCursos.length) {
                return res.json({ email: studentId, cursos: [], totalPendentes: 0 });
            }

            const resultados = await Promise.all(todosCursos.map(async curso => {
                try {
                    const [subsPendResp, subsZerResp, subsAguardResp, cwResp] = await Promise.all([
                        classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',
                            userId:       studentId,
                            states:       ['NEW', 'CREATED', 'RECLAIMED_BY_STUDENT'],
                            pageSize:     100,
                        }),
                        classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',
                            userId:       studentId,
                            states:       ['RETURNED'],
                            pageSize:     100,
                        }),
                        classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     curso.id,
                            courseWorkId: '-',
                            userId:       studentId,
                            states:       ['TURNED_IN'],
                            pageSize:     100,
                        }),
                        classroom.courses.courseWork.list({
                            courseId:         curso.id,
                            courseWorkStates: ['PUBLISHED'],
                            orderBy:          'dueDate asc',
                            pageSize:         100,
                        }),
                    ]);

                    const cwMap = {};
                    (cwResp.data.courseWork || []).forEach(cw => { cwMap[cw.id] = cw; });

                    const mapAtiv = (sub, extra = {}) => {
                        const cw = cwMap[sub.courseWorkId];
                        if (!cw) return null;
                        const dueDate = cw.dueDate;
                        let prazo = null, prazoIso = null, vencida = false;
                        if (dueDate?.year) {
                            const d = String(dueDate.day).padStart(2, '0');
                            const m = String(dueDate.month).padStart(2, '0');
                            prazo    = `${d}/${m}/${dueDate.year}`;
                            prazoIso = `${dueDate.year}-${m}-${d}`;
                            vencida  = new Date(prazoIso) < new Date();
                        }
                        return {
                            id:        cw.id,
                            titulo:    cw.title,
                            tipo:      cw.workType || 'ASSIGNMENT',
                            prazo,
                            prazoIso,
                            vencida,
                            pontos:    cw.maxPoints ?? null,
                            link:      cw.alternateLink || '',
                            quizizzId: detectarQuizizzId(cw),
                            ...extra,
                        };
                    };

                    const sortPrazo = (a, b) => {
                        if (!a.prazoIso && !b.prazoIso) return 0;
                        if (!a.prazoIso) return 1;
                        if (!b.prazoIso) return -1;
                        return a.prazoIso.localeCompare(b.prazoIso);
                    };

                    const atividades = (subsPendResp.data.studentSubmissions || [])
                        .map(s => mapAtiv(s, { estado: s.state, devolvida: s.state === 'RECLAIMED_BY_STUDENT' }))
                        .filter(Boolean).sort(sortPrazo);

                    const zeradas = (subsZerResp.data.studentSubmissions || [])
                        .filter(s => (s.assignedGrade ?? null) === 0)
                        .map(s => mapAtiv(s))
                        .filter(Boolean).sort(sortPrazo);

                    const aguardando = (subsAguardResp.data.studentSubmissions || [])
                        .filter(s => s.assignedGrade == null && s.draftGrade == null)
                        .map(s => mapAtiv(s, { aguardando: true }))
                        .filter(Boolean).sort(sortPrazo);

                    if (!atividades.length && !zeradas.length && !aguardando.length) return null;

                    /* ── Anota grupo de cada atividade ── */
                    let temGrupos = false;
                    try {
                        const { rows: comGrupos } = await pool.query(
                            `SELECT 1 FROM classroom_grupos
                             WHERE curso_id = $1 AND tipo = 'normal' LIMIT 1`,
                            [String(curso.id)]
                        );
                        if (comGrupos.length > 0) {
                            temGrupos = true;
                            const todosIds = [
                                ...atividades.map(a => a.id),
                                ...zeradas.map(a => a.id),
                                ...aguardando.map(a => a.id),
                            ];
                            let grupoMap = {};
                            if (todosIds.length > 0) {
                                const { rows: gr } = await pool.query(
                                    `SELECT ga.atividade_id, g.id AS grupo_id, g.nome AS grupo_nome
                                     FROM classroom_grupo_atividades ga
                                     JOIN classroom_grupos g ON g.id = ga.grupo_id
                                     WHERE ga.atividade_id = ANY($1::text[])
                                       AND g.curso_id = $2 AND g.tipo = 'normal'`,
                                    [todosIds, String(curso.id)]
                                );
                                gr.forEach(r => { grupoMap[r.atividade_id] = { id: r.grupo_id, nome: r.grupo_nome }; });
                            }
                            [...atividades, ...zeradas, ...aguardando].forEach(a => {
                                const g = grupoMap[String(a.id)];
                                if (g) { a.grupoId = g.id; a.grupoNome = g.nome; }
                                a.emGrupo = !!g;
                            });
                        }
                    } catch (e) {
                        console.warn('[PREVIEW-GRUPOS]', e.message);
                    }

                    return {
                        cursoId:   curso.id,
                        nome:      curso.name,
                        secao:     curso.section || '',
                        temGrupos,
                        link:      curso.alternateLink || '',
                        atividades,
                        zeradas,
                        aguardando,
                    };
                } catch { return null; }
            }));

            const cursos = resultados.filter(Boolean);

            /* ── Notificações de prazo (mesma lógica do portal real) ── */
            const HORAS_2 = 2  * 60 * 60 * 1000;
            const DIAS_3  = 3  * 24 * 60 * 60 * 1000;
            const agora   = Date.now();
            const notificacoes = [];

            for (const curso of cursos) {
                const todasAtiv = [...(curso.atividades || []), ...(curso.zeradas || [])];
                for (const ativ of todasAtiv) {
                    if (!ativ.prazoIso || ativ.vencida) continue;
                    const limite = new Date(ativ.prazoIso).getTime();
                    const diffMs = limite - agora;
                    if (diffMs <= 0) continue;

                    if (diffMs < HORAS_2) {
                        const minutos = Math.ceil(diffMs / 60_000);
                        notificacoes.push({
                            tipo:    'prazo_proximo',
                            icone:   '⏰',
                            cor:     'laranja',
                            titulo:  'Prazo encerrando em breve!',
                            detalhe: `"${ativ.titulo}" fecha em ${minutos < 60 ? minutos + ' min' : '< 2 h'}.`,
                            link:    ativ.link || '',
                        });
                    } else if (diffMs <= DIAS_3) {
                        const dias = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                        notificacoes.push({
                            tipo:    'prazo_dias',
                            icone:   '📅',
                            cor:     'amarelo',
                            titulo:  dias === 1 ? 'Prazo encerra amanhã!' : `Prazo em ${dias} dias`,
                            detalhe: `"${ativ.titulo}" ${dias === 1 ? 'fecha amanhã' : `fecha em ${dias} dias`}.`,
                            link:    ativ.link || '',
                        });
                    }
                }
            }

            let solicitacoes = [];
            try {
                const { rows } = await pool.query(
                    `SELECT coursework_id, status, aluno_nome, criado_em, respondido_em, resposta
                     FROM reabertura_solicitacoes
                     WHERE aluno_email = $1
                     ORDER BY criado_em DESC`,
                    [studentId]
                );
                solicitacoes = rows;
            } catch (e) {
                console.warn('[PREVIEW-SOLICITACOES]', e.message);
            }

            res.json({
                email:           studentId,
                cursos,
                totalPendentes:  cursos.reduce((s, c) => s + c.atividades.length,  0),
                totalZeradas:    cursos.reduce((s, c) => s + c.zeradas.length,     0),
                totalAguardando: cursos.reduce((s, c) => s + c.aguardando.length,  0),
                notificacoes,
                solicitacoes,
            });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* GET /api/admin/portal-aluno/alunos?cursoId=xxx — lista alunos matriculados num curso */
    router.get('/admin/portal-aluno/alunos', async (req, res) => {
        const { cursoId } = req.query;
        if (!cursoId) return res.status(400).json({ erro: 'cursoId é obrigatório.' });

        const auth = getTeacherAuth();
        if (!auth) return res.status(503).json({ erro: 'Google Classroom não conectado.' });

        try {
            const classroom = google.classroom({ version: 'v1', auth });
            const alunos = [];
            let pageToken;
            do {
                const r = await classroom.courses.students.list({
                    courseId: cursoId,
                    pageSize: 200,
                    pageToken,
                });
                for (const s of (r.data.students || [])) {
                    alunos.push({
                        id:    s.userId,
                        nome:  s.profile?.name?.fullName  || s.userId,
                        email: s.profile?.emailAddress    || '',
                    });
                }
                pageToken = r.data.nextPageToken;
            } while (pageToken);

            alunos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
            res.json(alunos);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* GET /api/admin/portal-aluno/disciplina?cursoId=xxx — todos alunos pendentes numa disciplina */
    router.get('/admin/portal-aluno/disciplina', async (req, res) => {
        const { cursoId } = req.query;
        if (!cursoId) return res.status(400).json({ erro: 'cursoId é obrigatório.' });

        const auth = getTeacherAuth();
        if (!auth) return res.status(503).json({ erro: 'Google Classroom não conectado.' });

        try {
            const classroom = google.classroom({ version: 'v1', auth });

            /* Dados do curso + alunos + courseworks em paralelo */
            const [cursoResp, alunosResp, cwResp] = await Promise.all([
                classroom.courses.get({ id: cursoId }),
                classroom.courses.students.list({ courseId: cursoId, pageSize: 200 }),
                classroom.courses.courseWork.list({
                    courseId:         cursoId,
                    courseWorkStates: ['PUBLISHED'],
                    orderBy:          'dueDate asc',
                    pageSize:         100,
                }),
            ]);

            const curso    = cursoResp.data;
            const alunos   = alunosResp.data.students || [];
            const cwMap    = {};
            (cwResp.data.courseWork || []).forEach(cw => { cwMap[cw.id] = cw; });

            /* Buscar submissions de todos os alunos em paralelo (lotes de 10) */
            const LOTE = 10;
            const resultados = [];
            for (let i = 0; i < alunos.length; i += LOTE) {
                const lote = alunos.slice(i, i + LOTE);
                const loteRes = await Promise.all(lote.map(async aluno => {
                    const email = aluno.profile?.emailAddress || '';
                    const nome  = aluno.profile?.name?.fullName || email;
                    try {
                        const subsResp = await classroom.courses.courseWork.studentSubmissions.list({
                            courseId:     cursoId,
                            courseWorkId: '-',
                            userId:       aluno.userId,
                            states:       ['NEW', 'CREATED', 'RECLAIMED_BY_STUDENT'],
                            pageSize:     100,
                        });
                        const pendingSubs = subsResp.data.studentSubmissions || [];
                        if (!pendingSubs.length) return null;

                        const atividades = pendingSubs.map(sub => {
                            const cw = cwMap[sub.courseWorkId];
                            if (!cw) return null;
                            const dueDate = cw.dueDate;
                            let prazo = null, prazoIso = null, vencida = false;
                            if (dueDate?.year) {
                                const d = String(dueDate.day).padStart(2,'0');
                                const m = String(dueDate.month).padStart(2,'0');
                                prazo    = `${d}/${m}/${dueDate.year}`;
                                prazoIso = `${dueDate.year}-${m}-${d}`;
                                vencida  = new Date(prazoIso) < new Date();
                            }
                            return { id: cw.id, titulo: cw.title, tipo: cw.workType || 'ASSIGNMENT', prazo, prazoIso, vencida, pontos: cw.maxPoints ?? null, link: cw.alternateLink || '', estado: sub.state };
                        }).filter(Boolean);

                        if (!atividades.length) return null;
                        return { email, nome, atividades };
                    } catch { return null; }
                }));
                resultados.push(...loteRes);
            }

            const alunosPendentes = resultados.filter(Boolean)
                .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

            res.json({
                curso: { id: curso.id, nome: curso.name, secao: curso.section || '', link: curso.alternateLink || '' },
                alunos: alunosPendentes,
                totalAlunos: alunos.length,
                totalComPendencia: alunosPendentes.length,
            });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* GET /api/admin/portal-aluno/audit-log — log de sessões do Portal do Aluno */
    router.get('/admin/portal-aluno/audit-log', async (req, res) => {
        const limite = Math.min(parseInt(req.query.limite) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;
        const busca  = req.query.busca?.trim() || '';
        const acao   = req.query.acao?.trim()  || '';

        const params = ['portal_aluno'];
        let filtros  = `WHERE modulo = $1`;

        if (busca) {
            params.push(`%${busca}%`);
            filtros += ` AND (usuario_nome ILIKE $${params.length}
                          OR (detalhes->>'email') ILIKE $${params.length})`;
        }
        if (acao) {
            params.push(acao);
            filtros += ` AND acao = $${params.length}`;
        }

        params.push(limite, offset);

        try {
            const [{ rows }, { rows: total }] = await Promise.all([
                pool.query(
                    `SELECT id, usuario_nome, acao, detalhes, ip, criado_em
                     FROM edusync_audit_log
                     ${filtros}
                     ORDER BY criado_em DESC
                     LIMIT $${params.length - 1} OFFSET $${params.length}`,
                    params,
                ),
                pool.query(
                    `SELECT COUNT(*) AS total FROM edusync_audit_log ${filtros}`,
                    params.slice(0, params.length - 2),
                ),
            ]);

            res.json({ logs: rows, total: parseInt(total[0]?.total || 0) });
        } catch (e) {
            console.error('[ADMIN] Erro ao buscar portal audit log:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar logs.' });
        }
    });

    return router;
}
