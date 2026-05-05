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

## Pointers

- **Google Classroom API Docs:** [https://developers.google.com/classroom/reference/rest](https://developers.google.com/classroom/reference/rest)
- **Puppeteer Docs:** [https://pptr.dev/](https://pptr.dev/)
- **Supabase Docs:** [https://supabase.com/docs](https://supabase.com/docs)
- **Express.js Docs:** [https://expressjs.com/](https://expressjs.com/)
- **PostgreSQL Docs:** [https://www.postgresql.org/docs/](https://www.postgresql.org/docs/)