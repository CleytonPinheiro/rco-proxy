-- Execute este SQL no Supabase SQL Editor para criar as tabelas

-- Tabela de Alunos
CREATE TABLE IF NOT EXISTS alunos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    registro VARCHAR(20) UNIQUE NOT NULL,
    turma VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Materiais
CREATE TABLE IF NOT EXISTS materiais (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    descricao TEXT NOT NULL,
    localizacao VARCHAR(100),
    estado VARCHAR(20) DEFAULT 'otimo',
    status VARCHAR(20) DEFAULT 'disponivel',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Empréstimos
CREATE TABLE IF NOT EXISTS emprestimos (
    id SERIAL PRIMARY KEY,
    aluno_id INTEGER REFERENCES alunos(id),
    material_id INTEGER REFERENCES materiais(id),
    professor VARCHAR(255),
    aulas INTEGER[] NOT NULL,
    observacoes TEXT,
    data_emprestimo TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    data_devolucao TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'ativo',
    estado_devolucao VARCHAR(20),
    observacoes_devolucao TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_materiais_status ON materiais(status);
CREATE INDEX IF NOT EXISTS idx_materiais_tipo ON materiais(tipo);
CREATE INDEX IF NOT EXISTS idx_emprestimos_status ON emprestimos(status);
CREATE INDEX IF NOT EXISTS idx_emprestimos_aluno ON emprestimos(aluno_id);
CREATE INDEX IF NOT EXISTS idx_emprestimos_material ON emprestimos(material_id);

-- Dados iniciais de alunos
INSERT INTO alunos (nome, registro, turma) VALUES
    ('Ana Clara Silva', '2026090101', '9º Ano A'),
    ('Bruno Oliveira Santos', '2026090102', '9º Ano A'),
    ('Carla Fernanda Costa', '2026090103', '9º Ano A'),
    ('Daniel Almeida Souza', '2026090104', '9º Ano A'),
    ('Eduarda Lima Pereira', '2026090105', '9º Ano A'),
    ('Felipe Rodrigues Martins', '2026090201', '9º Ano B'),
    ('Gabriela Santos Ribeiro', '2026090202', '9º Ano B'),
    ('Henrique Costa Barbosa', '2026090203', '9º Ano B'),
    ('Isabela Ferreira Gomes', '2026090204', '9º Ano B'),
    ('João Pedro Alves', '2026090205', '9º Ano B'),
    ('Larissa Mendes Cardoso', '2026080301', '8º Ano C'),
    ('Lucas Pereira Nunes', '2026080302', '8º Ano C'),
    ('Mariana Souza Dias', '2026080303', '8º Ano C'),
    ('Nicolas Rocha Teixeira', '2026080304', '8º Ano C'),
    ('Olivia Campos Moreira', '2026080305', '8º Ano C'),
    ('Pedro Henrique Castro', '2026070101', '7º Ano A'),
    ('Rafaela Borges Lima', '2026070102', '7º Ano A'),
    ('Samuel Vieira Machado', '2026070103', '7º Ano A'),
    ('Thais Andrade Pinto', '2026070104', '7º Ano A'),
    ('Vinicius Freitas Correia', '2026070105', '7º Ano A')
ON CONFLICT (registro) DO NOTHING;

-- Dados iniciais de materiais
INSERT INTO materiais (codigo, tipo, descricao, localizacao, estado, status) VALUES
    ('TAB-001', 'tablet', 'Samsung Galaxy Tab A7', 'Sala 12, Armário 1', 'otimo', 'disponivel'),
    ('TAB-002', 'tablet', 'Samsung Galaxy Tab A7', 'Sala 12, Armário 1', 'bom', 'disponivel'),
    ('TAB-003', 'tablet', 'Samsung Galaxy Tab A7', 'Sala 12, Armário 1', 'otimo', 'disponivel'),
    ('TAB-004', 'tablet', 'Samsung Galaxy Tab S6 Lite', 'Sala 12, Armário 1', 'otimo', 'disponivel'),
    ('TAB-005', 'tablet', 'Samsung Galaxy Tab S6 Lite', 'Sala 12, Armário 1', 'regular', 'manutencao'),
    ('NOT-001', 'notebook', 'Dell Inspiron 15', 'Sala 10, Armário 2', 'otimo', 'disponivel'),
    ('NOT-002', 'notebook', 'Dell Inspiron 15', 'Sala 10, Armário 2', 'bom', 'disponivel'),
    ('NOT-003', 'notebook', 'Lenovo IdeaPad 3', 'Sala 10, Armário 2', 'otimo', 'disponivel'),
    ('CALC-001', 'calculadora', 'Casio FX-82MS', 'Sala 8, Gaveta 3', 'otimo', 'disponivel'),
    ('CALC-002', 'calculadora', 'Casio FX-82MS', 'Sala 8, Gaveta 3', 'bom', 'disponivel'),
    ('CALC-003', 'calculadora', 'Casio FX-991ES Plus', 'Sala 8, Gaveta 3', 'otimo', 'disponivel'),
    ('KIT-001', 'kit_laboratorio', 'Kit Química Básica', 'Laboratório, Armário A', 'otimo', 'disponivel'),
    ('KIT-002', 'kit_laboratorio', 'Kit Física Mecânica', 'Laboratório, Armário B', 'bom', 'disponivel'),
    ('KIT-003', 'kit_laboratorio', 'Kit Biologia Microscopia', 'Laboratório, Armário C', 'otimo', 'disponivel'),
    ('ESP-001', 'esportivo', 'Bola de Vôlei Mikasa', 'Depósito Ed. Física', 'bom', 'disponivel'),
    ('ESP-002', 'esportivo', 'Bola de Basquete Spalding', 'Depósito Ed. Física', 'otimo', 'disponivel'),
    ('ESP-003', 'esportivo', 'Kit Badminton (4 raquetes)', 'Depósito Ed. Física', 'regular', 'manutencao')
ON CONFLICT (codigo) DO NOTHING;

-- Habilitar Row Level Security (opcional, mas recomendado)
-- ALTER TABLE alunos ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE materiais ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE emprestimos ENABLE ROW LEVEL SECURITY;
