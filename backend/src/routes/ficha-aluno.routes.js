import { Router } from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Sincroniza rco_observacoes para todas as classes de uma turma.
 * Reutiliza a mesma lógica de GET /api/rco/observacoes.
 * Retorna o total de observações inseridas/atualizadas (0 em caso de erro).
 */
async function sincronizarObsParaTurma(supabaseAdmin, rcoApiService, pool, codturma) {
    try {
        /* 1. Busca classes da turma */
        const { data: classes } = await supabaseAdmin
            .from('rco_classes')
            .select('cod_classe')
            .eq('cod_turma', codturma);
        if (!classes || classes.length === 0) return 0;

        /* 2. Lê mapa de períodos salvo pelo SyncService */
        let classPeriodMap = {};
        try {
            const { rows } = await pool.query(
                `SELECT valor FROM edusync_config WHERE chave = 'rco_classes_periodos'`
            );
            if (rows.length) classPeriodMap = JSON.parse(rows[0].valor);
        } catch (_) {}

        let total = 0;
        for (const cl of classes) {
            try {
                const codClasse = cl.cod_classe;
                const per = classPeriodMap[String(codClasse)] || {};
                const codPA = per.codPA ?? 9;
                const codPL = per.codPL ?? 261;

                /* Busca lista de aulas (mesma chamada que o front de Frequências faz) */
                const freqResp = await rcoApiService.get(
                    `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPA}&codPeriodoLetivo=${codPL}&page=1&perPage=200`
                );
                const alunosFreq = Array.isArray(freqResp.data)
                    ? freqResp.data
                    : (freqResp.data?.data || []);
                const aulaSet = new Set();
                alunosFreq.forEach(a =>
                    Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); })
                );
                const codAulas = [...aulaSet];
                if (!codAulas.length) continue;

                /* Para cada aula, busca observações (lotes de 10) */
                const LOTE = 10;
                const todasObs = [];
                for (let i = 0; i < codAulas.length; i += LOTE) {
                    const lote = codAulas.slice(i, i + LOTE);
                    const res = await Promise.all(lote.map(async (cod) => {
                        try {
                            const r = await rcoApiService.get(
                                `/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPL}`
                            );
                            const aula = r.data?.aula || {};
                            const dataAula = aula.dataAula ? aula.dataAula.substring(0, 10) : null;
                            return (aula.alunos || [])
                                .filter(a => a.observacao && a.observacao.trim())
                                .map(a => ({
                                    cod_aula:         parseInt(cod),
                                    cod_classe:       parseInt(codClasse),
                                    cod_matriz_aluno: a.codMatrizAluno,
                                    nome_aluno:       a.nome || '',
                                    num_chamada:      a.numChamada || null,
                                    data_aula:        dataAula,
                                    observacao:       a.observacao.trim(),
                                }));
                        } catch { return []; }
                    }));
                    res.forEach(r => todasObs.push(...r));
                }

                if (todasObs.length > 0) {
                    await supabaseAdmin
                        .from('rco_observacoes')
                        .upsert(todasObs, { onConflict: 'cod_aula,cod_matriz_aluno' });
                    total += todasObs.length;
                }
            } catch (e) {
                console.warn(`[SYNC-OBS] Erro na classe ${cl.cod_classe}:`, e.message);
            }
        }
        return total;
    } catch (e) {
        console.warn('[SYNC-OBS] Erro geral:', e.message);
        return 0;
    }
}

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
            const codMatrizesTurma = alunosUnicos
                .map(a => parseInt(a.codmatrizaluno, 10))
                .filter(n => !isNaN(n));

            /* ── Busca todos os IDs de cada aluno em TODAS as disciplinas ──────
               O RCO atribui um codMatrizAluno diferente por disciplina. Para
               exibir a SOMA de ocorrências de todas as disciplinas, primeiro
               buscamos na tabela `alunos` todos os registros desses alunos
               (usando o nome exato, que é consistente entre disciplinas) para
               obter todos os IDs de matrícula que podem aparecer nas ocorrências. */
            const nomesAlunos = alunosUnicos
                .map(a => (a.nome || '').trim())
                .filter(Boolean);

            const [todasMatriculasResult, atasResult] = await Promise.all([
                supabaseAdmin
                    .from('alunos')
                    .select('nome, codmatrizaluno')
                    .in('nome', nomesAlunos),
                pool.query(
                    `SELECT cod_matriz_aluno,
                            COUNT(*)::int          AS qtd,
                            MAX(impressa_em)       AS ultima_impressao,
                            MAX(impressa_por_nome) AS impressa_por
                     FROM ata_impressa
                     WHERE cod_matriz_aluno = ANY($1)
                     GROUP BY cod_matriz_aluno`,
                    [codMatrizesTurma]
                ).catch(() => ({ rows: [] })),
            ]);

            /* Mapa nome-normalizado → Set<codMatrizAluno> em TODAS as disciplinas */
            const nomeParaTodosIds = {};
            for (const m of (todasMatriculasResult.data || [])) {
                const key = (m.nome || '').toUpperCase().trim();
                const id  = parseInt(m.codmatrizaluno, 10);
                if (!isNaN(id)) {
                    if (!nomeParaTodosIds[key]) nomeParaTodosIds[key] = new Set();
                    nomeParaTodosIds[key].add(id);
                }
            }

            /* União de todos os IDs conhecidos (turma atual + outras disciplinas) */
            const todosIds = [...new Set([
                ...codMatrizesTurma,
                ...Object.values(nomeParaTodosIds).flatMap(s => [...s]),
            ])];

            /* ── 3 fontes de ocorrências + rco_observacoes cross-disciplina ─────
               1) byId   — todos os IDs do aluno em todas as disciplinas
               2) byNome — nome_aluno exato (cobre IDs não conhecidos via sync)
               3) byTurma — disciplina atual: captura registros orphãos com nome
                            preenchido ou IDs novos nesta disciplina específica
               4) obsResult — rco_observacoes: soma de observações do RCO Digital
                              de TODAS as disciplinas do aluno (usa todosIds)      */
            const [ocorrPorIdResult, ocorrPorNomeResult, ocorrPorTurmaResult, obsResult] = await Promise.all([
                supabaseAdmin
                    .from('aluno_ocorrencias')
                    .select('id, nome_aluno, cod_matriz_aluno, tipo')
                    .in('cod_matriz_aluno', todosIds),
                nomesAlunos.length > 0
                    ? supabaseAdmin
                        .from('aluno_ocorrencias')
                        .select('id, nome_aluno, cod_matriz_aluno, tipo')
                        .in('nome_aluno', nomesAlunos)
                    : Promise.resolve({ data: [] }),
                supabaseAdmin
                    .from('aluno_ocorrencias')
                    .select('id, nome_aluno, cod_matriz_aluno, tipo')
                    .eq('cod_turma', parseInt(codturma, 10)),
                todosIds.length > 0
                    ? supabaseAdmin
                        .from('rco_observacoes')
                        .select('id, cod_matriz_aluno')
                        .in('cod_matriz_aluno', todosIds)
                    : Promise.resolve({ data: [] }),
            ]);

            /* Expande nomeParaTodosIds com IDs descobertos nos próprios registros
               (nome_aluno → cod_matriz_aluno). Cobre disciplinas não sincronizadas
               em `alunos` onde o aluno tem registros com nome preenchido.         */
            for (const o of [
                ...(ocorrPorIdResult.data   || []),
                ...(ocorrPorNomeResult.data || []),
                ...(ocorrPorTurmaResult.data || []),
            ]) {
                const nomeKey = (o.nome_aluno || '').toUpperCase().trim();
                const id      = parseInt(o.cod_matriz_aluno, 10);
                if (nomeKey && !isNaN(id)) {
                    if (!nomeParaTodosIds[nomeKey]) nomeParaTodosIds[nomeKey] = new Set();
                    nomeParaTodosIds[nomeKey].add(id);
                }
            }

            /* União deduplicada por id — monta mapa cod_matriz_aluno → contagens */
            const ocorrMapCod = {};
            const seenOcorrIds = new Set();
            for (const o of [
                ...(ocorrPorIdResult.data    || []),
                ...(ocorrPorNomeResult.data  || []),
                ...(ocorrPorTurmaResult.data || []),
            ]) {
                if (o.id != null && seenOcorrIds.has(o.id)) continue;
                if (o.id != null) seenOcorrIds.add(o.id);
                if (o.cod_matriz_aluno != null) {
                    if (!ocorrMapCod[o.cod_matriz_aluno])
                        ocorrMapCod[o.cod_matriz_aluno] = { positivo: 0, atencao: 0, grave: 0 };
                    if (ocorrMapCod[o.cod_matriz_aluno][o.tipo] !== undefined)
                        ocorrMapCod[o.cod_matriz_aluno][o.tipo]++;
                }
            }

            const totalOcorrencias = seenOcorrIds.size;
            if (totalOcorrencias > 0 || alunosUnicos.length > 0) {
                console.log(`[FICHA-ALUNO] resumo-turma ${codturma}: ${alunosUnicos.length} alunos, ${totalOcorrencias} ocorrências únicas`);
            }

            /* Mapa cod_matriz_aluno → contagem de rco_observacoes (cross-disciplina) */
            const obsMapCod = {};
            const seenObsIds = new Set();
            for (const o of (obsResult?.data || [])) {
                if (o.id != null && seenObsIds.has(o.id)) continue;
                if (o.id != null) seenObsIds.add(o.id);
                if (o.cod_matriz_aluno != null)
                    obsMapCod[o.cod_matriz_aluno] = (obsMapCod[o.cod_matriz_aluno] || 0) + 1;
            }

            const atasMap = {};
            for (const r of (atasResult.rows || [])) {
                atasMap[r.cod_matriz_aluno] = {
                    qtd:            r.qtd,
                    ultimaImpressao: r.ultima_impressao,
                    impressaPor:    r.impressa_por,
                };
            }

            res.json({
                alunos: alunosUnicos.map(a => {
                    const nomeKey = (a.nome || '').toUpperCase().trim();
                    const codSync = parseInt(a.codmatrizaluno, 10);

                    /* Soma ocorrências de TODOS os IDs do aluno (alunos table +
                       IDs descobertos nos próprios registros de ocorrência)       */
                    const idsAluno = nomeParaTodosIds[nomeKey]
                        || new Set(isNaN(codSync) ? [] : [codSync]);
                    let ocorr = { positivo: 0, atencao: 0, grave: 0 };
                    let obsCount = 0;
                    for (const id of idsAluno) {
                        const c = ocorrMapCod[id] || {};
                        ocorr.positivo += c.positivo || 0;
                        ocorr.atencao  += c.atencao  || 0;
                        ocorr.grave    += c.grave    || 0;
                        obsCount       += obsMapCod[id] || 0;
                    }

                    return {
                        codMatrizAluno: a.codmatrizaluno,
                        nome:          a.nome,
                        numchamada:    a.numchamada,
                        turma:         a.turma,
                        ocorrencias:   ocorr,
                        obsCount,
                        atasImpressas: atasMap[codSync] || atasMap[a.codmatrizaluno] || null,
                    };
                }),
            });
        } catch (e) {
            console.error('[FICHA-ALUNO] resumo-turma:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── POST /api/ficha-aluno/sync-obs?codMatrizAluno=X ────────────────────
       Busca observações frescas do RCO para TODAS as classes da turma do aluno
       e faz upsert em rco_observacoes. Bloqueante (aguarda conclusão).        */
    router.post('/ficha-aluno/sync-obs', async (req, res) => {
        const codMatriz = parseInt(req.query.codMatrizAluno || req.body?.codMatrizAluno, 10);
        if (isNaN(codMatriz)) return res.status(400).json({ erro: 'codMatrizAluno inválido' });
        try {
            const { data: aluno } = await supabaseAdmin
                .from('alunos')
                .select('codturma, nome')
                .eq('codmatrizaluno', codMatriz)
                .maybeSingle();
            if (!aluno?.codturma) return res.status(404).json({ erro: 'Turma não encontrada para este aluno.' });
            const total = await sincronizarObsParaTurma(supabaseAdmin, rcoApiService, pool, aluno.codturma);
            console.log(`[SYNC-OBS] "${aluno.nome}" turma ${aluno.codturma} → ${total} obs sincronizadas`);
            res.json({ ok: true, total, codturma: aluno.codturma });
        } catch (e) {
            console.error('[SYNC-OBS]', e.message);
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
            /* Busca aluno primeiro para obter nome e codturma — necessários para
               a busca robusta de ocorrências por nome (resolve mismatch de ID RCO). */
            const [alunoResult, observacoesResult, emprestimosResult, configResult] =
                await Promise.allSettled([
                    supabaseAdmin
                        .from('alunos')
                        .select('nome, turma, codturma, numchamada, codmatrizaluno')
                        .eq('codmatrizaluno', codMatriz)
                        .maybeSingle(),

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

            /* ── Busca robusta de ocorrências ──────────────────────────────────
               O RCO atribui codMatrizAluno POR CLASSE. O mesmo aluno pode ter
               IDs diferentes em disciplinas distintas da mesma turma.

               Estratégia em 4 camadas (sempre executa todas):
               A) Por codMatriz Supabase direto
               B) Todos os codmatrizaluno do aluno nas demais turmas (alunos table)
               C) Por nome ilike nas ocorrências → descobre IDs extras
               D) Por cod_turma das turmas do aluno + filtro por nome (JS-side)
                  → pega registros com nome_aluno vazio que compartilham turma+ID
               Resultado final: união de tudo, deduplicada por id. */

            /* Padrão ilike com wildcards — tolerante a espaços duplos e
               pequenas diferenças de formatação entre endpoints RCO.
               Definido aqui para ser reutilizado também na busca de turmas. */
            const nomeBuscaPattern = nomeAluno.trim().replace(/\s+/g, '%');

            /* Padrão reduzido para busca de turmas: usa apenas primeiro e último
               token do nome. Isso tolera abreviações de nomes do meio que o RCO
               pode gravar diferente por disciplina (ex: "NICHOLAS DE FREITAS" vs
               "NICHOLAS FIORATI FUMAGALLI DE FREITAS"). */
            const nomeTokens = nomeAluno.trim().split(/\s+/).filter(Boolean);
            const nomePatternTurmas = nomeTokens.length >= 2
                ? `%${nomeTokens[0]}%${nomeTokens[nomeTokens.length - 1]}%`
                : `%${nomeAluno.trim()}%`;

            /* B: todos os IDs deste aluno em QUALQUER turma.
               Usa padrão reduzido (primeiro+último nome) para tolerar variações. */
            const { data: todasTurmasAluno } = await supabaseAdmin
                .from('alunos')
                .select('codmatrizaluno, codturma')
                .ilike('nome', nomePatternTurmas);

            const todosIdsSupabase = [...new Set([
                codMatriz,
                ...(todasTurmasAluno || []).map(r => parseInt(r.codmatrizaluno, 10)).filter(v => !isNaN(v)),
            ])];
            const todasTurmas = [...new Set(
                (todasTurmasAluno || []).map(r => parseInt(r.codturma, 10)).filter(v => !isNaN(v))
            )];

            console.log(`[FICHA-ALUNO] "${nomeAluno}" codMatriz=${codMatriz} | allIds=${todosIdsSupabase} | allTurmas=${todasTurmas} | pattern="${nomeBuscaPattern}"`);

            /* A+B: por todos os IDs conhecidos; C: por nome (wildcards); D: por turmas */
            const [byIdsResult, byNomeResult, byTurmasResult] = await Promise.all([
                supabaseAdmin
                    .from('aluno_ocorrencias')
                    .select('*')
                    .in('cod_matriz_aluno', todosIdsSupabase)
                    .order('data',      { ascending: false })
                    .order('criado_em', { ascending: false }),

                (nomeAluno && !nomeAluno.startsWith('Aluno #'))
                    ? supabaseAdmin
                        .from('aluno_ocorrencias')
                        .select('*')
                        .ilike('nome_aluno', `%${nomeBuscaPattern}%`)
                        .order('data',      { ascending: false })
                        .order('criado_em', { ascending: false })
                    : Promise.resolve({ data: [] }),

                todasTurmas.length > 0
                    ? supabaseAdmin
                        .from('aluno_ocorrencias')
                        .select('*')
                        .in('cod_turma', todasTurmas)
                        .order('data',      { ascending: false })
                        .order('criado_em', { ascending: false })
                    : Promise.resolve({ data: [] }),
            ]);

            /* Descobre IDs do aluno a partir dos registros com nome */
            const idsDoAluno = new Set(todosIdsSupabase);
            const nomeBusca  = nomeAluno.toUpperCase().trim();
            [...(byNomeResult.data || []), ...(byTurmasResult.data || [])].forEach(o => {
                if ((o.nome_aluno || '').toUpperCase().trim() === nomeBusca && o.cod_matriz_aluno != null)
                    idsDoAluno.add(o.cod_matriz_aluno);
            });

            /* Une: registros por ID OU por nome; registros de turma só se ID descoberto */
            const seenIds = new Set();
            const ocorrenciasRaw = [
                ...(byIdsResult.data   || []),
                ...(byNomeResult.data  || []),
                ...(byTurmasResult.data || []).filter(o =>
                    idsDoAluno.has(o.cod_matriz_aluno) ||
                    (o.nome_aluno || '').toUpperCase().trim() === nomeBusca
                ),
            ]
                .filter(o => { if (seenIds.has(o.id)) return false; seenIds.add(o.id); return true; })
                .sort((a, b) => {
                    const d = new Date(b.data) - new Date(a.data);
                    return d !== 0 ? d : new Date(b.criado_em) - new Date(a.criado_em);
                });

            if (byNomeResult.error)  console.log('[FICHA-ALUNO] byNome  err:', byNomeResult.error.message);
            if (byTurmasResult.error) console.log('[FICHA-ALUNO] byTurmas err:', byTurmasResult.error.message);
            const turmaSample = (byTurmasResult.data||[]).slice(0,5).map(o=>({n:o.nome_aluno, id:o.cod_matriz_aluno}));
            console.log(`[FICHA-ALUNO] "${nomeAluno}": byIds=${(byIdsResult.data||[]).length} byNome=${(byNomeResult.data||[]).length} byTurmas=${(byTurmasResult.data||[]).length} total=${ocorrenciasRaw.length} | turma_sample=${JSON.stringify(turmaSample)}`);

            /* rco_observacoes: a query inicial (linha ~195) usou apenas codMatriz.
               Aqui expandimos para TODOS os IDs conhecidos do aluno (outras disciplinas)
               para capturar observações salvas com IDs diferentes entre classes RCO. */
            const observacoesIniciais = observacoesResult.status === 'fulfilled'
                ? (observacoesResult.value?.data || [])
                : [];

            const idsExtrasObs = todosIdsSupabase.filter(id => id !== codMatriz);
            let observacoesExtras = [];
            if (idsExtrasObs.length > 0) {
                const { data: extrasData } = await supabaseAdmin
                    .from('rco_observacoes')
                    .select('*')
                    .in('cod_matriz_aluno', idsExtrasObs)
                    .order('data_aula', { ascending: false });
                observacoesExtras = extrasData || [];
            }

            /* União deduplicada por id — ordem cronológica decrescente */
            const seenObsIds = new Set(observacoesIniciais.map(o => o.id));
            const observacoesRaw = [
                ...observacoesIniciais,
                ...observacoesExtras.filter(o => !seenObsIds.has(o.id)),
            ].sort((a, b) => new Date(b.data_aula) - new Date(a.data_aula));

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
