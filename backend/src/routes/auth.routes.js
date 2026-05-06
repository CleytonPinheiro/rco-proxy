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
import { google }           from 'googleapis';
import { userSessionStore } from '../services/UserSessionStore.js';
import { auditLogger }      from '../services/AuditLogger.js';
import { requireAuth, COOKIE_NAME } from '../middleware/auth.middleware.js';
import { resolverPlano }    from '../config/planos.js';
import { getLoginQueueStats } from '../../auth-puppeteer.js';

/* ── Feature flag: pedagogo pode entrar via Google OAuth sem token RCO ── */
const PEDAGOGICO_RCO_REQUERIDO = process.env.PEDAGOGICO_RCO_REQUERIDO !== 'false';
console.log(`[Auth] PEDAGOGICO_RCO_REQUERIDO=${PEDAGOGICO_RCO_REQUERIDO}`);

/* ── Domínios permitidos para login pedagógico via Google ── */
const DOMINIOS_PEDAGOGO = ['escola.pr.gov.br', 'seed.pr.gov.br'];

/* ── Estado temporário de OAuth (em memória, TTL 10 min) ── */
const _oauthStates = new Map(); // state → { ip, createdAt }
setInterval(() => {
    const now = Date.now();
    for (const [state, entry] of _oauthStates) {
        if (now - entry.createdAt > 10 * 60 * 1000) _oauthStates.delete(state);
    }
}, 60_000).unref();

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

/* ── Rate limits configuráveis via env ── */
const RL_IP_JANELA  = parseInt(process.env.RL_LOGIN_IP_JANELA_MS  || String(5 * 60 * 1000), 10);  // default 5 min
const RL_IP_MAX     = parseInt(process.env.RL_LOGIN_IP_MAX         || '10', 10);                   // default 10 req / janela
const RL_CPF_JANELA = parseInt(process.env.RL_LOGIN_CPF_JANELA_MS || String(15 * 60 * 1000), 10); // default 15 min
const RL_CPF_MAX    = parseInt(process.env.RL_LOGIN_CPF_MAX        || '5', 10);                    // default 5 falhas / janela

/* ── Rate limit por IP: conta TODAS as tentativas (sucesso + falha) ── */
const loginIpRateLimit = rateLimit({
    windowMs:        RL_IP_JANELA,
    max:             RL_IP_MAX,
    standardHeaders: true,
    legacyHeaders:   false,
    handler: async (req, res) => {
        // Usar resetTime do próprio middleware para Retry-After preciso; fallback à janela inteira
        const resetMs       = req.rateLimit?.resetTime instanceof Date
            ? req.rateLimit.resetTime.getTime() - Date.now()
            : RL_IP_JANELA;
        const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1000));
        res.set('Retry-After', String(retryAfterSec));
        auditLogger.registrar({
            usuarioId:   null,
            usuarioNome: 'Sistema',
            acao:        'LOGIN_BLOQUEADO_IP',
            modulo:      'auth',
            detalhes:    { ip: req.ip, limite: RL_IP_MAX, janela_min: Math.ceil(RL_IP_JANELA / 60000) },
            ip:          req.ip,
        }).catch(() => {});
        res.status(429).json({
            erro: `Muitas tentativas de login deste endereço. Aguarde ${Math.ceil(retryAfterSec / 60)} minuto(s) e tente novamente.`,
        });
    },
});

/* ── Contador de falhas por CPF (em memória) ── */
const cpfFailureStore = new Map();

// Padrão de erros de infraestrutura que NÃO devem penalizar o CPF
const INFRA_ERROR_RE = /timeout|network|navigation|net::|EPIPE|ECONNRESET|ENOTFOUND|Protocol error|Target closed|Page crashed/i;

function _cpfEntry(cpf) {
    const entry = cpfFailureStore.get(cpf);
    if (!entry || Date.now() >= entry.resetAt) return null;
    return entry;
}

