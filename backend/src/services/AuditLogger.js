/**
 * Serviço de auditoria.
 * Registra ações dos usuários na tabela edusync_audit_log.
 */
import pg from 'pg';
const { Pool } = pg;

class AuditLogger {
    #pool = new Pool({ connectionString: process.env.DATABASE_URL });

    /**
     * Registra uma ação no log de auditoria.
     * @param {object} params
     * @param {number|null}  params.usuarioId
     * @param {string}       params.usuarioNome
     * @param {string}       params.acao        - ex: 'LOGIN', 'LOGOUT', 'NOTA_ATUALIZADA'
     * @param {string}       params.modulo      - ex: 'frequencias', 'classroom'
     * @param {object|null}  params.detalhes    - dados extras (JSONB)
     * @param {string|null}  params.ip
     */
    async registrar({ usuarioId = null, usuarioNome = 'Sistema', acao, modulo = null, detalhes = null, ip = null }) {
        try {
            await this.#pool.query(
                `INSERT INTO edusync_audit_log (usuario_id, usuario_nome, acao, modulo, detalhes, ip)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [usuarioId, usuarioNome, acao, modulo, detalhes ? JSON.stringify(detalhes) : null, ip],
            );
        } catch (err) {
            // Não interrompe o fluxo por falha no log
            console.error('[AuditLogger] Erro ao registrar:', err.message);
        }
    }

    /**
     * Consulta o log de auditoria com filtros opcionais.
     */
    async consultar({ usuarioId = null, modulo = null, limite = 100, offset = 0 } = {}) {
        const conditions = [];
        const params     = [];

        if (usuarioId) { conditions.push(`usuario_id = $${params.push(usuarioId)}`); }
        if (modulo)    { conditions.push(`modulo     = $${params.push(modulo)}`); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limite, offset);

        const { rows } = await this.#pool.query(
            `SELECT * FROM edusync_audit_log
             ${where}
             ORDER BY criado_em DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params,
        );
        return rows;
    }
}

export const auditLogger = new AuditLogger();
