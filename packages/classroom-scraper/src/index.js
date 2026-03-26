/**
 * @edusync/classroom-scraper
 *
 * Acesso ao Google Classroom via sessão autenticada (Puppeteer),
 * contornando restrições de API do Workspace SEED-PR em apps externos.
 *
 * Uso rápido:
 *
 *   import { GoogleAuth, ClassroomClient, ClassroomApiError } from '@edusync/classroom-scraper';
 *
 *   const auth   = new GoogleAuth({ email, password, getBrowser, cookieFile });
 *   const client = new ClassroomClient(auth);
 *
 *   const cursos = await client.listCourses();
 */

export { GoogleAuth }           from './GoogleAuth.js';
export { ClassroomClient, ClassroomApiError } from './ClassroomClient.js';
