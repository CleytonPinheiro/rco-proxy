/**
 * GradePen Error Alert Service
 *
 * Tracks GP_FETCH_ERROR occurrences per gpErrorCode using an in-memory
 * sliding window. When N errors of the same code are recorded within M minutes,
 * emits a server-side warning log AND writes a GP_ERROR_ALERT entry to the
 * audit log.  Alerts are suppressed (cooldown) until the current window expires
 * so admins are not flooded with repeated notifications.
 *
 * Configuration via edusync_config (highest priority) or env vars (fallback):
 *   gp_error_alerta_n        — number of errors that trigger an alert (default 5)
 *   gp_error_alerta_minutos  — sliding-window width in minutes (default 60)
 *
 * Env-var fallbacks:
 *   GP_ERROR_ALERTA_N        — same default: 5
 *   GP_ERROR_ALERTA_MINUTOS  — same default: 60
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEFAULTS = { n: 5, minutos: 60 };

/**
 * In-memory map: gpErrorCode → array of timestamps (ms) for occurrences
 * that fall within the current window.
 */
const _janela = new Map();

/**
 * Tracks the timestamp of the last alert sent per errorCode, so we can
 * enforce a per-window cooldown and avoid duplicate alerts.
 * Map: gpErrorCode → { alertadoEm: number, windowMs: number }
 */
const _ultimoAlerta = new Map();

/**
 * Snapshot of recent alerts, kept for the admin panel to query without a DB
 * round-trip.  Bounded to the last 50 entries.
 */
let _alertasRecentes = [];

/** Returns a shallow copy of the recent alert list for the admin panel. */
export function getRecentGpErrorAlerts() {
    return [..._alertasRecentes];
}

/**
 * Reads threshold config from edusync_config with env-var and hardcoded fallbacks.
 * @returns {{ n: number, minutos: number }}
 */
async function readConfig() {
    try {
        const { rows } = await pool.query(
            `SELECT chave, valor FROM edusync_config
              WHERE chave = ANY($1)`,
            [['gp_error_alerta_n', 'gp_error_alerta_minutos']]
        );
        const map = Object.fromEntries(rows.map(r => [r.chave, r.valor]));

        const n       = parseInt(map['gp_error_alerta_n']       ?? process.env.GP_ERROR_ALERTA_N       ?? DEFAULTS.n,       10);
        const minutos = parseInt(map['gp_error_alerta_minutos'] ?? process.env.GP_ERROR_ALERTA_MINUTOS ?? DEFAULTS.minutos, 10);

        return {
            n:       Number.isFinite(n)       && n       > 0 ? n       : DEFAULTS.n,
            minutos: Number.isFinite(minutos) && minutos > 0 ? minutos : DEFAULTS.minutos,
        };
    } catch (e) {
        console.warn('[GP-ERROR-ALERT] Falha ao ler config; usando defaults:', e.message);
        return { ...DEFAULTS };
    }
}

/**
 * Records a GradePen error occurrence and fires an alert if the threshold is
 * crossed.
 *
 * @param {string|null} gpErrorCode  — error code from the GradePen response
 * @param {object}      detalhes     — arbitrary context (gradepenId, message, …)
 */
export async function recordGpError(gpErrorCode, detalhes = {}) {
    const codigo = String(gpErrorCode ?? 'UNKNOWN');

    const conf      = await readConfig();
    const windowMs  = conf.minutos * 60 * 1000;
    const agora     = Date.now();
    const limiteMs  = agora - windowMs;

    /* ── Prune old timestamps and append current one ── */
    const timestamps = (_janela.get(codigo) ?? []).filter(t => t > limiteMs);
    timestamps.push(agora);
    _janela.set(codigo, timestamps);

    const total = timestamps.length;

    /* ── Check whether we should fire an alert ── */
    if (total < conf.n) return;

    /* Cooldown: suppress a second alert for the same code within the same window */
    const ultimo = _ultimoAlerta.get(codigo);
    if (ultimo && (agora - ultimo.alertadoEm) < windowMs) return;

    /* ── Fire the alert ── */
    _ultimoAlerta.set(codigo, { alertadoEm: agora, windowMs });

    const mensagem =
        `GradePen: ${total} erros do código "${codigo}" nos últimos ${conf.minutos} min ` +
        `(limite: ${conf.n}). Verifique a sessão GradePen no painel admin.`;

    console.warn(`[GP-ERROR-ALERT] ⚠️  ${mensagem}`);

    /* Store in in-memory list (bounded to 50) */
    const alerta = {
        gpErrorCode: codigo,
        total,
        limiteN:     conf.n,
        janelaMin:   conf.minutos,
        detectadoEm: new Date(agora).toISOString(),
        detalhes,
    };
    _alertasRecentes = [alerta, ..._alertasRecentes].slice(0, 50);

    /* Write to audit log so admins can review it later */
    try {
        await pool.query(
            `INSERT INTO edusync_audit_log
                (acao, modulo, usuario_nome, detalhes, criado_em)
             VALUES ('GP_ERROR_ALERT', 'provas', 'sistema', $1, NOW())`,
            [JSON.stringify({
                gpErrorCode: codigo,
                total,
                limiteN:     conf.n,
                janelaMin:   conf.minutos,
                mensagem,
                ultimoDetalhes: detalhes,
            })]
        );
    } catch (e) {
        console.error('[GP-ERROR-ALERT] Falha ao gravar alerta no audit_log:', e.message);
    }
}
