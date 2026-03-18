import express from "express";
import axios from "axios";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Health check endpoints - MUST be FIRST before any other middleware
app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

app.get("/", (req, res) => {
    res.redirect("/app");
});

// Start server IMMEDIATELY - before loading heavy dependencies
const PORT = 5000;
const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Frontend: http://localhost:${PORT}/app`);
    console.log(`API: http://localhost:${PORT}/api`);
    // Load heavy dependencies after server starts
    initializeApp();
});

// Lazy-loaded modules
let supabase = null;
let supabaseAdmin = null;
let loginWithPuppeteer = null;
let decodeJwtExpiration = null;
let getBrowser = null;

async function initializeApp() {
    try {
        console.log("Carregando dependências...");
        const supabaseModule = await import("./supabase.js");
        supabase = supabaseModule.supabase;
        supabaseAdmin = supabaseModule.supabaseAdmin;
        
        const authModule = await import("./auth-puppeteer.js");
        loginWithPuppeteer = authModule.loginWithPuppeteer;
        decodeJwtExpiration = authModule.decodeJwtExpiration;
        getBrowser = authModule.getBrowser;
        
        console.log("Dependências carregadas com sucesso!");

        // Sincronizar com Supabase na inicialização e a cada 6 horas
        await sincronizarComSupabase().catch(e => console.warn("[SYNC] Falha no sync inicial:", e.message));
        setInterval(() => {
            sincronizarComSupabase().catch(e => console.warn("[SYNC] Falha no sync periódico:", e.message));
        }, 6 * 60 * 60 * 1000); // a cada 6 horas

    } catch (error) {
        console.error("Erro ao carregar dependências:", error.message);
    }
}

app.use(cors());
app.use(express.json());

