# EduSync

EduSync is a school management system for Paraná teachers, focusing on synchronization with RCO Digital and integration with Google Classroom.

## Run & Operate

- **Run:** `cd backend && node index.js` (Backend listens on port 5000)
- **Environment Variables:** `RCO_CPF`, `RCO_SENHA`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_EMAIL`, `GOOGLE_PASSWORD`

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

- **RCO Token Expiration:** RCO tokens expire, requiring Puppeteer to re-authenticate lazily.
- **Google Classroom API Quotas:** Be mindful of API rate limits for bulk operations.
- **Database Consistency:** Ensure data consistency between Supabase and local PostgreSQL.
- **Plan Functionality Gating:** Use `requireFuncionalidade` middleware to protect features based on plans.
- **Google Classroom Redirect URIs:** All necessary redirect URIs must be registered in the Google Cloud Console.
- **GradePen + 2FA:** The `GOOGLE_EMAIL` used for GradePen scraping cannot have 2FA enabled.

## Pointers

- **Google Classroom API Docs:** [https://developers.google.com/classroom/reference/rest](https://developers.google.com/classroom/reference/rest)
- **Puppeteer Docs:** [https://pptr.dev/](https://pptr.dev/)
- **Supabase Docs:** [https://supabase.com/docs](https://supabase.com/docs)
- **Express.js Docs:** [https://expressjs.com/](https://expressjs.com/)
- **PostgreSQL Docs:** [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)