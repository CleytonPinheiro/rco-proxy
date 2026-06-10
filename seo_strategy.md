# SEO Strategy

## In scope
- Public login page (`/login/`)
- Public student portal entry (`/alunos/`)
- Public pedagogical portal entry (`/pedagogico-portal/`)
- Public legal pages (`/privacidade/`, `/termos/`)
- Public QR code tool (`/qrcode/`)
- Public student event info pages (`/p/:eventoId/:alunoToken`)
- Public presentation page (`/video/`)

## Out of scope
- Authenticated dashboard and internal product pages under `/pages/**`
- Admin pages and internal operational tools
- PDF/export HTML generated for logged-in workflows
- PWA scanner under `/pages/passeios/scanner/` because it is under a disallowed internal path

## Target audience
- Professores, coordenadores e equipe pedagógica de escolas do Paraná
- Alunos e responsáveis que acessam portais públicos específicos

## Primary keywords
- gestão escolar Paraná
- integração RCO Digital
- Google Classroom para escolas
- portal do aluno
- portal pedagógico

## Dismissed categories
- (None yet)

## Notes
- The app is primarily an Express-served multi-page/static HTML experience, not a single SPA.
- `/video/` is a separate React + Vite SPA with one public route.
- `frontend/robots.txt` currently treats `/pages/**` as non-indexable, which aligns with scope.
