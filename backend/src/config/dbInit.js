import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_usuarios (
                id         SERIAL PRIMARY KEY,
                nome       VARCHAR(100) NOT NULL,
                cpf        VARCHAR(11)  NOT NULL UNIQUE,
                perfil     VARCHAR(20)  NOT NULL DEFAULT 'professor',
                ativo      BOOLEAN      NOT NULL DEFAULT true,
                criado_em  TIMESTAMP    NOT NULL DEFAULT NOW(),
                criado_por INTEGER      REFERENCES edusync_usuarios(id)
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_audit_log (
                id            SERIAL PRIMARY KEY,
                usuario_id    INTEGER      REFERENCES edusync_usuarios(id),
                usuario_nome  VARCHAR(100),
                acao          VARCHAR(100) NOT NULL,
                modulo        VARCHAR(50),
                detalhes      JSONB,
                ip            VARCHAR(45),
                criado_em     TIMESTAMP    NOT NULL DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON edusync_audit_log(usuario_id);
            CREATE INDEX IF NOT EXISTS idx_audit_log_criado  ON edusync_audit_log(criado_em DESC);
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_escolas (
                id                     SERIAL PRIMARY KEY,
                nome                   VARCHAR(200) NOT NULL,
                codigo_estabelecimento INTEGER NOT NULL UNIQUE,
                permite_auto_cadastro  BOOLEAN NOT NULL DEFAULT true,
                ativo                  BOOLEAN NOT NULL DEFAULT true,
                criado_em              TIMESTAMP NOT NULL DEFAULT NOW()
            );
        `);

        /* Migração incremental: colunas de assinatura — escolas */
        await client.query(`ALTER TABLE edusync_escolas ADD COLUMN IF NOT EXISTS plano            VARCHAR(20)  DEFAULT NULL`);
        await client.query(`ALTER TABLE edusync_escolas ADD COLUMN IF NOT EXISTS plano_inicio     TIMESTAMP   DEFAULT NULL`);
        await client.query(`ALTER TABLE edusync_escolas ADD COLUMN IF NOT EXISTS plano_renovacao  TIMESTAMP   DEFAULT NULL`);
        await client.query(`ALTER TABLE edusync_escolas ADD COLUMN IF NOT EXISTS plano_obs        TEXT        DEFAULT NULL`);

        /* Migração incremental: colunas de assinatura — usuários individuais */
        await client.query(`ALTER TABLE edusync_usuarios ADD COLUMN IF NOT EXISTS plano            VARCHAR(30)  DEFAULT NULL`);
        await client.query(`ALTER TABLE edusync_usuarios ADD COLUMN IF NOT EXISTS plano_inicio     TIMESTAMP   DEFAULT NULL`);
        await client.query(`ALTER TABLE edusync_usuarios ADD COLUMN IF NOT EXISTS plano_renovacao  TIMESTAMP   DEFAULT NULL`);
        await client.query(`ALTER TABLE edusync_usuarios ADD COLUMN IF NOT EXISTS plano_obs        TEXT        DEFAULT NULL`);

        /* ── Livros Didáticos ── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS livros_didaticos (
                id              SERIAL PRIMARY KEY,
                titulo          VARCHAR(200) NOT NULL,
                autor           VARCHAR(200),
                editora         VARCHAR(150),
                ano_publicacao  INTEGER,
                disciplina      VARCHAR(100),
                serie           VARCHAR(80),
                isbn            VARCHAR(20),
                quantidade      INTEGER NOT NULL DEFAULT 1,
                ativo           BOOLEAN NOT NULL DEFAULT true,
                criado_em       TIMESTAMP NOT NULL DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS livros_emprestimos (
                id                 SERIAL PRIMARY KEY,
                livro_id           INTEGER NOT NULL REFERENCES livros_didaticos(id),
                cod_matriz_aluno   INTEGER NOT NULL,
                nome_aluno         VARCHAR(200),
                turma              VARCHAR(150),
                num_chamada        INTEGER,
                ano_letivo         INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
                status             VARCHAR(20) NOT NULL DEFAULT 'emprestado',
                data_emprestimo    TIMESTAMP NOT NULL DEFAULT NOW(),
                data_devolucao     TIMESTAMP,
                obs                TEXT,
                criado_em          TIMESTAMP NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_emp_livro    ON livros_emprestimos(livro_id);
            CREATE INDEX IF NOT EXISTS idx_emp_aluno    ON livros_emprestimos(cod_matriz_aluno);
            CREATE INDEX IF NOT EXISTS idx_emp_status   ON livros_emprestimos(status);
        `);

        /* Migração: marcação "lançado no livro" nos grupos do Classroom */
        await client.query(`ALTER TABLE classroom_grupos ADD COLUMN IF NOT EXISTS lancado_livro BOOLEAN NOT NULL DEFAULT false`);
        await client.query(`ALTER TABLE classroom_grupos ADD COLUMN IF NOT EXISTS lancado_em    TIMESTAMP DEFAULT NULL`);

        /* Migração: tipo de grupo e vínculo com grupo de origem (recuperação) */
        await client.query(`ALTER TABLE classroom_grupos ADD COLUMN IF NOT EXISTS tipo            VARCHAR(20) NOT NULL DEFAULT 'normal'`);
        await client.query(`ALTER TABLE classroom_grupos ADD COLUMN IF NOT EXISTS grupo_origem_id INTEGER     REFERENCES classroom_grupos(id) ON DELETE SET NULL`);
        await client.query(`ALTER TABLE classroom_grupos ADD COLUMN IF NOT EXISTS data_inicio     DATE        DEFAULT NULL`);

        console.log('[DB] Tabelas edusync inicializadas');
    } finally {
        client.release();
    }
}
