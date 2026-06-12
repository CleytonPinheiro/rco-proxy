---
name: edusync-frontend-build
description: Processo de build e watch do frontend EduSync. Use ao editar arquivos em frontend/alunos/, frontend/pedagogico-portal/, ou ao criar novas páginas. Lembra de rebuildar os portais minificados e reiniciar o backend quando necessário.
---

# EduSync — Frontend Build

## Estrutura do frontend

```
frontend/
  login/           → página de login (HTML/CSS/JS puro, sem build)
  pages/           → páginas autenticadas (HTML/CSS/JS puro, sem build)
  alunos/
    alunos.js      → SOURCE — edite aqui
    alunos.min.js  → BUILD  — gerado automaticamente, não edite
  pedagogico-portal/
    pedagogico-portal.js      → SOURCE
    pedagogico-portal.min.js  → BUILD — gerado automaticamente
  shared/          → componentes compartilhados (theme.js, auth.js, etc.)
```

## Quando rebuildar

| Arquivo editado | Comando necessário |
|---|---|
| `frontend/alunos/alunos.js` | `node backend/scripts/build-portal.js alunos` |
| `frontend/pedagogico-portal/pedagogico-portal.js` | `node backend/scripts/build-portal.js` |
| Qualquer outro HTML/CSS/JS em `frontend/` | Sem build — servido diretamente pelo Express |
| `src/components/video/**` ou `src/**` | `npm run build:video` (gera `dist/`) |

## Workflow de dev

Para desenvolvimento dos portais sem restart manual:
```bash
# Terminal 1 — backend
cd backend && node index.js

# Terminal 2 — watcher dos portais (detecta mudança e rebuilda só o arquivo alterado)
npm run dev:portal
```

## Script de build completo (CI / deploy)

```bash
node backend/scripts/build-portal.js   # rebuilda ambos os portais
npm run build:video                    # rebuilda o vídeo de apresentação em dist/
```

O backend workflow já roda `node scripts/build-portal.js` antes de subir:
`cd backend && node scripts/build-portal.js && node index.js`

## Injeção de auth.js

`theme.js` injeta `auth.js` automaticamente em todas as páginas autenticadas.
- Páginas públicas (`login/`, `privacidade/`, `termos/`) usam **inline script mínimo** de tema, sem `theme.js` completo (evita render-blocking).
- Não adicione `<script src="auth.js">` manualmente — já é injetado.

## Nova página autenticada

1. Criar pasta em `frontend/pages/nomedapagina/`
2. Criar `index.html` com `<script src="../../shared/theme.js">` no `<head>`
3. Adicionar rota no Express se necessário (ou deixar o `express.static` servir)
4. Adicionar ao `sitemap.xml` se for pública

## Video (Vite/React)

Código-fonte em `src/`. Build gera `dist/` servido pelo Express em `/video/`.
Após editar cenas: `npm run build:video` → reiniciar o backend.
