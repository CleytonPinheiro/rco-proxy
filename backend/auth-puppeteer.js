import puppeteer from "puppeteer";
import { execSync } from "child_process";
import fs from "fs";

function getChromiumPath() {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;
    try {
        const systemPath = execSync("which chromium", { encoding: "utf-8" }).trim();
        if (systemPath && fs.existsSync(systemPath)) return systemPath;
    } catch {}
    return null;
}

const AUTH_CONFIG = {
    loginPageUrl: process.env.AUTH_LOGIN_PAGE_URL || "https://auth-cs.identidadedigital.pr.gov.br/centralautenticacao/login.html",
    clientId: process.env.AUTH_CLIENT_ID || "f340f1b1f65b6df5b5e3f94d95b11daf",
    redirectUri: process.env.AUTH_REDIRECT_URI || "https://rco.paas.pr.gov.br",
    scope: process.env.AUTH_SCOPE || "emgpr.mobile emgpr.v1.ocorrencia.post"
};

// Domínios bloqueados: analytics, trackers, fontes externas
const BLOCKED_DOMAINS = [
    "google-analytics.com", "googletagmanager.com", "doubleclick.net",
    "facebook.com", "hotjar.com", "mixpanel.com", "segment.com",
    "fonts.googleapis.com", "fonts.gstatic.com"
];

// Tipos de recurso que não precisam carregar
const BLOCKED_RESOURCE_TYPES = ["image", "media", "font", "stylesheet"];

// ── Browser reutilizável ──────────────────────────────────────────────────────
let browserInstance = null;
let browserLaunchTime = null;
const BROWSER_MAX_AGE_MS = 30 * 60 * 1000; // reciclar após 30 minutos

async function getBrowser() {
    const chromiumPath = getChromiumPath();
    if (!chromiumPath) {
        throw new Error("Chromium não encontrado. Configure PUPPETEER_EXECUTABLE_PATH ou instale chromium.");
    }

    const isStale = browserLaunchTime && (Date.now() - browserLaunchTime > BROWSER_MAX_AGE_MS);

    if (browserInstance && isStale) {
        console.log("Reciclando instância do browser (tempo de vida atingido)...");
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
    }

    if (browserInstance) {
        try {
            await browserInstance.version();
            return browserInstance;
        } catch {
            console.log("Browser caiu, reiniciando...");
            browserInstance = null;
        }
    }

    console.log("Iniciando nova instância do browser...");
    console.log("Usando Chromium em:", chromiumPath);

    browserInstance = await puppeteer.launch({
        headless: true,
        executablePath: chromiumPath,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor,TranslateUI,BlinkGenPropertyTrees",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-default-apps",
            "--no-first-run",
            "--mute-audio",
            "--hide-scrollbars",
            "--disable-notifications",
            "--single-process",
            "--memory-pressure-off",
            "--js-flags=--max-old-space-size=256"
        ]
    });

    browserLaunchTime = Date.now();
    console.log("Browser iniciado e reutilizável.");
    return browserInstance;
}

// ── Extração de token ─────────────────────────────────────────────────────────
function extractTokenFromUrl(url) {
    if (url && url.includes("access_token=")) {
        const match = url.match(/access_token=([^&]+)/);
        if (match?.[1]) return decodeURIComponent(match[1]);
    }
    return null;
}

