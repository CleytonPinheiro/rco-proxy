import express from "express";
import axios from "axios";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

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
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9"
		},
		maxRedirects: 5,
		validateStatus: () => true
	});

	const cookies = response.headers["set-cookie"];
	if (!cookies) throw new Error("Nenhum cookie retornado");

	const csAuthCookie = cookies.find(c => c.startsWith("CS-AUTH="));
	if (!csAuthCookie) throw new Error("Cookie CS-AUTH não encontrado");

	return csAuthCookie.split(";")[0];
}

async function performLogin(sessionCookie) {
	const { cpf, senha } = userCredentials;
	if (!cpf || !senha) throw new Error("Credenciais não configuradas");

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
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
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

app.get("/api/status", (req, res) => {
	res.json({
		credenciaisConfiguradas: !!(userCredentials.cpf && userCredentials.senha),
		tokenEmCache: !!cachedToken,
		tokenExpiracao: tokenExpiration ? new Date(tokenExpiration).toISOString() : null
	});
});

app.post("/api/configurar", async (req, res) => {
	const { cpf, senha } = req.body;
	if (!cpf || !senha) {
		return res.status(400).json({ erro: "CPF e Senha são obrigatórios" });
	}

	userCredentials.cpf = cpf;
	userCredentials.senha = senha;

	try {
		await getValidToken(true);
		res.json({
			sucesso: true,
			mensagem: "Credenciais salvas e token gerado com sucesso",
			expiracao: tokenExpiration ? new Date(tokenExpiration).toISOString() : null
		});
	} catch (error) {
		res.status(500).json({ sucesso: false, erro: error.message });
	}
});

app.get("/api/acessos", async (req, res) => {
	try {
		let authToken = await getValidToken();
		let response = await axios.get(
			"https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar",
			{
				headers: { consumerId: "RCDIGWEB", Authorization: `Bearer ${authToken}` },
				timeout: 30000,
				validateStatus: () => true,
			}
		);

		if (response.status === 401 || response.status === 403) {
			authToken = await getValidToken(true);
			response = await axios.get(
				"https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar",
				{
					headers: { consumerId: "RCDIGWEB", Authorization: `Bearer ${authToken}` },
					timeout: 30000,
				}
			);
		}

		res.json(response.data);
	} catch (erro) {
		res.status(500).json({ erro: "Erro ao consultar a API", detalhes: erro.message });
	}
});

app.get("*", (req, res) => {
	res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

const PORT = 5000;
app.listen(PORT, "0.0.0.0", () => {
	console.log(`Servidor rodando na porta ${PORT}`);
	console.log(`Frontend: http://localhost:${PORT}`);
	console.log(`API: http://localhost:${PORT}/api`);
});
