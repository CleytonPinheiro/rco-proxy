export class PresencaService {
    #supabaseAdmin = null;
    #rcoApiService = null;

    initialize(supabaseAdmin, rcoApiService) {
        this.#supabaseAdmin = supabaseAdmin;
        this.#rcoApiService = rcoApiService;
    }

    detectarPeriodo(descrTurma) {
        const d = (descrTurma || '').toLowerCase();
        if (d.includes('manh')) return 'manha';
        if (d.includes('tarde')) return 'tarde';
        if (d.includes('noite')) return 'noite';
        return 'manha';
    }

    async syncPresencaDiariaRCO(targetDate = null) {
        const { dataBrasilia } = await import('../config/dateUtils.js');
        const hoje = targetDate || dataBrasilia();
        console.log(`[PRESENÇA] Sincronizando presença de ${hoje} via RCO...`);

        try {
            const codPeriodoLetivo    = 261;
            const codPeriodoAvaliacao = 9;

            const { data: classes, error: errClasses } = await this.#supabaseAdmin
                .from('rco_classes').select('cod_classe, cod_turma').order('cod_classe', { ascending: true });

            if (errClasses || !classes?.length) {
                console.log('[PRESENÇA] Nenhuma classe encontrada no banco.');
                return { ok: false, motivo: 'Nenhuma classe no banco' };
            }

            const turmaClaMap = new Map();
            classes.forEach(c => { if (!turmaClaMap.has(c.cod_turma)) turmaClaMap.set(c.cod_turma, c.cod_classe); });

            const { data: turmasDB } = await this.#supabaseAdmin.from('rco_turmas').select('cod_turma, descr_turma');
            const descrMap = {};
            (turmasDB || []).forEach(t => { descrMap[t.cod_turma] = t.descr_turma; });

            const { data: alunosDB } = await this.#supabaseAdmin.from('alunos').select('codturma');
            const alunosCount = {};
            (alunosDB || []).forEach(a => { if (a.codturma) alunosCount[a.codturma] = (alunosCount[a.codturma] || 0) + 1; });

            const resultados = [];

            for (const [codTurma, codClasse] of turmaClaMap) {
                try {
                    const path = `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodoAvaliacao}&codPeriodoLetivo=${codPeriodoLetivo}&page=1&perPage=200`;
                    const response = await this.#rcoApiService.get(path);
                    if (response.status !== 200) continue;

                    const raw = Array.isArray(response.data) ? response.data : [];
                    if (!raw.length) continue;

                    const aulaSet = new Set();
                    raw.forEach(a => Object.keys(a).forEach(k => { if (/^\d+$/.test(k)) aulaSet.add(k); }));
                    const codAulas = [...aulaSet];

                    const aulaHoje = [];
                    await Promise.all(codAulas.map(async (cod) => {
                        try {
                            const r = await this.#rcoApiService.get(`/educador/grade/aula/v2/${cod}?codPeriodoLetivo=${codPeriodoLetivo}`);
                            const dataRaw = r?.data?.aula?.dataAula
                                         || r?.data?.dataAula
                                         || r?.data?.data
                                         || null;
                            if (dataRaw) {
                                // Comparar como string de data Brasil, sem converter para UTC
                                const d = String(dataRaw).split('T')[0];
                                if (d === hoje) aulaHoje.push(cod);
                            }
                        } catch (_) {}
                    }));
                    console.log(`[PRESENÇA] Turma ${codTurma}: ${codAulas.length} aulas analisadas → ${aulaHoje.length} aulas hoje (${hoje})`);

                    const descrTurma        = descrMap[codTurma] || '';
                    const periodo           = this.detectarPeriodo(descrTurma);
                    const total_matriculados = alunosCount[codTurma] || raw.length;

                    if (!aulaHoje.length) {
                        resultados.push({
                            data: hoje, periodo, cod_turma: codTurma, descr_turma: descrTurma,
                            total_matriculados, total_presentes: null, total_ausentes: null,
                            fonte: 'rco', confirmado: false, atualizado_em: new Date().toISOString(),
                        });
                        continue;
                    }

                    let totalPresentes = 0;
                    let totalAusentes  = 0;
                    raw.forEach(a => {
                        const temAula  = aulaHoje.some(cod => a[cod] !== undefined && a[cod] !== null);
                        if (!temAula) return;
                        const presente = aulaHoje.some(cod => a[cod] === 'C');
                        if (presente) totalPresentes++;
                        else totalAusentes++;
                    });

                    resultados.push({
                        data: hoje, periodo, cod_turma: codTurma, descr_turma: descrTurma,
                        total_matriculados, total_presentes: totalPresentes, total_ausentes: totalAusentes,
                        fonte: 'rco', confirmado: false, atualizado_em: new Date().toISOString(),
                    });

                } catch (e) {
                    console.error(`[PRESENÇA] Erro turma ${codTurma}:`, e.message);
                }
            }

            if (resultados.length) {
                await this.#supabaseAdmin.from('presenca_diaria').upsert(resultados, { onConflict: 'data,cod_turma' });
            }

            console.log(`[PRESENÇA] Sync concluído: ${resultados.length} turmas processadas.`);
            return { ok: true, turmas: resultados.length, data: hoje };

        } catch (e) {
            console.error('[PRESENÇA] Erro geral no sync:', e.message);
            return { ok: false, motivo: e.message };
        }
    }

    agendarSyncPresenca() {
        // Horários em BRT (horário de Brasília) — o servidor roda em UTC
        const horariosBRT = [
            { hora: 9,  minuto: 0  },   // 09:00 BRT = 12:00 UTC
            { hora: 13, minuto: 30 },   // 13:30 BRT = 16:30 UTC
            { hora: 20, minuto: 0  },   // 20:00 BRT = 23:00 UTC
        ];
        setInterval(async () => {
            const { agoraBrasilia } = await import('../config/dateUtils.js');
            const brt = agoraBrasilia();
            const h = brt.getHours();
            const m = brt.getMinutes();
            if (horariosBRT.some(t => t.hora === h && t.minuto === m)) {
                console.log(`[PRESENÇA] Sync agendado ativado às ${h}:${String(m).padStart(2,'0')} BRT`);
                this.syncPresencaDiariaRCO().catch(console.error);
            }
        }, 60 * 1000);
    }
}

export const presencaService = new PresencaService();
