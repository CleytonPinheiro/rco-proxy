import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrarTabela() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedagogo_notas (
                id_ocorrencia   TEXT        PRIMARY KEY,
                nota            TEXT        NOT NULL DEFAULT '',
                encaminhamento  TEXT        NOT NULL DEFAULT '',
                visto           BOOLEAN     NOT NULL DEFAULT FALSE,
                visto_em        TIMESTAMPTZ,
                criado_em       TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('[PEDAGOGICO] Tabela pedagogo_notas OK');
    } catch (e) {
        console.warn('[PEDAGOGICO] Erro na migração:', e.message);
    }
}

migrarTabela();

// Retorna os cod_turma do usuário atual (rco_turmas é limpo e re-sync no login)
async function getTurmasDoUsuario(supabaseAdmin) {
    const { data, error } = await supabaseAdmin.from('rco_turmas').select('cod_turma');
    if (error || !data || data.length === 0) return null;
    return data.map(r => r.cod_turma);
}

// Sincroniza observações RCO para uma única classe.
// Busca apenas as aulas mais recentes (últimas `maxAulas`) para agilizar.
async function sincronizarClasseObs(rcoApiService, supabaseAdmin, codClasse, codPeriodoAvaliacao, codPeriodoLetivo, maxAulas = 40) {
    try {
        const freqResp = await rcoApiService.get(
            `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`
        );
        const alunosFreq = Array.isArray(freqResp.data) ? freqResp.data : [];
        const aulaSet = new Set();
        alunosFreq.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));

        // Pega apenas as aulas mais recentes (IDs maiores = mais recentes)
        const codAulas = [...aulaSet]
            .sort((a, b) => parseInt(b) - parseInt(a))  // mais recentes primeiro
            .slice(0, maxAulas);

        if (!codAulas.length) return 0;

        const BATCH = 10;
        let total = 0;
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
            const obs = resultados.flat();
            if (obs.length > 0) {
                await supabaseAdmin.from('rco_observacoes').upsert(obs, { onConflict: 'cod_aula,cod_matriz_aluno' });
                total += obs.length;
            }
        }
        return total;
    } catch (e) {
        console.warn(`[PEDAGOGICO] Erro sync classe ${codClasse}:`, e.message);
        return 0;
    }
}

