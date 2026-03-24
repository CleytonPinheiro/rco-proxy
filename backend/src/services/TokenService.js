export class TokenService {
    #cachedToken = null;
    #tokenExpiration = null;
    #refreshPromise = null;
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
        this.#credentials.cpf = cpf;
        this.#credentials.senha = senha;
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
            console.log('Renovação de token já em andamento, aguardando...');
            await this.#refreshPromise;
            return this.#cachedToken;
        }

        const { cpf, senha } = this.#credentials;
        if (!cpf || !senha) {
            throw new Error('Credenciais não configuradas');
        }

        console.log('Obtendo novo token via navegador automatizado...');
        this.#refreshPromise = this.#loginWithPuppeteer(cpf, senha)
            .then(token => {
                this.#cachedToken = token.trim();
                this.#tokenExpiration = this.#decodeJwtExpiration(this.#cachedToken) || (Date.now() + 3600000);
                console.log('Token obtido. Expira em:', new Date(this.#tokenExpiration).toISOString());
            })
            .catch(err => {
                console.error('Falha ao obter token:', err.message);
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
