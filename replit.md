# EduSync

EduSync is a school management system for Paraná teachers, focusing on synchronization with RCO Digital and integration with Google Classroom.

## Run & Operate

- **Run:** `cd backend && node index.js` (Backend listens on port 5000)
- **Deploy target:** Reserved VM (`deploymentTarget = "vm"` in `.replit`). Chosen over autoscale because the app keeps Chromium/Puppeteer alive between requests (RCO browser singleton + GradePen cached page + 8-hour user sessions), so autoscale never reaches scale-zero and charges platform overhead without predictability. Reserved VM gives a fixed monthly cost. Recommended minimum: 2 vCPU / 4 GB RAM (each Chromium instance consumes 150–300 MB; RCO sync causes CPU spikes).
- **Environment Variables (all stored in Replit Secrets vault — never in files):**
  - `RCO_CPF`, `RCO_SENHA` — RCO Digital credentials
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase connection
  - `DATABASE_URL` — local PostgreSQL (managed by Replit)
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth app credentials
  - `GOOGLE_EMAIL`, `GOOGLE_PASSWORD` — Google account for GradePen scraping
  - `GOOGLE_REDIRECT_URI` — optional override; defaults to `{host}/api/classroom/callback`
  - `SESSION_SECRET`, `AUTHORIZATION_TOKEN` — session/auth tokens
  - `PEDAGOGICO_RCO_REQUERIDO` — feature flag (default `true`). Set to `false` to allow users with `@escola.pr.gov.br` or `@seed.pr.gov.br` emails to log in as `pedagogo` via Google OAuth, without RCO credentials. When `false`, features that need a live RCO token (Frequências em tempo real, Sincronizar RCO, Sync de Presença Diária) show a friendly "requires RCO login" message instead of crashing. Revert to `true` at any time without redeploying to restore the old behavior.

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
- `backend/src/services/`: Core business logic and external API integrations.
- `backend/src/routes/`: API route definitions.
- `frontend/`: Contains login, shared, pages, alunos, and pedagogico-portal directories.
- `backend/src/config/planos.js`: Defines available plans and functionalities.
- `classroom_tokens` table: Per-user Google Classroom tokens.
- `edusync_usuarios` table: User management and RBAC.
- `edusync_audit_log` table: Audit trail.
- `edusync_config` table: Global system configurations.

## Architecture decisions

- **Token RCO por usuário:** Each user maintains an isolated RCO session, refreshed lazily. `AsyncLocalStorage` delegates RCO token management to the current user's session or a service account for background tasks.
- **First login as admin:** The very first successful login populates `edusync_usuarios` by creating the user as an `admin`.
- **Auth.js injection:** A single line in `theme.js` injects `auth.js` into all frontend pages for authentication guards, RBAC navigation, and user badges.
- **Dynamic "In Development" Modules:** A list of modules "em desenvolvimento" is persisted in `edusync_config`, loaded into an in-memory Set. Frontend caches this list for UI adjustments (e.g., disabling features).
- **Provas Module (GradePen Scraper):** Reuses Puppeteer's `getBrowser()` for Google login on gradepen.com, caches the authenticated page, and runs `getAnswers.php` calls within the browser context. Creating a "Prova" publishes a Google Classroom `courseWork` assignment.
- **Admin-Editable Permissions:** `permissions.js` defines default roles, but admins can override them via the admin panel, stored in `edusync_perfis_overrides`. The frontend (`auth.js`) caches these for seamless navigation updates.
- **Parent-Child Module Dependencies:** `permissions.js` defines parent-child relationships between modules, ensuring both parent and child permissions are checked for access. Frontend UI reorders and indents child modules.
- **Gamification (Reputation):** Separate reputation tracks (`aluno`, `corretor`) for students and 2nd correctors, with XP awarded at submission, 2nd correction, and exam finalization. No public leaderboard for privacy.
- **Data Purge Job (`purgeJob.js`):** A background job purges old rows from `edusync_audit_log` (default 365 days), `aluno_reputacao_log` (default 365 days), and `notificacoes_aluno` (read: 90 days, unread: 365 days). Runs 60 s after startup then every `PURGA_INTERVALO_HORAS` hours (default 24). Deletes in batches of `PURGA_LOTE` rows (default 1000) to avoid table locks. Aggregates in `aluno_reputacao` are unaffected. Configure via env: `PURGA_AUDIT_DIAS`, `PURGA_REPUTACAO_DIAS`, `PURGA_NOTIF_LIDA_DIAS`, `PURGA_NOTIF_NLIDA_DIAS`, `PURGA_LOTE`, `PURGA_INTERVALO_HORAS`.
- **Secrets in vault only:** All credentials live in Replit Secrets. The `.replit` file must never contain secret values. `GOOGLE_REDIRECT_URI` falls back to `{host}/api/classroom/callback` if not set.
- **Reserved VM deployment:** `deploymentTarget = "vm"` (not autoscale) because Puppeteer/Chromium singletons, cached sessions, and background sync workers mean the process never idles, making autoscale's scale-to-zero irrelevant and its per-request pricing less predictable than a flat VM rate.

