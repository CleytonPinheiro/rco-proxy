/**
 * Boletim por Aluno — notas parciais via RCO Digital
 *
 * GET /api/boletim/classes        — lista classes disponíveis (do Supabase)
 * GET /api/boletim/notas          — ?codClasse=X&codPeriodoAvaliacao=Y
 *                                   retorna notas de todos os alunos da classe
 */

import { Router }        from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import { rcoApiService } from '../services/RcoApiService.js';

const RCO_CLASSE_BASE = '/classe/v1';

export function createBoletimRouter(deps = {}) {
    const router        = Router();
    const supabaseAdmin = deps?.supabaseAdmin ?? null;

    /* Todas as rotas exigem módulo 'boletim' */
    router.use('/boletim', requireModulo('boletim'));

    /* ── GET /api/boletim/classes
       Lista classes sincronizadas no Supabase, enriquecidas com nome de
       turma e disciplina. Retorna também os períodos de avaliação distintos
       disponíveis para o seletor do frontend.
    ─────────────────────────────────────────────────────── */
    router.get('/boletim/classes', async (req, res) => {
        if (!supabaseAdmin) {
            return res.status(503).json({ erro: 'Supabase não disponível.' });
        }
        try {
            const [
                { data: classes,     error: e1 },
                { data: turmas,      error: e2 },
                { data: disciplinas, error: e3 },
            ] = await Promise.all([
                supabaseAdmin
                    .from('rco_classes')
                    .select('cod_classe, cod_turma, cod_disciplina, cod_estabelecimento, periodo_letivo')
                    .order('cod_turma', { ascending: true }),
                supabaseAdmin.from('rco_turmas').select('cod_turma, descr_turma'),
                supabaseAdmin.from('rco_disciplinas').select('cod_disciplina, nome_disciplina, sigla'),
            ]);

            if (e1 || e2 || e3) {
                const msg = (e1 || e2 || e3).message;
                console.error('[BOLETIM] Erro Supabase ao listar classes:', msg);
                return res.status(500).json({ erro: msg });
            }

            const turmaMap      = Object.fromEntries((turmas      || []).map(t => [t.cod_turma,      t]));
            const disciplinaMap = Object.fromEntries((disciplinas || []).map(d => [d.cod_disciplina, d]));

            const lista = (classes || []).map(c => ({
                codClasse:            c.cod_classe,
                codTurma:             c.cod_turma,
                descrTurma:           turmaMap[c.cod_turma]?.descr_turma      ?? `Turma ${c.cod_turma}`,
                codDisciplina:        c.cod_disciplina,
                nomeDisciplina:       disciplinaMap[c.cod_disciplina]?.nome_disciplina ?? `Disciplina ${c.cod_disciplina}`,
                siglaDisciplina:      disciplinaMap[c.cod_disciplina]?.sigla           ?? '',
                periodoLetivo:        c.periodo_letivo,
                codPeriodoAvaliacao:  c.cod_periodo_avaliacao ?? Number(process.env.RCO_COD_PERIODO_AVALIACAO ?? 9),
            }));

            res.json(lista);
        } catch (e) {
            console.error('[BOLETIM] Erro ao listar classes:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── GET /api/boletim/notas
       Busca notas parciais de todos os alunos de uma classe no RCO.
       Estratégia:
         1. Lista avaliações da classe   → /avaliacaoParcialClasses?codClasse=X (colunas)
         2. Roster de alunos (nomes)     → /relatorios/avaliacaoAlunos?codClasse=X
         3. Notas por avaliação (linhas) → /avaliacaoParcialClasses/{id}?listas=alunos
         4. Consolida: cada aluno → array de { nomeAvaliacao, notaDecimal }
       Query: codClasse (obrigatório), codPeriodoAvaliacao (default env ou 9)
    ─────────────────────────────────────────────────────── */
    router.get('/boletim/notas', async (req, res) => {
        const { codClasse } = req.query;
        const codPeriodo = req.query.codPeriodoAvaliacao
            ?? process.env.RCO_COD_PERIODO_AVALIACAO
            ?? 9;

        if (!codClasse) {
            return res.status(400).json({ erro: 'codClasse é obrigatório.' });
        }

        try {
            /* Passo 1 + 2 em paralelo: lista de avaliações + roster
               codRegraCalculo=1 e qtdeAvaliacao=2 são obrigatórios no RCO — sem eles retorna 500 */
            const [avaliResult, rosterResult] = await Promise.allSettled([
                rcoApiService.get(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}` +
                    `&codPeriodoAvaliacao=${codPeriodo}&codRegraCalculo=1&qtdeAvaliacao=2&page=1&perPage=50`
                ),
                rcoApiService.get(
                    `${RCO_CLASSE_BASE}/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodo}`
                ),
            ]);

            /* Lista de avaliações — não-fatal: turma pode ainda não ter avaliações cadastradas */
            let avaliacoes = [];
            if (avaliResult.status === 'fulfilled' && avaliResult.value?.status === 200) {
                const d = avaliResult.value.data;
                avaliacoes = Array.isArray(d) ? d : (d?.content ?? d?.data ?? []);
            } else {
                const err = avaliResult.reason?.message ?? avaliResult.value?.data ?? '?';
                console.warn(`[BOLETIM] avaliacaoParcialClasses falhou — sem colunas de avaliação: ${err}`);
            }

            /* Normaliza roster — não-fatal: se falhar retorna alunos sem nome */
            let roster = [];
            if (rosterResult.status === 'fulfilled' && rosterResult.value?.status === 200) {
                const rd = rosterResult.value.data;
                roster = Array.isArray(rd) ? rd : (rd?.data ?? []);
            } else {
                const err = rosterResult.reason?.message ?? rosterResult.value?.data ?? '?';
                console.warn(`[BOLETIM] avaliacaoAlunos falhou — roster indisponível: ${err}`);
            }

            /* Passo 3: busca notas de cada avaliação em paralelo */
            const detalhes = await Promise.allSettled(
                avaliacoes.map(av =>
                    rcoApiService.get(
                        `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${av.codAvaliacaoParcialClasse}?listas=alunos`
                    )
                )
            );

            /* Passo 4: monta mapa { codMatrizAluno → { nome, numChamada, avaliacoes[] } } */
            const alunoMap = new Map();

            /* Inicializa com roster (garante que alunos sem notas aparecem) */
            roster.forEach(s => {
                alunoMap.set(String(s.codMatrizAluno), {
                    codMatrizAluno: s.codMatrizAluno,
                    nome:           s.nome       ?? null,
                    numChamada:     s.numChamada ?? null,
                    avaliacoes:     [],
                });
            });

            /* Preenche notas de cada avaliação */
            avaliacoes.forEach((av, i) => {
                const result = detalhes[i];
                if (result.status !== 'fulfilled' || result.value?.status !== 200) return;

                const avAlunos = result.value.data?.alunos ?? [];
                const nomeAv = av.nomeAvaliacao ?? av.titulo ?? av.descricao
                    ?? `Av. ${av.codAvaliacaoParcialClasse}`;

                avAlunos.forEach(a => {
                    const key = String(a.codMatrizAluno);
                    if (!alunoMap.has(key)) {
                        alunoMap.set(key, {
                            codMatrizAluno: a.codMatrizAluno,
                            nome:           a.nome       ?? null,
                            numChamada:     a.numChamada ?? null,
                            avaliacoes:     [],
                        });
                    }
                    alunoMap.get(key).avaliacoes.push({
                        codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse,
                        nomeAvaliacao:             nomeAv,
                        notaDecimal:               a.notaDecimal ?? a.nota ?? null,
                    });
                });
            });

            /* Ordena por numChamada, depois nome */
            const alunos = [...alunoMap.values()].sort((a, b) => {
                const ca = Number(a.numChamada ?? 9999);
                const cb = Number(b.numChamada ?? 9999);
                if (ca !== cb) return ca - cb;
                return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
            });

            res.json({
                codClasse:           Number(codClasse),
                codPeriodoAvaliacao: Number(codPeriodo),
                totalAvaliacoes:     avaliacoes.length,
                alunos,
            });
        } catch (e) {
            console.error('[BOLETIM] Erro ao buscar notas:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
