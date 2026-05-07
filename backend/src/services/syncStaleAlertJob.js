/**
 * Job de Alerta de Sync Parado (Stale Sync Alert)
 *
 * Verifica periodicamente se algum usuário ativo possui sincronização RCO
 * ausente ou com mais de N dias. Quando detecta, registra no audit_log
 * (uma vez por dia por usuário) e mantém lista em memória para o painel admin.
 *
 * Configuração via edusync_config:
 *   sync_stale_alert_days            — dias sem sync para disparar alerta (padrão: 7)
 *   sync_stale_alert_interval_horas  — intervalo entre verificações (padrão: 24h)
 */

const DEFAULTS = {
    alertDias:     7,
    intervalHoras: 24,
};

/**
 * Lista em memória dos usuários atualmente com sync desatualizado.
 * Atualizada a cada execução do job.
 */
let _usuariosStale = [];

/** Retorna snapshot imutável dos usuários stale detectados na última execução. */
export function getUsuariosStale() {
    return [..._usuariosStale];
}

/**
 * Lê configurações do job a partir do banco (com fallback para defaults).
 */
async function readConfig(pool) {
    try {
        const { rows } = await pool.query(
            `SELECT chave, valor FROM edusync_config
              WHERE chave = ANY($1)`,
            [['sync_stale_alert_days', 'sync_stale_alert_interval_horas']]
        );
        const map = Object.fromEntries(rows.map(r => [r.chave, r.valor]));

        const alertDias = parseInt(map['sync_stale_alert_days'], 10);
        const intervalHoras = parseInt(map['sync_stale_alert_interval_horas'], 10);

        return {
            alertDias:     Number.isFinite(alertDias)     && alertDias     > 0 ? alertDias     : DEFAULTS.alertDias,
            intervalHoras: Number.isFinite(intervalHoras) && intervalHoras > 0 ? intervalHoras : DEFAULTS.intervalHoras,
        };
    } catch (e) {
        console.warn('[STALE-SYNC] Aviso: falha ao ler config do banco, usando defaults:', e.message);
        return { ...DEFAULTS };
    }
}

/**
 * Executa uma verificação completa de syncs parados.
 * Retorna { verificados, stale, alertasRegistrados }
 */
export async function verificarSyncsStalent(pool) {
    const conf = await readConfig(pool);
    console.log(`[STALE-SYNC] Verificando usuários sem sync há mais de ${conf.alertDias} dias...`);

    let verificados = 0;
    let staleUsuarios = [];
    let alertasRegistrados = 0;

    try {
        /* Busca todos os usuários ativos e o último sync de cada um.
           LEFT JOIN garante que usuários sem registro em edusync_sync_cache
           também apareçam (ultimo_sync = NULL). */
        const { rows } = await pool.query(`
            SELECT
                u.id,
                u.nome,
                u.cpf,
                u.perfil,
                c.ultimo_sync
            FROM edusync_usuarios u
            LEFT JOIN edusync_sync_cache c ON c.usuario_id = u.id
            WHERE u.ativo = true
            ORDER BY u.nome
        `);

        verificados = rows.length;

        const limiteData = new Date(Date.now() - conf.alertDias * 24 * 60 * 60 * 1000);

        staleUsuarios = rows.filter(r => {
            if (!r.ultimo_sync) return true;
            return new Date(r.ultimo_sync) < limiteData;
        }).map(r => ({
            id:         r.id,
            nome:       r.nome,
            perfil:     r.perfil,
            ultimoSync: r.ultimo_sync ? new Date(r.ultimo_sync).toISOString() : null,
        }));

        _usuariosStale = staleUsuarios;

        if (staleUsuarios.length === 0) {
            console.log(`[STALE-SYNC] Nenhum usuário com sync atrasado (${verificados} verificados).`);
            return { verificados, stale: 0, alertasRegistrados: 0 };
        }

        console.warn(
            `[STALE-SYNC] ${staleUsuarios.length}/${verificados} usuário(s) com sync atrasado: ` +
            staleUsuarios.map(u => `${u.nome} (último sync: ${u.ultimoSync ?? 'nunca'})`).join(', ')
        );

        /* Registra no audit_log — uma vez por usuário por dia (evita spam). */
        for (const u of staleUsuarios) {
            try {
                const { rowCount } = await pool.query(
                    `SELECT 1 FROM edusync_audit_log
                      WHERE acao = 'SYNC_STALE_ALERT'
                        AND (detalhes->>'usuario_id')::int = $1
                        AND criado_em > NOW() - INTERVAL '23 hours'
                      LIMIT 1`,
                    [u.id]
                );

                if (rowCount > 0) continue;

                await pool.query(
                    `INSERT INTO edusync_audit_log
                        (acao, modulo, usuario_nome, detalhes, criado_em)
                     VALUES ('SYNC_STALE_ALERT', 'sync', 'sistema', $1, NOW())`,
                    [JSON.stringify({
                        usuario_id:   u.id,
                        usuario_nome: u.nome,
                        perfil:       u.perfil,
                        ultimo_sync:  u.ultimoSync,
                        limite_dias:  conf.alertDias,
                        mensagem:     u.ultimoSync
                            ? `Sync do usuário "${u.nome}" não ocorre há mais de ${conf.alertDias} dias (último: ${u.ultimoSync})`
                            : `Usuário "${u.nome}" nunca sincronizou com o RCO`,
                    })]
                );

                alertasRegistrados++;
            } catch (e) {
                console.error(`[STALE-SYNC] Erro ao registrar alerta para usuário ${u.id}:`, e.message);
            }
        }

    } catch (e) {
        console.error('[STALE-SYNC] Erro na verificação:', e.message);
    }

    console.log(
        `[STALE-SYNC] Concluído — ${verificados} verificados, ` +
        `${staleUsuarios.length} stale, ${alertasRegistrados} alerta(s) novo(s) registrado(s).`
    );

    return { verificados, stale: staleUsuarios.length, alertasRegistrados };
}

/**
 * Inicializa e agenda o job de alerta de sync parado.
 * Primeira execução: 90 s após o servidor subir.
 * Execuções seguintes: a cada `sync_stale_alert_interval_horas` horas.
 */
export function agendarSyncStaleAlert(pool) {
    async function rodar(contexto) {
        try {
            await verificarSyncsStalent(pool);
        } catch (e) {
            console.error(`[STALE-SYNC] Erro na execução (${contexto}):`, e.message);
        } finally {
            agendarProxima();
        }
    }

    async function agendarProxima() {
        const conf = await readConfig(pool).catch(() => ({ ...DEFAULTS }));
        const intervaloMs = conf.intervalHoras * 60 * 60 * 1000;
        console.log(`[STALE-SYNC] Próxima verificação em ${conf.intervalHoras}h`);
        setTimeout(() => rodar('periódica'), intervaloMs);
    }

    setTimeout(() => rodar('inicial'), 90_000);
    console.log('[STALE-SYNC] Job agendado — primeira execução em 90s');
}
