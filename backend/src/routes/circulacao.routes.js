import { Router } from 'express';

export function createCirculacaoRouter({ supabase, supabaseAdmin }) {
    const router = Router();

    // ── Ambientes ─────────────────────────────────────────────────────────────

    router.get('/circulacao/ambientes', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('ambientes')
                .select('*')
                .order('nome');
            if (error) {
                console.warn('[CIRCULACAO] Tabela ambientes não disponível:', error.message);
                return res.json([]);
            }
            res.json(data || []);
        } catch (e) {
            console.warn('[CIRCULACAO] Erro ao buscar ambientes:', e.message);
            res.json([]);
        }
    });

    router.post('/circulacao/ambientes', async (req, res) => {
        const { nome, tipo = 'banheiro', capacidade_max = 2 } = req.body;
        if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' });
        try {
            const { data, error } = await supabaseAdmin
                .from('ambientes')
                .insert({ nome: nome.trim(), tipo, capacidade_max })
                .select()
                .single();
            if (error) return res.status(500).json({ erro: error.message });
            res.json(data);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.put('/circulacao/ambientes/:id', async (req, res) => {
        const { nome, tipo, capacidade_max, ativo } = req.body;
        const campos = {};
        if (nome !== undefined)          campos.nome           = nome.trim();
        if (tipo !== undefined)          campos.tipo           = tipo;
        if (capacidade_max !== undefined) campos.capacidade_max = capacidade_max;
        if (ativo !== undefined)         campos.ativo          = ativo;
        try {
            const { data, error } = await supabaseAdmin
                .from('ambientes')
                .update(campos)
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) return res.status(500).json({ erro: error.message });
            res.json(data);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.delete('/circulacao/ambientes/:id', async (req, res) => {
        try {
            const { error } = await supabaseAdmin
                .from('ambientes')
                .update({ ativo: false })
                .eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Scan (entrada/saída inteligente) ─────────────────────────────────────

    router.post('/circulacao/scan', async (req, res) => {
        const { cod_matriz_aluno, ambiente_id } = req.body;
        if (!cod_matriz_aluno) return res.status(400).json({ erro: 'cod_matriz_aluno é obrigatório' });
        if (!ambiente_id)      return res.status(400).json({ erro: 'ambiente_id é obrigatório' });

        try {
            const codAluno = parseInt(cod_matriz_aluno);
            const ambId    = parseInt(ambiente_id);
            const agora    = new Date().toISOString();

            // Verificar se há registro em aberto (sem saída) neste ambiente
            const { data: aberto } = await supabaseAdmin
                .from('registros_circulacao')
                .select('id, entrada_em')
                .eq('cod_matriz_aluno', codAluno)
                .eq('ambiente_id', ambId)
                .is('saida_em', null)
                .order('entrada_em', { ascending: false })
                .limit(1)
                .single();

            if (aberto) {
                // Registrar saída
                const { data: atualizado, error } = await supabaseAdmin
                    .from('registros_circulacao')
                    .update({ saida_em: agora })
                    .eq('id', aberto.id)
                    .select()
                    .single();
                if (error) return res.status(500).json({ erro: error.message });

                const durMin = Math.round(
                    (new Date(agora) - new Date(aberto.entrada_em)) / 60000
                );
                return res.json({ acao: 'saida', registro: atualizado, duracao_min: durMin });
            }

            // Registrar entrada
            const { data: novo, error } = await supabaseAdmin
                .from('registros_circulacao')
                .insert({ cod_matriz_aluno: codAluno, ambiente_id: ambId, entrada_em: agora })
                .select()
                .single();
            if (error) return res.status(500).json({ erro: error.message });

            return res.json({ acao: 'entrada', registro: novo });

        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Saída manual por id do registro ───────────────────────────────────────

    router.post('/circulacao/saida/:id', async (req, res) => {
        try {
            const agora = new Date().toISOString();
            const { data: reg } = await supabaseAdmin
                .from('registros_circulacao')
                .select('entrada_em')
                .eq('id', req.params.id)
                .single();

            const { data, error } = await supabaseAdmin
                .from('registros_circulacao')
                .update({ saida_em: agora })
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) return res.status(500).json({ erro: error.message });

            const durMin = reg ? Math.round(
                (new Date(agora) - new Date(reg.entrada_em)) / 60000
            ) : null;
            res.json({ ok: true, registro: data, duracao_min: durMin });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Ativos (dentro agora) ─────────────────────────────────────────────────

    router.get('/circulacao/ativos', async (req, res) => {
        const { ambiente_id } = req.query;
        try {
            let query = supabaseAdmin
                .from('registros_circulacao')
                .select('id, cod_matriz_aluno, ambiente_id, entrada_em, saida_em')
                .is('saida_em', null)
                .order('entrada_em', { ascending: true });
            if (ambiente_id) query = query.eq('ambiente_id', parseInt(ambiente_id));

            const { data, error } = await query;
            if (error) {
                if (error.code === '42P01') return res.json([]);
                return res.status(500).json({ erro: error.message });
            }
            res.json(await enriquecerRegistros(data || []));
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Histórico do dia ──────────────────────────────────────────────────────

    router.get('/circulacao/historico', async (req, res) => {
        const { data: dataParam, ambiente_id } = req.query;
        const dia = dataParam || new Date().toISOString().split('T')[0];
        try {
            let query = supabaseAdmin
                .from('registros_circulacao')
                .select('id, cod_matriz_aluno, ambiente_id, entrada_em, saida_em')
                .gte('entrada_em', `${dia}T00:00:00`)
                .lte('entrada_em', `${dia}T23:59:59`)
                .order('entrada_em', { ascending: false });
            if (ambiente_id) query = query.eq('ambiente_id', parseInt(ambiente_id));

            const { data, error } = await query;
            if (error) {
                if (error.code === '42P01') return res.json([]);
                return res.status(500).json({ erro: error.message });
            }
            res.json(await enriquecerRegistros(data || []));
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Quiosque: scan enriquecido (retorna nome do aluno + ambiente) ────────

    router.post('/circulacao/quiosque/scan', async (req, res) => {
        const { qr_raw, ambiente_id } = req.body;
        if (!qr_raw)      return res.status(400).json({ erro: 'qr_raw é obrigatório' });
        if (!ambiente_id) return res.status(400).json({ erro: 'ambiente_id é obrigatório' });

        // Extrai o código numérico do QR (suporta apenas número ou "ID:12345" etc.)
        const match = String(qr_raw).match(/(\d{4,})/);
        if (!match) return res.status(400).json({ erro: 'QR inválido — código numérico não encontrado' });
        const codAluno = parseInt(match[1]);

        try {
            // Dados do aluno
            const { data: aluno } = await supabaseAdmin
                .from('alunos')
                .select('nome, numchamada, codturma, turma')
                .eq('codmatrizaluno', codAluno)
                .single();

            // Dados do ambiente
            const { data: ambiente, error: errAmb } = await supabaseAdmin
                .from('ambientes')
                .select('*')
                .eq('id', parseInt(ambiente_id))
                .single();
            if (errAmb || !ambiente) return res.status(404).json({ erro: 'Ambiente não encontrado' });

            const agora = new Date().toISOString();

            // Registro em aberto neste ambiente?
            const { data: aberto } = await supabaseAdmin
                .from('registros_circulacao')
                .select('id, entrada_em')
                .eq('cod_matriz_aluno', codAluno)
                .eq('ambiente_id', parseInt(ambiente_id))
                .is('saida_em', null)
                .order('entrada_em', { ascending: false })
                .limit(1)
                .single();

            if (aberto) {
                const { data: reg, error } = await supabaseAdmin
                    .from('registros_circulacao')
                    .update({ saida_em: agora })
                    .eq('id', aberto.id)
                    .select()
                    .single();
                if (error) return res.status(500).json({ erro: error.message });
                const durMin = Math.round(
                    (new Date(agora) - new Date(aberto.entrada_em)) / 60000
                );
                return res.json({ acao: 'saida', aluno, ambiente, registro: reg, duracao_min: durMin });
            }

            // Registra entrada
            const { data: reg, error } = await supabaseAdmin
                .from('registros_circulacao')
                .insert({ cod_matriz_aluno: codAluno, ambiente_id: parseInt(ambiente_id), entrada_em: agora })
                .select()
                .single();
            if (error) return res.status(500).json({ erro: error.message });

            return res.json({ acao: 'entrada', aluno, ambiente, registro: reg });

        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Helpers internos do quiosque ─────────────────────────────────────────

    async function enriquecerRegistros(registros) {
        if (!registros?.length) return [];

        // Busca ambientes (mapa rápido)
        const { data: ambArr } = await supabaseAdmin.from('ambientes').select('id, nome, tipo');
        const ambMap = Object.fromEntries((ambArr || []).map(a => [a.id, a]));

        // Busca nomes dos alunos por codmatrizaluno
        const codigos = [...new Set(registros.map(r => r.cod_matriz_aluno).filter(Boolean))];
        const { data: aluArr } = codigos.length
            ? await supabaseAdmin.from('alunos').select('codmatrizaluno, nome, numchamada, turma').in('codmatrizaluno', codigos)
            : { data: [] };
        const aluMap = Object.fromEntries((aluArr || []).map(a => [a.codmatrizaluno, a]));

        return registros.map(r => ({
            ...r,
            alunos:    aluMap[r.cod_matriz_aluno] || null,
            ambientes: ambMap[r.ambiente_id]       || null,
        }));
    }

    // ── Quiosque: listar ativos com nome do aluno ─────────────────────────────

    router.get('/circulacao/quiosque/ativos', async (req, res) => {
        try {
            const { data, error } = await supabaseAdmin
                .from('registros_circulacao')
                .select('id, cod_matriz_aluno, ambiente_id, entrada_em')
                .is('saida_em', null)
                .order('entrada_em', { ascending: true });

            if (error) return res.json([]);
            res.json(await enriquecerRegistros(data || []));
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Quiosque: histórico recente (últimos 30 eventos do dia) ──────────────

    router.get('/circulacao/quiosque/historico', async (req, res) => {
        const dia = new Date().toISOString().split('T')[0];
        try {
            const { data, error } = await supabaseAdmin
                .from('registros_circulacao')
                .select('id, cod_matriz_aluno, ambiente_id, entrada_em, saida_em')
                .gte('entrada_em', `${dia}T00:00:00`)
                .order('entrada_em', { ascending: false })
                .limit(30);

            if (error) return res.json([]);
            res.json(await enriquecerRegistros(data || []));
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Histórico por aluno ───────────────────────────────────────────────────

    router.get('/circulacao/aluno/:cod', async (req, res) => {
        try {
            const { data, error } = await supabaseAdmin
                .from('registros_circulacao')
                .select('*')
                .eq('cod_matriz_aluno', parseInt(req.params.cod))
                .order('entrada_em', { ascending: false })
                .limit(50);
            if (error) {
                if (error.code === '42P01') return res.json([]);
                return res.status(500).json({ erro: error.message });
            }
            res.json(data || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
