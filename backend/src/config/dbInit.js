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

        console.log('[DB] Tabelas edusync inicializadas');
    } finally {
        client.release();
    }
}
