import express      from 'express';
import path         from 'path';
import { fileURLToPath } from 'url';
import { readFileSync }  from 'fs';
import cookieParser from 'cookie-parser';
import helmet       from 'helmet';
import rateLimit    from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

let _pool = null; // set during initializeApp(); used for server-side metadata in /p/ routes

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
app.get('/ficha-aluno', (req, res) => {
    const qs = new URLSearchParams(req.query).toString();
    res.redirect(302, '/pages/ficha-aluno/' + (qs ? '?' + qs : ''));
});
app.get('/ficha-aluno/', (req, res) => {
    const qs = new URLSearchParams(req.query).toString();
    res.redirect(302, '/pages/ficha-aluno/' + (qs ? '?' + qs : ''));
});

// Arquivos estáticos servidos ANTES do listen para evitar "Cannot GET" durante inicialização
// HTML sempre revalidado; assets (CSS/JS/SVG/imagens/fontes) cacheados por 1 hora no browser
app.use(express.static(path.join(__dirname, '../frontend'), {
    setHeaders(res, filePath) {
        if (/\.html?$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(css|js|svg|ico|png|jpe?g|webp|gif|woff2?|ttf|eot|otf|map)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    },
}));
// Nota: /uploads NÃO é exposto publicamente — comprovantes requerem autenticação via /api/passeios/comprovante/:filename

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

// Vídeo de apresentação EduSync — servido a partir do build Vite em /dist
app.use('/video', express.static(path.join(__dirname, '../dist'), {
    setHeaders(res, filePath) {
        if (/\.html?$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(css|js|svg|ico|png|jpe?g|webp|gif|woff2?|ttf|eot|otf)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    },
}));
app.get('/video', (_req, res) => res.redirect('/video/'));
app.get('/video/', (_req, res) => res.sendFile(path.join(__dirname, '../dist/index.html')));

// Página pública de aluno (Passeios) — /p/:eventoId/:alunoToken
// Injects server-side metadata (title, description, OG/Twitter tags) for social previews.
const _pHtmlPath = path.join(__dirname, '../frontend/p/index.html');
const _pHtmlRaw  = readFileSync(_pHtmlPath, 'utf-8');

async function _servePPublicPage(req, res) {
    const { eventoId, alunoToken } = req.params;
    const canonical = `${req.protocol}://${req.get('host')}/p/${eventoId}/${alunoToken}`;

    let title       = 'EduSync — Informações do Aluno';
    let description = 'Acesse as informações de participação do aluno no passeio escolar.';

    if (_pool) {
        try {
            const { rows } = await _pool.query(`
                SELECT ei.nome_aluno, ei.turma,
                       e.nome AS evento_nome, e.destino, e.data_evento
                FROM evento_inscricoes ei
                JOIN eventos e ON e.id = ei.evento_id
                WHERE ei.evento_id = $1 AND ei.aluno_token = $2
                LIMIT 1
            `, [eventoId, alunoToken]);

            if (rows.length) {
                const r = rows[0];
                const dataStr = r.data_evento
                    ? new Date(r.data_evento + 'T12:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
                    : null;
                title = `${r.evento_nome} — ${r.nome_aluno} | EduSync`;
                description = [
                    `Informações de participação de ${r.nome_aluno}`,
                    r.turma ? ` (${r.turma})` : '',
                    ` no passeio ${r.evento_nome}`,
                    r.destino ? ` — destino: ${r.destino}` : '',
                    dataStr ? ` — ${dataStr}` : '',
                    '.',
                ].join('');
            }
        } catch (_) { /* fall through to generic metadata */ }
    }

    const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const origin  = `${req.protocol}://${req.get('host')}`;
    const ogImage = `${origin}/shared/assets/favicon.svg`;
    const metaTags = [
        `<meta name="robots" content="noindex">`,
        `<meta name="description" content="${escAttr(description)}">`,
        `<link rel="canonical" href="${escAttr(canonical)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:title" content="${escAttr(title)}">`,
        `<meta property="og:description" content="${escAttr(description)}">`,
        `<meta property="og:url" content="${escAttr(canonical)}">`,
        `<meta property="og:image" content="${escAttr(ogImage)}">`,
        `<meta name="twitter:card" content="summary">`,
        `<meta name="twitter:title" content="${escAttr(title)}">`,
        `<meta name="twitter:description" content="${escAttr(description)}">`,
        `<meta name="twitter:image" content="${escAttr(ogImage)}">`,
    ].join('\n    ');

    const html = _pHtmlRaw
        .replace('<title>EduSync — Informações do Aluno</title>', `<title>${escAttr(title)}</title>\n    ${metaTags}`);

    res.set('Cache-Control', 'no-cache').type('html').send(html);
}

app.get('/p/:eventoId/:alunoToken',  _servePPublicPage);
app.get('/p/:eventoId/:alunoToken/', _servePPublicPage);

app.get('/p/*', (_req, res) => {
    res.sendFile(_pHtmlPath);
});

// Rota desconhecida — retorna 404 real para evitar soft-404 nos crawlers
app.use((req, res) => {
    res.status(404).send('Not Found');
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
        _pool = localPool;

        // Restaurar contadores de rate-limit por CPF que sobreviveram ao restart
        const { loadCpfRateLimitFromDb } = await import('./src/services/cpfRateLimitStore.js');
        await loadCpfRateLimitFromDb();

        const { supabase, supabaseAdmin }                     = await import('./src/config/supabase.js');
        const { loginWithPuppeteer, decodeJwtExpiration, setLoginConcurrency, setConcurrencyGetter, setProtocolTimeoutGetter } = await import('./auth-puppeteer.js');
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

        // Lembrete: registrar URIs de redirecionamento no Google Cloud Console
        const devHost = process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : `http://localhost:${PORT}`;
        console.log('─────────────────────────────────────────────────────────────');
        console.log('[Google OAuth] URIs que DEVEM estar no Google Cloud Console:');
        console.log(`  Classroom:  ${devHost}/api/classroom/callback`);
        console.log(`  Pedagogo:   ${devHost}/api/auth/pedagogo-google/callback`);
        if (process.env.GOOGLE_REDIRECT_URI) {
            console.log(`  (GOOGLE_REDIRECT_URI override ativo: ${process.env.GOOGLE_REDIRECT_URI})`);
        }
        console.log('  Adicione também o domínio de produção ao implantar.');
        console.log('─────────────────────────────────────────────────────────────');

        // Sync inicial e agendamento
        await syncService.sincronizarComSupabase()
            .catch(e => console.warn('[SYNC] Falha no sync inicial:', e.message));
        setInterval(() => {
            syncService.sincronizarComSupabase()
                .catch(e => console.warn('[SYNC] Falha no sync periódico:', e.message));
        }, 6 * 60 * 60 * 1000);

        // Agendar sync de presença nos horários fixos
        setTimeout(() => presencaService.agendarSyncPresenca(), 5000);

        // Registrar getter de concorrência: lido do banco a cada login (fallback para env/padrão).
        // Também aplica imediatamente o valor salvo para pré-aquecer o semáforo após restart.
        setConcurrencyGetter(async () => {
            const { rows } = await localPool.query(
                `SELECT valor FROM edusync_config WHERE chave = 'puppeteer_login_concurrency' LIMIT 1`
            );
            if (rows.length > 0) {
                const v = parseInt(rows[0].valor, 10);
                return Number.isFinite(v) ? v : null;
            }
            return null;
        });
        // Aplicar imediatamente ao iniciar (sem esperar o primeiro login)
        try {
            const { rows } = await localPool.query(
                `SELECT valor FROM edusync_config WHERE chave = 'puppeteer_login_concurrency' LIMIT 1`
            );
            if (rows.length > 0) {
                const saved = parseInt(rows[0].valor, 10);
                if (Number.isFinite(saved) && saved >= 1 && saved <= 20) {
                    setLoginConcurrency(saved);
                    console.log(`[Puppeteer] Concorrência restaurada do banco: ${saved}`);
                }
            }
        } catch (e) {
            console.warn('[Puppeteer] Não foi possível restaurar concorrência do banco:', e.message);
        }

        // Registrar getter de protocol timeout: lido do banco a cada getBrowser() (fallback para env/padrão).
        setProtocolTimeoutGetter(async () => {
            const { rows } = await localPool.query(
                `SELECT valor FROM edusync_config WHERE chave = 'puppeteer_protocol_timeout' LIMIT 1`
            );
            if (rows.length > 0) {
                const v = parseInt(rows[0].valor, 10);
                return Number.isFinite(v) && v >= 5000 ? v : null;
            }
            return null;
        });

        // Job de purga de dados antigos (audit_log, reputacao_log, notificacoes_aluno)
        const { agendarPurga } = await import('./src/services/purgeJob.js');
        agendarPurga(localPool);

        // Job de alerta de sync parado (verifica usuários sem RCO sync há > N dias)
        const { agendarSyncStaleAlert } = await import('./src/services/syncStaleAlertJob.js');
        agendarSyncStaleAlert(localPool);

        // Monitor de projetos dos grupos (rastreia commits GitHub a cada hora)
        const { iniciarMonitorProjetos } = await import('./src/services/projectMonitorService.js');
        iniciarMonitorProjetos();

    } catch (error) {
        console.error('Erro ao inicializar aplicação:', error.message);
    }
}
