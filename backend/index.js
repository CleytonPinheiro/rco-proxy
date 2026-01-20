import express from "express";
import axios from "axios";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "./supabase.js";
import { loginWithPuppeteer, decodeJwtExpiration } from "./auth-puppeteer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// Health check endpoint for deployment
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

let userCredentials = {
    cpf: process.env.RCO_CPF || "",
    senha: process.env.RCO_SENHA || ""
};

let cachedToken = null;
let tokenExpiration = null;

async function getValidToken(forceRefresh = false) {
    if (!forceRefresh && cachedToken && tokenExpiration && tokenExpiration > Date.now() + 300000) {
        return cachedToken;
    }
    
    const { cpf, senha } = userCredentials;
    if (!cpf || !senha) {
        throw new Error("Credenciais não configuradas");
    }
    
    console.log("Obtendo novo token via navegador automatizado...");
    const token = await loginWithPuppeteer(cpf, senha);
    cachedToken = token.trim();
    tokenExpiration = decodeJwtExpiration(cachedToken) || (Date.now() + 3600000);
    console.log("Token obtido. Expira em:", new Date(tokenExpiration).toISOString());
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
