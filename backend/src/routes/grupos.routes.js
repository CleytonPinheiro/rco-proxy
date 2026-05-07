import { Router }      from 'express';
import pkg             from 'pg';
import { inferirTipo, parseGitHub, syncProjetoManual } from '../services/projectMonitorService.js';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function gerarId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function montarGrupo(row) {
    return {
        id:        row.id,
        codTurma:  row.cod_turma,
        nome:      row.nome,
        descricao: row.descricao || '',
        bloqueado: row.bloqueado,
        criadoEm:  row.criado_em,
        alunos: (row.grupo_alunos || []).map(a => ({
            codMatrizAluno: a.cod_matriz_aluno,
            nome:           a.nome,
            numChamada:     a.num_chamada,
        })),
        atividades: (row.grupo_atividades || [])
            .sort((a, b) => b.data.localeCompare(a.data))
            .map(a => ({ id: a.id, data: a.data, descricao: a.descricao, criadoEm: a.criado_em })),
    };
}

async function buscarGrupo(supabaseAdmin, id) {
    const { data, error } = await supabaseAdmin
        .from('grupos').select('*, grupo_alunos(*), grupo_atividades(*)').eq('id', id).single();
    if (error || !data) return null;
    return montarGrupo(data);
}

export function createGruposRouter({ supabaseAdmin }) {
    const router = Router();

    router.get('/grupos', async (req, res) => {
        try {
            let query = supabaseAdmin.from('grupos')
                .select('*, grupo_alunos(*), grupo_atividades(*)')
                .order('criado_em', { ascending: true });
            if (req.query.codTurma) query = query.eq('cod_turma', parseInt(req.query.codTurma));
            const { data, error } = await query;
            if (error) return res.status(500).json({ erro: error.message });
            res.json((data || []).map(montarGrupo));
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/grupos', async (req, res) => {
        const { codTurma, nome, descricao } = req.body;
        if (!codTurma || !nome) return res.status(400).json({ erro: 'codTurma e nome são obrigatórios' });
        try {
            const id = gerarId();
            const { error } = await supabaseAdmin.from('grupos').insert({
                id, cod_turma: parseInt(codTurma), nome, descricao: descricao || '', bloqueado: false,
            });
            if (error) return res.status(500).json({ erro: error.message });
            const grupo = await buscarGrupo(supabaseAdmin, id);
            res.json(grupo);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.put('/grupos/:id', async (req, res) => {
        const { nome, descricao, bloqueado } = req.body;
        const campos = {};
        if (nome !== undefined)      campos.nome      = nome;
        if (descricao !== undefined) campos.descricao = descricao;
        if (bloqueado !== undefined) campos.bloqueado = !!bloqueado;
        campos.atualizado_em = new Date().toISOString();
        try {
            const { error } = await supabaseAdmin.from('grupos').update(campos).eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            const grupo = await buscarGrupo(supabaseAdmin, req.params.id);
            if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
            res.json(grupo);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.delete('/grupos/:id', async (req, res) => {
        try {
            const grupo = await buscarGrupo(supabaseAdmin, req.params.id);
            if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
            if (grupo.bloqueado) return res.status(403).json({ erro: 'Grupo bloqueado. Desbloqueie antes de excluir.' });
            const { error } = await supabaseAdmin.from('grupos').delete().eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/grupos/:id/alunos', async (req, res) => {
        const { codMatrizAluno, nome, numChamada } = req.body;
        if (!codMatrizAluno) return res.status(400).json({ erro: 'codMatrizAluno é obrigatório' });
        try {
            const grupo = await buscarGrupo(supabaseAdmin, req.params.id);
            if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
            if (grupo.bloqueado) return res.status(403).json({ erro: 'Grupo bloqueado' });

            const { data: outrosGrupos } = await supabaseAdmin
                .from('grupos').select('id, bloqueado').eq('cod_turma', grupo.codTurma).neq('id', req.params.id);
            for (const g of (outrosGrupos || [])) {
                if (!g.bloqueado) {
                    await supabaseAdmin.from('grupo_alunos')
                        .delete().eq('grupo_id', g.id).eq('cod_matriz_aluno', codMatrizAluno);
                }
            }

            await supabaseAdmin.from('grupo_alunos').delete()
                .eq('grupo_id', req.params.id).eq('cod_matriz_aluno', codMatrizAluno);
            const { error } = await supabaseAdmin.from('grupo_alunos').insert({
                grupo_id: req.params.id, cod_matriz_aluno: codMatrizAluno,
                nome: nome || '', num_chamada: numChamada || null,
            });
            if (error) return res.status(500).json({ erro: error.message });
            const atualizado = await buscarGrupo(supabaseAdmin, req.params.id);
            res.json(atualizado);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.delete('/grupos/:id/alunos/:codMatrizAluno', async (req, res) => {
        try {
            const grupo = await buscarGrupo(supabaseAdmin, req.params.id);
            if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
            if (grupo.bloqueado) return res.status(403).json({ erro: 'Grupo bloqueado' });
            const { error } = await supabaseAdmin.from('grupo_alunos')
                .delete().eq('grupo_id', req.params.id).eq('cod_matriz_aluno', req.params.codMatrizAluno);
            if (error) return res.status(500).json({ erro: error.message });
            const atualizado = await buscarGrupo(supabaseAdmin, req.params.id);
            res.json(atualizado);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/grupos/:id/atividades', async (req, res) => {
        const { data, descricao } = req.body;
        if (!descricao) return res.status(400).json({ erro: 'descricao é obrigatória' });
        try {
            const id = gerarId();
            const { error } = await supabaseAdmin.from('grupo_atividades').insert({
                id, grupo_id: req.params.id, data: data || new Date().toISOString().split('T')[0], descricao,
            });
            if (error) return res.status(500).json({ erro: error.message });
            const { data: ativ } = await supabaseAdmin.from('grupo_atividades').select('*').eq('id', id).single();
            res.json({ id: ativ.id, data: ativ.data, descricao: ativ.descricao, criadoEm: ativ.criado_em });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.put('/grupos/:id/atividades/:ativId', async (req, res) => {
        const { data, descricao } = req.body;
        const campos = {};
        if (data)      campos.data      = data;
        if (descricao) campos.descricao = descricao;
        try {
            const { error } = await supabaseAdmin.from('grupo_atividades')
                .update(campos).eq('id', req.params.ativId).eq('grupo_id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            const { data: ativ } = await supabaseAdmin.from('grupo_atividades').select('*').eq('id', req.params.ativId).single();
            res.json({ id: ativ.id, data: ativ.data, descricao: ativ.descricao, criadoEm: ativ.criado_em });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.delete('/grupos/:id/atividades/:ativId', async (req, res) => {
        try {
            const { error } = await supabaseAdmin.from('grupo_atividades')
                .delete().eq('id', req.params.ativId).eq('grupo_id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* ══ Projetos ══════════════════════════════════════════════════════════ */

    /* GET /grupos/monitor-projetos — visão geral (todos os grupos / turma) */
    router.get('/grupos/monitor-projetos', async (req, res) => {
        try {
            const params = [];
            let where = 'WHERE gp.ativo = true';
            if (req.query.codTurma) { where += ' AND gp.cod_turma = $1'; params.push(parseInt(req.query.codTurma)); }

            const { rows } = await pool.query(`
                SELECT gp.*,
                    (SELECT COUNT(*) FROM grupo_projeto_eventos WHERE projeto_id = gp.id)::int AS total_eventos,
                    (SELECT json_agg(e ORDER BY e.detectado_em DESC)
                       FROM (SELECT * FROM grupo_projeto_eventos WHERE projeto_id = gp.id ORDER BY detectado_em DESC LIMIT 5) e
                    ) AS eventos_recentes
                FROM grupo_projetos gp
                ${where}
                ORDER BY gp.cod_turma, gp.grupo_id, gp.criado_em
            `, params);
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* GET /grupos/projetos-sugestoes — sugestões pendentes de alunos */
    router.get('/grupos/projetos-sugestoes', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM aluno_projeto_sugestoes ORDER BY criado_em DESC LIMIT 200`
            );
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* PUT /grupos/projetos-sugestoes/:id — aprovar ou rejeitar */
    router.put('/grupos/projetos-sugestoes/:id', async (req, res) => {
        const { status, grupoId, codTurma } = req.body;
        if (!['aprovado', 'rejeitado'].includes(status))
            return res.status(400).json({ erro: 'status deve ser aprovado ou rejeitado' });
        try {
            const { rows } = await pool.query(
                'SELECT * FROM aluno_projeto_sugestoes WHERE id = $1', [req.params.id]
            );
            if (!rows[0]) return res.status(404).json({ erro: 'Sugestão não encontrada' });
            const s = rows[0];

            if (status === 'aprovado' && grupoId) {
                const gh = s.tipo === 'github' ? parseGitHub(s.url) : null;
                await pool.query(`
                    INSERT INTO grupo_projetos (grupo_id, cod_turma, nome, tipo, url, github_owner, github_repo)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [grupoId, codTurma ? parseInt(codTurma) : null,
                    s.nome, s.tipo, s.url, gh?.owner || null, gh?.repo || null]);
            }

            await pool.query(
                'UPDATE aluno_projeto_sugestoes SET status = $1, grupo_id_destino = $2 WHERE id = $3',
                [status, grupoId || null, req.params.id]
            );
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* GET /grupos/:id/projetos — projetos de um grupo + últimos eventos */
    router.get('/grupos/:id/projetos', async (req, res) => {
        try {
            const { rows: projetos } = await pool.query(`
                SELECT gp.*,
                    (SELECT COUNT(*) FROM grupo_projeto_eventos WHERE projeto_id = gp.id)::int AS total_eventos
                FROM grupo_projetos gp
                WHERE gp.grupo_id = $1 AND gp.ativo = true
                ORDER BY gp.criado_em
            `, [req.params.id]);

            for (const p of projetos) {
                const { rows: ev } = await pool.query(
                    `SELECT * FROM grupo_projeto_eventos
                     WHERE projeto_id = $1 ORDER BY detectado_em DESC LIMIT 10`,
                    [p.id]
                );
                p.eventos = ev;
            }
            res.json(projetos);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /grupos/:id/projetos — adicionar projeto ao grupo */
    router.post('/grupos/:id/projetos', async (req, res) => {
        const { nome, url, codTurma } = req.body;
        if (!nome || !url) return res.status(400).json({ erro: 'nome e url são obrigatórios' });
        try {
            const tipo = inferirTipo(url);
            const gh   = tipo === 'github' ? parseGitHub(url) : null;
            const { rows } = await pool.query(`
                INSERT INTO grupo_projetos (grupo_id, cod_turma, nome, tipo, url, github_owner, github_repo)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `, [req.params.id, codTurma ? parseInt(codTurma) : null,
                nome.slice(0, 120), tipo, url, gh?.owner || null, gh?.repo || null]);
            res.json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* DELETE /grupos/:id/projetos/:projId — remover projeto */
    router.delete('/grupos/:id/projetos/:projId', async (req, res) => {
        try {
            await pool.query(
                'DELETE FROM grupo_projetos WHERE id = $1 AND grupo_id = $2',
                [req.params.projId, req.params.id]
            );
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /grupos/:id/projetos/:projId/sync — sync manual GitHub */
    router.post('/grupos/:id/projetos/:projId/sync', async (req, res) => {
        try {
            const novos = await syncProjetoManual(parseInt(req.params.projId));
            const { rows } = await pool.query(`
                SELECT gp.*,
                    (SELECT COUNT(*) FROM grupo_projeto_eventos WHERE projeto_id = gp.id)::int AS total_eventos
                FROM grupo_projetos gp WHERE gp.id = $1
            `, [req.params.projId]);
            const { rows: ev } = await pool.query(
                `SELECT * FROM grupo_projeto_eventos WHERE projeto_id = $1 ORDER BY detectado_em DESC LIMIT 10`,
                [req.params.projId]
            );
            res.json({ novos, projeto: rows[0] ? { ...rows[0], eventos: ev } : null });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