// ── Login principal ───────────────────────────────────────────────────────────
export async function loginWithPuppeteer(cpf, senha) {
    if (!cpf || !senha) throw new Error("CPF e senha são obrigatórios");

    const loginUrl = `${AUTH_CONFIG.loginPageUrl}?response_type=token&client_id=${AUTH_CONFIG.clientId}&redirect_uri=${encodeURIComponent(AUTH_CONFIG.redirectUri)}&scope=${encodeURIComponent(AUTH_CONFIG.scope)}&tokenFormat=jwt&captcha=false`;

    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        // Limpar cookies da sessão anterior para evitar redirecionamentos indevidos
        const client = await page.createCDPSession();
        await client.send('Network.clearBrowserCookies');
        await client.send('Network.clearBrowserCache');

        // Otimização: Bloquear recursos desnecessários
        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const type = req.resourceType();
            const url = req.url();
            const blocked =
                BLOCKED_RESOURCE_TYPES.includes(type) ||
                BLOCKED_DOMAINS.some((d) => url.includes(d));
            if (blocked) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9" });
        await page.setViewport({ width: 800, height: 600 });

        console.log("Navegando para página de login...");
        await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 60000 });

        // Verificar se o browser já está logado (sessão ativa → redireciona para /home)
        const urlAposNavegacao = await page.evaluate(() => window.location.href);
        if (urlAposNavegacao.includes("rco.paas.pr.gov.br") && !urlAposNavegacao.includes("identidadedigital")) {
            console.log("Browser já está logado. Extraindo token da sessão existente...");

            // Tentar pegar token do localStorage da sessão atual
            const lsTokenExistente = await page.evaluate(() => {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key);
                    if (value && value.startsWith("eyJ") && value.length > 100) return { key, value };
                }
                return null;
            });

            if (lsTokenExistente) {
                console.log(`Token de sessão obtido do localStorage (chave: ${lsTokenExistente.key})`);
                return lsTokenExistente.value;
            }

            // Sessão ativa mas token não encontrado → limpar e tentar login limpo
            console.log("Token não encontrado na sessão. Limpando cookies para fazer login novamente...");
            const clientClear = await page.createCDPSession();
            await clientClear.send('Network.clearBrowserCookies');
            await clientClear.send('Network.clearBrowserCache');
            await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
            await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 60000 });
        }

        console.log("Aguardando formulário de login...");

        // Tentar múltiplos seletores possíveis para o campo CPF
        const seletoresCpf = ["#attribute", "input[name='attribute']", "input[type='text']", "#cpf", "input[name='cpf']"];
        let seletorEncontrado = null;
        for (const seletor of seletoresCpf) {
            try {
                await page.waitForSelector(seletor, { timeout: 8000 });
                seletorEncontrado = seletor;
                console.log(`Formulário encontrado com seletor: ${seletor}`);
                break;
            } catch {
                console.log(`Seletor não encontrado: ${seletor}`);
            }
        }

        if (!seletorEncontrado) {
            const urlAtual = await page.evaluate(() => window.location.href);
            console.error("Nenhum campo de CPF encontrado. URL atual:", urlAtual);
            throw new Error("Formulário de login não encontrado na página");
        }

        console.log("Preenchendo credenciais...");
        await page.type(seletorEncontrado, cpf, { delay: 20 });
        await page.type("#password", senha, { delay: 20 });

        console.log("Submetendo formulário...");
        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
                page.click('button[type="submit"], input[type="submit"], #btnEntrar, .btn-primary')
            ]);
        } catch (navError) {
            console.log("Navegação após submit:", navError.message);
        }

        // Tentar token na URL
        let token = extractTokenFromUrl(page.url());
        if (token) { console.log("Token obtido da URL!"); return token; }

        // Tentar token no hash (OAuth implicit flow)
        const hashUrl = await page.evaluate(() => window.location.href);
        token = extractTokenFromUrl(hashUrl);
        if (token) { console.log("Token obtido do hash da URL!"); return token; }

        await new Promise((r) => setTimeout(r, 2000));

        // Tentar após aguardar
        const urlAfterWait = await page.evaluate(() => window.location.href);
        token = extractTokenFromUrl(urlAfterWait);
        if (token) { console.log("Token obtido após aguardar!"); return token; }

        // Tentar localStorage
        const lsToken = await page.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const value = localStorage.getItem(key);
                if (value && value.length > 100 && value.includes(".")) return { key, value };
            }
            return null;
        });
        if (lsToken) {
            console.log(`Token obtido do localStorage (chave: ${lsToken.key})`);
            return lsToken.value;
        }

        // Tentar sessionStorage
        const ssToken = await page.evaluate(() => {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                const value = sessionStorage.getItem(key);
                if (value && value.length > 100 && value.includes(".")) return { key, value };
            }
            return null;
        });
        if (ssToken) {
            console.log(`Token obtido do sessionStorage (chave: ${ssToken.key})`);
            return ssToken.value;
        }

        // Tentar cookies
        const cookies = await page.cookies();
        const tokenCookie = cookies.find((c) =>
            c.name.toLowerCase().includes("token") ||
            c.name.toLowerCase().includes("auth") ||
            c.name.toLowerCase().includes("jwt")
        );
        if (tokenCookie) {
            console.log(`Token obtido de cookie: ${tokenCookie.name}`);
            return tokenCookie.value;
        }

        // Verificar mensagem de erro na página
        const finalUrl = await page.evaluate(() => window.location.href);
        if (finalUrl.includes("mensagem=")) {
            const msgMatch = finalUrl.match(/mensagem=([^&]+)/);
            if (msgMatch) throw new Error(`Erro de login: ${decodeURIComponent(msgMatch[1])}`);
        }

        throw new Error("Falha na autenticação. Verifique CPF e senha.");

    } finally {
        await page.close();
        console.log("Página fechada (browser mantido em memória).");
    }
}

// ── Expor browser para uso externo (ex: intercepção de rede) ─────────────────
export { getBrowser };

// ── Decodificar expiração do JWT ──────────────────────────────────────────────
export function decodeJwtExpiration(token) {
    try {
        const parts = token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        return payload.exp ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

// ── Fechar browser ao encerrar o processo ────────────────────────────────────
process.on("exit", async () => {
    if (browserInstance) {
        try { await browserInstance.close(); } catch {}
    }
});
