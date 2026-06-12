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
            const [alunoResult, ocorrenciasResult, observacoesResult, emprestimosResult, configResult] =
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

                    // Logo e nome da escola (best-effort)
                    pool.query(
                        `SELECT chave, valor FROM edusync_config
                         WHERE chave IN ('escola_logo_base64', 'escola_nome')`
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

            // Logo e nome da escola
            const configMap = {};
            if (configResult.status === 'fulfilled') {
                for (const row of (configResult.value?.rows || [])) {
                    configMap[row.chave] = row.valor;
                }
            }
            const escolaLogo = configMap['escola_logo_base64'] || null;
            const escolaNome = configMap['escola_nome'] || null;

            // Enriquecer ocorrências com dados do professor (tabela local ocorrencia_meta)
            let ocorrencias = ocorrenciasRaw;
            if (ocorrenciasRaw.length > 0) {
                try {
                    const ids = ocorrenciasRaw.map(o => o.id);
                    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
                    const metaResult = await pool.query(
                        `SELECT id_ocorrencia, professor_nome, nome_turma, disciplina
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
                        disciplina:     metaMap[o.id]?.disciplina  || '',
                    }));
                } catch (e) {
                    console.warn('[FICHA-ALUNO] Erro ao buscar ocorrencia_meta:', e.message);
                }
            }

            // Frequências via RCO API (best-effort; não bloqueia a resposta se falhar)
            // O TokenService usa o token do usuário quando disponível, ou o token
            // global de serviço quando o usuário não tem credenciais RCO próprias.
            let frequencias = null;

            if (codturma) {
                try {
                    let { data: classes, error: classesErr } = await supabaseAdmin
                        .from('rco_classes')
                        .select('cod_classe, cod_disciplina, cod_periodo_avaliacao, cod_periodo_letivo, rco_disciplinas(nome_disciplina)')
                        .eq('cod_turma', codturma);

                    /* Migrations 013/014 ainda não aplicadas — retentar sem as colunas de período */
                    if (classesErr && classesErr.message?.includes('cod_periodo_avaliacao')) {
                        console.warn('[FICHA-FREQ] Colunas de período ausentes; buscando classes sem elas (aplique as migrations 013+014).');
                        ({ data: classes, error: classesErr } = await supabaseAdmin
                            .from('rco_classes')
                            .select('cod_classe, cod_disciplina, rco_disciplinas(nome_disciplina)')
                            .eq('cod_turma', codturma));
                    }

                    console.log(`[FICHA-FREQ] codturma=${codturma} → classes encontradas: ${classes?.length ?? 0}${classesErr ? ' | erro: ' + classesErr.message : ''}`);

                    if (!classesErr && classes && classes.length > 0) {
                        const freqResults = await Promise.allSettled(
                            classes.map(async (cl) => {
                                const codClasse = cl.cod_classe;
                                const nomeDisciplina = cl.rco_disciplinas?.nome_disciplina || `Disciplina ${cl.cod_disciplina}`;
                                try {
                                    /* Usa o período armazenado por classe quando disponível;
                                       cai nos defaults de env se ainda NULL (antes de re-sync). */
                                    const codPA = cl.cod_periodo_avaliacao
                                        ?? process.env.RCO_COD_PERIODO_AVALIACAO
                                        ?? 9;
                                    const codPL = cl.cod_periodo_letivo
                                        ?? process.env.RCO_COD_PERIODO_LETIVO
                                        ?? 261;

                                    /* Tenta v3/frequenciaAulas. O RCO retorna array direto em
                                       algumas disciplinas e objeto paginado { data:[...] } em
                                       outras — ambos são tratados. */
                                    const normalizeRaw = (responseData) => {
                                        if (Array.isArray(responseData)) return responseData;
                                        if (responseData && Array.isArray(responseData.data)) return responseData.data;
                                        if (responseData && Array.isArray(responseData.content)) return responseData.content;
                                        return [];
                                    };

                                    let raw = [];
                                    const respV3 = await rcoApiService.get(
                                        `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPA}&codPeriodoLetivo=${codPL}&page=1&perPage=200`
                                    );
                                    if (respV3.status === 200) {
                                        raw = normalizeRaw(respV3.data);
                                        if (raw.length === 0) {
                                            console.warn(`[FICHA-FREQ] classe ${codClasse} (${nomeDisciplina}): v3 PA=${codPA} PL=${codPL} status=200 mas raw vazio. data type=${Array.isArray(respV3.data) ? 'array' : typeof respV3.data}, data keys=${respV3.data && typeof respV3.data === 'object' ? Object.keys(respV3.data).join(',') : 'n/a'}`);
                                        }
                                    } else {
                                        console.warn(`[FICHA-FREQ] classe ${codClasse} (${nomeDisciplina}): v3 PA=${codPA} PL=${codPL} status=${respV3.status}`);
                                    }

                                    /* Fallback: v1/avaliacaoAlunos (estrutura diferente mas
                                       também identifica o aluno por codMatrizAluno) */
                                    if (raw.length === 0) {
                                        try {
                                            const respV1 = await rcoApiService.get(
                                                `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPA}`
                                            );
                                            if (respV1.status === 200) {
                                                raw = normalizeRaw(respV1.data);
                                                console.warn(`[FICHA-FREQ] classe ${codClasse} (${nomeDisciplina}): v1 fallback, raw.length=${raw.length}`);
                                            } else {
                                                console.warn(`[FICHA-FREQ] classe ${codClasse} (${nomeDisciplina}): v1 status=${respV1.status}`);
                                            }
                                        } catch { /* ignora */ }
                                    }

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
                                } catch (freqErr) {
                                    console.warn(`[FICHA-FREQ] classe ${codClasse} (${nomeDisciplina}): ERRO → ${freqErr.message}`);
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
                escolaLogo,       // base64 da logo (null se não configurada)
                escolaNome,       // nome da escola (null se não configurado)
                geradoEm: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[FICHA-ALUNO] Erro:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
