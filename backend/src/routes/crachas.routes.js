import { Router } from 'express';

export function createCrachasRouter({ supabase, supabaseAdmin }) {
    const router = Router();

    router.get('/crachas', async (req, res) => {
        try {
            const { data, error } = await supabase.from('crachas').select('*').order('cod_matriz_aluno');
            if (error) {
                console.warn('[CRACHAS] Tabela crachas não disponível:', error.message);
                return res.json([]);
            }
            res.json(data || []);
        } catch (e) {
            console.warn('[CRACHAS] Erro ao buscar crachás:', e.message);
            res.json([]);
        }
    });

    router.post('/crachas/status', async (req, res) => {
        const { ids, status } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ erro: 'ids é obrigatório' });
        }
        const validos = ['pendente', 'impresso', 'entregue'];
        if (!validos.includes(status)) {
            return res.status(400).json({ erro: 'status inválido' });
        }
        try {
            const agora = new Date().toISOString();
            const registros = ids.map(id => {
                const reg = { cod_matriz_aluno: parseInt(id), status, updated_at: agora };
                if (status === 'impresso') reg.data_impressao = agora;
                if (status === 'entregue') reg.data_entrega   = agora;
                if (status === 'pendente') { reg.data_impressao = null; reg.data_entrega = null; }
                return reg;
            });
            const { error } = await supabaseAdmin.from('crachas').upsert(registros, { onConflict: 'cod_matriz_aluno' });
            if (error) {
                if (error.code === '42P01') {
                    return res.status(503).json({ erro: 'Tabela crachas não encontrada. Execute setup_crachas.sql no Supabase Studio.' });
                }
                throw error;
            }
            res.json({ ok: true, atualizados: ids.length });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
