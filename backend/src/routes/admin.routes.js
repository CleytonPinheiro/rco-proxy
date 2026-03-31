/**
 * Rotas de administração: gerenciamento de usuários e log de auditoria.
 * Acesso restrito ao perfil 'admin'.
 */
import { Router }          from 'express';
import pg                  from 'pg';
import { requireAuth, requirePerfil } from '../middleware/auth.middleware.js';
import { auditLogger }     from '../services/AuditLogger.js';
import { LISTA_PERFIS }    from '../config/permissions.js';

const { Pool } = pg;

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

        const planosValidos = ['classroom-individual', null];
        if (!planosValidos.includes(plano)) {
            return res.status(400).json({ erro: `Plano inválido. Valor aceito: classroom-individual ou null.` });
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

    return router;
}
