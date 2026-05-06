const SYNC_TTL_MS_ENV = (parseInt(process.env.RCO_SYNC_TTL_HOURS ?? '4', 10) || 4) * 60 * 60 * 1000;

export class SyncService {
    #supabaseAdmin = null;
    #rcoApiService = null;
    #pool          = null;

    initialize(supabaseAdmin, rcoApiService, pool) {
        this.#supabaseAdmin = supabaseAdmin;
        this.#rcoApiService = rcoApiService;
        this.#pool          = pool;
    }

    /**
     * Reads the sync TTL from edusync_config at runtime.
     * Falls back to the RCO_SYNC_TTL_HOURS env var, then 4h.
     */
    async #getTtlMs() {
        if (!this.#pool) return SYNC_TTL_MS_ENV;
        try {
            const { rows } = await this.#pool.query(
                `SELECT valor FROM edusync_config WHERE chave = 'rco_sync_ttl_hours'`,
            );
            if (rows.length) {
                const parsed = parseFloat(rows[0].valor);
                if (Number.isFinite(parsed) && parsed > 0) return parsed * 60 * 60 * 1000;
            }
        } catch (e) {
            console.warn('[SYNC] Falha ao ler TTL de edusync_config:', e.message);
        }
        return SYNC_TTL_MS_ENV;
    }

    // Limpa dados de sessão anterior ao trocar de usuário.
    // Preserva aluno_ocorrencias (criadas pelo professor, não re-sincronizáveis).
    async limparParaTroca() {
        console.log('[SYNC] Limpando dados do usuário anterior...');
        // Cada item: [tabela, coluna_pk_para_filtro]
        // Supabase SDK exige ao menos um filtro no DELETE — usamos a PK >= 0 ou neq('')
        // Ordem importa: deletar filhos antes dos pais para respeitar FK
        // rco_classes → rco_turmas → rco_estabelecimentos
        const tabelasFiltros = [
            ['rco_classes',         'cod_classe',           'gte', 0],
            ['rco_turmas',          'cod_turma',            'gte', 0],
            ['rco_estabelecimentos','cod_estabelecimento',  'gte', 0],
            ['rco_observacoes',     'id',                   'gte', 0],
        ];
        for (const [tabela, col, op, val] of tabelasFiltros) {
            try {
                const { error } = await this.#supabaseAdmin
                    .from(tabela)
                    .delete()
                    [op](col, val);
                if (error) {
                    console.warn(`[SYNC] Aviso ao limpar ${tabela}:`, error.message);
                } else {
                    console.log(`[SYNC] ${tabela} limpa para troca de usuário.`);
                }
            } catch (e) {
                console.warn(`[SYNC] Erro ao limpar ${tabela}:`, e.message);
            }
        }
    }

    #dedup(arr, key) {
        return [...new Map(arr.map(x => [x[key], x])).values()];
    }

    /**
     * Verifica se o userId tem um sync recente.
     * Retorna { fresco: true, idadeMs, ultimoSync } ou { fresco: false }.
     */
    async #verificarCache(userId) {
        if (!this.#pool || !userId) return { fresco: false };
        try {
            const [{ rows }, ttlMs] = await Promise.all([
                this.#pool.query(
                    `SELECT ultimo_sync, puladas, executadas FROM edusync_sync_cache WHERE usuario_id = $1`,
                    [userId],
                ),
                this.#getTtlMs(),
            ]);
            if (!rows.length) return { fresco: false, ttlMs };
            const ultimoSync = new Date(rows[0].ultimo_sync);
            const idadeMs    = Date.now() - ultimoSync.getTime();
            return {
                fresco:    idadeMs < ttlMs,
                idadeMs,
                ttlMs,
                ultimoSync,
                puladas:   rows[0].puladas,
                executadas: rows[0].executadas,
            };
        } catch (e) {
            console.warn('[SYNC] Falha ao verificar cache local:', e.message);
            return { fresco: false };
        }
    }

    /** Persiste o timestamp do último sync bem-sucedido e incrementa o contador. */
    async #registrarSyncExecutado(userId) {
        if (!this.#pool || !userId) return;
        try {
            await this.#pool.query(
                `INSERT INTO edusync_sync_cache (usuario_id, ultimo_sync, executadas)
                 VALUES ($1, NOW(), 1)
                 ON CONFLICT (usuario_id)
                 DO UPDATE SET ultimo_sync = NOW(), executadas = edusync_sync_cache.executadas + 1`,
                [userId],
            );
        } catch (e) {
            console.warn('[SYNC] Falha ao persistir cache sync:', e.message);
        }
    }

    /** Incrementa o contador de syncs pulados. */
    async #registrarSyncPulado(userId) {
        if (!this.#pool || !userId) return;
        try {
            await this.#pool.query(
                `UPDATE edusync_sync_cache SET puladas = puladas + 1 WHERE usuario_id = $1`,
                [userId],
            );
        } catch (e) {
            console.warn('[SYNC] Falha ao atualizar contador de pulados:', e.message);
        }
    }

    /**
     * Sincroniza apenas se o cache estiver expirado ou se `forcar = true`.
     * Usado no fluxo pós-login e no endpoint de refresh manual.
     *
     * @param {number} userId   - ID local do usuário
     * @param {boolean} forcar  - ignora TTL e executa de qualquer forma
     * @returns {Promise<object>} resultado ou status 'cache_fresco'
     */
    async sincronizarSeNecessario(userId, forcar = false) {
        if (!forcar) {
            const cache = await this.#verificarCache(userId);
            if (cache.fresco) {
                const idadeMin = Math.round(cache.idadeMs / 60_000);
                const ttlMin   = Math.round((cache.ttlMs ?? SYNC_TTL_MS_ENV) / 60_000);
                console.log(`[SYNC] Pulado — cache fresco (age ${idadeMin} min, TTL ${ttlMin} min) para userId ${userId}`);
                this.#registrarSyncPulado(userId).catch(() => {});
                return {
                    status: 'cache_fresco',
                    idadeMin,
                    ultimoSync: cache.ultimoSync?.toISOString(),
                    mensagem:   `Dados sincronizados há ${idadeMin} min. Próximo sync automático em ~${Math.round(((cache.ttlMs ?? SYNC_TTL_MS_ENV) - cache.idadeMs) / 60_000)} min.`,
                };
            }
        }

        const resultado = await this.sincronizarComSupabase();

        if (resultado.status === 'sucesso') {
            await this.#registrarSyncExecutado(userId);
        }

        return resultado;
    }

    async sincronizarComSupabase() {
        const agora = new Date().toISOString();
        const t0    = Date.now();
        console.log(`[SYNC] Iniciando sincronização com Supabase em ${agora}...`);

        try {
            /* Fallback progressivo: tenta de hoje até 45 dias atrás
               até encontrar uma resposta com ao menos 1 estabelecimento */
            const MAX_DIAS = 45;
            const base = new Date();
            let raw = [];
            let dataUsada = null;

            for (let delta = 0; delta <= MAX_DIAS; delta++) {
                const d = new Date(base);
                d.setDate(base.getDate() - delta);
                const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
                const data = brt.toISOString().split('T')[0];

                try {
                    const response = await this.#rcoApiService.get(`/educador/estabelecimentos/v2/${data}`);
                    const bytes = JSON.stringify(response.data).length;
                    console.log(`[SYNC] ${data} (delta -${delta}) → status ${response.status} | bytes: ${bytes}`);

                    if (response.status !== 200) continue;

                    const arr = Array.isArray(response.data) ? response.data : (response.data ? [response.data] : []);
                    if (arr.length > 0) {
                        raw = arr;
                        dataUsada = data;
                        if (delta > 0) console.log(`[SYNC] Dados encontrados em ${data} (${delta} dia(s) atrás)`);
                        break;
                    }
                } catch (e) {
                    console.warn(`[SYNC] Erro ao tentar ${data}:`, e.message);
                }
            }

            if (!dataUsada) {
                console.warn('[SYNC] Nenhum dado encontrado nos últimos 45 dias. Abortando sync.');
                return {
                    status: 'sem_dados',
                    estabelecimentos: 0, turmas: 0, disciplinas: 0, classes: 0, alunos: 0,
                    executadoEm: agora,
                };
            }

            const estabs = raw;

            const estabelecimentosPayload = [];
            const turmasPayload = [];
            const disciplinasPayload = [];
            const classesPayload = [];
            const turmaParaClasse = {};

            estabs.forEach(estab => {
                estabelecimentosPayload.push({
                    cod_estabelecimento: estab.codEstabelecimento,
                    nome_estabelecimento: estab.nomeCompletoEstab,
                    cod_municipio: estab.municipio?.codMunicipio || null,
                    atualizado_em: agora,
                });

                (estab.periodoLetivos || []).forEach(periodo => {
                    (periodo.livros || []).forEach(livro => {
                        const classe = livro.classe;
                        if (!classe) return;

                        const turma = classe.turma || {};
                        const disc = classe.disciplina || {};

                        if (turma.codTurma) {
                            turmasPayload.push({
                                cod_turma: turma.codTurma,
                                descr_turma: turma.descrTurma || '',
                                cod_seriacao: turma.seriacao?.codSeriacao || null,
                                cod_estabelecimento: estab.codEstabelecimento,
                                periodo_letivo: periodo.descrPeriodoLetivo || null,
                                atualizado_em: agora,
                            });

                            if (!turmaParaClasse[turma.codTurma] && classe.codClasse) {
                                const firstPeriodo = (livro.calendarioAvaliacaos || [])[0];
                                turmaParaClasse[turma.codTurma] = {
                                    codClasse: classe.codClasse,
                                    descrTurma: turma.descrTurma || '',
                                    codPeriodoAvaliacao: firstPeriodo?.periodoAvaliacao?.codPeriodoAvaliacao || 9,
                                    codPeriodoLetivo: periodo.codPeriodoLetivo || 261,
                                };
                            }
                        }

                        if (disc.codDisciplina) {
                            disciplinasPayload.push({
                                cod_disciplina: disc.codDisciplina,
                                nome_disciplina: disc.nomeDisciplina || '',
                                sigla: (disc.siglaDisciplina || '').trim() || null,
                                cor_fundo: disc.corFundo || null,
                                cor_letra: disc.corLetra || null,
                                atualizado_em: agora,
                            });
                        }

                        if (classe.codClasse) {
                            classesPayload.push({
                                cod_classe: classe.codClasse,
                                cod_turma: turma.codTurma || null,
                                cod_disciplina: disc.codDisciplina || null,
                                cod_estabelecimento: estab.codEstabelecimento,
                                periodo_letivo: periodo.descrPeriodoLetivo || null,
                                atualizado_em: agora,
                            });
                        }
                    });
                });
            });

            const estabsUnicos = this.#dedup(estabelecimentosPayload, 'cod_estabelecimento');
            const turmasUnicas = this.#dedup(turmasPayload, 'cod_turma');
            const disciplinasUnicas = this.#dedup(disciplinasPayload, 'cod_disciplina');
            const classesUnicas = this.#dedup(classesPayload, 'cod_classe');

            const { error: e1 } = await this.#supabaseAdmin.from('rco_estabelecimentos').upsert(estabsUnicos, { onConflict: 'cod_estabelecimento' });
            if (e1) {
                if (e1.message?.includes('schema cache') || e1.code === 'PGRST204') {
                    throw new Error('TABELAS_NAO_CONFIGURADAS: Execute o SQL em backend/database/migrations/001_rco_tables.sql no Supabase Studio.');
                }
                throw new Error(`Erro em rco_estabelecimentos: ${e1.message}`);
            }

            const { error: e2 } = await this.#supabaseAdmin.from('rco_turmas').upsert(turmasUnicas, { onConflict: 'cod_turma' });
            if (e2) throw new Error(`Erro em rco_turmas: ${e2.message}`);

            const { error: e3 } = await this.#supabaseAdmin.from('rco_disciplinas').upsert(disciplinasUnicas, { onConflict: 'cod_disciplina' });
            if (e3) throw new Error(`Erro em rco_disciplinas: ${e3.message}`);

            const { error: e4 } = await this.#supabaseAdmin.from('rco_classes').upsert(classesUnicas, { onConflict: 'cod_classe' });
            if (e4) throw new Error(`Erro em rco_classes: ${e4.message}`);

            let totalAlunos = 0;
            for (const [codTurmaStr, info] of Object.entries(turmaParaClasse)) {
                const codTurma = parseInt(codTurmaStr);
                try {
                    let alunosResp = await this.#rcoApiService.get(
                        `/classe/v1/relatorios/avaliacaoAlunos?codClasse=${info.codClasse}&codPeriodoAvaliacao=${info.codPeriodoAvaliacao}`
                    );
                    let alunos = Array.isArray(alunosResp.data) ? alunosResp.data : [];

                    if (alunos.length === 0) {
                        alunosResp = await this.#rcoApiService.get(
                            `/classe/v3/relatorios/frequenciaAulas?codClasse=${info.codClasse}&codPeriodoAvaliacao=${info.codPeriodoAvaliacao}&codPeriodoLetivo=${info.codPeriodoLetivo}&page=1&perPage=200`
                        );
                        alunos = Array.isArray(alunosResp.data) ? alunosResp.data : [];
                    }

                    if (alunos.length === 0) continue;

                    const truncate = (str, max) => str ? String(str).substring(0, max) : null;
                    const alunosPayload = alunos.map(a => ({
                        registro:       truncate(String(a.codMatrizAluno), 50),
                        nome:           truncate(a.nome, 120),
                        turma:          truncate(info.descrTurma, 50),
                        codmatrizaluno: a.codMatrizAluno,
                        codturma:       codTurma,
                        numchamada:     a.numChamada,
                    }));

                    const { error: eA } = await this.#supabaseAdmin.from('alunos').upsert(alunosPayload, { onConflict: 'registro' });
                    if (eA) {
                        console.warn(`[SYNC] Aviso alunos turma ${codTurma}:`, eA.message);
                    } else {
                        totalAlunos += alunosPayload.length;
                        console.log(`[SYNC] ${alunosPayload.length} alunos sincronizados (turma ${codTurma})`);
                    }
                } catch (errAluno) {
                    console.warn(`[SYNC] Erro ao buscar alunos da turma ${codTurma}:`, errAluno.message);
                }
            }

            await this.#supabaseAdmin.from('rco_sync_log').insert({
                status: 'sucesso',
                estabelecimentos: estabsUnicos.length,
                turmas: turmasUnicas.length,
                disciplinas: disciplinasUnicas.length,
                classes: classesUnicas.length,
            });

            const duracaoS = ((Date.now() - t0) / 1000).toFixed(1);
            const resultado = {
                status: 'sucesso',
                estabelecimentos: estabsUnicos.length,
                turmas: turmasUnicas.length,
                disciplinas: disciplinasUnicas.length,
                classes: classesUnicas.length,
                alunos: totalAlunos,
                executadoEm: agora,
                duracaoS,
            };
            console.log(`[SYNC] Concluído em ${duracaoS}s:`, resultado);
            return resultado;

        } catch (erro) {
            console.error('[SYNC] Erro:', erro.message);
            try {
                await this.#supabaseAdmin.from('rco_sync_log').insert({ status: 'erro', mensagem: erro.message });
            } catch {}
            throw erro;
        }
    }
}

export const syncService = new SyncService();
