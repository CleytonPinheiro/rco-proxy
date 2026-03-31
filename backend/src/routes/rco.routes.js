import { Router } from 'express';
import { dataBrasilia } from '../config/dateUtils.js';

export function createRcoRouter({ rcoApiService, supabaseAdmin }) {
    const router = Router();

    router.get('/acessos', async (req, res) => {
        try {
            /* Se o cliente passou uma data específica, usa ela sem fallback */
            if (req.query.data) {
                const response = await rcoApiService.get(`/educador/estabelecimentos/v2/${req.query.data}`);
                console.log(`[ACESSOS] data fixa ${req.query.data} → status ${response.status} | bytes: ${JSON.stringify(response.data).length}`);
                if (response.status !== 200) return res.status(response.status).json({ erro: 'Erro na API RCO' });
                return res.json(response.data);
            }

            /* Fallback progressivo: tenta de hoje até 45 dias atrás
               até encontrar uma resposta com pelo menos 1 estabelecimento */
            const MAX_DIAS = 45;
            const base = new Date();

            for (let delta = 0; delta <= MAX_DIAS; delta++) {
                const d = new Date(base);
                d.setDate(base.getDate() - delta);
                /* Formata em horário de Brasília (UTC-3) */
                const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
                const data = brt.toISOString().split('T')[0];

                try {
                    const response = await rcoApiService.get(`/educador/estabelecimentos/v2/${data}`);
                    const bytes = JSON.stringify(response.data).length;
                    console.log(`[ACESSOS] ${data} (delta -${delta}) → status ${response.status} | bytes: ${bytes}`);

                    if (response.status !== 200) continue;

                    const arr = Array.isArray(response.data) ? response.data : [];
                    if (arr.length > 0) {
                        if (delta > 0) {
                            console.log(`[ACESSOS] Dados encontrados em ${data} (${delta} dia(s) atrás)`);
                        }
                        return res.json(response.data);
                    }
                } catch (e) {
                    console.warn(`[ACESSOS] Erro ao tentar ${data}:`, e.message);
                }
            }

            /* Nenhum dado encontrado em 45 dias */
            console.warn('[ACESSOS] Nenhum dado encontrado nos últimos 45 dias.');
            res.json([]);
        } catch (erro) {
            console.error('[ACESSOS] Erro:', erro.message);
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

            // ── Helper: mescla frequências de dois registros ─────────────────
            // Regra: 'C' prevalece sobre qualquer outro valor;
            // se o registro existente é nulo e o novo tem valor, usa o novo.
            function mesclarFreqs(entrada, novaLinha) {
                codAulas.forEach(cod => {
                    const existente = entrada.frequencias[cod];
                    const novo      = novaLinha[cod] || null;
                    if (!existente && novo)     entrada.frequencias[cod] = novo;
                    else if (novo === 'C')      entrada.frequencias[cod] = 'C';
                });
                // Mantém o numChamada menor (número de chamada original)
                if (novaLinha.numChamada &&
                    (!entrada.numChamada || novaLinha.numChamada < entrada.numChamada)) {
                    entrada.numChamada = novaLinha.numChamada;
                }
            }

            // ── 1ª passagem: deduplica por codMatrizAluno ────────────────────
            // Trata registros exatos duplicados (mesmo ID de matrícula).
            const mapaId = new Map();
            for (const a of raw) {
                const chave = a.codMatrizAluno != null ? String(a.codMatrizAluno) : `nome:${a.nome}`;
                if (!mapaId.has(chave)) {
                    const frequencias = {};
                    codAulas.forEach(cod => { frequencias[cod] = a[cod] || null; });
                    mapaId.set(chave, {
                        codMatrizAluno: a.codMatrizAluno,
                        numChamada:     a.numChamada,
                        nome:           a.nome,
                        frequencias,
                    });
                } else {
                    mesclarFreqs(mapaId.get(chave), a);
                }
            }

            // ── 2ª passagem: deduplica por nome normalizado ──────────────────
            // Trata o caso de aluno que saiu e voltou: o RCO cria um novo
            // codMatrizAluno para a rematrícula, mas o nome é idêntico.
            // Mesclamos as frequências dos dois períodos em um único registro.
            function normalizarNome(n) {
                return (n || '').trim().toUpperCase().replace(/\s+/g, ' ');
            }

            const mapaNome = new Map();
            for (const entrada of mapaId.values()) {
                const chave = normalizarNome(entrada.nome);
                if (!mapaNome.has(chave)) {
                    mapaNome.set(chave, entrada);
                } else {
                    // Já existe outro registro com o mesmo nome — mescla
                    mesclarFreqs(mapaNome.get(chave), {
                        ...entrada,
                        // Passa as frequências diretamente como campos planos
                        // para compatibilidade com mesclarFreqs
                        ...entrada.frequencias,
                        numChamada: entrada.numChamada,
                    });
                }
            }

            const mapaAlunos = mapaNome;

            // ── Calcular totais após deduplicação ────────────────────────────
            const alunos = Array.from(mapaAlunos.values()).map(a => {
                const presencas  = codAulas.filter(cod => a.frequencias[cod] === 'C').length;
                const faltas     = codAulas.filter(cod => a.frequencias[cod] && a.frequencias[cod] !== 'C').length;
                const totalAulas = codAulas.filter(cod => a.frequencias[cod] != null).length;
                const percentual = totalAulas > 0 ? Math.round((presencas / totalAulas) * 100) : null;
                return {
                    codMatrizAluno: a.codMatrizAluno,
                    numChamada:     a.numChamada,
                    nome:           a.nome,
                    frequencias:    a.frequencias,
                    presencas,
                    faltas,
                    totalAulas,
                    percentual,
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
