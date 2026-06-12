---
name: edusync-rco-sync
description: Integração com o RCO Digital (Registro de Classe Online) do Paraná. Use ao trabalhar com autenticação RCO, sincronização de dados, tokens de usuário, ou qualquer funcionalidade que dependa do RCO. Cobre o padrão de token por usuário, lazy refresh, e AsyncLocalStorage.
---

# EduSync — Integração RCO Digital

## Visão geral

O RCO Digital é o sistema oficial da SEED-PR. O EduSync faz scraping via Puppeteer para:
1. **Autenticação** — login com CPF + senha do professor
2. **Sincronização** — espelha turmas, alunos, disciplinas, frequências e notas no Supabase
3. **Token por usuário** — cada professor tem sua própria sessão RCO isolada

## Token por usuário

Cada usuário autenticado tem um token RCO próprio armazenado na sessão Express.
O `AsyncLocalStorage` em `backend/src/services/token.service.js` expõe o token do usuário atual para qualquer service chamado durante a request, sem passar o token explicitamente.

```js
import { getToken } from '../services/token.service.js';

// Dentro de uma request autenticada — retorna token do usuário logado
const token = await getToken();   // lazy refresh automático se expirado
```

**Nunca passar o token como parâmetro** entre services — usar sempre `getToken()`.

## Lazy refresh

Tokens RCO expiram. O `getToken()` verifica a expiração e reloga via Puppeteer automaticamente se necessário. O Puppeteer usa semáforo de 3 slots (`auth-puppeteer.js`) para evitar sobrecarga de logins simultâneos.

## Sincronização

Serviço: `backend/src/services/sync.service.js`

```js
import { syncUsuario } from '../services/sync.service.js';
await syncUsuario(cpf);   // sincroniza turmas, alunos, notas do professor
```

- Sincronização completa no login
- Sincronização delta (só o dia atual) nas requisições de frequência
- Background job `stale-sync` verifica usuários sem sync há >7 dias

## Feature flag PEDAGOGICO_RCO_REQUERIDO

```
PEDAGOGICO_RCO_REQUERIDO=true  (padrão) — pedagogo precisa de credenciais RCO
PEDAGOGICO_RCO_REQUERIDO=false — pedagogo loga só com Google (@escola.pr.gov.br ou @seed.pr.gov.br)
```

Quando `false`, features que dependem de token RCO ativo devem mostrar mensagem amigável em vez de crashar:
```js
if (!token) {
  return res.status(403).json({ erro: 'Esta funcionalidade requer login RCO ativo.' });
}
```

## Proteção de rotas RCO

Use o middleware `requireRCO` para rotas que exigem token RCO ativo:
```js
import { requireRCO } from '../middleware/auth.middleware.js';
router.get('/minha-rota', requireAuth, requireRCO, handler);
```

## Credenciais

`RCO_CPF` e `RCO_SENHA` no Replit Secrets — conta de serviço para sync de background.
Cada professor também fornece suas próprias credenciais no login inicial.

## URLs do RCO

O RCO Digital é acessado via Puppeteer (não tem API pública documentada).
Não hardcodar URLs do RCO em código novo — usar as constantes já definidas em `auth-puppeteer.js`.

## Endpoints de sync expostos

- `POST /api/sync` — sincronização manual pelo professor
- `GET /api/sync/status` — último status de sync do usuário logado
- Background: `stale-sync` job em `backend/src/services/stale-sync.service.js`
