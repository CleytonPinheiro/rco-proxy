import { Router } from 'express';

export function createCozinhaRouter({ supabaseAdmin }) {
    const router = Router();

    router.get('/cozinha', async (req, res) => {
        try {
            const data = req.query.data || new Date().toISOString().split('T')[0];

            const { data: rows } = await supabaseAdmin
                .from('presenca_diaria')
                .select('periodo, total_matriculados, total_presentes, total_ausentes, confirmado, fonte')
                .eq('data', data);

            const { data: cardapio } = await supabaseAdmin.from('cozinha_cardapio').select('*').eq('data', data);

            const periodos = ['manha', 'tarde', 'noite'];
            const resultado = {};

            periodos.forEach(p => {
                const turmasP      = (rows || []).filter(r => r.periodo === p);
                const confirmacaoC = (cardapio || []).find(c => c.periodo === p);
                const matriculados = turmasP.reduce((s, r) => s + (r.total_matriculados || 0), 0);
                const presentes    = turmasP.every(r => r.total_presentes != null)
                    ? turmasP.reduce((s, r) => s + (r.total_presentes || 0), 0)
                    : null;
                const turmasConfirmadas = turmasP.filter(r => r.confirmado).length;

                resultado[p] = {
                    periodo: p,
                    turmas: turmasP.length,
                    turmasConfirmadas,
                    matriculados,
                    presentes,
                    ausentes: presentes != null ? matriculados - presentes : null,
                    percentualPresenca: (presentes != null && matriculados > 0)
                        ? Math.round(presentes / matriculados * 100)
                        : null,
                    status: presentes == null ? 'aguardando' : (turmasConfirmadas === turmasP.length ? 'confirmado' : 'parcial'),
                    confirmacaoCozinha: confirmacaoC || null,
                };
            });

            const historico = {};
            periodos.forEach(p => { historico[p] = []; });
            for (let i = 1; i <= 10; i++) {
                const d = new Date(data);
                d.setDate(d.getDate() - i);
                const ds = d.toISOString().split('T')[0];
                const { data: hRows } = await supabaseAdmin
                    .from('presenca_diaria').select('periodo, total_presentes').eq('data', ds);
                periodos.forEach(p => {
                    const turmasHist = (hRows || []).filter(r => r.periodo === p && r.total_presentes != null);
                    if (turmasHist.length) {
                        const total = turmasHist.reduce((s, r) => s + r.total_presentes, 0);
                        historico[p].push({ data: ds, total });
                    }
                });
            }

            res.json({ data, resultado, historico });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/cozinha/confirmar', async (req, res) => {
        try {
            const { data, periodo, total_confirmado, observacao } = req.body;
            if (!data || !periodo || total_confirmado == null) {
                return res.status(400).json({ erro: 'data, periodo e total_confirmado são obrigatórios' });
            }
            const { error } = await supabaseAdmin.from('cozinha_cardapio').upsert({
                data, periodo, total_confirmado: parseInt(total_confirmado),
                observacao: observacao || null, confirmado_em: new Date().toISOString(),
            }, { onConflict: 'data,periodo' });
            if (error) throw error;
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.get('/cozinha/historico', async (req, res) => {
        try {
            const desde = new Date();
            desde.setDate(desde.getDate() - 30);
            const { data: rows } = await supabaseAdmin
                .from('presenca_diaria')
                .select('data, periodo, total_presentes')
                .gte('data', desde.toISOString().split('T')[0])
                .not('total_presentes', 'is', null)
                .order('data', { ascending: true });
            res.json(rows || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
