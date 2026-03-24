import { Router } from 'express';

export function createPresencaRouter({ supabaseAdmin, presencaService }) {
    const router = Router();

    router.get('/presenca-diaria', async (req, res) => {
        try {
            const data = req.query.data || new Date().toISOString().split('T')[0];
            const { data: rows, error } = await supabaseAdmin
                .from('presenca_diaria').select('*').eq('data', data)
                .order('periodo', { ascending: true }).order('descr_turma', { ascending: true });
            if (error) throw error;
            res.json(rows || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/presenca-diaria/sync', async (req, res) => {
        try {
            const data = req.body?.data || new Date().toISOString().split('T')[0];
            presencaService.syncPresencaDiariaRCO(data).catch(console.error);
            res.json({ ok: true, msg: 'Sincronização iniciada. Aguarde alguns instantes e recarregue.' });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/presenca-diaria/seed', async (req, res) => {
        try {
            const data = req.body?.data || new Date().toISOString().split('T')[0];
            const { data: turmas } = await supabaseAdmin.from('rco_turmas').select('cod_turma, descr_turma');
            const { data: alunosDB } = await supabaseAdmin.from('alunos').select('codturma');
            const alunosCount = {};
            (alunosDB || []).forEach(a => { if (a.codturma) alunosCount[a.codturma] = (alunosCount[a.codturma] || 0) + 1; });

            const payload = (turmas || []).map(t => ({
                data, periodo: presencaService.detectarPeriodo(t.descr_turma),
                cod_turma: t.cod_turma, descr_turma: t.descr_turma,
                total_matriculados: alunosCount[t.cod_turma] || 0,
                total_presentes: null, total_ausentes: null,
                fonte: 'estimado', confirmado: false, atualizado_em: new Date().toISOString(),
            }));

            if (!payload.length) return res.json({ ok: true, turmas: 0 });
            const { error } = await supabaseAdmin.from('presenca_diaria')
                .upsert(payload, { onConflict: 'data,cod_turma', ignoreDuplicates: true });
            if (error) throw error;
            res.json({ ok: true, turmas: payload.length });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.put('/presenca-diaria/confirmar', async (req, res) => {
        try {
            const { data, cod_turma, total_presentes, observacao } = req.body;
            if (!data || !cod_turma || total_presentes == null) {
                return res.status(400).json({ erro: 'data, cod_turma e total_presentes são obrigatórios' });
            }

            const { data: existing } = await supabaseAdmin
                .from('presenca_diaria').select('*').eq('data', data).eq('cod_turma', cod_turma).single();

            const total_matriculados = existing?.total_matriculados || 0;
            const total_ausentes     = Math.max(0, total_matriculados - total_presentes);

            const { error } = await supabaseAdmin.from('presenca_diaria').upsert({
                data, cod_turma,
                descr_turma:       existing?.descr_turma || '',
                periodo:           existing?.periodo || presencaService.detectarPeriodo(existing?.descr_turma),
                total_matriculados, total_presentes, total_ausentes,
                fonte:             'professor', confirmado: true,
                observacao:        observacao || null,
                atualizado_em:     new Date().toISOString(),
            }, { onConflict: 'data,cod_turma' });
            if (error) throw error;
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.get('/presenca-diaria/historico', async (req, res) => {
        try {
            const data    = req.query.data    || new Date().toISOString().split('T')[0];
            const periodos = ['manha', 'tarde', 'noite'];
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
            res.json(historico);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
