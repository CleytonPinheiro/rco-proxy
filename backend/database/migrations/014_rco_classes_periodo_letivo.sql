-- ============================================================
-- Migration 014 — adiciona cod_periodo_letivo em rco_classes
-- EXECUTE NO Supabase → SQL Editor
-- Idempotente: ADD COLUMN IF NOT EXISTS é seguro re-executar
-- ============================================================

ALTER TABLE rco_classes
    ADD COLUMN IF NOT EXISTS cod_periodo_letivo INTEGER;

-- Atualiza a view para incluir ambas as colunas de período
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
        c.cod_periodo_avaliacao,
        c.cod_periodo_letivo,
        c.atualizado_em
FROM rco_classes c
JOIN rco_estabelecimentos e ON e.cod_estabelecimento = c.cod_estabelecimento
JOIN rco_turmas           t ON t.cod_turma           = c.cod_turma
JOIN rco_disciplinas      d ON d.cod_disciplina       = c.cod_disciplina
ORDER BY e.nome_estabelecimento, t.descr_turma, d.nome_disciplina;
