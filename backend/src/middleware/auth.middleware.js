/**
 * Middleware de autenticação e controle de acesso por perfil.
 */
import { requestContext }  from '../services/RequestContext.js';
import { userSessionStore } from '../services/UserSessionStore.js';
import { podeAcessar }     from '../config/permissions.js';

const COOKIE_NAME = 'edusync_sid';

/**
 * Exige que o usuário esteja autenticado.
 * Injeta `req.userSession` e executa o restante da cadeia
 * dentro do contexto assíncrono da sessão.
 */
export function requireAuth(req, res, next) {
    const sessionId = req.cookies?.[COOKIE_NAME];
    const session   = userSessionStore.get(sessionId);

    if (!session) {
        return res.status(401).json({ erro: 'Não autenticado. Faça login.' });
    }

    session.touch();
    req.userSession = session;

    // Propaga a sessão pelo contexto assíncrono (usado pelo TokenService)
    requestContext.run(session, next);
}

/**
 * Exige que o usuário autenticado tenha um dos perfis listados.
 * Deve ser usado APÓS requireAuth.
 * @param {...string} perfis
 */
export function requirePerfil(...perfis) {
    return (req, res, next) => {
        const perfil = req.userSession?.perfil;
        if (!perfil) return res.status(401).json({ erro: 'Não autenticado.' });

        // Admin tem acesso irrestrito
        if (perfil === 'admin') return next();

        if (!perfis.includes(perfil)) {
            return res.status(403).json({ erro: 'Acesso não autorizado para seu perfil.' });
        }
        next();
    };
}

/**
 * Exige que o usuário tenha acesso ao módulo informado.
 * @param {string} modulo
 */
export function requireModulo(modulo) {
    return (req, res, next) => {
        const perfil = req.userSession?.perfil;
        if (!perfil) return res.status(401).json({ erro: 'Não autenticado.' });

        if (!podeAcessar(perfil, modulo)) {
            return res.status(403).json({ erro: `Acesso ao módulo "${modulo}" não permitido.` });
        }
        next();
    };
}

export { COOKIE_NAME };
