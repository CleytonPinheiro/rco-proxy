# EduSync

## Visão Geral
Sistema de gestão escolar para professores do Paraná. Inclui **Gerador de QR Code** em `/qrcode/` (sem auth, acessível por alunos e professores). Consome a API do RCO Digital (Registro de Classe Online) com autenticação automática via Puppeteer/Chromium. Inclui módulos de turmas, frequências, crachás, grupos, comportamento, materiais, empréstimos, presença diária, painel da cozinha, circulação de alunos, comunicados de falta via WhatsApp (N8n), mapa de sala com drag-and-drop, atividades de sala (checklist diário por turma/data), Painel Pedagógico e **integração com Google Classroom**.

### Autenticação Multi-usuário (RBAC)
- Login via CPF + senha do RCO Digital (Puppeteer valida as credenciais)
- Primeiro login cria automaticamente o administrador
- Usuários subsequentes precisam ser cadastrados pelo admin
- Perfis: `admin`, `professor`, `pedagogo`, `secretaria`, `aux_turno`, `cozinha`
- Sessões em memória com cookie `edusync_sid` (HttpOnly, 8h)
- Audit log completo em `edusync_audit_log` (PostgreSQL local)
- Cada usuário tem sua própria sessão RCO (token isolado por `UserSession`)

### Sistema de Planos e Trial
- **Config**: `backend/src/config/planos.js` — definição de planos (trial/basico/completo para usuários; inicial/profissional/rede para escolas)
- **Middleware**: `requireFuncionalidade('funcionalidade')` em `auth.middleware.js` — bloqueia endpoints por funcionalidade do plano
- **Resolução**: plano do usuário tem prioridade; fallback para plano da escola
- **Planos de usuário**: `trial` (30 dias, só leitura), `basico` (classroom completo), `completo` (tudo), `classroom-individual` (legado)
- **Planos de escola**: `inicial` (leitura), `profissional` (escrita + frequências), `rede` (tudo)
- **Funcionalidades gateadas**: `classroom-leitura`, `classroom-escrita`, `atividades-leitura`, `atividades-escrita`, `dashboard`, `grupos`, `frequencias`
- **Admin**: gerencia planos via modal no painel admin (clique no badge de plano na tabela de usuários/escolas); botão "Estender +30 dias" para trials; histórico de alterações visível no modal
- **Trial auto-expiração**: baseado em `plano_inicio` + 30 dias; após expiração, funcionalidades bloqueadas
- **Frontend**: banner de status do plano no topo da página classroom (trial countdown, expiração, sem plano)
- **DB**: colunas `plano`, `plano_inicio`, `plano_renovacao`, `plano_obs` em `edusync_usuarios` e `edusync_escolas`; tabela `edusync_plano_historico` (registro de todas as alterações de plano); tabela `edusync_suporte` (tickets de suporte/solicitações)
- **Admin bypass**: perfil `admin` ignora todas as restrições de plano
- **RCO Launch gating**: endpoints `POST /rco-lancamento/avaliacoes/:id/lancar`, `/salvar-db`, `/avaliacoes/criar` e `PATCH /grupos/:id/cod-classe` protegidos por `requireFuncionalidade('classroom-escrita')`
- **Modo Demo**: tabela `edusync_config` com chave `portal_modo_demo`; quando `true`, portais aceitam qualquer email Google (sem restrição de domínio). Toggle no admin em aba "Configurações"

### Sistema de Suporte
- **Página**: `frontend/pages/suporte/` — acessível por todos os perfis (não-admin)
- **Funcionalidades**: visualizar status do plano, histórico de alterações, enviar solicitações (extensão, dúvida, bug, sugestão, outro), acompanhar respostas
- **Backend**: `backend/src/routes/suporte.routes.js` — endpoints protegidos por auth: `GET /suporte/meu-plano`, `GET /suporte/meus-tickets`, `POST /suporte/ticket`
- **Admin**: aba "Suporte" no painel admin com badge de pendentes, filtro por status, botões resolver/negar com resposta
- **Extensão automática**: ao aprovar uma solicitação de extensão, o sistema estende automaticamente o trial em +30 dias e registra no histórico