function cpfFailureCount(cpf)       { return _cpfEntry(cpf)?.count ?? 0; }
function cpfFailureResetAt(cpf)     { return _cpfEntry(cpf)?.resetAt ?? Date.now(); }
function cpfFailureClear(cpf)       { cpfFailureStore.delete(cpf); }

function cpfFailureIncrement(cpf) {
    const now   = Date.now();
    const entry = cpfFailureStore.get(cpf);
    if (!entry || now >= entry.resetAt) {
        cpfFailureStore.set(cpf, { count: 1, resetAt: now + RL_CPF_JANELA });
    } else {
        entry.count += 1;
    }
}

// Poda periódica de entradas expiradas para evitar crescimento ilimitado em ataques com CPFs aleatórios
setInterval(() => {
    const now = Date.now();
    for (const [cpf, entry] of cpfFailureStore) {
        if (now >= entry.resetAt) cpfFailureStore.delete(cpf);
    }
}, RL_CPF_JANELA).unref();

/**
 * Retorna snapshot do estado atual de rate-limit por CPF.
 * Filtra entradas expiradas antes de retornar.
 * Usado pelo painel de admin.
 */
export function getCpfRateLimitSnapshot() {
    const now = Date.now();
    const result = [];
    for (const [cpf, entry] of cpfFailureStore) {
        if (now >= entry.resetAt) continue;
        result.push({
            cpf,
            count:        entry.count,
            bloqueado:    entry.count >= RL_CPF_MAX,
            resetAt:      entry.resetAt,
            segundosAte:  Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
        });
    }
    result.sort((a, b) => b.count - a.count);
    return { entradas: result, limite: RL_CPF_MAX, janelaMin: Math.ceil(RL_CPF_JANELA / 60000) };
}

/**
 * Limpa o contador de rate-limit de um CPF específico.
 * Usado pelo painel de admin para desbloquear manualmente um usuário.
 */
export function clearCpfRateLimit(cpf) {
    return cpfFailureStore.delete(cpf);
}

/* ── Helper: cria OAuth2Client para login pedagógico (userinfo only) ── */
function _pedagogoOAuth2Client(req) {
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/pedagogo-google/callback`;
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/* ── Helper: executa migração de email na tabela de usuários (idempotente) ── */
async function _garantirColunaEmail(pool) {
    await pool.query(`ALTER TABLE edusync_usuarios ADD COLUMN IF NOT EXISTS email TEXT`).catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS edusync_usuarios_email_uq ON edusync_usuarios (email) WHERE email IS NOT NULL`).catch(() => {});
}
let _emailMigrado = false;
async function garantirColunaEmail(pool) {
    if (_emailMigrado) return;
    await _garantirColunaEmail(pool);
    _emailMigrado = true;
}

