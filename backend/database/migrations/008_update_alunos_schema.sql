-- ============================================================
-- Migração: adicionar colunas RCO à tabela alunos existente
-- Execute no Supabase → SQL Editor
-- ============================================================

ALTER TABLE alunos
  ADD COLUMN IF NOT EXISTS codmatrizaluno BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS codturma       INTEGER,
  ADD COLUMN IF NOT EXISTS numchamada     INTEGER;

-- Índices para buscas rápidas por turma e número de chamada
CREATE INDEX IF NOT EXISTS idx_alunos_codturma   ON alunos (codturma);
CREATE INDEX IF NOT EXISTS idx_alunos_numchamada ON alunos (numchamada);
