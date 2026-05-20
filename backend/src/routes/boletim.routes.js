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
                    .select('cod_classe, cod_turma, cod_disciplina, cod_estabelecimento, periodo_letivo, cod_periodo_avaliacao')
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
            const r = await rcoApiService.get(
                `${RCO_CLASSE_BASE}/relatorios/avaliacaoParcialAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodo}`
            );

            if (r.status !== 200) {
                console.error(`[BOLETIM] RCO retornou ${r.status} para classe ${codClasse}`, r.data);
                return res.status(r.status).json({
                    erro:    'Erro ao buscar notas no RCO.',
                    detalhe: r.data,
                });
            }

            /* Normaliza: a API pode retornar array direto ou { data: [...] } */
            const raw = Array.isArray(r.data)
                ? r.data
                : Array.isArray(r.data?.data) ? r.data.data : [];

            /* Ordena por numChamada, depois nome */
            raw.sort((a, b) => {
                const ca = Number(a.numChamada ?? 9999);
                const cb = Number(b.numChamada ?? 9999);
                if (ca !== cb) return ca - cb;
                return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
            });

            res.json({
                codClasse:           Number(codClasse),
                codPeriodoAvaliacao: Number(codPeriodo),
                alunos:              raw,
            });
        } catch (e) {
            console.error('[BOLETIM] Erro ao buscar notas:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
