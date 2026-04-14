/**
 * Middleware de autenticação e controle de acesso por perfil.
 */
import { requestContext }  from '../services/RequestContext.js';
import { userSessionStore } from '../services/UserSessionStore.js';
import { podeAcessar }     from '../config/permissions.js';
import { podeFuncionalidade } from '../config/planos.js';

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

/**
 * Exige que o plano do usuário inclua a funcionalidade solicitada.
 * Admin tem acesso irrestrito (bypass).
 * @param {string} funcionalidade
 */
export function requireFuncionalidade(funcionalidade) {
    return (req, res, next) => {
        const perfil = req.userSession?.perfil;
        if (!perfil) return res.status(401).json({ erro: 'Não autenticado.' });

        if (perfil === 'admin') return next();

        const planoInfo = req.userSession?.planoInfo;
        if (planoInfo?.expirado) {
            return res.status(403).json({
                erro: 'Seu plano expirou. Contate o administrador para renovar.',
                planoExpirado: true,
                planoAtual: planoInfo.plano,
            });
        }
        if (!planoInfo || !planoInfo.plano) {
            return res.status(403).json({
                erro: 'Você não possui um plano ativo. Contate o administrador.',
                semPlano: true,
            });
        }
        if (!podeFuncionalidade(planoInfo.funcionalidades, funcionalidade)) {
            return res.status(403).json({
                erro: `Seu plano (${planoInfo.config?.nome || planoInfo.plano}) não inclui esta funcionalidade.`,
                planoInsuficiente: true,
                planoAtual: planoInfo.plano,
                funcionalidadeNecessaria: funcionalidade,
            });
        }
        next();
    };
}

export { COOKIE_NAME };
