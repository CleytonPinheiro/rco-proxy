import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrarOcorrenciaMeta() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ocorrencia_meta (
                id_ocorrencia TEXT PRIMARY KEY,
                professor_nome TEXT NOT NULL DEFAULT '',
                nome_turma     TEXT NOT NULL DEFAULT '',
                criado_em      TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            ALTER TABLE ocorrencia_meta
            ADD COLUMN IF NOT EXISTS disciplina TEXT NOT NULL DEFAULT ''
        `);
        console.log('[COMPORTAMENTO] Tabela ocorrencia_meta OK');
    } catch (e) {
        console.warn('[COMPORTAMENTO] Erro migração ocorrencia_meta:', e.message);
    }
}

migrarOcorrenciaMeta();

export function createComportamentoRouter({ supabaseAdmin }) {
    const router = Router();

    router.get('/comportamento', async (req, res) => {
        const { codTurma } = req.query;
        try {
            let query = supabaseAdmin.from('aluno_ocorrencias')
                .select('*')
                .order('data', { ascending: false })
                .order('criado_em', { ascending: false });

            if (codTurma) {
                query = query.eq('cod_turma', parseInt(codTurma));
            } else {
                // Restringe às turmas do usuário atual para não exibir dados de outros professores
                const { data: turmasData } = await supabaseAdmin
                    .from('rco_turmas')
                    .select('cod_turma');
                if (turmasData && turmasData.length > 0) {
                    query = query.in('cod_turma', turmasData.map(t => t.cod_turma));
                }
            }

            const { data, error } = await query;
            if (error) return res.status(500).json({ erro: error.message });
            res.json(data || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/comportamento', async (req, res) => {
        const { cod_matriz_aluno, cod_turma, nome_aluno, num_chamada,
                data, tipo, categoria, categoria_label, descricao, pontos,
                professor_nome, nome_turma, disciplina } = req.body;
        if (!cod_matriz_aluno || !cod_turma || !tipo || !categoria) {
            return res.status(400).json({ erro: 'Campos obrigatórios ausentes' });
        }
        try {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            const { error } = await supabaseAdmin.from('aluno_ocorrencias').insert({
                id, cod_matriz_aluno, cod_turma, nome_aluno: nome_aluno || '',
                num_chamada: num_chamada || null,
                data: data || new Date().toISOString().split('T')[0],
                tipo, categoria, categoria_label: categoria_label || categoria,
                descricao: descricao || '', pontos: pontos || 0,
            });
            if (error) return res.status(500).json({ erro: error.message });

            // Salva metadados do professor em PG local (sem alterar schema do Supabase)
            await pool.query(
                `INSERT INTO ocorrencia_meta (id_ocorrencia, professor_nome, nome_turma, disciplina)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (id_ocorrencia) DO UPDATE
                 SET professor_nome = EXCLUDED.professor_nome,
                     nome_turma     = EXCLUDED.nome_turma,
                     disciplina     = EXCLUDED.disciplina`,
                [id, professor_nome || '', nome_turma || '', disciplina || '']
            );

            const { data: row } = await supabaseAdmin.from('aluno_ocorrencias').select('*').eq('id', id).single();
            res.json(row);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.delete('/comportamento/:id', async (req, res) => {
        try {
            const { error } = await supabaseAdmin.from('aluno_ocorrencias').delete().eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