### Classroom (Google Classroom API)
- **Backend**: `backend/src/routes/classroom.routes.js` — OAuth2 + endpoints CRUD
- **Frontend**: `frontend/pages/classroom/` — página de 3 colunas (disciplinas → atividades/grupos/auditoria → notas)
- **Token global**: armazenado em `backend/data/classroom_token.json` (retrocompatibilidade)
- **Tokens por usuário**: tabela `classroom_tokens` (cpf, email, tokens JSONB) — salvo automaticamente no callback OAuth via cookie seguro `cl_oauth_cpf`
- **Credenciais necessárias**: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (env secrets)
- **Redirect URI** (registrar no Google Cloud Console): `https://{domínio}/api/classroom/callback`
- **Escopos**: `classroom.courses.readonly`, `classroom.coursework.students`, `classroom.rosters.readonly`, `classroom.student-submissions.students.readonly`

### Acesso Pedagogo ao Classroom
- **Tabela de concessão**: `classroom_acesso_pedagogo` (professor_cpf, pedagogo_email) — UNIQUE pair
- **Fluxo professor**: Na página Classroom, seção "Acesso pedagógico" no sidebar — professor adiciona email da pedagoga
- **Endpoints professor**: `GET/POST/DELETE /api/classroom/acesso-pedagogos` — listar, conceder, revogar
- **Fluxo pedagoga**: No Portal Pedagógico, tela de seleção de professor antes de ver disciplinas
- **Endpoint portal**: `GET /api/pedagogico-portal/professores` — lista professores que concederam acesso (JOIN com `edusync_usuarios` e `classroom_tokens`)
- **Roteamento de token**: `resolveTeacherAuth(req)` — se `professorCpf` presente e pedagoga autorizada, usa token do professor do DB; sem `professorCpf`, fallback para token global
- **Segurança**: grant verificado no servidor em cada chamada; cookie httpOnly para binding CPF→token no OAuth
- **Sistema de solicitações**: tabela `classroom_solicitacao_acesso` (pedagogo_email, pedagogo_nome, professor_cpf, status, mensagem)
- **Fluxo convite**: pedagoga busca professor por nome no portal → envia solicitação com mensagem opcional → professor vê na seção "Acesso pedagógico" do Classroom → aprova (cria grant automático) ou recusa
- **Endpoints portal**: `GET /buscar-professores?q=`, `POST /solicitar-acesso`, `GET /minhas-solicitacoes`
- **Endpoints professor**: `GET /solicitacoes-acesso`, `POST /solicitacoes-acesso/:id/responder` (aceitar: true/false)

### Exportar / Importar Configuração
- **Admin aba "Configurações"**: botões "Exportar Configuração" e "Importar Configuração"
- **Export** (`GET /admin/export-config`): gera JSON com `classroom_grupos`, `classroom_grupo_atividades`, `classroom_ausencias`, `classroom_entregas_tardias`, `edusync_config`, `classroom_acesso_pedagogo`
- **Import** (`POST /admin/import-config`): lê JSON exportado, insere dados com `ON CONFLICT DO NOTHING` (não sobrescreve existentes), remapeia IDs de grupos, transação atômica
- **JSON body limit**: `10mb` para suportar exports grandes
- **Uso**: exportar config do dev → importar no ambiente de produção (transfere grupos, atividades vinculadas, ausências, tardias, configurações e acessos pedagógicos)

