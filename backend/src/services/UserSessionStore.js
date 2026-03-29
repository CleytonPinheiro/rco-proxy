/**
 * Gerenciador de sessões ativas.
 * Singleton que mantém um Map de sessionId → UserSession.
 * Executa limpeza automática de sessões expiradas a cada 30 minutos.
 */
import { v4 as uuidv4 } from 'uuid';
import { UserSession }  from './UserSession.js';

class UserSessionStore {
    #sessions = new Map();
    #cleanupInterval;

    constructor() {
        // Limpeza automática a cada 30 minutos
        this.#cleanupInterval = setInterval(() => this.#cleanup(), 30 * 60 * 1000);
    }

    /**
     * Cria e registra uma nova sessão para o usuário autenticado.
     * @returns {{ sessionId: string, session: UserSession }}
     */
    create({ userId, cpf, senha, nome, perfil, loginFn, decodeFn }) {
        const sessionId = uuidv4();
        const session   = new UserSession({
            id: sessionId, userId, cpf, senha, nome, perfil, loginFn, decodeFn,
        });
        this.#sessions.set(sessionId, session);
        console.log(`[SessionStore] Sessão criada para ${nome} (perfil: ${perfil}). Total: ${this.#sessions.size}`);
        return { sessionId, session };
    }

    /** Busca sessão por ID; retorna null se não encontrada ou expirada */
    get(sessionId) {
        if (!sessionId) return null;
        const session = this.#sessions.get(sessionId);
        if (!session) return null;
        if (session.isExpired()) {
            this.destroy(sessionId);
            return null;
        }
        return session;
    }

    /** Remove e destrói uma sessão */
    destroy(sessionId) {
        const session = this.#sessions.get(sessionId);
        if (session) {
            session.destroy();
            this.#sessions.delete(sessionId);
            console.log(`[SessionStore] Sessão encerrada. Restantes: ${this.#sessions.size}`);
        }
    }

    /** Remove todas as sessões expiradas */
    #cleanup() {
        let removed = 0;
        for (const [id, session] of this.#sessions) {
            if (session.isExpired()) {
                session.destroy();
                this.#sessions.delete(id);
                removed++;
            }
        }
        if (removed > 0) console.log(`[SessionStore] Limpeza: ${removed} sessão(ões) expirada(s) removida(s)`);
    }

    get size() { return this.#sessions.size; }
}

export const userSessionStore = new UserSessionStore();
