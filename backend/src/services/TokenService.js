export class TokenService {
    #cachedToken = null;
    #tokenExpiration = null;
    #refreshPromise = null;
    #credentialsVersion = 0;
    #credentials = {
        cpf: process.env.RCO_CPF || '',
        senha: process.env.RCO_SENHA || '',
    };

    #loginWithPuppeteer = null;
    #decodeJwtExpiration = null;

    initialize(loginFn, decodeFn) {
        this.#loginWithPuppeteer = loginFn;
        this.#decodeJwtExpiration = decodeFn;
    }

    setCredentials(cpf, senha) {
        const changed = cpf !== this.#credentials.cpf || senha !== this.#credentials.senha;
        this.#credentials.cpf = cpf;
        this.#credentials.senha = senha;
        if (changed) {
            this.#cachedToken = null;
            this.#tokenExpiration = null;
            this.#credentialsVersion++;
            console.log(`[TokenService] Credenciais alteradas (v${this.#credentialsVersion}), token invalidado`);
        }
    }

    getCpf() {
        return this.#credentials.cpf || null;
    }

    isConfigured() {
        return !!(this.#credentials.cpf && this.#credentials.senha);
    }

    isReady() {
        return !!this.#loginWithPuppeteer;
    }

    getStatus() {
        return {
            credenciaisConfiguradas: this.isConfigured(),
            tokenEmCache: !!this.#cachedToken,
            tokenExpiracao: this.#tokenExpiration
                ? new Date(this.#tokenExpiration).toISOString()
                : null,
        };
    }

    async getValidToken(forceRefresh = false) {
        if (!this.#loginWithPuppeteer) {
            throw new Error('Sistema ainda inicializando, aguarde alguns segundos');
        }

        if (!forceRefresh && this.#cachedToken && this.#tokenExpiration && this.#tokenExpiration > Date.now() + 300000) {
            return this.#cachedToken;
        }

        if (this.#refreshPromise) {
            console.log('[TokenService] Renovação já em andamento, aguardando...');
            await this.#refreshPromise;

            if (forceRefresh) {
                // Após aguardar o refresh anterior (que pode ter sido para outro CPF),
                // sempre iniciamos um novo refresh quando forceRefresh=true
                return this.getValidToken(true);
            }
            return this.#cachedToken;
        }

        const versionAtStart = this.#credentialsVersion;
        const { cpf, senha } = this.#credentials;
        if (!cpf || !senha) {
            throw new Error('Credenciais não configuradas');
        }

        console.log(`[TokenService] Obtendo novo token para CPF ...${cpf.slice(-4)} via navegador automatizado...`);
        this.#refreshPromise = this.#loginWithPuppeteer(cpf, senha)
            .then(token => {
                if (this.#credentialsVersion === versionAtStart) {
                    this.#cachedToken = token.trim();
                    this.#tokenExpiration = this.#decodeJwtExpiration(this.#cachedToken) || (Date.now() + 3600000);
                    console.log(`[TokenService] Token obtido. Expira em: ${new Date(this.#tokenExpiration).toISOString()}`);
                } else {
                    console.log(`[TokenService] Credenciais mudaram durante o refresh (v${versionAtStart}→v${this.#credentialsVersion}), token descartado`);
                }
            })
            .catch(err => {
                console.error('[TokenService] Falha ao obter token:', err.message);
                throw err;
            })
            .finally(() => {
                this.#refreshPromise = null;
            });

        await this.#refreshPromise;
        return this.#cachedToken;
    }
}

export const tokenService = new TokenService();