### Portal do Aluno (Google OAuth — público)
- **URL pública**: `/alunos/` — sem login EduSync, acessível por alunos
- **Backend**: `backend/src/routes/alunos-portal.routes.js` — montado ANTES do `requireAuth`
- **Frontend**: `frontend/alunos/` — HTML/CSS/JS standalone (sem dependência de shared/)
- **Sessão do aluno**: cookie `aluno_sid` + tabela `aluno_portal_sessions` (PostgreSQL local, TTL 24h)
- **Fluxo OAuth**: escopo mínimo (`openid email profile`) — só para obter o email do aluno
- **Consulta**: usa o **token do professor** (já armazenado) para buscar cursos/submissions do aluno via Classroom API
- **Redirect URI adicional** (registrar no Google Cloud Console): `https://{domínio}/api/alunos-portal/callback`
- **Dados exibidos**: atividades pendentes (estado CREATED/RECLAIMED) agrupadas por disciplina, com prazo e link direto ao GC

### Portal Pedagógico (Google OAuth — público, leitura + escrita)
- **URL pública**: `/pedagogico-portal/` — sem login EduSync/RCO, acessível pela equipe pedagógica
- **Backend**: `backend/src/routes/pedagogico-portal.routes.js` — montado ANTES do `requireAuth`
- **Frontend**: `frontend/pedagogico-portal/` — HTML/CSS/JS standalone com tema roxo
- **Sessão**: cookie `pedagogo_sid` + tabela `pedagogo_portal_sessions` (PostgreSQL local, TTL 24h)
- **Fluxo OAuth**: escopo mínimo (`openid email profile`) — só para obter o email @escola
- **Consulta**: usa o **token do professor** (já armazenado) para buscar cursos/alunos/submissions via Classroom API
- **Redirect URI adicional** (registrar no Google Cloud Console): `https://{domínio}/api/pedagogico-portal/callback`
- **Funcionalidades**:
  - Consulta de cursos, grupos de atividades, resumo de notas por grupo
  - **Gerenciar grupos**: editar (nome/pontos/cor) e excluir grupos via modal
  - **Fechar/reabrir notas**: fechar grupo (registra data_fechamento) ou reabrir; sincroniza dueDate com Google Classroom (PATCH courseWork) e salva prazo original para restauração
  - **Entregas tardias**: detectar e listar entregas após data de fechamento
  - **Auditoria de ausências**: visualizar ausências registradas por disciplina
  - **Botão "Lançar no RCO" oculto**: não disponível no portal pedagógico
- **Audit log**: todas as ações registradas no módulo `portal_pedagogico` (incluindo consultas de ausências e tardias)
- **Segurança**: validação de courseId x grupo nas mutações, 404 para grupos inexistentes

## Estado Atual
- **Data**: 14/04/2026
- **Status**: Funcional com autenticação multi-usuário RBAC + painel admin + criação de avaliação via Puppeteer
- **Linguagem**: JavaScript (Node.js com ES Modules)
- **Framework**: Express.js
- **Banco de Dados**: Supabase (PostgreSQL remoto) + PostgreSQL local (tabelas locais)
- **Automação**: Puppeteer (Chromium) para autenticação no RCO

## Arquitetura do Projeto

### Bancos de Dados
- **Supabase** (remoto): `estabelecimentos`, `turmas`, `disciplinas`, `classes`, `alunos`, `rco_sync_log`, `aluno_ocorrencias`, `rco_observacoes`
- **PostgreSQL local** (`DATABASE_URL`): `mapa_sala`, `atividades_sala`, `pedagogo_notas`, `ocorrencia_meta`, `classroom_grupos`, `classroom_grupo_atividades`, `classroom_ausencias`, `classroom_entregas_tardias`, `edusync_usuarios`, `edusync_audit_log`, `aluno_portal_sessions`, `pedagogo_portal_sessions`

### Estrutura de Pastas

