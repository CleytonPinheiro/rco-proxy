/**
 * Representa a sessão autenticada de um único usuário.
 * Encapsula credenciais e gerencia o token RCO de forma independente.
 * Suporta modo impersonação: admin visualiza o sistema como outro perfil.
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

    /* ── Impersonação ── */
    #impersonandoPerfil = null;
    #impersonandoNome   = null;

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
    get perfil()       { return this.#perfil; }          // perfil REAL (para auth backend)
    get lastActivity() { return this.#lastActivity; }
    get createdAt()    { return this.#createdAt; }

    /* ── Impersonação: getters ── */
    get isImpersonando()     { return this.#impersonandoPerfil !== null; }
    get impersonandoPerfil() { return this.#impersonandoPerfil; }
    get impersonandoNome()   { return this.#impersonandoNome; }

    /**
     * Ativa o modo impersonação. Apenas admins devem chamar este método.
     * @param {string} perfil - perfil a simular
     * @param {string} nome   - nome descritivo do perfil (ex: "Professor")
     */
    impersonar(perfil, nome) {
        this.#impersonandoPerfil = perfil;
        this.#impersonandoNome   = nome;
    }

    /** Desativa o modo impersonação, voltando ao perfil real. */
    sairImpersonacao() {
        this.#impersonandoPerfil = null;
        this.#impersonandoNome   = null;
    }

    /** Atualiza o timestamp de última atividade */
    touch() { this.#lastActivity = Date.now(); }

    /** Verifica se a sessão expirou (padrão: 8 horas de inatividade) */
    isExpired(ttlMs = 8 * 60 * 60 * 1000) {
        return Date.now() - this.#lastActivity > ttlMs;
    }

    /**
     * Retorna um token RCO válido, renovando automaticamente se necessário.
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
            if (!this.#rcoToken) throw new Error('[UserSession] Renovação de token falhou — token ainda nulo.');
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

    /**
     * Retorna dados públicos (sem credenciais).
     * Quando em modo impersonação, retorna o perfil simulado no campo `perfil`,
     * mas mantém `perfilReal` e `impersonando: true` para o frontend exibir o banner.
     */
    toPublic() {
        const cpf = this.#cpf;
        const cpfMask = cpf.length >= 11
            ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.***.***-$4')
            : cpf;

        const base = {
            userId:     this.#userId,
            nome:       this.#nome,
            cpf:        cpfMask,
            perfil:     this.#perfil,           // perfil real sempre presente
            perfilReal: this.#perfil,
        };

        if (this.#impersonandoPerfil) {
            return {
                ...base,
                perfil:              this.#impersonandoPerfil, // sobrescreve para o frontend
                impersonando:        true,
                impersonandoPerfil:  this.#impersonandoPerfil,
                impersonandoNome:    this.#impersonandoNome,
            };
        }

        return base;
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
        this.#senha          = null;
        this.#rcoToken       = null;
        this.#rcoTokenExpiry = null;
    }
}
