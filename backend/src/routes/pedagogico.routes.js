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
