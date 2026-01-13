import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

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
		console.log("Cookie CS-AUTH obtido com sucesso");
		return cookieValue;
	} catch (error) {
		console.error("Erro ao obter cookie de sessão:", error.message);
		throw error;
	}
}

async function performLogin(sessionCookie) {
	try {
		const cpf = process.env.RCO_CPF;
		const senha = process.env.RCO_SENHA;

		if (!cpf || !senha) {
			throw new Error("Credenciais não configuradas. Configure RCO_CPF e RCO_SENHA nos Secrets.");
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
					const token = decodeURIComponent(tokenMatch[1]);
					console.log("Token JWT obtido com sucesso via redirect");
					return token;
				}
			}
			
			if (redirectUrl && redirectUrl.includes("#")) {
				const hashPart = redirectUrl.split("#")[1];
				const params = new URLSearchParams(hashPart);
				const token = params.get("access_token");
				if (token) {
					console.log("Token JWT obtido com sucesso via fragment");
					return token;
				}
			}
		}

		if (response.data && typeof response.data === "string") {
			const tokenMatch = response.data.match(/access_token[=:][\s"']*([a-zA-Z0-9._-]+)/);
			if (tokenMatch && tokenMatch[1]) {
				console.log("Token JWT obtido com sucesso via body");
				return tokenMatch[1];
			}
		}

		console.error("Resposta do login:", {
			status: response.status,
			headers: response.headers,
			data: typeof response.data === "string" ? response.data.substring(0, 500) : response.data
		});

		throw new Error(`Falha ao obter token. Status: ${response.status}`);
	} catch (error) {
		console.error("Erro ao fazer login:", error.message);
		throw error;
	}
}

function decodeJwtExpiration(token) {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) {
			return null;
		}
		const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
		return payload.exp ? payload.exp * 1000 : null;
	} catch (error) {
		console.error("Erro ao decodificar JWT:", error.message);
		return null;
	}
}

function isTokenExpired() {
	if (!cachedToken || !tokenExpiration) {
		return true;
	}
	const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
	return tokenExpiration < fiveMinutesFromNow;
}

async function getValidToken(forceRefresh = false) {
	if (!forceRefresh && !isTokenExpired()) {
		console.log("Usando token em cache (válido)");
		return cachedToken;
	}

	console.log("Obtendo novo token...");
	
	try {
		const sessionCookie = await getSessionCookie();
		const token = await performLogin(sessionCookie);
		
		cachedToken = token.replace(/[^a-zA-Z0-9._-]/g, "");
		tokenExpiration = decodeJwtExpiration(cachedToken);
		
		if (tokenExpiration) {
			const expiresIn = Math.round((tokenExpiration - Date.now()) / 1000 / 60);
			console.log(`Novo token obtido. Expira em ${expiresIn} minutos.`);
		} else {
			tokenExpiration = Date.now() + (60 * 60 * 1000);
			console.log("Novo token obtido. Expiração padrão: 1 hora.");
		}
		
		return cachedToken;
	} catch (error) {
		console.error("Falha ao obter novo token:", error.message);
		
		if (process.env.AUTHORIZATION_TOKEN) {
			console.log("Usando AUTHORIZATION_TOKEN como fallback");
			return process.env.AUTHORIZATION_TOKEN.trim().replace(/[^a-zA-Z0-9._-]/g, "");
		}
		
		throw error;
	}
}

app.get("/", (req, res) => {
	res.send(
		"Servidor Express funcionando! Use /api/acessos para consultar a API do RCO Digital.",
	);
});

app.get("/api/acessos", async (req, res) => {
	try {
		let authToken = await getValidToken();

		const response = await axios.get(
			"https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar",
			{
				headers: {
					consumerId: "RCDIGWEB",
					Authorization: `Bearer ${authToken}`,
				},
				timeout: 30000,
				validateStatus: () => true,
			},
		);

		if (response.status === 401 || response.status === 403) {
			console.log("Token expirado/inválido. Tentando renovar...");
			
			try {
				authToken = await getValidToken(true);
				
				const retryResponse = await axios.get(
					"https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar",
					{
						headers: {
							consumerId: "RCDIGWEB",
							Authorization: `Bearer ${authToken}`,
						},
						timeout: 30000,
						validateStatus: () => true,
					},
				);

				if (retryResponse.status >= 400) {
					return res.status(retryResponse.status).json({
						erro: "Erro na API do RCO Digital após renovação de token",
						detalhes: retryResponse.data,
						status: retryResponse.status,
					});
				}

				return res.json(retryResponse.data);
			} catch (renewError) {
				return res.status(response.status).json({
					erro: "Token de autorização inválido ou expirado",
					detalhes: response.data,
					status: response.status,
					dica: "Verifique se as credenciais RCO_CPF e RCO_SENHA estão corretas nos Secrets.",
				});
			}
		}

		if (response.status >= 400) {
			return res.status(response.status).json({
				erro: "Erro na API do RCO Digital",
				detalhes: response.data,
				status: response.status,
			});
		}

		res.json(response.data);
	} catch (erro) {
		console.error("Erro ao consultar API:", erro.message);

		if (erro.response) {
			return res.status(erro.response.status).json({
				erro: "Erro ao consultar a API do RCO Digital",
				detalhes: erro.response.data || erro.message,
				status: erro.response.status,
			});
		}

		res.status(500).json({
			erro: "Erro ao consultar a API do RCO Digital",
			detalhes: erro.message,
		});
	}
});

app.get("/api/token/status", async (req, res) => {
	res.json({
		tokenEmCache: !!cachedToken,
		tokenExpirado: isTokenExpired(),
		expiracao: tokenExpiration ? new Date(tokenExpiration).toISOString() : null,
		credenciaisConfiguradas: !!(process.env.RCO_CPF && process.env.RCO_SENHA),
		fallbackDisponivel: !!process.env.AUTHORIZATION_TOKEN
	});
});

app.post("/api/token/renovar", async (req, res) => {
	try {
		await getValidToken(true);
		res.json({
			sucesso: true,
			mensagem: "Token renovado com sucesso",
			expiracao: tokenExpiration ? new Date(tokenExpiration).toISOString() : null
		});
	} catch (error) {
		res.status(500).json({
			sucesso: false,
			erro: error.message
		});
	}
});

app.listen(5000, "0.0.0.0", () => {
	console.log("Servidor Express rodando na porta 5000");
	console.log("Acesse /api/acessos para consultar a API do RCO Digital");
	console.log("Acesse /api/token/status para verificar o status do token");
});
