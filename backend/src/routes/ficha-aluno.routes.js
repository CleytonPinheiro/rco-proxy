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

            /* Deduplica por nome (normalizado) — evita duplicatas quando o mesmo aluno
               foi sincronizado com codMatrizAluno diferente em classes distintas */
            const vistos = new Set();
            const alunosUnicos = (alunos || []).filter(a => {
                const chave = (a.nome || '').toUpperCase().trim();
                if (vistos.has(chave)) return false;
                vistos.add(chave);
                return true;
            });

            /* codmatrizaluno na tabela alunos pode ser TEXT; garantimos inteiros
               para o filtro da ata_impressa (coluna INTEGER) */
            const codMatrizes = alunosUnicos
                .map(a => parseInt(a.codmatrizaluno, 10))
                .filter(n => !isNaN(n));

            /* IMPORTANTE: o RCO atribui codMatrizAluno por CLASSE (não por turma).
               O mesmo aluno pode ter IDs diferentes em disciplinas distintas da mesma
               turma. As ocorrências são gravadas com o ID da classe que o professor
               abriu no módulo Comportamento, enquanto o Supabase sincroniza o ID de
               outra classe — causando mismatch no filtro .in().
               Solução: buscar ocorrências pelo cod_turma (sempre consistente) e
               parear com os alunos pelo nome (já usado para deduplicação acima). */
            const [ocorrResult, atasResult] = await Promise.all([
                supabaseAdmin
                    .from('aluno_ocorrencias')
                    .select('nome_aluno, cod_matriz_aluno, tipo')
                    .eq('cod_turma', parseInt(codturma, 10)),
                pool.query(
                    `SELECT cod_matriz_aluno,
                            COUNT(*)::int          AS qtd,
                            MAX(impressa_em)       AS ultima_impressao,
                            MAX(impressa_por_nome) AS impressa_por
                     FROM ata_impressa
                     WHERE cod_matriz_aluno = ANY($1)
                     GROUP BY cod_matriz_aluno`,
                    [codMatrizes]
                ).catch(() => ({ rows: [] })),
            ]);

            if (ocorrResult.error) {
                console.error('[FICHA-ALUNO] Supabase aluno_ocorrencias error:', ocorrResult.error.message);
            }
            const ocorrencias = ocorrResult.data || [];
            console.log(`[FICHA-ALUNO] resumo-turma ${codturma}: ${alunosUnicos.length} alunos, ${ocorrencias.length} ocorrências`);

            /* Mapa nome normalizado → Set de cod_matriz_aluno encontrados nas ocorrências.
               Permite descobrir o ID real do aluno (RCO por classe) a partir do nome. */
            const nomeParaIds = {};
            /* Mapa cod_matriz_aluno → contagens por tipo (inclui ocorrências sem nome). */
            const ocorrMapCod = {};
            for (const o of ocorrencias) {
                const nomeKey = (o.nome_aluno || '').toUpperCase().trim();
                const codKey  = o.cod_matriz_aluno;
                if (nomeKey && codKey != null) {
                    if (!nomeParaIds[nomeKey]) nomeParaIds[nomeKey] = new Set();
                    nomeParaIds[nomeKey].add(codKey);
                }
                if (codKey != null) {
                    if (!ocorrMapCod[codKey]) ocorrMapCod[codKey] = { positivo: 0, atencao: 0, grave: 0 };
                    if (ocorrMapCod[codKey][o.tipo] !== undefined) ocorrMapCod[codKey][o.tipo]++;
                }
            }

            const atasMap = {};
            for (const r of (atasResult.rows || [])) {
                atasMap[r.cod_matriz_aluno] = {
                    qtd:           r.qtd,
                    ultimaImpressao: r.ultima_impressao,
                    impressaPor:   r.impressa_por,
                };
            }

            res.json({
                alunos: alunosUnicos.map(a => {
                    const nomeKey = (a.nome || '').toUpperCase().trim();
                    const codSync = parseInt(a.codmatrizaluno, 10);

                    /* Estratégia:
                       1. Usa o nome para encontrar o(s) cod_matriz_aluno real(is) do aluno
                          nas ocorrências (resolve o mismatch de ID entre classes RCO).
                       2. Soma TODAS as ocorrências por esses IDs — inclusive as gravadas
                          sem nome_aluno, garantindo contagem completa (ex: 9/9, não 6/9).
                       3. Fallback: se não há ocorrências com nome, tenta o ID do Supabase. */
                    const idsReais = nomeParaIds[nomeKey];
                    let ocorr = { positivo: 0, atencao: 0, grave: 0 };
                    if (idsReais && idsReais.size > 0) {
                        for (const id of idsReais) {
                            const c = ocorrMapCod[id] || {};
                            ocorr.positivo += c.positivo || 0;
                            ocorr.atencao  += c.atencao  || 0;
                            ocorr.grave    += c.grave    || 0;
                        }
                    } else {
                        ocorr = ocorrMapCod[codSync] || ocorrMapCod[a.codmatrizaluno] || ocorr;
                    }

                    return {
                        codMatrizAluno: a.codmatrizaluno,
                        nome:          a.nome,
                        numchamada:    a.numchamada,
                        turma:         a.turma,
                        ocorrencias:   ocorr,
                        atasImpressas: atasMap[codSync] || atasMap[a.codmatrizaluno] || null,
                    };
                }),
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

            let ocorrenciasRaw = ocorrenciasResult.status === 'fulfilled'
                ? (ocorrenciasResult.value?.data || [])
                : [];

            /* Fallback 2 passos: o RCO atribui codMatrizAluno por classe — o ID
               salvo na ocorrência pode diferir do sincronizado no Supabase.
               Passo 1: descobre o cod_matriz_aluno real pelo nome + turma.
               Passo 2: busca TODAS as ocorrências por esse ID (inclusive as
               que foram gravadas sem nome_aluno, cobrindo 100% dos registros). */
            if (ocorrenciasRaw.length === 0 && nomeAluno && !nomeAluno.startsWith('Aluno #') && codturma) {
                const { data: idRows } = await supabaseAdmin
                    .from('aluno_ocorrencias')
                    .select('cod_matriz_aluno')
                    .eq('cod_turma', codturma)
                    .ilike('nome_aluno', nomeAluno.trim());

                const idsReais = [...new Set((idRows || []).map(r => r.cod_matriz_aluno).filter(v => v != null))];

                if (idsReais.length > 0) {
                    const { data: fbData } = await supabaseAdmin
                        .from('aluno_ocorrencias')
                        .select('*')
                        .in('cod_matriz_aluno', idsReais)
                        .order('data',      { ascending: false })
                        .order('criado_em', { ascending: false });
                    if (fbData && fbData.length > 0) {
                        ocorrenciasRaw = fbData;
                        console.log(`[FICHA-ALUNO] fallback por nome "${nomeAluno}" (ids=${idsReais}): ${fbData.length} ocorrência(s)`);
                    }
                }
            }

            const observacoesRaw = observacoesResult.status === 'fulfilled'
                ? (observacoesResult.value?.data || [])
                : [];

            // Busca todas as disciplinas da turma (para listar mesmo as sem observações)
            let todasDisciplinas = [];
            if (codturma) {
                try {
                    const { data: classesDisc } = await supabaseAdmin
                        .from('rco_classes')
                        .select('cod_classe, rco_disciplinas(nome_disciplina)')
                        .eq('cod_turma', codturma);
                    const seen = new Set();
                    todasDisciplinas = (classesDisc || [])
                        .map(c => ({ cod_classe: c.cod_classe, nome_disciplina: c.rco_disciplinas?.nome_disciplina || null }))
                        .filter(d => d.nome_disciplina && !seen.has(d.nome_disciplina) && seen.add(d.nome_disciplina));
                } catch (e) {
                    console.warn('[FICHA-ALUNO] Erro ao buscar todas disciplinas:', e.message);
                }
            }

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

                    /* Lê mapa de períodos salvo pelo SyncService no edusync_config local
                       (fallback para quando as migrations Supabase ainda não foram aplicadas) */
                    let classPeriodMap = {};
                    try {
                        const { rows: cfgRows } = await pool.query(
                            `SELECT valor FROM edusync_config WHERE chave = 'rco_classes_periodos'`
                        );
                        if (cfgRows.length) classPeriodMap = JSON.parse(cfgRows[0].valor);
                    } catch (_) {}

                    if (!classesErr && classes && classes.length > 0) {
                        const freqResults = await Promise.allSettled(
                            classes.map(async (cl) => {
                                const codClasse = cl.cod_classe;
                                const nomeDisciplina = cl.rco_disciplinas?.nome_disciplina || `Disciplina ${cl.cod_disciplina}`;
                                try {
                                    /* Prioridade: (1) mapa local edusync_config (salvo no sync),
                                       (2) coluna Supabase (após migrations), (3) env, (4) default */
                                    const periodoLocal = classPeriodMap[String(codClasse)];
                                    const codPA = periodoLocal?.codPA
                                        ?? cl.cod_periodo_avaliacao
                                        ?? process.env.RCO_COD_PERIODO_AVALIACAO
                                        ?? 9;
                                    const codPL = periodoLocal?.codPL
                                        ?? cl.cod_periodo_letivo
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
                                    let alunoFreq = raw.find(a => a.codMatrizAluno == codMatriz);

                                    /* O RCO usa codMatrizAluno específico por classe/matrícula.
                                       O sync só armazena o ID da primeira classe por turma.
                                       Se não encontrado mas a turma tem dados, busca o ID correto
                                       via avaliacaoAlunos e faz match por nome do aluno. */
                                    if (!alunoFreq && raw.length > 0 && nomeAluno && !nomeAluno.startsWith('Aluno #')) {
                                        try {
                                            const respV1Lista = await rcoApiService.get(
                                                `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${codClasse}&codPeriodoAvaliacao=${codPA}`
                                            );
                                            if (respV1Lista.status === 200) {
                                                const listaAlunos = normalizeRaw(respV1Lista.data);
                                                const nomeNorm = nomeAluno.trim().toUpperCase();
                                                const match = listaAlunos.find(s =>
                                                    s.nome?.trim().toUpperCase() === nomeNorm
                                                );
                                                if (match?.codMatrizAluno) {
                                                    // eslint-disable-next-line eqeqeq
                                                    alunoFreq = raw.find(a => a.codMatrizAluno == match.codMatrizAluno);
                                                    if (alunoFreq) {
                                                        console.log(`[FICHA-FREQ] classe ${codClasse} (${nomeDisciplina}): aluno encontrado via nome (codMatrizAluno classe=${match.codMatrizAluno})`);
                                                    }
                                                }
                                            }
                                        } catch { /* ignora */ }
                                    }

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
                todasDisciplinas, // todas as disciplinas da turma (para listar mesmo as sem obs)
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
