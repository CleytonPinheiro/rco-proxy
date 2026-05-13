/**
 * colaCheck.js — Post-submission lightweight similarity check
 *
 * After a student submits, compares their answers against every other submission
 * in the same variant. If similarity reaches COLA_THRESHOLD (85%), creates a
 * notificacoes_professor record for the exam's owning teacher.
 *
 * Designed to be called fire-and-forget (never throws to the caller).
 */

const COLA_THRESHOLD = 85;

/**
 * Run a pairwise similarity check for a newly-saved submission.
 *
 * @param {import('pg').Pool} pool
 * @param {{ provaId: number, varianteId: number, alunoEmail: string, marcacoesJson: object }} opts
 */
export async function checarColaPosSubmissao(pool, { provaId, varianteId, alunoEmail, marcacoesJson }) {
    try {
        const { rows: [variante] } = await pool.query(
            `SELECT gabarito_json FROM classroom_prova_variantes WHERE id = $1`,
            [varianteId]
        );
        if (!variante) return;

        const gabarito = variante.gabarito_json || [];
        const questoesComp = gabarito.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
        if (questoesComp.length === 0) return;

        const { rows: outras } = await pool.query(
            `SELECT aluno_email, aluno_nome, marcacoes_json
               FROM classroom_prova_submissoes
              WHERE prova_id      = $1
                AND variante_id   = $2
                AND aluno_email  != $3
                AND eh_segundo_corretor = false`,
            [provaId, varianteId, alunoEmail]
        );
        if (outras.length === 0) return;

        const { rows: [prova] } = await pool.query(
            `SELECT criada_por_cpf, nome FROM classroom_provas WHERE id = $1`,
            [provaId]
        );
        if (!prova?.criada_por_cpf) return;

        const marcNovas = marcacoesJson || {};

        for (const outra of outras) {
            const marcOutra = outra.marcacoes_json || {};

            let identicas = 0;
            const total   = questoesComp.length;

            for (const q of questoesComp) {
                const qStr = String(q.questao);
                const respA = marcNovas[qStr] ?? null;
                const respB = marcOutra[qStr]  ?? null;

                if (respA === null || respB === null) continue;

                const normA = Array.isArray(respA)
                    ? respA.map(x => String(x).toUpperCase()).join(',')
                    : String(respA).toLowerCase();
                const normB = Array.isArray(respB)
                    ? respB.map(x => String(x).toUpperCase()).join(',')
                    : String(respB).toLowerCase();

                if (normA === normB) identicas++;
            }

            const similaridade = total > 0 ? Math.round((identicas / total) * 100) : 0;

            if (similaridade >= COLA_THRESHOLD) {
                const [ea, eb] = [alunoEmail, outra.aluno_email].sort();

                await pool.query(
                    `INSERT INTO notificacoes_professor
                       (cpf_professor, prova_id, aluno_a, aluno_b, similaridade, prova_nome)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (prova_id, aluno_a, aluno_b) DO NOTHING`,
                    [prova.criada_por_cpf, provaId, ea, eb, similaridade, prova.nome]
                );

                console.log(`[COLA-CHECK] Par suspeito ${ea} ↔ ${eb} na prova ${provaId} (${similaridade}%) — notificação criada para ${prova.criada_por_cpf}`);
            }
        }
    } catch (e) {
        console.warn('[COLA-CHECK] Erro ao verificar cola pós-submissão:', e.message);
    }
}
