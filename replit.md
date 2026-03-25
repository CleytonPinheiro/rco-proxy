# EduSync

## Visão Geral
Sistema de gestão escolar para professores do Paraná. Consome a API do RCO Digital (Registro de Classe Online) com autenticação automática. Inclui módulos de turmas, frequências, crachás, grupos, comportamento, materiais, empréstimos, presença diária, painel da cozinha, circulação de alunos, comunicados de falta via WhatsApp (N8n), mapa de sala com drag-and-drop, atividades de sala (checklist diário por turma/data) e **integração com Google Classroom** (disciplinas, atividades e notas).

### Classroom (Google Classroom API)
- **Backend**: `backend/src/routes/classroom.routes.js` — OAuth2 + endpoints CRUD
- **Frontend**: `frontend/pages/classroom/` — página de 3 colunas (disciplinas → atividades → notas)
- **Token**: armazenado em `backend/data/classroom_token.json`
- **Credenciais necessárias**: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (env secrets)
- **Redirect URI** (registrar no Google Cloud Console): `https://{domínio}/api/classroom/callback`
- **Escopos**: `classroom.courses.readonly`, `classroom.coursework.students`, `classroom.rosters.readonly`, `classroom.student-submissions.students.readonly`

## Estado Atual
- **Data**: 24/03/2026
- **Status**: Funcional com login via navegador automatizado + arquitetura OOP refatorada
- **Linguagem**: JavaScript (Node.js com ES Modules)
- **Framework**: Express.js
- **Banco de Dados**: Supabase (PostgreSQL)
- **Automação**: Puppeteer (Chromium) para autenticação

## Arquitetura do Projeto

### Estrutura de Pastas

```
.
├── backend/
│   ├── index.js                          # Entry point enxuto (~60 linhas)
│   ├── auth-puppeteer.js                 # Autenticação Puppeteer/Chromium
│   ├── src/
│   │   ├── config/
│   │   │   └── supabase.js               # Clientes Supabase (anon + admin)
│   │   ├── services/                     # Camada de serviços (OOP)
│   │   │   ├── TokenService.js           # Singleton: cache e renovação de JWT
│   │   │   ├── RcoApiService.js          # Singleton: chamadas à API RCO
│   │   │   ├── SyncService.js            # Singleton: sincronização Supabase
│   │   │   └── PresencaService.js        # Singleton: sync e agendamento de presença
│   │   └── routes/                       # Rotas separadas por domínio
│   │       ├── index.js                  # Agregador de rotas
│   │       ├── auth.routes.js            # /api/status, /api/configurar
│   │       ├── rco.routes.js             # /api/acessos, /api/frequencias, /api/alunos-rco, /api/observacoes
│   │       ├── alunos.routes.js          # /api/alunos
│   │       ├── materiais.routes.js       # /api/materiais, /api/emprestimos, /api/estatisticas
│   │       ├── grupos.routes.js          # /api/grupos
│   │       ├── crachas.routes.js         # /api/crachas
│   │       ├── comportamento.routes.js   # /api/comportamento
│   │       ├── presenca.routes.js        # /api/presenca-diaria
│   │       ├── cozinha.routes.js         # /api/cozinha
│   │       ├── sync.routes.js            # /api/sync, /api/sync/log, /api/setup-status
│   │       └── debug.routes.js           # /api/debug/*
│   ├── database/
│   │   ├── migrations/                   # SQL para configurar tabelas no Supabase Studio
│   │   │   ├── 001_rco_tables.sql
│   │   │   ├── 002_app_tables.sql
│   │   │   ├── 003_grupos.sql
│   │   │   ├── 004_comportamento.sql
│   │   │   ├── 005_observacoes.sql
│   │   │   ├── 006_crachas.sql
│   │   │   ├── 007_presenca.sql
│   │   │   └── 008_update_alunos_schema.sql
│   │   └── seeds/                        # Dados iniciais
│   │       ├── insert_alunos.sql
│   │       └── insert_alunos_gerado.sql
│   ├── package.json
│   └── node_modules/
├── frontend/                             # Arquivos estáticos (feature-based)
│   ├── index.html                        # Login (raiz)
│   ├── shared/                           # Recursos compartilhados
│   │   ├── css/
│   │   │   ├── layout.css               # Header, footer, nav, modais, side panel
│   │   │   ├── theme.css                # Variáveis de tema claro/escuro
│   │   │   └── base.css                 # Estilos base da página de login
│   │   ├── js/
│   │   │   ├── theme.js                 # Toggle claro/escuro
│   │   │   └── app.js                   # Lógica da página de login
│   │   └── assets/
│   │       └── favicon.svg
│   └── pages/                           # Uma pasta por página
│       ├── dashboard/index.html + dashboard.css + dashboard.js
│       ├── frequencias/index.html + frequencias.css + frequencias.js
│       ├── crachas/index.html + crachas.css + crachas.js
│       ├── comportamento/index.html + comportamento.css + comportamento.js
│       ├── presenca/index.html + presenca.css + presenca.js
│       ├── grupos/index.html + grupos.css + grupos.js
│       ├── materiais/index.html + materiais.css + materiais.js
│       ├── emprestimos/index.html + emprestimos.css + materiais.css + emprestimos.js
│       ├── cozinha/index.html + cozinha.css + cozinha.js
│       └── quiosque/index.html + quiosque.css + quiosque.js
├── replit.md
└── README.md
```

