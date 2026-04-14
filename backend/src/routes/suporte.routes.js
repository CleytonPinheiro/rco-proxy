import { Router } from 'express';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export function createSuporteRouter() {
    const router = Router();

    router.get('/suporte/meus-tickets', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT id, tipo, assunto, mensagem, status, resposta, respondido_em, criado_em
                 FROM edusync_suporte
                 WHERE usuario_id = $1
                 ORDER BY criado_em DESC LIMIT 50`,
                [req.userSession.userId],
            );
            res.json(rows);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    router.get('/suporte/meu-plano', async (req, res) => {
        try {
            const planoInfo = req.userSession.planoInfo || {};
            const { rows } = await pool.query(
                `SELECT plano, plano_inicio, plano_renovacao FROM edusync_usuarios WHERE id = $1`,
                [req.userSession.userId],
            );
            const u = rows[0] || {};
            const { rows: historico } = await pool.query(
                `SELECT acao, plano_anterior, plano_novo, inicio_anterior, inicio_novo, admin_nome, obs, criado_em
                 FROM edusync_plano_historico
                 WHERE usuario_id = $1
                 ORDER BY criado_em DESC LIMIT 20`,
                [req.userSession.userId],
            );
            res.json({ ...planoInfo, plano_inicio: u.plano_inicio, plano_renovacao: u.plano_renovacao, historico });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    router.post('/suporte/ticket', async (req, res) => {
        const { tipo, assunto, mensagem } = req.body;
        const tiposValidos = ['extensao', 'duvida', 'bug', 'sugestao', 'outro'];
        if (!tiposValidos.includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
        if (!assunto || !assunto.trim()) return res.status(400).json({ erro: 'Assunto obrigatório.' });
        if (!mensagem || !mensagem.trim()) return res.status(400).json({ erro: 'Mensagem obrigatória.' });

        if (tipo === 'extensao') {
            const { rows: pendentes } = await pool.query(
                `SELECT id FROM edusync_suporte WHERE usuario_id = $1 AND tipo = 'extensao' AND status = 'pendente'`,
                [req.userSession.userId],
            );
            if (pendentes.length > 0) {
                return res.status(409).json({ erro: 'Você já tem uma solicitação de extensão pendente.' });
            }
        }

        try {
            const { rows } = await pool.query(
                `INSERT INTO edusync_suporte (usuario_id, usuario_nome, tipo, assunto, mensagem)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [req.userSession.userId, req.userSession.nome, tipo, assunto.trim(), mensagem.trim()],
            );
            res.status(201).json(rows[0]);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
