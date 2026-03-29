/**
 * Rotas de autenticação multi-usuário.
 * Cada usuário faz login com seu próprio CPF + senha do RCO.
 * O sistema valida no RCO e cria uma sessão independente.
 */
import { Router }           from 'express';
import pg                   from 'pg';
import { userSessionStore } from '../services/UserSessionStore.js';
import { auditLogger }      from '../services/AuditLogger.js';
import { requireAuth, COOKIE_NAME } from '../middleware/auth.middleware.js';

const { Pool } = pg;

function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { return null; }
}

export function createAuthRouter({ tokenService, syncService, loginWithPuppeteer, decodeJwtExpiration }) {
    const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
    const router = Router();

    /* ── Status da conexão global (compatibilidade) ── */
    router.get('/status', (req, res) => {
        const session = req.cookies?.[COOKIE_NAME]
            ? userSessionStore.get(req.cookies[COOKIE_NAME])
            : null;

        if (session) {
            res.json({
                credenciaisConfiguradas: true,
                tokenEmCache:   true,
                tokenExpiracao: null,
                usuarioLogado:  session.toPublic(),
            });
        } else {
            res.json(tokenService.getStatus());
        }
    });

    /* ── Dados do usuário autenticado ── */
    router.get('/me', requireAuth, (req, res) => {
        res.json(req.userSession.toPublic());
    });

    /* ── Login ── */
    router.post('/auth/login', async (req, res) => {
        const { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ erro: 'CPF e senha são obrigatórios.' });
        }

        const cpfLimpo = cpf.replace(/\D/g, '');

        // 1. Verificar se o usuário existe e está ativo
        const { rows } = await pool.query(
            `SELECT id, nome, perfil, ativo FROM edusync_usuarios WHERE cpf = $1`,
            [cpfLimpo],
        );

        const primeiroAcesso = rows.length === 0;

        if (!primeiroAcesso && !rows[0].ativo) {
            return res.status(403).json({ erro: 'Usuário desativado. Contate o administrador.' });
        }

        // 2. Autenticar no RCO
        let rcoToken;
        try {
            rcoToken = await loginWithPuppeteer(cpfLimpo, senha);
        } catch (e) {
            return res.status(401).json({ erro: 'CPF ou senha incorretos (RCO).' });
        }

        // 3. Extrair nome do JWT
        const payload = decodeJwtPayload(rcoToken);
        const nomeRco = payload?.nome || payload?.name || payload?.preferred_username || 'Usuário';

        let userId;
        let perfil;
        let nome;

        if (primeiroAcesso) {
            // Bootstrap: primeiro usuário vira admin automaticamente
            const totalUsuarios = await pool.query('SELECT COUNT(*) FROM edusync_usuarios');
            const isFirst = parseInt(totalUsuarios.rows[0].count, 10) === 0;

            perfil = isFirst ? 'admin' : 'professor';
            nome   = nomeRco;

            const inserted = await pool.query(
                `INSERT INTO edusync_usuarios (nome, cpf, perfil)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (cpf) DO UPDATE SET nome = EXCLUDED.nome
                 RETURNING id, nome, perfil`,
                [nome, cpfLimpo, perfil],
            );
            userId = inserted.rows[0].id;
            nome   = inserted.rows[0].nome;
            perfil = inserted.rows[0].perfil;
            console.log(`[Auth] ${isFirst ? 'Primeiro usuário criado como admin' : 'Novo usuário criado'}: ${nome}`);
        } else {
            userId = rows[0].id;
            nome   = rows[0].nome;
            perfil = rows[0].perfil;
        }

        // 4. Criar sessão e injetar o token já obtido (evita Puppeteer duplo)
        const { sessionId, session } = userSessionStore.create({
            userId, cpf: cpfLimpo, senha, nome, perfil,
            loginFn:  loginWithPuppeteer,
            decodeFn: decodeJwtExpiration,
        });
        session.seedToken(rcoToken, decodeJwtExpiration(rcoToken));

        // 5. Cookie de sessão (HttpOnly, 8h)
        res.cookie(COOKIE_NAME, sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge:   8 * 60 * 60 * 1000,
            secure:   process.env.NODE_ENV === 'production',
        });

        // 6. Audit log
        await auditLogger.registrar({
            usuarioId:   userId,
            usuarioNome: nome,
            acao:        'LOGIN',
            modulo:      'auth',
            ip:          req.ip,
        });

        // 7. Sync em background para este usuário
        syncService.sincronizarComSupabase()
            .catch(e => console.warn('[Auth] Sync pós-login falhou:', e.message));

        res.json({ sucesso: true, usuario: session.toPublic() });
    });

    /* ── Logout ── */
    router.post('/auth/logout', requireAuth, async (req, res) => {
        await auditLogger.registrar({
            usuarioId:   req.userSession.userId,
            usuarioNome: req.userSession.nome,
            acao:        'LOGOUT',
            modulo:      'auth',
            ip:          req.ip,
        });
        userSessionStore.destroy(req.cookies[COOKIE_NAME]);
        res.clearCookie(COOKIE_NAME);
        res.json({ sucesso: true });
    });

    /* ── Compatibilidade: /configurar (redireciona para novo login) ── */
    router.post('/configurar', async (req, res) => {
        const { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ erro: 'CPF e Senha são obrigatórios' });
        }

        const cpfLimpo = cpf.replace(/\D/g, '');
        tokenService.setCredentials(cpfLimpo, senha);

        try {
            await tokenService.getValidToken(true);
            const status = tokenService.getStatus();

            syncService.sincronizarComSupabase()
                .then(r  => console.log('[Auth] Sync pós-login:', r.status))
                .catch(e => console.warn('[Auth] Sync pós-login falhou:', e.message));

            res.json({ sucesso: true, mensagem: 'Credenciais salvas', expiracao: status.tokenExpiracao });
        } catch (error) {
            res.status(500).json({ sucesso: false, erro: error.message });
        }
    });

    return router;
}
