-- ================================================================
-- INSERT de alunos — RCO Digital Proxy
-- Execute no Supabase → SQL Editor
--
-- Turmas disponíveis (copiadas diretamente do RCO):
--   • NEM EPT IF TEC DESE SIST-ET IC - 3ª Série - Manhã - C
--   • TEC EM DES DE SISTEMAS - ET IC - 1ª série - Manhã - C
--   • TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C
--
-- Instruções:
--   1. Substitua 'Nome Completo do Aluno' pelo nome real
--   2. Substitua 'RA0000000' pelo registro/RA do aluno
--   3. Preencha a data de nascimento no formato DD/MM/AAAA
--   4. Adicione ou remova linhas conforme necessário
--   5. A vírgula da última linha deve ser removida antes de executar
-- ================================================================

INSERT INTO alunos (nome, registro, turma, data_nascimento, status) VALUES

-- ================================================================
-- Turma: NEM EPT IF TEC DESE SIST-ET IC - 3ª Série - Manhã - C
-- ================================================================
('Nome Completo do Aluno',  'RA0000001', 'NEM EPT IF TEC DESE SIST-ET IC - 3ª Série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000002', 'NEM EPT IF TEC DESE SIST-ET IC - 3ª Série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000003', 'NEM EPT IF TEC DESE SIST-ET IC - 3ª Série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000004', 'NEM EPT IF TEC DESE SIST-ET IC - 3ª Série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000005', 'NEM EPT IF TEC DESE SIST-ET IC - 3ª Série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),

-- ================================================================
-- Turma: TEC EM DES DE SISTEMAS - ET IC - 1ª série - Manhã - C
-- ================================================================
('Nome Completo do Aluno',  'RA0000006', 'TEC EM DES DE SISTEMAS - ET IC - 1ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000007', 'TEC EM DES DE SISTEMAS - ET IC - 1ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000008', 'TEC EM DES DE SISTEMAS - ET IC - 1ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000009', 'TEC EM DES DE SISTEMAS - ET IC - 1ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000010', 'TEC EM DES DE SISTEMAS - ET IC - 1ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),

-- ================================================================
-- Turma: TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C
-- ================================================================
('Nome Completo do Aluno',  'RA0000011', 'TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000012', 'TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000013', 'TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000014', 'TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo'),
('Nome Completo do Aluno',  'RA0000015', 'TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C', 'DD/MM/AAAA', 'Ativo')

-- ⚠️ Sem vírgula na última linha!
ON CONFLICT (registro) DO UPDATE SET
    nome            = EXCLUDED.nome,
    turma           = EXCLUDED.turma,
    data_nascimento = EXCLUDED.data_nascimento,
    status          = EXCLUDED.status;
