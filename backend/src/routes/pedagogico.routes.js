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

    // GET /api/pedagogico — ocorrências (de/grave/atencao) + notas do pedagogo
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
            if (codTurma)                   query = query.eq('cod_turma', parseInt(codTurma));
            if (dataInicio)                 query = query.gte('data', dataInicio);
            if (dataFim)                    query = query.lte('data', dataFim);

            const { data: ocorrencias, error } = await query;
            if (error) return res.status(500).json({ erro: error.message });

            // Busca notas no local PG
            const ids = (ocorrencias || []).map(o => o.id);
            let notasMap = {};
            if (ids.length > 0) {
                const { rows } = await pool.query(
                    `SELECT * FROM pedagogo_notas WHERE id_ocorrencia = ANY($1)`,
                    [ids]
                );
                rows.forEach(r => { notasMap[r.id_ocorrencia] = r; });
            }

            // Mescla
            const resultado = (ocorrencias || []).map(o => ({
                ...o,
                pedagogo: notasMap[o.id] || null,
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
