import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrarTabela() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS atividades_sala (
                id              SERIAL PRIMARY KEY,
                codturma        TEXT        NOT NULL,
                codmatrizaluno  TEXT        NOT NULL,
                data            DATE        NOT NULL,
                nome_aluno      TEXT        NOT NULL DEFAULT '',
                num_chamada     INTEGER,
                atividades      JSONB       NOT NULL DEFAULT '{}',
                observacao      TEXT        NOT NULL DEFAULT '',
                criado_em       TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (codturma, codmatrizaluno, data)
            )
        `);
        console.log('[ATIVIDADES] Tabela atividades_sala OK');
    } catch (e) {
        console.warn('[ATIVIDADES] Erro na migração:', e.message);
    }
}

migrarTabela();

export function createAtividadesRouter() {
    const router = Router();

    // GET /api/atividades?codturma=X&data=YYYY-MM-DD
    router.get('/atividades', async (req, res) => {
        const { codturma, data } = req.query;
        if (!codturma || !data) {
            return res.status(400).json({ erro: 'codturma e data são obrigatórios' });
        }
        try {
            const { rows } = await pool.query(
                `SELECT * FROM atividades_sala WHERE codturma = $1 AND data = $2 ORDER BY num_chamada, nome_aluno`,
                [codturma, data]
            );
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // POST /api/atividades/salvar — upsert em lote
    router.post('/atividades/salvar', async (req, res) => {
        const { codturma, data, registros } = req.body;
        if (!codturma || !data || !Array.isArray(registros)) {
            return res.status(400).json({ erro: 'codturma, data e registros são obrigatórios' });
        }
        try {
            for (const r of registros) {
                await pool.query(`
                    INSERT INTO atividades_sala
                        (codturma, codmatrizaluno, data, nome_aluno, num_chamada, atividades, observacao, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (codturma, codmatrizaluno, data)
                    DO UPDATE SET
                        atividades  = EXCLUDED.atividades,
                        observacao  = EXCLUDED.observacao,
                        nome_aluno  = EXCLUDED.nome_aluno,
                        num_chamada = EXCLUDED.num_chamada,
                        updated_at  = NOW()
                `, [
                    codturma,
                    r.codmatrizaluno,
                    data,
                    r.nome_aluno || '',
                    r.num_chamada || null,
                    JSON.stringify(r.atividades || {}),
                    r.observacao || '',
                ]);
            }
            res.json({ ok: true, salvos: registros.length });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
