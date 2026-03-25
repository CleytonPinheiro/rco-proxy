-- ============================================================
-- Migração 009: Corrigir tipos de coluna e políticas RLS da tabela alunos
-- Execute no Supabase → SQL Editor
-- ============================================================

-- 1. Expandir colunas que podem ter ficado como VARCHAR(50) para TEXT
ALTER TABLE alunos
  ALTER COLUMN nome    TYPE TEXT,
  ALTER COLUMN turma   TYPE TEXT,
  ALTER COLUMN registro TYPE TEXT;

-- 2. Desabilitar Row Level Security na tabela alunos
--    (app de professor único — sem isolamento multi-tenant via RLS)
ALTER TABLE alunos DISABLE ROW LEVEL SECURITY;

-- 3. Garantir política permissiva caso RLS seja reativada no futuro
DROP POLICY IF EXISTS "allow_all_alunos" ON alunos;
CREATE POLICY "allow_all_alunos" ON alunos FOR ALL USING (true) WITH CHECK (true);

-- 4. Garantir mesma permissividade para outras tabelas de suporte
ALTER TABLE IF EXISTS rco_turmas         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rco_classes        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rco_disciplinas    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rco_estabelecimentos DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rco_sync_log       DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS crachas            DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS grupos             DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS grupo_alunos       DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS grupo_atividades   DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS comportamento      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS presenca_diaria    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cozinha_confirmacoes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS materiais          DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS emprestimos        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rco_observacoes    DISABLE ROW LEVEL SECURITY;
