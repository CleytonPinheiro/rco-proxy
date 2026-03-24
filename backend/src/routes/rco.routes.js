import { Router } from 'express';

export function createRcoRouter({ rcoApiService, supabaseAdmin }) {
    const router = Router();

    router.get('/acessos', async (req, res) => {
        try {
            const hoje = new Date().toISOString().split('T')[0];
            console.log(`Consultando estabelecimentos para ${hoje}...`);
            const response = await rcoApiService.get(`/educador/estabelecimentos/v2/${hoje}`);
            console.log('RCO API status:', response.status, '| bytes:', JSON.stringify(response.data).length);
            if (response.status !== 200) {
                return res.status(response.status).json({ erro: 'Erro na API RCO', data: response.data });
            }
            res.json(response.data);
        } catch (erro) {
            console.error('Erro ao consultar API RCO:', erro.message);
            res.status(500).json({ erro: 'Erro ao consultar a API', detalhes: erro.message });
        }
    });

    router.get('/frequencias', async (req, res) => {
        const codClasse           = req.query.codClasse;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;
        const codPeriodoLetivo    = req.query.codPeriodoLetivo    || 261;

        if (!codClasse) return res.status(400).json({ erro: 'codClasse é obrigatório' });

        try {
            const path = `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`;
            const response = await rcoApiService.get(path);

            if (response.status !== 200) {
                return res.status(response.status).json({ erro: `RCO retornou ${response.status}`, dados: response.data });
            }

            const raw = Array.isArray(response.data) ? response.data : [];

            const aulaSet = new Set();
            raw.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));
            const codAulas = [...aulaSet].sort((a, b) => parseInt(a) - parseInt(b));

            const aulaDatas = {};
            await Promise.all(codAulas.map(async (cod) => {
                try {
                    const r = await rcoApiService.get(`/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPeriodoLetivo}`);
                    const dataRaw = r?.data?.aula?.dataAula || r?.data?.dataAula || null;
                    if (dataRaw) {
                        const d = new Date(dataRaw);
                        const dd = String(d.getUTCDate()).padStart(2, '0');
                        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                        aulaDatas[cod] = `${dd}/${mm}`;
                    }
                } catch (_) {}
            }));

            const alunos = raw.map(a => {
                const freq = {};
                codAulas.forEach(cod => { freq[cod] = a[cod] || null; });
                const presencas  = codAulas.filter(cod => a[cod] === 'C').length;
                const faltas     = codAulas.filter(cod => a[cod] && a[cod] !== 'C').length;
                const totalAulas = codAulas.filter(cod => a[cod] !== undefined && a[cod] !== null).length;
                const pct = totalAulas > 0 ? Math.round((presencas / totalAulas) * 100) : null;
                return {
                    codMatrizAluno: a.codMatrizAluno,
                    numChamada:     a.numChamada,
                    nome:           a.nome,
                    freq,
                    presencas,
                    faltas,
                    totalAulas,
                    percentualPresenca: pct,
                };
            });

            res.json({ codAulas, aulaDatas, alunos });
        } catch (erro) {
            res.status(500).json({ erro: erro.message });
        }
    });

    router.get('/alunos-rco', async (req, res) => {
        const codClasse           = req.query.codClasse;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;

        if (!codClasse) return res.status(400).json({ erro: 'codClasse é obrigatório' });

        try {
            let path = `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`;
            let response = await rcoApiService.get(path);
            let alunos = Array.isArray(response.data) ? response.data : [];

            if (alunos.length === 0) {
                path = `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=261&page=1&perPage=200`;
                response = await rcoApiService.get(path);
                alunos = Array.isArray(response.data) ? response.data : [];
            }

            if (response.status !== 200 && alunos.length === 0) {
                return res.status(response.status).json({ erro: `RCO retornou ${response.status}`, dados: response.data });
            }

            res.json(alunos.map(a => ({
                codMatrizAluno: a.codMatrizAluno,
                numChamada:     a.numChamada,
                nome:           a.nome,
                situacao:       a.descrAbrevSituacaoMatricula || '',
            })));
        } catch (erro) {
            res.status(500).json({ erro: erro.message });
        }
    });

    router.get('/observacoes', async (req, res) => {
        const codClasse           = req.query.codClasse;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;
        const codPeriodoLetivo    = req.query.codPeriodoLetivo    || 261;
        if (!codClasse) return res.status(400).json({ erro: 'codClasse é obrigatório' });

        try {
            const freqResp = await rcoApiService.get(
                `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`
            );
            const alunosFreq = Array.isArray(freqResp.data) ? freqResp.data : [];
            const aulaSet = new Set();
            alunosFreq.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));
            const codAulas = [...aulaSet].sort((a, b) => parseInt(a) - parseInt(b));

            if (!codAulas.length) return res.json([]);

            const BATCH = 10;
            const todasObs = [];
            for (let i = 0; i < codAulas.length; i += BATCH) {
                const lote = codAulas.slice(i, i + BATCH);
                const resultados = await Promise.all(lote.map(async (cod) => {
                    try {
                        const r = await rcoApiService.get(`/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPeriodoLetivo}`);
                        const aula    = r.data?.aula || {};
                        const alunos  = aula.alunos || [];
                        const dataAula = aula.dataAula ? aula.dataAula.substring(0, 10) : null;
                        return alunos
                            .filter(a => a.observacao && a.observacao.trim())
                            .map(a => ({
                                cod_aula:         parseInt(cod),
                                cod_classe:       parseInt(codClasse),
                                cod_matriz_aluno: a.codMatrizAluno,
                                nome_aluno:       a.nome || '',
                                num_chamada:      a.numChamada || null,
                                data_aula:        dataAula,
                                observacao:       a.observacao.trim(),
                            }));
                    } catch { return []; }
                }));
                resultados.forEach(r => todasObs.push(...r));
            }

            if (todasObs.length > 0) {
                await supabaseAdmin.from('rco_observacoes').upsert(todasObs, { onConflict: 'cod_aula,cod_matriz_aluno' });
            }

            const { data: dbObs, error } = await supabaseAdmin
                .from('rco_observacoes')
                .select('*')
                .eq('cod_classe', parseInt(codClasse))
                .order('data_aula', { ascending: false });

            if (error) return res.status(500).json({ erro: error.message });
            res.json(dbObs || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
