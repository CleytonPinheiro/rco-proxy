import { Router } from 'express';

export function createMateriaisRouter({ supabase }) {
    const router = Router();

    router.get('/materiais', async (req, res) => {
        try {
            const { tipo, status } = req.query;
            let query = supabase.from('materiais').select('*');
            if (tipo)   query = query.eq('tipo', tipo);
            if (status) query = query.eq('status', status);
            const { data, error } = await query.order('codigo');
            if (error) throw error;
            res.json(data);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.get('/materiais/:codigo', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('materiais').select('*').eq('codigo', req.params.codigo).single();
            if (error) {
                if (error.code === 'PGRST116') return res.status(404).json({ erro: 'Material não encontrado' });
                throw error;
            }
            res.json(data);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.post('/materiais', async (req, res) => {
        try {
            const { codigo, tipo, descricao, localizacao, estado } = req.body;
            if (!codigo || !tipo || !descricao) {
                return res.status(400).json({ erro: 'Código, tipo e descrição são obrigatórios' });
            }
            const { data, error } = await supabase
                .from('materiais')
                .insert([{ codigo, tipo, descricao, localizacao, estado: estado || 'otimo', status: 'disponivel' }])
                .select().single();
            if (error) throw error;
            res.status(201).json(data);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.put('/materiais/:id', async (req, res) => {
        try {
            const { codigo, tipo, descricao, localizacao, estado, status } = req.body;
            const { data, error } = await supabase
                .from('materiais')
                .update({ codigo, tipo, descricao, localizacao, estado, status, updated_at: new Date().toISOString() })
                .eq('id', req.params.id).select().single();
            if (error) throw error;
            res.json(data);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.delete('/materiais/:id', async (req, res) => {
        try {
            const { error } = await supabase.from('materiais').delete().eq('id', req.params.id);
            if (error) throw error;
            res.json({ sucesso: true });
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.get('/emprestimos', async (req, res) => {
        try {
            const { status } = req.query;
            let query = supabase.from('emprestimos').select('*, aluno:alunos(*), material:materiais(*)');
            if (status) query = query.eq('status', status);
            const { data, error } = await query.order('data_emprestimo', { ascending: false });
            if (error) throw error;
            res.json(data);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.post('/emprestimos', async (req, res) => {
        try {
            const { aluno_registro, material_codigo, professor, aulas, observacoes } = req.body;
            if (!aluno_registro || !material_codigo || !aulas || aulas.length === 0) {
                return res.status(400).json({ erro: 'Aluno, material e aulas são obrigatórios' });
            }

            const { data: aluno, error: alunoErr } = await supabase
                .from('alunos').select('id').eq('registro', aluno_registro).single();
            if (alunoErr) {
                if (alunoErr.code === 'PGRST116') return res.status(404).json({ erro: 'Aluno não encontrado' });
                throw alunoErr;
            }

            const { data: material, error: matErr } = await supabase
                .from('materiais').select('id, status').eq('codigo', material_codigo).single();
            if (matErr) {
                if (matErr.code === 'PGRST116') return res.status(404).json({ erro: 'Material não encontrado' });
                throw matErr;
            }
            if (material.status !== 'disponivel') {
                return res.status(400).json({ erro: 'Material não está disponível' });
            }

            const { error: updateErr } = await supabase.from('materiais').update({ status: 'emprestado' }).eq('id', material.id);
            if (updateErr) throw updateErr;

            const { data: emprestimo, error: empErr } = await supabase
                .from('emprestimos')
                .insert([{ aluno_id: aluno.id, material_id: material.id, professor, aulas, observacoes, status: 'ativo' }])
                .select('*, aluno:alunos(*), material:materiais(*)').single();
            if (empErr) throw empErr;
            res.status(201).json(emprestimo);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.put('/emprestimos/:id/devolver', async (req, res) => {
        try {
            const { estado_devolucao, observacoes_devolucao } = req.body;

            const { data: emprestimo, error: getErr } = await supabase
                .from('emprestimos').select('material_id').eq('id', req.params.id).single();
            if (getErr) {
                if (getErr.code === 'PGRST116') return res.status(404).json({ erro: 'Empréstimo não encontrado' });
                throw getErr;
            }

            const { error: updateMatErr } = await supabase
                .from('materiais')
                .update({ status: 'disponivel', estado: estado_devolucao || 'bom' })
                .eq('id', emprestimo.material_id);
            if (updateMatErr) throw updateMatErr;

            const { data, error } = await supabase
                .from('emprestimos')
                .update({ status: 'devolvido', data_devolucao: new Date().toISOString(), estado_devolucao, observacoes_devolucao })
                .eq('id', req.params.id)
                .select('*, aluno:alunos(*), material:materiais(*)').single();
            if (error) throw error;
            res.json(data);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.get('/estatisticas/materiais', async (req, res) => {
        try {
            const { data, error } = await supabase.from('materiais').select('status');
            if (error) throw error;
            res.json({
                total:       data.length,
                disponivel:  data.filter(m => m.status === 'disponivel').length,
                emprestado:  data.filter(m => m.status === 'emprestado').length,
                manutencao:  data.filter(m => m.status === 'manutencao').length,
            });
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    return router;
}
