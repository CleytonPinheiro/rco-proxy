import express from "express";
import axios from "axios";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "./supabase.js";

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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                "Referer": "https://rco.paas.pr.gov.br/"
            },
            maxRedirects: 5,
            validateStatus: () => true
        });

        console.log("Headers recebidos:", response.headers);

        const cookies = response.headers["set-cookie"];
        if (!cookies || cookies.length === 0) {
            // Fallback: Tentar prosseguir sem o cookie ou logar erro detalhado
            console.error("DEBUG: Nenhum cookie retornado nos headers");
            throw new Error("A Central de Segurança PR não retornou cookies de sessão. Isso pode ser um bloqueio de IP ou mudança no sistema.");
        }

        const csAuthCookie = cookies.find(c => c.startsWith("CS-AUTH="));
        if (!csAuthCookie) {
            console.error("DEBUG: Cookie CS-AUTH não encontrado entre os cookies:", cookies);
            throw new Error("Cookie de autenticação CS-AUTH não encontrado.");
        }

        return csAuthCookie.split(";")[0];
    } catch (error) {
        console.error("Erro em getSessionCookie:", error.message);
        throw error;
    }
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

// ==================== API ALUNOS ====================

app.get("/api/alunos", async (req, res) => {
        try {
                const { data, error } = await supabase
                        .from('alunos')
                        .select('*')
                        .order('nome');
                
                if (error) throw error;
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.get("/api/alunos/:registro", async (req, res) => {
        try {
                const { data, error } = await supabase
                        .from('alunos')
                        .select('*')
                        .eq('registro', req.params.registro)
                        .single();
                
                if (error) {
                        if (error.code === 'PGRST116') {
                                return res.status(404).json({ erro: 'Aluno não encontrado' });
                        }
                        throw error;
                }
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// ==================== API MATERIAIS ====================

app.get("/api/materiais", async (req, res) => {
        try {
                const { tipo, status } = req.query;
                let query = supabase.from('materiais').select('*');
                
                if (tipo) query = query.eq('tipo', tipo);
                if (status) query = query.eq('status', status);
                
                const { data, error } = await query.order('codigo');
                
                if (error) throw error;
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.get("/api/materiais/:codigo", async (req, res) => {
        try {
                const { data, error } = await supabase
                        .from('materiais')
                        .select('*')
                        .eq('codigo', req.params.codigo)
                        .single();
                
                if (error) {
                        if (error.code === 'PGRST116') {
                                return res.status(404).json({ erro: 'Material não encontrado' });
                        }
                        throw error;
                }
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.post("/api/materiais", async (req, res) => {
        try {
                const { codigo, tipo, descricao, localizacao, estado } = req.body;
                
                if (!codigo || !tipo || !descricao) {
                        return res.status(400).json({ erro: 'Código, tipo e descrição são obrigatórios' });
                }
                
                const { data, error } = await supabase
                        .from('materiais')
                        .insert([{ codigo, tipo, descricao, localizacao, estado: estado || 'otimo', status: 'disponivel' }])
                        .select()
                        .single();
                
                if (error) throw error;
                res.status(201).json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.put("/api/materiais/:id", async (req, res) => {
        try {
                const { codigo, tipo, descricao, localizacao, estado, status } = req.body;
                
                const { data, error } = await supabase
                        .from('materiais')
                        .update({ codigo, tipo, descricao, localizacao, estado, status, updated_at: new Date().toISOString() })
                        .eq('id', req.params.id)
                        .select()
                        .single();
                
                if (error) throw error;
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.delete("/api/materiais/:id", async (req, res) => {
        try {
                const { error } = await supabase
                        .from('materiais')
                        .delete()
                        .eq('id', req.params.id);
                
                if (error) throw error;
                res.json({ sucesso: true });
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// ==================== API EMPRÉSTIMOS ====================

app.get("/api/emprestimos", async (req, res) => {
        try {
                const { status } = req.query;
                let query = supabase
                        .from('emprestimos')
                        .select(`
                                *,
                                aluno:alunos(*),
                                material:materiais(*)
                        `);
                
                if (status) query = query.eq('status', status);
                
                const { data, error } = await query.order('data_emprestimo', { ascending: false });
                
                if (error) throw error;
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.post("/api/emprestimos", async (req, res) => {
        try {
                const { aluno_registro, material_codigo, professor, aulas, observacoes } = req.body;
                
                if (!aluno_registro || !material_codigo || !aulas || aulas.length === 0) {
                        return res.status(400).json({ erro: 'Aluno, material e aulas são obrigatórios' });
                }
                
                const { data: aluno, error: alunoErr } = await supabase
                        .from('alunos')
                        .select('id')
                        .eq('registro', aluno_registro)
                        .single();
                
                if (alunoErr) {
                        if (alunoErr.code === 'PGRST116') {
                                return res.status(404).json({ erro: 'Aluno não encontrado' });
                        }
                        throw alunoErr;
                }
                
                const { data: material, error: matErr } = await supabase
                        .from('materiais')
                        .select('id, status')
                        .eq('codigo', material_codigo)
                        .single();
                
                if (matErr) {
                        if (matErr.code === 'PGRST116') {
                                return res.status(404).json({ erro: 'Material não encontrado' });
                        }
                        throw matErr;
                }
                
                if (material.status !== 'disponivel') {
                        return res.status(400).json({ erro: 'Material não está disponível' });
                }
                
                const { error: updateErr } = await supabase
                        .from('materiais')
                        .update({ status: 'emprestado' })
                        .eq('id', material.id);
                
                if (updateErr) throw updateErr;
                
                const { data: emprestimo, error: empErr } = await supabase
                        .from('emprestimos')
                        .insert([{
                                aluno_id: aluno.id,
                                material_id: material.id,
                                professor,
                                aulas,
                                observacoes,
                                status: 'ativo'
                        }])
                        .select(`
                                *,
                                aluno:alunos(*),
                                material:materiais(*)
                        `)
                        .single();
                
                if (empErr) throw empErr;
                res.status(201).json(emprestimo);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.put("/api/emprestimos/:id/devolver", async (req, res) => {
        try {
                const { estado_devolucao, observacoes_devolucao } = req.body;
                
                const { data: emprestimo, error: getErr } = await supabase
                        .from('emprestimos')
                        .select('material_id')
                        .eq('id', req.params.id)
                        .single();
                
                if (getErr) {
                        if (getErr.code === 'PGRST116') {
                                return res.status(404).json({ erro: 'Empréstimo não encontrado' });
                        }
                        throw getErr;
                }
                
                const { error: updateMatErr } = await supabase
                        .from('materiais')
                        .update({ status: 'disponivel', estado: estado_devolucao || 'bom' })
                        .eq('id', emprestimo.material_id);
                
                if (updateMatErr) throw updateMatErr;
                
                const { data, error } = await supabase
                        .from('emprestimos')
                        .update({
                                status: 'devolvido',
                                data_devolucao: new Date().toISOString(),
                                estado_devolucao,
                                observacoes_devolucao
                        })
                        .eq('id', req.params.id)
                        .select(`
                                *,
                                aluno:alunos(*),
                                material:materiais(*)
                        `)
                        .single();
                
                if (error) throw error;
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// ==================== ESTATÍSTICAS ====================

app.get("/api/estatisticas/materiais", async (req, res) => {
        try {
                const { data, error } = await supabase
                        .from('materiais')
                        .select('status');
                
                if (error) throw error;
                
                const stats = {
                        total: data.length,
                        disponivel: data.filter(m => m.status === 'disponivel').length,
                        emprestado: data.filter(m => m.status === 'emprestado').length,
                        manutencao: data.filter(m => m.status === 'manutencao').length
                };
                
                res.json(stats);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
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
