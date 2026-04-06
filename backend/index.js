import express    from 'express';
import path       from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import helmet       from 'helmet';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

// ── Middlewares essenciais: registrados ANTES do servidor ouvir ──────────────
// Garante que req.body, cookies e req.ip estejam disponíveis em qualquer requisição,
// incluindo as que chegam durante a inicialização assíncrona do app.
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());

// Impedir cache de respostas da API no navegador
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    next();
});

// Health checks registrados antes de qualquer middleware pesado
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/',       (_req, res) => res.redirect('/login/'));

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

        // Inicializar banco de dados (tabelas de usuários e audit log)
        const { initializeDatabase }    = await import('./src/config/dbInit.js');
        await initializeDatabase();

        // Serviços e configurações
        const { supabase, supabaseAdmin }                     = await import('./src/config/supabase.js');
        const { loginWithPuppeteer, decodeJwtExpiration }     = await import('./auth-puppeteer.js');
        const { tokenService }                                = await import('./src/services/TokenService.js');
        const { rcoApiService }                               = await import('./src/services/RcoApiService.js');
        const { syncService }                                 = await import('./src/services/SyncService.js');
        const { presencaService }                             = await import('./src/services/PresencaService.js');

        // Injeção de dependências
        tokenService.initialize(loginWithPuppeteer, decodeJwtExpiration);
        rcoApiService.initialize(tokenService);
        syncService.initialize(supabaseAdmin, rcoApiService);
        presencaService.initialize(supabaseAdmin, rcoApiService);

        // Registro de rotas com dependências injetadas
        const { createApiRouter } = await import('./src/routes/index.js');
        const deps = {
            supabase, supabaseAdmin,
            tokenService, rcoApiService, syncService, presencaService,
            loginWithPuppeteer, decodeJwtExpiration,   // necessário para UserSession nas rotas de auth
        };

        // Redirecionar URLs antigas (.html) para nova estrutura de pastas
        const paginasRedirect = [
            'dashboard', 'frequencias', 'crachas', 'comportamento',
            'presenca', 'grupos', 'materiais', 'emprestimos', 'cozinha', 'quiosque',
        ];
        paginasRedirect.forEach(p => {
            app.get(`/${p}.html`, (req, res) => res.redirect(301, `/pages/${p}/`));
        });

        // Rota raiz do app redireciona para login
        app.get('/app', (_req, res) => res.redirect('/login/'));

        app.use(express.static(path.join(__dirname, '../frontend')));
        app.use('/api', createApiRouter(deps));

        // SPA fallback
        app.get('*', (req, res) => {
            // Se a rota começa com /pages/ serve as páginas normalmente
            res.sendFile(path.join(__dirname, '../frontend/index.html'));
        });

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
