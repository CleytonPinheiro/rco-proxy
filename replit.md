# EduSync

Sistema de gestão escolar para professores do Paraná, com foco em sincronização com o RCO Digital e integração com Google Classroom.

## Run & Operate

- **Run:** `cd backend && node index.js` (Backend listens on port 5000)
- **Environment Variables:**
    - `RCO_CPF`: Service account CPF for background RCO sync
    - `RCO_SENHA`: Service account password
    - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: Supabase credentials
    - `DATABASE_URL`: Local PostgreSQL connection string for EduSync-specific tables
    - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google API credentials for Classroom integration
    - `GOOGLE_EMAIL`, `GOOGLE_PASSWORD`: School Google account for the GradePen scraper (Puppeteer logs into Google → GradePen)

## Stack

- **Language:** JavaScript (Node.js with ES Modules)
- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL remote) for core RCO data, local PostgreSQL for EduSync-specific and audit data.
- **ORM:** _Populate as you build_
- **Validation:** _Populate as you build_
- **Build Tool:** _Populate as you build_
- **Runtime:** Node.js

## Where things live

- `backend/index.js`: Main backend entry point.
- `backend/src/config/`: Configuration files (Supabase, DB init, permissions, plans).
- `backend/src/middleware/auth.middleware.js`: Authentication and RBAC middleware.
- `backend/src/services/`: Core business logic and external API integrations (RCO, Token, Sync, UserSession, AuditLog).
- `backend/src/routes/`: API route definitions.
- `frontend/login/`: User login page.
- `frontend/shared/`: Shared CSS, JS (authentication guard, theme), and assets.
- `frontend/pages/`: Main application pages (admin, classroom, dashboard, etc.).
- `frontend/alunos/`: Public student portal frontend.
- `frontend/pedagogico-portal/`: Public pedagogical portal frontend.
- `frontend/pages/provas/`: Teacher UI for the Provas module.
- `frontend/alunos/prova/`: Student-facing exam correction page (etapa 1 → etapa 2 reveal + 2nd-corrector blind mode).
- `backend/src/routes/provas.routes.js`: Provas module — DB migrations, GradePen scraper (Puppeteer + Google), teacher CRUD routes, student submit routes, 2nd-corrector flow.
- `backend/data/classroom_token.json`: Global Google Classroom token (legacy).
- `classroom_tokens` table: Per-user Google Classroom tokens.
- `backend/src/config/planos.js`: Defines available plans and functionalities.
- `edusync_usuarios` table: User management and RBAC.
- `edusync_audit_log` table: Audit trail for user actions.
- `edusync_config` table: Global system configurations, including demo mode.

## Architecture decisions

- **Token RCO por usuário:** Each user maintains an isolated RCO session and token, refreshed lazily via Puppeteer only when needed.
- **Session-aware TokenService:** Uses `AsyncLocalStorage` to delegate RCO token management to the current user's session if available, falling back to a service account for background tasks.
- **First login as admin:** The very first successful login populates the `edusync_usuarios` table by creating the user as an `admin`.
- **Soft delete for users:** Users are deactivated (`ativo = false`) rather than physically deleted.
- **Auth.js injection:** A single line in `theme.js` injects `auth.js` into all frontend pages, handling authentication guards, RBAC navigation, and user badges without per-page modifications.
- **OOP with ES Modules:** Extensive use of ES Modules and private fields (`#field`) in service classes, avoiding `require()`.
- **Provas (GradePen scraper):** Reuses the shared Puppeteer `getBrowser()` (same one used for RCO sync) to perform "Sign in with Google" on gradepen.com using `GOOGLE_EMAIL`/`GOOGLE_PASSWORD`, keeps the authenticated `page` object cached for ~25 min and runs `getAnswers.php` calls via `page.evaluate(fetch)` so the PHPSESSID cookie stays inside the browser context. Manual fallback: `POST /classroom/provas` accepts `variantesManuais` if scraping fails.
- **Provas → Classroom:** Publicar uma prova cria um `courseWork` ASSIGNMENT (com `dueDate`/pontos) e auto-cria/garante um grupo dedicado "Avaliação — X" (cor `#E91E63`, idempotente via `classroom_grupo_atividades`). `baseUrl` deriva de `req.get('host')`. O form de criação NÃO pede mais grupo destino (foi removido).
- **Gamificação (Reputação):** Dois trilhos independentes em `aluno_reputacao` (PK `email+trilho`): `aluno` (1º corretor) e `corretor` (2º corretor). Idempotência via `aluno_reputacao_log` com UNIQUE `(aluno_email, evento, submissao_id)`. XP creditado em três momentos: (1) na submissão do aluno (rapidez/no-prazo), (2) no envio da 2ª correção (envio + bônus voluntária), (3) na efetivação da prova (variante correta + precisão da 2ª correção em 5 faixas: ≤0.3/≤0.7/≤1.5/≤3.0/>3.0). Foto conferida pelo prof: +8 ou -10. Streaks separados por categoria (geral, perfeitas, rápido, foto_ok). Badges em JSONB. **Sem leaderboard público (privacidade).**
- **Voluntariar 2º corretor:** Aluno pode pegar correções extras em provas com `segundo_corretor_ativo=true` e não efetivadas, desde que (a) não tenha submetido essa prova, (b) tenha <2 correções nessa prova, (c) tenha <3 pendências totais e (d) limite de 3 voluntárias/dia. Cria notificação `tipo='segundo_corretor_voluntario'` (queries de pendentes/submeter incluem ambos os tipos).

