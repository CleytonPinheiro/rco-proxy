/**
 * RCO Lançamento — lançamento de notas do Classroom direto no RCO Digital
 *
 * GET  /api/rco-lancamento/avaliacoes                    — lista avaliações parciais de uma classe
 * GET  /api/rco-lancamento/avaliacoes/:id               — detalha avaliação (com alunos + conteudos)
 * GET  /api/rco-lancamento/conteudos-sugeridos          — conteúdos de outras avaliações da classe (para modal)
 * POST /api/rco-lancamento/avaliacoes/:id/lancar        — executa PUT no RCO com notas + conteudos
 * POST /api/rco-lancamento/avaliacoes/:id/salvar-db     — persiste no banco sem reenviar ao RCO
 */

import { Router }              from 'express';
import { rcoApiService }       from '../services/RcoApiService.js';
import { RcoWebAutomation }    from '../services/RcoWebAutomation.js';
import pkg                     from 'pg';

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });

const RCO_CLASSE_BASE = '/classe/v1';

export function createRcoLancamentoRouter(deps = {}) {
    const router         = Router();
    const supabaseAdmin  = deps?.supabaseAdmin ?? null;

    /* ── GET /api/rco-lancamento/classes
       Lista todas as classes RCO disponíveis (sincronizadas no Supabase),
       com nome da turma e da disciplina, prontas para o seletor de grupo.
    ─────────────────────────────────────────────────────── */
    router.get('/rco-lancamento/classes', async (req, res) => {
        if (!supabaseAdmin) {
            return res.status(503).json({ erro: 'Supabase não disponível neste contexto.' });
        }
        try {
            const { busca } = req.query;

            const [
                { data: classes,     error: e1 },
                { data: turmas,      error: e2 },
                { data: disciplinas, error: e3 },
            ] = await Promise.all([
                supabaseAdmin.from('rco_classes').select('cod_classe, cod_turma, cod_disciplina, cod_estabelecimento, periodo_letivo'),
                supabaseAdmin.from('rco_turmas').select('cod_turma, descr_turma'),
                supabaseAdmin.from('rco_disciplinas').select('cod_disciplina, nome_disciplina, sigla'),
            ]);

            if (e1 || e2 || e3) {
                const msg = (e1 || e2 || e3).message;
                console.error('[RCO-LANC] Erro ao buscar classes do Supabase:', msg);
                return res.status(500).json({ erro: msg });
            }

            /* Índices para join */
            const turmaIdx = {};
            (turmas || []).forEach(t => { turmaIdx[t.cod_turma] = t; });
            const discIdx = {};
            (disciplinas || []).forEach(d => { discIdx[d.cod_disciplina] = d; });

            let lista = (classes || []).map(c => {
                const t = turmaIdx[c.cod_turma] || {};
                const d = discIdx[c.cod_disciplina] || {};
                return {
                    codClasse:      c.cod_classe,
                    codTurma:       c.cod_turma,
                    descrTurma:     t.descr_turma || `Turma ${c.cod_turma}`,
                    codDisciplina:  c.cod_disciplina,
                    nomeDisciplina: d.nome_disciplina || '',
                    siglaDisciplina:d.sigla || '',
                    periodoLetivo:  c.periodo_letivo || '',
                    label:          `${t.descr_turma || c.cod_turma} — ${d.nome_disciplina || c.cod_disciplina}`,
                };
            });

            /* Filtragem por texto se fornecido */
            if (busca) {
                const q = busca.toLowerCase();
                lista = lista.filter(c =>
                    c.label.toLowerCase().includes(q) ||
                    String(c.codClasse).includes(q)
                );
            }

            /* Ordena por turma → disciplina */
            lista.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

            res.json(lista);
        } catch (e) {
            console.error('[RCO-LANC] Erro ao listar classes:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── GET /api/rco-lancamento/avaliacoes
       Lista avaliações parciais de uma classe RCO.
       Query: codClasse, codPeriodoAvaliacao (default 9), codRegraCalculo (default 3), qtdeAvaliacao (default 2)
    ─────────────────────────────────────────────────────── */
    router.get('/rco-lancamento/avaliacoes', async (req, res) => {
        const { codClasse, codPeriodoAvaliacao = 9, codRegraCalculo = 3, qtdeAvaliacao = 2 } = req.query;
        if (!codClasse) return res.status(400).json({ erro: 'codClasse obrigatório' });
        try {
            const r = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codRegraCalculo=${codRegraCalculo}&qtdeAvaliacao=${qtdeAvaliacao}&page=1&perPage=50`
            );
            if (r.status !== 200) {
                return res.status(r.status).json({ erro: 'Erro ao buscar avaliações no RCO', detalhe: r.data });
            }
            res.json(r.data);
        } catch (e) {
            console.error('[RCO-LANC] Erro ao listar avaliações:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── GET /api/rco-lancamento/avaliacoes/:id
       Retorna avaliação completa com lista de alunos para preenchimento.
    ─────────────────────────────────────────────────────── */
    router.get('/rco-lancamento/avaliacoes/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const r = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=recuperacaos,recuperadas,alunos,conteudos`
            );
            if (r.status !== 200) {
                return res.status(r.status).json({ erro: 'Avaliação não encontrada no RCO', detalhe: r.data });
            }

            /* Debug: loga todos os campos de avaliações de recuperação para entender a estrutura */
            const tipoAv = Number(r.data?.codTipoAvaliacaoParcial ?? 0);
            if (tipoAv === 2) {
                const { alunos: _al, ...semAlunos } = r.data ?? {};
                console.log(`[RCO-LANC] Estrutura da avaliação de recuperação ${id}:`, JSON.stringify(semAlunos, null, 2));
            }

            /* Enriquece a lista de alunos com nome e numChamada.
               Estratégia (em ordem de prioridade):
               1. Busca roster da turma direto no RCO via codClasse da avaliação
               2. Fallback: Supabase por nome (se o roster RCO falhar)
               O RCO retorna apenas codMatrizAluno + notaDecimal nos alunos da avaliação. */
            const alunos = r.data?.alunos ?? [];
            if (alunos.length > 0) {
                let rosterMap = {};    /* codMatrizAluno (string) → { nome, numChamada } */

                /* Estratégia 1: roster RCO pelo codClasse passado pelo frontend via query param */
                const codClasse = req.query.codClasse ?? null;
                if (codClasse) {
                    try {
                        const codPeriodoAvaliacao = process.env.RCO_COD_PERIODO_AVALIACAO ?? 9;
                        const rosterR = await rcoApiService.get(
                            `${RCO_CLASSE_BASE}/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`
                        );
                        const roster = Array.isArray(rosterR.data) ? rosterR.data : [];
                        roster.forEach(s => {
                            if (s.codMatrizAluno) {
                                rosterMap[String(s.codMatrizAluno)] = {
                                    nome:       s.nome       ?? null,
                                    numChamada: s.numChamada ?? null,
                                };
                            }
                        });
                    } catch (e) {
                        console.warn('[RCO-LANC] Roster RCO falhou:', e.message);
                    }
                }

                /* Estratégia 2: Supabase por registro (fallback se roster RCO falhou) */
                if (Object.keys(rosterMap).length === 0 && supabaseAdmin) {
                    const registros = alunos.map(a => String(a.codMatrizAluno)).filter(Boolean);
                    const { data: aluSupa } = await supabaseAdmin
                        .from('alunos').select('registro, nome, numchamada').in('registro', registros);
                    (aluSupa || []).forEach(a => {
                        rosterMap[String(a.registro)] = {
                            nome:       a.nome       ?? null,
                            numChamada: a.numchamada ?? null,
                        };
                    });
                }

                r.data.alunos = alunos.map(a => ({
                    ...a,
                    nome:       rosterMap[String(a.codMatrizAluno)]?.nome       ?? null,
                    numChamada: rosterMap[String(a.codMatrizAluno)]?.numChamada ?? null,
                }));
            }

            res.json(r.data);
        } catch (e) {
            console.error('[RCO-LANC] Erro ao buscar avaliação:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── GET /api/rco-lancamento/conteudos-sugeridos?codClasse=X
       Retorna conteúdos únicos encontrados nas demais avaliações da classe.
       Usado pelo modal de seleção de conteúdos quando a avaliação alvo
       não tem conteúdos vinculados e o RCO rejeita o lançamento.
    ─────────────────────────────────────────────────────── */
    router.get('/rco-lancamento/conteudos-sugeridos', async (req, res) => {
        const { codClasse, codPeriodoAvaliacao = 9, codRegraCalculo = 1, qtdeAvaliacao = 2 } = req.query;
        if (!codClasse) return res.status(400).json({ erro: 'codClasse é obrigatório.' });

        try {
            /* Busca lista de avaliações da classe */
            const listR = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}` +
                `&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codRegraCalculo=${codRegraCalculo}` +
                `&qtdeAvaliacao=${qtdeAvaliacao}&page=1&perPage=50`
            );
            const avaliacoes = Array.isArray(listR.data) ? listR.data : (listR.data?.content ?? []);

            /* Para cada avaliação, busca conteúdos com timeout de 3 s por request */
            const conteudosUnicos = new Map(); /* descrConteudo → objeto completo */

            await Promise.allSettled(
                avaliacoes.map(async av => {
                    try {
                        const r = await rcoApiService.get(
                            `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${av.codAvaliacaoParcialClasse}?listas=conteudos`
                        );
                        const lista = r.data?.conteudos ?? [];
                        lista.forEach(c => {
                            const chave = (c.descrConteudo ?? '').trim();
                            if (chave && !conteudosUnicos.has(chave)) {
                                conteudosUnicos.set(chave, c);
                            }
                        });
                    } catch { /* ignora falha individual */ }
                })
            );

            res.json([...conteudosUnicos.values()]);
        } catch (e) {
            console.error('[RCO-LANC] Erro ao buscar conteúdos sugeridos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── POST /api/rco-lancamento/avaliacoes/:id/lancar
       Lança notas no RCO com três camadas de proteção:
         1. Validação de entrada (antes do PUT)
         2. Verificação pós-PUT: GET confirma o que o RCO realmente salvou
         3. Persistência no banco com os valores VERIFICADOS do RCO
       Nota: meta.conteudos (se presente) é re-enviado ao RCO via spread do meta.
       Retorna HTTP 207 (Multi-Status) se o PUT ao RCO foi OK mas o banco falhou.
    ─────────────────────────────────────────────────────── */
    router.post('/rco-lancamento/avaliacoes/:id/lancar', async (req, res) => {
        const { id } = req.params;
        const { meta, alunos } = req.body;

        /* ── Log do body recebido do frontend ── */
        console.log(`[RCO-LANC] ► BODY recebido (avaliacaoId=${id}):`);
        console.log(`[RCO-LANC]   meta:`, JSON.stringify(meta, null, 2));
        console.log(`[RCO-LANC]   alunos (${alunos?.length ?? 0}):`, JSON.stringify(alunos, null, 2));

        /* ── 1. Validação de entrada ── */
        const codAvParam = Number(id);
        if (!Number.isFinite(codAvParam) || codAvParam <= 0) {
            return res.status(400).json({ erro: 'ID de avaliação inválido no path.' });
        }
        if (!meta || !alunos?.length) {
            return res.status(400).json({ erro: 'meta e alunos são obrigatórios.' });
        }

        /* Consistência do ID no body vs. path */
        if (Number(meta.codAvaliacaoParcialClasse) !== codAvParam) {
            return res.status(400).json({
                erro: 'ID no path difere de meta.codAvaliacaoParcialClasse — possível adulteração de requisição.',
            });
        }

        const pesoMax = Number(meta.pesoDecimal);
        if (!Number.isFinite(pesoMax) || pesoMax <= 0) {
            return res.status(400).json({ erro: 'meta.pesoDecimal ausente ou inválido.' });
        }

        if (Number(meta.codTipoAvaliacaoParcial) === 2) {
            console.warn(`[RCO-LANC] Avaliação ${id} é tipo=2 (recuperação) — a API do RCO não suporta escrita para recuperações.`);
            return res.status(422).json({
                erro: 'O RCO Digital não permite lançar notas de recuperação via API. Essa operação precisa ser feita manualmente no site do RCO.',
                tipo: 'recuperacao_nao_suportada',
                origem: 'RCO',
            });
        }

        /* Validação por aluno */
        const errosValidacao = [];
        const codsVistos     = new Set();
        for (const a of alunos) {
            const cod  = Number(a.codMatrizAluno);
            const nota = Number(a.notaDecimal);
            if (!Number.isFinite(cod) || cod <= 0) {
                errosValidacao.push(`codMatrizAluno inválido: ${JSON.stringify(a.codMatrizAluno)}`);
                continue;
            }
            if (codsVistos.has(cod)) {
                errosValidacao.push(`codMatrizAluno duplicado: ${cod}`);
                continue;
            }
            codsVistos.add(cod);
            /* Tolerância de 0.05 para arredondamentos de ponto flutuante */
            if (!Number.isFinite(nota) || nota < 0 || nota > pesoMax + 0.05) {
                errosValidacao.push(
                    `Nota inválida para aluno ${cod}: ${a.notaDecimal} (intervalo permitido: [0, ${pesoMax}])`
                );
            }
        }
        if (errosValidacao.length > 0) {
            return res.status(400).json({ erro: 'Validação dos dados falhou.', detalhes: errosValidacao });
        }

        /* ── 2. PUT no RCO ── */
        try {
            const token      = await rcoApiService.getToken();
            const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
            const codUsuario = Number(jwtPayload.resoucreowner_id || jwtPayload.resouceowner_id || 0);
            const agora      = new Date().toISOString().replace('Z', '+0000');

            const isRec      = Number(meta.codTipoAvaliacaoParcial) === 2;
            const nRecs      = meta.recuperacaos?.length  ?? 0;
            const nRecupDe   = meta.recuperadas?.length   ?? 0;
            const nConteudos = meta.conteudos?.length     ?? 0;
            console.log(
                `[RCO-LANC] PUT avaliação ${id} | tipo=${isRec ? 'RECUPERAÇÃO' : 'PRINCIPAL'}` +
                ` | alunos=${alunos.length} | recuperacaos=${nRecs} | recuperadas=${nRecupDe}` +
                ` | conteudos=${nConteudos} | codUsuario=${codUsuario}`
            );

            /* Alunos limpos para envio ao RCO: só campos originais, sem campos internos do EduSync */
            const alunosParaRco = alunos.map(({ codAvaliacaoParcialAluno, codMatrizAluno, notaDecimal }) => ({
                ...(codAvaliacaoParcialAluno != null ? { codAvaliacaoParcialAluno } : {}),
                codMatrizAluno,
                notaDecimal,
            }));

            let putPayload;
            if (isRec) {
                /* Recuperação (tipo=2):
                   - GET da avaliação determina se já existe (dataAtualizacao presente = já persistida).
                   - Já existe → PUT /avaliacaoParcialClasses/{id} com payload completo.
                   - Nova → POST /avaliacaoParcialClasses sem ID.
                   - GET falha → aborta (não arrisca POST duplicado). */
                let evalBase  = null;
                let alunosRcoMap = {};
                let matrizMap    = {};
                let recJaExiste  = false;

                /* ── Passo 1: GET da avaliação (obrigatório para recuperação) ── */
                const gr = await rcoApiService.get(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=recuperacaos,recuperadas,alunos,conteudos`
                );
                if (gr.status !== 200 || !gr.data) {
                    console.error(`[RCO-LANC] GET avaliação ${id} falhou (status ${gr.status}) — abortando lançamento.`);
                    return res.status(502).json({
                        erro: `Não foi possível consultar a avaliação ${id} no RCO antes do lançamento.`,
                        origem: 'RCO',
                    });
                }

                const grData = gr.data;
                const limparAninhados = arr => (arr ?? []).map(({ alunos: _a, ...r }) => r);
                (grData.alunos ?? []).forEach(a => {
                    alunosRcoMap[String(a.codMatrizAluno)] = a;
                });

                recJaExiste = !!(grData.dataAtualizacao);

                if (recJaExiste) {
                    evalBase = {
                        codAvaliacaoParcialClasse: grData.codAvaliacaoParcialClasse,
                        codTipoAvaliacaoParcial:   grData.codTipoAvaliacaoParcial,
                        numAvaliacaoParcial:       grData.numAvaliacaoParcial,
                        dataAvaliacaoParcial:      grData.dataAvaliacaoParcial,
                        pesoDecimal:               Number(grData.pesoDecimal),
                        dataAtualizacao:           grData.dataAtualizacao,
                        codUsuario,
                        recuperadas:               limparAninhados(grData.recuperadas),
                    };
                    console.log(`[RCO-LANC] Avaliação ${id} JÁ EXISTE (dataAtualizacao=${grData.dataAtualizacao}), usando PUT.`);
                } else {
                    evalBase = {
                        codTipoAvaliacaoParcial: grData.codTipoAvaliacaoParcial,
                        dataAvaliacaoParcial:    grData.dataAvaliacaoParcial,
                        numAvaliacaoParcial:     grData.numAvaliacaoParcial,
                        pesoDecimal:             Number(grData.pesoDecimal),
                        recuperadas:             limparAninhados(grData.recuperadas),
                    };
                    console.log(`[RCO-LANC] Avaliação ${id} NOVA (sem dataAtualizacao), usando POST.`);
                }

                /* ── Passo 2: GET /matrizAlunos ── */
                const codClasse        = meta.codClasse ?? null;
                const periodoAvaliacao = process.env.RCO_COD_PERIODO_AVALIACAO ?? 9;
                const pesoStr          = String(meta.pesoDecimal ?? '').replace(',', '.');
                if (codClasse) {
                    try {
                        const mr = await rcoApiService.get(
                            `${RCO_CLASSE_BASE}/matrizAlunos?codClasse=${codClasse}` +
                            `&codPeriodoAvaliacao=${periodoAvaliacao}&data=2026-12-31&pesoDecimal=${pesoStr}`
                        );
                        if (mr.status === 200 && Array.isArray(mr.data)) {
                            mr.data.forEach(a => { matrizMap[String(a.codMatrizAluno)] = a; });
                            console.log(`[RCO-LANC] matrizAlunos OK — ${mr.data.length} alunos carregados.`);
                        } else {
                            console.warn(`[RCO-LANC] matrizAlunos retornou status ${mr.status}.`);
                        }
                    } catch (e) {
                        console.warn('[RCO-LANC] matrizAlunos falhou:', e.message);
                    }
                } else {
                    console.warn('[RCO-LANC] codClasse ausente no meta — matrizAlunos não chamado.');
                }

                /* ── Passo 3: Mapa de notas do frontend (source of truth) ── */
                const notaMap = {};
                alunos.forEach(a => { notaMap[String(a.codMatrizAluno)] = a.notaDecimal; });

                /* ── Passo 4: Monta lista de alunos ──
                   Itera sobre TODOS os alunos do RCO (alunosRcoMap), enriquecendo
                   com matrizAlunos e aplicando notas do frontend.
                   PUT: inclui codAvaliacaoParcialAluno; POST: sem ele.
                   Alunos sem nota no Classroom mantêm a nota original do RCO (do GET). */
                const allRcoKeys = new Set(Object.keys(alunosRcoMap));
                alunos.forEach(a => allRcoKeys.add(String(a.codMatrizAluno)));

                const alunosEnviar = [];
                for (const key of allRcoKeys) {
                    const aRco     = alunosRcoMap[key];
                    const mAluno   = matrizMap[key] ?? {};
                    const notaCalc = notaMap[key];
                    const codMatriz = Number(key);

                    let notaFinal;
                    if (notaCalc != null) {
                        notaFinal = Number(notaCalc).toFixed(1);
                    } else if (aRco?.notaDecimal != null && aRco.notaDecimal !== '') {
                        notaFinal = Number(aRco.notaDecimal).toFixed(1);
                    } else {
                        notaFinal = '0.0';
                    }

                    const aluno = {
                        ...(recJaExiste && aRco?.codAvaliacaoParcialAluno != null
                            ? { codAvaliacaoParcialAluno: aRco.codAvaliacaoParcialAluno } : {}),
                        codMatrizAluno: codMatriz,
                        ...(mAluno.numChamada        != null ? { numChamada: mAluno.numChamada }               : {}),
                        ...(mAluno.nome              != null ? { nome: mAluno.nome }                           : {}),
                        ...(mAluno.indAtivo          != null ? { indAtivo: mAluno.indAtivo }                   : {}),
                        ...(mAluno.situacaoMatricula != null ? { situacaoMatricula: mAluno.situacaoMatricula } : {}),
                        ...(mAluno.cgmAluno          != null ? { cgmAluno: mAluno.cgmAluno }                   : {}),
                        notaDecimal: notaFinal,
                    };
                    alunosEnviar.push(aluno);
                }

                putPayload = { ...evalBase, alunos: alunosEnviar };

                const metodoRec = recJaExiste ? 'PUT' : 'POST';
                console.log(`[RCO-LANC] Payload ${metodoRec} recuperação (base):`, JSON.stringify({
                    ...putPayload,
                    alunos: `[${alunosEnviar.length} alunos]`,
                }, null, 2));
            } else {
                putPayload = { ...meta, codUsuario, dataAtualizacao: agora, alunos: alunosParaRco };
            }

            /* Decide método HTTP:
               - Tipo 1 (normal): sempre PUT
               - Tipo 2 (recuperação) que JÁ EXISTE: PUT com ID (atualização)
               - Tipo 2 (recuperação) NOVA: POST sem ID (criação) */
            const recJaExiste = isRec && putPayload.codAvaliacaoParcialClasse != null;
            const usarPut     = !isRec || recJaExiste;
            const r = usarPut
                ? await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`,
                    putPayload,
                    { grupo: 'D' }
                  )
                : await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    putPayload,
                    { grupo: 'D' }
                  );

            if (r.status >= 400) {
                const rcoMsg = typeof r.data === 'string'
                    ? r.data
                    : (r.data?.message ?? r.data?.erro ?? r.data?.msg ?? JSON.stringify(r.data));
                const metodo = usarPut ? 'PUT' : 'POST';
                console.error(`[RCO-LANC] Erro no ${metodo} RCO (${r.status}):`, rcoMsg);
                console.error(`[RCO-LANC] Body completo do erro RCO:`, JSON.stringify(r.data, null, 2));
                console.error(`[RCO-LANC] Payload enviado ao RCO (${metodo} tipo=${isRec ? 2 : 1}):`, JSON.stringify({
                    ...putPayload,
                    alunos: putPayload?.alunos?.slice(0, 3),
                    _qtdeAlunos: putPayload?.alunos?.length,
                }, null, 2));
                return res.status(r.status).json({
                    erro:    rcoMsg || 'Erro desconhecido ao lançar notas no RCO.',
                    detalhe: r.data,
                    origem:  'RCO',
                });
            }

            const metodoOk = usarPut ? 'PUT' : 'POST';
            console.log(`[RCO-LANC] ${metodoOk} OK (status ${r.status}). Iniciando verificação pós-lançamento...`);

            /* ── 3. Verificação pós-PUT: GET para confirmar valores no RCO ── */
            let rcoVerificado  = false;
            const notasRco     = {};  /* codMatrizAluno (string) → notaDecimal confirmada pelo RCO */
            try {
                const vr = await rcoApiService.get(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=alunos`
                );
                if (vr.status === 200 && Array.isArray(vr.data?.alunos)) {
                    vr.data.alunos.forEach(a => {
                        notasRco[String(a.codMatrizAluno)] = Number(a.notaDecimal ?? 0);
                    });
                    rcoVerificado = true;

                    /* Loga discrepâncias entre o que foi enviado e o que o RCO salvou */
                    let discrepancias = 0;
                    alunos.forEach(a => {
                        const enviada = Number(a.notaDecimal ?? 0);
                        const real    = notasRco[String(a.codMatrizAluno)];
                        if (real !== undefined && Math.abs(real - enviada) > 0.05) {
                            console.warn(
                                `[RCO-LANC] DISCREPÂNCIA aluno ${a.codMatrizAluno}: enviado=${enviada} RCO=${real}`
                            );
                            discrepancias++;
                        }
                    });
                    if (discrepancias === 0) {
                        console.log(`[RCO-LANC] Verificação OK — todos os ${alunos.length} valores confirmados.`);
                    } else {
                        console.warn(`[RCO-LANC] ${discrepancias} discrepância(s) detectada(s) — banco salva valores reais do RCO.`);
                    }
                }
            } catch (verErr) {
                console.warn('[RCO-LANC] Verificação pós-PUT indisponível:', verErr.message);
            }

            /* ── 4. Persistência no banco com valores reais do RCO ── */
            let dbSalvo = false;
            let dbErro  = null;
            try {
                /* Usa nota verificada (GET) se disponível; fallback para nota enviada */
                const cols   = '(cod_avaliacao_parcial, cod_matriz_aluno, nota_decimal, nota_enviada, usou_recuperacao, matched, verificado)';
                const values = alunos.map((_, i) => {
                    const base = i * 7;
                    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`;
                }).join(', ');
                const params = alunos.flatMap(a => {
                    const codM        = Number(a.codMatrizAluno);
                    const notaEnviada = Number(a.notaDecimal ?? 0);
                    const notaReal    = rcoVerificado
                        ? (notasRco[String(codM)] ?? notaEnviada)
                        : notaEnviada;
                    return [
                        codAvParam,
                        codM,
                        notaReal,         /* nota_decimal — o que o RCO realmente tem */
                        notaEnviada,      /* nota_enviada — o que foi enviado pelo sistema */
                        !!(a.usouRecuperacao ?? false),
                        !!(a.matched ?? (notaEnviada > 0)),
                        rcoVerificado,
                    ];
                });

                await pool.query(
                    `INSERT INTO rco_lancamentos ${cols} VALUES ${values}
                     ON CONFLICT (cod_avaliacao_parcial, cod_matriz_aluno)
                     DO UPDATE SET
                         nota_decimal      = EXCLUDED.nota_decimal,
                         nota_enviada      = EXCLUDED.nota_enviada,
                         usou_recuperacao  = EXCLUDED.usou_recuperacao,
                         matched           = EXCLUDED.matched,
                         verificado        = EXCLUDED.verificado,
                         lancado_em        = NOW()`,
                    params
                );
                dbSalvo = true;
                console.log(`[RCO-LANC] ${alunos.length} registros persistidos em rco_lancamentos (verificado=${rcoVerificado}).`);
            } catch (dbErr_) {
                dbErro = dbErr_.message;
                console.error('[RCO-LANC] CRÍTICO — PUT OK mas banco falhou:', dbErro);
            }

            /* 207 = PUT OK, banco falhou (frontend deve alertar o usuário) */
            return res.status(dbSalvo ? 200 : 207).json({
                ok:            true,
                dbSalvo,
                rcoVerificado,
                dbErro:        dbErro ?? undefined,
                status:        r.status,
                resposta:      r.data,
            });
        } catch (e) {
            console.error('[RCO-LANC] Erro inesperado ao lançar:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── POST /api/rco-lancamento/avaliacoes/:id/salvar-db
       Recuperação de banco: NÃO faz PUT no RCO.
       Lê os valores atuais do RCO via GET e persiste no banco local.
       Usado quando o lançamento foi OK no RCO mas o banco falhou.
       Body: { alunos: [{codMatrizAluno, notaDecimal, usouRecuperacao, matched}] }
    ─────────────────────────────────────────────────────── */
    router.post('/rco-lancamento/avaliacoes/:id/salvar-db', async (req, res) => {
        const { id } = req.params;
        const { alunos } = req.body;

        const codAvParam = Number(id);
        if (!Number.isFinite(codAvParam) || codAvParam <= 0) {
            return res.status(400).json({ erro: 'ID de avaliação inválido.' });
        }
        if (!alunos?.length) {
            return res.status(400).json({ erro: 'alunos são obrigatórios.' });
        }

        try {
            /* GET do RCO para obter os valores verificados */
            let rcoVerificado = false;
            const notasRco    = {};
            try {
                const vr = await rcoApiService.get(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=alunos`
                );
                if (vr.status === 200 && Array.isArray(vr.data?.alunos)) {
                    vr.data.alunos.forEach(a => {
                        notasRco[String(a.codMatrizAluno)] = Number(a.notaDecimal ?? 0);
                    });
                    rcoVerificado = true;
                    console.log(`[RCO-LANC/salvar-db] GET verificado: ${Object.keys(notasRco).length} alunos no RCO.`);
                }
            } catch (verErr) {
                console.warn('[RCO-LANC/salvar-db] GET de verificação falhou:', verErr.message);
            }

            /* Persiste usando valores reais do RCO (ou fallback para o que o frontend enviou) */
            const cols   = '(cod_avaliacao_parcial, cod_matriz_aluno, nota_decimal, nota_enviada, usou_recuperacao, matched, verificado)';
            const values = alunos.map((_, i) => {
                const base = i * 7;
                return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`;
            }).join(', ');
            const params = alunos.flatMap(a => {
                const codM        = Number(a.codMatrizAluno);
                const notaEnviada = Number(a.notaDecimal ?? 0);
                const notaReal    = rcoVerificado ? (notasRco[String(codM)] ?? notaEnviada) : notaEnviada;
                return [
                    codAvParam,
                    codM,
                    notaReal,
                    notaEnviada,
                    !!(a.usouRecuperacao ?? false),
                    !!(a.matched ?? false),
                    rcoVerificado,
                ];
            });

            await pool.query(
                `INSERT INTO rco_lancamentos ${cols} VALUES ${values}
                 ON CONFLICT (cod_avaliacao_parcial, cod_matriz_aluno)
                 DO UPDATE SET
                     nota_decimal      = EXCLUDED.nota_decimal,
                     nota_enviada      = EXCLUDED.nota_enviada,
                     usou_recuperacao  = EXCLUDED.usou_recuperacao,
                     matched           = EXCLUDED.matched,
                     verificado        = EXCLUDED.verificado,
                     lancado_em        = NOW()`,
                params
            );

            console.log(`[RCO-LANC/salvar-db] ${alunos.length} registros salvos (verificado=${rcoVerificado}).`);
            res.json({ ok: true, dbSalvo: true, rcoVerificado });
        } catch (e) {
            console.error('[RCO-LANC/salvar-db] Falha:', e.message);
            res.status(500).json({ ok: false, dbSalvo: false, erro: e.message });
        }
    });

    /* ── GET /api/rco-lancamento/debug/:id
       Retorna dados brutos do RCO para diagnóstico: avaliação, matrizAlunos
       e payload PUT simulado — sem enviar nada ao RCO.
       Query: codClasse (obrigatório para matrizAlunos)
    ─────────────────────────────────────────────────────── */
    router.get('/rco-lancamento/debug/:id', async (req, res) => {
        const { id }        = req.params;
        const { codClasse } = req.query;
        const periodoAv     = process.env.RCO_COD_PERIODO_AVALIACAO ?? 9;
        const resultado     = { id, codClasse, timestamp: new Date().toISOString() };

        /* 1 ── GET avaliação completa */
        try {
            const r = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=recuperacaos,recuperadas,alunos,conteudos`
            );
            resultado.avaliacao = { status: r.status, data: r.data };
        } catch (e) {
            resultado.avaliacao = { erro: e.message };
        }

        /* 2 ── GET matrizAlunos (se codClasse fornecido) */
        if (codClasse) {
            const peso = resultado.avaliacao?.data?.pesoDecimal ?? '4.0';
            try {
                const r = await rcoApiService.get(
                    `${RCO_CLASSE_BASE}/matrizAlunos?codClasse=${codClasse}` +
                    `&codPeriodoAvaliacao=${periodoAv}&data=2026-12-31&pesoDecimal=${peso}`
                );
                resultado.matrizAlunos = { status: r.status, data: r.data };
            } catch (e) {
                resultado.matrizAlunos = { erro: e.message };
            }
        } else {
            resultado.matrizAlunos = { aviso: 'codClasse não fornecido — endpoint não chamado.' };
        }

        /* 3 ── GET relatorios/avaliacaoAlunos (roster) */
        if (codClasse) {
            try {
                const r = await rcoApiService.get(
                    `${RCO_CLASSE_BASE}/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${periodoAv}`
                );
                resultado.rosterAlunos = { status: r.status, data: r.data };
            } catch (e) {
                resultado.rosterAlunos = { erro: e.message };
            }
        }

        /* 4 ── Token decodificado */
        try {
            const token      = await rcoApiService.getToken();
            const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
            resultado.tokenInfo = {
                codUsuario: jwtPayload.resoucreowner_id || jwtPayload.resouceowner_id,
                exp: new Date(jwtPayload.exp * 1000).toISOString(),
                sub: jwtPayload.sub,
            };
        } catch (e) {
            resultado.tokenInfo = { erro: e.message };
        }

        /* 5 ── Payload PUT simulado (tipo=2) */
        const av     = resultado.avaliacao?.data;
        const matriz = resultado.matrizAlunos?.data;
        if (av && Array.isArray(av.alunos) && Array.isArray(matriz)) {
            const matrizMap = {};
            matriz.forEach(a => { matrizMap[String(a.codMatrizAluno)] = a; });

            const limparAninhados = arr => (arr ?? []).map(({ alunos: _a, ...r }) => r);
            const base = {
                codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse,
                codTipoAvaliacaoParcial:   av.codTipoAvaliacaoParcial,
                numAvaliacaoParcial:        av.numAvaliacaoParcial,
                dataAvaliacaoParcial:       av.dataAvaliacaoParcial,
                pesoDecimal:                Number(av.pesoDecimal),
                dataAtualizacao:            av.dataAtualizacao,
                codUsuario:                 resultado.tokenInfo?.codUsuario ?? 0,
                recuperadas:                limparAninhados(av.recuperadas),
            };
            const alunosSimulados = av.alunos.map(a => {
                const m = matrizMap[String(a.codMatrizAluno)] ?? {};
                return {
                    codAvaliacaoParcialAluno: a.codAvaliacaoParcialAluno,
                    codMatrizAluno:           a.codMatrizAluno,
                    ...(m.numChamada        != null ? { numChamada: m.numChamada }               : {}),
                    ...(m.nome              != null ? { nome: m.nome }                           : {}),
                    ...(m.indAtivo          != null ? { indAtivo: m.indAtivo }                   : {}),
                    ...(m.situacaoMatricula != null ? { situacaoMatricula: m.situacaoMatricula } : {}),
                    ...(m.cgmAluno          != null ? { cgmAluno: m.cgmAluno }                   : {}),
                    notaDecimal: a.notaDecimal ?? null,
                    _temMatriz:  !!m.codMatrizAluno,
                };
            });
            resultado.payloadPutSimulado = {
                ...base,
                alunos: alunosSimulados,
                _resumo: {
                    totalAlunos:        av.alunos.length,
                    comMatriz:          alunosSimulados.filter(a => a._temMatriz).length,
                    semMatriz:          alunosSimulados.filter(a => !a._temMatriz).length,
                    comNotaAtual:       alunosSimulados.filter(a => a.notaDecimal != null).length,
                    camposEmFalta:      alunosSimulados.filter(a => !a._temMatriz).map(a => a.codMatrizAluno),
                },
            };
        }

        res.json(resultado);
    });

    /* ── GET /api/rco-lancamento/debug/:id/put-variations
       Testa variações do payload PUT contra o RCO para diagnóstico.
       Usa alunos: [] em todas as variações (mínimo possível).
    ─────────────────────────────────────────────────────── */
    router.get('/rco-lancamento/debug/:id/put-variations', async (req, res) => {
        const id = req.params.id;
        const resultados = [];

        /* GET avaliação base */
        let av;
        try {
            const gr = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=recuperacaos,recuperadas,alunos,conteudos`
            );
            av = gr.data;
        } catch (e) {
            return res.status(500).json({ erro: 'GET falhou: ' + e.message });
        }

        const agora = new Date().toISOString().replace('Z', '+0000');
        const token = req.session?.codUsuario ?? av.codUsuario;

        const limpar = arr => (arr ?? []).map(({ alunos: _a, ...r }) => ({
            ...r,
            pesoDecimal: Number(r.pesoDecimal),
        }));

        const base = {
            codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse,
            codTipoAvaliacaoParcial:   av.codTipoAvaliacaoParcial,
            numAvaliacaoParcial:       av.numAvaliacaoParcial,
            dataAvaliacaoParcial:      av.dataAvaliacaoParcial,
            pesoDecimal:               Number(av.pesoDecimal),
            dataAtualizacao:           agora,
            codUsuario:                token,
        };

        /* Um aluno de amostra para V5 */
        const alunoAmostra = (av.alunos ?? []).slice(0, 1).map(a => ({
            codAvaliacaoParcialAluno: a.codAvaliacaoParcialAluno,
            codMatrizAluno:           a.codMatrizAluno,
            notaDecimal:              '0.0',
        }));

        const recOriginal   = limpar(av.recuperadas);
        const recMinimo     = (av.recuperadas ?? []).map(r => ({ codAvaliacaoParcialClasse: r.codAvaliacaoParcialClasse }));
        const recStringPeso = (av.recuperadas ?? []).map(({ alunos: _a, ...r }) => r);  /* pesoDecimal como string */

        const variacoes = [
            /* --- Testes anteriores confirmados --- */
            { label: 'V1: base + recuperadas completas + alunos: []',    payload: { ...base, recuperadas: recOriginal,   alunos: [] } },
            { label: 'V2: base SEM recuperadas + alunos: []',            payload: { ...base,                             alunos: [] } },
            { label: 'V3: base + recuperadas: [] vazio + alunos: []',    payload: { ...base, recuperadas: [],            alunos: [] } },
            /* --- Novos testes cirúrgicos --- */
            { label: 'V4: recuperadas SÓ com codAvaliacaoParcialClasse', payload: { ...base, recuperadas: recMinimo,     alunos: [] } },
            { label: 'V5: recuperadas com pesoDecimal STRING "4.0"',     payload: { ...base, recuperadas: recStringPeso, alunos: [] } },
            { label: 'V6: pesoDecimal top-level como STRING "4.0"',      payload: { ...base, pesoDecimal: av.pesoDecimal, recuperadas: recOriginal, alunos: [] } },
            { label: 'V7: pesoDecimal STRING top + recuperadas STRING',  payload: { ...base, pesoDecimal: av.pesoDecimal, recuperadas: recStringPeso, alunos: [] } },
            { label: 'V8: sem codUsuario top-level',                     payload: { ...base, codUsuario: undefined, recuperadas: recOriginal, alunos: [] } },
            { label: 'V9: sem dataAtualizacao top-level',                payload: { ...base, dataAtualizacao: undefined, recuperadas: recOriginal, alunos: [] } },
            { label: 'V10: recuperadas com 1 aluno 0.0 dentro',         payload: { ...base, recuperadas: recOriginal.map(r => ({...r, alunos: alunoAmostra})), alunos: [] } },
        ];

        for (const { label, payload } of variacoes) {
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${av.codAvaliacaoParcialClasse}`,
                    payload,
                    { grupo: 'D' }   /* mesmo header que o lançamento real */
                );
                const ok = r.status < 400;
                resultados.push({ label, status: r.status, ok, body: ok ? undefined : r.data });
            } catch (e) {
                const status = e.response?.status ?? 'ERR';
                const body   = e.response?.data   ?? e.message;
                resultados.push({ label, status, ok: false, body });
            }
        }

        res.json({ avaliacaoId: id, agora, resultados });
    });

    /* ── POST /api/rco-lancamento/avaliacoes/:id/debug-put
       Rota de diagnóstico: testa PUT no RCO com variações mínimas
       para isolar qual campo/formato causa o erro 500.
       ⚠️ Apenas disponível em ambiente de desenvolvimento.
    ─────────────────────────────────────────────────────── */
    router.post('/rco-lancamento/avaliacoes/:id/debug-put', (req, res, next) => {
        if (process.env.NODE_ENV === 'production') return res.status(404).json({ erro: 'Rota indisponível.' });
        next();
    }, async (req, res) => {
        const { id } = req.params;
        const resultados = [];
        const log = (msg) => { console.log(`[DEBUG-PUT] ${msg}`); };

        try {
            const token      = await rcoApiService.getToken();
            const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
            const codUsuario = Number(jwtPayload.resoucreowner_id || jwtPayload.resouceowner_id || 0);

            log(`=== INÍCIO DEBUG para avaliação ${id} ===`);
            log(`codUsuario: ${codUsuario}`);

            /* Passo 1: GET completo da avaliação */
            const gr = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=recuperacaos,recuperadas,alunos,conteudos`
            );
            if (gr.status !== 200 || !gr.data) {
                return res.status(502).json({ erro: `GET falhou (status ${gr.status})` });
            }
            const av = gr.data;
            log(`GET OK. Campos top-level: ${Object.keys(av).join(', ')}`);
            log(`pesoDecimal: ${JSON.stringify(av.pesoDecimal)} (tipo: ${typeof av.pesoDecimal})`);
            log(`dataAtualizacao: ${av.dataAtualizacao}`);
            log(`alunos: ${av.alunos?.length ?? 0}`);
            log(`recuperadas: ${av.recuperadas?.length ?? 0}`);
            log(`recuperacaos: ${av.recuperacaos?.length ?? 0}`);
            log(`conteudos: ${av.conteudos?.length ?? 0}`);

            /* Passo 2: GET matrizAlunos */
            const codClasse = req.body.codClasse ?? req.query.codClasse;
            let matrizMap = {};
            if (codClasse) {
                const mr = await rcoApiService.get(
                    `${RCO_CLASSE_BASE}/matrizAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=9&data=2026-12-31&pesoDecimal=4.0`
                );
                if (mr.status === 200 && Array.isArray(mr.data)) {
                    mr.data.forEach(a => { matrizMap[String(a.codMatrizAluno)] = a; });
                    log(`matrizAlunos OK: ${mr.data.length}`);
                }
            }

            /* Pegar 1 aluno com nota existente como cobaia */
            const alunoComNota = av.alunos.find(a => a.notaDecimal != null && Number(a.notaDecimal) > 0);
            if (!alunoComNota) {
                return res.status(400).json({ erro: 'Nenhum aluno com nota encontrado para teste.' });
            }
            const mAluno = matrizMap[String(alunoComNota.codMatrizAluno)] ?? {};
            log(`Aluno cobaia: ${alunoComNota.codMatrizAluno} (nota original: ${alunoComNota.notaDecimal})`);

            const limpar = arr => (arr ?? []).map(({ alunos: _a, ...r }) => r);

            /* ══════════════════════════════════════════════════
               TESTE A: PUT idêntico ao GET (echo-back)
               Envia exatamente o que recebeu do GET
            ══════════════════════════════════════════════════ */
            const testeA = {
                ...av,
                alunos: av.alunos,
                recuperadas: limpar(av.recuperadas),
                recuperacaos: undefined,
                conteudos: undefined,
                descrAvaliacaoParcial: undefined,
            };
            delete testeA.recuperacaos;
            delete testeA.conteudos;
            delete testeA.descrAvaliacaoParcial;

            log(`\n── TESTE A: Echo-back do GET (sem recuperacaos/conteudos/descr) ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeA, { grupo: 'D' }
                );
                log(`A: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`A body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'A: Echo-back GET', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`A: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'A: Echo-back GET', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE B: PUT mínimo — só 1 aluno, nota inalterada
            ══════════════════════════════════════════════════ */
            const testeB = {
                codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse,
                codTipoAvaliacaoParcial:   av.codTipoAvaliacaoParcial,
                numAvaliacaoParcial:       av.numAvaliacaoParcial,
                dataAvaliacaoParcial:      av.dataAvaliacaoParcial,
                pesoDecimal:               av.pesoDecimal,
                dataAtualizacao:           av.dataAtualizacao,
                codUsuario,
                recuperadas:               limpar(av.recuperadas),
                alunos: [{
                    codAvaliacaoParcialAluno: alunoComNota.codAvaliacaoParcialAluno,
                    codMatrizAluno:           alunoComNota.codMatrizAluno,
                    notaDecimal:             alunoComNota.notaDecimal,
                }],
            };

            log(`\n── TESTE B: Mínimo 1 aluno, nota original (${alunoComNota.notaDecimal}) ──`);
            log(`B payload: ${JSON.stringify(testeB, null, 2)}`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeB, { grupo: 'D' }
                );
                log(`B: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`B body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'B: Mínimo 1 aluno', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`B: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'B: Mínimo 1 aluno', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE C: PUT mínimo — 1 aluno, nota como STRING "X.X"
            ══════════════════════════════════════════════════ */
            const testeC = {
                ...testeB,
                alunos: [{
                    codAvaliacaoParcialAluno: alunoComNota.codAvaliacaoParcialAluno,
                    codMatrizAluno:           alunoComNota.codMatrizAluno,
                    notaDecimal:             String(Number(alunoComNota.notaDecimal).toFixed(1)),
                }],
            };

            log(`\n── TESTE C: 1 aluno, nota STRING "${testeC.alunos[0].notaDecimal}" ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeC, { grupo: 'D' }
                );
                log(`C: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`C body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'C: 1 aluno nota STRING', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`C: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'C: 1 aluno nota STRING', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE D: PUT mínimo — 1 aluno completo (com matrizAlunos)
            ══════════════════════════════════════════════════ */
            const testeD = {
                ...testeB,
                alunos: [{
                    codAvaliacaoParcialAluno: alunoComNota.codAvaliacaoParcialAluno,
                    codMatrizAluno:           alunoComNota.codMatrizAluno,
                    numChamada:              mAluno.numChamada ?? alunoComNota.numChamada,
                    nome:                    mAluno.nome ?? '',
                    indAtivo:                mAluno.indAtivo ?? true,
                    situacaoMatricula:       mAluno.situacaoMatricula ?? 'Matric',
                    cgmAluno:                mAluno.cgmAluno ?? 0,
                    notaDecimal:             String(Number(alunoComNota.notaDecimal).toFixed(1)),
                }],
            };

            log(`\n── TESTE D: 1 aluno completo (matrizAlunos) ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeD, { grupo: 'D' }
                );
                log(`D: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`D body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'D: 1 aluno completo', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`D: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'D: 1 aluno completo', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE E: PUT sem recuperadas
            ══════════════════════════════════════════════════ */
            const testeE = { ...testeB };
            delete testeE.recuperadas;

            log(`\n── TESTE E: Sem recuperadas ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeE, { grupo: 'D' }
                );
                log(`E: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`E body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'E: Sem recuperadas', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`E: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'E: Sem recuperadas', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE F: PUT pesoDecimal como string "4.0"
            ══════════════════════════════════════════════════ */
            const testeF = { ...testeB, pesoDecimal: String(av.pesoDecimal) };

            log(`\n── TESTE F: pesoDecimal como string "${testeF.pesoDecimal}" ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeF, { grupo: 'D' }
                );
                log(`F: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`F body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'F: pesoDecimal string', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`F: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'F: pesoDecimal string', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE G: PUT com TODOS os alunos (37), notas originais do GET
            ══════════════════════════════════════════════════ */
            const testeG = {
                ...testeB,
                alunos: av.alunos.map(a => ({
                    codAvaliacaoParcialAluno: a.codAvaliacaoParcialAluno,
                    codMatrizAluno:           a.codMatrizAluno,
                    notaDecimal:             a.notaDecimal ?? 0,
                })),
            };

            log(`\n── TESTE G: Todos ${testeG.alunos.length} alunos, notas originais GET ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeG, { grupo: 'D' }
                );
                log(`G: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`G body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'G: Todos alunos notas GET', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`G: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'G: Todos alunos notas GET', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE H: PUT mínimo SEM header grupo
            ══════════════════════════════════════════════════ */
            log(`\n── TESTE H: PUT mínimo SEM header grupo ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeB
                );
                log(`H: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`H body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'H: PUT sem header grupo', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`H: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'H: PUT sem header grupo', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE I: POST para /avaliacaoParcialClasses (sem ID) — criar nova
            ══════════════════════════════════════════════════ */
            const testeI = { ...testeB };
            delete testeI.codAvaliacaoParcialClasse;
            delete testeI.dataAtualizacao;
            delete testeI.codUsuario;

            log(`\n── TESTE I: POST sem ID (criar nova) ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`, testeI, { grupo: 'D' }
                );
                log(`I: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`I body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'I: POST sem ID', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`I: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'I: POST sem ID', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE J: PUT mínimo com notaDecimal como NÚMERO (não string)
            ══════════════════════════════════════════════════ */
            const testeJ = {
                ...testeB,
                pesoDecimal: Number(av.pesoDecimal),
                alunos: [{
                    codAvaliacaoParcialAluno: alunoComNota.codAvaliacaoParcialAluno,
                    codMatrizAluno:           alunoComNota.codMatrizAluno,
                    notaDecimal:             Number(alunoComNota.notaDecimal),
                }],
            };

            log(`\n── TESTE J: PUT nota como NÚMERO ${testeJ.alunos[0].notaDecimal} ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeJ, { grupo: 'D' }
                );
                log(`J: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`J body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'J: PUT nota NÚMERO', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`J: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'J: PUT nota NÚMERO', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE K: PUT com descrAvaliacaoParcial no top-level (como GET retornou)
            ══════════════════════════════════════════════════ */
            const testeK = {
                ...testeB,
                descrAvaliacaoParcial: av.descrAvaliacaoParcial,
            };

            log(`\n── TESTE K: PUT com descrAvaliacaoParcial top-level ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeK, { grupo: 'D' }
                );
                log(`K: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`K body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'K: PUT com descrAvaliacaoParcial', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`K: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'K: PUT com descrAvaliacaoParcial', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE L: PUT com recuperacaos (lista vazia) além de recuperadas
            ══════════════════════════════════════════════════ */
            const testeL = {
                ...testeB,
                recuperacaos: av.recuperacaos ?? [],
            };

            log(`\n── TESTE L: PUT com recuperacaos ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeL, { grupo: 'D' }
                );
                log(`L: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`L body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'L: PUT com recuperacaos', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`L: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'L: PUT com recuperacaos', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE M: PUT ALL fields from GET + codUsuario current
            ══════════════════════════════════════════════════ */
            const testeM = {
                codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse,
                codTipoAvaliacaoParcial:   av.codTipoAvaliacaoParcial,
                numAvaliacaoParcial:       av.numAvaliacaoParcial,
                dataAvaliacaoParcial:      av.dataAvaliacaoParcial,
                pesoDecimal:               av.pesoDecimal,
                dataAtualizacao:           av.dataAtualizacao,
                codUsuario,
                descrAvaliacaoParcial:     av.descrAvaliacaoParcial,
                recuperadas:               limpar(av.recuperadas),
                recuperacaos:              av.recuperacaos ?? [],
                conteudos:                 av.conteudos ?? [],
                alunos:                    av.alunos,
            };

            log(`\n── TESTE M: PUT com TODOS os campos do GET ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeM, { grupo: 'D' }
                );
                log(`M: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`M body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'M: PUT todos campos', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`M: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'M: PUT todos campos', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE N: PUT na avaliação ORIGINAL (tipo=1) — 56002422
               Testa se o PUT funciona para avaliações normais
            ══════════════════════════════════════════════════ */
            const idOriginal = av.recuperadas?.[0]?.codAvaliacaoParcialClasse;
            if (idOriginal) {
                log(`\n── TESTE N: PUT na avaliação ORIGINAL tipo=1 (${idOriginal}) ──`);
                try {
                    const grOrig = await rcoApiService.get(
                        `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${idOriginal}?listas=alunos,conteudos`
                    );
                    if (grOrig.status === 200 && grOrig.data) {
                        const avOrig = grOrig.data;
                        const alunoOrigCobaia = avOrig.alunos?.find(a => a.notaDecimal != null && Number(a.notaDecimal) > 0);
                        if (alunoOrigCobaia) {
                            const payloadN = {
                                codAvaliacaoParcialClasse: avOrig.codAvaliacaoParcialClasse,
                                codTipoAvaliacaoParcial:   avOrig.codTipoAvaliacaoParcial,
                                numAvaliacaoParcial:       avOrig.numAvaliacaoParcial,
                                dataAvaliacaoParcial:      avOrig.dataAvaliacaoParcial,
                                pesoDecimal:               avOrig.pesoDecimal,
                                dataAtualizacao:           avOrig.dataAtualizacao,
                                codUsuario,
                                alunos: [{
                                    codAvaliacaoParcialAluno: alunoOrigCobaia.codAvaliacaoParcialAluno,
                                    codMatrizAluno:           alunoOrigCobaia.codMatrizAluno,
                                    notaDecimal:             alunoOrigCobaia.notaDecimal,
                                }],
                            };
                            log(`N payload: ${JSON.stringify(payloadN, null, 2)}`);
                            const r = await rcoApiService.put(
                                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${idOriginal}`, payloadN, { grupo: 'D' }
                            );
                            log(`N: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                            if (r.status >= 400) log(`N body: ${JSON.stringify(r.data)}`);
                            resultados.push({ teste: `N: PUT tipo=1 (${idOriginal})`, status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
                        }
                    }
                } catch (e) {
                    log(`N: EXCEPTION ${e.message}`);
                    resultados.push({ teste: `N: PUT tipo=1`, status: 'ERR', ok: false, body: e.message });
                }
            }

            /* ══════════════════════════════════════════════════
               TESTE O: PUT com dataAtualizacao ATUAL (não a do GET)
            ══════════════════════════════════════════════════ */
            const agora = new Date().toISOString().replace('Z', '+0000');
            const testeO = {
                ...testeB,
                dataAtualizacao: agora,
            };
            log(`\n── TESTE O: PUT com dataAtualizacao ATUAL (${agora}) ──`);
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, testeO, { grupo: 'D' }
                );
                log(`O: status ${r.status} ${r.status < 400 ? 'OK' : 'ERRO'}`);
                if (r.status >= 400) log(`O body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'O: PUT dataAtualizacao atual', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : undefined });
            } catch (e) {
                log(`O: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'O: PUT dataAtualizacao atual', status: 'ERR', ok: false, body: e.message });
            }

            /* ══════════════════════════════════════════════════
               TESTE P: DELETE da avaliação recuperação e re-POST
               Estratégia: apagar a avaliação existente e recriar via POST
            ══════════════════════════════════════════════════ */
            log(`\n── TESTE P: DELETE avaliação ${id} + re-POST ──`);
            try {
                const delR = await rcoApiService.delete(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`, { grupo: 'D' }
                );
                log(`P-DELETE: status ${delR.status} body: ${JSON.stringify(delR.data)}`);
                resultados.push({ teste: 'P-DELETE', status: delR.status, ok: delR.status < 400, body: delR.status >= 400 ? delR.data : 'deleted' });

                if (delR.status < 400) {
                    const postPayload = {
                        codTipoAvaliacaoParcial: av.codTipoAvaliacaoParcial,
                        dataAvaliacaoParcial:    av.dataAvaliacaoParcial,
                        numAvaliacaoParcial:     av.numAvaliacaoParcial,
                        pesoDecimal:             av.pesoDecimal,
                        recuperadas:             limpar(av.recuperadas),
                        alunos: av.alunos.map(a => ({
                            codMatrizAluno: a.codMatrizAluno,
                            notaDecimal:   a.notaDecimal ?? '0.0',
                        })),
                    };
                    log(`P-POST payload (base): ${JSON.stringify({ ...postPayload, alunos: `[${postPayload.alunos.length}]` }, null, 2)}`);
                    const postR = await rcoApiService.post(
                        `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`, postPayload, { grupo: 'D' }
                    );
                    log(`P-POST: status ${postR.status} ${postR.status < 400 ? 'OK' : 'ERRO'}`);
                    if (postR.status >= 400) log(`P-POST body: ${JSON.stringify(postR.data)}`);
                    resultados.push({ teste: 'P-POST (re-criar)', status: postR.status, ok: postR.status < 400, body: postR.status >= 400 ? postR.data : 'created' });
                }
            } catch (e) {
                log(`P: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'P: DELETE+POST', status: 'ERR', ok: false, body: e.message });
            }

            log(`\n=== RESULTADO FINAL ===`);
            resultados.forEach(r => log(`  ${r.teste}: ${r.ok ? '✅' : '❌'} (${r.status})`));

            res.json({
                avaliacaoId: id,
                codUsuario,
                getOriginal: {
                    pesoDecimal: av.pesoDecimal,
                    pesoTipo: typeof av.pesoDecimal,
                    dataAtualizacao: av.dataAtualizacao,
                    totalAlunos: av.alunos?.length,
                    totalRecuperadas: av.recuperadas?.length,
                    totalRecuperacaos: av.recuperacaos?.length,
                    totalConteudos: av.conteudos?.length,
                    camposTopLevel: Object.keys(av),
                    alunoAmostra: av.alunos?.[0],
                },
                resultados,
            });
        } catch (e) {
            log(`FALHA GERAL: ${e.message}`);
            res.status(500).json({ erro: e.message, stack: e.stack });
        }
    });

    /* ── POST /api/rco-lancamento/debug-recriar-rec
       Recria avaliação de recuperação com diferentes estratégias
       ⚠️ Apenas disponível em ambiente de desenvolvimento.
    ─────────────────────────────────────────────────────── */
    router.post('/rco-lancamento/debug-recriar-rec', (req, res, next) => {
        if (process.env.NODE_ENV === 'production') return res.status(404).json({ erro: 'Rota indisponível.' });
        next();
    }, async (req, res) => {
        const { codClasse } = req.body;
        if (!codClasse) return res.status(400).json({ erro: 'codClasse obrigatório' });

        const resultados = [];
        const log = (msg) => { console.log(`[DEBUG-RECRIAR] ${msg}`); };

        try {
            const token      = await rcoApiService.getToken();
            const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
            const codUsuario = Number(jwtPayload.resoucreowner_id || jwtPayload.resouceowner_id || 0);

            log(`=== RECRIAR RECUPERAÇÃO para classe ${codClasse} ===`);

            const avOrigId = 56002422;
            const grOrig = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${avOrigId}?listas=recuperacaos,recuperadas,alunos,conteudos`
            );
            if (grOrig.status !== 200) {
                return res.status(502).json({ erro: `GET avaliação original ${avOrigId} falhou (${grOrig.status})` });
            }
            const avOrig = grOrig.data;
            log(`GET avaliação original OK: ${avOrig.alunos?.length ?? 0} alunos`);

            const basePayload = {
                codTipoAvaliacaoParcial: 2,
                dataAvaliacaoParcial:    '2026-04-01T00:00:00',
                numAvaliacaoParcial:     1,
                pesoDecimal:             avOrig.pesoDecimal,
                recuperadas: [{
                    codAvaliacaoParcialClasse: avOrigId,
                    codTipoAvaliacaoParcial:   1,
                    numAvaliacaoParcial:       1,
                    dataAvaliacaoParcial:      avOrig.dataAvaliacaoParcial,
                    pesoDecimal:               avOrig.pesoDecimal,
                    dataAtualizacao:           avOrig.dataAtualizacao,
                    codUsuario:               avOrig.codUsuario,
                    descrAvaliacaoParcial:     avOrig.descrAvaliacaoParcial,
                }],
                alunos: (avOrig.alunos ?? []).map(a => ({
                    codMatrizAluno: a.codMatrizAluno,
                    notaDecimal:   '0.0',
                })),
            };

            /* Teste R1: POST /avaliacaoParcialClasses sem query params */
            log(`\n── R1: POST sem query params ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    basePayload, { grupo: 'D' }
                );
                log(`R1: status ${r.status}`);
                if (r.status >= 400) log(`R1 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R1: POST sem query', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R1: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R1', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R2: POST /avaliacaoParcialClasses?codClasse=... */
            log(`\n── R2: POST com ?codClasse=${codClasse} ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}`,
                    basePayload, { grupo: 'D' }
                );
                log(`R2: status ${r.status}`);
                if (r.status >= 400) log(`R2 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R2: POST com codClasse', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R2: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R2', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R3: POST com codClasse no body */
            log(`\n── R3: POST com codClasse no body ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    { ...basePayload, codClasse: Number(codClasse) }, { grupo: 'D' }
                );
                log(`R3: status ${r.status}`);
                if (r.status >= 400) log(`R3 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R3: POST codClasse body', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R3: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R3', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R4: POST com codClasse em query E body, + codUsuario */
            log(`\n── R4: POST com codClasse query+body + codUsuario ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}`,
                    { ...basePayload, codClasse: Number(codClasse), codUsuario }, { grupo: 'D' }
                );
                log(`R4: status ${r.status}`);
                if (r.status >= 400) log(`R4 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R4: POST full', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R4: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R4', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R5: POST com alunos=[] (vazio) — testar se o schema é aceito */
            log(`\n── R5: POST com alunos vazio ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}`,
                    { ...basePayload, alunos: [], codClasse: Number(codClasse) }, { grupo: 'D' }
                );
                log(`R5: status ${r.status}`);
                if (r.status >= 400) log(`R5 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R5: POST alunos vazio', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R5: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R5', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R6: POST com headers do web app (Origin, Referer, Accept) */
            log(`\n── R6: POST com headers do web app ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    basePayload,
                    {
                        grupo: 'D',
                        'Origin': 'https://rco.paas.pr.gov.br',
                        'Referer': 'https://rco.paas.pr.gov.br/',
                        'Accept': 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest',
                    }
                );
                log(`R6: status ${r.status}`);
                if (r.status >= 400) log(`R6 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R6: POST headers web', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R6: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R6', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R7: POST com path diferente (sem /classe/v1/) */
            log(`\n── R7: POST sem /classe/v1/ prefix ──`);
            try {
                const r = await rcoApiService.post(
                    `/avaliacaoParcialClasses`,
                    basePayload,
                    { grupo: 'D' }
                );
                log(`R7: status ${r.status}`);
                if (r.status >= 400) log(`R7 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R7: POST sem classe/v1', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R7: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R7', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R8: POST para /classe/v1/avaliacaoParcialClasses/{codClasse} */
            log(`\n── R8: POST com codClasse como path param ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${codClasse}`,
                    basePayload,
                    { grupo: 'D' }
                );
                log(`R8: status ${r.status}`);
                if (r.status >= 400) log(`R8 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R8: POST codClasse path', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R8: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R8', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R9: POST payload mínimo absoluto — sem alunos */
            log(`\n── R9: POST sem alunos no payload ──`);
            try {
                const minPayload = { ...basePayload };
                delete minPayload.alunos;
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    minPayload,
                    { grupo: 'D' }
                );
                log(`R9: status ${r.status}`);
                if (r.status >= 400) log(`R9 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R9: POST sem alunos', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R9: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R9', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R10: POST ultra-mínimo: recuperadas só com codAvaliacaoParcialClasse,
               1 aluno, descrAvaliacaoParcial sem newline */
            log(`\n── R10: POST ultra-mínimo ──`);
            try {
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    {
                        codTipoAvaliacaoParcial: 2,
                        dataAvaliacaoParcial:    '2026-04-01T00:00:00',
                        numAvaliacaoParcial:     1,
                        pesoDecimal:             '4.0',
                        recuperadas: [{ codAvaliacaoParcialClasse: avOrigId }],
                        alunos: [{ codMatrizAluno: (avOrig.alunos ?? [])[0]?.codMatrizAluno, notaDecimal: '0.0' }],
                    },
                    { grupo: 'D' }
                );
                log(`R10: status ${r.status}`);
                if (r.status >= 400) log(`R10 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R10: POST ultra-min', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R10: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R10', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R11: POST com recuperadas contendo descrAvaliacaoParcial SEM newline */
            log(`\n── R11: POST recuperadas sem newline ──`);
            try {
                const cleanRecup = { ...basePayload.recuperadas[0] };
                cleanRecup.descrAvaliacaoParcial = (cleanRecup.descrAvaliacaoParcial ?? '').replace(/\n/g, ' ');
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    { ...basePayload, recuperadas: [cleanRecup] },
                    { grupo: 'D' }
                );
                log(`R11: status ${r.status}`);
                if (r.status >= 400) log(`R11 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R11: POST sem newline', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R11: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R11', status: 'ERR', ok: false, body: e.message });
            }

            /* Teste R12: POST exatamente como tipo=1 funciona, mas trocando tipo para 2
               (tipo=1 retorna 400 "sem conteúdos" - validação normal, sem 500) */
            log(`\n── R12: POST com conteudos (como tipo=1 exige) ──`);
            try {
                const grOrig2 = await rcoApiService.get(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${avOrigId}?listas=conteudos`
                );
                const conteudos = grOrig2.data?.conteudos ?? [];
                const r = await rcoApiService.post(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses`,
                    {
                        ...basePayload,
                        conteudos: conteudos.map(c => ({
                            descrConteudo: c.descrConteudo,
                            codPeriodoAvaliacao: c.codPeriodoAvaliacao ?? 9,
                        })),
                    },
                    { grupo: 'D' }
                );
                log(`R12: status ${r.status}`);
                if (r.status >= 400) log(`R12 body: ${JSON.stringify(r.data)}`);
                resultados.push({ teste: 'R12: POST com conteudos', status: r.status, ok: r.status < 400, body: r.status >= 400 ? r.data : r.data });
            } catch (e) {
                log(`R12: EXCEPTION ${e.message}`);
                resultados.push({ teste: 'R12', status: 'ERR', ok: false, body: e.message });
            }

            log(`\n=== RESULTADO ===`);
            resultados.forEach(r => log(`  ${r.teste}: ${r.ok ? '✅' : '❌'} (${r.status})`));

            res.json({ resultados });
        } catch (e) {
            log(`FALHA: ${e.message}`);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── POST /api/rco-lancamento/avaliacoes/criar
       Cria avaliação no RCO via automação do navegador (Puppeteer).
       O RCO API não suporta POST para criar avaliações — então automatizamos
       o formulário web do RCO Digital.
       Body: { codClasse, tipo: "AV1"|"Recuperação", dataAvaliacao: "YYYY-MM-DD" }
    ─────────────────────────────────────────────────────── */
    router.post('/rco-lancamento/avaliacoes/criar', async (req, res) => {
        const { codClasse, tipo, dataAvaliacao, nomeDisciplina } = req.body;
        if (!codClasse || !tipo || !dataAvaliacao || !nomeDisciplina) {
            return res.status(400).json({ erro: 'codClasse, tipo, dataAvaliacao e nomeDisciplina são obrigatórios.' });
        }
        if (!['AV1', 'Recuperação'].includes(tipo)) {
            return res.status(400).json({ erro: 'tipo deve ser "AV1" ou "Recuperação".' });
        }

        const cpf   = process.env.RCO_CPF;
        const senha = process.env.RCO_SENHA;
        if (!cpf || !senha) {
            return res.status(500).json({ erro: 'Credenciais RCO não configuradas no servidor.' });
        }

        try {
            const resultado = await RcoWebAutomation.criarAvaliacao({
                cpf, senha, codClasse, tipo, dataAvaliacao, nomeDisciplina,
            });

            const listR = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}` +
                `&codPeriodoAvaliacao=9&codRegraCalculo=1&qtdeAvaliacao=2&page=1&perPage=50`
            );
            const avaliacoes = Array.isArray(listR.data) ? listR.data : (listR.data?.content ?? []);
            const comId = avaliacoes.filter(a => a.codAvaliacaoParcialClasse);

            res.json({
                ...resultado,
                avaliacoes: comId,
            });
        } catch (e) {
            console.error('[RCO-WEB] Erro na criação:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── PATCH /api/rco-lancamento/grupos/:grupoId/cod-classe
       Salva/atualiza o codClasseRco vinculado a um grupo.
    ─────────────────────────────────────────────────────── */
    router.patch('/rco-lancamento/grupos/:grupoId/cod-classe', async (req, res) => {
        const { codClasseRco } = req.body;
        if (!codClasseRco) return res.status(400).json({ erro: 'codClasseRco obrigatório' });
        try {
            await pool.query(
                `UPDATE classroom_grupos SET cod_classe_rco = $1 WHERE id = $2`,
                [String(codClasseRco), req.params.grupoId]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
