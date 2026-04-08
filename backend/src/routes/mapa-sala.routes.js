import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrarTabela() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mapa_sala (
                id            SERIAL PRIMARY KEY,
                codturma      BIGINT  NOT NULL UNIQUE,
                turma         TEXT    NOT NULL,
                colunas       INTEGER NOT NULL DEFAULT 5,
                filas         INTEGER NOT NULL DEFAULT 6,
                posicoes      JSONB   NOT NULL DEFAULT '[]',
                alunos_fora   JSONB   NOT NULL DEFAULT '[]',
                criado_em     TIMESTAMPTZ DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`ALTER TABLE mapa_sala ADD COLUMN IF NOT EXISTS alunos_excluidos JSONB NOT NULL DEFAULT '[]'`);
        console.log('[MAPA-SALA] Tabela mapa_sala OK');
    } catch (e) {
        console.warn('[MAPA-SALA] Erro na migração:', e.message);
    }
}

migrarTabela();

export function createMapaSalaRouter() {
    const router = Router();

    // GET /mapa-sala?codturma=xxx — retorna o mapa salvo
    router.get('/mapa-sala', async (req, res) => {
        const { codturma } = req.query;
        if (!codturma) return res.status(400).json({ erro: 'codturma obrigatório' });
        try {
            const { rows } = await pool.query(
                'SELECT * FROM mapa_sala WHERE codturma = $1',
                [parseInt(codturma)]
            );
            res.json(rows[0] || null);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // POST /mapa-sala — cria ou atualiza (upsert por codturma)
    router.post('/mapa-sala', async (req, res) => {
        const { codturma, turma, colunas, filas, posicoes, alunos_fora, alunos_excluidos } = req.body;
        if (!codturma || !turma) return res.status(400).json({ erro: 'codturma e turma obrigatórios' });
        try {
            const { rows } = await pool.query(`
                INSERT INTO mapa_sala (codturma, turma, colunas, filas, posicoes, alunos_fora, alunos_excluidos, atualizado_em)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT (codturma) DO UPDATE SET
                    turma             = EXCLUDED.turma,
                    colunas           = EXCLUDED.colunas,
                    filas             = EXCLUDED.filas,
                    posicoes          = EXCLUDED.posicoes,
                    alunos_fora       = EXCLUDED.alunos_fora,
                    alunos_excluidos  = EXCLUDED.alunos_excluidos,
                    atualizado_em     = NOW()
                RETURNING *
            `, [
                parseInt(codturma),
                turma,
                parseInt(colunas) || 5,
                parseInt(filas)   || 6,
                JSON.stringify(posicoes          || []),
                JSON.stringify(alunos_fora       || []),
                JSON.stringify(alunos_excluidos  || []),
            ]);
            res.json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
