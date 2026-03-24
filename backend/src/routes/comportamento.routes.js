import { Router } from 'express';

export function createComportamentoRouter({ supabaseAdmin }) {
    const router = Router();

    router.get('/comportamento', async (req, res) => {
        const { codTurma } = req.query;
        try {
            let query = supabaseAdmin.from('aluno_ocorrencias')
                .select('*')
                .order('data', { ascending: false })
                .order('criado_em', { ascending: false });
            if (codTurma) query = query.eq('cod_turma', parseInt(codTurma));
            const { data, error } = await query;
            if (error) return res.status(500).json({ erro: error.message });
            res.json(data || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/comportamento', async (req, res) => {
        const { cod_matriz_aluno, cod_turma, nome_aluno, num_chamada,
                data, tipo, categoria, categoria_label, descricao, pontos } = req.body;
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
