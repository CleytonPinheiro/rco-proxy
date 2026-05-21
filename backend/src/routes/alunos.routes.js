import { Router } from 'express';

export function createAlunosRouter({ supabase }) {
    const router = Router();

    router.get('/alunos', async (req, res) => {
        try {
            const { turma, codturma, registro, search } = req.query;
            let query = supabase.from('alunos').select('nome, turma, codturma, numchamada, codmatrizaluno, registro');

            if (search) {
                const term = search.trim();
                if (term.length < 2) return res.json([]);
                query = query.ilike('nome', `%${term}%`).limit(20);
            } else {
                if (codturma) query = query.eq('codturma', parseInt(codturma));
                else if (turma) query = query.eq('turma', turma);
                if (registro) query = query.eq('registro', registro);
            }

            const { data, error } = await query
                .order('numchamada', { ascending: true, nullsFirst: false })
                .order('nome', { ascending: true });

            if (error) throw error;
            res.json(data);
        } catch (erro) {
            res.status(500).json({ erro: erro.message });
        }
    });

    router.get('/alunos/turmas/lista', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('alunos')
                .select('codturma, turma')
                .order('turma', { ascending: true });
            if (error) throw error;
            // Dedup por codturma
            const seen = new Set();
            const turmas = (data || []).filter(r => {
                if (seen.has(r.codturma)) return false;
                seen.add(r.codturma);
                return true;
            });
            res.json(turmas);
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
