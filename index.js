import express from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variáveis em memória (em produção, usar banco de dados ou criptografia)
let userCredentials = {
	cpf: process.env.RCO_CPF || "",
	senha: process.env.RCO_SENHA || ""
};

let cachedToken = null;
let tokenExpiration = null;

const AUTH_CONFIG = {
	loginPageUrl: "https://auth-cs.identidadedigital.pr.gov.br/centralautenticacao/login.html",
	loginApiUrl: "https://auth-cs.identidadedigital.pr.gov.br/centralautenticacao/api/v1/authorize/jwt",
	clientId: "f340f1b1f65b6df5b5e3f94d95b11daf",
	redirectUri: "https://rco.paas.pr.gov.br",
	scope: "emgpr.mobile emgpr.v1.ocorrencia.post"
};

async function getSessionCookie() {
	try {
		const response = await axios.get(AUTH_CONFIG.loginPageUrl, {
			params: {
				response_type: "token",
				client_id: AUTH_CONFIG.clientId,
				redirect_uri: AUTH_CONFIG.redirectUri,
				scope: AUTH_CONFIG.scope,
				tokenFormat: "jwt",
				captcha: "false"
			},
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
				"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
			},
			maxRedirects: 5,
			validateStatus: () => true
		});

		const cookies = response.headers["set-cookie"];
		if (!cookies || cookies.length === 0) {
			throw new Error("Nenhum cookie retornado pela página de login");
		}

		const csAuthCookie = cookies.find(c => c.startsWith("CS-AUTH="));
		if (!csAuthCookie) {
			throw new Error("Cookie CS-AUTH não encontrado na resposta");
		}

		const cookieValue = csAuthCookie.split(";")[0];
		return cookieValue;
	} catch (error) {
		console.error("Erro ao obter cookie de sessão:", error.message);
		throw error;
	}
}

async function performLogin(sessionCookie) {
	try {
		const { cpf, senha } = userCredentials;

		if (!cpf || !senha) {
			throw new Error("Credenciais não configuradas no painel.");
		}

		const formData = new URLSearchParams({
			paginaLogin: "",
			provedorselecionado: "tabCentral",
			origemRequisicao: "",
			valorCPF: "",
			urlLogo: encodeURIComponent("https://www.registrodeclasse.seed.pr.gov.br/rcdig/images/logo_sistema.png"),
			loginPadrao: "btnCentral",
			modulosDeAutenticacao: "btnSentinela,btnSms,btnCpf,btnCentral",
			labelCentral: "CPF,Login Sentinela",
			moduloAtual: "",
			dataAcesso: "2053",
			exibirLinkAutoCadastro: "true",
			exibirLinkAutoCadastroCertificado: "false",
			exibirLinkRecuperarSenha: "true",
			exibirAviso: "true",
			formaAutenticacao: "btnCpf",
			response_type: "token",
			client_id: AUTH_CONFIG.clientId,
			redirect_uri: encodeURIComponent(AUTH_CONFIG.redirectUri),
			scope: encodeURIComponent(AUTH_CONFIG.scope),
			state: "null",
			mensagem: "",
			dnsCidadao: "https://cidadao-cs.identidadedigital.pr.gov.br/centralcidadao",
			provedores: "",
			provedor: "tabCentral",
			tokenFormat: "jwt",
			code_challenge: "",
			code_challenge_method: "",
			captcha: "false",
			codCaptcha: "",
			attribute: cpf,
			attribute_central: cpf,
			password: senha,
			captchaCentral: "",
			attribute_Sms: "",
			celular: "",
			captchaSms: "",
			codigoSeguranca: "",
			attribute_token: "",
			codigoOTP: "",
			attribute_expresso: "",
			password_expresso: "",
			captchaExpresso: "",
			attribute_emailToken: "",
			email: "",
			captchaEmailToken: "",
			codigoSegurancaEmail: ""
		});

		const response = await axios.post(AUTH_CONFIG.loginApiUrl, formData.toString(), {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"Cookie": sessionCookie,
				"Origin": "https://auth-cs.identidadedigital.pr.gov.br",
				"Referer": `${AUTH_CONFIG.loginPageUrl}?response_type=token&client_id=${AUTH_CONFIG.clientId}&redirect_uri=${encodeURIComponent(AUTH_CONFIG.redirectUri)}&scope=${encodeURIComponent(AUTH_CONFIG.scope)}&tokenFormat=jwt`,
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
				"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
			},
			maxRedirects: 0,
			validateStatus: () => true
		});

		if (response.status === 302 || response.status === 301) {
			const redirectUrl = response.headers["location"];
			if (redirectUrl && redirectUrl.includes("access_token=")) {
				const tokenMatch = redirectUrl.match(/access_token=([^&]+)/);
				if (tokenMatch && tokenMatch[1]) {
					return decodeURIComponent(tokenMatch[1]);
				}
			}
		}
		throw new Error(`Falha no login. Status: ${response.status}`);
	} catch (error) {
		console.error("Erro ao fazer login:", error.message);
		throw error;
	}
}

