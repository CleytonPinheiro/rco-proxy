/**
 * GoogleAuth — autenticação no Google via Puppeteer
 *
 * Estratégia:
 *   1. Usa browser Puppeteer (fornecido externamente via getBrowser).
 *   2. Abre uma aba e navega para classroom.google.com.
 *   3. Se a sessão estiver ativa (cookies salvos), carrega direto.
 *   4. Caso contrário, faz login com email/senha fornecidos.
 *   5. Intercepta requisições feitas pelo próprio classroom.google.com
 *      à classroom.googleapis.com — essas requisições carregam um Bearer token
 *      de PRIMEIRA PARTE (app Google), que não está sujeito a restrições de
 *      apps externos no Workspace.
 *   6. Persiste cookies em arquivo para reutilizar a sessão.
 *
 * Por que funciona mesmo com domínio escola.pr.gov.br bloqueado?
 *   O SEED-PR restringe apps de terceiros via OAuth. O token interceptado
 *   pertence ao app "classroom.google.com" (primeiro partido do Google) —
 *   essas restrições não se aplicam a ele.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CLASSROOM_ORIGIN = 'https://classroom.google.com';
const CLASSROOM_API    = 'classroom.googleapis.com';
const TOKEN_TTL_MS     = 45 * 60 * 1000;   // 45 min (tokens Google duram ~1h)
const COOKIE_TTL_MS    = 12 * 60 * 60 * 1000; // 12h antes de re-login

export class GoogleAuth {
    #email;
    #password;
    #getBrowser;
    #cookieFile;

    #accessToken   = null;
    #tokenExpiry   = 0;
    #cookiesLoaded = false;
    #lastLogin     = 0;
    #refreshLock   = null;

    /**
     * @param {object} opts
     * @param {string}   opts.email        - E-mail Google do usuário
     * @param {string}   opts.password     - Senha Google
     * @param {Function} opts.getBrowser   - async () => puppeteer.Browser
     * @param {string}   [opts.cookieFile] - Caminho para persistir cookies (opcional)
     */
    constructor({ email, password, getBrowser, cookieFile }) {
        this.#email      = email;
        this.#password   = password;
        this.#getBrowser = getBrowser;
        this.#cookieFile = cookieFile || null;
    }

    // ── API pública ──────────────────────────────────────────────────────────

    /** Retorna um Bearer token válido (obtém/renova se necessário). */
    async getToken() {
        if (this.#accessToken && Date.now() < this.#tokenExpiry) {
            return this.#accessToken;
        }
        if (this.#refreshLock) return this.#refreshLock;

        this.#refreshLock = this.#authenticate().finally(() => {
            this.#refreshLock = null;
        });
        return this.#refreshLock;
    }

    /** Invalida sessão local (force re-login na próxima chamada). */
    invalidate() {
        this.#accessToken   = null;
        this.#tokenExpiry   = 0;
        this.#cookiesLoaded = false;
        this.#lastLogin     = 0;
        this.#deleteCookieFile();
        console.log('[GoogleAuth] Sessão invalidada.');
    }

    /** Retorna e-mail configurado. */
    getEmail() { return this.#email; }

    /** Retorna true se há token em cache válido. */
    isAuthenticated() {
        return !!this.#accessToken && Date.now() < this.#tokenExpiry;
    }

    // ── Autenticação principal ───────────────────────────────────────────────

    async #authenticate() {
        console.log('[GoogleAuth] Iniciando autenticação...');
        const browser = await this.#getBrowser();
        const page    = await browser.newPage();

        // Configura viewport e user-agent realista
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent(
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Intercepta requisições: captura token de Classroom + bloqueia recursos desnecessários
        let capturedToken = null;
        await page.setRequestInterception(true);
        page.on('request', req => {
            // Captura o Bearer token nas chamadas ao Classroom API
            if (req.url().includes(CLASSROOM_API)) {
                const auth = req.headers()['authorization'];
                if (auth && auth.startsWith('Bearer ') && !capturedToken) {
                    capturedToken = auth.slice(7);
                    console.log('[GoogleAuth] Token de primeira parte interceptado.');
                }
            }
            // Bloqueia recursos desnecessários para agilizar carregamento
            const type = req.resourceType();
            if (['image', 'font', 'media'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        try {
            // Carrega cookies salvos para reutilizar sessão existente
            await this.#loadCookies(page);

            // Navega para o Classroom
            await page.goto(CLASSROOM_ORIGIN, {
                waitUntil: 'networkidle2',
                timeout: 45_000,
            });

            const currentUrl = page.url();
            const needsLogin = currentUrl.includes('accounts.google.com')
                            || currentUrl.includes('ServiceLogin')
                            || currentUrl.includes('signin');

            if (needsLogin) {
                console.log('[GoogleAuth] Sessão expirada, fazendo login...');
                await this.#performLogin(page);

                // Após login, navega para classroom para disparar chamadas à API
                await page.goto(CLASSROOM_ORIGIN, {
                    waitUntil: 'networkidle2',
                    timeout: 45_000,
                });
            }

            // Aguarda até 8s para o token aparecer nas interceptações de request
            if (!capturedToken) {
                capturedToken = await this.#pollToken(() => capturedToken, page);
            }

            if (!capturedToken) {
                // Fallback: tenta extrair token via JavaScript da página
                capturedToken = await this.#extractTokenFromPage(page);
            }

            if (!capturedToken) {
                throw new Error(
                    'Não foi possível obter o token do Google Classroom. ' +
                    'Verifique e-mail, senha e se a conta tem acesso ao Classroom.'
                );
            }

            this.#accessToken = capturedToken;
            this.#tokenExpiry = Date.now() + TOKEN_TTL_MS;
            this.#lastLogin   = Date.now();

            await this.#saveCookies(page);

            console.log('[GoogleAuth] Token obtido com sucesso. Expira em ~45min.');
            return this.#accessToken;

        } finally {
            await page.close();
        }
    }

    // ── Login no Google ──────────────────────────────────────────────────────

    async #performLogin(page) {
        // Garante que estamos na página de login do Google
        if (!page.url().includes('accounts.google.com')) {
            await page.goto('https://accounts.google.com/signin/v2/identifier', {
                waitUntil: 'networkidle2',
                timeout: 30_000,
            });
        }

        // ── Passo 1: E-mail ──
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 15_000 });
        await this.#slowType(page, 'input[type="email"]', this.#email);
        await this.#clickNext(page, '#identifierNext');
        console.log('[GoogleAuth] E-mail preenchido.');

        // ── Passo 2: Senha ──
        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15_000 });
        await this.#slowType(page, 'input[type="password"]', this.#password);
        await this.#clickNext(page, '#passwordNext');
        console.log('[GoogleAuth] Senha preenchida.');

        // Aguarda navegação pós-login
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 });
        } catch {
            // Alguns fluxos não navegam imediatamente
        }

        // Lida com telas intermediárias comuns do Google
        await this.#handlePostLoginScreens(page);
    }

    /** Trata telas de "confirmar identidade", "dispositivo novo", etc. */
    async #handlePostLoginScreens(page) {
        const url = page.url();

        // "Escolher conta"
        if (url.includes('accountchooser') || url.includes('authuser')) {
            const emailLink = await page.$(`[data-email="${this.#email}"]`);
            if (emailLink) {
                await emailLink.click();
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => {});
            }
        }

        // "Verificação de segurança" / "Proteger conta" — tenta pular
        const skipSelectors = [
            'button[jsname="V67aGc"]',
            '[data-action="skip"]',
            'button[jsname="e5bADc"]',
        ];
        for (const sel of skipSelectors) {
            try {
                const el = await page.$(sel);
                if (el) {
                    await el.click();
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10_000 }).catch(() => {});
                    break;
                }
            } catch {}
        }

        // "Continuar para o app"
        try {
            const continueBtn = await page.$('button[jsname="LgbsSe"]');
            if (continueBtn) await continueBtn.click();
        } catch {}
    }

    // ── Polling: aguarda token ser capturado pelo interceptador já registrado ──

    async #pollToken(getToken, page) {
        // Leve scroll para forçar o classroom a disparar requisições à API
        await page.evaluate(() => {
            window.scrollTo(0, 100);
            setTimeout(() => window.scrollTo(0, 0), 300);
        }).catch(() => {});

        return new Promise(resolve => {
            const start    = Date.now();
            const MAX_WAIT = 8_000;

            const interval = setInterval(() => {
                const token = getToken();
                if (token) {
                    clearInterval(interval);
                    resolve(token);
                    return;
                }
                if (Date.now() - start > MAX_WAIT) {
                    clearInterval(interval);
                    resolve(null);
                }
            }, 300);
        });
    }

    // ── Extração de token via JavaScript ────────────────────────────────────

    async #extractTokenFromPage(page) {
        return page.evaluate(() => {
            // Método 1: gapi.auth2
            try {
                if (window.gapi?.auth2) {
                    const inst = window.gapi.auth2.getAuthInstance();
                    if (inst) {
                        const resp = inst.currentUser.get().getAuthResponse(true);
                        if (resp?.access_token) return resp.access_token;
                    }
                }
            } catch {}

            // Método 2: google.accounts.oauth2 (Identity Services)
            try {
                const token = window.__googleApiClient?.token;
                if (token) return token;
            } catch {}

            // Método 3: sessionStorage
            try {
                for (let i = 0; i < sessionStorage.length; i++) {
                    const v = sessionStorage.getItem(sessionStorage.key(i));
                    if (v && v.startsWith('ya29.')) return v;
                }
            } catch {}

            return null;
        });
    }

    // ── Cookies ──────────────────────────────────────────────────────────────

    async #loadCookies(page) {
        if (!this.#cookieFile || !fs.existsSync(this.#cookieFile)) return;
        try {
            const raw     = fs.readFileSync(this.#cookieFile, 'utf8');
            const { cookies, savedAt } = JSON.parse(raw);
            if (Date.now() - savedAt > COOKIE_TTL_MS) {
                console.log('[GoogleAuth] Cookies expirados, re-login necessário.');
                this.#deleteCookieFile();
                return;
            }
            await page.setCookie(...cookies);
            this.#cookiesLoaded = true;
            console.log(`[GoogleAuth] ${cookies.length} cookies carregados da sessão anterior.`);
        } catch (e) {
            console.warn('[GoogleAuth] Falha ao carregar cookies:', e.message);
        }
    }

    async #saveCookies(page) {
        if (!this.#cookieFile) return;
        try {
            const cookies = await page.cookies();
            const data = JSON.stringify({ cookies, savedAt: Date.now() }, null, 2);
            fs.mkdirSync(path.dirname(this.#cookieFile), { recursive: true });
            fs.writeFileSync(this.#cookieFile, data, 'utf8');
            console.log(`[GoogleAuth] ${cookies.length} cookies salvos.`);
        } catch (e) {
            console.warn('[GoogleAuth] Falha ao salvar cookies:', e.message);
        }
    }

    #deleteCookieFile() {
        try {
            if (this.#cookieFile && fs.existsSync(this.#cookieFile)) {
                fs.unlinkSync(this.#cookieFile);
            }
        } catch {}
    }

    // ── Utilitários ──────────────────────────────────────────────────────────

    /** Digita com delay humano para evitar detecção de bot. */
    async #slowType(page, selector, text) {
        await page.click(selector);
        await page.keyboard.type(text, { delay: 40 + Math.random() * 30 });
    }

    /** Clica no botão "Próxima" e aguarda navegação. */
    async #clickNext(page, selector) {
        const btn = await page.$(selector);
        if (btn) {
            await btn.click();
        } else {
            await page.keyboard.press('Enter');
        }
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20_000 }).catch(() => {});
    }
}
