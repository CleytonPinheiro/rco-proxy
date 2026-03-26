/**
 * GoogleSession — gerencia autenticação Google para o backend EduSync.
 *
 * Singleton que mantém a sessão Classroom ativa, persiste cookies em disco
 * e expõe o ClassroomClient para uso nas rotas.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth }      from '../../../packages/classroom-scraper/src/GoogleAuth.js';
import { ClassroomClient } from '../../../packages/classroom-scraper/src/ClassroomClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, '../../data/google_session.json');

class GoogleSession {
    #auth   = null;
    #client = null;

    /** Deve ser chamado após o getBrowser estar disponível. */
    initialize(getBrowser) {
        this.#rebuild(getBrowser);
    }

    /** Recria auth/client (ex.: após mudança de credenciais). */
    #rebuild(getBrowser) {
        const email    = process.env.GOOGLE_EMAIL    || '';
        const password = process.env.GOOGLE_PASSWORD || '';

        if (!email || !password) {
            this.#auth   = null;
            this.#client = null;
            return;
        }

        this.#auth = new GoogleAuth({
            email,
            password,
            getBrowser,
            cookieFile: COOKIE_FILE,
        });
        this.#client = new ClassroomClient(this.#auth);
        console.log(`[GoogleSession] Sessão configurada para ${email}`);
    }

    isConfigured() {
        return !!(process.env.GOOGLE_EMAIL && process.env.GOOGLE_PASSWORD);
    }

    isAuthenticated() {
        return this.#auth?.isAuthenticated() ?? false;
    }

    getEmail() {
        return process.env.GOOGLE_EMAIL || null;
    }

    /** Retorna o ClassroomClient ou lança erro se não configurado. */
    getClient() {
        if (!this.#client) throw new Error('Credenciais Google não configuradas.');
        return this.#client;
    }

    /** Pré-autentica (warm-up) — útil no boot. */
    async warmUp() {
        if (!this.#auth) return;
        try {
            await this.#auth.getToken();
            console.log('[GoogleSession] Warm-up concluído.');
        } catch (e) {
            console.warn('[GoogleSession] Warm-up falhou:', e.message);
        }
    }

    /** Invalida a sessão atual (força re-login). */
    disconnect() {
        this.#auth?.invalidate();
        console.log('[GoogleSession] Sessão desconectada.');
    }
}

export const googleSession = new GoogleSession();