### Padrão de Injeção de Dependências

Cada módulo de rota exporta uma factory function que recebe suas dependências:
```javascript
export function createXRouter({ supabase, supabaseAdmin, tokenService, rcoApiService }) {
    const router = Router();
    // ... rotas
    return router;
}
```

Os serviços são singletons inicializados em `initializeApp()` no `index.js`.

### Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/status` | Status das credenciais e token |
| POST | `/api/configurar` | Salva CPF/senha e gera token |
| GET | `/api/acessos` | Estabelecimentos/turmas/disciplinas RCO |
| GET | `/api/frequencias` | Frequência por aula de uma classe |
| GET | `/api/alunos-rco` | Alunos do RCO por codClasse |
| GET | `/api/observacoes` | Observações de aula RCO → Supabase |
| GET | `/api/alunos` | Alunos do Supabase |
| GET/POST/PUT/DELETE | `/api/materiais` | CRUD de materiais |
| GET/POST | `/api/emprestimos` | Empréstimos |
| PUT | `/api/emprestimos/:id/devolver` | Devolução |
| GET/POST/PUT/DELETE | `/api/grupos` | Grupos de trabalho |
| GET/POST | `/api/crachas` | Status dos crachás |
| GET/POST/DELETE | `/api/comportamento` | Ocorrências de comportamento |
| GET/POST/PUT | `/api/presenca-diaria` | Presença diária |
| GET | `/api/cozinha` | Painel da cozinha |
| POST | `/api/sync` | Sync manual RCO → Supabase |
| GET | `/api/sync/log` | Logs de sincronização |

## Funcionalidades

### Login Automático (Puppeteer)
- Chromium headless navega até a Central de Segurança PR
- Preenche CPF/senha automaticamente
- Captura token JWT do localStorage
- Token é cacheado e renovado automaticamente antes de expirar (5min de antecedência)
- Semáforo (`refreshPromise`) evita renovações simultâneas
- `TokenService` é um singleton com campos privados (`#cachedToken`, etc.)

### Sincronização com Supabase (SyncService)
- Sync automático na inicialização e a cada 6 horas
- Upsert de estabelecimentos → turmas → disciplinas → classes → alunos
- Registro de log em `rco_sync_log`

### Presença Diária (PresencaService)
- Sync agendado nos horários 09:00, 13:30 e 20:00
- Conta presenças por turma via frequenciaAulas RCO
- Integração com painel da cozinha

## Configuração

### Workflow
- **Nome**: `backend`
- **Comando**: `cd backend && node index.js`
- **Porta**: 5000 (webview)

### Secrets
- `RCO_CPF`: CPF para login no RCO
- `RCO_SENHA`: Senha para login no RCO
- `SUPABASE_URL`: URL do projeto Supabase
- `SUPABASE_ANON_KEY`: Chave anon do Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Chave service role (bypass de RLS)

## Decisões Técnicas

1. **Servidor sobe antes das dependências**: Health check funciona imediatamente; módulos pesados (Puppeteer, Supabase) carregam em background via `initializeApp()`
2. **OOP com classes ES2022**: Campos privados (`#field`) nos serviços para encapsulamento real
3. **Injeção de dependências**: Route factories recebem serviços como parâmetro, sem globals
4. **Frontend feature-based**: Cada página tem sua própria pasta `pages/[page]/` com `index.html`, CSS e JS. Recursos compartilhados (tema, layout, assets) ficam em `shared/`. URLs sem `.html` — `/pages/dashboard/` etc. servidas pelo `express.static`. Redirects 301 de URLs antigas (`/dashboard.html`) para novas.
5. **codPeriodoLetivo=261** (2026-1), **codPeriodoAvaliacao=9** (1º Trimestre)

## Notas de Segurança
- Token JWT nunca enviado ao frontend
- Supabase admin client usa service role key separada
- Credenciais RCO armazenadas apenas em memória (environment secrets)

## Mudanças Recentes

- **24/03/2026**: Refatoração OOP completa do backend
  - `backend/index.js` de 1783 linhas → 60 linhas (entry point)
  - Criados 4 services (TokenService, RcoApiService, SyncService, PresencaService)
  - Criados 11 arquivos de rotas separados por domínio
  - SQL movidos para `backend/database/migrations/` e `backend/database/seeds/`
  - Pattern de injeção de dependências em todas as rotas

- **24/03/2026**: Drawer de detalhes do aluno em Frequências
  - Busca paralela de todas as disciplinas ao clicar no aluno
  - Cache `disciplinaCache` por codClasse
  - Exibe % geral + cards por disciplina com status Pé-de-Meia
