import { Router } from 'express';

export function createDebugRouter({ tokenService, rcoApiService, supabaseAdmin }) {
    const router = Router();

    // Limpa alunos de seed (sem codmatrizaluno real)
    router.delete('/admin/seeds', async (req, res) => {
        try {
            const { data: antes } = await supabaseAdmin
                .from('alunos').select('id', { count: 'exact' }).is('codmatrizaluno', null);
            const { error } = await supabaseAdmin
                .from('alunos').delete().is('codmatrizaluno', null);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true, deletados: antes?.length ?? 0 });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.get('/debug/raw-rco', async (req, res) => {
        const { path: rcoPath } = req.query;
        if (!rcoPath) return res.status(400).json({ erro: 'path é obrigatório' });
        try {
            const r = await rcoApiService.getRawFull(rcoPath);
            res.json({ status: r.status, data: r.data });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.get('/debug/rco', async (req, res) => {
        try {
            const BASE = 'https://apigateway-educacao.paas.pr.gov.br/seed/rcdig';
            const authToken = await tokenService.getValidToken();
            const headers = { consumerId: 'RCDIGWEB', Authorization: `Bearer ${authToken}` };
            const { dataBrasilia } = await import('../config/dateUtils.js');
            const hoje = dataBrasilia();
            const BASE_ESTADUAL = BASE + '/estadual/v1';
            const optsEst = { headers, timeout: 20000, validateStatus: () => true };

            const COD_CLASSE = req.query.codClasse || 8682303;
            const COD_TURMA  = req.query.codTurma  || 2604991;

            const { default: axios } = await import('axios');
            const endpoints = [
                { url: `${BASE_ESTADUAL}/educador/estabelecimentos/v2/${hoje}`, label: 'estabelecimentos/hoje' },
                { url: `${BASE_ESTADUAL}/classe/v3/relatorios/frequenciaAulas?codClasse=${COD_CLASSE}&codPeriodoAvaliacao=9&codPeriodoLetivo=261&page=1&perPage=200`, label: 'frequenciaAulas' },
            ];

            const results = {};
            for (const ep of endpoints) {
                try {
                    const r = await axios.get(ep.url, optsEst);
                    const bodyStr = JSON.stringify(r.data);
                    results[ep.label] = {
                        url: ep.url, status: r.status,
                        contentType: r.headers['content-type'],
                        bodyLength: bodyStr.length, preview: bodyStr.substring(0, 500),
                    };
                } catch (e) { results[ep.label] = { url: ep.url, erro: e.message }; }
            }

            res.json(results);
        } catch (erro) { res.status(500).json({ erro: erro.message }); }
    });

    router.get('/debug/alunos-classe', async (req, res) => {
        const codClasse           = req.query.codClasse          || 8682303;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;
        try {
            const candidatos = [
                `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`,
                `/classe/v1/relatorios/avaliacaoParcialAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`,
                `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=261`,
                `/classe/v1/acessos/contatos?codClasse=${codClasse}`,
                `/educador/grade/aula/v2/${codClasse}?codPeriodoLetivo=261`,
            ];

            const resultados = {};
            for (const path of candidatos) {
                try {
                    const r = await rcoApiService.get(path);
                    const str = JSON.stringify(r.data);
                    resultados[path] = { status: r.status, len: str.length, preview: str.substring(0, 300) };
                } catch (e) { resultados[path] = { erro: e.message }; }
            }
            res.json(resultados);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.get('/debug/alunos-rco', async (req, res) => {
        try {
            res.json({ mensagem: 'Endpoint de debug de alunos via puppeteer desativado nesta versão.' });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
