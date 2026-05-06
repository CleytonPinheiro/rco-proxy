import express      from 'express';
import path         from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import helmet       from 'helmet';
import rateLimit    from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

// ── Middlewares essenciais: registrados ANTES do servidor ouvir ──────────────
// Garante que req.body, cookies e req.ip estejam disponíveis em qualquer requisição,
// incluindo as que chegam durante a inicialização assíncrona do app.
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Impedir cache de respostas da API no navegador
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    next();
});

// Rate limiting — Portal do Aluno: 60 req/min por IP
const alunosPortalLimiter = rateLimit({
    windowMs:        60 * 1000,
    max:             60,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { erro: 'Muitas requisições. Aguarde um momento e tente novamente.' },
    skip:            (req) => req.path === '/api/alunos-portal/status',
});
app.use('/api/alunos-portal', alunosPortalLimiter);

// Rate limiting — Portal Pedagógico: 60 req/min por IP
const pedagogoPortalLimiter = rateLimit({
    windowMs:        60 * 1000,
    max:             60,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { erro: 'Muitas requisições. Aguarde um momento e tente novamente.' },
    skip:            (req) => req.path === '/api/pedagogico-portal/status',
});
app.use('/api/pedagogico-portal', pedagogoPortalLimiter);

// Rate limiting — Login dos portais (anti força-bruta): 10 req/min por IP
const loginLimiter = rateLimit({
    windowMs:        60 * 1000,
    max:             10,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { erro: 'Muitas tentativas de login. Aguarde um momento.' },
});
app.use('/api/alunos-portal/auth-url', loginLimiter);
app.use('/api/alunos-portal/callback', loginLimiter);
app.use('/api/pedagogico-portal/auth-url', loginLimiter);
app.use('/api/pedagogico-portal/callback', loginLimiter);

// Health checks registrados antes de qualquer middleware pesado
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/',       (_req, res) => res.redirect('/login/'));

// Redirecionar URLs antigas (.html) para nova estrutura de pastas
const paginasRedirect = [
    'dashboard', 'frequencias', 'crachas', 'comportamento',
    'presenca', 'grupos', 'materiais', 'emprestimos', 'cozinha', 'quiosque',
];
paginasRedirect.forEach(p => {
    app.get(`/${p}.html`, (req, res) => res.redirect(301, `/pages/${p}/`));
});
app.get('/app', (_req, res) => res.redirect('/login/'));

// Arquivos estáticos servidos ANTES do listen para evitar "Cannot GET" durante inicialização
app.use(express.static(path.join(__dirname, '../frontend')));

// API router placeholder — preenchido após inicialização assíncrona
import { Router } from 'express';
const apiRouter = Router();
apiRouter.use((req, res, next) => {
    if (!apiRouter._ready) {
        return res.status(503).json({ erro: 'Servidor inicializando, tente novamente em instantes.' });
    }
    next();
});
app.use('/api', apiRouter);

// SPA fallback (deve vir DEPOIS do static e API)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Servidor sobe imediatamente para não travar o health check
const PORT = 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Frontend: http://localhost:${PORT}/login/`);
    console.log(`API: http://localhost:${PORT}/api`);
    initializeApp();
});

async function initializeApp() {
    try {
        console.log('Carregando dependências...');

        const { initializeDatabase, pool: localPool } = await import('./src/config/dbInit.js');
        await initializeDatabase();

        const { supabase, supabaseAdmin }                     = await import('./src/config/supabase.js');
        const { loginWithPuppeteer, decodeJwtExpiration }     = await import('./auth-puppeteer.js');
        const { tokenService }                                = await import('./src/services/TokenService.js');
        const { rcoApiService }                               = await import('./src/services/RcoApiService.js');
        const { syncService }                                 = await import('./src/services/SyncService.js');
        const { presencaService }                             = await import('./src/services/PresencaService.js');

        tokenService.initialize(loginWithPuppeteer, decodeJwtExpiration);
        rcoApiService.initialize(tokenService);
        syncService.initialize(supabaseAdmin, rcoApiService, localPool);
        presencaService.initialize(supabaseAdmin, rcoApiService);

        const { createApiRouter } = await import('./src/routes/index.js');
        const deps = {
            supabase, supabaseAdmin,
            tokenService, rcoApiService, syncService, presencaService,
            loginWithPuppeteer, decodeJwtExpiration,
        };

        apiRouter.use(createApiRouter(deps));
        apiRouter._ready = true;

        console.log('Dependências e rotas carregadas com sucesso!');

        // Sync inicial e agendamento
        await syncService.sincronizarComSupabase()
            .catch(e => console.warn('[SYNC] Falha no sync inicial:', e.message));
        setInterval(() => {
            syncService.sincronizarComSupabase()
                .catch(e => console.warn('[SYNC] Falha no sync periódico:', e.message));
        }, 6 * 60 * 60 * 1000);

        // Agendar sync de presença nos horários fixos
        setTimeout(() => presencaService.agendarSyncPresenca(), 5000);

    } catch (error) {
        console.error('Erro ao inicializar aplicação:', error.message);
    }
}
