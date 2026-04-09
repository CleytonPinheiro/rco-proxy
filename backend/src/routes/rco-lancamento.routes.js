/**
 * RCO Lançamento — lançamento de notas do Classroom direto no RCO Digital
 *
 * GET  /api/rco-lancamento/avaliacoes                    — lista avaliações parciais de uma classe
 * GET  /api/rco-lancamento/avaliacoes/:id               — detalha avaliação (com alunos + conteudos)
 * GET  /api/rco-lancamento/conteudos-sugeridos          — conteúdos de outras avaliações da classe (para modal)
 * POST /api/rco-lancamento/avaliacoes/:id/lancar        — executa PUT no RCO com notas + conteudos
 * POST /api/rco-lancamento/avaliacoes/:id/salvar-db     — persiste no banco sem reenviar ao RCO
 */

import { Router }         from 'express';
import { rcoApiService }  from '../services/RcoApiService.js';
import pkg                from 'pg';

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
                /* Replica o fluxo exato do RCO web app (confirmado por curl capturado em produção):
                   1. GET avaliacaoParcialClasses/:id → estrutura base + alunos mínimos
                   2. GET /matrizAlunos → dados completos dos alunos (nome, numChamada, indAtivo, cgmAluno…)
                   3. Merge: aluno da avaliação + campos do matrizAluno + notaDecimal calculada (STRING)
                   4. pesoDecimal como número, dataAtualizacao original do GET
                   5. SEM recuperacaos (ausente no curl nativo), SEM descrAvaliacaoParcial top-level */
                let evalBase  = null;
                let alunosRcoMap = {};   /* codMatrizAluno(str) → aluno da avaliacaoParcialClasses */
                let matrizMap    = {};   /* codMatrizAluno(str) → aluno do matrizAlunos */

                /* ── Passo 1: GET da avaliação ── */
                try {
                    const gr = await rcoApiService.get(
                        `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}?listas=recuperacaos,recuperadas,alunos,conteudos`
                    );
                    if (gr.status === 200 && gr.data) {
                        /* Converte para formato RCO: +0000 em vez de Z */
                        const agoraRco = agora.replace('Z', '+0000');
                        const limparAninhados = arr => (arr ?? []).map(({ alunos: _a, ...r }) => ({
                            ...r,
                            pesoDecimal: Number(r.pesoDecimal),  /* número, como o top-level */
                        }));
                        (gr.data.alunos ?? []).forEach(a => {
                            alunosRcoMap[String(a.codMatrizAluno)] = a;
                        });
                        evalBase = {
                            codAvaliacaoParcialClasse: gr.data.codAvaliacaoParcialClasse,
                            codTipoAvaliacaoParcial:   gr.data.codTipoAvaliacaoParcial,
                            numAvaliacaoParcial:        gr.data.numAvaliacaoParcial,
                            dataAvaliacaoParcial:       gr.data.dataAvaliacaoParcial,
                            pesoDecimal:               Number(gr.data.pesoDecimal),
                            dataAtualizacao:            agoraRco,   /* timestamp atual no formato RCO */
                            codUsuario,
                            recuperadas: limparAninhados(gr.data.recuperadas),
                        };
                        console.log(`[RCO-LANC] GET pré-PUT OK — dataAtualizacao=${agoraRco}`);
                    }
                } catch (e) {
                    console.warn('[RCO-LANC] GET pré-PUT falhou:', e.message);
                }

                /* ── Passo 2: GET /matrizAlunos para dados completos ── */
                const codClasse        = meta.codClasse ?? null;
                const periodoAvaliacao = process.env.RCO_COD_PERIODO_AVALIACAO ?? 9;
                const pesoStr          = String(meta.pesoDecimal ?? '').replace(',', '.');
                if (codClasse) {
                    try {
                        /* data = fim do ano letivo; traz todos os alunos matriculados */
                        const mr = await rcoApiService.get(
                            `${RCO_CLASSE_BASE}/matrizAlunos?codClasse=${codClasse}` +
                            `&codPeriodoAvaliacao=${periodoAvaliacao}&data=2026-12-31&pesoDecimal=${pesoStr}`
                        );
                        if (mr.status === 200 && Array.isArray(mr.data)) {
                            mr.data.forEach(a => {
                                matrizMap[String(a.codMatrizAluno)] = a;
                            });
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

                /* ── Passo 3: Mapa de notas calculadas ── */
                const notaMap = {};
                alunos.forEach(a => { notaMap[String(a.codMatrizAluno)] = a.notaDecimal; });

                /* ── Passo 4: Monta lista final de alunos para o PUT ──
                   Usa apenas os campos mínimos aceitos pelo RCO:
                   codAvaliacaoParcialAluno + codMatrizAluno + notaDecimal (string).
                   Não inclui campos do matrizAlunos pois podem causar rejeição pelo servidor.
                   - Encontrados no Classroom → nota calculada (string)
                   - Não encontrados → "0.0" */
                const alunosBase = Object.values(alunosRcoMap);
                const alunosEnviar = alunosBase.map(a => {
                    const key      = String(a.codMatrizAluno);
                    const notaCalc = notaMap[key];
                    return {
                        codAvaliacaoParcialAluno: a.codAvaliacaoParcialAluno,
                        codMatrizAluno:           a.codMatrizAluno,
                        notaDecimal:              notaCalc != null ? Number(notaCalc).toFixed(1) : '0.0',
                    };
                });

                const base = evalBase ?? {
                    codAvaliacaoParcialClasse: meta.codAvaliacaoParcialClasse,
                    codTipoAvaliacaoParcial:   meta.codTipoAvaliacaoParcial,
                    numAvaliacaoParcial:       meta.numAvaliacaoParcial,
                    dataAvaliacaoParcial:      meta.dataAvaliacaoParcial,
                    pesoDecimal:               Number(meta.pesoDecimal),
                    dataAtualizacao:           agora,
                    codUsuario,
                    recuperadas:               meta.recuperadas ?? [],
                };

                putPayload = { ...base, alunos: alunosEnviar };

                /* ── Validação: detecta notaDecimal inválida antes de enviar ── */
                const invalidos = alunosEnviar.filter(a => {
                    if (a.notaDecimal == null) return false;
                    const v = Number(a.notaDecimal);
                    return isNaN(v) || !isFinite(v) || v < 0 || v > Number(base.pesoDecimal) + 0.01;
                });
                if (invalidos.length) {
                    console.error('[RCO-LANC] ⚠ Alunos com notaDecimal INVÁLIDA:', JSON.stringify(invalidos, null, 2));
                }

                /* Loga TODOS os alunos para diagnóstico completo */
                console.log('[RCO-LANC] Lista completa de alunos para PUT (mínimo):', JSON.stringify(
                    alunosEnviar.map(a => ({
                        codAvaliacaoParcialAluno: a.codAvaliacaoParcialAluno,
                        codMatrizAluno:           a.codMatrizAluno,
                        notaDecimal:              a.notaDecimal,
                    })),
                null, 2));

                console.log('[RCO-LANC] Payload PUT recuperação final (base):', JSON.stringify({
                    ...putPayload,
                    alunos: `[${alunosEnviar.length} alunos — veja lista completa acima]`,
                    _invalidos: invalidos.length,
                    _temMatriz: Object.keys(matrizMap).length > 0,
                }, null, 2));
            } else {
                putPayload = { ...meta, codUsuario, dataAtualizacao: agora, alunos: alunosParaRco };
            }

            const r = await rcoApiService.put(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`,
                putPayload,
                { grupo: 'D' }
            );

            if (r.status >= 400) {
                /* Extrai a mensagem legível que o RCO retornou (string ou objeto) */
                const rcoMsg = typeof r.data === 'string'
                    ? r.data
                    : (r.data?.message ?? r.data?.erro ?? r.data?.msg ?? JSON.stringify(r.data));
                /* Log completo do body de erro para depuração (especialmente 500 genérico) */
                console.error(`[RCO-LANC] Erro no PUT RCO (${r.status}):`, rcoMsg);
                console.error(`[RCO-LANC] Body completo do erro RCO:`, JSON.stringify(r.data, null, 2));
                if (isRec) {
                    console.error(`[RCO-LANC] Payload exato enviado ao RCO (tipo=2):`, JSON.stringify({
                        ...putPayload,
                        alunos: putPayload?.alunos?.slice(0, 3),
                        _qtdeAlunos: alunosParaRco.length,
                    }, null, 2));
                }
                return res.status(r.status).json({
                    erro:   rcoMsg || 'Erro desconhecido ao lançar notas no RCO.',
                    detalhe: r.data,
                    origem: 'RCO',
                });
            }

            console.log(`[RCO-LANC] PUT OK (status ${r.status}). Iniciando verificação pós-PUT...`);

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
    router.get('/rco-lancamento/debug/:id/put-variations', requireAuth, async (req, res) => {
        const id = req.params.id;
        const RCO_CLASSE_BASE = process.env.RCO_CLASSE_BASE ?? 'https://rco.apps.seed.pr.gov.br/classe/v1';
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

        const variacoes = [
            { label: 'V1: base + recuperadas originais + alunos: []',   payload: { ...base, recuperadas: limpar(av.recuperadas), alunos: [] } },
            { label: 'V2: base SEM recuperadas + alunos: []',           payload: { ...base, alunos: [] } },
            { label: 'V3: base + recuperadas: [] (vazio) + alunos: []', payload: { ...base, recuperadas: [], alunos: [] } },
            { label: 'V4: SOMENTE codAvaliacaoParcialClasse + alunos: []', payload: { codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse, alunos: [] } },
            { label: 'V5: base + recuperadas originais + 1 aluno 0.0',  payload: { ...base, recuperadas: limpar(av.recuperadas), alunos: alunoAmostra } },
            { label: 'V6: base + recuperadas sem descrAvaliacaoParcial + alunos: []', payload: {
                ...base,
                recuperadas: limpar(av.recuperadas).map(({ descrAvaliacaoParcial: _d, ...r }) => r),
                alunos: [],
            }},
            { label: 'V7: base + dataAtualizacao original + recuperadas + alunos: []', payload: {
                ...base,
                dataAtualizacao: av.dataAtualizacao,
                recuperadas: limpar(av.recuperadas),
                alunos: [],
            }},
        ];

        for (const { label, payload } of variacoes) {
            try {
                const r = await rcoApiService.put(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${av.codAvaliacaoParcialClasse}`,
                    payload
                );
                resultados.push({ label, status: r.status, ok: true });
            } catch (e) {
                const status = e.response?.status ?? 'ERR';
                const body   = e.response?.data   ?? e.message;
                resultados.push({ label, status, ok: false, body });
            }
        }

        res.json({ avaliacaoId: id, agora, resultados });
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
