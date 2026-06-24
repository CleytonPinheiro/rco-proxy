import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrarOcorrenciaMeta() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ocorrencia_meta (
                id_ocorrencia TEXT PRIMARY KEY,
                professor_nome TEXT NOT NULL DEFAULT '',
                nome_turma     TEXT NOT NULL DEFAULT '',
                criado_em      TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            ALTER TABLE ocorrencia_meta
            ADD COLUMN IF NOT EXISTS disciplina TEXT NOT NULL DEFAULT ''
        `);
        console.log('[COMPORTAMENTO] Tabela ocorrencia_meta OK');
    } catch (e) {
        console.warn('[COMPORTAMENTO] Erro migração ocorrencia_meta:', e.message);
    }
}

migrarOcorrenciaMeta();

export function createComportamentoRouter({ supabaseAdmin, rcoApiService }) {
    const router = Router();

    router.get('/comportamento', async (req, res) => {
        const { codTurma } = req.query;
        try {
            let query = supabaseAdmin.from('aluno_ocorrencias')
                .select('*')
                .order('data', { ascending: false })
                .order('criado_em', { ascending: false });

            if (codTurma) {
                query = query.eq('cod_turma', parseInt(codTurma));
            } else {
                const { data: turmasData } = await supabaseAdmin
                    .from('rco_turmas')
                    .select('cod_turma');
                if (turmasData && turmasData.length > 0) {
                    query = query.in('cod_turma', turmasData.map(t => t.cod_turma));
                }
            }

            const { data, error } = await query;
            if (error) return res.status(500).json({ erro: error.message });
            res.json(data || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/comportamento', async (req, res) => {
        const { cod_matriz_aluno, cod_turma, nome_aluno, num_chamada,
                data, tipo, categoria, categoria_label, descricao, pontos,
                professor_nome, nome_turma, disciplina } = req.body;
        if (!cod_matriz_aluno || !cod_turma || !tipo || !categoria) {
            return res.status(400).json({ erro: 'Campos obrigatórios ausentes' });
        }
        try {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            const { error } = await supabaseAdmin.from('aluno_ocorrencias').insert({
                id, cod_matriz_aluno, cod_turma, nome_aluno: nome_aluno || '',
                num_chamada: num_chamada || null,
                data: data || new Date().toISOString().split('T')[0],
                tipo, categoria, categoria_label: categoria_label || categoria,
                descricao: descricao || '', pontos: pontos || 0,
            });
            if (error) return res.status(500).json({ erro: error.message });

            await pool.query(
                `INSERT INTO ocorrencia_meta (id_ocorrencia, professor_nome, nome_turma, disciplina)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (id_ocorrencia) DO UPDATE
                 SET professor_nome = EXCLUDED.professor_nome,
                     nome_turma     = EXCLUDED.nome_turma,
                     disciplina     = EXCLUDED.disciplina`,
                [id, professor_nome || '', nome_turma || '', disciplina || '']
            );

            const { data: row } = await supabaseAdmin.from('aluno_ocorrencias').select('*').eq('id', id).single();
            res.json(row);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Normalizar ocorrências: corrige cod_matriz_aluno e nome_aluno ────────────
    router.post('/comportamento/normalizar', async (req, res) => {
        const { codturma } = req.body;
        if (!codturma) return res.status(400).json({ erro: 'codturma obrigatório' });

        try {
            const codturmaInt = parseInt(codturma, 10);

            // 1. Busca todas as ocorrências da turma
            const { data: ocorrencias, error: ocErr } = await supabaseAdmin
                .from('aluno_ocorrencias')
                .select('id, cod_matriz_aluno, nome_aluno, cod_turma')
                .eq('cod_turma', codturmaInt);
            if (ocErr) throw new Error(ocErr.message);
            if (!ocorrencias || ocorrencias.length === 0) {
                return res.json({ atualizados: 0, naoIdentificados: 0, total: 0 });
            }

            // 2. Coleta nomes únicos das ocorrências com nome preenchido
            const nomesUnicos = [...new Set(
                ocorrencias
                    .map(o => (o.nome_aluno || '').trim().toUpperCase())
                    .filter(n => n.length > 0)
            )];

            // 3. Para cada nome, encontra o ID canônico no Supabase
            const nomeParaId = {};
            for (const nome of nomesUnicos) {
                const { data: rows } = await supabaseAdmin
                    .from('alunos')
                    .select('codmatrizaluno, nome')
                    .ilike('nome', nome)
                    .limit(1);
                if (rows && rows[0]) {
                    nomeParaId[nome] = rows[0].codmatrizaluno;
                }
            }

            // 4. Para ocorrências sem nome, tenta identificar via RCO
            const idParaNome = {};
            const idsOrfaos = [...new Set(
                ocorrencias
                    .filter(o => !(o.nome_aluno || '').trim())
                    .map(o => o.cod_matriz_aluno)
                    .filter(v => v != null)
            )];

            if (idsOrfaos.length > 0 && rcoApiService) {
                try {
                    const { data: classes } = await supabaseAdmin
                        .from('rco_classes')
                        .select('cod_classe')
                        .eq('cod_turma', codturmaInt);

                    for (const cl of (classes || [])) {
                        try {
                            const resp = await rcoApiService.get(
                                `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${cl.cod_classe}&codPeriodoAvaliacao=9`
                            );
                            const alunos = Array.isArray(resp.data) ? resp.data : [];
                            for (const a of alunos) {
                                const rcoId = a.codMatrizAluno ?? a.registro ?? a.id;
                                const nome  = (a.nome || '').trim();
                                if (rcoId && nome) {
                                    // Guarda ID-do-RCO → nome
                                    idParaNome[String(rcoId)] = nome;
                                    // Tenta descobrir ID canônico para este nome
                                    const nomeUp = nome.toUpperCase();
                                    if (!nomeParaId[nomeUp]) {
                                        const { data: rows } = await supabaseAdmin
                                            .from('alunos')
                                            .select('codmatrizaluno')
                                            .ilike('nome', nome)
                                            .limit(1);
                                        if (rows && rows[0]) {
                                            nomeParaId[nomeUp] = rows[0].codmatrizaluno;
                                        }
                                    }
                                }
                            }
                        } catch { /* ignora falha de uma classe */ }
                    }
                } catch { /* ignora falha ao buscar classes do RCO */ }
            }

            // 5. Processa cada ocorrência e acumula atualizações
            let atualizados = 0;
            let naoIdentificados = 0;

            for (const o of ocorrencias) {
                let nomeAtual = (o.nome_aluno || '').trim();
                const nomeOrigUp = nomeAtual.toUpperCase();

                // Se não tem nome, tenta via mapa do RCO
                if (!nomeAtual && idParaNome[String(o.cod_matriz_aluno)]) {
                    nomeAtual = idParaNome[String(o.cod_matriz_aluno)];
                }

                const nomeUp = nomeAtual.toUpperCase();
                const idCanonical = nomeUp ? (nomeParaId[nomeUp] ?? null) : null;

                const idMudou   = idCanonical !== null && String(idCanonical) !== String(o.cod_matriz_aluno);
                const nomeMudou = nomeAtual && nomeAtual !== (o.nome_aluno || '').trim();

                if (idMudou || nomeMudou) {
                    const patch = {};
                    if (idMudou)   patch.cod_matriz_aluno = idCanonical;
                    if (nomeMudou) patch.nome_aluno = nomeAtual;

                    const { error: upErr } = await supabaseAdmin
                        .from('aluno_ocorrencias')
                        .update(patch)
                        .eq('id', o.id);

                    if (!upErr) {
                        atualizados++;
                    } else {
                        console.warn('[NORMALIZAR] Falha ao atualizar ocorrência', o.id, upErr.message);
                    }
                } else if (!nomeAtual && !idCanonical) {
                    naoIdentificados++;
                }
            }

            console.log(`[NORMALIZAR] turma=${codturmaInt} total=${ocorrencias.length} atualizados=${atualizados} naoIdentificados=${naoIdentificados}`);
            res.json({ atualizados, naoIdentificados, total: ocorrencias.length });

        } catch (e) {
            console.error('[NORMALIZAR] Erro:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    // ── Painel: todos os registros das turmas do professor, cronológico ──────────
    router.get('/comportamento/painel', async (req, res) => {
        const { tipo, codTurma, de, ate } = req.query;
        try {
            const { data: turmasData } = await supabaseAdmin
                .from('rco_turmas')
                .select('cod_turma');
            const codigos = (turmasData || []).map(t => t.cod_turma);
            if (!codigos.length) return res.json([]);

            let q = supabaseAdmin
                .from('aluno_ocorrencias')
                .select('*')
                .in('cod_turma', codigos)
                .order('criado_em', { ascending: false });

            if (tipo)     q = q.eq('tipo', tipo);
            if (codTurma) q = q.eq('cod_turma', parseInt(codTurma));
            if (de)       q = q.gte('data', de);
            if (ate)      q = q.lte('data', ate);

            const { data: ocorrs, error } = await q;
            if (error) return res.status(500).json({ erro: error.message });
            if (!ocorrs || !ocorrs.length) return res.json([]);

            const ids = ocorrs.map(o => o.id);
            const metaRows = await pool.query(
                `SELECT id_ocorrencia, professor_nome, nome_turma, disciplina
                 FROM ocorrencia_meta WHERE id_ocorrencia = ANY($1)`,
                [ids]
            );
            const metaMap = {};
            for (const r of metaRows.rows) metaMap[r.id_ocorrencia] = r;

            const resultado = ocorrs.map(o => ({
                ...o,
                professor_nome: metaMap[o.id]?.professor_nome || '',
                nome_turma:     metaMap[o.id]?.nome_turma     || '',
                disciplina:     metaMap[o.id]?.disciplina     || '',
            }));

            res.json(resultado);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.delete('/comportamento/:id', async (req, res) => {
        try {
            const { error } = await supabaseAdmin.from('aluno_ocorrencias').delete().eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
