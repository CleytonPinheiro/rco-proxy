import { Router } from 'express';

export function createAlunosRouter({ supabase }) {
    const router = Router();

    router.get('/alunos', async (req, res) => {
        try {
            const { turma, codturma, registro } = req.query;
            let query = supabase.from('alunos').select('*');

            if (codturma) query = query.eq('codturma', parseInt(codturma));
            else if (turma) query = query.eq('turma', turma);
            if (registro) query = query.eq('registro', registro);

            const { data, error } = await query
                .order('numchamada', { ascending: true, nullsFirst: false })
                .order('nome', { ascending: true });

            if (error) throw error;
            res.json(data);
        } catch (erro) {
            res.status(500).json({ erro: erro.message });
        }
    });

    router.get('/alunos/:registro', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('alunos')
                .select('*')
                .eq('registro', req.params.registro)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ erro: 'Aluno não encontrado' });
                }
                throw error;
            }
            res.json(data);
        } catch (erro) {
            res.status(500).json({ erro: erro.message });
        }
    });

    return router;
}
