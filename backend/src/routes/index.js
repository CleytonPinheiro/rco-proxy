import { Router }               from 'express';
import { requireAuth }          from '../middleware/auth.middleware.js';
import { createAuthRouter }     from './auth.routes.js';
import { createRcoRouter }      from './rco.routes.js';
import { createAlunosRouter }   from './alunos.routes.js';
import { createMateriaisRouter }     from './materiais.routes.js';
import { createGruposRouter }        from './grupos.routes.js';
import { createCrachasRouter }       from './crachas.routes.js';
import { createComportamentoRouter } from './comportamento.routes.js';
import { createPresencaRouter }      from './presenca.routes.js';
import { createCozinhaRouter }       from './cozinha.routes.js';
import { createCirculacaoRouter }    from './circulacao.routes.js';
import { createComunicadosRouter }   from './comunicados.routes.js';
import { createSyncRouter }          from './sync.routes.js';
import { createDebugRouter }         from './debug.routes.js';
import { createMapaSalaRouter }      from './mapa-sala.routes.js';
import { createAtividadesRouter }    from './atividades.routes.js';
import { createPedagogicoRouter }    from './pedagogico.routes.js';
import { createClassroomRouter, createClassroomPublicRouter } from './classroom.routes.js';
import { createLivrosRouter }        from './livros.routes.js';
import { createAdminRouter }         from './admin.routes.js';
import { createAlunosPortalRouter }  from './alunos-portal.routes.js';
import { createRcoLancamentoRouter } from './rco-lancamento.routes.js';
import { createQRCodeRouter }        from './qrcode.routes.js';

export function createApiRouter(deps) {
    const router = Router();

    /* ── Rotas públicas (login, logout, /me, status) ── */
    router.use('/', createAuthRouter(deps));

    /* ── Portal do Aluno (público — sem sessão EduSync) ── */
    router.use('/', createAlunosPortalRouter());

    /* ── Gerador de QR Code (público) ── */
    router.use('/', createQRCodeRouter());

    /* ── Callback OAuth do Google Classroom (público) ── */
    router.use('/', createClassroomPublicRouter());

    /* ══════════════════════════════════════════════════════════════════
     * BARREIRA DE AUTENTICAÇÃO GLOBAL
     * Todas as rotas abaixo exigem sessão válida.
     * requireAuth injeta req.userSession E popula o requestContext
     * (AsyncLocalStorage), garantindo que TokenService.getValidToken()
     * use o token RCO do usuário correto e não o token global (env vars).
     * Isso corrige o bug de dados do login anterior aparecendo para o
     * próximo usuário.
     * ══════════════════════════════════════════════════════════════════ */
    router.use(requireAuth);

    /* ── Rotas de dados (todas protegidas pela barreira acima) ── */
    router.use('/', createRcoRouter(deps));
    router.use('/', createAlunosRouter(deps));
    router.use('/', createMateriaisRouter(deps));
    router.use('/', createGruposRouter(deps));
    router.use('/', createCrachasRouter(deps));
    router.use('/', createComportamentoRouter(deps));
    router.use('/', createPresencaRouter(deps));
    router.use('/', createCozinhaRouter(deps));
    router.use('/', createCirculacaoRouter(deps));
    router.use('/', createComunicadosRouter(deps));
    router.use('/', createSyncRouter(deps));
    router.use('/', createDebugRouter(deps));
    router.use('/', createMapaSalaRouter(deps));
    router.use('/', createAtividadesRouter());
    router.use('/', createPedagogicoRouter(deps));
    router.use('/', createClassroomRouter(deps));
    router.use('/', createLivrosRouter());
    router.use('/', createAdminRouter(deps));
    router.use('/', createRcoLancamentoRouter(deps));

    return router;
}