## Product

EduSync provides a comprehensive school management system with features like:
- **Multi-user authentication (RBAC):** Profiles for `admin`, `professor`, `pedagogo`, `secretaria`, `aux_turno`, `cozinha`.
- **RCO Digital Integration:** Automatic authentication and data synchronization with RCO Digital via Puppeteer.
- **Google Classroom Integration:** Full OAuth2 flow, CRUD operations for courses, assignments, and grades.
- **QR Code Generator:** For students and teachers, accessible without authentication.
- **Modules:** Class management, attendance, badges, groups, behavior tracking, materials, loans, daily presence, kitchen panel, student circulation, WhatsApp absence notifications (via N8n), drag-and-drop classroom map, daily checklists, Pedagogical Panel.
- **Student Portal:** Publicly accessible portal for students to view pending assignments from Google Classroom.
- **Pedagogical Portal:** Publicly accessible portal for pedagogical staff to view and manage classroom data, including grades, late submissions, and absences.
- **Subscription Plans and Trial Management:** Gateways functionalities based on user/school plans, with trial periods, extensions, and support ticket integration.
- **Admin Panel:** User management, audit logs, configuration export/import, and plan management.
- **PDF Generation:** Suspension notices.
- **Provas (GradePen-style auto-grading):** Teacher registers a paper exam via GradePen ansid, system scrapes the answer key (Puppeteer + Google login), student logs into the portal at `/alunos/prova/?ansid=<jobId>.<variant>`, marks bubbles, sees grade vs answer key. Grade is draft until teacher "efetiva". Optional anonymous 2nd-corrector (toggleable per exam) — sortition creates a `notificacoes_aluno` entry, the chosen student opens `/alunos/prova/?seg=<subRefId>` to grade blind.

## User preferences

- I prefer a structured approach to development, breaking down tasks into smaller, manageable steps.
- Please provide clear explanations for complex technical concepts or architectural decisions.
- I appreciate regular updates on progress and any potential roadblocks.
- I prefer to iterate on features, delivering core functionality first and then refining it.

## Gotchas

- **RCO Token Expiration:** RCO tokens expire, requiring Puppeteer to re-authenticate. The system handles this lazily.
- **Puppeteer Headless:** Puppeteer runs in headless mode; issues might arise if RCO site changes significantly.
- **Google Classroom API Quotas:** Be mindful of Google Classroom API rate limits when performing bulk operations.
- **Database Consistency:** Ensure data consistency between Supabase (remote) and local PostgreSQL instances.
- **Plan Functionality Gating:** Remember to use `requireFuncionalidade` middleware to protect new features according to the defined plans.
- **Google Classroom Redirect URIs:** All necessary redirect URIs (main, student portal, pedagogical portal) must be registered in the Google Cloud Console.
- **GradePen + 2FA:** The `GOOGLE_EMAIL` account used for GradePen scraping cannot have 2FA enabled, otherwise the Puppeteer Google login flow breaks. Use a dedicated school account or app password.

## Pointers

- **Google Classroom API Docs:** [https://developers.google.com/classroom/reference/rest](https://developers.google.com/classroom/reference/rest)
- **Puppeteer Docs:** [https://pptr.dev/](https://pptr.dev/)
- **Supabase Docs:** [https://supabase.com/docs](https://supabase.com/docs)
- **Express.js Docs:** [https://expressjs.com/](https://expressjs.com/)
- **PostgreSQL Docs:** [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)