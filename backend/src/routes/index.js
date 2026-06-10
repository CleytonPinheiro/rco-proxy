import { Router }               from 'express';
import { requireAuth, requireModulo } from '../middleware/auth.middleware.js';
import { podeAcessar }          from '../config/permissions.js';
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
import { createClassroomRouter, createClassroomPublicRouter, getAuthenticatedClient as getClassroomAuth } from './classroom.routes.js';
import { createLivrosRouter }        from './livros.routes.js';
import { createAdminRouter }         from './admin.routes.js';
import { createAlunosPortalRouter }       from './alunos-portal.routes.js';
import { createPedagogicoPortalRouter }  from './pedagogico-portal.routes.js';
import { createRcoLancamentoRouter }     from './rco-lancamento.routes.js';
import { createQRCodeRouter }            from './qrcode.routes.js';
import { createSuporteRouter }          from './suporte.routes.js';
import { createProvasRouter, createProvasPublicRouter } from './provas.routes.js';
import { createPasseiosRouter } from './passeios.routes.js';
import { createBoletimRouter }        from './boletim.routes.js';
import { createAlertasFaltasRouter }  from './alertas-faltas.routes.js';
import { createFichaAlunoRouter }          from './ficha-aluno.routes.js';
import { createRelatorioOcorrenciasRouter } from './relatorio-ocorrencias.routes.js';

export function createApiRouter(deps) {
    const router = Router();

    /* ── Rotas públicas (login, logout, /me, status) ── */
    router.use('/', createAuthRouter(deps));

    /* ── Portal do Aluno (público — sem sessão EduSync) ── */
    router.use('/', createAlunosPortalRouter());

    /* ── Provas — rotas do aluno (público; usa cookie aluno_sid) ── */
    router.use('/', createProvasPublicRouter());

    /* ── Portal Pedagógico (público — sem sessão EduSync) ── */
    router.use('/', createPedagogicoPortalRouter());

    /* ── Passeios — inicializar uma vez, usar routers públicos e protegidos ── */
    const passeiosRouters = createPasseiosRouter(deps);
    router.use('/', passeiosRouters.publicRouter);

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
    router.use('/', createBoletimRouter(deps));
    router.use('/', createAlertasFaltasRouter(deps));
    router.use('/', createSuporteRouter());
    router.use('/', createFichaAlunoRouter(deps));
    router.use('/', createRelatorioOcorrenciasRouter(deps));
    /* Provas: rotas do professor — requer módulo 'provas'.
       Endpoints exclusivos de análise de cola também aceitam módulo 'analise-cola';
       essa permissão secundária é aplicada dentro de provas.routes.js por rota. */
    router.use('/', (req, res, next) => {
        const perfil = req.userSession?.perfil;
        if (!perfil) return res.status(401).json({ erro: 'Não autenticado.' });
        if (podeAcessar(perfil, 'provas')) return next();
        /* Permite apenas endpoints de análise de cola para usuários com só 'analise-cola' */
        const COLA_PATHS = [
            /^\/classroom\/provas\/cola-historico\//,
            /^\/classroom\/provas\/\d+\/analise-cola$/,
            /^\/classroom\/provas\/\d+\/cola-pdf$/,
            /^\/classroom\/provas\/\d+\/comparar-respostas$/,
            /^\/classroom\/provas\/\d+\/confrontar-dois$/,
            /^\/classroom\/provas\/\d+\/mapa-questoes$/,
            /^\/classroom\/provas\/\d+\/mapa-questoes\/sugerir$/,
        ];
        if (podeAcessar(perfil, 'analise-cola') && COLA_PATHS.some(re => re.test(req.path))) return next();
        return res.status(403).json({ erro: 'Acesso ao módulo "provas" não permitido.' });
    }, createProvasRouter({ getClassroomAuth }));

    /* Passeios: rotas protegidas (scanner + CRUD — acessível a qualquer perfil logado) */
    router.use('/', passeiosRouters.router);

    return router;
}
