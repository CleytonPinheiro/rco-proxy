/**
 * Alertas de Faltas — pedagogo/admin
 *
 * GET /api/alertas-faltas
 *   Query: codPeriodoAvaliacao (default env/9)
 *          codPeriodoLetivo    (default env/261)
 *          minTotal            (default 5)  — total de faltas para alertar
 *          minConsecutivas     (default 3)  — faltas seguidas para alertar
 *
 * Percorre todas as classes sincronizadas no Supabase, busca frequência no
 * RCO e identifica alunos em risco por total ≥ minTotal OU consecutivas ≥ minConsecutivas.
 * Para as classes com alertas, resolve as datas das aulas faltadas.
 */

import { Router }        from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import { rcoApiService } from '../services/RcoApiService.js';

export function createAlertasFaltasRouter(deps = {}) {
    const router        = Router();
    const supabaseAdmin = deps?.supabaseAdmin ?? null;

    router.use('/alertas-faltas', requireModulo('alertas-faltas'));

    /* ── Helpers ──────────────────────────────────────────────────── */

    /** Executa array de funções async em lotes de `size` por vez. */
    async function executarEmLotes(fns, size = 8) {
        const resultados = [];
        for (let i = 0; i < fns.length; i += size) {
            const lote = await Promise.allSettled(fns.slice(i, i + size).map(f => f()));
            resultados.push(...lote);
        }
        return resultados;
    }

    /** Máximo de faltas consecutivas numa sequência de aulas. */
    function maxConsecutivas(frequencias, codAulas) {
        let max = 0, atual = 0;
        for (const cod of codAulas) {
            const v = frequencias[cod];
            if (v !== null && v !== undefined && v !== 'C') {
                atual++;
                if (atual > max) max = atual;
            } else if (v === 'C') {
                atual = 0; // presença quebra sequência
            }
            // null = sem registro — não conta nem quebra
        }
        return max;
    }

    /** Sequências de aulas consecutivamente faltadas (para exibir no detalhe). */
    function sequenciasConsecutivas(frequencias, codAulas) {
        const seqs = [];
        let seq = [];
        for (const cod of codAulas) {
            const v = frequencias[cod];
            if (v !== null && v !== undefined && v !== 'C') {
                seq.push(cod);
            } else if (v === 'C') {
                if (seq.length >= 1) { seqs.push([...seq]); seq = []; }
            }
        }
        if (seq.length >= 1) seqs.push(seq);
        return seqs;
    }

    /* ── GET /api/alertas-faltas ──────────────────────────────────── */
    router.get('/alertas-faltas', async (req, res) => {
        if (!supabaseAdmin) {
            return res.status(503).json({ erro: 'Supabase não disponível.' });
        }

        const codPeriodoAvaliacao = Number(req.query.codPeriodoAvaliacao ?? process.env.RCO_COD_PERIODO_AVALIACAO ?? 9);
        const codPeriodoLetivo    = Number(req.query.codPeriodoLetivo    ?? process.env.RCO_COD_PERIODO_LETIVO    ?? 261);
        const minTotal            = Number(req.query.minTotal         ?? 5);
        const minConsec           = Number(req.query.minConsecutivas  ?? 3);

        try {
            /* 1. Carrega mapa de classes / turmas / disciplinas do Supabase */
            const [
                { data: classes,     error: e1 },
                { data: turmas,      error: e2 },
                { data: disciplinas, error: e3 },
            ] = await Promise.all([
                supabaseAdmin.from('rco_classes').select('cod_classe, cod_turma, cod_disciplina'),
                supabaseAdmin.from('rco_turmas').select('cod_turma, descr_turma'),
                supabaseAdmin.from('rco_disciplinas').select('cod_disciplina, nome_disciplina, sigla'),
            ]);

            if (e1 || e2 || e3) {
                return res.status(500).json({ erro: (e1 || e2 || e3).message });
            }

            const turmaMap = Object.fromEntries((turmas || []).map(t => [t.cod_turma, t.descr_turma ?? `Turma ${t.cod_turma}`]));
            const discMap  = Object.fromEntries((disciplinas || []).map(d => [d.cod_disciplina, d.nome_disciplina ?? `Disciplina ${d.cod_disciplina}`]));
            const siglaMap = Object.fromEntries((disciplinas || []).map(d => [d.cod_disciplina, d.sigla ?? '']));

            if (!classes || classes.length === 0) {
                return res.json({ total: 0, processado: 0, alertas: [] });
            }

            /* Aplica filtro de turma se fornecido */
            const filtroTurma = req.query.codTurma ? Number(req.query.codTurma) : null;
            const classesAlvo = filtroTurma
                ? classes.filter(c => c.cod_turma === filtroTurma)
                : classes;

            /* 2. Busca frequência de cada classe em lotes paralelos */
            const alertasPorClasse = [];
            let processado = 0;

            const fns = classesAlvo.map(cls => async () => {
                try {
                    const r = await rcoApiService.get(
                        `/classe/v3/relatorios/frequenciaAulas?codClasse=${cls.cod_classe}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`
                    );
                    processado++;
                    if (r.status !== 200 || !Array.isArray(r.data)) return;

                    const raw     = r.data;
                    const aulaSet = new Set();
                    raw.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));
                    const codAulas = [...aulaSet].sort((a, b) => parseInt(a) - parseInt(b));
                    if (codAulas.length === 0) return;

                    /* Deduplica por codMatrizAluno */
                    const mapa = new Map();
                    for (const a of raw) {
                        const chave = a.codMatrizAluno != null ? String(a.codMatrizAluno) : `nome:${a.nome}`;
                        if (!mapa.has(chave)) {
                            const freqs = {};
                            codAulas.forEach(cod => { freqs[cod] = a[cod] || null; });
                            mapa.set(chave, { nome: a.nome, numChamada: a.numChamada, codMatrizAluno: a.codMatrizAluno, freqs });
                        } else {
                            const ent = mapa.get(chave);
                            codAulas.forEach(cod => {
                                const ex = ent.freqs[cod];
                                const nv = a[cod] || null;
                                if (!ex && nv)      ent.freqs[cod] = nv;
                                else if (nv === 'C') ent.freqs[cod] = 'C';
                            });
                        }
                    }

                    /* Identifica alunos em alerta */
                    const alunosAlerta = [];
                    for (const ent of mapa.values()) {
                        const totalFaltas = codAulas.filter(cod => ent.freqs[cod] && ent.freqs[cod] !== 'C').length;
                        const maxConsec   = maxConsecutivas(ent.freqs, codAulas);
                        if (totalFaltas >= minTotal || maxConsec >= minConsec) {
                            const codAulasFaltadas = codAulas.filter(cod => ent.freqs[cod] && ent.freqs[cod] !== 'C');
                            alunosAlerta.push({
                                nome:            ent.nome,
                                numChamada:      ent.numChamada,
                                codMatrizAluno:  ent.codMatrizAluno,
                                totalFaltas,
                                maxConsecutivas: maxConsec,
                                sequencias:      sequenciasConsecutivas(ent.freqs, codAulas),
                                codAulasFaltadas,
                            });
                        }
                    }

                    if (alunosAlerta.length === 0) return;

                    alertasPorClasse.push({
                        codClasse:     cls.cod_classe,
                        codTurma:      cls.cod_turma,
                        descrTurma:    turmaMap[cls.cod_turma]  ?? `Turma ${cls.cod_turma}`,
                        nomeDisciplina: discMap[cls.cod_disciplina] ?? `Disciplina ${cls.cod_disciplina}`,
                        siglaDisciplina: siglaMap[cls.cod_disciplina] ?? '',
                        codAulas,
                        alunos: alunosAlerta,
                    });
                } catch (e) {
                    console.warn(`[ALERTAS-FALTAS] Classe ${cls.cod_classe} falhou:`, e.message);
                }
            });

            await executarEmLotes(fns, 8);

            /* 3. Resolve datas das aulas apenas para classes com alertas */
            for (const cls of alertasPorClasse) {
                /* Coleta conjunto de codAula faltadas por todos os alunos desta classe */
                const codFaltaSet = new Set(cls.alunos.flatMap(a => a.codAulasFaltadas));
                const aulaDatas   = {};

                const dateFns = [...codFaltaSet].map(cod => async () => {
                    try {
                        const r = await rcoApiService.get(
                            `/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPeriodoLetivo}`
                        );
                        const dataRaw = r?.data?.aula?.dataAula || r?.data?.dataAula || null;
                        if (dataRaw) {
                            const d  = new Date(dataRaw);
                            const dd = String(d.getUTCDate()).padStart(2, '0');
                            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                            aulaDatas[cod] = `${dd}/${mm}`;
                        }
                    } catch {}
                });
                await executarEmLotes(dateFns, 10);

                /* Enriquece cada aluno com as datas das faltas */
                for (const aluno of cls.alunos) {
                    aluno.datasAulas = aluno.codAulasFaltadas
                        .map(cod => aulaDatas[cod] ?? null)
                        .filter(Boolean)
                        .sort((a, b) => {
                            const [da, ma] = a.split('/').map(Number);
                            const [db, mb] = b.split('/').map(Number);
                            return ma !== mb ? ma - mb : da - db;
                        });
                    /* Sequências com datas */
                    aluno.sequenciasComDatas = aluno.sequencias.map(seq =>
                        seq.map(cod => aulaDatas[cod] ?? null).filter(Boolean)
                    ).filter(s => s.length > 0);
                }
            }

            /* 4. Agrupa alertas por aluno (nome normalizado) */
            const alunoMap = new Map();
            for (const cls of alertasPorClasse) {
                for (const aluno of cls.alunos) {
                    const chave = (aluno.nome ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
                    if (!alunoMap.has(chave)) {
                        alunoMap.set(chave, {
                            nome:           aluno.nome,
                            numChamada:     aluno.numChamada,
                            codMatrizAluno: aluno.codMatrizAluno,
                            disciplinas:    [],
                        });
                    }
                    alunoMap.get(chave).disciplinas.push({
                        codClasse:       cls.codClasse,
                        turma:           cls.descrTurma,
                        disciplina:      cls.nomeDisciplina,
                        sigla:           cls.siglaDisciplina,
                        totalFaltas:     aluno.totalFaltas,
                        maxConsecutivas: aluno.maxConsecutivas,
                        datasAulas:      aluno.datasAulas ?? [],
                        sequencias:      aluno.sequenciasComDatas ?? [],
                    });
                }
            }

            /* Ordena: mais faltas totais primeiro */
            const alertas = [...alunoMap.values()]
                .sort((a, b) => {
                    const maxA = Math.max(...a.disciplinas.map(d => d.totalFaltas));
                    const maxB = Math.max(...b.disciplinas.map(d => d.totalFaltas));
                    return maxB - maxA;
                });

            res.json({
                total:      alertas.length,
                processado: classesAlvo.length,
                minTotal,
                minConsec,
                alertas,
            });

        } catch (e) {
            console.error('[ALERTAS-FALTAS] Erro geral:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── GET /api/alertas-faltas/turmas
       Lista turmas disponíveis para o filtro.                       */
    router.get('/alertas-faltas/turmas', async (req, res) => {
        if (!supabaseAdmin) return res.status(503).json({ erro: 'Supabase não disponível.' });
        try {
            const { data, error } = await supabaseAdmin.from('rco_turmas').select('cod_turma, descr_turma');
            if (error) return res.status(500).json({ erro: error.message });
            res.json((data || []).sort((a, b) => (a.descr_turma ?? '').localeCompare(b.descr_turma ?? '', 'pt-BR')));
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
