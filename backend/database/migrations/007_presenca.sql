-- ============================================================
-- Módulo de Presença Diária + Cozinha — EduGest
-- EXECUTE ESTE SQL UMA VEZ no Supabase → SQL Editor
-- ============================================================

-- 1. Presença diária por turma
CREATE TABLE IF NOT EXISTS presenca_diaria (
    id                  SERIAL PRIMARY KEY,
    data                DATE        NOT NULL,
    periodo             VARCHAR(10) NOT NULL,  -- 'manha', 'tarde', 'noite'
    cod_turma           INTEGER     NOT NULL,
    descr_turma         TEXT,
    total_matriculados  INTEGER     DEFAULT 0,
    total_presentes     INTEGER,               -- NULL = ainda não confirmado
    total_ausentes      INTEGER,
    fonte               VARCHAR(20) DEFAULT 'estimado', -- 'rco', 'professor', 'estimado'
    confirmado          BOOLEAN     DEFAULT FALSE,
    confirmado_em       TIMESTAMPTZ,
    observacao          TEXT,
    criado_em           TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(data, cod_turma)
);

-- 2. Confirmação da cozinha por turno
CREATE TABLE IF NOT EXISTS cozinha_cardapio (
    id                  SERIAL PRIMARY KEY,
    data                DATE        NOT NULL,
    periodo             VARCHAR(10) NOT NULL,  -- 'manha', 'tarde', 'noite'
    total_confirmado    INTEGER     NOT NULL,
    observacao          TEXT,
    confirmado_em       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(data, periodo)
);

-- ============================================================
-- Segurança (Row Level Security)
-- ============================================================
ALTER TABLE presenca_diaria  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cozinha_cardapio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leitura_publica"  ON presenca_diaria  FOR SELECT USING (true);
CREATE POLICY "leitura_publica"  ON cozinha_cardapio FOR SELECT USING (true);
CREATE POLICY "escrita_backend"  ON presenca_diaria  FOR INSERT WITH CHECK (true);
CREATE POLICY "escrita_backend"  ON cozinha_cardapio FOR INSERT WITH CHECK (true);
CREATE POLICY "update_backend"   ON presenca_diaria  FOR UPDATE USING (true);
CREATE POLICY "update_backend"   ON cozinha_cardapio FOR UPDATE USING (true);
CREATE POLICY "delete_backend"   ON presenca_diaria  FOR DELETE USING (true);
CREATE POLICY "delete_backend"   ON cozinha_cardapio FOR DELETE USING (true);
