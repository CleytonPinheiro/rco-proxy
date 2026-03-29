/**
 * Representa a sessão autenticada de um único usuário.
 * Encapsula credenciais e gerencia o token RCO de forma independente.
 */
export class UserSession {
    #id;
    #userId;
    #cpf;
    #senha;
    #nome;
    #perfil;
    #rcoToken       = null;
    #rcoTokenExpiry = null;
    #refreshPromise = null;
    #createdAt;
    #lastActivity;
    #loginFn;
    #decodeFn;

    constructor({ id, userId, cpf, senha, nome, perfil, loginFn, decodeFn }) {
        this.#id           = id;
        this.#userId       = userId;
        this.#cpf          = cpf;
        this.#senha        = senha;
        this.#nome         = nome;
        this.#perfil       = perfil;
        this.#loginFn      = loginFn;
        this.#decodeFn     = decodeFn;
        this.#createdAt    = Date.now();
        this.#lastActivity = Date.now();
    }

    /* ── Getters públicos ── */
    get id()           { return this.#id; }
    get userId()       { return this.#userId; }
    get cpf()          { return this.#cpf; }
    get nome()         { return this.#nome; }
    get perfil()       { return this.#perfil; }
    get lastActivity() { return this.#lastActivity; }
    get createdAt()    { return this.#createdAt; }

    /** Atualiza o timestamp de última atividade */
    touch() { this.#lastActivity = Date.now(); }

    /** Verifica se a sessão expirou (padrão: 8 horas de inatividade) */
    isExpired(ttlMs = 8 * 60 * 60 * 1000) {
        return Date.now() - this.#lastActivity > ttlMs;
    }

    /**
     * Retorna um token RCO válido, renovando automaticamente se necessário.
     * Idêntico ao mecanismo do TokenService global, mas isolado por sessão.
     * @param {boolean} force - força renovação mesmo com token válido
     * @returns {Promise<string>}
     */
    async getRcoToken(force = false) {
        const now   = Date.now();
        const valid = !force
            && this.#rcoToken
            && this.#rcoTokenExpiry
            && this.#rcoTokenExpiry > now + 300_000;

        if (valid) return this.#rcoToken;

        if (this.#refreshPromise) {
            await this.#refreshPromise;
            return this.#rcoToken;
        }

        console.log(`[UserSession] Obtendo token RCO para CPF ...${this.#cpf.slice(-4)}`);
        this.#refreshPromise = this.#loginFn(this.#cpf, this.#senha)
            .then(token => {
                this.#rcoToken       = token.trim();
                this.#rcoTokenExpiry = this.#decodeFn(this.#rcoToken) || (now + 3_600_000);
                console.log(`[UserSession] Token obtido. Expira: ${new Date(this.#rcoTokenExpiry).toISOString()}`);
            })
            .catch(err => {
                console.error('[UserSession] Falha ao obter token:', err.message);
                throw err;
            })
            .finally(() => { this.#refreshPromise = null; });

        await this.#refreshPromise;
        return this.#rcoToken;
    }

    /** Retorna dados públicos (sem credenciais) */
    toPublic() {
        const cpf = this.#cpf;
        const cpfMask = cpf.length >= 11
            ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.***.***-$4')
            : cpf;
        return {
            userId:  this.#userId,
            nome:    this.#nome,
            cpf:     cpfMask,
            perfil:  this.#perfil,
        };
    }

    /**
     * Injeta um token já obtido (ex: logo após o login) evitando Puppeteer duplo.
     * @param {string} token
     * @param {number|null} expiry - timestamp de expiração (ms)
     */
    seedToken(token, expiry = null) {
        this.#rcoToken       = token.trim();
        this.#rcoTokenExpiry = expiry || (Date.now() + 3_600_000);
    }

    /** Remove credenciais da memória ao encerrar a sessão */
    destroy() {
        this.#senha        = null;
        this.#rcoToken     = null;
        this.#rcoTokenExpiry = null;
    }
}
