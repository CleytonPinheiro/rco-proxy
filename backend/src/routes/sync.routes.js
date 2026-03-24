import { Router } from 'express';

export function createSyncRouter({ supabase, syncService }) {
    const router = Router();

    router.get('/setup-status', async (req, res) => {
        try {
            const { data, error } = await supabase.from('rco_estabelecimentos').select('cod_estabelecimento').limit(1);
            if (error) {
                return res.json({
                    configurado: false,
                    mensagem: 'Tabelas não encontradas no Supabase. Execute o SQL em backend/database/migrations/ no Supabase Studio.',
                    supabase_url: process.env.SUPABASE_URL || '(não definida)',
                    erro: error.message,
                });
            }
            res.json({ configurado: true, mensagem: 'Tabelas configuradas e acessíveis.' });
        } catch (erro) { res.status(500).json({ configurado: false, erro: erro.message }); }
    });

    router.post('/sync', async (req, res) => {
        try {
            const resultado = await syncService.sincronizarComSupabase();
            res.json(resultado);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.get('/sync/log', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('rco_sync_log').select('*').order('executado_em', { ascending: false }).limit(20);
            if (error) throw error;
            res.json(data);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    return router;
}
