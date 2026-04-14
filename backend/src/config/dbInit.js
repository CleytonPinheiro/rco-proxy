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
        /* Migração: promover data_inicio de DATE para TIMESTAMP WITH TIME ZONE (preserva horário de corte) */
        await client.query(`
            ALTER TABLE classroom_grupos
            ALTER COLUMN data_inicio TYPE TIMESTAMP WITH TIME ZONE
            USING data_inicio::TIMESTAMP WITH TIME ZONE
        `);

        /* ── Conquistas do portal do aluno ─────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS conquistas_aluno (
                id             SERIAL PRIMARY KEY,
                aluno_email    VARCHAR(255) NOT NULL,
                aluno_nome     VARCHAR(255) NOT NULL,
                grupo_id       INTEGER      NOT NULL,
                grupo_nome     VARCHAR(255) NOT NULL,
                curso_id       VARCHAR(100) NOT NULL,
                curso_nome     VARCHAR(255) NOT NULL,
                nota_teto      NUMERIC      NOT NULL,
                conquistado_em TIMESTAMP    NOT NULL DEFAULT NOW(),
                notificado     BOOLEAN      NOT NULL DEFAULT FALSE,
                UNIQUE (aluno_email, grupo_id)
            );
            CREATE INDEX IF NOT EXISTS idx_conquistas_email ON conquistas_aluno(aluno_email);
            CREATE INDEX IF NOT EXISTS idx_conquistas_grupo ON conquistas_aluno(grupo_id);
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_config (
                chave  VARCHAR(50)  PRIMARY KEY,
                valor  TEXT         NOT NULL DEFAULT '',
                obs    TEXT
            )
        `);
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES ('portal_modo_demo', 'false', 'Permite login nos portais com qualquer email Google (sem restrição de domínio)')
            ON CONFLICT (chave) DO NOTHING
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_plano_historico (
                id             SERIAL PRIMARY KEY,
                usuario_id     INTEGER      NOT NULL REFERENCES edusync_usuarios(id),
                acao           VARCHAR(50)  NOT NULL,
                plano_anterior VARCHAR(30),
                plano_novo     VARCHAR(30),
                inicio_anterior TIMESTAMP,
                inicio_novo    TIMESTAMP,
                admin_id       INTEGER      REFERENCES edusync_usuarios(id),
                admin_nome     VARCHAR(100),
                obs            TEXT,
                criado_em      TIMESTAMP    NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_plano_hist_usuario ON edusync_plano_historico(usuario_id);
            CREATE INDEX IF NOT EXISTS idx_plano_hist_criado  ON edusync_plano_historico(criado_em DESC);
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_suporte (
                id             SERIAL PRIMARY KEY,
                usuario_id     INTEGER      NOT NULL REFERENCES edusync_usuarios(id),
                usuario_nome   VARCHAR(100) NOT NULL,
                tipo           VARCHAR(30)  NOT NULL,
                assunto        VARCHAR(200) NOT NULL,
                mensagem       TEXT         NOT NULL,
                status         VARCHAR(20)  NOT NULL DEFAULT 'pendente',
                resposta       TEXT,
                respondido_por INTEGER      REFERENCES edusync_usuarios(id),
                respondido_em  TIMESTAMP,
                criado_em      TIMESTAMP    NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_suporte_usuario ON edusync_suporte(usuario_id);
            CREATE INDEX IF NOT EXISTS idx_suporte_status  ON edusync_suporte(status);
            CREATE INDEX IF NOT EXISTS idx_suporte_criado  ON edusync_suporte(criado_em DESC);
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS classroom_tokens (
                id          SERIAL PRIMARY KEY,
                cpf         VARCHAR(11)  NOT NULL UNIQUE,
                email       VARCHAR(255),
                tokens      JSONB        NOT NULL,
                atualizado  TIMESTAMP    NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ct_cpf ON classroom_tokens(cpf);
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS classroom_acesso_pedagogo (
                id              SERIAL PRIMARY KEY,
                professor_cpf   VARCHAR(11)  NOT NULL,
                pedagogo_email  VARCHAR(255) NOT NULL,
                criado_em       TIMESTAMP    NOT NULL DEFAULT NOW(),
                UNIQUE(professor_cpf, pedagogo_email)
            );
            CREATE INDEX IF NOT EXISTS idx_cap_prof   ON classroom_acesso_pedagogo(professor_cpf);
            CREATE INDEX IF NOT EXISTS idx_cap_pedag  ON classroom_acesso_pedagogo(pedagogo_email);
        `);

        console.log('[DB] Tabelas edusync inicializadas');
    } finally {
        client.release();
    }
}
