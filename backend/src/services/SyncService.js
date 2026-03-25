export class SyncService {
    #supabaseAdmin = null;
    #rcoApiService = null;

    initialize(supabaseAdmin, rcoApiService) {
        this.#supabaseAdmin = supabaseAdmin;
        this.#rcoApiService = rcoApiService;
    }

    #dedup(arr, key) {
        return [...new Map(arr.map(x => [x[key], x])).values()];
    }

    async sincronizarComSupabase() {
        const agora = new Date().toISOString();
        console.log(`[SYNC] Iniciando sincronização com Supabase em ${agora}...`);

        try {
            const { dataBrasilia } = await import('../config/dateUtils.js');
            const hoje = dataBrasilia();
            const response = await this.#rcoApiService.get(`/educador/estabelecimentos/v2/${hoje}`);

            if (response.status !== 200) {
                throw new Error(`API RCO retornou status ${response.status}`);
            }

            const raw = response.data;
            const estabs = Array.isArray(raw) ? raw : (raw ? [raw] : []);

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

                    const alunosPayload = alunos.map(a => ({
                        registro:       String(a.codMatrizAluno),
                        nome:           a.nome,
                        turma:          info.descrTurma,
                        status:         'Ativo',
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

            const resultado = {
                status: 'sucesso',
                estabelecimentos: estabsUnicos.length,
                turmas: turmasUnicas.length,
                disciplinas: disciplinasUnicas.length,
                classes: classesUnicas.length,
                alunos: totalAlunos,
                executadoEm: agora,
            };
            console.log('[SYNC] Concluído:', resultado);
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
