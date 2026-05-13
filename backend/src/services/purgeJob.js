/**
 * Job de Purga de Dados Antigos
 *
 * Apaga registros antigos das tabelas append-only do PostgreSQL local para
 * impedir crescimento indefinido. As políticas de retenção são configuráveis
 * via variáveis de ambiente.
 *
 * Variáveis de ambiente (todas com defaults razoáveis):
 *   PURGA_INTERVALO_HORAS   — intervalo entre execuções (default: 24)
 *   PURGA_AUDIT_DIAS        — dias de retenção de edusync_audit_log (default: 365)
 *   PURGA_REPUTACAO_DIAS    — dias de retenção de aluno_reputacao_log (default: 365)
 *   PURGA_NOTIF_LIDA_DIAS        — dias de retenção de notificacoes_aluno lidas (default: 90)
 *   PURGA_NOTIF_NLIDA_DIAS       — dias de retenção de notificacoes_aluno não-lidas (default: 365)
 *   PURGA_NOTIF_PROF_LIDA_DIAS   — dias de retenção de notificacoes_professor lidas (default: 90)
 *   PURGA_NOTIF_PROF_NLIDA_DIAS  — dias de retenção de notificacoes_professor não-lidas (default: 365)
 *   PURGA_LOTE              — linhas por DELETE em lote (default: 1000)
 */

const DEFAULTS = {
    intervalHoras:       24,
    auditDias:          365,
    reputacaoDias:      365,
    notifLidaDias:       90,
    notifNlidaDias:     365,
    notifProfLidaDias:   90,
    notifProfNlidaDias: 365,
    lote:              1000,
};

function cfg(envKey, defaultVal) {
    const v = parseInt(process.env[envKey], 10);
    return Number.isFinite(v) && v > 0 ? v : defaultVal;
}

export function getConfig() {
    return {
        intervalHoras:      cfg('PURGA_INTERVALO_HORAS',       DEFAULTS.intervalHoras),
        auditDias:          cfg('PURGA_AUDIT_DIAS',             DEFAULTS.auditDias),
        reputacaoDias:      cfg('PURGA_REPUTACAO_DIAS',         DEFAULTS.reputacaoDias),
        notifLidaDias:      cfg('PURGA_NOTIF_LIDA_DIAS',        DEFAULTS.notifLidaDias),
        notifNlidaDias:     cfg('PURGA_NOTIF_NLIDA_DIAS',       DEFAULTS.notifNlidaDias),
        notifProfLidaDias:  cfg('PURGA_NOTIF_PROF_LIDA_DIAS',  DEFAULTS.notifProfLidaDias),
        notifProfNlidaDias: cfg('PURGA_NOTIF_PROF_NLIDA_DIAS', DEFAULTS.notifProfNlidaDias),
        lote:               cfg('PURGA_LOTE',                   DEFAULTS.lote),
    };
}

/**
 * DB config key → internal field mapping.
 * Priority: edusync_config (DB) > env var > hardcoded default.
 */
const DB_KEY_MAP = [
    { dbKey: 'purga_intervalo_horas',       field: 'intervalHoras',      envKey: 'PURGA_INTERVALO_HORAS',       def: DEFAULTS.intervalHoras      },
    { dbKey: 'purga_audit_dias',            field: 'auditDias',          envKey: 'PURGA_AUDIT_DIAS',            def: DEFAULTS.auditDias          },
    { dbKey: 'purga_reputacao_dias',        field: 'reputacaoDias',      envKey: 'PURGA_REPUTACAO_DIAS',        def: DEFAULTS.reputacaoDias      },
    { dbKey: 'purga_notif_lida_dias',       field: 'notifLidaDias',      envKey: 'PURGA_NOTIF_LIDA_DIAS',       def: DEFAULTS.notifLidaDias      },
    { dbKey: 'purga_notif_nlida_dias',      field: 'notifNlidaDias',     envKey: 'PURGA_NOTIF_NLIDA_DIAS',      def: DEFAULTS.notifNlidaDias     },
    { dbKey: 'purga_notif_prof_lida_dias',  field: 'notifProfLidaDias',  envKey: 'PURGA_NOTIF_PROF_LIDA_DIAS',  def: DEFAULTS.notifProfLidaDias  },
    { dbKey: 'purga_notif_prof_nlida_dias', field: 'notifProfNlidaDias', envKey: 'PURGA_NOTIF_PROF_NLIDA_DIAS', def: DEFAULTS.notifProfNlidaDias },
    { dbKey: 'purga_lote',                  field: 'lote',               envKey: 'PURGA_LOTE',                  def: DEFAULTS.lote               },
];

