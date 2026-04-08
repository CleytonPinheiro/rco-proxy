/**
 * RCO Lançamento — lançamento de notas do Classroom direto no RCO Digital
 *
 * GET  /api/rco-lancamento/avaliacoes          — lista avaliações parciais de uma classe
 * GET  /api/rco-lancamento/avaliacoes/:id      — detalha avaliação (com alunos RCO)
 * POST /api/rco-lancamento/avaliacoes/:id/lancar — executa PUT no RCO com notas calculadas
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
            res.json(r.data);
        } catch (e) {
            console.error('[RCO-LANC] Erro ao buscar avaliação:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── POST /api/rco-lancamento/avaliacoes/:id/lancar
       Lança notas no RCO.
       Body: { meta: {...}, alunos: [{...rcoFields, notaDecimal: "3.5"}] }
    ─────────────────────────────────────────────────────── */
    router.post('/rco-lancamento/avaliacoes/:id/lancar', async (req, res) => {
        const { id } = req.params;
        const { meta, alunos } = req.body;

        if (!meta || !alunos?.length) {
            return res.status(400).json({ erro: 'meta e alunos são obrigatórios' });
        }

        try {
            /* Extrai codUsuario do JWT RCO atual */
            const token   = await rcoApiService.getToken();
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
            const codUsuario = Number(payload.resoucreowner_id || payload.resouceowner_id || 0);

            const agora = new Date().toISOString().replace('T', 'T').replace('Z', '+0000');

            const body = {
                ...meta,
                codUsuario,
                dataAtualizacao: agora,
                alunos,
            };

            console.log(`[RCO-LANC] Lançando ${alunos.length} notas na avaliação ${id} | codUsuario=${codUsuario}`);

            const r = await rcoApiService.put(
                `${RCO_CLASSE_BASE}/avaliacaoParcialClasses/${id}`,
                body,
                { grupo: 'D' }
            );

            if (r.status >= 400) {
                console.error('[RCO-LANC] Erro no PUT RCO:', r.status, JSON.stringify(r.data));
                return res.status(r.status).json({ erro: 'Erro ao lançar notas no RCO', detalhe: r.data });
            }

            console.log(`[RCO-LANC] Sucesso! Status RCO: ${r.status}`);
            res.json({ ok: true, status: r.status, resposta: r.data });
        } catch (e) {
            console.error('[RCO-LANC] Erro ao lançar:', e.message);
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
