import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

// Health checks — registrados antes de qualquer middleware pesado
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.redirect('/app'));

// Servidor sobe imediatamente para não travar o health check
const PORT = 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Frontend: http://localhost:${PORT}/app`);
    console.log(`API: http://localhost:${PORT}/api`);
    initializeApp();
});

async function initializeApp() {
    try {
        console.log('Carregando dependências...');

        // Configurações e serviços (lazy import para não atrasar o boot)
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
        const deps = { supabase, supabaseAdmin, tokenService, rcoApiService, syncService, presencaService };

        app.use(cors());
        app.use(express.json());
        app.get('/app', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
        app.use(express.static(path.join(__dirname, '../frontend')));
        app.use('/api', createApiRouter(deps));
        app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

        console.log('Dependências e rotas carregadas com sucesso!');

        // Sync inicial e agendamento
        await syncService.sincronizarComSupabase().catch(e => console.warn('[SYNC] Falha no sync inicial:', e.message));
        setInterval(() => {
            syncService.sincronizarComSupabase().catch(e => console.warn('[SYNC] Falha no sync periódico:', e.message));
        }, 6 * 60 * 60 * 1000);

        // Agendar sync de presença nos horários fixos
        setTimeout(() => presencaService.agendarSyncPresenca(), 5000);

    } catch (error) {
        console.error('Erro ao inicializar aplicação:', error.message);
    }
}
