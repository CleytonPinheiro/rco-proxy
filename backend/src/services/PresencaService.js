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
        const hoje = targetDate || new Date().toISOString().split('T')[0];
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
                            const dataRaw = r?.data?.aula?.dataAula || r?.data?.dataAula || null;
                            if (dataRaw) {
                                const d = new Date(dataRaw).toISOString().split('T')[0];
                                if (d === hoje) aulaHoje.push(cod);
                            }
                        } catch (_) {}
                    }));

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
        const horarios = [
            { hora: 9,  minuto: 0 },
            { hora: 13, minuto: 30 },
            { hora: 20, minuto: 0 },
        ];
        setInterval(() => {
            const agora = new Date();
            const h = agora.getHours();
            const m = agora.getMinutes();
            if (horarios.some(t => t.hora === h && t.minuto === m)) {
                this.syncPresencaDiariaRCO().catch(console.error);
            }
        }, 60 * 1000);
    }
}

export const presencaService = new PresencaService();
