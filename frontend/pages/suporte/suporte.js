(function () {
    'use strict';

    const API_BASE = '/api';
    function api(path, opts) {
        return fetch(API_BASE + path, { credentials: 'include', ...opts });
    }

    const TIPO_LABEL = {
        extensao: '📅 Extensão',
        duvida: '❓ Dúvida',
        bug: '🐛 Bug',
        sugestao: '💡 Sugestão',
        outro: '📌 Outro',
    };
    const STATUS_LABEL = { pendente: 'Pendente', resolvido: 'Resolvido', negado: 'Negado' };

    const PLANO_LABEL = {
        trial: '⏳ Trial',
        basico: '📘 Básico',
        completo: '🚀 Completo',
        'classroom-individual': '👨‍🏫 Individual',
    };

    const ACAO_LABEL = {
        PLANO_ATIVADO: 'Plano ativado',
        PLANO_ALTERADO: 'Plano alterado',
        PLANO_ESTENDIDO: 'Plano estendido',
        PLANO_REMOVIDO: 'Plano removido',
        EXTENSAO_APROVADA: 'Extensão aprovada',
    };

    function fmtData(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function fmtDataHora(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    async function carregarPlano() {
        const el = document.getElementById('planoStatus');
        const histEl = document.getElementById('planoHistorico');
        try {
            const res = await api('/suporte/meu-plano');
            if (!res.ok) throw new Error('Falha ao carregar plano');
            const d = await res.json();

            let badgeClass = 'sp-plano-badge--sem';
            let label = 'Sem plano';
            if (d.expirado) {
                badgeClass = 'sp-plano-badge--expirado';
                label = (PLANO_LABEL[d.plano] || d.plano) + ' (Expirado)';
            } else if (d.plano) {
                label = PLANO_LABEL[d.plano] || d.plano;
                if (d.plano === 'trial') badgeClass = 'sp-plano-badge--trial';
                else if (d.plano === 'basico') badgeClass = 'sp-plano-badge--basico';
                else badgeClass = 'sp-plano-badge--completo';
            }

            let html = `<span class="sp-plano-badge ${badgeClass}">${label}</span>`;
            if (d.fonte) html += `<span style="font-size:.78rem;color:var(--text-secondary)">via ${d.fonte === 'usuario' ? 'plano individual' : 'plano da escola'}</span>`;

            if (d.plano === 'trial' && d.diasRestantes !== null && !d.expirado) {
                html += `<div class="sp-plano-info-row"><strong>${d.diasRestantes}</strong> dia(s) restante(s)</div>`;
            }
            if (d.plano_inicio) {
                html += `<div class="sp-plano-info-row">Início: <strong>${fmtData(d.plano_inicio)}</strong></div>`;
            }
            if (d.plano_renovacao) {
                html += `<div class="sp-plano-info-row">Renovação: <strong>${fmtData(d.plano_renovacao)}</strong></div>`;
            }

            if (d.funcionalidades && d.funcionalidades.length) {
                html += `<div style="margin-top:10px;font-size:.8rem;color:var(--text-secondary)"><strong>Funcionalidades inclusas:</strong></div>`;
                html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">`;
                const funcLabels = {
                    'classroom-leitura': '📖 Leitura',
                    'classroom-escrita': '✏️ Escrita/Notas',
                    'classroom-rco': '🚀 Lançar no RCO',
                    'classroom-analytics': '📊 Analytics',
                };
                d.funcionalidades.forEach(f => {
                    html += `<span style="font-size:.74rem;padding:2px 8px;border-radius:12px;background:var(--bg-hover);color:var(--text-primary)">${funcLabels[f] || f}</span>`;
                });
                html += `</div>`;
            }

            el.innerHTML = html;

            if (d.historico && d.historico.length) {
                let histHtml = `<div style="font-size:.82rem;font-weight:600;margin-bottom:8px;color:var(--text-secondary)">Histórico de alterações</div>`;
                d.historico.forEach(h => {
                    const acaoKey = h.acao || '';
                    let dotClass = 'sp-historico-dot--alterado';
                    if (acaoKey.includes('ATIVADO')) dotClass = 'sp-historico-dot--ativado';
                    else if (acaoKey.includes('ESTENDIDO') || acaoKey.includes('EXTENSAO')) dotClass = 'sp-historico-dot--estendido';
                    else if (acaoKey.includes('REMOVIDO')) dotClass = 'sp-historico-dot--removido';

                    histHtml += `<div class="sp-historico-item">
                        <span class="sp-historico-dot ${dotClass}"></span>
                        <div style="flex:1">
                            <div>${ACAO_LABEL[acaoKey] || acaoKey}</div>
                            ${h.plano_novo ? `<div style="font-size:.75rem;color:var(--text-secondary)">${h.plano_anterior || 'nenhum'} → ${h.plano_novo}</div>` : ''}
                            ${h.admin_nome ? `<div style="font-size:.75rem;color:var(--text-secondary)">por ${h.admin_nome}</div>` : ''}
                            ${h.obs ? `<div style="font-size:.75rem;color:var(--text-secondary);font-style:italic">${h.obs}</div>` : ''}
                        </div>
                        <span class="sp-historico-data">${fmtDataHora(h.criado_em)}</span>
                    </div>`;
                });
                histEl.innerHTML = histHtml;
            } else {
                histEl.innerHTML = `<div style="font-size:.8rem;color:var(--text-secondary);margin-top:8px">Nenhum histórico registrado.</div>`;
            }
        } catch (err) {
            el.innerHTML = `<span style="color:#dc2626">Erro ao carregar plano: ${err.message}</span>`;
        }
    }

    async function carregarTickets() {
        const el = document.getElementById('listaTickets');
        try {
            const res = await api('/suporte/meus-tickets');
            if (!res.ok) throw new Error('Falha');
            const tickets = await res.json();
            if (!tickets.length) {
                el.innerHTML = `<div class="sp-vazio">Nenhuma solicitação enviada ainda.</div>`;
                return;
            }
            el.innerHTML = tickets.map(t => `
                <div class="sp-ticket">
                    <div class="sp-ticket-header">
                        <span class="sp-ticket-tipo sp-ticket-tipo--${t.tipo}">${TIPO_LABEL[t.tipo] || t.tipo}</span>
                        <span class="sp-ticket-status sp-ticket-status--${t.status}">${STATUS_LABEL[t.status] || t.status}</span>
                    </div>
                    <div class="sp-ticket-assunto">${t.assunto}</div>
                    <div class="sp-ticket-msg">${t.mensagem}</div>
                    <div class="sp-ticket-data">${fmtDataHora(t.criado_em)}</div>
                    ${t.resposta ? `<div class="sp-ticket-resposta"><strong>Resposta do administrador (${fmtDataHora(t.respondido_em)})</strong>${t.resposta}</div>` : ''}
                </div>
            `).join('');
        } catch (err) {
            el.innerHTML = `<span style="color:#dc2626">Erro: ${err.message}</span>`;
        }
    }

    document.getElementById('ticketTipo').addEventListener('change', function () {
        const assunto = document.getElementById('ticketAssunto');
        if (this.value === 'extensao' && !assunto.value) {
            assunto.value = 'Solicitar extensão de plano trial';
        }
    });

    document.getElementById('formTicket').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tipo = document.getElementById('ticketTipo').value;
        const assunto = document.getElementById('ticketAssunto').value.trim();
        const mensagem = document.getElementById('ticketMensagem').value.trim();
        const msg = document.getElementById('formTicketMsg');
        const btn = document.getElementById('btnEnviarTicket');

        if (!tipo || !assunto || !mensagem) {
            msg.className = 'sp-msg sp-msg--erro';
            msg.textContent = 'Preencha todos os campos.';
            msg.style.display = 'block';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Enviando...';

        try {
            const res = await api('/suporte/ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo, assunto, mensagem }),
            });
            const data = await res.json();
            if (!res.ok) {
                msg.className = 'sp-msg sp-msg--erro';
                msg.textContent = data.erro || 'Erro ao enviar.';
                msg.style.display = 'block';
            } else {
                msg.className = 'sp-msg sp-msg--ok';
                msg.textContent = 'Solicitação enviada com sucesso!';
                msg.style.display = 'block';
                document.getElementById('formTicket').reset();
                carregarTickets();
            }
        } catch (err) {
            msg.className = 'sp-msg sp-msg--erro';
            msg.textContent = 'Erro de conexão: ' + err.message;
            msg.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Enviar solicitação';
        }
    });

    carregarPlano();
    carregarTickets();
})();
