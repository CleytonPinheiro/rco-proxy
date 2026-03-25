-- ── Migração 011: Comunicados de Falta ──────────────────────────────────
-- Executa no Supabase SQL Editor

-- Configurações gerais (chave-valor)
CREATE TABLE IF NOT EXISTS configuracoes (
    chave        TEXT PRIMARY KEY,
    valor        TEXT,
    atualizado_em TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE configuracoes DISABLE ROW LEVEL SECURITY;

-- Contatos dos responsáveis por aluno
CREATE TABLE IF NOT EXISTS responsaveis_contato (
    cod_matriz_aluno BIGINT PRIMARY KEY,
    nome_responsavel TEXT,
    telefone         TEXT,  -- formato: 5541999999999 (sem + e sem espaços)
    email            TEXT,
    atualizado_em    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE responsaveis_contato DISABLE ROW LEVEL SECURITY;

-- Comunicados de falta
CREATE TABLE IF NOT EXISTS comunicados_falta (
    id               SERIAL PRIMARY KEY,
    cod_matriz_aluno BIGINT NOT NULL,
    nome_aluno       TEXT   NOT NULL,
    num_chamada      INT,
    cod_turma        BIGINT,
    descr_turma      TEXT,
    data_falta       DATE   NOT NULL,
    -- Contato usado no envio
    telefone         TEXT,
    nome_responsavel TEXT,
    -- Envio
    canal            TEXT  DEFAULT 'whatsapp',
    enviado_em       TIMESTAMPTZ,
    status           TEXT  DEFAULT 'pendente',
    -- pendente | enviado | respondido | justificado | sem_resposta | cancelado
    -- Resposta do responsável
    resposta_texto   TEXT,
    resposta_em      TIMESTAMPTZ,
    -- Classificação e validação
    tipo_justificativa TEXT,
    -- doenca | consulta | viagem | outro | nao_justificado
    justificativa_valida BOOLEAN,
    validado_em      TIMESTAMPTZ,
    obs              TEXT,
    criado_em        TIMESTAMPTZ DEFAULT now(),
    UNIQUE (cod_matriz_aluno, data_falta)
);

CREATE INDEX IF NOT EXISTS idx_com_aluno    ON comunicados_falta(cod_matriz_aluno);
CREATE INDEX IF NOT EXISTS idx_com_data     ON comunicados_falta(data_falta DESC);
CREATE INDEX IF NOT EXISTS idx_com_status   ON comunicados_falta(status);
CREATE INDEX IF NOT EXISTS idx_com_turma    ON comunicados_falta(cod_turma);

ALTER TABLE comunicados_falta DISABLE ROW LEVEL SECURITY;
