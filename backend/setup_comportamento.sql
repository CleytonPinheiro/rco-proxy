-- ============================================================
-- COMPORTAMENTO & RECONHECIMENTO — Execute no Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS aluno_ocorrencias (
    id               TEXT        PRIMARY KEY,
    cod_matriz_aluno INTEGER     NOT NULL,
    cod_turma        INTEGER     NOT NULL,
    nome_aluno       TEXT        NOT NULL,
    num_chamada      INTEGER,
    data             DATE        NOT NULL,
    tipo             TEXT        NOT NULL CHECK (tipo IN ('positivo','atencao','grave')),
    categoria        TEXT        NOT NULL,
    descricao        TEXT        DEFAULT '',
    pontos           INTEGER     NOT NULL DEFAULT 0,
    criado_em        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocorrencias_turma   ON aluno_ocorrencias(cod_turma);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_aluno   ON aluno_ocorrencias(cod_matriz_aluno);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_data    ON aluno_ocorrencias(data DESC);

ALTER TABLE aluno_ocorrencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_ocorrencias" ON aluno_ocorrencias FOR ALL USING (true) WITH CHECK (true);