```
.
├── backend/
│   ├── index.js                          # Entry point (~70 linhas)
│   ├── auth-puppeteer.js                 # Autenticação Puppeteer/Chromium
│   ├── src/
│   │   ├── config/
│   │   │   ├── supabase.js               # Clientes Supabase (anon + admin)
│   │   │   ├── dbInit.js                 # Cria tabelas locais (edusync_*)
│   │   │   ├── permissions.js            # RBAC: perfis e permissões
│   │   │   └── planos.js                # Planos/trial: definições e resolução
│   │   ├── middleware/
│   │   │   └── auth.middleware.js        # requireAuth, requirePerfil
│   │   ├── services/
│   │   │   ├── TokenService.js           # Singleton: cache e renovação de JWT (session-aware)
│   │   │   ├── RcoApiService.js          # Singleton: chamadas à API RCO
│   │   │   ├── SyncService.js            # Singleton: sincronização Supabase
│   │   │   ├── PresencaService.js        # Singleton: sync e agendamento de presença
│   │   │   ├── RequestContext.js         # AsyncLocalStorage para contexto de request
│   │   │   ├── UserSession.js            # Sessão RCO por usuário (token isolado)
│   │   │   ├── UserSessionStore.js       # In-memory store de sessões ativas
│   │   │   └── AuditLogger.js            # Registro de ações no audit log
│   │   └── routes/
│   │       ├── index.js                  # Agregador de rotas
│   │       ├── auth.routes.js            # /api/auth/login, /api/auth/logout, /api/me
│   │       ├── admin.routes.js           # /api/admin/* (requer perfil admin)
│   │       ├── rco.routes.js             # /api/acessos, /api/frequencias, etc.
│   │       ├── alunos.routes.js          # /api/alunos, /api/students
│   │       ├── materiais.routes.js       # /api/materiais, /api/emprestimos
│   │       ├── grupos.routes.js          # /api/grupos
│   │       ├── crachas.routes.js         # /api/crachas
│   │       ├── comportamento.routes.js   # /api/comportamento
│   │       ├── presenca.routes.js        # /api/presenca-diaria
│   │       ├── cozinha.routes.js         # /api/cozinha
│   │       ├── sync.routes.js            # /api/sync
│   │       ├── classroom.routes.js       # /api/classroom/*
│   │       ├── mapa.routes.js            # /api/mapa-sala
│   │       ├── atividades.routes.js      # /api/atividades-sala
│   │       ├── pedagogico.routes.js      # /api/pedagogico + /api/pedagogico/retorno
│   │       ├── pedagogico-portal.routes.js # /api/pedagogico-portal/* (público)
│   │       ├── circulacao.routes.js      # /api/circulacao
│   │       └── debug.routes.js           # /api/debug/*
├── frontend/
│   ├── index.html                        # Redirect → /login/
│   ├── login/
│   │   ├── index.html                    # Página de login
│   │   ├── login.css
│   │   └── login.js
│   ├── shared/
│   │   ├── css/
│   │   │   ├── layout.css               # Header, footer, nav, modais, side panel
│   │   │   ├── theme.css                # Variáveis de tema + .user-badge
│   │   │   └── base.css                 # Estilos base
│   │   ├── js/
│   │   │   ├── theme.js                 # Toggle claro/escuro + injeta auth.js
│   │   │   └── auth.js                  # Guard: /api/me → RBAC nav → badge → logout
│   │   └── assets/
│   │       └── favicon.svg
│   └── pages/
│       ├── admin/index.html + admin.css + admin.js   # Painel admin (usuários + audit)
│       ├── dashboard/
│       ├── frequencias/
│       ├── crachas/
│       ├── comportamento/
│       ├── presenca/
│       ├── grupos/
│       ├── materiais/
│       ├── emprestimos/
│       ├── cozinha/
│       ├── circulacao/
│       ├── comunicados/
│       ├── mapa-sala/
│       ├── atividades/
│       ├── pedagogico/
│       ├── retorno-pedagogico/               # Retorno da equipe (professor/pedagogo)
│       └── classroom/
```

### Fluxo de Autenticação
1. Usuário acessa qualquer página → `theme.js` injeta `auth.js` → `auth.js` chama `GET /api/me`
2. Se 401 → redireciona para `/login/?next=<página>`
3. Em `/login/`: `POST /api/auth/login` com CPF+senha → Puppeteer valida no RCO → cria `UserSession` → cookie `edusync_sid`
4. Primeiro login cria admin automaticamente na tabela `edusync_usuarios`
5. `auth.js` oculta links do nav que o perfil não pode acessar

