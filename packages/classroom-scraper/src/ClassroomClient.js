/**
 * ClassroomClient — cliente para a API do Google Classroom
 *
 * Usa o Bearer token interceptado pelo GoogleAuth (token de primeira parte)
 * em vez de um token OAuth de app externo — contornando restrições do
 * Workspace SEED-PR em apps de terceiros.
 */

const BASE = 'https://classroom.googleapis.com/v1';

export class ClassroomClient {
    #auth;  // instância de GoogleAuth

    /** @param {import('./GoogleAuth.js').GoogleAuth} auth */
    constructor(auth) {
        this.#auth = auth;
    }

    // ── Utilitários internos ─────────────────────────────────────────────────

    async #headers() {
        const token = await this.#auth.getToken();
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type':  'application/json',
            'X-Origin':      'https://classroom.google.com',
        };
    }

    async #get(path, params = {}) {
        const url = new URL(BASE + path);
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) url.searchParams.set(k, v);
        }

        const res = await fetch(url.toString(), { headers: await this.#headers() });

        if (res.status === 401) {
            // Token expirado — invalida e tenta uma vez mais
            this.#auth.invalidate();
            const retry = await fetch(url.toString(), { headers: await this.#headers() });
            if (!retry.ok) {
                const err = await retry.json().catch(() => ({}));
                throw new ClassroomApiError(err.error?.message || retry.statusText, retry.status);
            }
            return retry.json();
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new ClassroomApiError(err.error?.message || res.statusText, res.status);
        }
        return res.json();
    }

    async #patch(path, body, updateMask) {
        const url = new URL(BASE + path);
        if (updateMask) url.searchParams.set('updateMask', updateMask);

        const res = await fetch(url.toString(), {
            method:  'PATCH',
            headers: await this.#headers(),
            body:    JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new ClassroomApiError(err.error?.message || res.statusText, res.status);
        }
        return res.json();
    }

    async #post(path, body = {}) {
        const res = await fetch(BASE + path, {
            method:  'POST',
            headers: await this.#headers(),
            body:    JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new ClassroomApiError(err.error?.message || res.statusText, res.status);
        }
        return res.json();
    }

    /** Coleta todas as páginas de um endpoint listando `field`. */
    async #listAll(path, field, params = {}) {
        const results = [];
        let pageToken;
        do {
            const data = await this.#get(path, { ...params, pageToken, pageSize: 100 });
            results.push(...(data[field] || []));
            pageToken = data.nextPageToken;
        } while (pageToken);
        return results;
    }

    // ── Cursos ───────────────────────────────────────────────────────────────

    /**
     * Lista todos os cursos ativos do professor autenticado.
     * @returns {Promise<Course[]>}
     */
    async listCourses() {
        const courses = await this.#listAll('/courses', 'courses', {
            teacherId:    'me',
            courseStates: 'ACTIVE',
        });
        return courses.map(normalizeCourse);
    }

    // ── Alunos ───────────────────────────────────────────────────────────────

    /**
     * Lista alunos matriculados em um curso.
     * @param {string} courseId
     * @returns {Promise<Student[]>}
     */
    async listStudents(courseId) {
        const students = await this.#listAll(`/courses/${courseId}/students`, 'students');
        return students.map(normalizeStudent);
    }

    // ── Atividades (courseWork) ──────────────────────────────────────────────

    /**
     * Lista atividades de um curso ordenadas por data de entrega desc.
     * @param {string} courseId
     * @returns {Promise<CourseWork[]>}
     */
    async listCourseWork(courseId) {
        const work = await this.#listAll(`/courses/${courseId}/courseWork`, 'courseWork', {
            orderBy: 'dueDate desc',
        });
        return work.map(normalizeCourseWork);
    }

    // ── Entregas / Notas ─────────────────────────────────────────────────────

    /**
     * Lista entregas de uma atividade (todas as submissões dos alunos).
     * @param {string} courseId
     * @param {string} courseWorkId
     * @returns {Promise<Submission[]>}
     */
    async listSubmissions(courseId, courseWorkId) {
        const subs = await this.#listAll(
            `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions`,
            'studentSubmissions',
        );
        return subs.map(normalizeSubmission);
    }

    /**
     * Atualiza a nota atribuída de uma entrega.
     * @param {string} courseId
     * @param {string} courseWorkId
     * @param {string} submissionId
     * @param {number|null} grade  - null para limpar a nota
     * @returns {Promise<{ok: boolean, nota: number|null}>}
     */
    async patchGrade(courseId, courseWorkId, submissionId, grade) {
        const body = { assignedGrade: grade === null || grade === '' ? null : Number(grade) };
        const data = await this.#patch(
            `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}`,
            body,
            'assignedGrade',
        );
        return { ok: true, nota: data.assignedGrade ?? null };
    }

    /**
     * Devolve uma entrega ao aluno (return).
     * @param {string} courseId
     * @param {string} courseWorkId
     * @param {string} submissionId
     */
    async returnSubmission(courseId, courseWorkId, submissionId) {
        await this.#post(
            `/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}:return`,
        );
        return { ok: true };
    }

    // ── E-mail ───────────────────────────────────────────────────────────────

    /** Retorna o e-mail da conta autenticada. */
    getEmail() {
        return this.#auth.getEmail();
    }

    /** True se há sessão ativa com token em cache. */
    isAuthenticated() {
        return this.#auth.isAuthenticated();
    }
}

// ── Normalização dos dados da API ────────────────────────────────────────────

function normalizeCourse(c) {
    return {
        id:         c.id,
        nome:       c.name,
        secao:      c.section       || '',
        descricao:  c.description   || '',
        sala:       c.room          || '',
        turmaCode:  c.enrollmentCode || '',
        link:       c.alternateLink || '',
        estado:     c.courseState,
    };
}

function normalizeStudent(s) {
    return {
        userId: s.userId,
        nome:   s.profile?.name?.fullName  || '—',
        email:  s.profile?.emailAddress    || '',
        foto:   s.profile?.photoUrl        || null,
    };
}

function normalizeCourseWork(w) {
    let prazo = null;
    if (w.dueDate) {
        const { day, month, year } = w.dueDate;
        prazo = `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
    }
    return {
        id:        w.id,
        titulo:    w.title,
        descricao: w.description || '',
        tipo:      w.workType,
        pontos:    w.maxPoints ?? null,
        prazo,
        link:      w.alternateLink || '',
        criadoEm:  w.creationTime,
    };
}

function normalizeSubmission(s) {
    return {
        id:           s.id,
        userId:       s.userId,
        estado:       s.state,
        entregue:     s.state === 'TURNED_IN' || s.state === 'RETURNED',
        nota:         s.assignedGrade  ?? null,
        notaRascunho: s.draftGrade     ?? null,
        atrasado:     s.late           || false,
        atualizadoEm: s.updateTime,
    };
}

// ── Erro customizado ─────────────────────────────────────────────────────────

export class ClassroomApiError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name       = 'ClassroomApiError';
        this.statusCode = statusCode;
    }
}
