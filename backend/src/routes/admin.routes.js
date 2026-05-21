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
import { LISTA_PERFIS, MODULOS_DISPONIVEIS, getMapaPermissoesEfetivas, setOverride, clearOverride, PERFIS, getModulosEmDesenvolvimento, setModulosEmDesenvolvimento, MODULO_PAI } from '../config/permissions.js';
import { getLoginQueueStats, setLoginConcurrency } from '../../auth-puppeteer.js';
import { userSessionStore }   from '../services/UserSessionStore.js';
import { getCpfRateLimitSnapshot, clearCpfRateLimit } from './auth.routes.js';

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

    /* ════════════════════════════════════════════════════════
       PERMISSÕES POR PERFIL — defaults + overrides editáveis
    ════════════════════════════════════════════════════════ */
    router.get('/admin/permissoes', async (_req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT perfil, modulos, atualizado_em FROM edusync_perfis_overrides`
            );
            const overridesMap = {};
            for (const r of rows) overridesMap[r.perfil] = { modulos: r.modulos, atualizadoEm: r.atualizado_em };

            const perfis = Object.entries(PERFIS).map(([id, cfg]) => ({
                id,
                nome: cfg.nome,
                modulosDefault: cfg.modulos,
                modulosEfetivos: getMapaPermissoesEfetivas()[id] || cfg.modulos,
                customizado: !!overridesMap[id],
                atualizadoEm: overridesMap[id]?.atualizadoEm || null,
            }));

            res.json({
                perfis,
                modulos: MODULOS_DISPONIVEIS,
                modulosEmDesenvolvimento: getModulosEmDesenvolvimento(),
                modulosPai: MODULO_PAI,
            });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Define a lista de módulos "em desenvolvimento". Body: { modulos: [...] } */
    router.put('/admin/permissoes/em-desenvolvimento', async (req, res) => {
        const { modulos } = req.body || {};
        if (!Array.isArray(modulos)) {
            return res.status(400).json({ erro: 'modulos deve ser um array.' });
        }
        const idsValidos = new Set(MODULOS_DISPONIVEIS.map(m => m.id));
        const limpos = [...new Set(modulos.filter(m => idsValidos.has(m)))];
        try {
            await pool.query(
                `INSERT INTO edusync_config (chave, valor, obs)
                 VALUES ('modulos_em_desenvolvimento', $1, 'Módulos exibidos como em desenvolvimento')
                 ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                [JSON.stringify(limpos)]
            );
            setModulosEmDesenvolvimento(limpos);

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'MODULOS_EM_DESENVOLVIMENTO_ATUALIZADOS',
                modulo:      'admin',
                detalhes:    { modulos: limpos },
                ip:          req.ip,
            });
            res.json({ sucesso: true, modulos: limpos });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Atualiza módulos permitidos para um perfil. Body: { modulos: ['dashboard',...] } */
    router.put('/admin/permissoes/:perfil', async (req, res) => {
        const perfil = req.params.perfil;
        const { modulos } = req.body || {};

        if (!PERFIS[perfil]) {
            return res.status(400).json({ erro: 'Perfil desconhecido.' });
        }
        if (perfil === 'admin') {
            return res.status(400).json({ erro: 'O perfil admin tem acesso total e não pode ser editado.' });
        }
        if (!Array.isArray(modulos)) {
            return res.status(400).json({ erro: 'modulos deve ser um array.' });
        }

        const idsValidos = new Set(MODULOS_DISPONIVEIS.map(m => m.id));
        const limpos = [...new Set(modulos.filter(m => idsValidos.has(m)))];

        /* Defesa: se algum filho está marcado mas o pai não, inclui o pai
           automaticamente. Isso garante consistência mesmo se a UI falhar. */
        const setLimpos = new Set(limpos);
        for (const filho of limpos) {
            const pai = MODULO_PAI[filho];
            if (pai && !setLimpos.has(pai) && idsValidos.has(pai)) {
                setLimpos.add(pai);
            }
        }
        const limposComPais = [...setLimpos];

        try {
            await pool.query(
                `INSERT INTO edusync_perfis_overrides (perfil, modulos, atualizado_em, atualizado_por)
                 VALUES ($1, $2::jsonb, now(), $3)
                 ON CONFLICT (perfil) DO UPDATE
                 SET modulos = EXCLUDED.modulos,
                     atualizado_em = now(),
                     atualizado_por = EXCLUDED.atualizado_por`,
                [perfil, JSON.stringify(limposComPais), req.userSession.userId]
            );
            setOverride(perfil, limposComPais);

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'PERMISSOES_PERFIL_ATUALIZADAS',
                modulo:      'admin',
                detalhes:    { perfil, modulos: limposComPais },
                ip:          req.ip,
            });

            res.json({ sucesso: true, perfil, modulos: limposComPais });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Restaura defaults de um perfil (remove override). */
    router.delete('/admin/permissoes/:perfil', async (req, res) => {
        const perfil = req.params.perfil;
        if (!PERFIS[perfil]) return res.status(400).json({ erro: 'Perfil desconhecido.' });
        if (perfil === 'admin')  return res.status(400).json({ erro: 'admin não tem override.' });

        try {
            await pool.query(`DELETE FROM edusync_perfis_overrides WHERE perfil = $1`, [perfil]);
            clearOverride(perfil);

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'PERMISSOES_PERFIL_RESTAURADAS',
                modulo:      'admin',
                detalhes:    { perfil },
                ip:          req.ip,
            });

            res.json({ sucesso: true, perfil, modulos: PERFIS[perfil].modulos });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
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
            const { rows: [anterior] } = await pool.query(
                `SELECT plano, plano_inicio FROM edusync_usuarios WHERE id = $1`, [id],
            );

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

            let acao = 'PLANO_ALTERADO';
            if (anterior) {
                if (anterior.plano === plano && anterior.plano_inicio !== plano_inicio) acao = 'PLANO_ESTENDIDO';
                else if (!anterior.plano && plano) acao = 'PLANO_ATIVADO';
                else if (anterior.plano && !plano) acao = 'PLANO_REMOVIDO';
            }

            await pool.query(
                `INSERT INTO edusync_plano_historico
                    (usuario_id, acao, plano_anterior, plano_novo, inicio_anterior, inicio_novo, admin_id, admin_nome, obs)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [id, acao, anterior?.plano ?? null, plano ?? null,
                 anterior?.plano_inicio ?? null, plano_inicio ?? null,
                 req.userSession.userId, req.userSession.nome, plano_obs ?? null],
            );

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'USUARIO_PLANO_ALTERADO',
                modulo:      'admin',
                detalhes:    { usuarioId: id, planoNovo: plano, acaoPlano: acao },
                ip:          req.ip,
            });

            res.json(rows[0]);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Histórico de alterações de plano de um usuário ── */
    router.get('/admin/usuarios/:id/plano-historico', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM edusync_plano_historico WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 50`,
                [req.params.id],
            );
            res.json(rows);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Listar tickets de suporte (admin) ── */
    router.get('/admin/suporte', async (req, res) => {
        const { status } = req.query;
        try {
            let q = `SELECT * FROM edusync_suporte`;
            const params = [];
            if (status) {
                q += ` WHERE status = $1`;
                params.push(status);
            }
            q += ` ORDER BY criado_em DESC LIMIT 100`;
            const { rows } = await pool.query(q, params);
            res.json(rows);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Badge de tickets pendentes ── */
    router.get('/admin/suporte/badge', async (req, res) => {
        try {
            const { rows: [{ count }] } = await pool.query(
                `SELECT COUNT(*)::int AS count FROM edusync_suporte WHERE status = 'pendente'`,
            );
            res.json({ pendentes: count });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Responder ticket de suporte (admin) ── */
    router.post('/admin/suporte/:id/responder', async (req, res) => {
        const { acao, resposta } = req.body;
        if (!['resolvido', 'negado'].includes(acao)) return res.status(400).json({ erro: 'Ação inválida.' });
        try {
            const { rows } = await pool.query(
                `UPDATE edusync_suporte
                    SET status = $1, resposta = $2, respondido_por = $3, respondido_em = NOW()
                  WHERE id = $4
                  RETURNING *`,
                [acao, resposta || null, req.userSession.userId, req.params.id],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Ticket não encontrado.' });

            if (rows[0].tipo === 'extensao' && acao === 'resolvido') {
                const uid = rows[0].usuario_id;
                const { rows: [user] } = await pool.query(
                    `SELECT plano, plano_inicio FROM edusync_usuarios WHERE id = $1`, [uid],
                );
                if (user && user.plano === 'trial' && user.plano_inicio) {
                    const novaData = new Date(user.plano_inicio);
                    novaData.setDate(novaData.getDate() + 30);
                    await pool.query(
                        `UPDATE edusync_usuarios SET plano_inicio = $1 WHERE id = $2`,
                        [novaData.toISOString().slice(0, 10), uid],
                    );
                    await pool.query(
                        `INSERT INTO edusync_plano_historico
                            (usuario_id, acao, plano_anterior, plano_novo, inicio_anterior, inicio_novo, admin_id, admin_nome, obs)
                         VALUES ($1, 'EXTENSAO_APROVADA', $2, $2, $3, $4, $5, $6, $7)`,
                        [uid, user.plano, user.plano_inicio, novaData.toISOString().slice(0, 10),
                         req.userSession.userId, req.userSession.nome, `Solicitação #${req.params.id} aprovada`],
                    );
                }
            }

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
       CONFIGURAÇÕES DO SISTEMA
    ════════════════════════════════════════════════════════ */

    router.get('/admin/config', async (req, res) => {
        try {
            const { rows } = await pool.query(`SELECT chave, valor, obs FROM edusync_config ORDER BY chave`);
            res.json(rows);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    const CONFIG_NUMERIC_RULES = {
        badge_poll_minutos:           { min: 1,   max: 60,   integer: true,  label: 'Intervalo do badge de provas (badge_poll_minutos)' },
        rco_sync_ttl_hours:           { min: 0.5, max: 168,  integer: false, label: 'TTL de sync RCO (rco_sync_ttl_hours)' },
        puppeteer_protocol_timeout:   { min: 5000, max: 600000, integer: true, label: 'Timeout de protocolo Puppeteer (puppeteer_protocol_timeout)' },
        purga_intervalo_horas:        { min: 1,   max: 168,  integer: true,  label: 'Intervalo de purga (purga_intervalo_horas)' },
        purga_audit_dias:             { min: 1,   max: 3650, integer: true,  label: 'Retenção do audit log (purga_audit_dias)' },
        purga_reputacao_dias:         { min: 1,   max: 3650, integer: true,  label: 'Retenção do log de reputação (purga_reputacao_dias)' },
        purga_notif_lida_dias:        { min: 1,   max: 3650, integer: true,  label: 'Retenção de notificações lidas (purga_notif_lida_dias)' },
        purga_notif_nlida_dias:       { min: 1,   max: 3650, integer: true,  label: 'Retenção de notificações não-lidas (purga_notif_nlida_dias)' },
        purga_lote:                   { min: 1,   max: 10000,integer: true,  label: 'Tamanho do lote de purga (purga_lote)' },
        sync_stale_alert_days:        { min: 1,   max: 365,  integer: true,  label: 'Dias para alerta de sync parado (sync_stale_alert_days)' },
        sync_stale_alert_interval_horas: { min: 1, max: 168, integer: true, label: 'Intervalo de verificação de sync parado (sync_stale_alert_interval_horas)' },
    };

    router.patch('/admin/config/:chave', async (req, res) => {
        const { chave } = req.params;
        const { valor } = req.body;
        if (valor === undefined) return res.status(400).json({ erro: 'valor obrigatório.' });
        if (chave === 'escola_logo_base64') {
            const MAX_LOGO_B64_CHARS = Math.ceil(50 * 1024 * (4 / 3));
            if (String(valor).length > MAX_LOGO_B64_CHARS) {
                return res.status(400).json({ erro: `Logo demasiado grande. Máximo ${Math.round(50)}KB após compressão.` });
            }
        }
        const numRule = CONFIG_NUMERIC_RULES[chave];
        if (numRule) {
            const parsed = numRule.integer ? parseInt(valor, 10) : parseFloat(valor);
            const typeOk = numRule.integer ? Number.isInteger(parsed) : Number.isFinite(parsed);
            if (!typeOk || parsed < numRule.min || parsed > numRule.max) {
                const typeLabel = numRule.integer ? 'inteiro' : 'número';
                return res.status(400).json({
                    erro: `${numRule.label}: deve ser um ${typeLabel} entre ${numRule.min} e ${numRule.max}.`,
                });
            }
        }
        try {
            const { rows } = await pool.query(
                `INSERT INTO edusync_config (chave, valor) VALUES ($2, $1)
                 ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
                 RETURNING *`,
                [String(valor), chave],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Configuração não encontrada.' });

            await auditLogger.registrar({
                usuarioId: req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao: 'CONFIG_ALTERADA',
                modulo: 'admin',
                detalhes: { chave, valor },
                ip: req.ip,
            });

            res.json(rows[0]);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ════════════════════════════════════════════════════════
       EXPORTAR / IMPORTAR CONFIGURAÇÃO
    ════════════════════════════════════════════════════════ */

    router.get('/admin/export-config', async (req, res) => {
        try {
            const { rows: grupos } = await pool.query(
                `SELECT id, curso_id, nome, pontos_meta, cor, cod_classe_rco,
                        tipo, trimestre, ano, grupo_pai_id, grupo_origem_id,
                        data_inicio, data_fechamento, lancado_livro, lancado_em
                 FROM classroom_grupos ORDER BY (grupo_pai_id IS NOT NULL), id`
            );
            const { rows: grupoFontes } = await pool.query(
                `SELECT grupo_id, fonte_grupo_id, peso FROM classroom_grupo_fontes ORDER BY id`
            );
            const { rows: grupoAtividades } = await pool.query(`SELECT grupo_id, atividade_id, atividade_titulo, pontos_max, due_date_original FROM classroom_grupo_atividades ORDER BY id`);
            const { rows: ausencias } = await pool.query(`SELECT curso_id, atividade_id, user_id, nome_aluno, data_atividade, cod_classe FROM classroom_ausencias ORDER BY id`);
            const { rows: tardias } = await pool.query(`SELECT grupo_id, curso_id, atividade_id, atividade_titulo, user_id, nome_aluno, email_aluno, data_entrega, data_fechamento, nota, estado FROM classroom_entregas_tardias ORDER BY id`);
            const { rows: configs } = await pool.query(`SELECT chave, valor, obs FROM edusync_config ORDER BY chave`);
            const { rows: acessosPedagogo } = await pool.query(`SELECT professor_cpf, pedagogo_email FROM classroom_acesso_pedagogo ORDER BY id`);
            const { rows: mapas } = await pool.query(
                `SELECT codturma, turma, colunas, filas, posicoes, alunos_fora, alunos_excluidos FROM mapa_sala ORDER BY codturma`
            );
            const { rows: livros } = await pool.query(
                `SELECT id, titulo, autor, editora, ano_publicacao, disciplina, serie, isbn, quantidade, ativo FROM livros_didaticos ORDER BY id`
            );
            const { rows: emprestimos } = await pool.query(
                `SELECT livro_id, cod_matriz_aluno, nome_aluno, turma, num_chamada, ano_letivo, status, data_emprestimo, data_devolucao, obs FROM livros_emprestimos ORDER BY id`
            );
            const { rows: overrides } = await pool.query(
                `SELECT perfil, modulos FROM edusync_perfis_overrides ORDER BY perfil`
            );
            const { rows: comunicados } = await pool.query(
                `SELECT aluno_id, nome_aluno, turma, registro, responsavel, data_inicio, data_fim, motivo, gerado_por_id, gerado_por_nome, emitido_em FROM edusync_comunicados_suspensao ORDER BY id`
            );

            const exportData = {
                versao: 1,
                exportadoEm: new Date().toISOString(),
                classroom_grupos: grupos,
                classroom_grupo_fontes: grupoFontes,
                classroom_grupo_atividades: grupoAtividades,
                classroom_ausencias: ausencias,
                classroom_entregas_tardias: tardias,
                edusync_config: configs,
                classroom_acesso_pedagogo: acessosPedagogo,
                mapa_sala: mapas,
                livros_didaticos: livros,
                livros_emprestimos: emprestimos,
                edusync_perfis_overrides: overrides,
                edusync_comunicados_suspensao: comunicados,
            };

            res.setHeader('Content-Disposition', `attachment; filename="edusync-config-${new Date().toISOString().slice(0, 10)}.json"`);
            res.json(exportData);
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    router.post('/admin/import-config', async (req, res) => {
        const data = req.body;
        if (!data || !data.versao) return res.status(400).json({ erro: 'JSON inválido — campo "versao" ausente.' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const resultado = { grupos: 0, fontes: 0, atividades: 0, ausencias: 0, tardias: 0, configs: 0, acessos: 0, mapas: 0, livros: 0, emprestimos: 0, overrides: 0, comunicados: 0 };

            if (data.classroom_grupos?.length) {
                const idMap = {};

                const gruposOrdenados = [...data.classroom_grupos].sort((a, b) => {
                    const aPai = a.grupo_pai_id ? 1 : 0;
                    const bPai = b.grupo_pai_id ? 1 : 0;
                    return aPai - bPai;
                });

                for (const g of gruposOrdenados) {
                    const novoPaiId = g.grupo_pai_id ? (idMap[g.grupo_pai_id] || null) : null;
                    const { rows } = await client.query(
                        `INSERT INTO classroom_grupos
                            (curso_id, nome, pontos_meta, cor, cod_classe_rco,
                             tipo, trimestre, ano, grupo_pai_id,
                             data_inicio, data_fechamento, lancado_livro, lancado_em)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                         ON CONFLICT DO NOTHING
                         RETURNING id`,
                        [
                            g.curso_id, g.nome, g.pontos_meta || 40, g.cor || '#4285F4', g.cod_classe_rco || null,
                            g.tipo || 'normal', g.trimestre || null, g.ano || null, novoPaiId,
                            g.data_inicio || null, g.data_fechamento || null,
                            g.lancado_livro ?? false, g.lancado_em || null,
                        ]
                    );
                    if (rows.length) {
                        idMap[g.id] = rows[0].id;
                        resultado.grupos++;
                    } else {
                        const { rows: existing } = await client.query(
                            `SELECT id FROM classroom_grupos WHERE curso_id = $1 AND nome = $2`,
                            [g.curso_id, g.nome]
                        );
                        if (existing.length) idMap[g.id] = existing[0].id;
                    }
                }

                for (const g of gruposOrdenados) {
                    if (!g.grupo_origem_id) continue;
                    const newId = idMap[g.id];
                    const newOrigemId = idMap[g.grupo_origem_id] || null;
                    if (!newId || !newOrigemId) continue;
                    await client.query(
                        `UPDATE classroom_grupos SET grupo_origem_id = $1 WHERE id = $2`,
                        [newOrigemId, newId]
                    );
                }

                if (data.classroom_grupo_fontes?.length) {
                    for (const f of data.classroom_grupo_fontes) {
                        const newGrupoId = idMap[f.grupo_id];
                        const newFonteId = idMap[f.fonte_grupo_id];
                        if (!newGrupoId || !newFonteId) continue;
                        await client.query(
                            `INSERT INTO classroom_grupo_fontes (grupo_id, fonte_grupo_id, peso)
                             VALUES ($1, $2, $3)
                             ON CONFLICT (grupo_id, fonte_grupo_id) DO NOTHING`,
                            [newGrupoId, newFonteId, f.peso ?? 100]
                        );
                        resultado.fontes++;
                    }
                }

                if (data.classroom_grupo_atividades?.length) {
                    for (const a of data.classroom_grupo_atividades) {
                        const newGrupoId = idMap[a.grupo_id];
                        if (!newGrupoId) continue;
                        await client.query(
                            `INSERT INTO classroom_grupo_atividades (grupo_id, atividade_id, atividade_titulo, pontos_max, due_date_original)
                             VALUES ($1, $2, $3, $4, $5)
                             ON CONFLICT (grupo_id, atividade_id) DO NOTHING`,
                            [newGrupoId, a.atividade_id, a.atividade_titulo || '', a.pontos_max, a.due_date_original || null]
                        );
                        resultado.atividades++;
                    }
                }

                if (data.classroom_entregas_tardias?.length) {
                    for (const t of data.classroom_entregas_tardias) {
                        const newGrupoId = idMap[t.grupo_id];
                        if (!newGrupoId) continue;
                        await client.query(
                            `INSERT INTO classroom_entregas_tardias (grupo_id, curso_id, atividade_id, atividade_titulo, user_id, nome_aluno, email_aluno, data_entrega, data_fechamento, nota, estado)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                             ON CONFLICT (grupo_id, atividade_id, user_id) DO NOTHING`,
                            [newGrupoId, t.curso_id, t.atividade_id, t.atividade_titulo, t.user_id, t.nome_aluno, t.email_aluno, t.data_entrega, t.data_fechamento, t.nota, t.estado]
                        );
                        resultado.tardias++;
                    }
                }
            }

            if (data.classroom_ausencias?.length) {
                for (const a of data.classroom_ausencias) {
                    await client.query(
                        `INSERT INTO classroom_ausencias (curso_id, atividade_id, user_id, nome_aluno, data_atividade, cod_classe)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (curso_id, atividade_id, user_id) DO NOTHING`,
                        [a.curso_id, a.atividade_id, a.user_id, a.nome_aluno, a.data_atividade, a.cod_classe]
                    );
                    resultado.ausencias++;
                }
            }

            if (data.edusync_config?.length) {
                for (const c of data.edusync_config) {
                    await client.query(
                        `INSERT INTO edusync_config (chave, valor, obs) VALUES ($1, $2, $3)
                         ON CONFLICT (chave) DO UPDATE SET valor = $2`,
                        [c.chave, c.valor, c.obs || '']
                    );
                    resultado.configs++;
                }
            }

            if (data.classroom_acesso_pedagogo?.length) {
                for (const a of data.classroom_acesso_pedagogo) {
                    await client.query(
                        `INSERT INTO classroom_acesso_pedagogo (professor_cpf, pedagogo_email) VALUES ($1, $2)
                         ON CONFLICT DO NOTHING`,
                        [a.professor_cpf, a.pedagogo_email]
                    );
                    resultado.acessos++;
                }
            }

            if (data.mapa_sala?.length) {
                for (const m of data.mapa_sala) {
                    await client.query(
                        `INSERT INTO mapa_sala (codturma, turma, colunas, filas, posicoes, alunos_fora, alunos_excluidos, atualizado_em)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                         ON CONFLICT (codturma) DO UPDATE SET
                             turma            = EXCLUDED.turma,
                             colunas          = EXCLUDED.colunas,
                             filas            = EXCLUDED.filas,
                             posicoes         = EXCLUDED.posicoes,
                             alunos_fora      = EXCLUDED.alunos_fora,
                             alunos_excluidos = EXCLUDED.alunos_excluidos,
                             atualizado_em    = NOW()`,
                        [
                            m.codturma, m.turma, m.colunas || 5, m.filas || 6,
                            JSON.stringify(m.posicoes || []),
                            JSON.stringify(m.alunos_fora || []),
                            JSON.stringify(m.alunos_excluidos || []),
                        ]
                    );
                    resultado.mapas++;
                }
            }

            if (data.livros_didaticos?.length) {
                const livroIdMap = {};
                for (const l of data.livros_didaticos) {
                    const { rows } = await client.query(
                        `INSERT INTO livros_didaticos (titulo, autor, editora, ano_publicacao, disciplina, serie, isbn, quantidade, ativo)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                         ON CONFLICT DO NOTHING
                         RETURNING id`,
                        [l.titulo, l.autor || null, l.editora || null, l.ano_publicacao || null,
                         l.disciplina || null, l.serie || null, l.isbn || null,
                         l.quantidade || 1, l.ativo ?? true]
                    );
                    if (rows.length) {
                        livroIdMap[l.id] = rows[0].id;
                        resultado.livros++;
                    }
                }

                if (data.livros_emprestimos?.length) {
                    for (const e of data.livros_emprestimos) {
                        const newLivroId = livroIdMap[e.livro_id];
                        if (!newLivroId) continue;
                        await client.query(
                            `INSERT INTO livros_emprestimos (livro_id, cod_matriz_aluno, nome_aluno, turma, num_chamada, ano_letivo, status, data_emprestimo, data_devolucao, obs)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                             ON CONFLICT DO NOTHING`,
                            [newLivroId, e.cod_matriz_aluno, e.nome_aluno || null, e.turma || null,
                             e.num_chamada || null, e.ano_letivo, e.status || 'emprestado',
                             e.data_emprestimo || null, e.data_devolucao || null, e.obs || null]
                        );
                        resultado.emprestimos++;
                    }
                }
            }

            if (data.edusync_perfis_overrides?.length) {
                const { setOverrides: syncOverrides } = await import('../config/permissions.js');
                const overrideMap = {};
                for (const o of data.edusync_perfis_overrides) {
                    await client.query(
                        `INSERT INTO edusync_perfis_overrides (perfil, modulos)
                         VALUES ($1, $2)
                         ON CONFLICT (perfil) DO UPDATE SET modulos = EXCLUDED.modulos, atualizado_em = NOW()`,
                        [o.perfil, JSON.stringify(o.modulos)]
                    );
                    overrideMap[o.perfil] = o.modulos;
                    resultado.overrides++;
                }
                const { rows: allOverrides } = await client.query(`SELECT perfil, modulos FROM edusync_perfis_overrides`);
                const fullMap = {};
                for (const r of allOverrides) fullMap[r.perfil] = r.modulos;
                syncOverrides(fullMap);
            }

            if (data.edusync_comunicados_suspensao?.length) {
                const { rows: countRows } = await client.query(`SELECT COUNT(*) AS c FROM edusync_comunicados_suspensao`);
                if (parseInt(countRows[0].c) === 0) {
                    for (const c of data.edusync_comunicados_suspensao) {
                        await client.query(
                            `INSERT INTO edusync_comunicados_suspensao
                                (aluno_id, nome_aluno, turma, registro, responsavel, data_inicio, data_fim, motivo, gerado_por_id, gerado_por_nome, emitido_em)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                            [c.aluno_id || null, c.nome_aluno, c.turma || null, c.registro || null,
                             c.responsavel, c.data_inicio, c.data_fim, c.motivo || null,
                             c.gerado_por_id || null, c.gerado_por_nome || null, c.emitido_em || null]
                        );
                        resultado.comunicados++;
                    }
                }
            }

            await client.query('COMMIT');

            await auditLogger.registrar({
                usuarioId: req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao: 'CONFIG_IMPORTADA',
                modulo: 'admin',
                detalhes: resultado,
                ip: req.ip,
            });

            res.json({ ok: true, resultado });
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ erro: e.message });
        } finally {
            client.release();
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
                                    `SELECT ga.atividade_id, g.id AS grupo_id, g.nome AS grupo_nome, g.data_fechamento, g.trimestre, g.ano
                                     FROM classroom_grupo_atividades ga
                                     JOIN classroom_grupos g ON g.id = ga.grupo_id
                                     WHERE ga.atividade_id = ANY($1::text[])
                                       AND g.curso_id = $2 AND g.tipo = 'normal'`,
                                    [todosIds, String(curso.id)]
                                );
                                gr.forEach(r => {
                                    grupoMap[r.atividade_id] = {
                                        id: r.grupo_id,
                                        nome: r.grupo_nome,
                                        fechado: !!r.data_fechamento,
                                        dataFechamento: r.data_fechamento ? r.data_fechamento.toISOString() : null,
                                        trimestre: r.trimestre ?? null,
                                        ano: r.ano ?? null,
                                    };
                                });
                            }
                            [...atividades, ...zeradas, ...aguardando].forEach(a => {
                                const g = grupoMap[String(a.id)];
                                if (g) {
                                    a.grupoId = g.id;
                                    a.grupoNome = g.nome;
                                    a.grupoFechado = g.fechado;
                                    a.grupoDataFechamento = g.dataFechamento;
                                    a.grupoTrimestre = g.trimestre;
                                    a.grupoAno = g.ano;
                                }
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

    /* GET /api/admin/portal-aluno/buscar-userId-por-nome?nome=xxx
       Procura o userId do Classroom pelo nome completo do aluno.
       Varre todos os cursos ativos do professor em paralelo. */
    router.get('/admin/portal-aluno/buscar-userId-por-nome', async (req, res) => {
        const nome = (req.query.nome || '').trim();
        if (!nome) return res.status(400).json({ erro: 'nome é obrigatório.' });

        const auth = getTeacherAuth();
        if (!auth) return res.status(503).json({ erro: 'Google Classroom não conectado.' });

        /* Normaliza string para comparação: minúsculo, sem acento, sem espaço duplo */
        const norm = s => String(s || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ').trim();
        const nomeProcurado = norm(nome);

        try {
            const classroom = google.classroom({ version: 'v1', auth });

            /* Lista cursos do professor */
            const cursos = [];
            let pt;
            do {
                const r = await classroom.courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken: pt });
                cursos.push(...(r.data.courses || []));
                pt = r.data.nextPageToken;
            } while (pt);

            /* Varre alunos de cada curso em paralelo */
            const resultados = await Promise.all(cursos.map(async curso => {
                try {
                    const alunos = [];
                    let pt2;
                    do {
                        const r = await classroom.courses.students.list({ courseId: curso.id, pageSize: 200, pageToken: pt2 });
                        for (const s of (r.data.students || [])) {
                            alunos.push({
                                userId: s.userId,
                                nome:   s.profile?.name?.fullName || '',
                                email:  s.profile?.emailAddress   || '',
                            });
                        }
                        pt2 = r.data.nextPageToken;
                    } while (pt2);
                    return alunos;
                } catch { return []; }
            }));

            /* Achata e deduplicar por userId */
            const vistos  = new Set();
            const todos   = resultados.flat().filter(a => {
                if (vistos.has(a.userId)) return false;
                vistos.add(a.userId);
                return true;
            });

            /* Tenta match exato primeiro, depois parcial */
            let match = todos.find(a => norm(a.nome) === nomeProcurado);
            if (!match) match = todos.find(a => norm(a.nome).includes(nomeProcurado) || nomeProcurado.includes(norm(a.nome)));

            if (!match) return res.status(404).json({ erro: 'Aluno não encontrado no Google Classroom.' });

            res.json({ userId: match.userId, email: match.email, nome: match.nome });
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

    /* ── Comunicados de Suspensão ── */

    /* POST /api/admin/comunicados-suspensao — salvar registro ao gerar PDF */
    router.post('/admin/comunicados-suspensao', async (req, res) => {
        const { aluno_id, nome_aluno, turma, registro, responsavel, data_inicio, data_fim, motivo } = req.body;

        if (!nome_aluno || !responsavel || !data_inicio || !data_fim) {
            return res.status(400).json({ erro: 'Campos obrigatórios: nome_aluno, responsavel, data_inicio, data_fim.' });
        }

        try {
            const { rows } = await pool.query(
                `INSERT INTO edusync_comunicados_suspensao
                    (aluno_id, nome_aluno, turma, registro, responsavel, data_inicio, data_fim, motivo, gerado_por_id, gerado_por_nome)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING *`,
                [
                    aluno_id   || null,
                    nome_aluno,
                    turma      || null,
                    registro   || null,
                    responsavel,
                    data_inicio,
                    data_fim,
                    motivo     || null,
                    req.userSession.userId,
                    req.userSession.nome,
                ],
            );
            res.status(201).json(rows[0]);
        } catch (e) {
            console.error('[ADMIN] Erro ao salvar comunicado de suspensão:', e.message);
            res.status(500).json({ erro: 'Erro interno ao salvar comunicado.' });
        }
    });

    /* GET /api/admin/comunicados-suspensao — listar histórico */
    router.get('/admin/comunicados-suspensao', async (req, res) => {
        const limite  = Math.min(parseInt(req.query.limite) || 50, 200);
        const offset  = parseInt(req.query.offset) || 0;
        const alunoId = req.query.aluno_id ? parseInt(req.query.aluno_id) : null;
        const busca   = req.query.busca?.trim() || '';

        const params  = [];
        const filtros = [];

        if (alunoId) {
            params.push(alunoId);
            filtros.push(`aluno_id = $${params.length}`);
        }
        if (busca) {
            params.push(`%${busca}%`);
            filtros.push(`nome_aluno ILIKE $${params.length}`);
        }

        const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

        params.push(limite, offset);

        try {
            const [{ rows }, { rows: total }] = await Promise.all([
                pool.query(
                    `SELECT * FROM edusync_comunicados_suspensao
                     ${where}
                     ORDER BY emitido_em DESC
                     LIMIT $${params.length - 1} OFFSET $${params.length}`,
                    params,
                ),
                pool.query(
                    `SELECT COUNT(*) AS total FROM edusync_comunicados_suspensao ${where}`,
                    params.slice(0, params.length - 2),
                ),
            ]);
            res.json({ comunicados: rows, total: parseInt(total[0]?.total || 0) });
        } catch (e) {
            console.error('[ADMIN] Erro ao buscar comunicados de suspensão:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar comunicados.' });
        }
    });

    /* ── Cache de sincronização RCO → Supabase ── */
    router.get('/admin/sync-cache-stats', async (_req, res) => {
        try {
            const [cacheResult, ttlResult] = await Promise.all([
                pool.query(`
                    SELECT
                        u.id,
                        u.nome,
                        u.email,
                        c.ultimo_sync,
                        c.puladas,
                        c.executadas
                    FROM edusync_sync_cache c
                    JOIN edusync_usuarios u ON u.id = c.usuario_id
                    ORDER BY c.executadas DESC, u.nome
                `),
                pool.query(`SELECT valor FROM edusync_config WHERE chave = 'rco_sync_ttl_hours'`),
            ]);

            const rows = cacheResult.rows;

            const ttlEnvHoras = (parseInt(process.env.RCO_SYNC_TTL_HOURS ?? '4', 10) || 4);
            let ttlHoras = ttlEnvHoras;
            if (ttlResult.rows.length) {
                const parsed = parseFloat(ttlResult.rows[0].valor);
                if (Number.isFinite(parsed) && parsed > 0) ttlHoras = parsed;
            }

            const totalPuladas    = rows.reduce((s, r) => s + (r.puladas    || 0), 0);
            const totalExecutadas = rows.reduce((s, r) => s + (r.executadas || 0), 0);

            res.json({
                usuarios: rows,
                totais: { puladas: totalPuladas, executadas: totalExecutadas },
                ttlHoras,
            });
        } catch (e) {
            console.error('[ADMIN] Erro ao buscar sync-cache-stats:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar estatísticas de cache.' });
        }
    });

    /* ── Executar purga manualmente (admin) ── */
    router.post('/admin/purga/executar', async (req, res) => {
        try {
            const { tryExecutarPurga } = await import('../services/purgeJob.js');
            const outcome = await tryExecutarPurga(pool);
            if (!outcome.ok) {
                return res.status(409).json({ erro: outcome.motivo });
            }

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'PURGA_MANUAL_EXECUTADA',
                modulo:      'admin',
                detalhes:    outcome.resultado,
                ip:          req.ip,
            }).catch(() => {});

            res.json({ ok: true, resultado: outcome.resultado });
        } catch (e) {
            console.error('[ADMIN] Erro ao executar purga manual:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Histórico de purga de dados ── */
    router.get('/admin/purga/historico', async (_req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT id, iniciado_em, dur_ms,
                       audit_log, reputacao_log, notif_lidas, notif_nlidas,
                       politica_audit, politica_reputacao,
                       politica_notif_lida, politica_notif_nlida
                FROM edusync_purga_log
                ORDER BY iniciado_em DESC
                LIMIT 50
            `);

            const { getConfigFromDb } = await import('../services/purgeJob.js');
            const conf = await getConfigFromDb(pool);

            res.json({ historico: rows, politicaAtual: conf });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Salvar políticas de retenção da purga ── */
    router.put('/admin/purga/config', async (req, res) => {
        const CAMPOS_VALIDOS = {
            purga_intervalo_horas:  { min: 1,   max: 720  },
            purga_audit_dias:       { min: 1,   max: 3650 },
            purga_reputacao_dias:   { min: 1,   max: 3650 },
            purga_notif_lida_dias:  { min: 1,   max: 3650 },
            purga_notif_nlida_dias: { min: 1,   max: 3650 },
            purga_lote:             { min: 100, max: 50000 },
        };

        const atualizacoes = [];
        const erros = [];

        for (const [chave, { min, max }] of Object.entries(CAMPOS_VALIDOS)) {
            if (!(chave in req.body)) continue;
            const v = parseInt(req.body[chave], 10);
            if (!Number.isFinite(v) || v < min || v > max) {
                erros.push(`${chave}: valor inválido (${req.body[chave]}). Deve ser inteiro entre ${min} e ${max}.`);
            } else {
                atualizacoes.push({ chave, valor: String(v) });
            }
        }

        if (erros.length) {
            return res.status(400).json({ erro: erros.join(' | ') });
        }
        if (!atualizacoes.length) {
            return res.status(400).json({ erro: 'Nenhum campo válido enviado.' });
        }

        try {
            for (const { chave, valor } of atualizacoes) {
                await pool.query(
                    `INSERT INTO edusync_config (chave, valor)
                     VALUES ($1, $2)
                     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                    [chave, valor]
                );
            }

            const { getConfigFromDb } = await import('../services/purgeJob.js');
            const conf = await getConfigFromDb(pool);

            await auditLogger.log({
                req,
                acao: 'purga_config_atualizada',
                modulo: 'admin',
                detalhes: { atualizacoes },
            });

            res.json({ ok: true, politicaAtual: conf });
        } catch (e) {
            console.error('[ADMIN] Erro ao salvar config de purga:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Rate-limit por CPF: leitura e reset manual ── */
    router.get('/admin/rate-limit/login', (req, res) => {
        res.json(getCpfRateLimitSnapshot());
    });

    router.delete('/admin/rate-limit/login/:cpf', async (req, res) => {
        const cpf = req.params.cpf.replace(/\D/g, '');
        if (!cpf) return res.status(400).json({ erro: 'CPF inválido.' });
        const removed = clearCpfRateLimit(cpf);
        await auditLogger.registrar({
            usuarioId:   req.userSession.userId,
            usuarioNome: req.userSession.nome,
            acao:        'RATE_LIMIT_CPF_RESETADO',
            modulo:      'admin',
            detalhes:    { cpf, removido: removed },
            ip:          req.ip,
        }).catch(() => {});
        res.json({ ok: true, removido: removed });
    });

    /* ── TTL de sync RCO (ajuste em tempo real) ── */
    router.patch('/admin/sync-ttl', async (req, res) => {
        const v = parseFloat(req.body?.ttlHoras);
        if (!Number.isFinite(v) || v <= 0 || v > 168) {
            return res.status(400).json({ erro: 'Valor inválido. Deve ser um número positivo entre 0 e 168 horas.' });
        }

        try {
            await pool.query(
                `INSERT INTO edusync_config (chave, valor)
                 VALUES ('rco_sync_ttl_hours', $1)
                 ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                [String(v)]
            );

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'SYNC_TTL_ATUALIZADO',
                modulo:      'admin',
                detalhes:    { ttlHoras: v },
                ip:          req.ip,
            }).catch(() => {});

            res.json({ ok: true, ttlHoras: v });
        } catch (e) {
            console.error('[ADMIN] Erro ao salvar TTL de sync:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Concorrência de login Puppeteer (ajuste em tempo real) ── */
    router.put('/admin/puppeteer-concurrency', async (req, res) => {
        const v = parseInt(req.body?.concurrency, 10);
        if (!Number.isFinite(v) || v < 1 || v > 20) {
            return res.status(400).json({ erro: 'Valor inválido. Deve ser um inteiro entre 1 e 20.' });
        }

        try {
            await pool.query(
                `INSERT INTO edusync_config (chave, valor)
                 VALUES ('puppeteer_login_concurrency', $1)
                 ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                [String(v)]
            );

            setLoginConcurrency(v);

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'PUPPETEER_CONCURRENCY_ATUALIZADA',
                modulo:      'admin',
                detalhes:    { concurrency: v },
                ip:          req.ip,
            }).catch(() => {});

            res.json({ ok: true, concurrency: v });
        } catch (e) {
            console.error('[ADMIN] Erro ao salvar concorrência Puppeteer:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Alertas de sync parado ── */
    router.get('/admin/sync-stale', async (_req, res) => {
        try {
            const { getUsuariosStale } = await import('../services/syncStaleAlertJob.js');

            const [configResult, cacheResult] = await Promise.all([
                pool.query(
                    `SELECT chave, valor FROM edusync_config
                      WHERE chave = ANY($1)`,
                    [['sync_stale_alert_days', 'sync_stale_alert_interval_horas']]
                ),
                pool.query(`
                    SELECT
                        u.id,
                        u.nome,
                        u.perfil,
                        c.ultimo_sync
                    FROM edusync_usuarios u
                    LEFT JOIN edusync_sync_cache c ON c.usuario_id = u.id
                    WHERE u.ativo = true
                    ORDER BY u.nome
                `),
            ]);

            const cfgMap = Object.fromEntries(configResult.rows.map(r => [r.chave, r.valor]));
            const alertDias = parseInt(cfgMap['sync_stale_alert_days'], 10) || 7;
            const intervalHoras = parseInt(cfgMap['sync_stale_alert_interval_horas'], 10) || 24;

            const limiteData = new Date(Date.now() - alertDias * 24 * 60 * 60 * 1000);

            const todosUsuarios = cacheResult.rows;
            const staleUsuarios = todosUsuarios.filter(r => {
                if (!r.ultimo_sync) return true;
                return new Date(r.ultimo_sync) < limiteData;
            }).map(r => ({
                id:         r.id,
                nome:       r.nome,
                perfil:     r.perfil,
                ultimoSync: r.ultimo_sync ? new Date(r.ultimo_sync).toISOString() : null,
            }));

            const ultimaExecucaoCache = getUsuariosStale();

            res.json({
                config: { alertDias, intervalHoras },
                totalAtivos: todosUsuarios.length,
                totalStale:  staleUsuarios.length,
                usuarios:    staleUsuarios,
                cacheMemoria: ultimaExecucaoCache,
            });
        } catch (e) {
            console.error('[ADMIN] Erro ao buscar sync-stale:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar alertas de sync parado.' });
        }
    });

    /* ── Salvar configuração de alerta de sync parado ── */
    router.put('/admin/sync-stale/config', async (req, res) => {
        const CAMPOS = {
            sync_stale_alert_days:           { min: 1, max: 365 },
            sync_stale_alert_interval_horas: { min: 1, max: 720 },
        };

        const atualizacoes = [];
        const erros = [];

        for (const [chave, { min, max }] of Object.entries(CAMPOS)) {
            if (!(chave in req.body)) continue;
            const v = parseInt(req.body[chave], 10);
            if (!Number.isFinite(v) || v < min || v > max) {
                erros.push(`${chave}: valor inválido. Deve ser inteiro entre ${min} e ${max}.`);
            } else {
                atualizacoes.push({ chave, valor: String(v) });
            }
        }

        if (erros.length) return res.status(400).json({ erro: erros.join(' | ') });
        if (!atualizacoes.length) return res.status(400).json({ erro: 'Nenhum campo válido enviado.' });

        try {
            for (const { chave, valor } of atualizacoes) {
                await pool.query(
                    `INSERT INTO edusync_config (chave, valor)
                     VALUES ($1, $2)
                     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                    [chave, valor]
                );
            }

            await pool.query(
                `INSERT INTO edusync_audit_log
                    (usuario_id, usuario_nome, acao, modulo, detalhes, ip)
                 VALUES ($1, $2, 'CONFIG_ALTERADA', 'admin', $3, $4)`,
                [
                    req.userSession.userId,
                    req.userSession.nome,
                    JSON.stringify({ chaves: atualizacoes }),
                    req.ip,
                ]
            ).catch(() => {});

            res.json({ ok: true, atualizados: atualizacoes.map(a => a.chave) });
        } catch (e) {
            console.error('[ADMIN] Erro ao salvar config sync-stale:', e.message);
            res.status(500).json({ erro: 'Erro interno ao salvar configuração.' });
        }
    });

    /* ── Disparar verificação manual de sync parado ── */
    router.post('/admin/sync-stale/verificar', async (req, res) => {
        try {
            const { tryVerificarSyncsStalent } = await import('../services/syncStaleAlertJob.js');
            const outcome = await tryVerificarSyncsStalent(pool);

            if (!outcome.ok) {
                return res.status(409).json({ erro: outcome.motivo });
            }

            await auditLogger.registrar({
                usuarioId:   req.userSession.userId,
                usuarioNome: req.userSession.nome,
                acao:        'SYNC_STALE_VERIFICACAO_MANUAL',
                modulo:      'admin',
                detalhes:    outcome.resultado,
                ip:          req.ip,
            }).catch(() => {});

            res.json({ ok: true, resultado: outcome.resultado });
        } catch (e) {
            console.error('[ADMIN] Erro ao executar verificação manual de sync-stale:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Alertas de erros repetidos da GradePen ── */
    router.get('/admin/gp-error-alerts', async (_req, res) => {
        try {
            const { getRecentGpErrorAlerts } = await import('../services/gpErrorAlertJob.js');
            const alertas = getRecentGpErrorAlerts();

            /* Also include the last 20 GP_ERROR_ALERT entries from the audit log */
            const { rows: historico } = await pool.query(`
                SELECT id, detalhes, criado_em
                  FROM edusync_audit_log
                 WHERE acao = 'GP_ERROR_ALERT'
                 ORDER BY criado_em DESC
                 LIMIT 20
            `);

            res.json({ alertasRecentes: alertas, historico });
        } catch (e) {
            console.error('[ADMIN] Erro ao buscar gp-error-alerts:', e.message);
            res.status(500).json({ erro: 'Erro interno ao buscar alertas GradePen.' });
        }
    });

    /* ── Observabilidade Puppeteer ── */
    router.get('/admin/puppeteer-stats', async (req, res) => {
        const login   = getLoginQueueStats();
        const sessoes = userSessionStore.size;

        let gradepen = null;
        try {
            const mod = await import('./provas.routes.js');
            gradepen = mod.getGradePenStats();
        } catch {}

        let protocolTimeout = parseInt(process.env.PUPPETEER_PROTOCOL_TIMEOUT, 10) || 300000;
        try {
            const { rows } = await pool.query(
                `SELECT valor FROM edusync_config WHERE chave = 'puppeteer_protocol_timeout' LIMIT 1`
            );
            if (rows.length > 0) {
                const dbVal = parseInt(rows[0].valor, 10);
                if (Number.isFinite(dbVal) && dbVal >= 5000) protocolTimeout = dbVal;
            }
        } catch {}

        res.json({
            login: {
                ativos:       login.active,
                naFila:       login.queued,
                limiteMáximo: login.maxSlots,
            },
            sessoes: {
                ativas: sessoes,
            },
            gradepen,
            config: {
                PUPPETEER_LOGIN_CONCURRENCY:   login.maxSlots,
                PUPPETEER_LOGIN_QUEUE_TIMEOUT: process.env.PUPPETEER_LOGIN_QUEUE_TIMEOUT || '60000 (padrão)',
                FILA_ALERTA_LIMIAR:            (v => Number.isFinite(v) ? v : 5)(parseInt(process.env.FILA_ALERTA_LIMIAR, 10)),
                PUPPETEER_PROTOCOL_TIMEOUT:    protocolTimeout,
            },
        });
    });

    return router;
}