function decodeJwtExpiration(token) {
	try {
		const parts = token.split(".");
		const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
		return payload.exp ? payload.exp * 1000 : null;
	} catch (e) { return null; }
}

async function getValidToken(forceRefresh = false) {
	if (!forceRefresh && cachedToken && tokenExpiration && tokenExpiration > Date.now() + 300000) {
		return cachedToken;
	}
	const sessionCookie = await getSessionCookie();
	const token = await performLogin(sessionCookie);
	cachedToken = token.replace(/[^a-zA-Z0-9._-]/g, "");
	tokenExpiration = decodeJwtExpiration(cachedToken) || (Date.now() + 3600000);
	return cachedToken;
}

// Rota principal com formulário
app.get("/", (req, res) => {
	res.send(`
		<!DOCTYPE html>
		<html lang="pt-br">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Configuração Proxy RCO</title>
			<style>
				body { font-family: sans-serif; max-width: 500px; margin: 40px auto; padding: 20px; line-height: 1.6; }
				.card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
				input { display: block; width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
				button { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; width: 100%; font-size: 16px; }
				button:hover { background: #0056b3; }
				.status { margin-top: 20px; padding: 10px; border-radius: 4px; }
				.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
				.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
			</style>
		</head>
		<body>
			<div class="card">
				<h2>Configuração RCO Digital</h2>
				<p>Insira suas credenciais para que o servidor possa automatizar a renovação do token.</p>
				<form action="/api/configurar" method="POST">
					<label>CPF (apenas números)</label>
					<input type="text" name="cpf" value="${userCredentials.cpf}" required>
					<label>Senha</label>
					<input type="password" name="senha" required>
					<button type="submit">Salvar e Conectar</button>
				</form>
				<div id="status" class="status" style="display:none"></div>
			</div>
			<div style="margin-top: 20px;">
				<a href="/api/acessos">Testar Endpoint de Dados</a>
			</div>
		</body>
		</html>
	`);
});

// Endpoint para configurar credenciais via form
app.post("/api/configurar", async (req, res) => {
	const { cpf, senha } = req.body;
	if (!cpf || !senha) return res.status(400).send("CPF e Senha são obrigatórios");
	
	userCredentials.cpf = cpf;
	userCredentials.senha = senha;
	
	try {
		await getValidToken(true);
		res.send(`
			<div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
				<h2 style="color: #28a745;">Configuração Salva com Sucesso!</h2>
				<p>O token foi gerado e as credenciais estão prontas para renovação automática.</p>
				<a href="/">Voltar</a> | <a href="/api/acessos">Ver Acessos</a>
			</div>
		`);
	} catch (error) {
		res.status(500).send(`
			<div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
				<h2 style="color: #dc3545;">Erro na Autenticação</h2>
				<p>${error.message}</p>
				<a href="/">Tentar Novamente</a>
			</div>
		`);
	}
});

app.get("/api/acessos", async (req, res) => {
	try {
		const authToken = await getValidToken();
		const response = await axios.get(
			"https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar",
			{
				headers: { consumerId: "RCDIGWEB", Authorization: `Bearer ${authToken}` },
				timeout: 30000,
				validateStatus: () => true,
			},
		);

		if (response.status === 401 || response.status === 403) {
			const newToken = await getValidToken(true);
			const retry = await axios.get(
				"https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar",
				{
					headers: { consumerId: "RCDIGWEB", Authorization: `Bearer ${newToken}` },
					timeout: 30000,
				},
			);
			return res.json(retry.data);
		}
		res.json(response.data);
	} catch (erro) {
		res.status(500).json({ erro: "Erro ao consultar a API", detalhes: erro.message });
	}
});

app.listen(5000, "0.0.0.0", () => {
	console.log("Servidor Express rodando na porta 5000");
});