export function createPedagogicoRouter({ supabaseAdmin, rcoApiService }) {
    const router = Router();

    // POST /api/pedagogico/sincronizar-rco
    // Sincroniza observações RCO de todas as turmas do professor atual.
    // Chamado automaticamente pelo frontend ao abrir o Painel Pedagógico.
    router.post('/pedagogico/sincronizar-rco', async (req, res) => {
        try {
            // Busca todas as classes do usuário atual
            const turmas = await getTurmasDoUsuario(supabaseAdmin);
            let classesQuery = supabaseAdmin
                .from('rco_classes')
                .select('cod_classe, cod_turma, periodo_letivo');
            if (turmas && turmas.length > 0) {
                classesQuery = classesQuery.in('cod_turma', turmas);
            }
            const { data: classes, error: classesErr } = await classesQuery;
            if (classesErr || !classes || classes.length === 0) {
                return res.json({ status: 'sem_classes', total: 0 });
            }

            console.log(`[PEDAGOGICO] Sincronizando observações de ${classes.length} classe(s)...`);

            // Sincroniza todas as classes EM PARALELO para velocidade máxima
            const resultados = await Promise.all(
                classes.map(c => sincronizarClasseObs(
                    rcoApiService,
                    supabaseAdmin,
                    c.cod_classe,
                    9,    // codPeriodoAvaliacao — 1º Trimestre 2026
                    261,  // codPeriodoLetivo     — 2026-1
                ))
            );

            const totalObs = resultados.reduce((s, n) => s + n, 0);
            console.log(`[PEDAGOGICO] Sync concluído: ${totalObs} observações em ${classes.length} classe(s).`);
            res.json({ status: 'ok', classes: classes.length, totalObs });
        } catch (e) {
            console.error('[PEDAGOGICO] Erro sincronizar-rco:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    // GET /api/pedagogico — ocorrências do Supabase + notas + meta do professor (local PG)
    router.get('/pedagogico', async (req, res) => {
        const { tipo, codTurma, dataInicio, dataFim } = req.query;
        try {
            let query = supabaseAdmin
                .from('aluno_ocorrencias')
                .select('*')
                .order('data', { ascending: false })
                .order('criado_em', { ascending: false });

            if (tipo && tipo !== 'todos') query = query.eq('tipo', tipo);

            if (codTurma) {
                const codNum = parseInt(codTurma, 10);
                if (!isNaN(codNum)) query = query.eq('cod_turma', codNum);
            } else {
                const turmasDoUsuario = await getTurmasDoUsuario(supabaseAdmin);
                if (turmasDoUsuario && turmasDoUsuario.length > 0) {
                    query = query.in('cod_turma', turmasDoUsuario);
                }
            }

            if (dataInicio) query = query.gte('data', dataInicio);
            if (dataFim)    query = query.lte('data', dataFim);

            const { data: ocorrencias, error } = await query;
            if (error) return res.status(500).json({ erro: error.message });

            const ids = (ocorrencias || []).map(o => o.id);
            let notasMap = {};
            let metaMap  = {};

            if (ids.length > 0) {
                const [notasResult, metaResult] = await Promise.all([
                    pool.query(`SELECT * FROM pedagogo_notas WHERE id_ocorrencia = ANY($1)`, [ids]),
                    pool.query(`SELECT * FROM ocorrencia_meta WHERE id_ocorrencia = ANY($1)`, [ids])
                        .catch(() => ({ rows: [] })),
                ]);
                notasResult.rows.forEach(r => { notasMap[r.id_ocorrencia] = r; });
                metaResult.rows.forEach(r => { metaMap[r.id_ocorrencia] = r; });
            }

            const resultado = (ocorrencias || []).map(o => ({
                ...o,
                pedagogo: notasMap[o.id] || null,
                meta: metaMap[o.id] || null,
            }));

            res.json(resultado);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // GET /api/pedagogico/observacoes-rco — obs RCO do banco + notas pedagógicas
    router.get('/pedagogico/observacoes-rco', async (req, res) => {
        const { codTurma, dataInicio, dataFim } = req.query;
        try {
            let obsQuery = supabaseAdmin
                .from('rco_observacoes')
                .select('*')
                .order('data_aula', { ascending: false });

            if (dataInicio) obsQuery = obsQuery.gte('data_aula', dataInicio);
            if (dataFim)    obsQuery = obsQuery.lte('data_aula', dataFim);

            const { data: observacoes, error: obsErr } = await obsQuery;
            if (obsErr) return res.status(500).json({ erro: obsErr.message });
            if (!observacoes || observacoes.length === 0) return res.json([]);

            // Mapeia codMatrizAluno → turma via tabela alunos
            const { data: alunos } = await supabaseAdmin
                .from('alunos')
                .select('codmatrizaluno, codturma, turma');
            const alunoMap = {};
            (alunos || []).forEach(a => {
                alunoMap[a.codmatrizaluno] = { codturma: a.codturma, nome_turma: a.turma || '' };
            });

            let enriquecidas = observacoes.map(o => {
                const info = alunoMap[o.cod_matriz_aluno] || {};
                return { ...o, cod_turma: info.codturma || null, nome_turma: info.nome_turma || '' };
            });

            // Filtra pelas turmas do usuário atual
            if (codTurma) {
                const codNum = parseInt(codTurma, 10);
                enriquecidas = enriquecidas.filter(o => o.cod_turma === codNum);
            } else {
                const turmasDoUsuario = await getTurmasDoUsuario(supabaseAdmin);
                if (turmasDoUsuario && turmasDoUsuario.length > 0) {
                    enriquecidas = enriquecidas.filter(o => turmasDoUsuario.includes(o.cod_turma));
                }
            }

            // Notas pedagógicas no local PG
            const rcoIds = enriquecidas.map(o => `rco_${o.cod_aula}_${o.cod_matriz_aluno}`);
            let notasMap = {};
            if (rcoIds.length > 0) {
                const { rows } = await pool.query(
                    `SELECT * FROM pedagogo_notas WHERE id_ocorrencia = ANY($1)`,
                    [rcoIds]
                );
                rows.forEach(r => { notasMap[r.id_ocorrencia] = r; });
            }

            const resultado = enriquecidas.map(o => {
                const rcoId = `rco_${o.cod_aula}_${o.cod_matriz_aluno}`;
                return { ...o, _rco_id: rcoId, tipo: 'rco_obs', pedagogo: notasMap[rcoId] || null };
            });

            res.json(resultado);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // POST /api/pedagogico/nota — salvar/atualizar nota pedagógica
    router.post('/pedagogico/nota', async (req, res) => {
        const { id_ocorrencia, nota, encaminhamento, visto } = req.body;
        if (!id_ocorrencia) return res.status(400).json({ erro: 'id_ocorrencia é obrigatório' });
        try {
            await pool.query(`
                INSERT INTO pedagogo_notas (id_ocorrencia, nota, encaminhamento, visto, visto_em, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (id_ocorrencia)
                DO UPDATE SET
                    nota           = EXCLUDED.nota,
                    encaminhamento = EXCLUDED.encaminhamento,
                    visto          = EXCLUDED.visto,
                    visto_em       = EXCLUDED.visto_em,
                    updated_at     = NOW()
            `, [
                id_ocorrencia,
                nota || '',
                encaminhamento || '',
                visto === true,
                visto === true ? new Date().toISOString() : null,
            ]);
            const { rows } = await pool.query(
                'SELECT * FROM pedagogo_notas WHERE id_ocorrencia = $1',
                [id_ocorrencia]
            );
            res.json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
