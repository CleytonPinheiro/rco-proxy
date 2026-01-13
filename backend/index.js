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
	loginApiUrl: "https://auth-cs.identidadedigital.pr.gov.br/centralautenticacao/api/v1/authorize/jwt",
	clientId: "f340f1b1f65b6df5b5e3f94d95b11daf",
	redirectUri: "https://rco.paas.pr.gov.br",
	scope: "emgpr.mobile emgpr.v1.ocorrencia.post"
};

async function performLogin() {
	const { cpf, senha } = userCredentials;
	if (!cpf || !senha) throw new Error("Credenciais não configuradas. Preencha CPF e senha.");

	const formData = new URLSearchParams({
		response_type: "token",
		client_id: AUTH_CONFIG.clientId,
		redirect_uri: AUTH_CONFIG.redirectUri,
		scope: AUTH_CONFIG.scope,
		tokenFormat: "jwt",
		attribute: cpf,
		attribute_central: cpf,
		password: senha,
		formaAutenticacao: "btnCpf",
		provedor: "tabCentral",
		provedorselecionado: "tabCentral",
		loginPadrao: "btnCentral",
		captcha: "false"
	});

	console.log("Tentando login com CPF:", cpf.substring(0, 3) + "***");

	const response = await axios.post(AUTH_CONFIG.loginApiUrl, formData.toString(), {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Origin": "https://auth-cs.identidadedigital.pr.gov.br",
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
			"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
		},
		maxRedirects: 0,
		validateStatus: () => true
	});

	console.log("Resposta do login - Status:", response.status);

	if (response.status === 302 || response.status === 301) {
		const redirectUrl = response.headers["location"];
		console.log("Redirect URL:", redirectUrl ? redirectUrl.substring(0, 100) + "..." : "null");

		if (redirectUrl) {
			if (redirectUrl.includes("access_token=")) {
				const tokenMatch = redirectUrl.match(/access_token=([^&]+)/);
				if (tokenMatch && tokenMatch[1]) {
					console.log("Token obtido com sucesso!");
					return decodeURIComponent(tokenMatch[1]);
				}
			}

			if (redirectUrl.includes("mensagem=")) {
				const mensagemMatch = redirectUrl.match(/mensagem=([^&]+)/);
				if (mensagemMatch && mensagemMatch[1]) {
					const mensagem = decodeURIComponent(mensagemMatch[1].replace(/\+/g, " "));
					throw new Error(`Erro de autenticação: ${mensagem}`);
				}
			}
		}
	}

	throw new Error(`Falha no login. Status: ${response.status}. Verifique suas credenciais.`);
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
		console.log("Usando token em cache (válido por mais", Math.round((tokenExpiration - Date.now()) / 60000), "minutos)");
		return cachedToken;
	}

	console.log("Obtendo novo token...");
	const token = await performLogin();
	cachedToken = token.replace(/[^a-zA-Z0-9._-]/g, "");
	tokenExpiration = decodeJwtExpiration(cachedToken) || (Date.now() + 3600000);
	
	const expiresInMinutes = Math.round((tokenExpiration - Date.now()) / 60000);
	console.log(`Novo token obtido. Expira em ${expiresInMinutes} minutos.`);
	
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

	userCredentials.cpf = cpf.replace(/\D/g, "");
	userCredentials.senha = senha;

	try {
		await getValidToken(true);
		res.json({
			sucesso: true,
			mensagem: "Credenciais salvas e token gerado com sucesso",
			expiracao: tokenExpiration ? new Date(tokenExpiration).toISOString() : null
		});
	} catch (error) {
		console.error("Erro ao configurar:", error.message);
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
			console.log("Token expirado, renovando...");
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
		console.error("Erro ao consultar API:", erro.message);
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
