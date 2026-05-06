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
    create({ userId, cpf, senha, nome, perfil, email, loginFn, decodeFn }) {
        const sessionId = uuidv4();
        const session   = new UserSession({
            id: sessionId, userId, cpf, senha, nome, perfil, email, loginFn, decodeFn,
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

    /**
     * Remove e destrói uma sessão.
     * Zera credenciais (CPF/senha) e token RCO da memória.
     * Nota: sessões não possuem páginas Puppeteer próprias — o browser é um
     * singleton compartilhado e as páginas de login são sempre fechadas no
     * finally de loginWithPuppeteer(), então não há recursos Chromium por sessão.
     */
    destroy(sessionId) {
        const session = this.#sessions.get(sessionId);
        if (session) {
            const nome = session.nome || '?';
            session.destroy();
            this.#sessions.delete(sessionId);
            console.log(`[SessionStore] Sessão encerrada: ${nome}. Token RCO e credenciais zerados da memória. Restantes: ${this.#sessions.size}`);
        }
    }

    /**
     * Remove todas as sessões expiradas (chamado a cada 30 min).
     * Cada sessão expirada tem credenciais e token zerados da memória.
     * O singleton Chromium permanece ativo (compartilhado entre todos).
     */
    #cleanup() {
        let removed = 0;
        for (const [id, session] of this.#sessions) {
            if (session.isExpired()) {
                const nome = session.nome || '?';
                const idle = Math.round((Date.now() - session.lastActivity) / 60_000);
                session.destroy();
                this.#sessions.delete(id);
                console.log(`[SessionStore] Sessão expirada: ${nome} (${idle} min inativa) — credenciais e token zerados.`);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[SessionStore] Limpeza: ${removed} sessão(ões) removida(s). Ativas: ${this.#sessions.size}`);
        }
    }

    get size() { return this.#sessions.size; }
}

export const userSessionStore = new UserSessionStore();