export function createAuthRouter({ tokenService, syncService, loginWithPuppeteer, decodeJwtExpiration }) {
    const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
    const router = Router();

    // Tratar erros inesperados do pool (ex: "terminating connection due to administrator command")
    // sem handler, o evento 'error' mata o processo inteiro
    pool.on('error', (err) => {
        console.error('[Auth] Erro inesperado no pool PostgreSQL:', err.message);
    });

    /* ── Status da fila de logins (público — sem auth) ── */
    router.get('/auth/queue-status', (req, res) => {
        const stats = getLoginQueueStats();
        res.json({
            ativa:     stats.active,
            maxSlots:  stats.maxSlots,
            aguardando: stats.queued,
            ocupado:   stats.active >= stats.maxSlots,
        });
    });

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
    router.get('/me', requireAuth, async (req, res) => {
        const base = req.userSession.toPublic();
        try {
            const { getMapaPermissoesEfetivas, getModulosEmDesenvolvimento, MODULO_PAI } = await import('../config/permissions.js');
            base.permissoesPerfis           = getMapaPermissoesEfetivas();
            base.modulosEmDesenvolvimento   = getModulosEmDesenvolvimento();
            base.modulosPai                 = MODULO_PAI;
        } catch {}
        res.json(base);
    });

    /* ── Login ── */
    router.post('/auth/login', loginIpRateLimit, async (req, res) => {
        const { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ erro: 'CPF e senha são obrigatórios.' });
        }

        const cpfLimpo = cpf.replace(/\D/g, '');

        // 0. Verificar limite de falhas por CPF
        if (cpfFailureCount(cpfLimpo) >= RL_CPF_MAX) {
            const retryAfterSec = Math.max(1, Math.ceil((cpfFailureResetAt(cpfLimpo) - Date.now()) / 1000));
            res.set('Retry-After', String(retryAfterSec));
            auditLogger.registrar({
                usuarioId:   null,
                usuarioNome: 'Desconhecido',
                acao:        'LOGIN_BLOQUEADO_CPF',
                modulo:      'auth',
                detalhes:    { cpf: cpfLimpo, limite: RL_CPF_MAX, janela_min: Math.ceil(RL_CPF_JANELA / 60000) },
                ip:          req.ip,
            }).catch(() => {});
            return res.status(429).json({
                erro: `Muitas tentativas incorretas para este usuário. Aguarde ${Math.ceil(retryAfterSec / 60)} minuto(s) e tente novamente.`,
            });
        }

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
        } catch (loginErr) {
            if (loginErr.message === 'PUPPETEER_LOGIN_QUEUE_TIMEOUT') {
                const qStats = getLoginQueueStats();
                res.set('Retry-After', '15');
                return res.status(503).json({
                    erro:      'Servidor ocupado com muitos logins simultâneos. Aguarde e tente novamente.',
                    tipo:      'fila_cheia',
                    fila:      { ativa: qStats.active, maxSlots: qStats.maxSlots, aguardando: qStats.queued },
                    retentar:  15,
                });
            }
            // Incrementar contador apenas para erros de credencial; erros de infra não penalizam o CPF
            if (!INFRA_ERROR_RE.test(loginErr.message)) {
                cpfFailureIncrement(cpfLimpo);
            }
            if (cpfFailureCount(cpfLimpo) >= RL_CPF_MAX) {
                // Primeira vez que atinge o limite → registrar no audit log
                auditLogger.registrar({
                    usuarioId:   null,
                    usuarioNome: 'Desconhecido',
                    acao:        'LOGIN_BLOQUEADO_CPF',
                    modulo:      'auth',
                    detalhes:    { cpf: cpfLimpo, limite: RL_CPF_MAX, janela_min: Math.ceil(RL_CPF_JANELA / 60000) },
                    ip:          req.ip,
                }).catch(() => {});
            }
            return res.status(401).json({ erro: 'CPF ou senha incorretos (RCO).' });
        }

        // Autenticação bem-sucedida: zerar contador de falhas deste CPF
        cpfFailureClear(cpfLimpo);

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

        // 4b. Carregar plano do usuário e/ou da escola vinculada
        try {
            const { rows: [userPlano] } = await pool.query(
                `SELECT plano, plano_inicio, plano_renovacao, plano_obs FROM edusync_usuarios WHERE id = $1`,
                [userId],
            );
            let escolaPlano = null;
            const codigosDocente = await buscarEstabelecimentosDocente(rcoToken);
            if (codigosDocente.length > 0) {
                const { rows: escolasDoDocente } = await pool.query(
                    `SELECT plano, plano_inicio FROM edusync_escolas
                     WHERE ativo = true AND plano IS NOT NULL
                       AND codigo_estabelecimento = ANY($1)
                     ORDER BY CASE plano WHEN 'rede' THEN 1 WHEN 'profissional' THEN 2 WHEN 'inicial' THEN 3 ELSE 4 END
                     LIMIT 1`,
                    [codigosDocente],
                );
                if (escolasDoDocente.length > 0) escolaPlano = escolasDoDocente[0];
            }

            const planoInfo = resolverPlano(userPlano, escolaPlano);
            session.setPlanoInfo(planoInfo);
        } catch (planoErr) {
            console.warn('[Auth] Falha ao carregar plano:', planoErr.message);
        }

        // 5. Cookie de sessão — session cookie (sem maxAge/expires).
        //    O browser apaga automaticamente ao fechar; não persiste em disco.
        //    Expiração server-side por inatividade é controlada pelo UserSessionStore (8h).
        res.cookie(COOKIE_NAME, sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            secure:   req.secure,
            // sem maxAge → session cookie → deletado ao fechar o browser
        });

        // 6. Audit log
        await auditLogger.registrar({
            usuarioId:   userId,
            usuarioNome: nome,
            acao:        'LOGIN',
            modulo:      'auth',
            ip:          req.ip,
        });

        // 7. Sync em background — respeita TTL; só executa se cache expirado
        syncService.sincronizarSeNecessario(userId)
            .catch(e => console.warn('[Auth] Sync pós-login falhou:', e.message));

        res.json({ sucesso: true, usuario: session.toPublic() });
    });

    /* ── Pedagogo Google OAuth — URL de autorização ── */
    router.get('/auth/pedagogo-google/url', async (req, res) => {
        if (PEDAGOGICO_RCO_REQUERIDO) {
            return res.status(403).json({
                erro: 'Login via Google para pedagogo não está habilitado nesta instalação. Contate o administrador.',
            });
        }

        const oauth2Client = _pedagogoOAuth2Client(req);
        if (!oauth2Client) {
            return res.status(503).json({ erro: 'Credenciais Google não configuradas.' });
        }

        const state = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        _oauthStates.set(state, { ip: req.ip, createdAt: Date.now() });

        const url = oauth2Client.generateAuthUrl({
            access_type: 'online',
            scope:       ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
            prompt:      'select_account',
            state,
        });

        res.json({ url });
    });

    /* ── Pedagogo Google OAuth — callback ── */
    router.get('/auth/pedagogo-google/callback', async (req, res) => {
        const { code, state, error } = req.query;

        if (error) {
            return res.redirect('/login/?erro=google_cancelado');
        }

        if (PEDAGOGICO_RCO_REQUERIDO) {
            return res.redirect('/login/?erro=pedagogo_rco_requerido');
        }

        if (!state || !_oauthStates.has(state)) {
            return res.redirect('/login/?erro=estado_invalido');
        }
        _oauthStates.delete(state);

        const oauth2Client = _pedagogoOAuth2Client(req);
        if (!oauth2Client) {
            return res.redirect('/login/?erro=google_nao_configurado');
        }

        let googleEmail, googleNome;
        try {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const { data: userInfo } = await oauth2.userinfo.get();
            googleEmail = (userInfo.email || '').toLowerCase();
            googleNome  = userInfo.name  || googleEmail.split('@')[0];
        } catch (e) {
            console.error('[Auth] Erro ao obter userinfo Google (pedagogo):', e.message);
            return res.redirect('/login/?erro=google_falha');
        }

        /* Verificar domínio do email */
        const dominioOk = DOMINIOS_PEDAGOGO.some(d => googleEmail.endsWith(`@${d}`));
        if (!dominioOk) {
            console.warn(`[Auth] Email não autorizado para login pedagógico: ${googleEmail}`);
            return res.redirect(`/login/?erro=email_dominio_invalido&email=${encodeURIComponent(googleEmail)}`);
        }

        /* Garantir coluna email na tabela */
        try { await garantirColunaEmail(pool); } catch (_) {}

        /* Buscar ou criar usuário pedagogo */
        let userId, nome, perfil, ativo;
        try {
            const { rows } = await pool.query(
                `SELECT id, nome, perfil, ativo FROM edusync_usuarios WHERE email = $1`,
                [googleEmail],
            );

            if (rows.length > 0) {
                ({ id: userId, nome, perfil, ativo } = rows[0]);
                if (!ativo) return res.redirect('/login/?erro=usuario_desativado');
                if (perfil !== 'pedagogo') {
                    console.warn(`[Auth] Perfil '${perfil}' não pode usar login pedagógico via Google: ${googleEmail}`);
                    return res.redirect('/login/?erro=perfil_incompativel');
                }
            } else {
                /* Novo usuário — criar com perfil pedagogo */
                const { rows: [inserted] } = await pool.query(
                    `INSERT INTO edusync_usuarios (nome, cpf, perfil, email)
                     VALUES ($1, $2, 'pedagogo', $3)
                     RETURNING id, nome, perfil`,
                    [googleNome, `oauth_${googleEmail}`, googleEmail],
                );
                ({ id: userId, nome, perfil } = inserted);
                console.log(`[Auth] Novo pedagogo criado via Google OAuth: ${googleNome} <${googleEmail}>`);
            }
        } catch (dbErr) {
            console.error('[Auth] Erro ao buscar/criar pedagogo:', dbErr.message);
            return res.redirect('/login/?erro=banco_falha');
        }

        /* Criar sessão SEM token RCO */
        const { sessionId, session } = userSessionStore.create({
            userId,
            cpf:    `oauth_${googleEmail}`,
            senha:  null,
            nome,
            perfil,
            email:  googleEmail,
            loginFn:  null,
            decodeFn: null,
        });

        /* Registrar no audit log */
        await auditLogger.registrar({
            usuarioId:   userId,
            usuarioNome: nome,
            acao:        'LOGIN_PEDAGOGO_GOOGLE_OAUTH',
            modulo:      'auth',
            detalhes:    { email: googleEmail, rcoDisponivel: false },
            ip:          req.ip,
        }).catch(() => {});

        console.log(`[Auth] Pedagogo logado via Google OAuth: ${nome} <${googleEmail}> (sem token RCO)`);

        res.cookie(COOKIE_NAME, sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            secure:   req.secure,
        });

        res.redirect('/pages/pedagogico/');
    });

    /* ── Logout ── (sem requireAuth: deve sempre funcionar) */
    router.post('/auth/logout', async (req, res) => {
        const sessionId = req.cookies?.[COOKIE_NAME];
        if (sessionId) {
            const session = userSessionStore.get(sessionId);
            if (session) {
                try {
                    await auditLogger.registrar({
                        usuarioId:   session.userId,
                        usuarioNome: session.nome,
                        acao:        'LOGOUT',
                        modulo:      'auth',
                        ip:          req.ip,
                    });
                } catch (_) { /* não bloqueia o logout por falha no audit */ }
                userSessionStore.destroy(sessionId);
            }
        }
        // Sempre limpa o cookie, mesmo sem sessão válida
        res.clearCookie(COOKIE_NAME, {
            httpOnly: true,
            sameSite: 'lax',
            secure:   req.secure,
        });
        res.json({ sucesso: true });
    });

    /* ── Atualizar perfil do próprio usuário ── */
    router.put('/auth/perfil', requireAuth, async (req, res) => {
        const { nome } = req.body;
        if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });

        const userId = req.userSession.userId;
        try {
            const { rows } = await pool.query(
                `UPDATE edusync_usuarios SET nome = $1 WHERE id = $2 RETURNING id, nome, perfil`,
                [nome.trim(), userId],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Usuário não encontrado.' });

            await auditLogger.registrar({
                usuarioId:   userId,
                usuarioNome: rows[0].nome,
                acao:        'PERFIL_NOME_ATUALIZADO',
                modulo:      'auth',
                ip:          req.ip,
            });

            res.json({ sucesso: true, usuario: rows[0] });
        } catch (err) {
            console.error('[Auth] Erro ao atualizar perfil:', err.message);
            res.status(500).json({ erro: 'Erro ao atualizar perfil.' });
        }
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
