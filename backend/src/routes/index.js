import { Router } from 'express';
import { createAuthRouter }          from './auth.routes.js';
import { createRcoRouter }           from './rco.routes.js';
import { createAlunosRouter }        from './alunos.routes.js';
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

export function createApiRouter(deps) {
    const router = Router();

    router.use('/', createAuthRouter(deps));
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

    return router;
}