// Serve frontend at /app
app.get("/app", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.use(express.static(path.join(__dirname, "../frontend")));

let userCredentials = {
    cpf: process.env.RCO_CPF || "",
    senha: process.env.RCO_SENHA || ""
};

let cachedToken = null;
let tokenExpiration = null;
let tokenRefreshPromise = null; // Semáforo: evita renovações simultâneas

async function getValidToken(forceRefresh = false) {
    if (!loginWithPuppeteer) {
        throw new Error("Sistema ainda inicializando, aguarde alguns segundos");
    }
    
    if (!forceRefresh && cachedToken && tokenExpiration && tokenExpiration > Date.now() + 300000) {
        return cachedToken;
    }

    // Se já há uma renovação em andamento, aguardar ela terminar
    if (tokenRefreshPromise) {
        console.log("Renovação de token já em andamento, aguardando...");
        await tokenRefreshPromise;
        return cachedToken;
    }
    
    const { cpf, senha } = userCredentials;
    if (!cpf || !senha) {
        throw new Error("Credenciais não configuradas");
    }
    
    console.log("Obtendo novo token via navegador automatizado...");
    tokenRefreshPromise = loginWithPuppeteer(cpf, senha)
        .then(token => {
            cachedToken = token.trim();
            tokenExpiration = decodeJwtExpiration(cachedToken) || (Date.now() + 3600000);
            console.log("Token obtido. Expira em:", new Date(tokenExpiration).toISOString());
        })
        .catch(err => {
            console.error("Falha ao obter token:", err.message);
            throw err;
        })
        .finally(() => {
            tokenRefreshPromise = null;
        });

    await tokenRefreshPromise;
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

// ==================== DIAGNÓSTICO RCO ====================
// Diagnóstico: chamar qualquer path do RCO e retornar raw
app.get("/api/debug/raw-rco", async (req, res) => {
        const { path: rcoPath } = req.query;
        if (!rcoPath) return res.status(400).json({ erro: 'path é obrigatório' });
        try {
                const authToken = await getValidToken();
                const r = await rcoGet(rcoPath, authToken);
                res.json({ status: r.status, data: r.data });
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get("/api/debug/rco", async (req, res) => {
        try {
                const authToken = await getValidToken();
                const BASE = "https://apigateway-educacao.paas.pr.gov.br/seed/rcdig";
                const headers = { consumerId: "RCDIGWEB", Authorization: `Bearer ${authToken}` };

                const hoje = new Date().toISOString().split("T")[0];
                const BASE_ESTADUAL = BASE + "/estadual/v1";
                const optsEst = { headers, timeout: 20000, validateStatus: () => true };

                // codClasse e codTurma reais do estabelecimento
                const COD_CLASSE = req.query.codClasse || 8682303;
                const COD_TURMA  = req.query.codTurma  || 2604991;

                const endpoints = [
                        { url: `${BASE_ESTADUAL}/educador/estabelecimentos/v2/${hoje}`, label: "estabelecimentos/hoje" },
                        { url: `${BASE_ESTADUAL}/classe/v1/acessos/contatos`, label: "acessos/contatos" },
                        // Endpoints candidatos para alunos
                        { url: `${BASE_ESTADUAL}/frequencia/v1/classe/${COD_CLASSE}/alunos`, label: "frequencia/classe/alunos" },
                        { url: `${BASE_ESTADUAL}/educador/classe/v1/${COD_CLASSE}/alunos`, label: "educador/classe/alunos" },
                        { url: `${BASE_ESTADUAL}/aluno/v1/classe/${COD_CLASSE}`, label: "aluno/classe" },
                        { url: `${BASE_ESTADUAL}/educador/turma/v1/${COD_TURMA}/alunos`, label: "educador/turma/alunos" },
                        { url: `${BASE_ESTADUAL}/frequencia/v1/turma/${COD_TURMA}/alunos`, label: "frequencia/turma/alunos" },
                        { url: `${BASE_ESTADUAL}/educador/frequencia/v1/classe/${COD_CLASSE}/alunos`, label: "educador/frequencia/classe/alunos" },
                        { url: `${BASE_ESTADUAL}/frequencia/v2/classe/${COD_CLASSE}/alunos`, label: "frequencia/v2/classe/alunos" },
                        { url: `${BASE_ESTADUAL}/diario/v1/classe/${COD_CLASSE}/alunos`, label: "diario/classe/alunos" },
                ];

                const results = {};
                for (const ep of endpoints) {
                        try {
                                const r = await axios.get(ep.url, optsEst);
                                const bodyStr = JSON.stringify(r.data);
                                results[ep.label] = {
                                        url: ep.url,
                                        status: r.status,
                                        contentType: r.headers["content-type"],
                                        bodyLength: bodyStr.length,
                                        preview: bodyStr.substring(0, 500),
                                };
                        } catch (e) {
                                results[ep.label] = { url: ep.url, erro: e.message };
                        }
                }

                res.json(results);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// ==================== FREQUÊNCIAS ====================

// GET /api/frequencias?codClasse=X&codPeriodoAvaliacao=Y&codPeriodoLetivo=Z
// Retorna lista de alunos com frequência por aula (C=presente, F=falta)
app.get("/api/frequencias", async (req, res) => {
        const codClasse           = req.query.codClasse;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;
        const codPeriodoLetivo    = req.query.codPeriodoLetivo    || 261;

        if (!codClasse) {
                return res.status(400).json({ erro: "codClasse é obrigatório" });
        }

        try {
                const authToken = await getValidToken();
                const path = `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`;
                const response = await rcoGet(path, authToken);

                if (response.status !== 200) {
                        return res.status(response.status).json({ erro: `RCO retornou ${response.status}`, dados: response.data });
                }

                const raw = Array.isArray(response.data) ? response.data : [];

                // Extrair codAulas únicos (todas as chaves numéricas dos objetos aluno)
                const aulaSet = new Set();
                raw.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));
                const codAulas = [...aulaSet].sort((a, b) => parseInt(a) - parseInt(b));

                // Buscar data de cada aula em paralelo
                const aulaDatas = {};
                await Promise.all(codAulas.map(async (cod) => {
                        try {
                                const r = await rcoGet(
                                        `/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPeriodoLetivo}`,
                                        authToken
                                );
                                const dataRaw = r?.data?.aula?.dataAula || r?.data?.dataAula || null;
                                if (dataRaw) {
                                        // "2026-03-05T00:00:00" → "05/03"
                                        const d = new Date(dataRaw);
                                        const dd = String(d.getUTCDate()).padStart(2, '0');
                                        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
                                        aulaDatas[cod] = `${dd}/${mm}`;
                                }
                        } catch (_) {}
                }));

                // Mapear alunos com suas frequências e totais
                const alunos = raw.map(a => {
                        const freq = {};
                        codAulas.forEach(cod => { freq[cod] = a[cod] || null; });

                        const presencas   = codAulas.filter(cod => a[cod] === 'C').length;
                        const faltas      = codAulas.filter(cod => a[cod] && a[cod] !== 'C').length;
                        const totalAulas  = codAulas.filter(cod => a[cod] !== undefined && a[cod] !== null).length;
                        const pct = totalAulas > 0 ? Math.round((presencas / totalAulas) * 100) : null;

                        return {
                                codMatrizAluno: a.codMatrizAluno,
                                numChamada:     a.numChamada,
                                nome:           a.nome,
                                situacao:       a.descrAbrevSituacaoMatricula || '',
                                frequencias:    freq,
                                presencas,
                                faltas,
                                totalAulas,
                                percentual:     pct,
                        };
                });

                res.json({ codAulas, aulaDatas, alunos, codClasse: parseInt(codClasse), codPeriodoAvaliacao: parseInt(codPeriodoAvaliacao) });

        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// ==================== ENDPOINTS DE ALUNOS DO RCO ====================

// Buscar lista de alunos do RCO por codClasse
// Endpoint descoberto via análise do JS do RCO: /classe/v1/relatorios/avaliacaoAlunos
app.get("/api/alunos-rco", async (req, res) => {
        const codClasse           = req.query.codClasse;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;

        if (!codClasse) {
                return res.status(400).json({ erro: "codClasse é obrigatório" });
        }

        try {
                const authToken = await getValidToken();

                // Primeiro tenta o endpoint de avaliação (mais rápido, sem dados de frequência)
                let path = `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`;
                let response = await rcoGet(path, authToken);
                let alunos = Array.isArray(response.data) ? response.data : [];

                // Se vazio (turma sem avaliações lançadas), usa frequenciaAulas como fallback
                if (alunos.length === 0) {
                        path = `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=261&page=1&perPage=200`;
                        response = await rcoGet(path, authToken);
                        alunos = Array.isArray(response.data) ? response.data : [];
                }

                if (response.status !== 200 && alunos.length === 0) {
                        return res.status(response.status).json({ erro: `RCO retornou ${response.status}`, dados: response.data });
                }

                res.json(alunos.map(a => ({
                        codMatrizAluno: a.codMatrizAluno,
                        numChamada:     a.numChamada,
                        nome:           a.nome,
                        situacao:       a.descrAbrevSituacaoMatricula || '',
                })));

        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

app.get("/api/debug/alunos-classe", async (req, res) => {
        // Endpoints descobertos via análise do JS bundle do RCO:
        // GET /classe/v1/relatorios/avaliacaoAlunos?codClasse=X&codPeriodoAvaliacao=Y
        // GET /classe/v1/relatorios/avaliacaoParcialAlunos?codClasse=X&codPeriodoAvaliacao=Y
        // GET /classe/v1/avaliacaoParcialClasses?codClasse=X&codPeriodoAvaliacao=Y&page=1&perPage=100
        const codClasse          = req.query.codClasse          || 8682303;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;

        try {
                const authToken = await getValidToken();
                const candidatos = [
                        `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`,
                        `/classe/v1/relatorios/avaliacaoParcialAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`,
                        `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=261`,
                        `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=261&page=1&perPage=100`,
                        `/classe/v1/acessos/contatos?codClasse=${codClasse}`,
                        `/classe/v1/avaliacaoParcialClasses?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&page=1&perPage=100`,
                        `/classe/v1/avaliacaoParecerAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}`,
                        `/classe/v1/perguntas?codClasse=${codClasse}`,
                        `/classe/v1/relatorios?codClasse=${codClasse}`,
                        `/educador/grade/aula/v2/${codClasse}?codPeriodoLetivo=261`,
                ];

                const resultados = {};
                for (const path of candidatos) {
                        const r = await rcoGet(path, authToken);
                        const bodyStr = JSON.stringify(r.data);
                        resultados[path] = {
                                status: r.status,
                                bytes: bodyStr.length,
                                preview: bodyStr.substring(0, 600),
                        };
                }

                res.json(resultados);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// ==================== DESCOBERTA DE ALUNOS VIA PUPPETEER ====================

app.get("/api/debug/alunos-rco", async (req, res) => {
        const codClasse = Number(req.query.codClasse || 8682303);

        if (!getBrowser) {
                return res.status(503).json({ erro: "Browser não inicializado. Aguarde e tente novamente." });
        }

        const browser = await getBrowser();
        const page = await browser.newPage();
        const capturedRequests = [];

        try {
                // CDP para capturar respostas sem bloquear recursos
                const client = await page.createCDPSession();
                await client.send('Network.enable');

                // Capturar TODA resposta da API (mesmo erros)
                client.on('Network.responseReceived', async (event) => {
                        const url = event.response.url;
                        if (!url.includes('apigateway-educacao') && !url.includes('rcdig')) return;
                        try {
                                const bodyResp = await client.send('Network.getResponseBody', { requestId: event.requestId });
                                capturedRequests.push({
                                        url,
                                        status: event.response.status,
                                        bytes: bodyResp.body?.length || 0,
                                        preview: (bodyResp.body || '').substring(0, 600),
                                });
                        } catch {}
                });

                const RCO = 'https://rco.paas.pr.gov.br';

                // 1. Garantir que está logado - navegar para home
                await page.goto(RCO, { waitUntil: 'networkidle2', timeout: 30000 });
                const urlAtual = page.url();
                const titulo = await page.title();
                await new Promise(r => setTimeout(r, 3000));

                // 2. Navegar para a seção de livro de classe / frequência
                const rotasTentadas = [
                        `${RCO}/#/frequencia`,
                        `${RCO}/#/livro-classe`,
                        `${RCO}/#/livro`,
                        `${RCO}/#/diario`,
                ];

                for (const rota of rotasTentadas) {
                        try {
                                await page.evaluate((url) => { window.location.href = url; }, rota);
                                await new Promise(r => setTimeout(r, 5000));
                        } catch {}
                }

                // 3. Tentar clicar no primeiro card/botão disponível
                try {
                        const links = await page.$$('a, button, .card, [role="button"]');
                        if (links.length > 0) {
                                await links[0].click();
                                await new Promise(r => setTimeout(r, 5000));
                        }
                } catch {}

                await new Promise(r => setTimeout(r, 3000));

                const temAlunos = capturedRequests.filter(r =>
                        r.preview.toLowerCase().includes('nome') ||
                        r.preview.toLowerCase().includes('aluno') ||
                        r.preview.toLowerCase().includes('matricula') ||
                        (r.bytes > 200 && r.status === 200)
                );

                res.json({
                        paginaAtual: urlAtual,
                        tituloPagina: titulo,
                        totalCapturadas: capturedRequests.length,
                        candidatasAlunos: temAlunos.length,
                        todasRequisicoes: capturedRequests,
                        candidatas: temAlunos,
                });

        } catch (erro) {
                res.status(500).json({ erro: erro.message, capturadas: capturedRequests });
        } finally {
                try { await page.close(); } catch {}
        }
});

// ==================== SYNC RCO → SUPABASE ====================

async function sincronizarComSupabase() {
        const agora = new Date().toISOString();
        console.log(`[SYNC] Iniciando sincronização com Supabase em ${agora}...`);

        try {
                const authToken = await getValidToken();
                const hoje = new Date().toISOString().split("T")[0];
                const response = await rcoGet(`/educador/estabelecimentos/v2/${hoje}`, authToken);

                if (response.status !== 200) {
                        throw new Error(`API RCO retornou status ${response.status}`);
                }

                const raw = response.data;
                const estabs = Array.isArray(raw) ? raw : (raw ? [raw] : []);

                const estabelecimentosPayload = [];
                const turmasPayload = [];
                const disciplinasPayload = [];
                const classesPayload = [];

                // Mapa para sync de alunos: codTurma → { codClasse, descrTurma, codPeriodoAvaliacao, codPeriodoLetivo }
                const turmaParaClasse = {};

                estabs.forEach(estab => {
                        estabelecimentosPayload.push({
                                cod_estabelecimento: estab.codEstabelecimento,
                                nome_estabelecimento: estab.nomeCompletoEstab,
                                cod_municipio: estab.municipio?.codMunicipio || null,
                                atualizado_em: agora,
                        });

                        (estab.periodoLetivos || []).forEach(periodo => {
                                (periodo.livros || []).forEach(livro => {
                                        const classe = livro.classe;
                                        if (!classe) return;

                                        const turma = classe.turma || {};
                                        const disc = classe.disciplina || {};

                                        if (turma.codTurma) {
                                                turmasPayload.push({
                                                        cod_turma: turma.codTurma,
                                                        descr_turma: turma.descrTurma || '',
                                                        cod_seriacao: turma.seriacao?.codSeriacao || null,
                                                        cod_estabelecimento: estab.codEstabelecimento,
                                                        periodo_letivo: periodo.descrPeriodoLetivo || null,
                                                        atualizado_em: agora,
                                                });

                                                // Mapear turma → um codClasse representativo para buscar alunos
                                                if (!turmaParaClasse[turma.codTurma] && classe.codClasse) {
                                                        const firstPeriodo = (livro.calendarioAvaliacaos || [])[0];
                                                        turmaParaClasse[turma.codTurma] = {
                                                                codClasse: classe.codClasse,
                                                                descrTurma: turma.descrTurma || '',
                                                                codPeriodoAvaliacao: firstPeriodo?.periodoAvaliacao?.codPeriodoAvaliacao || 9,
                                                                codPeriodoLetivo: periodo.codPeriodoLetivo || 261,
                                                        };
                                                }
                                        }

                                        if (disc.codDisciplina) {
                                                disciplinasPayload.push({
                                                        cod_disciplina: disc.codDisciplina,
                                                        nome_disciplina: disc.nomeDisciplina || '',
                                                        sigla: (disc.siglaDisciplina || '').trim() || null,
                                                        cor_fundo: disc.corFundo || null,
                                                        cor_letra: disc.corLetra || null,
                                                        atualizado_em: agora,
                                                });
                                        }

                                        if (classe.codClasse) {
                                                classesPayload.push({
                                                        cod_classe: classe.codClasse,
                                                        cod_turma: turma.codTurma || null,
                                                        cod_disciplina: disc.codDisciplina || null,
                                                        cod_estabelecimento: estab.codEstabelecimento,
                                                        periodo_letivo: periodo.descrPeriodoLetivo || null,
                                                        atualizado_em: agora,
                                                });
                                        }
                                });
                        });
                });

                // Deduplicar
                const dedup = (arr, key) => [...new Map(arr.map(x => [x[key], x])).values()];
                const estabsUnicos = dedup(estabelecimentosPayload, 'cod_estabelecimento');
                const turmasUnicas = dedup(turmasPayload, 'cod_turma');
                const disciplinasUnicas = dedup(disciplinasPayload, 'cod_disciplina');
                const classesUnicas = dedup(classesPayload, 'cod_classe');

                // Upsert em ordem: estabelecimentos → turmas → disciplinas → classes
                const { error: e1 } = await supabaseAdmin.from('rco_estabelecimentos').upsert(estabsUnicos, { onConflict: 'cod_estabelecimento' });
                if (e1) {
                        if (e1.message?.includes('schema cache') || e1.code === 'PGRST204') {
                                throw new Error("TABELAS_NAO_CONFIGURADAS: Execute o SQL em backend/setup_rco_tables.sql no Supabase Studio.");
                        }
                        throw new Error(`Erro em rco_estabelecimentos: ${e1.message}`);
                }

                const { error: e2 } = await supabaseAdmin.from('rco_turmas').upsert(turmasUnicas, { onConflict: 'cod_turma' });
                if (e2) throw new Error(`Erro em rco_turmas: ${e2.message}`);

                const { error: e3 } = await supabaseAdmin.from('rco_disciplinas').upsert(disciplinasUnicas, { onConflict: 'cod_disciplina' });
                if (e3) throw new Error(`Erro em rco_disciplinas: ${e3.message}`);

                const { error: e4 } = await supabaseAdmin.from('rco_classes').upsert(classesUnicas, { onConflict: 'cod_classe' });
                if (e4) throw new Error(`Erro em rco_classes: ${e4.message}`);

                // ---- Sync de alunos ----
                let totalAlunos = 0;
                for (const [codTurmaStr, info] of Object.entries(turmaParaClasse)) {
                        const codTurma = parseInt(codTurmaStr);
                        try {
                                // 1º tenta via avaliações (mais leve)
                                let alunosResp = await rcoGet(
                                        `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${info.codClasse}&codPeriodoAvaliacao=${info.codPeriodoAvaliacao}`,
                                        authToken
                                );
                                let alunos = Array.isArray(alunosResp.data) ? alunosResp.data : [];

                                // Fallback: frequência (funciona mesmo sem avaliações)
                                if (alunos.length === 0) {
                                        alunosResp = await rcoGet(
                                                `/classe/v3/relatorios/frequenciaAulas?codClasse=${info.codClasse}&codPeriodoAvaliacao=${info.codPeriodoAvaliacao}&codPeriodoLetivo=${info.codPeriodoLetivo}&page=1&perPage=200`,
                                                authToken
                                        );
                                        alunos = Array.isArray(alunosResp.data) ? alunosResp.data : [];
                                }

                                if (alunos.length === 0) continue;

                                const alunosPayload = alunos.map(a => ({
                                        registro:       String(a.codMatrizAluno),
                                        nome:           a.nome,
                                        turma:          info.descrTurma,
                                        status:         'Ativo',
                                        codmatrizaluno: a.codMatrizAluno,
                                        codturma:       codTurma,
                                        numchamada:     a.numChamada,
                                }));

                                const { error: eA } = await supabaseAdmin
                                        .from('alunos')
                                        .upsert(alunosPayload, { onConflict: 'registro' });

                                if (eA) {
                                        // Ignorar erro de coluna inexistente (schema não migrado)
                                        console.warn(`[SYNC] Aviso alunos turma ${codTurma}:`, eA.message);
                                } else {
                                        totalAlunos += alunosPayload.length;
                                        console.log(`[SYNC] ${alunosPayload.length} alunos sincronizados (turma ${codTurma})`);
                                }
                        } catch (errAluno) {
                                console.warn(`[SYNC] Erro ao buscar alunos da turma ${codTurma}:`, errAluno.message);
                        }
                }

                // Log de sucesso
                await supabaseAdmin.from('rco_sync_log').insert({
                        status: 'sucesso',
                        estabelecimentos: estabsUnicos.length,
                        turmas: turmasUnicas.length,
                        disciplinas: disciplinasUnicas.length,
                        classes: classesUnicas.length,
                });

                const resultado = {
                        status: 'sucesso',
                        estabelecimentos: estabsUnicos.length,
                        turmas: turmasUnicas.length,
                        disciplinas: disciplinasUnicas.length,
                        classes: classesUnicas.length,
                        alunos: totalAlunos,
                        executadoEm: agora,
                };
                console.log(`[SYNC] Concluído:`, resultado);
                return resultado;

        } catch (erro) {
                console.error(`[SYNC] Erro:`, erro.message);
                try {
                        await supabaseAdmin.from('rco_sync_log').insert({
                                status: 'erro',
                                mensagem: erro.message,
                        });
                } catch {}
                throw erro;
        }
}

// Endpoint para disparar sincronização manualmente
app.post("/api/sync", async (req, res) => {
        try {
                const resultado = await sincronizarComSupabase();
                res.json(resultado);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// Endpoint para ver o log de sincronizações
app.get("/api/sync/log", async (req, res) => {
        try {
                const { data, error } = await supabase
                        .from('rco_sync_log')
                        .select('*')
                        .order('executado_em', { ascending: false })
                        .limit(20);
                if (error) throw error;
                res.json(data);
        } catch (erro) {
                res.status(500).json({ erro: erro.message });
        }
});

// Endpoint para verificar se as tabelas Supabase estão configuradas
app.get("/api/setup-status", async (req, res) => {
        try {
                const { data, error } = await supabase
                        .from('rco_estabelecimentos')
                        .select('cod_estabelecimento')
                        .limit(1);
                if (error) {
                        return res.json({
                                configurado: false,
                                mensagem: "Tabelas não encontradas no Supabase. Execute o SQL em backend/setup_rco_tables.sql no Supabase Studio.",
                                supabase_url: process.env.SUPABASE_URL || '(não definida)',
                                erro: error.message
                        });
                }
                res.json({ configurado: true, mensagem: "Tabelas configuradas e acessíveis." });
        } catch (erro) {
                res.status(500).json({ configurado: false, erro: erro.message });
        }
});

// Função auxiliar para requisições à API RCO com renovação de token
async function rcoGet(path, authToken) {
        const BASE = "https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1";
        const headers = { consumerId: "RCDIGWEB", Authorization: `Bearer ${authToken}` };
        let response = await axios.get(BASE + path, { headers, timeout: 30000, validateStatus: () => true });

        if (response.status === 401 || response.status === 403) {
                const newToken = await getValidToken(true);
                response = await axios.get(BASE + path, {
                        headers: { consumerId: "RCDIGWEB", Authorization: `Bearer ${newToken}` },
                        timeout: 30000,
                        validateStatus: () => true,
                });
        }

        return response;
}

// Endpoint principal: retorna estabelecimentos, turmas e disciplinas
app.get("/api/acessos", async (req, res) => {
        try {
                const authToken = await getValidToken();
                const hoje = new Date().toISOString().split("T")[0];

                console.log(`Consultando estabelecimentos para ${hoje}...`);
                const response = await rcoGet(`/educador/estabelecimentos/v2/${hoje}`, authToken);

                console.log("RCO API status:", response.status, "| bytes:", JSON.stringify(response.data).length);

                if (response.status !== 200) {
                        return res.status(response.status).json({ erro: "Erro na API RCO", data: response.data });
                }

                res.json(response.data);
        } catch (erro) {
                console.error("Erro ao consultar API RCO:", erro.message);
                res.status(500).json({ erro: "Erro ao consultar a API", detalhes: erro.message });
        }
});

// ==================== API ALUNOS ====================

app.get("/api/alunos", async (req, res) => {
        try {
                const { turma, codturma, registro } = req.query;
                let query = supabase.from('alunos').select('*');

                if (codturma) query = query.eq('codturma', parseInt(codturma));
                else if (turma) query = query.eq('turma', turma);
                if (registro) query = query.eq('registro', registro);

                // Ordenar por numchamada se disponível, senão por nome
                const { data, error } = await query
                        .order('numchamada', { ascending: true, nullsFirst: false })
                        .order('nome', { ascending: true });

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

// ==================== GRUPOS DE TRABALHO (Supabase) ====================

function gerarId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Monta o formato de resposta do frontend a partir das linhas do Supabase
function montarGrupo(row) {
        return {
                id:          row.id,
                codTurma:    row.cod_turma,
                nome:        row.nome,
                descricao:   row.descricao || '',
                bloqueado:   row.bloqueado,
                criadoEm:    row.criado_em,
                alunos: (row.grupo_alunos || []).map(a => ({
                        codMatrizAluno: a.cod_matriz_aluno,
                        nome:           a.nome,
                        numChamada:     a.num_chamada,
                })),
                atividades: (row.grupo_atividades || [])
                        .sort((a, b) => b.data.localeCompare(a.data))
                        .map(a => ({
                                id:        a.id,
                                data:      a.data,
                                descricao: a.descricao,
                                criadoEm:  a.criado_em,
                        })),
        };
}

// Buscar um grupo completo por id
async function buscarGrupo(id) {
        const { data, error } = await supabaseAdmin
                .from('grupos')
                .select('*, grupo_alunos(*), grupo_atividades(*)')
                .eq('id', id)
                .single();
        if (error || !data) return null;
        return montarGrupo(data);
}

// GET /api/grupos?codTurma=X
app.get('/api/grupos', async (req, res) => {
        try {
                let query = supabaseAdmin
                        .from('grupos')
                        .select('*, grupo_alunos(*), grupo_atividades(*)')
                        .order('criado_em', { ascending: true });
                if (req.query.codTurma) query = query.eq('cod_turma', parseInt(req.query.codTurma));
                const { data, error } = await query;
                if (error) return res.status(500).json({ erro: error.message });
                res.json((data || []).map(montarGrupo));
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/grupos
app.post('/api/grupos', async (req, res) => {
        const { codTurma, nome, descricao } = req.body;
        if (!codTurma || !nome) return res.status(400).json({ erro: 'codTurma e nome são obrigatórios' });
        try {
                const id = gerarId();
                const { error } = await supabaseAdmin.from('grupos').insert({
                        id, cod_turma: parseInt(codTurma), nome, descricao: descricao || '', bloqueado: false,
                });
                if (error) return res.status(500).json({ erro: error.message });
                const grupo = await buscarGrupo(id);
                res.json(grupo);
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PUT /api/grupos/:id
app.put('/api/grupos/:id', async (req, res) => {
        const { nome, descricao, bloqueado } = req.body;
        const campos = {};
        if (nome !== undefined)      campos.nome        = nome;
        if (descricao !== undefined) campos.descricao   = descricao;
        if (bloqueado !== undefined) campos.bloqueado   = !!bloqueado;
        campos.atualizado_em = new Date().toISOString();
        try {
                const { error } = await supabaseAdmin.from('grupos').update(campos).eq('id', req.params.id);
                if (error) return res.status(500).json({ erro: error.message });
                const grupo = await buscarGrupo(req.params.id);
                if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
                res.json(grupo);
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /api/grupos/:id
app.delete('/api/grupos/:id', async (req, res) => {
        try {
                const grupo = await buscarGrupo(req.params.id);
                if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
                if (grupo.bloqueado) return res.status(403).json({ erro: 'Grupo bloqueado. Desbloqueie antes de excluir.' });
                const { error } = await supabaseAdmin.from('grupos').delete().eq('id', req.params.id);
                if (error) return res.status(500).json({ erro: error.message });
                res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/grupos/:id/alunos
app.post('/api/grupos/:id/alunos', async (req, res) => {
        const { codMatrizAluno, nome, numChamada } = req.body;
        if (!codMatrizAluno) return res.status(400).json({ erro: 'codMatrizAluno é obrigatório' });
        try {
                const grupo = await buscarGrupo(req.params.id);
                if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
                if (grupo.bloqueado) return res.status(403).json({ erro: 'Grupo bloqueado' });

                // Remover aluno de outros grupos não bloqueados da mesma turma
                const { data: outrosGrupos } = await supabaseAdmin
                        .from('grupos')
                        .select('id, bloqueado')
                        .eq('cod_turma', grupo.codTurma)
                        .neq('id', req.params.id);
                for (const g of (outrosGrupos || [])) {
                        if (!g.bloqueado) {
                                await supabaseAdmin.from('grupo_alunos')
                                        .delete()
                                        .eq('grupo_id', g.id)
                                        .eq('cod_matriz_aluno', codMatrizAluno);
                        }
                }

                // Upsert aluno no grupo atual
                await supabaseAdmin.from('grupo_alunos').upsert({
                        grupo_id: req.params.id,
                        cod_matriz_aluno: codMatrizAluno,
                        nome: nome || '',
                        num_chamada: numChamada || null,
                }, { onConflict: 'grupo_id,cod_matriz_aluno' });

                res.json(await buscarGrupo(req.params.id));
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /api/grupos/:id/alunos/:codMatrizAluno
app.delete('/api/grupos/:id/alunos/:codMatrizAluno', async (req, res) => {
        try {
                const grupo = await buscarGrupo(req.params.id);
                if (!grupo) return res.status(404).json({ erro: 'Grupo não encontrado' });
                if (grupo.bloqueado) return res.status(403).json({ erro: 'Grupo bloqueado. Desbloqueie primeiro.' });
                await supabaseAdmin.from('grupo_alunos')
                        .delete()
                        .eq('grupo_id', req.params.id)
                        .eq('cod_matriz_aluno', parseInt(req.params.codMatrizAluno));
                res.json(await buscarGrupo(req.params.id));
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/grupos/:id/atividades
app.post('/api/grupos/:id/atividades', async (req, res) => {
        const { data, descricao } = req.body;
        if (!descricao) return res.status(400).json({ erro: 'Descrição é obrigatória' });
        try {
                const id = gerarId();
                const { error } = await supabaseAdmin.from('grupo_atividades').insert({
                        id,
                        grupo_id:  req.params.id,
                        data:      data || new Date().toISOString().split('T')[0],
                        descricao,
                });
                if (error) return res.status(500).json({ erro: error.message });
                const { data: ativ } = await supabaseAdmin.from('grupo_atividades').select('*').eq('id', id).single();
                res.json({ id: ativ.id, data: ativ.data, descricao: ativ.descricao, criadoEm: ativ.criado_em });
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// PUT /api/grupos/:id/atividades/:ativId
app.put('/api/grupos/:id/atividades/:ativId', async (req, res) => {
        const { data, descricao } = req.body;
        const campos = {};
        if (data)      campos.data      = data;
        if (descricao) campos.descricao = descricao;
        try {
                const { error } = await supabaseAdmin.from('grupo_atividades')
                        .update(campos)
                        .eq('id', req.params.ativId)
                        .eq('grupo_id', req.params.id);
                if (error) return res.status(500).json({ erro: error.message });
                const { data: ativ } = await supabaseAdmin.from('grupo_atividades').select('*').eq('id', req.params.ativId).single();
                res.json({ id: ativ.id, data: ativ.data, descricao: ativ.descricao, criadoEm: ativ.criado_em });
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /api/grupos/:id/atividades/:ativId
app.delete('/api/grupos/:id/atividades/:ativId', async (req, res) => {
        try {
                const { error } = await supabaseAdmin.from('grupo_atividades')
                        .delete()
                        .eq('id', req.params.ativId)
                        .eq('grupo_id', req.params.id);
                if (error) return res.status(500).json({ erro: error.message });
                res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
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

// ==================== OBSERVAÇÕES DE ALUNOS (chamada diária RCO) ====================

// GET /api/observacoes?codClasse=X&codPeriodoAvaliacao=Y&codPeriodoLetivo=Z
// Percorre todas as aulas da classe, coleta observações por aluno e salva no Supabase
app.get('/api/observacoes', async (req, res) => {
        const codClasse           = req.query.codClasse;
        const codPeriodoAvaliacao = req.query.codPeriodoAvaliacao || 9;
        const codPeriodoLetivo    = req.query.codPeriodoLetivo    || 261;
        if (!codClasse) return res.status(400).json({ erro: 'codClasse é obrigatório' });

        try {
                const authToken = await getValidToken();

                // 1. Buscar lista de aulas da classe via frequenciaAulas
                const freqResp = await rcoGet(
                        `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`,
                        authToken
                );
                const alunosFreq = Array.isArray(freqResp.data) ? freqResp.data : [];
                const aulaSet = new Set();
                alunosFreq.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));
                const codAulas = [...aulaSet].sort((a, b) => parseInt(a) - parseInt(b));

                if (!codAulas.length) return res.json([]);

                // 2. Buscar detalhes de cada aula em paralelo (max 10 simultâneos)
                const BATCH = 10;
                const todasObs = [];
                for (let i = 0; i < codAulas.length; i += BATCH) {
                        const lote = codAulas.slice(i, i + BATCH);
                        const resultados = await Promise.all(lote.map(async (cod) => {
                                try {
                                        const r = await rcoGet(
                                                `/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPeriodoLetivo}`,
                                                authToken
                                        );
                                        const aula    = r.data?.aula || {};
                                        const alunos  = aula.alunos || [];
                                        const dataAula = aula.dataAula ? aula.dataAula.substring(0, 10) : null;
                                        return alunos
                                                .filter(a => a.observacao && a.observacao.trim())
                                                .map(a => ({
                                                        cod_aula:         parseInt(cod),
                                                        cod_classe:       parseInt(codClasse),
                                                        cod_matriz_aluno: a.codMatrizAluno,
                                                        nome_aluno:       a.nome || '',
                                                        num_chamada:      a.numChamada || null,
                                                        data_aula:        dataAula,
                                                        observacao:       a.observacao.trim(),
                                                }));
                                } catch { return []; }
                        }));
                        resultados.forEach(r => todasObs.push(...r));
                }

                // 3. Upsert no Supabase (sobrescreve se já existir)
                if (todasObs.length > 0) {
                        await supabaseAdmin.from('rco_observacoes')
                                .upsert(todasObs, { onConflict: 'cod_aula,cod_matriz_aluno' });
                }

                // 4. Retornar todas as observações da classe (do Supabase)
                const { data: dbObs, error } = await supabaseAdmin
                        .from('rco_observacoes')
                        .select('*')
                        .eq('cod_classe', parseInt(codClasse))
                        .order('data_aula', { ascending: false });

                if (error) return res.status(500).json({ erro: error.message });
                res.json(dbObs || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ==================== COMPORTAMENTO & RECONHECIMENTO (Supabase) ====================

// GET /api/comportamento?codTurma=X — todas as ocorrências da turma
app.get('/api/comportamento', async (req, res) => {
        const { codTurma } = req.query;
        try {
                let query = supabaseAdmin
                        .from('aluno_ocorrencias')
                        .select('*')
                        .order('data', { ascending: false })
                        .order('criado_em', { ascending: false });
                if (codTurma) query = query.eq('cod_turma', parseInt(codTurma));
                const { data, error } = await query;
                if (error) return res.status(500).json({ erro: error.message });
                res.json(data || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// POST /api/comportamento — registrar nova ocorrência
app.post('/api/comportamento', async (req, res) => {
        const { cod_matriz_aluno, cod_turma, nome_aluno, num_chamada,
                data, tipo, categoria, categoria_label, descricao, pontos } = req.body;
        if (!cod_matriz_aluno || !cod_turma || !tipo || !categoria) {
                return res.status(400).json({ erro: 'Campos obrigatórios ausentes' });
        }
        try {
                const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                const { error } = await supabaseAdmin.from('aluno_ocorrencias').insert({
                        id, cod_matriz_aluno, cod_turma, nome_aluno: nome_aluno || '',
                        num_chamada: num_chamada || null,
                        data: data || new Date().toISOString().split('T')[0],
                        tipo, categoria, categoria_label: categoria_label || categoria,
                        descricao: descricao || '', pontos: pontos || 0,
                });
                if (error) return res.status(500).json({ erro: error.message });
                const { data: row } = await supabaseAdmin.from('aluno_ocorrencias').select('*').eq('id', id).single();
                res.json(row);
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

// DELETE /api/comportamento/:id — excluir ocorrência
app.delete('/api/comportamento/:id', async (req, res) => {
        try {
                const { error } = await supabaseAdmin.from('aluno_ocorrencias').delete().eq('id', req.params.id);
                if (error) return res.status(500).json({ erro: error.message });
                res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get("*", (req, res) => {
        res.sendFile(path.join(__dirname, "../frontend/index.html"));
});