## Product

EduSync provides a comprehensive school management system with features like:
- **Multi-user authentication (RBAC):** Profiles for various school roles.
- **RCO Digital Integration:** Automatic authentication and data synchronization.
- **Google Classroom Integration:** Full OAuth2 flow, CRUD for courses, assignments, grades.
- **Modules:** Class management, attendance, badges, groups, behavior, materials, loans, daily presence, kitchen panel, student circulation, WhatsApp notifications, drag-and-drop classroom map, daily checklists, Pedagogical Panel.
- **Student and Pedagogical Portals:** Publicly accessible portals for viewing pending assignments, grades, late submissions, and absences.
- **Subscription Plans and Trial Management:** Feature gating based on user/school plans.
- **Admin Panel:** User management, audit logs, configuration export/import, plan management.
- **Provas (GradePen-style auto-grading):** Teacher-created exams, system-scraped answer keys, student bubble marking and draft grading, optional anonymous 2nd-corrector.

## User preferences

- I prefer a structured approach to development, breaking down tasks into smaller, manageable steps.
- Please provide clear explanations for complex technical concepts or architectural decisions.
- I appreciate regular updates on progress and any potential roadblocks.
- I prefer to iterate on features, delivering core functionality first and then refining it.

## Gotchas

- **Secrets vault only:** Never add secrets to `.replit` or any versioned file. Use Replit Secrets exclusively.
- **RCO Token Expiration:** RCO tokens expire, requiring Puppeteer to re-authenticate lazily.
- **Google Classroom API Quotas:** Be mindful of API rate limits for bulk operations.
- **Database Consistency:** Ensure data consistency between Supabase and local PostgreSQL.
- **Plan Functionality Gating:** Use `requireFuncionalidade` middleware to protect features based on plans.
- **Google OAuth Redirect URIs:** Two URIs must be registered in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs, for **each environment** (dev + production):
  - `https://<host>/api/classroom/callback` — teacher Google Classroom OAuth
  - `https://<host>/api/auth/pedagogo-google/callback` — pedagogo Google login (used when `PEDAGOGICO_RCO_REQUERIDO=false`)
  The backend logs these exact URIs at startup. A `redirect_uri_mismatch` error in the logs means one is missing.
- **GradePen + 2FA:** The `GOOGLE_EMAIL` used for GradePen scraping cannot have 2FA enabled.
- **SUPABASE_SERVICE_ROLE_KEY vs ANON_KEY:** The service role key bypasses RLS and is used by `supabaseAdmin`. It is different from the anon key — verify in Supabase Dashboard → Settings → API.

## Pointers

- **Google Classroom API Docs:** [https://developers.google.com/classroom/reference/rest](https://developers.google.com/classroom/reference/rest)
- **Puppeteer Docs:** [https://pptr.dev/](https://pptr.dev/)
- **Supabase Docs:** [https://supabase.com/docs](https://supabase.com/docs)
- **Express.js Docs:** [https://expressjs.com/](https://expressjs.com/)
- **PostgreSQL Docs:** [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)