/**
 * Async version of getConfig() that reads overrides from edusync_config.
 * Falls back to env vars and hardcoded defaults if a key is absent or invalid.
 */
export async function getConfigFromDb(pool) {
    const base = getConfig();
    try {
        const keys = DB_KEY_MAP.map(m => m.dbKey);
        const { rows } = await pool.query(
            `SELECT chave, valor FROM edusync_config WHERE chave = ANY($1)`,
            [keys]
        );
        const dbMap = Object.fromEntries(rows.map(r => [r.chave, r.valor]));
        const result = { ...base };
        for (const { dbKey, field, def } of DB_KEY_MAP) {
            if (dbKey in dbMap) {
                const v = parseInt(dbMap[dbKey], 10);
                if (Number.isFinite(v) && v > 0) result[field] = v;
            }
        }
        return result;
    } catch (e) {
        console.warn('[PURGA] Aviso: não foi possível ler config do DB, usando env/defaults:', e.message);
        return base;
    }
}

/**
 * Mutex global — garante que apenas uma execução de purga ocorra por vez,
 * seja ela agendada automaticamente ou disparada manualmente pelo admin.
 */
let _emExecucao = false;

export function isPurgaEmExecucao() {
    return _emExecucao;
}

/**
 * Tenta executar a purga imediatamente.
 * Retorna { ok: false, motivo } se outra purga já estiver em andamento.
 * Retorna { ok: true, resultado } após concluir.
 */
export async function tryExecutarPurga(pool) {
    if (_emExecucao) {
        return { ok: false, motivo: 'Uma purga já está em execução. Aguarde a conclusão antes de iniciar outra.' };
    }
    _emExecucao = true;
    try {
        const resultado = await executarPurga(pool);
        return { ok: true, resultado };
    } finally {
        _emExecucao = false;
    }
}

/**
 * Executa DELETEs em lotes até não restar mais linhas elegíveis.
 * Retorna o total de linhas apagadas.
 */
async function deletarEmLotes(pool, sql, params, lote) {
    let total = 0;
    while (true) {
        const { rowCount } = await pool.query(sql, [...params, lote]);
        total += rowCount;
        if (rowCount < lote) break;
    }
    return total;
}

/**
 * Executa uma rodada completa de purga em todas as tabelas.
 */
