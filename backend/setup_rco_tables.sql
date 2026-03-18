-- ============================================================
-- Tabelas RCO Digital — sincronizadas automaticamente pelo proxy
-- EXECUTE ESTE SQL UMA VEZ no Supabase → SQL Editor
-- ============================================================

-- 1. Tabela de estabelecimentos (escolas)
CREATE TABLE IF NOT EXISTS rco_estabelecimentos (
    cod_estabelecimento   INTEGER PRIMARY KEY,
    nome_estabelecimento  TEXT    NOT NULL,
    cod_municipio         INTEGER,
    atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de turmas
CREATE TABLE IF NOT EXISTS rco_turmas (
    cod_turma             INTEGER PRIMARY KEY,
    descr_turma           TEXT    NOT NULL,
    cod_seriacao          INTEGER,
    cod_estabelecimento   INTEGER REFERENCES rco_estabelecimentos(cod_estabelecimento),
    periodo_letivo        TEXT,
    atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de disciplinas
CREATE TABLE IF NOT EXISTS rco_disciplinas (
    cod_disciplina        INTEGER PRIMARY KEY,
    nome_disciplina       TEXT    NOT NULL,
    sigla                 TEXT,
    cor_fundo             TEXT,
    cor_letra             TEXT,
    atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de classes (turma × disciplina × período)
CREATE TABLE IF NOT EXISTS rco_classes (
    cod_classe            INTEGER PRIMARY KEY,
    cod_turma             INTEGER REFERENCES rco_turmas(cod_turma),
    cod_disciplina        INTEGER REFERENCES rco_disciplinas(cod_disciplina),
    cod_estabelecimento   INTEGER REFERENCES rco_estabelecimentos(cod_estabelecimento),
    periodo_letivo        TEXT,
    atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Log de sincronização
CREATE TABLE IF NOT EXISTS rco_sync_log (
    id                    SERIAL PRIMARY KEY,
    executado_em          TIMESTAMPTZ DEFAULT NOW(),
    status                TEXT    NOT NULL,
    estabelecimentos      INTEGER DEFAULT 0,
    turmas                INTEGER DEFAULT 0,
    disciplinas           INTEGER DEFAULT 0,
    classes               INTEGER DEFAULT 0,
    mensagem              TEXT
);

-- ============================================================
-- Segurança: leitura pública (sem autenticação) via anon key
-- ============================================================
ALTER TABLE rco_estabelecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE rco_turmas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rco_disciplinas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rco_classes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE rco_sync_log         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leitura_publica" ON rco_estabelecimentos FOR SELECT USING (true);
CREATE POLICY "leitura_publica" ON rco_turmas           FOR SELECT USING (true);
CREATE POLICY "leitura_publica" ON rco_disciplinas      FOR SELECT USING (true);
CREATE POLICY "leitura_publica" ON rco_classes          FOR SELECT USING (true);
CREATE POLICY "leitura_publica" ON rco_sync_log         FOR SELECT USING (true);

-- ============================================================
-- View consolidada: tudo em uma única consulta
-- ============================================================
CREATE OR REPLACE VIEW rco_dados_completos AS
SELECT
    e.cod_estabelecimento,
    e.nome_estabelecimento,
    t.cod_turma,
    t.descr_turma,
    t.periodo_letivo,
    d.cod_disciplina,
    d.nome_disciplina,
    d.sigla,
    c.cod_classe,
    c.atualizado_em
FROM rco_classes c
JOIN rco_estabelecimentos e ON e.cod_estabelecimento = c.cod_estabelecimento
JOIN rco_turmas           t ON t.cod_turma           = c.cod_turma
JOIN rco_disciplinas      d ON d.cod_disciplina       = c.cod_disciplina
ORDER BY e.nome_estabelecimento, t.descr_turma, d.nome_disciplina;
