-- ── Migração 010: Módulo de Circulação ──────────────────────────────────────
-- Executa no Supabase SQL Editor

-- Ambientes (banheiros, laboratórios, etc.)
CREATE TABLE IF NOT EXISTS ambientes (
    id            SERIAL PRIMARY KEY,
    nome          TEXT NOT NULL,
    tipo          TEXT DEFAULT 'banheiro',
    capacidade_max INT  DEFAULT 2,
    ativo         BOOLEAN DEFAULT true,
    criado_em     TIMESTAMPTZ DEFAULT now()
);

-- Registros de circulação (entrada/saída)
CREATE TABLE IF NOT EXISTS registros_circulacao (
    id               SERIAL PRIMARY KEY,
    cod_matriz_aluno BIGINT      NOT NULL,
    ambiente_id      INT         NOT NULL,
    entrada_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    saida_em         TIMESTAMPTZ,
    criado_em        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_circ_aluno    ON registros_circulacao(cod_matriz_aluno);
CREATE INDEX IF NOT EXISTS idx_circ_ambiente ON registros_circulacao(ambiente_id);
CREATE INDEX IF NOT EXISTS idx_circ_entrada  ON registros_circulacao(entrada_em DESC);

-- Desabilitar RLS
ALTER TABLE ambientes             DISABLE ROW LEVEL SECURITY;
ALTER TABLE registros_circulacao  DISABLE ROW LEVEL SECURITY;

-- Ambientes padrão (só insere se a tabela estiver vazia)
INSERT INTO ambientes (nome, tipo, capacidade_max)
SELECT * FROM (VALUES
    ('Banheiro Masculino',  'banheiro', 3),
    ('Banheiro Feminino',   'banheiro', 3),
    ('Banheiro Adaptado',   'banheiro', 1)
) AS v(nome, tipo, capacidade_max)
WHERE NOT EXISTS (SELECT 1 FROM ambientes LIMIT 1);
