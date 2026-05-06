/**
 * Armazenamento de falhas de login por CPF com persistência no banco local.
 *
 * - Em memória: Map { cpf → { count, resetAt } }
 * - No banco: tabela `edusync_rate_limit_cpf` (criada pelo dbInit)
 *
 * Ao iniciar o servidor, loadCpfRateLimitFromDb() recarrega entradas
 * não expiradas para que bloqueios ativos sobrevivam a restarts.
 */

import { pool } from '../config/dbInit.js';

export const RL_CPF_JANELA = parseInt(process.env.RL_LOGIN_CPF_JANELA_MS || String(15 * 60 * 1000), 10);
export const RL_CPF_MAX    = parseInt(process.env.RL_LOGIN_CPF_MAX        || '5', 10);

export const cpfFailureStore = new Map();

export const INFRA_ERROR_RE = /timeout|network|navigation|net::|EPIPE|ECONNRESET|ENOTFOUND|Protocol error|Target closed|Page crashed/i;

function _cpfEntry(cpf) {
    const entry = cpfFailureStore.get(cpf);
    if (!entry || Date.now() >= entry.resetAt) return null;
    return entry;
}

export function cpfFailureCount(cpf)   { return _cpfEntry(cpf)?.count ?? 0; }
export function cpfFailureResetAt(cpf) { return _cpfEntry(cpf)?.resetAt ?? Date.now(); }

export function cpfFailureClear(cpf) {
    cpfFailureStore.delete(cpf);
    pool.query('DELETE FROM edusync_rate_limit_cpf WHERE cpf = $1', [cpf])
        .catch(e => console.warn('[RateLimit] Falha ao remover CPF do banco:', e.message));
}

export function cpfFailureIncrement(cpf) {
    const now   = Date.now();
    const entry = cpfFailureStore.get(cpf);
    let count, resetAt;
    if (!entry || now >= entry.resetAt) {
        count   = 1;
        resetAt = now + RL_CPF_JANELA;
        cpfFailureStore.set(cpf, { count, resetAt });
    } else {
        entry.count += 1;
        count   = entry.count;
        resetAt = entry.resetAt;
    }
    pool.query(
        `INSERT INTO edusync_rate_limit_cpf (cpf, count, reset_at)
         VALUES ($1, $2, to_timestamp($3::bigint / 1000.0))
         ON CONFLICT (cpf) DO UPDATE
             SET count    = EXCLUDED.count,
                 reset_at = EXCLUDED.reset_at`,
        [cpf, count, resetAt],
    ).catch(e => console.warn('[RateLimit] Falha ao persistir contador CPF:', e.message));
}

export function getCpfRateLimitSnapshot() {
    const now = Date.now();
    const result = [];
    for (const [cpf, entry] of cpfFailureStore) {
        if (now >= entry.resetAt) continue;
        result.push({
            cpf,
            count:       entry.count,
            bloqueado:   entry.count >= RL_CPF_MAX,
            resetAt:     entry.resetAt,
            segundosAte: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
        });
    }
    result.sort((a, b) => b.count - a.count);
    return { entradas: result, limite: RL_CPF_MAX, janelaMin: Math.ceil(RL_CPF_JANELA / 60000) };
}

export function clearCpfRateLimit(cpf) {
    const deleted = cpfFailureStore.delete(cpf);
    pool.query('DELETE FROM edusync_rate_limit_cpf WHERE cpf = $1', [cpf])
        .catch(e => console.warn('[RateLimit] Falha ao remover CPF do banco (admin reset):', e.message));
    return deleted;
}

export async function loadCpfRateLimitFromDb() {
    try {
        const { rows } = await pool.query(
            `SELECT cpf, count,
                    (EXTRACT(EPOCH FROM reset_at) * 1000)::bigint AS reset_ms
             FROM edusync_rate_limit_cpf
             WHERE reset_at > NOW()`,
        );
        for (const row of rows) {
            cpfFailureStore.set(row.cpf, {
                count:   row.count,
                resetAt: Number(row.reset_ms),
            });
        }
        if (rows.length > 0) {
            console.log(`[RateLimit] ${rows.length} contador(es) de CPF restaurado(s) do banco.`);
        }
    } catch (e) {
        console.warn('[RateLimit] Falha ao carregar contadores CPF do banco:', e.message);
    }
}

async function _pruneExpiredFromDb() {
    try {
        await pool.query(`DELETE FROM edusync_rate_limit_cpf WHERE reset_at <= NOW()`);
    } catch (e) {
        console.warn('[RateLimit] Falha ao podar entradas expiradas do banco:', e.message);
    }
}

setInterval(async () => {
    const now = Date.now();
    for (const [cpf, entry] of cpfFailureStore) {
        if (now >= entry.resetAt) cpfFailureStore.delete(cpf);
    }
    await _pruneExpiredFromDb();
}, RL_CPF_JANELA).unref();
