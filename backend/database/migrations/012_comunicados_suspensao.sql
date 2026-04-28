-- ── Migração 012: Histórico de Comunicados de Suspensão ─────────────────────
-- Executa no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS edusync_comunicados_suspensao (
    id              SERIAL PRIMARY KEY,
    aluno_id        BIGINT,
    nome_aluno      TEXT    NOT NULL,
    turma           TEXT,
    registro        TEXT,
    responsavel     TEXT    NOT NULL,
    data_inicio     DATE    NOT NULL,
    data_fim        DATE    NOT NULL,
    motivo          TEXT,
    gerado_por_id   BIGINT,
    gerado_por_nome TEXT,
    emitido_em      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cs_aluno_id  ON edusync_comunicados_suspensao(aluno_id);
CREATE INDEX IF NOT EXISTS idx_cs_emitido   ON edusync_comunicados_suspensao(emitido_em DESC);
CREATE INDEX IF NOT EXISTS idx_cs_nome      ON edusync_comunicados_suspensao(nome_aluno);

ALTER TABLE edusync_comunicados_suspensao DISABLE ROW LEVEL SECURITY;
