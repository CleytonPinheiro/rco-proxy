import { Router } from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export function createFichaAlunoRouter({ supabaseAdmin, rcoApiService }) {
    const router = Router();

    router.use('/ficha-aluno', requireModulo('ficha-aluno'));

    /* ── GET /api/ficha-aluno/resumo-turma?codturma=X ────────────────
       Retorna alunos da turma com contagem de ocorrências por tipo
       (rápido — sem chamada RCO) para popular o painel lateral.        */
    router.get('/ficha-aluno/resumo-turma', async (req, res) => {
        const { codturma } = req.query;
        if (!codturma) return res.status(400).json({ erro: 'codturma é obrigatório' });

        try {
            const { data: alunos, error: alunosErr } = await supabaseAdmin
                .from('alunos')
                .select('nome, numchamada, codmatrizaluno, turma')
                .eq('codturma', parseInt(codturma, 10))
                .order('numchamada', { ascending: true, nullsFirst: false })
                .order('nome',        { ascending: true });

            if (alunosErr) throw alunosErr;
            if (!alunos || alunos.length === 0) return res.json({ alunos: [] });

            const codMatrizes = alunos.map(a => a.codmatrizaluno).filter(Boolean);

            const { data: ocorrencias } = await supabaseAdmin
                .from('aluno_ocorrencias')
                .select('cod_matriz_aluno, tipo')
                .in('cod_matriz_aluno', codMatrizes);

            const ocorrMap = {};
            for (const o of (ocorrencias || [])) {
                const k = o.cod_matriz_aluno;
                if (!ocorrMap[k]) ocorrMap[k] = { positivo: 0, atencao: 0, grave: 0 };
                if (ocorrMap[k][o.tipo] !== undefined) ocorrMap[k][o.tipo]++;
            }

            res.json({
                alunos: alunos.map(a => ({
                    codMatrizAluno: a.codmatrizaluno,
                    nome:          a.nome,
                    numchamada:    a.numchamada,
                    turma:         a.turma,
                    ocorrencias:   ocorrMap[a.codmatrizaluno] || { positivo: 0, atencao: 0, grave: 0 },
                })),
            });
        } catch (e) {
            console.error('[FICHA-ALUNO] resumo-turma:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    router.get('/ficha-aluno', async (req, res) => {
        const codMatrizAluno = req.query.codMatrizAluno;
        if (!codMatrizAluno) {
            return res.status(400).json({ erro: 'codMatrizAluno é obrigatório' });
        }

        const codMatriz = parseInt(codMatrizAluno, 10);
        if (isNaN(codMatriz)) {
            return res.status(400).json({ erro: 'codMatrizAluno inválido' });
        }

        try {
            const [alunoResult, ocorrenciasResult, observacoesResult, emprestimosResult] =
                await Promise.allSettled([
                    supabaseAdmin
                        .from('alunos')
                        .select('nome, turma, codturma, numchamada, codmatrizaluno')
                        .eq('codmatrizaluno', codMatriz)
                        .maybeSingle(),

                    supabaseAdmin
                        .from('aluno_ocorrencias')
                        .select('*')
                        .eq('cod_matriz_aluno', codMatriz)
                        .order('data', { ascending: false })
                        .order('criado_em', { ascending: false }),

                    supabaseAdmin
                        .from('rco_observacoes')
                        .select('*')
                        .eq('cod_matriz_aluno', codMatriz)
                        .order('data_aula', { ascending: false }),

                    pool.query(
                        `SELECT e.*, l.titulo AS livro_titulo, l.disciplina AS livro_disciplina,
                                l.editora AS livro_editora, l.autor AS livro_autor
                         FROM livros_emprestimos e
                         JOIN livros_didaticos l ON l.id = e.livro_id
                         WHERE e.cod_matriz_aluno = $1
                         ORDER BY e.data_emprestimo DESC`,
                        [codMatriz]
                    ),
                ]);

            const aluno = alunoResult.status === 'fulfilled' ? alunoResult.value?.data : null;
            const nomeAluno = aluno?.nome || `Aluno #${codMatriz}`;
            const codturma = aluno?.codturma || null;

            const ocorrenciasRaw = ocorrenciasResult.status === 'fulfilled'
                ? (ocorrenciasResult.value?.data || [])
                : [];

            const observacoesRaw = observacoesResult.status === 'fulfilled'
                ? (observacoesResult.value?.data || [])
                : [];

            // Enriquecer observações com nome da disciplina (cod_classe → rco_classes → rco_disciplinas)
            let observacoes = observacoesRaw;
            if (observacoesRaw.length > 0) {
                try {
                    const codClassesUnicos = [...new Set(observacoesRaw.map(o => o.cod_classe).filter(Boolean))];
                    if (codClassesUnicos.length > 0) {
                        const { data: classesDisciplinas } = await supabaseAdmin
                            .from('rco_classes')
                            .select('cod_classe, cod_disciplina, rco_disciplinas(nome_disciplina)')
                            .in('cod_classe', codClassesUnicos);

                        const disciplinaMap = {};
                        for (const c of (classesDisciplinas || [])) {
                            disciplinaMap[c.cod_classe] = c.rco_disciplinas?.nome_disciplina || `Disciplina ${c.cod_disciplina}`;
                        }
                        observacoes = observacoesRaw.map(o => ({
                            ...o,
                            nome_disciplina: disciplinaMap[o.cod_classe] || null,
                        }));
                    }
                } catch (e) {
                    console.warn('[FICHA-ALUNO] Erro ao enriquecer observacoes com disciplina:', e.message);
                }
            }

            const emprestimos = emprestimosResult.status === 'fulfilled'
                ? (emprestimosResult.value?.rows || [])
                : [];

            // Enriquecer ocorrências com dados do professor (tabela local ocorrencia_meta)
            let ocorrencias = ocorrenciasRaw;
            if (ocorrenciasRaw.length > 0) {
                try {
                    const ids = ocorrenciasRaw.map(o => o.id);
                    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
                    const metaResult = await pool.query(
                        `SELECT id_ocorrencia, professor_nome, nome_turma
                         FROM ocorrencia_meta
                         WHERE id_ocorrencia IN (${placeholders})`,
                        ids
                    );
                    const metaMap = {};
                    for (const row of metaResult.rows) {
                        metaMap[row.id_ocorrencia] = row;
                    }
                    ocorrencias = ocorrenciasRaw.map(o => ({
                        ...o,
                        professor_nome: metaMap[o.id]?.professor_nome || '',
                        nome_turma:     metaMap[o.id]?.nome_turma || o.cod_turma?.toString() || '',
                    }));
                } catch (e) {
                    console.warn('[FICHA-ALUNO] Erro ao buscar ocorrencia_meta:', e.message);
                }
            }

            // Frequências via RCO API (best-effort; não bloqueia a resposta se falhar)
            let frequencias = null;
            const rcoDisponivel = req.userSession?.rcoDisponivel !== false;

            if (rcoDisponivel && codturma) {
                try {
                    const { data: classes, error: classesErr } = await supabaseAdmin
                        .from('rco_classes')
                        .select('cod_classe, cod_disciplina, rco_disciplinas(nome_disciplina)')
                        .eq('cod_turma', codturma);

                    if (!classesErr && classes && classes.length > 0) {
                        const freqResults = await Promise.allSettled(
                            classes.map(async (cl) => {
                                const codClasse = cl.cod_classe;
                                const nomeDisciplina = cl.rco_disciplinas?.nome_disciplina || `Disciplina ${cl.cod_disciplina}`;
                                try {
                                    const resp = await rcoApiService.get(
                                        `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${process.env.RCO_COD_PERIODO_AVALIACAO ?? 9}&codPeriodoLetivo=${process.env.RCO_COD_PERIODO_LETIVO ?? 261}&page=1&perPage=200`
                                    );
                                    if (resp.status !== 200) return null;
                                    const raw = Array.isArray(resp.data) ? resp.data : [];

                                    /* usa == (não ===) para tolerar string vs number */
                                    // eslint-disable-next-line eqeqeq
                                    const alunoFreq = raw.find(a => a.codMatrizAluno == codMatriz);

                                    if (!alunoFreq) {
                                        /* Disciplina existe para a turma mas ainda não tem aulas
                                           registradas para este aluno (frequência não lançada).
                                           Mostra a disciplina com zeros em vez de sumir. */
                                        return { codClasse, nomeDisciplina, totalAulas: 0, presencas: 0, faltas: 0, percentual: null, semDados: true };
                                    }

                                    const aulaKeys = Object.keys(alunoFreq).filter(k => /^\d+$/.test(k));
                                    const totalAulas = aulaKeys.filter(k => alunoFreq[k] != null).length;
                                    const presencas  = aulaKeys.filter(k => alunoFreq[k] === 'C').length;
                                    const faltas     = aulaKeys.filter(k => alunoFreq[k] && alunoFreq[k] !== 'C').length;
                                    const percentual = totalAulas > 0 ? Math.round((presencas / totalAulas) * 100) : null;

                                    return { codClasse, nomeDisciplina, totalAulas, presencas, faltas, percentual };
                                } catch {
                                    return null;
                                }
                            })
                        );

                        const freqValidas = freqResults
                            .filter(r => r.status === 'fulfilled' && r.value !== null)
                            .map(r => r.value);

                        if (freqValidas.length > 0) frequencias = freqValidas;
                    }
                } catch (e) {
                    console.warn('[FICHA-ALUNO] Erro ao buscar frequências RCO:', e.message);
                }
            }

            res.json({
                aluno: {
                    codMatrizAluno: codMatriz,
                    nome:          nomeAluno,
                    turma:         aluno?.turma || '',
                    codturma:      codturma,
                    numchamada:    aluno?.numchamada || null,
                },
                frequencias,      // null se RCO indisponível; array de { codClasse, nomeDisciplina, totalAulas, presencas, faltas, percentual } se disponível
                ocorrencias,      // array completo com professor_nome e nome_turma
                observacoes,      // rco_observacoes por cod_matriz_aluno
                emprestimos,      // livros_emprestimos com join em livros_didaticos
                geradoEm: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[FICHA-ALUNO] Erro:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
