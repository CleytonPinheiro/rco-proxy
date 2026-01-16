import puppeteer from "puppeteer";

const AUTH_CONFIG = {
    loginPageUrl: "https://auth-cs.identidadedigital.pr.gov.br/centralautenticacao/login.html",
    clientId: "f340f1b1f65b6df5b5e3f94d95b11daf",
    redirectUri: "https://rco.paas.pr.gov.br",
    scope: "emgpr.mobile emgpr.v1.ocorrencia.post"
};

export async function loginWithPuppeteer(cpf, senha) {
    if (!cpf || !senha) {
        throw new Error("CPF e senha são obrigatórios");
    }

    const loginUrl = `${AUTH_CONFIG.loginPageUrl}?response_type=token&client_id=${AUTH_CONFIG.clientId}&redirect_uri=${encodeURIComponent(AUTH_CONFIG.redirectUri)}&scope=${encodeURIComponent(AUTH_CONFIG.scope)}&tokenFormat=jwt&captcha=false`;

    console.log("Iniciando navegador para autenticação...");
    
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor"
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
        await page.type("#attribute", cpf, { delay: 50 });
        await page.type("#password", senha, { delay: 50 });

        console.log("Submetendo formulário...");
        
        const tokenPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Timeout aguardando redirecionamento com token"));
            }, 30000);

            page.on("response", async (response) => {
                const url = response.url();
                if (url.includes("access_token=")) {
                    clearTimeout(timeout);
                    const tokenMatch = url.match(/access_token=([^&]+)/);
                    if (tokenMatch && tokenMatch[1]) {
                        resolve(decodeURIComponent(tokenMatch[1]));
                    }
                }
            });

            page.on("framenavigated", async (frame) => {
                const url = frame.url();
                if (url.includes("access_token=")) {
                    clearTimeout(timeout);
                    const tokenMatch = url.match(/access_token=([^&]+)/);
                    if (tokenMatch && tokenMatch[1]) {
                        resolve(decodeURIComponent(tokenMatch[1]));
                    }
                }
            });
        });

        await Promise.all([
            page.click('button[type="submit"], input[type="submit"], #btnEntrar, .btn-primary'),
            tokenPromise
        ]).then(async ([_, token]) => {
            return token;
        });

        const token = await tokenPromise;
        console.log("Token obtido com sucesso!");
        return token;

    } catch (error) {
        console.error("Erro na autenticação Puppeteer:", error.message);
        
        try {
            const page = (await browser.pages())[0];
            const currentUrl = page.url();
            if (currentUrl.includes("access_token=")) {
                const tokenMatch = currentUrl.match(/access_token=([^&]+)/);
                if (tokenMatch && tokenMatch[1]) {
                    console.log("Token recuperado da URL final");
                    return decodeURIComponent(tokenMatch[1]);
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
