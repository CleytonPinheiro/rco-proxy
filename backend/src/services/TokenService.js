/**
 * Serviço global de token RCO — usado por jobs em background (sync).
 * Em requisições de usuário, o token vem da UserSession via RequestContext.
 */
import { requestContext } from './RequestContext.js';

export class TokenService {
    #cachedToken        = null;
    #tokenExpiration    = null;
    #refreshPromise     = null;
    #credentialsVersion = 0;
    #credentials = {
        cpf:   process.env.RCO_CPF   || '',
        senha: process.env.RCO_SENHA || '',
    };
    #loginWithPuppeteer  = null;
    #decodeJwtExpiration = null;

    initialize(loginFn, decodeFn) {
        this.#loginWithPuppeteer  = loginFn;
        this.#decodeJwtExpiration = decodeFn;
    }

    setCredentials(cpf, senha) {
        const changed = cpf !== this.#credentials.cpf || senha !== this.#credentials.senha;
        this.#credentials.cpf   = cpf;
        this.#credentials.senha = senha;
        if (changed) {
            this.#cachedToken     = null;
            this.#tokenExpiration = null;
            this.#credentialsVersion++;
            console.log(`[TokenService] Credenciais alteradas (v${this.#credentialsVersion}), token invalidado`);
        }
    }

    getCpf()         { return this.#credentials.cpf || null; }
    isConfigured()   { return !!(this.#credentials.cpf && this.#credentials.senha); }
    isReady()        { return !!this.#loginWithPuppeteer; }

    getStatus() {
        return {
            credenciaisConfiguradas: this.isConfigured(),
            tokenEmCache:   !!this.#cachedToken,
            tokenExpiracao: this.#tokenExpiration
                ? new Date(this.#tokenExpiration).toISOString()
                : null,
        };
    }

    /**
     * Retorna um token RCO válido.
     * — Se houver uma UserSession ativa no AsyncLocalStorage (requisição de usuário),
     *   delega para ela, garantindo isolamento de token por usuário.
     * — Sem sessão (jobs de background), usa as credenciais globais (env vars).
     */
    async getValidToken(forceRefresh = false) {
        if (!this.#loginWithPuppeteer) {
            throw new Error('Sistema ainda inicializando, aguarde alguns segundos');
        }

        const session = requestContext.getStore();
        if (session) return session.getRcoToken(forceRefresh);

        return this.#getGlobalToken(forceRefresh);
    }

    async #getGlobalToken(forceRefresh = false) {
        const now   = Date.now();
        const valid = !forceRefresh
            && this.#cachedToken
            && this.#tokenExpiration
            && this.#tokenExpiration > now + 300_000;

        if (valid) return this.#cachedToken;

        if (this.#refreshPromise) {
            console.log('[TokenService] Renovação já em andamento, aguardando...');
            await this.#refreshPromise;
            if (forceRefresh) return this.#getGlobalToken(true);
            return this.#cachedToken;
        }

        const versionAtStart = this.#credentialsVersion;
        const { cpf, senha } = this.#credentials;
        if (!cpf || !senha) throw new Error('Credenciais não configuradas');

        console.log(`[TokenService] Obtendo novo token para CPF ...${cpf.slice(-4)} via navegador automatizado...`);
        this.#refreshPromise = this.#loginWithPuppeteer(cpf, senha)
            .then(token => {
                if (this.#credentialsVersion === versionAtStart) {
                    this.#cachedToken     = token.trim();
                    this.#tokenExpiration = this.#decodeJwtExpiration(this.#cachedToken)
                        || (now + 3_600_000);
                    console.log(`[TokenService] Token obtido. Expira em: ${new Date(this.#tokenExpiration).toISOString()}`);
                } else {
                    console.log(`[TokenService] Credenciais mudaram durante refresh, token descartado`);
                }
            })
            .catch(err => { console.error('[TokenService] Falha ao obter token:', err.message); throw err; })
            .finally(() => { this.#refreshPromise = null; });

        await this.#refreshPromise;
        return this.#cachedToken;
    }
}

export const tokenService = new TokenService();
