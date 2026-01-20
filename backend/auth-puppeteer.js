import puppeteer from "puppeteer";
import { execSync } from "child_process";
import fs from "fs";

function getChromiumPath() {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && fs.existsSync(envPath)) {
        return envPath;
    }
    
    try {
        const systemPath = execSync("which chromium", { encoding: "utf-8" }).trim();
        if (systemPath && fs.existsSync(systemPath)) {
            return systemPath;
        }
    } catch {}
    
    return null;
}

const AUTH_CONFIG = {
    loginPageUrl: process.env.AUTH_LOGIN_PAGE_URL || "https://auth-cs.identidadedigital.pr.gov.br/centralautenticacao/login.html",
    clientId: process.env.AUTH_CLIENT_ID || "f340f1b1f65b6df5b5e3f94d95b11daf",
    redirectUri: process.env.AUTH_REDIRECT_URI || "https://rco.paas.pr.gov.br",
    scope: process.env.AUTH_SCOPE || "emgpr.mobile emgpr.v1.ocorrencia.post"
};

function extractTokenFromUrl(url) {
    if (url && url.includes("access_token=")) {
        const tokenMatch = url.match(/access_token=([^&]+)/);
        if (tokenMatch && tokenMatch[1]) {
            return decodeURIComponent(tokenMatch[1]);
        }
    }
    return null;
}

export async function loginWithPuppeteer(cpf, senha) {
    if (!cpf || !senha) {
        throw new Error("CPF e senha são obrigatórios");
    }

    const chromiumPath = getChromiumPath();
    if (!chromiumPath) {
        throw new Error("Chromium não encontrado. Configure PUPPETEER_EXECUTABLE_PATH ou instale chromium.");
    }

    const loginUrl = `${AUTH_CONFIG.loginPageUrl}?response_type=token&client_id=${AUTH_CONFIG.clientId}&redirect_uri=${encodeURIComponent(AUTH_CONFIG.redirectUri)}&scope=${encodeURIComponent(AUTH_CONFIG.scope)}&tokenFormat=jwt&captcha=false`;

    console.log("Iniciando navegador para autenticação...");
    console.log("Usando Chromium em:", chromiumPath);
    
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: chromiumPath,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
            "--single-process"
        ]
    });

    try {
        const page = await browser.newPage();
        
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        
        await page.setExtraHTTPHeaders({
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        });

        console.log("Navegando para página de login...");
        await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 60000 });

        console.log("Aguardando formulário de login...");
        await page.waitForSelector("#attribute", { timeout: 30000 });

        console.log("Preenchendo credenciais...");
        await page.type("#attribute", cpf, { delay: 30 });
        await page.type("#password", senha, { delay: 30 });

        console.log("Submetendo formulário...");

        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
                page.click('button[type="submit"], input[type="submit"], #btnEntrar, .btn-primary')
            ]);
        } catch (navError) {
            console.log("Navegação após submit:", navError.message);
        }

        const currentUrl = page.url();
        console.log("URL após submit:", currentUrl);
        
        let token = extractTokenFromUrl(currentUrl);
        if (token) {
            console.log("Token obtido com sucesso!");
            return token;
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const urlAfterWait = page.url();
        token = extractTokenFromUrl(urlAfterWait);
        if (token) {
            console.log("Token obtido após aguardar!");
            return token;
        }

        const errorSelectors = [".alert-danger", ".erro", ".mensagem-erro", "#mensagemErro", ".text-danger"];
        for (const selector of errorSelectors) {
            try {
                const errorMsg = await page.$eval(selector, el => el.textContent.trim());
                if (errorMsg && errorMsg.length > 0) {
                    throw new Error(`Erro de login: ${errorMsg}`);
                }
            } catch (e) {
                if (e.message.startsWith("Erro de login:")) throw e;
            }
        }

        throw new Error("Falha na autenticação. Verifique CPF e senha.");

    } catch (error) {
        console.error("Erro na autenticação Puppeteer:", error.message);
        
        try {
            const pages = await browser.pages();
            if (pages.length > 0) {
                const currentUrl = pages[0].url();
                const token = extractTokenFromUrl(currentUrl);
                if (token) {
                    console.log("Token recuperado da URL final");
                    return token;
                }
            }
        } catch (e) {}
        
        throw error;
    } finally {
        await browser.close();
        console.log("Navegador fechado");
    }
}

export function decodeJwtExpiration(token) {
    try {
        const parts = token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        return payload.exp ? payload.exp * 1000 : null;
    } catch (e) {
        return null;
    }
}
