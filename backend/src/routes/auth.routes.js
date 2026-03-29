/**
 * Rotas de autenticação multi-usuário.
 * Cada usuário faz login com seu próprio CPF + senha do RCO.
 * O sistema valida no RCO e cria uma sessão independente.
 *
 * Whitelist de escolas:
 *   - Se `edusync_escolas` estiver vazia → cadastro aberto (comportamento legado)
 *   - Se houver registros → somente docentes dos estabelecimentos autorizados se cadastram
 */
import { Router }           from 'express';
import pg                   from 'pg';
import axios                from 'axios';
import { rateLimit }        from 'express-rate-limit';
import { userSessionStore } from '../services/UserSessionStore.js';
import { auditLogger }      from '../services/AuditLogger.js';
import { requireAuth, COOKIE_NAME } from '../middleware/auth.middleware.js';

const { Pool } = pg;
const RCO_BASE = 'https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1';

function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { return null; }
}

/**
 * Consulta a API do RCO com o token do próprio docente
 * e retorna os códigos de estabelecimento onde ele leciona.
 * Retorna array vazio em caso de falha (não bloqueia o login).
 */
async function buscarEstabelecimentosDocente(rcoToken) {
    try {
        const { dataBrasilia } = await import('../config/dateUtils.js');
        const hoje = dataBrasilia();
        const resp = await axios.get(
            `${RCO_BASE}/educador/estabelecimentos/v2/${hoje}`,
            {
                headers:        { consumerId: 'RCDIGWEB', Authorization: `Bearer ${rcoToken}` },
                timeout:        12_000,
                validateStatus: () => true,
            },
        );
        if (resp.status !== 200) return [];
        const raw = resp.data;
        const estabs = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        return estabs.map(e => e.codEstabelecimento).filter(Boolean);
    } catch (err) {
        console.warn('[Auth] Não foi possível consultar estabelecimentos do docente:', err.message);
        return [];
    }
}

