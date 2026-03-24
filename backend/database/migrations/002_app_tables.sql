-- ============================================================
-- Tabelas da aplicação RCO Proxy (alunos, materiais, empréstimos)
-- Execute no Supabase → SQL Editor
-- ============================================================

-- 1. Alunos matriculados
CREATE TABLE IF NOT EXISTS alunos (
    id               SERIAL PRIMARY KEY,
    nome             TEXT    NOT NULL,
    registro         TEXT    UNIQUE NOT NULL,
    turma            TEXT,
    data_nascimento  TEXT,
    status           TEXT    DEFAULT 'Ativo',
    criado_em        TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Materiais (livros, kits, etc.)
CREATE TABLE IF NOT EXISTS materiais (
    id          SERIAL PRIMARY KEY,
    codigo      TEXT   UNIQUE NOT NULL,
    tipo        TEXT   NOT NULL,
    descricao   TEXT   NOT NULL,
    localizacao TEXT,
    estado      TEXT   DEFAULT 'otimo',
    status      TEXT   DEFAULT 'disponivel',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Empréstimos
CREATE TABLE IF NOT EXISTS emprestimos (
    id                    SERIAL PRIMARY KEY,
    aluno_id              INTEGER REFERENCES alunos(id),
    material_id           INTEGER REFERENCES materiais(id),
    professor             TEXT,
    aulas                 JSONB,
    observacoes           TEXT,
    status                TEXT    DEFAULT 'ativo',
    data_emprestimo       TIMESTAMPTZ DEFAULT NOW(),
    data_devolucao        TIMESTAMPTZ,
    estado_devolucao      TEXT,
    observacoes_devolucao TEXT
);

-- ============================================================
-- Segurança: RLS + políticas
-- ============================================================
ALTER TABLE alunos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE materiais  ENABLE ROW LEVEL SECURITY;
ALTER TABLE emprestimos ENABLE ROW LEVEL SECURITY;

-- Leitura pública
CREATE POLICY "leitura_publica" ON alunos      FOR SELECT USING (true);
CREATE POLICY "leitura_publica" ON materiais   FOR SELECT USING (true);
CREATE POLICY "leitura_publica" ON emprestimos FOR SELECT USING (true);

-- Escrita do backend
CREATE POLICY "escrita_backend" ON alunos      FOR INSERT WITH CHECK (true);
CREATE POLICY "escrita_backend" ON materiais   FOR INSERT WITH CHECK (true);
CREATE POLICY "escrita_backend" ON emprestimos FOR INSERT WITH CHECK (true);
CREATE POLICY "update_backend"  ON alunos      FOR UPDATE USING (true);
CREATE POLICY "update_backend"  ON materiais   FOR UPDATE USING (true);
CREATE POLICY "update_backend"  ON emprestimos FOR UPDATE USING (true);
CREATE POLICY "delete_backend"  ON materiais   FOR DELETE USING (true);
CREATE POLICY "delete_backend"  ON emprestimos FOR DELETE USING (true);