### Endpoints da API

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/auth/login` | ✗ | Login CPF+senha |
| POST | `/api/auth/logout` | ✓ | Logout + destroy sessão |
| GET | `/api/me` | ✓ | Dados do usuário logado |
| GET | `/api/admin/usuarios` | admin | Lista usuários |
| POST | `/api/admin/usuarios` | admin | Criar usuário |
| PUT | `/api/admin/usuarios/:id` | admin | Editar usuário |
| DELETE | `/api/admin/usuarios/:id` | admin | Desativar usuário |
| GET | `/api/admin/audit-log` | admin | Log de auditoria |
| GET | `/api/acessos` | ✓ | Estabelecimentos/turmas/disciplinas RCO |
| GET | `/api/frequencias` | ✓ | Frequência por aula de uma classe |
| GET | `/api/alunos` | ✓ | Alunos do Supabase |
| GET | `/api/students` | ✓ | Alunos com numChamada |
| GET/POST/PUT/DELETE | `/api/materiais` | ✓ | CRUD de materiais |
| GET/POST | `/api/emprestimos` | ✓ | Empréstimos |
| GET/POST/PUT/DELETE | `/api/grupos` | ✓ | Grupos de trabalho |
| POST | `/api/sync` | ✓ | Sync manual RCO → Supabase |

## Configuração

### Workflow
- **Nome**: `backend`
- **Comando**: `cd backend && node index.js`
- **Porta**: 5000 (webview)

### Secrets
- `RCO_CPF`: CPF da conta de serviço para sync em background
- `RCO_SENHA`: Senha da conta de serviço
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`: PostgreSQL local (tabelas locais EduSync)

## Decisões Técnicas

1. **Token RCO por usuário**: Cada `UserSession` mantém seu próprio token RCO; renovação lazy (Puppeteer só roda quando o token expira)
2. **seedToken()**: Evita Puppeteer duplo no login — o token obtido durante o login é injetado direto na sessão
3. **TokenService session-aware**: Usa `AsyncLocalStorage` (RequestContext) — se há uma `UserSession` no contexto, delega para ela; caso contrário usa a conta de serviço (env vars) para jobs de sync
4. **auth.js injetado via theme.js**: Uma linha em `theme.js` injeta `auth.js` em TODAS as páginas automaticamente, sem editar cada HTML
5. **Primeiro login = admin**: Se `edusync_usuarios` está vazia, o primeiro login bem-sucedido cria o usuário como `admin`
6. **Soft delete**: Usuários são desativados (`ativo = false`), nunca deletados fisicamente
7. **OOP com ES Modules**: Campos privados (`#field`) nos serviços; zero `require()`
8. **codPeriodoLetivo=261** (2026-1), **codPeriodoAvaliacao=9** (1º Trimestre)
9. **RCO scale**: API usa escala ×10 internamente; display sempre `/10`

## Mudanças Recentes

- **29/03/2026**: Multi-user RBAC + Painel Admin
  - Tabelas `edusync_usuarios` e `edusync_audit_log` no PostgreSQL local
  - Serviços: `RequestContext`, `UserSession`, `UserSessionStore`, `AuditLogger`
  - Middleware: `auth.middleware.js` (requireAuth, requirePerfil)
  - Rotas: `auth.routes.js` reescrito, `admin.routes.js` novo
  - Frontend: `/login/` com auto-redirect, `shared/js/auth.js` (guard+RBAC+badge)
  - `theme.js` injeta `auth.js` em todas as páginas automaticamente
  - Painel admin: listagem de usuários, criar/editar/desativar, audit log com filtros
  - `frontend/index.html` agora é redirect puro para `/login/`

- **24/03/2026**: Refatoração OOP completa + Classroom + numChamada + grouping de turmas
