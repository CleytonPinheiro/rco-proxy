---
name: edusync-puppeteer
description: Padrões de uso do Puppeteer no EduSync. Use sempre que criar ou editar rotas que geram PDFs, fazem scraping (GradePen), ou abrem páginas com Puppeteer. Garante isolamento de contexto, retry, cleanup e sem vazamento de sessão RCO.
---

# EduSync — Puppeteer

## Regra principal: NUNCA usar `browser.newPage()` diretamente

Todas as páginas criadas fora do fluxo de login RCO devem usar **contexto isolado**:

```js
import { getBrowser } from '../services/auth-puppeteer.js';

// ERRADO — abre página no contexto padrão (compartilha cookies com login RCO)
const page = await browser.newPage();

// CORRETO — contexto isolado, sem vazamento de sessão
let context = null;
let page = null;
try {
  const browser = await getBrowser();      // com retry (veja abaixo)
  context = await browser.createBrowserContext();
  page = await context.newPage();
  // ... lógica ...
} finally {
  await page?.close();
  await context?.close();   // SEMPRE fechar o contexto no finally
}
```

## Padrão de retry em getBrowser()

O Chromium pode estar ocupado com login RCO no cold-start. Use 2 tentativas:

```js
let browser;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    browser = await getBrowser();
    break;
  } catch (err) {
    if (attempt === 2) {
      return res.status(503).json({
        erro: 'Servidor de renderização temporariamente ocupado. Tente novamente em instantes.'
      });
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}
```

## Caso especial: GradePen (provas.routes.js)

GradePen mantém **contexto singleton** (`_gpContext`) junto com `_gpPage`. Ao invalidar a sessão (timeout, erro, disconnect), fechar **ambos**:

```js
await _gpPage?.close();   _gpPage = null;
await _gpContext?.close(); _gpContext = null;
```

## Limites de concorrência

- O semáforo de login RCO (3 slots) em `auth-puppeteer.js` controla apenas logins RCO.
- PDFs e GradePen **não entram na fila do semáforo** — usam contextos próprios e são independentes.

## Contexto de uso

- `backend/src/routes/relatorio-ocorrencias.routes.js` — PDF de Ocorrências (já corrigido)
- `backend/src/routes/passeios.routes.js` — PDF de pulseiras (já corrigido)
- `backend/src/routes/provas.routes.js` — GradePen scraping (já corrigido)
- Qualquer nova rota que chame `getBrowser()` deve seguir este padrão.
