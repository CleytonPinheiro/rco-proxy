/**
 * Boletim por Aluno — notas parciais via RCO Digital
 *
 * GET /api/boletim/classes   — lista classes disponíveis (do Supabase)
 * GET /api/boletim/notas     — ?codClasse=X&codPeriodoAvaliacao=Y
 *
 * Estrutura retornada por /notas:
 *   colunas[]  → definição ordenada das colunas (AV1, R1, AV2, R2, …)
 *   alunos[]   → cada aluno com notas{} mapa { colId → notaDecimal }
 *
 * Lógica de Nota Final (calculada no frontend):
 *   Para cada avaliação principal, usa max(principal, recuperação).
 *   Nota Final = soma das melhores notas de cada par.
 */

import { Router }        from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import { rcoApiService } from '../services/RcoApiService.js';

const RCO_CLASSE_BASE = '/classe/v1';

export function createBoletimRouter(deps = {}) {
    const router        = Router();
    const supabaseAdmin = deps?.supabaseAdmin ?? null;

    router.use('/boletim', requireModulo('boletim'));

    /* ── GET /api/boletim/classes ───────────────────────────────── */
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
                codClasse:           c.cod_classe,
                codTurma:            c.cod_turma,
                descrTurma:          turmaMap[c.cod_turma]?.descr_turma      ?? `Turma ${c.cod_turma}`,
                codDisciplina:       c.cod_disciplina,
                nomeDisciplina:      disciplinaMap[c.cod_disciplina]?.nome_disciplina ?? `Disciplina ${c.cod_disciplina}`,
                siglaDisciplina:     disciplinaMap[c.cod_disciplina]?.sigla           ?? '',
                periodoLetivo:       c.periodo_letivo,
                codPeriodoAvaliacao: c.cod_periodo_avaliacao ?? Number(process.env.RCO_COD_PERIODO_AVALIACAO ?? 9),
            }));

            res.json(lista);
        } catch (e) {
            console.error('[BOLETIM] Erro ao listar classes:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── GET /api/boletim/notas ─────────────────────────────────────
       Fluxo:
         1. Lista avaliações principais  → /avaliacaoParcialClasses?codClasse=X
         2. Roster de alunos             → /relatorios/avaliacaoAlunos (em paralelo com 1)
         3. Detalhes de cada AV principal → /{id}?listas=recuperacaos,alunos
         4. Se recuperação sem alunos inline → /{recId}?listas=alunos
         5. Monta colunas ordenadas (AV1, R1, AV2, R2, …)
         6. Monta mapa de notas por aluno
    ─────────────────────────────────────────────────────────────── */
    router.get('/boletim/notas', async (req, res) => {
        const { codClasse } = req.query;
        const codPeriodo = req.query.codPeriodoAvaliacao
            ?? process.env.RCO_COD_PERIODO_AVALIACAO
            ?? 9;

        if (!codClasse) {
            return res.status(400).json({ erro: 'codClasse é obrigatório.' });
        }

        try {
            /* ── Passo 1 + 2 em paralelo ─────────────────────── */
            const [avaliResult, rosterResult] = await Promise.allSettled([
                rcoApiService.get(
                    `${RCO_CLASSE_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}` +
                    `&codPeriodoAvaliacao=${codPeriodo}&codRegraCalculo=1&qtdeAvaliacao=10&page=1&perPage=100`
                ),
                rcoApiService.get(
                    `${RCO_CLASSE_BASE}/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodo}`
                ),
            ]);

            let avaliacoes = [];
            if (avaliResult.status === 'fulfilled' && avaliResult.value?.status === 200) {
                const d = avaliResult.value.data;
                avaliacoes = Array.isArray(d) ? d : (d?.content ?? d?.data ?? []);
            } else {
                const err = avaliResult.reason?.message ?? JSON.stringify(avaliResult.value?.data ?? '?');
                console.warn(`[BOLETIM] avaliacaoParcialClasses falhou — sem avaliações: ${err}`);
            }

            let roster = [];
            if (rosterResult.status === 'fulfilled' && rosterResult.value?.status === 200) {
                const rd = rosterResult.value.data;
                roster = Array.isArray(rd) ? rd : (rd?.data ?? []);
            } else {
                const err = rosterResult.reason?.message ?? '?';
                console.warn(`[BOLETIM] avaliacaoAlunos falhou — roster indisponível: ${err}`);
            }

            /* ── Passo 3: detalhe de cada AV principal (com recuperacaos + alunos) ── */
            const detalhes = await Promise.allSettled(
                avaliacoes.map(av =>
                    rcoApiService.get(
                        `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${av.codAvaliacaoParcialClasse}?listas=recuperacaos,alunos`
                    )
                )
            );

            /* ── Passo 4: coleta recuperações — inline ou para busca separada ─── */
            const recInline  = {};   /* recId(str) → { nome, avPrincipalId, alunosMap } */
            const recBuscar  = [];   /* [ { recId, nome, avPrincipalId } ] */

            function parseNome(obj, fallback) {
                if (obj?.descrAvaliacaoParcial) {
                    return String(obj.descrAvaliacaoParcial).replace(/\n\s*/g, ' ').trim();
                }
                return obj?.nomeAvaliacao ?? obj?.titulo ?? fallback;
            }

            avaliacoes.forEach((av, i) => {
                const det = detalhes[i];
                if (det.status !== 'fulfilled' || det.value?.status !== 200) return;
                const recs = det.value.data?.recuperacaos ?? [];
                recs.forEach(rec => {
                    const recId = rec.codAvaliacaoParcialClasse;
                    if (!recId) return;
                    const nome = parseNome(rec, `Recuperação AV${av.numAvaliacaoParcial ?? i + 1}`);
                    if (rec.alunos?.length > 0) {
                        const alunosMap = {};
                        rec.alunos.forEach(a => {
                            alunosMap[String(a.codMatrizAluno)] = a.notaDecimal ?? a.nota ?? null;
                        });
                        recInline[String(recId)] = { nome, avPrincipalId: av.codAvaliacaoParcialClasse, alunosMap };
                    } else {
                        recBuscar.push({ recId, nome, avPrincipalId: av.codAvaliacaoParcialClasse });
                    }
                });
            });

            /* Busca separada das recuperações sem alunos inline */
            if (recBuscar.length > 0) {
                const recDetalhes = await Promise.allSettled(
                    recBuscar.map(r =>
                        rcoApiService.get(`${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${r.recId}?listas=alunos`)
                    )
                );
                recBuscar.forEach((r, i) => {
                    const det = recDetalhes[i];
                    if (det.status !== 'fulfilled' || det.value?.status !== 200) return;
                    const alunosMap = {};
                    (det.value.data?.alunos ?? []).forEach(a => {
                        alunosMap[String(a.codMatrizAluno)] = a.notaDecimal ?? a.nota ?? null;
                    });
                    recInline[String(r.recId)] = { nome: r.nome, avPrincipalId: r.avPrincipalId, alunosMap };
                });
            }

            /* ── Passo 5: monta colunas ordenadas (AV1, R1, AV2, R2, …) ─── */
            const colunas = [];
            avaliacoes.forEach((av, i) => {
                const nomeAv = parseNome(av, `Avaliação #${av.numAvaliacaoParcial ?? av.codAvaliacaoParcialClasse}`);
                colunas.push({
                    id:           av.codAvaliacaoParcialClasse,
                    nome:         nomeAv,
                    tipo:         'principal',
                    avPrincipalId: null,
                });
                /* Recuperações desta avaliação, logo em seguida */
                Object.entries(recInline)
                    .filter(([, v]) => v.avPrincipalId === av.codAvaliacaoParcialClasse)
                    .forEach(([recId, recInfo]) => {
                        colunas.push({
                            id:           Number(recId),
                            nome:         recInfo.nome,
                            tipo:         'recuperacao',
                            avPrincipalId: av.codAvaliacaoParcialClasse,
                        });
                    });
            });

            /* ── Passo 6: monta mapa de alunos ──────────────────────────── */
            const alunoMap = new Map();

            /* Inicializa do roster */
            roster.forEach(s => {
                alunoMap.set(String(s.codMatrizAluno), {
                    codMatrizAluno: s.codMatrizAluno,
                    nome:           s.nome       ?? null,
                    numChamada:     s.numChamada ?? null,
                    notas:          {},
                });
            });

            /* Preenche notas das avaliações principais */
            avaliacoes.forEach((av, i) => {
                const det = detalhes[i];
                if (det.status !== 'fulfilled' || det.value?.status !== 200) return;
                (det.value.data?.alunos ?? []).forEach(a => {
                    const key = String(a.codMatrizAluno);
                    if (!alunoMap.has(key)) {
                        alunoMap.set(key, { codMatrizAluno: a.codMatrizAluno, nome: null, numChamada: null, notas: {} });
                    }
                    alunoMap.get(key).notas[String(av.codAvaliacaoParcialClasse)] = a.notaDecimal ?? a.nota ?? null;
                });
            });

            /* Preenche notas das recuperações */
            Object.entries(recInline).forEach(([recId, recInfo]) => {
                Object.entries(recInfo.alunosMap).forEach(([codAluno, nota]) => {
                    if (!alunoMap.has(codAluno)) {
                        alunoMap.set(codAluno, { codMatrizAluno: Number(codAluno), nome: null, numChamada: null, notas: {} });
                    }
                    alunoMap.get(codAluno).notas[recId] = nota;
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
                colunas,
                alunos,
            });
        } catch (e) {
            console.error('[BOLETIM] Erro ao buscar notas:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
