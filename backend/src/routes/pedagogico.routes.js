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

export function createPedagogicoRouter({ supabaseAdmin }) {
    const router = Router();

    // GET /api/pedagogico — ocorrências do Supabase + notas + meta do professor (local PG)
    router.get('/pedagogico', async (req, res) => {
        const { tipo, codTurma, dataInicio, dataFim } = req.query;
        try {
            // Busca ocorrências no Supabase
            let query = supabaseAdmin
                .from('aluno_ocorrencias')
                .select('*')
                .order('data', { ascending: false })
                .order('criado_em', { ascending: false });

            if (tipo && tipo !== 'todos')   query = query.eq('tipo', tipo);
            if (codTurma) {
                // Supabase armazena cod_turma como inteiro — usa eq com int
                const codNum = parseInt(codTurma, 10);
                if (!isNaN(codNum)) query = query.eq('cod_turma', codNum);
            }
            if (dataInicio) query = query.gte('data', dataInicio);
            if (dataFim)    query = query.lte('data', dataFim);

            const { data: ocorrencias, error } = await query;
            if (error) return res.status(500).json({ erro: error.message });

            const ids = (ocorrencias || []).map(o => o.id);

            // Busca notas pedagógicas e metadados do professor (tudo no local PG)
            let notasMap = {};
            let metaMap  = {};

            if (ids.length > 0) {
                const [notasResult, metaResult] = await Promise.all([
                    pool.query(
                        `SELECT * FROM pedagogo_notas WHERE id_ocorrencia = ANY($1)`,
                        [ids]
                    ),
                    pool.query(
                        `SELECT * FROM ocorrencia_meta WHERE id_ocorrencia = ANY($1)`,
                        [ids]
                    ).catch(() => ({ rows: [] })), // tabela pode não existir em instâncias antigas
                ]);
                notasResult.rows.forEach(r => { notasMap[r.id_ocorrencia] = r; });
                metaResult.rows.forEach(r => { metaMap[r.id_ocorrencia] = r; });
            }

            // Mescla: cada ocorrência ganha .pedagogo e .meta
            const resultado = (ocorrencias || []).map(o => ({
                ...o,
                pedagogo: notasMap[o.id] || null,
                meta: metaMap[o.id] || null,
            }));

            res.json(resultado);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // GET /api/pedagogico/observacoes-rco — observações do RCO enriquecidas com turma + notas
    router.get('/pedagogico/observacoes-rco', async (req, res) => {
        const { codTurma, dataInicio, dataFim } = req.query;
        try {
            // 1. Busca todas as observações do RCO no Supabase
            let obsQuery = supabaseAdmin
                .from('rco_observacoes')
                .select('*')
                .order('data_aula', { ascending: false });

            if (dataInicio) obsQuery = obsQuery.gte('data_aula', dataInicio);
            if (dataFim)    obsQuery = obsQuery.lte('data_aula', dataFim);

            const { data: observacoes, error: obsErr } = await obsQuery;
            if (obsErr) return res.status(500).json({ erro: obsErr.message });
            if (!observacoes || observacoes.length === 0) return res.json([]);

            // 2. Busca alunos para mapear cod_matriz_aluno → {codturma, turma}
            const { data: alunos } = await supabaseAdmin
                .from('alunos')
                .select('codmatrizaluno, codturma, turma');

            const alunoMap = {};
            (alunos || []).forEach(a => {
                alunoMap[a.codmatrizaluno] = { codturma: a.codturma, nome_turma: a.turma || '' };
            });

            // 3. Enriquece observações com turma e filtra por codTurma se pedido
            let enriquecidas = observacoes.map(o => {
                const info = alunoMap[o.cod_matriz_aluno] || {};
                return { ...o, cod_turma: info.codturma || null, nome_turma: info.nome_turma || '' };
            });

            if (codTurma) {
                const codNum = parseInt(codTurma, 10);
                enriquecidas = enriquecidas.filter(o => o.cod_turma === codNum);
            }

            // 4. Busca notas pedagógicas no local PG (usa id 'rco_{cod_aula}_{cod_matriz_aluno}')
            const rcoIds = enriquecidas.map(o => `rco_${o.cod_aula}_${o.cod_matriz_aluno}`);
            let notasMap = {};
            if (rcoIds.length > 0) {
                const { rows } = await pool.query(
                    `SELECT * FROM pedagogo_notas WHERE id_ocorrencia = ANY($1)`,
                    [rcoIds]
                );
                rows.forEach(r => { notasMap[r.id_ocorrencia] = r; });
            }

            // 5. Mescla
            const resultado = enriquecidas.map(o => {
                const rcoId = `rco_${o.cod_aula}_${o.cod_matriz_aluno}`;
                return {
                    ...o,
                    _rco_id: rcoId,    // identificador para as notas pedagógicas
                    tipo:    'rco_obs', // tipo especial para o painel
                    pedagogo: notasMap[rcoId] || null,
                };
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