export async function executarPurga(pool) {
    const conf  = await getConfigFromDb(pool);
    const inicio = Date.now();
    console.log('[PURGA] Iniciando purga de dados antigos...');
    console.log(
        `[PURGA] Políticas: audit=${conf.auditDias}d | reputacao_log=${conf.reputacaoDias}d | notif_lida=${conf.notifLidaDias}d | notif_nlida=${conf.notifNlidaDias}d | lote=${conf.lote}`
    );

    console.log(
        `[PURGA] Políticas prof: notif_prof_lida=${conf.notifProfLidaDias}d | notif_prof_nlida=${conf.notifProfNlidaDias}d`
    );

    const resultados = {};

    try {
        /* ── 1. edusync_audit_log ── */
        resultados.audit_log = await deletarEmLotes(
            pool,
            `DELETE FROM edusync_audit_log
              WHERE id IN (
                  SELECT id FROM edusync_audit_log
                   WHERE criado_em < NOW() - ($1 || ' days')::INTERVAL
                   LIMIT $2
              )`,
            [conf.auditDias],
            conf.lote
        );
    } catch (e) {
        console.error('[PURGA] Erro ao purgar edusync_audit_log:', e.message);
        resultados.audit_log = -1;
    }

    try {
        /* ── 2. aluno_reputacao_log ──
           Os totais agregados (xp_total, acoes_total, streaks, badges) ficam
           na tabela aluno_reputacao e NÃO são afetados por esta purga.
           O log é usado apenas para display dos últimos eventos (top-10) e
           para idempotência de submissões recentes — ambos dispensáveis após 365 dias. */
        resultados.reputacao_log = await deletarEmLotes(
            pool,
            `DELETE FROM aluno_reputacao_log
              WHERE id IN (
                  SELECT id FROM aluno_reputacao_log
                   WHERE criado_em < NOW() - ($1 || ' days')::INTERVAL
                   LIMIT $2
              )`,
            [conf.reputacaoDias],
            conf.lote
        );
    } catch (e) {
        console.error('[PURGA] Erro ao purgar aluno_reputacao_log:', e.message);
        resultados.reputacao_log = -1;
    }

    try {
        /* ── 3a. notificacoes_aluno — LIDAS ── */
        resultados.notif_lidas = await deletarEmLotes(
            pool,
            `DELETE FROM notificacoes_aluno
              WHERE id IN (
                  SELECT id FROM notificacoes_aluno
                   WHERE lida = true
                     AND criado_em < NOW() - ($1 || ' days')::INTERVAL
                   LIMIT $2
              )`,
            [conf.notifLidaDias],
            conf.lote
        );
    } catch (e) {
        console.error('[PURGA] Erro ao purgar notificacoes_aluno (lidas):', e.message);
        resultados.notif_lidas = -1;
    }

    try {
        /* ── 3b. notificacoes_aluno — NÃO LIDAS (expiradas) ── */
        resultados.notif_nlidas = await deletarEmLotes(
            pool,
            `DELETE FROM notificacoes_aluno
              WHERE id IN (
                  SELECT id FROM notificacoes_aluno
                   WHERE lida = false
                     AND criado_em < NOW() - ($1 || ' days')::INTERVAL
                   LIMIT $2
              )`,
            [conf.notifNlidaDias],
            conf.lote
        );
    } catch (e) {
        console.error('[PURGA] Erro ao purgar notificacoes_aluno (não-lidas):', e.message);
        resultados.notif_nlidas = -1;
    }

    try {
        /* ── 4a. notificacoes_professor — LIDAS ── */
        resultados.notif_prof_lidas = await deletarEmLotes(
            pool,
            `DELETE FROM notificacoes_professor
              WHERE id IN (
                  SELECT id FROM notificacoes_professor
                   WHERE lida = true
                     AND criado_em < NOW() - ($1 || ' days')::INTERVAL
                   LIMIT $2
              )`,
            [conf.notifProfLidaDias],
            conf.lote
        );
    } catch (e) {
        console.error('[PURGA] Erro ao purgar notificacoes_professor (lidas):', e.message);
        resultados.notif_prof_lidas = -1;
    }

    try {
        /* ── 4b. notificacoes_professor — NÃO LIDAS (expiradas) ── */
        resultados.notif_prof_nlidas = await deletarEmLotes(
            pool,
            `DELETE FROM notificacoes_professor
              WHERE id IN (
                  SELECT id FROM notificacoes_professor
                   WHERE lida = false
                     AND criado_em < NOW() - ($1 || ' days')::INTERVAL
                   LIMIT $2
              )`,
            [conf.notifProfNlidaDias],
            conf.lote
        );
    } catch (e) {
        console.error('[PURGA] Erro ao purgar notificacoes_professor (não-lidas):', e.message);
        resultados.notif_prof_nlidas = -1;
    }

    const durMs = Date.now() - inicio;
    console.log(
        `[PURGA] Concluída em ${durMs}ms — ` +
        `audit_log: ${resultados.audit_log} | ` +
        `reputacao_log: ${resultados.reputacao_log} | ` +
        `notif_lidas: ${resultados.notif_lidas} | ` +
        `notif_nlidas: ${resultados.notif_nlidas} | ` +
        `notif_prof_lidas: ${resultados.notif_prof_lidas} | ` +
        `notif_prof_nlidas: ${resultados.notif_prof_nlidas}`
    );

    try {
        await pool.query(
            `INSERT INTO edusync_purga_log
                (dur_ms, audit_log, reputacao_log, notif_lidas, notif_nlidas,
                 notif_prof_lidas, notif_prof_nlidas,
                 politica_audit, politica_reputacao, politica_notif_lida, politica_notif_nlida,
                 politica_notif_prof_lida, politica_notif_prof_nlida)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                durMs,
                resultados.audit_log          < 0 ? -1 : resultados.audit_log,
                resultados.reputacao_log      < 0 ? -1 : resultados.reputacao_log,
                resultados.notif_lidas        < 0 ? -1 : resultados.notif_lidas,
                resultados.notif_nlidas       < 0 ? -1 : resultados.notif_nlidas,
                resultados.notif_prof_lidas   < 0 ? -1 : resultados.notif_prof_lidas,
                resultados.notif_prof_nlidas  < 0 ? -1 : resultados.notif_prof_nlidas,
                conf.auditDias,
                conf.reputacaoDias,
                conf.notifLidaDias,
                conf.notifNlidaDias,
                conf.notifProfLidaDias,
                conf.notifProfNlidaDias,
            ]
        );
    } catch (e) {
        console.warn('[PURGA] Aviso: não foi possível salvar histórico de purga:', e.message);
    }

    return { ...resultados, durMs };
}

/**
 * Garante que os índices necessários para as purgas existam.
 * Executado uma única vez na inicialização.
 */
export async function garantirIndicesPurga(pool) {
    try {
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_repu_log_criado_em
                ON aluno_reputacao_log(criado_em)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_notif_aluno_criado_em
                ON notificacoes_aluno(criado_em)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_notif_aluno_lida_criado
                ON notificacoes_aluno(lida, criado_em)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_notif_prof_criado_em
                ON notificacoes_professor(criado_em)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_notif_prof_lida_criado
                ON notificacoes_professor(lida, criado_em)
        `);
        console.log('[PURGA] Índices de purga OK');
    } catch (e) {
        console.warn('[PURGA] Aviso ao criar índices de purga:', e.message);
    }
}

