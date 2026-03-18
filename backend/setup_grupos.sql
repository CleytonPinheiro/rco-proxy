-- ============================================================
-- GRUPOS DE TRABALHO — Execute no Supabase → SQL Editor
-- ============================================================

-- 1. Tabela de grupos
CREATE TABLE IF NOT EXISTS grupos (
    id            TEXT        PRIMARY KEY,
    cod_turma     INTEGER     NOT NULL,
    nome          TEXT        NOT NULL,
    descricao     TEXT        DEFAULT '',
    bloqueado     BOOLEAN     DEFAULT FALSE,
    criado_em     TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Membros do grupo (alunos)
CREATE TABLE IF NOT EXISTS grupo_alunos (
    id               SERIAL  PRIMARY KEY,
    grupo_id         TEXT    NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    cod_matriz_aluno INTEGER NOT NULL,
    nome             TEXT    DEFAULT '',
    num_chamada      INTEGER,
    adicionado_em    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(grupo_id, cod_matriz_aluno)
);

-- 3. Atividades / registros diários
CREATE TABLE IF NOT EXISTS grupo_atividades (
    id          TEXT  PRIMARY KEY,
    grupo_id    TEXT  NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    data        DATE  NOT NULL,
    descricao   TEXT  NOT NULL,
    criado_em   TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS: acesso livre via anon key (app single-user) ──────────────────────────
ALTER TABLE grupos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_alunos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_atividades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_grupos"      ON grupos          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_ga"          ON grupo_alunos    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_gativ"       ON grupo_atividades FOR ALL USING (true) WITH CHECK (true);
