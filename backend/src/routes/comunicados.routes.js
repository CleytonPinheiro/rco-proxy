import { Router } from 'express';
import { dataBrasilia } from '../config/dateUtils.js';

export function createComunicadosRouter({ supabase, supabaseAdmin }) {
    const router = Router();

    // ── Helpers ───────────────────────────────────────────────────────────────

    async function getConfig(chave) {
        try {
            const { data } = await supabaseAdmin.from('configuracoes').select('valor').eq('chave', chave).single();
            return data?.valor || null;
        } catch { return null; }
    }

    async function setConfig(chave, valor) {
        await supabaseAdmin.from('configuracoes').upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
    }

    // ── Configurações ─────────────────────────────────────────────────────────

    router.get('/comunicados/config', async (req, res) => {
        try {
            const { data, error } = await supabaseAdmin.from('configuracoes').select('*');
            if (error) { if (error.code === '42P01') return res.json({}); throw error; }
            const cfg = {};
            (data || []).forEach(r => { cfg[r.chave] = r.valor; });
            res.json(cfg);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.put('/comunicados/config', async (req, res) => {
        const { n8n_webhook_url, comunicados_token, msg_template } = req.body;
        try {
            if (n8n_webhook_url  !== undefined) await setConfig('n8n_webhook_url', n8n_webhook_url);
            if (comunicados_token !== undefined) await setConfig('comunicados_token', comunicados_token);
            if (msg_template      !== undefined) await setConfig('msg_template', msg_template);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Contatos dos responsáveis ─────────────────────────────────────────────

    router.get('/responsaveis/:cod', async (req, res) => {
        try {
            const { data } = await supabaseAdmin
                .from('responsaveis_contato')
                .select('*')
                .eq('cod_matriz_aluno', parseInt(req.params.cod))
                .single();
            res.json(data || null);
        } catch (e) { res.json(null); }
    });

    router.put('/responsaveis/:cod', async (req, res) => {
        const { nome_responsavel, telefone, email } = req.body;
        const cod = parseInt(req.params.cod);
        try {
            const { data, error } = await supabaseAdmin.from('responsaveis_contato').upsert({
                cod_matriz_aluno: cod,
                nome_responsavel: nome_responsavel || null,
                telefone: (telefone || '').replace(/\D/g, '') || null,
                email: email || null,
                atualizado_em: new Date().toISOString()
            }, { onConflict: 'cod_matriz_aluno' }).select().single();
            if (error) return res.status(500).json({ erro: error.message });
            res.json(data);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Comunicados — listagem ─────────────────────────────────────────────────

    router.get('/comunicados', async (req, res) => {
        const { status, cod_turma, data_inicio, data_fim, busca, limit = 200 } = req.query;
        try {
            let query = supabaseAdmin
                .from('comunicados_falta')
                .select('*')
                .order('data_falta', { ascending: false })
                .order('nome_aluno', { ascending: true })
                .limit(parseInt(limit));

            if (status)     query = query.eq('status', status);
            if (cod_turma)  query = query.eq('cod_turma', parseInt(cod_turma));
            if (data_inicio) query = query.gte('data_falta', data_inicio);
            if (data_fim)    query = query.lte('data_falta', data_fim);
            if (busca)       query = query.ilike('nome_aluno', `%${busca}%`);

            const { data, error } = await query;
            if (error) { if (error.code === '42P01') return res.json([]); throw error; }
            res.json(data || []);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Estatísticas ──────────────────────────────────────────────────────────

    router.get('/comunicados/stats', async (req, res) => {
        try {
            const { data, error } = await supabaseAdmin.from('comunicados_falta').select('status');
            if (error) { if (error.code === '42P01') return res.json({ total:0, pendente:0, enviado:0, respondido:0, justificado:0, sem_resposta:0 }); throw error; }
            const stats = { total: 0, pendente: 0, enviado: 0, respondido: 0, justificado: 0, sem_resposta: 0, cancelado: 0 };
            (data || []).forEach(r => {
                stats.total++;
                if (stats[r.status] !== undefined) stats[r.status]++;
            });
            res.json(stats);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Gerar comunicados a partir de lista de faltas ─────────────────────────

    router.post('/comunicados/gerar', async (req, res) => {
        const { faltas } = req.body;
        // faltas: [{ cod_matriz_aluno, nome_aluno, num_chamada, cod_turma, descr_turma, data_falta }]
        if (!Array.isArray(faltas) || !faltas.length) {
            return res.status(400).json({ erro: 'Lista de faltas obrigatória' });
        }
        try {
            // Busca contatos existentes
            const cods = [...new Set(faltas.map(f => f.cod_matriz_aluno))];
            const { data: contatos } = await supabaseAdmin
                .from('responsaveis_contato')
                .select('*')
                .in('cod_matriz_aluno', cods);
            const contatoMap = {};
            (contatos || []).forEach(c => { contatoMap[c.cod_matriz_aluno] = c; });

            const registros = faltas.map(f => ({
                cod_matriz_aluno: f.cod_matriz_aluno,
                nome_aluno:       f.nome_aluno,
                num_chamada:      f.num_chamada || null,
                cod_turma:        f.cod_turma   || null,
                descr_turma:      f.descr_turma || null,
                data_falta:       f.data_falta,
                telefone:         contatoMap[f.cod_matriz_aluno]?.telefone || null,
                nome_responsavel: contatoMap[f.cod_matriz_aluno]?.nome_responsavel || null,
                status:           'pendente',
            }));

            const { data, error } = await supabaseAdmin
                .from('comunicados_falta')
                .upsert(registros, { onConflict: 'cod_matriz_aluno,data_falta', ignoreDuplicates: true })
                .select();
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true, criados: (data || []).length });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Enviar via N8n ────────────────────────────────────────────────────────

    router.post('/comunicados/enviar', async (req, res) => {
        const { ids } = req.body; // array de IDs de comunicados_falta
        if (!Array.isArray(ids) || !ids.length) {
            return res.status(400).json({ erro: 'ids é obrigatório' });
        }
        try {
            const webhookUrl = await getConfig('n8n_webhook_url');
            const token      = await getConfig('comunicados_token');
            const template   = await getConfig('msg_template') ||
                'Olá {responsavel}! Seu filho(a) {aluno} faltou às aulas em {data}. Qual foi o motivo? Responda: 1-Doença  2-Consulta médica  3-Viagem  4-Outro';

            const { data: comunicados, error } = await supabaseAdmin
                .from('comunicados_falta')
                .select('*')
                .in('id', ids);
            if (error) throw error;

            const agora    = new Date().toISOString();
            const baseUrl  = process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : 'http://localhost:5000';

            const resultados = [];
            for (const com of comunicados) {
                if (!com.telefone) {
                    resultados.push({ id: com.id, ok: false, erro: 'Sem telefone cadastrado' });
                    continue;
                }

                const dataFormatada = new Date(com.data_falta + 'T12:00:00').toLocaleDateString('pt-BR');
                const mensagem = template
                    .replace('{responsavel}', com.nome_responsavel || 'Responsável')
                    .replace('{aluno}',       com.nome_aluno)
                    .replace('{data}',        dataFormatada)
                    .replace('{turma}',       com.descr_turma || '');

                if (webhookUrl) {
                    try {
                        await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id:               com.id,
                                aluno:            com.nome_aluno,
                                turma:            com.descr_turma,
                                data_falta:       com.data_falta,
                                data_formatada:   dataFormatada,
                                responsavel:      com.nome_responsavel,
                                telefone:         com.telefone,
                                mensagem,
                                token,
                                webhook_resposta: `${baseUrl}/api/comunicados/resposta`,
                            })
                        });
                        resultados.push({ id: com.id, ok: true });
                    } catch (err) {
                        resultados.push({ id: com.id, ok: false, erro: 'Erro ao chamar N8n: ' + err.message });
                        continue;
                    }
                } else {
                    // Modo sem N8n: marca como enviado manualmente (para testes)
                    console.log(`[COMUNICADOS] N8n não configurado. Mensagem para ${com.telefone}: ${mensagem}`);
                    resultados.push({ id: com.id, ok: true, simulado: true });
                }

                // Atualiza status
                await supabaseAdmin.from('comunicados_falta')
                    .update({ status: 'enviado', enviado_em: agora })
                    .eq('id', com.id);
            }

            res.json({ ok: true, resultados, sem_n8n: !webhookUrl });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Callback do N8n (resposta do responsável) ──────────────────────────────

    router.post('/comunicados/resposta', async (req, res) => {
        const { id, cod_matriz_aluno, data_falta, resposta_texto, tipo_justificativa, token } = req.body;
        try {
            // Verificação de token (se configurado)
            const tokenSalvo = await getConfig('comunicados_token');
            if (tokenSalvo && token !== tokenSalvo) {
                return res.status(401).json({ erro: 'Token inválido' });
            }

            let query = supabaseAdmin.from('comunicados_falta');
            if (id) {
                query = query.eq('id', parseInt(id));
            } else if (cod_matriz_aluno && data_falta) {
                query = query.eq('cod_matriz_aluno', parseInt(cod_matriz_aluno)).eq('data_falta', data_falta);
            } else {
                return res.status(400).json({ erro: 'Informe id ou cod_matriz_aluno+data_falta' });
            }

            const { error } = await query.update({
                resposta_texto:    resposta_texto || '',
                resposta_em:       new Date().toISOString(),
                tipo_justificativa: tipo_justificativa || null,
                status:            'respondido',
            });
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Atualizar status manualmente ──────────────────────────────────────────

    router.put('/comunicados/:id/status', async (req, res) => {
        const { status } = req.body;
        const validos = ['pendente', 'enviado', 'respondido', 'justificado', 'sem_resposta', 'cancelado'];
        if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });
        try {
            const campos = { status };
            if (status === 'enviado'   && !req.body.manter_data) campos.enviado_em = new Date().toISOString();
            const { error } = await supabaseAdmin.from('comunicados_falta').update(campos).eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Validar justificativa (professor aceita ou rejeita) ───────────────────

    router.put('/comunicados/:id/validar', async (req, res) => {
        const { justificativa_valida, tipo_justificativa, obs } = req.body;
        try {
            const { error } = await supabaseAdmin.from('comunicados_falta').update({
                justificativa_valida: justificativa_valida === true,
                tipo_justificativa:   tipo_justificativa || null,
                obs:                  obs || null,
                validado_em:          new Date().toISOString(),
                status:               justificativa_valida ? 'justificado' : 'sem_resposta',
            }).eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Atualizar contato de um comunicado específico ─────────────────────────

    router.put('/comunicados/:id/contato', async (req, res) => {
        const { telefone, nome_responsavel } = req.body;
        try {
            const { error } = await supabaseAdmin.from('comunicados_falta')
                .update({
                    telefone: (telefone || '').replace(/\D/g, '') || null,
                    nome_responsavel: nome_responsavel || null
                }).eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    // ── Excluir comunicado ────────────────────────────────────────────────────

    router.delete('/comunicados/:id', async (req, res) => {
        try {
            const { error } = await supabaseAdmin.from('comunicados_falta').delete().eq('id', req.params.id);
            if (error) return res.status(500).json({ erro: error.message });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}
