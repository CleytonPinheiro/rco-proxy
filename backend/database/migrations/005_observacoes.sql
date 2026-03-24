-- ============================================================
-- OBSERVAÇÕES POR ALUNO (chamada diária RCO) — Execute no Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS rco_observacoes (
    id              SERIAL      PRIMARY KEY,
    cod_aula        INTEGER     NOT NULL,
    cod_classe      INTEGER     NOT NULL,
    cod_matriz_aluno INTEGER    NOT NULL,
    nome_aluno      TEXT        DEFAULT '',
    num_chamada     INTEGER,
    data_aula       DATE,
    observacao      TEXT        NOT NULL,
    sincronizado_em TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cod_aula, cod_matriz_aluno)
);

CREATE INDEX IF NOT EXISTS idx_obs_classe  ON rco_observacoes(cod_classe);
CREATE INDEX IF NOT EXISTS idx_obs_aluno   ON rco_observacoes(cod_matriz_aluno);
CREATE INDEX IF NOT EXISTS idx_obs_data    ON rco_observacoes(data_aula DESC);

ALTER TABLE rco_observacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_obs" ON rco_observacoes FOR ALL USING (true) WITH CHECK (true);