/**
 * Inicializa e agenda o job de purga.
 * Deve ser chamado uma vez durante a inicialização do backend.
 *
 * Garante que apenas uma execução ocorra por vez: usa um flag mutex e
 * setTimeout recursivo (em vez de setInterval) para que o próximo
 * agendamento só seja marcado após a execução atual terminar — mesmo que
 * ela dure mais do que o intervalo configurado.
 *
 * @param {import('pg').Pool} pool - Pool de conexão com o banco local.
 */
export function agendarPurga(pool) {
    async function rodarPurga(contexto) {
        if (_emExecucao) {
            console.log(`[PURGA] Execução anterior ainda em andamento — ciclo ${contexto} ignorado.`);
            await agendarProxima();
            return;
        }
        _emExecucao = true;
        try {
            await executarPurga(pool);
        } catch (e) {
            console.error(`[PURGA] Erro na purga (${contexto}):`, e.message);
        } finally {
            _emExecucao = false;
            await agendarProxima();
        }
    }

    async function agendarProxima() {
        const conf = await getConfigFromDb(pool);
        const intervaloMs = conf.intervalHoras * 60 * 60 * 1000;
        console.log(`[PURGA] Próxima execução em ${conf.intervalHoras}h`);
        setTimeout(() => rodarPurga('periódica'), intervaloMs);
    }

    garantirIndicesPurga(pool).then(() => {
        /* Primeira execução: aguarda 60 s para o servidor estar plenamente pronto */
        setTimeout(() => rodarPurga('inicial'), 60_000);
    });

    const initialConf = getConfig();
    console.log(`[PURGA] Job agendado — intervalo inicial: ${initialConf.intervalHoras}h, primeira execução em 60s`);
}