/* ── Rate limit: máx 5 tentativas por IP a cada 15 minutos ── */
const loginRateLimit = rateLimit({
    windowMs:               15 * 60 * 1000,
    max:                    5,
    standardHeaders:        true,
    legacyHeaders:          false,
    message:                { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' },
    skipSuccessfulRequests: true,
});

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
    router.post('/auth/login', loginRateLimit, async (req, res) => {
        const { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ erro: 'CPF e senha são obrigatórios.' });
        }

        const cpfLimpo = cpf.replace(/\D/g, '');

        // 1. Verificar se o usuário já existe na base local
        let existentes;
        try {
            ({ rows: existentes } = await pool.query(
                `SELECT id, nome, perfil, ativo FROM edusync_usuarios WHERE cpf = $1`,
                [cpfLimpo],
            ));
        } catch (dbErr) {
            console.error('[Auth] Erro de banco no login:', dbErr.message);
            return res.status(503).json({ erro: 'Serviço temporariamente indisponível.' });
        }

        const primeiroAcesso = existentes.length === 0;

        if (!primeiroAcesso && !existentes[0].ativo) {
            return res.status(403).json({ erro: 'Usuário desativado. Contate o administrador.' });
        }

        // 2. Autenticar no RCO — Puppeteer valida as credenciais
        let rcoToken;
        try {
            rcoToken = await loginWithPuppeteer(cpfLimpo, senha);
        } catch {
            return res.status(401).json({ erro: 'CPF ou senha incorretos (RCO).' });
        }

        // 3. Extrair nome do JWT do RCO
        const payload = decodeJwtPayload(rcoToken);
        const nomeRco = payload?.nome || payload?.name || payload?.preferred_username || 'Usuário';

        let userId, perfil, nome;

        if (primeiroAcesso) {
            // Consultar contagem de usuários e whitelist de escolas em paralelo
            let totalRows, escolasRows;
            try {
                [{ rows: totalRows }, { rows: escolasRows }] = await Promise.all([
                    pool.query('SELECT COUNT(*) AS total FROM edusync_usuarios'),
                    pool.query(
                        `SELECT id, nome, codigo_estabelecimento
                         FROM edusync_escolas
                         WHERE ativo = true AND permite_auto_cadastro = true`,
                    ),
                ]);
            } catch (dbErr) {
                console.error('[Auth] Erro de banco (whitelist):', dbErr.message);
                return res.status(503).json({ erro: 'Serviço temporariamente indisponível.' });
            }

            const totalUsuarios = parseInt(totalRows[0].total, 10);
            const isFirstUser   = totalUsuarios === 0;

            // Se não é o primeiro usuário E há escolas na whitelist → verificar vínculo
            if (!isFirstUser && escolasRows.length > 0) {
                const codigosPermitidos = escolasRows.map(e => e.codigo_estabelecimento);
                const codigosDocente    = await buscarEstabelecimentosDocente(rcoToken);
                const escolaEncontrada  = escolasRows.find(e =>
                    codigosDocente.includes(e.codigo_estabelecimento),
                );

                if (!escolaEncontrada) {
                    return res.status(403).json({
                        erro: 'Sua escola não está autorizada neste sistema. Contate o administrador.',
                        codigosDocente,   // ajuda no diagnóstico pelo admin
                        codigosPermitidos,
                    });
                }
                console.log(`[Auth] Docente autorizado via escola: ${escolaEncontrada.nome} (${escolaEncontrada.codigo_estabelecimento})`);
            }

            // Cadastrar usuário (primeiro = admin, demais = professor)
            perfil = isFirstUser ? 'admin' : 'professor';
            nome   = nomeRco;

            let inserted;
            try {
                ({ rows: [inserted] } = await pool.query(
                    `INSERT INTO edusync_usuarios (nome, cpf, perfil)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (cpf) DO UPDATE SET nome = EXCLUDED.nome
                     RETURNING id, nome, perfil`,
                    [nome, cpfLimpo, perfil],
                ));
            } catch (dbErr) {
                console.error('[Auth] Erro ao inserir usuário:', dbErr.message);
                return res.status(503).json({ erro: 'Serviço temporariamente indisponível.' });
            }

            userId = inserted.id;
            nome   = inserted.nome;
            perfil = inserted.perfil;
            console.log(`[Auth] ${isFirstUser ? 'Admin criado (bootstrap)' : 'Novo professor cadastrado'}: ${nome}`);
        } else {
            userId = existentes[0].id;
            nome   = existentes[0].nome;
            perfil = existentes[0].perfil;
        }

        // 4. Criar sessão e injetar token já obtido (evita Puppeteer duplo)
        const { sessionId, session } = userSessionStore.create({
            userId, cpf: cpfLimpo, senha, nome, perfil,
            loginFn:  loginWithPuppeteer,
            decodeFn: decodeJwtExpiration,
        });
        session.seedToken(rcoToken, decodeJwtExpiration(rcoToken));

        // 5. Cookie de sessão — HttpOnly, 8h, secure via trust proxy
        res.cookie(COOKIE_NAME, sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge:   8 * 60 * 60 * 1000,
            secure:   req.secure,
        });

        // 6. Audit log
        await auditLogger.registrar({
            usuarioId:   userId,
            usuarioNome: nome,
            acao:        'LOGIN',
            modulo:      'auth',
            ip:          req.ip,
        });

        // 7. Sync em background
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
        res.clearCookie(COOKIE_NAME, {
            httpOnly: true,
            sameSite: 'lax',
            secure:   req.secure,
        });
        res.json({ sucesso: true });
    });

    /* ── Compatibilidade: /configurar (requer autenticação) ── */
    router.post('/configurar', requireAuth, async (req, res) => {
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
                .then(r  => console.log('[Auth] Sync pós-configurar:', r.status))
                .catch(e => console.warn('[Auth] Sync pós-configurar falhou:', e.message));

            res.json({ sucesso: true, mensagem: 'Credenciais salvas', expiracao: status.tokenExpiracao });
        } catch (error) {
            res.status(500).json({ sucesso: false, erro: error.message });
        }
    });

    return router;
}
