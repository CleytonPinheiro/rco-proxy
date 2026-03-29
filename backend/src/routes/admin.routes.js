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

export function createAdminRouter() {
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
                `SELECT id, nome, cpf, perfil, ativo, criado_em
                 FROM edusync_usuarios ORDER BY nome`,
            );
            res.json(rows);
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

    return router;
}
