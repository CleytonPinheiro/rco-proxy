import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
    console.error('[DB] Erro inesperado no pool:', err.message);
});

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

        /* ── Overrides de permissões por perfil (admin pode editar) ── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_perfis_overrides (
                perfil          VARCHAR(40)  PRIMARY KEY,
                modulos         JSONB        NOT NULL,
                atualizado_em   TIMESTAMP    NOT NULL DEFAULT now(),
                atualizado_por  INTEGER      REFERENCES edusync_usuarios(id)
            )
        `);

        /* Carrega overrides existentes para a memória */
        try {
            const { rows: ovr } = await client.query(
                `SELECT perfil, modulos FROM edusync_perfis_overrides`
            );
            const { setOverrides } = await import('./permissions.js');
            const map = {};
            for (const r of ovr) map[r.perfil] = r.modulos;
            setOverrides(map);
            if (ovr.length > 0) console.log(`[Permissões] ${ovr.length} override(s) de perfil carregado(s).`);
        } catch (e) {
            console.warn('[Permissões] Falha ao carregar overrides:', e.message);
        }
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES ('portal_modo_demo', 'false', 'Permite login nos portais com qualquer email Google (sem restrição de domínio)')
            ON CONFLICT (chave) DO NOTHING
        `);
        /* Seed defaults to whatever the env var says (or 'true' if not set).
           ON CONFLICT DO NOTHING means existing DB values are never overwritten. */
        const _pedRcoEnv = process.env.PEDAGOGICO_RCO_REQUERIDO === 'false' ? 'false' : 'true';
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES ('pedagogico_rco_requerido', $1, 'Quando ativado, pedagogos precisam de credenciais RCO para entrar. Quando desativado, pedagogos com @escola.pr.gov.br ou @seed.pr.gov.br podem entrar via Google OAuth sem RCO.')
            ON CONFLICT (chave) DO NOTHING
        `, [_pedRcoEnv]);

        /* ── Políticas de retenção do job de purga (editáveis pelo admin) ── */
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES
                ('purga_intervalo_horas',  '24',   'Intervalo entre execuções do job de purga (horas). Mínimo: 1.'),
                ('purga_audit_dias',       '365',  'Dias de retenção do edusync_audit_log. Registros mais antigos são apagados.'),
                ('purga_reputacao_dias',   '365',  'Dias de retenção do aluno_reputacao_log. Agregados em aluno_reputacao não são afetados.'),
                ('purga_notif_lida_dias',  '90',   'Dias de retenção de notificações lidas (notificacoes_aluno com lida=true).'),
                ('purga_notif_nlida_dias', '365',  'Dias de retenção de notificações não-lidas (notificacoes_aluno com lida=false).'),
                ('purga_lote',             '1000', 'Número máximo de linhas apagadas por operação DELETE em lote. Valores menores reduzem locks de tabela.')
            ON CONFLICT (chave) DO NOTHING
        `);
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES
                ('rco_sync_ttl_hours', '4', 'Tempo mínimo entre sincronizações automáticas do RCO (em horas). Valores menores aumentam a frequência de sync; valores maiores reduzem o consumo de recursos.')
            ON CONFLICT (chave) DO NOTHING
        `);
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES
                ('badge_poll_minutos', '3', 'Intervalo de atualização automática do badge de pares pendentes na tela de Provas (em minutos). Mínimo: 1, Máximo: 60. Padrão: 3.')
            ON CONFLICT (chave) DO NOTHING
        `);

        /* ── Alerta de sync parado ── */
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES
                ('sync_stale_alert_days',           '7',  'Dias sem sincronização RCO para disparar alerta de sync parado. Usuários sem sync há mais desse número de dias aparecem no painel admin e geram entradas no log de auditoria.'),
                ('sync_stale_alert_interval_horas', '24', 'Intervalo entre verificações automáticas de sync parado (horas).')
            ON CONFLICT (chave) DO NOTHING
        `);

        /* ── Alerta de erros repetidos da GradePen ── */
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES
                ('gp_error_alerta_n',       '5',  'Quantidade de erros do mesmo código GradePen dentro da janela para disparar um alerta ao admin (GP_ERROR_ALERT). Mínimo: 1.'),
                ('gp_error_alerta_minutos', '60', 'Largura da janela deslizante (em minutos) para contagem de erros GradePen. Mínimo: 1.')
            ON CONFLICT (chave) DO NOTHING
        `);
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES
                ('modulos_em_desenvolvimento', '["pedagogico","comunicados","retorno-pedagogico"]', 'Módulos exibidos como "🚧 em desenvolvimento" no menu (gerenciável pelo admin)')
            ON CONFLICT (chave) DO NOTHING
        `);
        /* Carrega lista atual para a memória */
        try {
            const { rows: cfgDev } = await client.query(
                `SELECT valor FROM edusync_config WHERE chave = 'modulos_em_desenvolvimento'`
            );
            if (cfgDev.length > 0) {
                const lista = JSON.parse(cfgDev[0].valor || '[]');
                const { setModulosEmDesenvolvimento } = await import('./permissions.js');
                setModulosEmDesenvolvimento(lista);
            }
        } catch (e) {
            console.warn('[Permissões] Falha ao carregar módulos em desenvolvimento:', e.message);
        }
        await client.query(`
            INSERT INTO edusync_config (chave, valor, obs) VALUES
                ('escola_nome_oficial', '', 'Nome oficial da escola para o cabeçalho do PDF'),
                ('escola_endereco',     '', 'Endereço da escola para o cabeçalho do PDF'),
                ('escola_logo_base64',  '', 'Logo da escola em Base64 para o cabeçalho do PDF')
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

        await client.query(`
            CREATE TABLE IF NOT EXISTS classroom_solicitacao_acesso (
                id              SERIAL PRIMARY KEY,
                pedagogo_email  VARCHAR(255) NOT NULL,
                pedagogo_nome   VARCHAR(255) NOT NULL DEFAULT '',
                professor_cpf   VARCHAR(11)  NOT NULL,
                status          VARCHAR(20)  NOT NULL DEFAULT 'pendente',
                mensagem        TEXT         NOT NULL DEFAULT '',
                respondido_em   TIMESTAMP,
                criado_em       TIMESTAMP    NOT NULL DEFAULT NOW(),
                UNIQUE(pedagogo_email, professor_cpf, status)
            );
            CREATE INDEX IF NOT EXISTS idx_csa_prof   ON classroom_solicitacao_acesso(professor_cpf);
            CREATE INDEX IF NOT EXISTS idx_csa_pedag  ON classroom_solicitacao_acesso(pedagogo_email);
        `);

        /* ── Comunicados de Suspensão ──────────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_comunicados_suspensao (
                id              SERIAL PRIMARY KEY,
                aluno_id        BIGINT,
                nome_aluno      TEXT    NOT NULL,
                turma           TEXT,
                registro        TEXT,
                responsavel     TEXT    NOT NULL,
                data_inicio     DATE    NOT NULL,
                data_fim        DATE    NOT NULL,
                motivo          TEXT,
                gerado_por_id   BIGINT,
                gerado_por_nome TEXT,
                emitido_em      TIMESTAMPTZ DEFAULT now()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cs_aluno_id ON edusync_comunicados_suspensao(aluno_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cs_emitido  ON edusync_comunicados_suspensao(emitido_em DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cs_nome     ON edusync_comunicados_suspensao(nome_aluno)`);

        /* ── Cache de sincronização RCO → Supabase ── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_sync_cache (
                usuario_id  INTEGER PRIMARY KEY REFERENCES edusync_usuarios(id) ON DELETE CASCADE,
                ultimo_sync TIMESTAMP NOT NULL,
                puladas     INTEGER   NOT NULL DEFAULT 0,
                executadas  INTEGER   NOT NULL DEFAULT 0
            )
        `);

        /* ── Contadores de falhas de login por CPF (rate-limit persistente) ── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_rate_limit_cpf (
                cpf      VARCHAR(11) PRIMARY KEY,
                count    INTEGER     NOT NULL DEFAULT 1,
                reset_at TIMESTAMPTZ NOT NULL
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_rate_limit_cpf_reset ON edusync_rate_limit_cpf(reset_at)
        `);

        /* ── Histórico de purgas de dados ── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS edusync_purga_log (
                id               SERIAL PRIMARY KEY,
                iniciado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                dur_ms           INTEGER     NOT NULL DEFAULT 0,
                audit_log        INTEGER     NOT NULL DEFAULT 0,
                reputacao_log    INTEGER     NOT NULL DEFAULT 0,
                notif_lidas      INTEGER     NOT NULL DEFAULT 0,
                notif_nlidas     INTEGER     NOT NULL DEFAULT 0,
                notif_prof_lidas  INTEGER    NOT NULL DEFAULT 0,
                notif_prof_nlidas INTEGER    NOT NULL DEFAULT 0,
                politica_audit   INTEGER     NOT NULL,
                politica_reputacao INTEGER   NOT NULL,
                politica_notif_lida INTEGER  NOT NULL,
                politica_notif_nlida INTEGER NOT NULL,
                politica_notif_prof_lida  INTEGER NOT NULL DEFAULT 90,
                politica_notif_prof_nlida INTEGER NOT NULL DEFAULT 365
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_purga_log_iniciado ON edusync_purga_log(iniciado_em DESC)
        `);
        await client.query(`ALTER TABLE edusync_purga_log ADD COLUMN IF NOT EXISTS notif_prof_lidas         INTEGER NOT NULL DEFAULT 0`);
        await client.query(`ALTER TABLE edusync_purga_log ADD COLUMN IF NOT EXISTS notif_prof_nlidas        INTEGER NOT NULL DEFAULT 0`);
        await client.query(`ALTER TABLE edusync_purga_log ADD COLUMN IF NOT EXISTS politica_notif_prof_lida  INTEGER NOT NULL DEFAULT 90`);
        await client.query(`ALTER TABLE edusync_purga_log ADD COLUMN IF NOT EXISTS politica_notif_prof_nlida INTEGER NOT NULL DEFAULT 365`);

        /* ── Monitor de Projetos ── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS grupo_projetos (
                id            SERIAL       PRIMARY KEY,
                grupo_id      TEXT         NOT NULL,
                cod_turma     INT,
                nome          VARCHAR(120) NOT NULL,
                tipo          VARCHAR(20)  NOT NULL DEFAULT 'outro',
                url           TEXT         NOT NULL,
                github_owner  VARCHAR(100),
                github_repo   VARCHAR(100),
                ultimo_check  TIMESTAMPTZ,
                ultimo_sha    TEXT,
                ativo         BOOLEAN      NOT NULL DEFAULT true,
                criado_em     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_grupo_projetos_grupo ON grupo_projetos(grupo_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_grupo_projetos_github ON grupo_projetos(tipo) WHERE tipo = 'github'`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS grupo_projeto_eventos (
                id           SERIAL       PRIMARY KEY,
                projeto_id   INT          NOT NULL REFERENCES grupo_projetos(id) ON DELETE CASCADE,
                tipo         VARCHAR(30)  NOT NULL DEFAULT 'commit',
                titulo       VARCHAR(255) NOT NULL,
                autor        VARCHAR(100),
                url_evento   TEXT,
                sha          VARCHAR(40),
                detectado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_grupo_proj_eventos ON grupo_projeto_eventos(projeto_id, detectado_em DESC)`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS aluno_projeto_sugestoes (
                id                SERIAL       PRIMARY KEY,
                aluno_email       TEXT         NOT NULL,
                aluno_nome        TEXT,
                nome              VARCHAR(120) NOT NULL,
                tipo              VARCHAR(20)  NOT NULL DEFAULT 'outro',
                url               TEXT         NOT NULL,
                status            VARCHAR(20)  NOT NULL DEFAULT 'pendente',
                grupo_id_destino  TEXT,
                criado_em         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_aluno_proj_sugest_email ON aluno_projeto_sugestoes(aluno_email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_aluno_proj_sugest_status ON aluno_projeto_sugestoes(status)`);

        /* ── Passeios e Eventos Externos ── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS eventos (
                id               SERIAL       PRIMARY KEY,
                nome             VARCHAR(200) NOT NULL,
                destino          VARCHAR(200) NOT NULL,
                data_evento      DATE         NOT NULL,
                valor_aluno      NUMERIC(10,2) NOT NULL DEFAULT 0,
                prazo_pagamento  DATE,
                descricao        TEXT,
                turmas           JSONB        NOT NULL DEFAULT '[]',
                pix_chave        VARCHAR(200),
                pix_nome         VARCHAR(100),
                pix_cidade       VARCHAR(50)  DEFAULT 'CURITIBA',
                status           VARCHAR(20)  NOT NULL DEFAULT 'ativo',
                criado_por       INTEGER      REFERENCES edusync_usuarios(id),
                criado_em        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_eventos_status ON eventos(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_eventos_data   ON eventos(data_evento DESC)`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS evento_onibus (
                id               SERIAL       PRIMARY KEY,
                evento_id        INTEGER      NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
                numero           INTEGER      NOT NULL,
                nome             VARCHAR(100),
                capacidade       INTEGER      NOT NULL DEFAULT 40,
                monitor_nome     VARCHAR(100),
                monitor_telefone VARCHAR(20),
                cor              VARCHAR(20)  NOT NULL DEFAULT '#3b82f6'
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_evento_onibus_evento ON evento_onibus(evento_id)`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS evento_inscricoes (
                id                  SERIAL       PRIMARY KEY,
                evento_id           INTEGER      NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
                codmatrizaluno      INTEGER      NOT NULL,
                nome_aluno          VARCHAR(200) NOT NULL,
                turma               VARCHAR(100),
                codturma            INTEGER,
                onibus_id           INTEGER      REFERENCES evento_onibus(id) ON DELETE SET NULL,
                status_pagamento    VARCHAR(20)  NOT NULL DEFAULT 'pendente',
                txid                VARCHAR(60)  UNIQUE,
                aluno_token         VARCHAR(80)  NOT NULL UNIQUE,
                comprovante_obs     TEXT,
                pago_em             TIMESTAMPTZ,
                pago_por            VARCHAR(100),
                restricoes_medicas  TEXT,
                contato_responsavel VARCHAR(30),
                nome_responsavel    VARCHAR(100),
                embarcou            BOOLEAN      NOT NULL DEFAULT false,
                embarcou_em         TIMESTAMPTZ,
                desembarcou         BOOLEAN      NOT NULL DEFAULT false,
                desembarcou_em      TIMESTAMPTZ,
                criado_em           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                UNIQUE(evento_id, codmatrizaluno)
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inscricoes_evento  ON evento_inscricoes(evento_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inscricoes_token   ON evento_inscricoes(aluno_token)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inscricoes_onibus  ON evento_inscricoes(onibus_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_inscricoes_payment ON evento_inscricoes(status_pagamento)`);
        /* status_atual adicionado após criação inicial */
        await client.query(`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS status_atual TEXT DEFAULT 'planejando'`);
        /* foto_url e comprovante_arquivo_url adicionadas após criação inicial */
        await client.query(`ALTER TABLE evento_inscricoes ADD COLUMN IF NOT EXISTS foto_url TEXT`);
        await client.query(`ALTER TABLE evento_inscricoes ADD COLUMN IF NOT EXISTS comprovante_arquivo_url TEXT`);

        console.log('[DB] Tabelas edusync inicializadas');
    } finally {
        client.release();
    }
}
