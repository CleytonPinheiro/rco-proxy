/**
 * GoogleSession — gerencia autenticação Google para o backend EduSync.
 *
 * Singleton que mantém a sessão Classroom ativa, persiste cookies em disco
 * e expõe o ClassroomClient para uso nas rotas.
 *
 * Credenciais são fornecidas via setCredentials() (inseridas pelo usuário
 * na interface do app), igual ao padrão CPF/senha do RCO.
 * Apenas os cookies de sessão são persistidos em disco — a senha nunca é gravada.
 */

import path from 'path';
import fs   from 'fs';
import { fileURLToPath } from 'url';
import { GoogleAuth }      from '../../../packages/classroom-scraper/src/GoogleAuth.js';
import { ClassroomClient } from '../../../packages/classroom-scraper/src/ClassroomClient.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE  = path.join(__dirname, '../../data/google_session.json');
const CRED_FILE    = path.join(__dirname, '../../data/google_cred.json');

class GoogleSession {
    #auth       = null;
    #client     = null;
    #email      = null;
    #getBrowser = null;

    // ── Inicialização ──────────────────────────────────────────────────────

    /** Chamado no boot do servidor com a função getBrowser do Puppeteer. */
    initialize(getBrowser) {
        this.#getBrowser = getBrowser;
        this.#loadSavedEmail();
    }

    /** Carrega o e-mail salvo em disco para restaurar estado após restart. */
    #loadSavedEmail() {
        try {
            if (fs.existsSync(CRED_FILE)) {
                const { email } = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
                if (email) {
                    this.#email = email;
                    // Reconstrói auth sem senha (usará cookies salvos)
                    this.#buildAuth(email, '');
                    console.log(`[GoogleSession] E-mail restaurado: ${email} (usará cookies salvos)`);
                }
            }
        } catch {}
    }

    // ── Credenciais (inseridas pelo usuário via UI) ────────────────────────

    /**
     * Recebe e-mail e senha da professora (digitados na tela de conexão).
     * Reconstrói auth/client e salva o e-mail em disco (senha NÃO é salva).
     */
    setCredentials(email, password) {
        this.#email = email;
        this.#buildAuth(email, password);
        // Persiste apenas o e-mail para restaurar a referência após restart
        fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
        fs.writeFileSync(CRED_FILE, JSON.stringify({ email }), 'utf8');
        console.log(`[GoogleSession] Credenciais definidas para ${email}`);
    }

    #buildAuth(email, password) {
        if (!this.#getBrowser) return;
        this.#auth = new GoogleAuth({
            email,
            password,
            getBrowser: this.#getBrowser,
            cookieFile: COOKIE_FILE,
        });
        this.#client = new ClassroomClient(this.#auth);
    }

    // ── Estado ────────────────────────────────────────────────────────────

    /** True se há e-mail configurado (credenciais inseridas pelo usuário). */
    isConfigured() {
        return !!this.#email;
    }

    /** True se há token em cache válido (sessão ativa). */
    isAuthenticated() {
        return this.#auth?.isAuthenticated() ?? false;
    }

    getEmail() {
        return this.#email || null;
    }

    // ── Operações ─────────────────────────────────────────────────────────

    /** Retorna o ClassroomClient ou lança erro se não configurado. */
    getClient() {
        if (!this.#client) throw new Error('Credenciais Google não configuradas.');
        return this.#client;
    }

    /**
     * Pré-autentica via Puppeteer.
     * Chamado após setCredentials() ou no boot quando há cookies salvos.
     */
    async warmUp() {
        if (!this.#auth) return;
        await this.#auth.getToken();
        console.log('[GoogleSession] Warm-up concluído.');
    }

    /** Desconecta: invalida token e remove cookies e e-mail salvos. */
    disconnect() {
        this.#auth?.invalidate();
        this.#auth   = null;
        this.#client = null;
        this.#email  = null;
        try { fs.unlinkSync(CRED_FILE);  } catch {}
        console.log('[GoogleSession] Sessão desconectada.');
    }
}

export const googleSession = new GoogleSession();
