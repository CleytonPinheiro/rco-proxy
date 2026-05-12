/* ── EduSync — Passeios e Eventos Externos ───────────────────────── */
'use strict';

const API = '/api';

let eventos          = [];
let eventoAtual      = null;       // { ...evento, inscricoes, onibus }
let filtroAtual      = 'todos';
let editandoEvento   = null;       // id se editando, null se novo
let editandoInscId   = null;
let turmasList       = [];
let painelTimer      = null;

/* ─────────────────────────────────────────────────────────────────── */
/*  Init                                                               */
/* ─────────────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
    carregarEventos();
    carregarTurmas();
});

/* ─────────────────────────────────────────────────────────────────── */
/*  Lista de eventos                                                   */
/* ─────────────────────────────────────────────────────────────────── */
async function carregarEventos() {
    try {
        const r  = await fetch(`${API}/passeios`);
        eventos  = await r.json();
        renderizarEventos();
    } catch (e) {
        document.getElementById('listaEventos').innerHTML =
            `<div class="ps-empty">Erro ao carregar eventos: ${esc(e.message)}</div>`;
    }
}

function renderizarEventos() {
    const el = document.getElementById('listaEventos');
    if (!eventos.length) {
        el.innerHTML = `<div class="ps-empty">
            <div style="font-size:48px;margin-bottom:12px">🚌</div>
            <div style="font-size:16px;font-weight:700;margin-bottom:6px">Nenhum evento criado ainda</div>
            <div style="font-size:14px;color:var(--text-secondary)">Clique em "+ Novo Evento" para começar</div>
        </div>`;
        return;
    }

    el.innerHTML = eventos.map(ev => {
        const data      = fmtData(ev.data_evento);
        const total     = parseInt(ev.total_inscritos) || 0;
        const pagos     = parseInt(ev.total_pagos)     || 0;
        const pendentes = total - pagos;
        const valor     = parseFloat(ev.valor_aluno) || 0;

        return `
        <div class="ps-evento-card">
            <div class="ps-evento-card-header">
                <div class="ps-evento-nome">${esc(ev.nome)}</div>
                <div class="ps-evento-destino">📍 ${esc(ev.destino)}</div>
                <div class="ps-evento-data">📅 ${data}</div>
            </div>
            <div class="ps-evento-card-body">
                <div class="ps-evento-stats">
                    <div class="ps-stat">
                        <div class="ps-stat-value">${total}</div>
                        <div class="ps-stat-label">Inscritos</div>
                    </div>
                    <div class="ps-stat">
                        <div class="ps-stat-value" style="color:#16a34a">${pagos}</div>
                        <div class="ps-stat-label pago">Pagos</div>
                    </div>
                    <div class="ps-stat">
                        <div class="ps-stat-value" style="color:#d97706">${pendentes}</div>
                        <div class="ps-stat-label pendente">Pendentes</div>
                    </div>
                    ${valor > 0 ? `<div class="ps-stat">
                        <div class="ps-stat-value" style="font-size:16px">R$&nbsp;${(pagos * valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
                        <div class="ps-stat-label">Arrecadado</div>
                    </div>` : ''}
                </div>
                <div class="ps-evento-card-footer">
                    <button class="ps-btn-detalhe" onclick="abrirDetalhe(${ev.id})">Gerenciar</button>
                    <button class="ps-btn-editar-card" onclick="abrirModalEditarEvento(${ev.id})">✏️</button>
                    <button class="ps-btn-editar-card ps-btn-danger" onclick="excluirEvento(${ev.id})" style="color:#dc2626;border-color:#fca5a5">🗑️</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Modal: Criar / Editar Evento                                       */
/* ─────────────────────────────────────────────────────────────────── */
function abrirModalNovoEvento() {
    editandoEvento = null;
    document.getElementById('modalEventoTitulo').textContent = 'Novo Evento';
    limparFormEvento();
    document.getElementById('modalEvento').classList.remove('oculto');
}

async function abrirModalEditarEvento(id) {
    editandoEvento = id;
    document.getElementById('modalEventoTitulo').textContent = 'Editar Evento';
    document.getElementById('modalEvento').classList.remove('oculto');

    try {
        const r  = await fetch(`${API}/passeios/${id}`);
        const ev = await r.json();
        document.getElementById('evNome').value      = ev.nome;
        document.getElementById('evDestino').value   = ev.destino;
        document.getElementById('evData').value      = ev.data_evento?.slice(0, 10) || '';
        document.getElementById('evPrazo').value     = ev.prazo_pagamento?.slice(0, 10) || '';
        document.getElementById('evValor').value     = ev.valor_aluno || '';
        document.getElementById('evPixChave').value  = ev.pix_chave || '';
        document.getElementById('evPixNome').value   = ev.pix_nome || '';
        document.getElementById('evPixCidade').value = ev.pix_cidade || 'CURITIBA';
        document.getElementById('evDescricao').value = ev.descricao || '';

        /* Ônibus */
        const container = document.getElementById('onibusContainer');
        container.innerHTML = '';
        (ev.onibus || []).forEach(ob => adicionarOnibusForm({
            id: ob.id,                         // ← preservar ID existente
            nome: ob.nome, capacidade: ob.capacidade,
            monitor_nome: ob.monitor_nome, monitor_telefone: ob.monitor_telefone,
            cor: ob.cor,
        }));
    } catch (e) { notificar('Erro ao carregar evento: ' + e.message, 'erro'); }
}

function limparFormEvento() {
    ['evNome','evDestino','evData','evPrazo','evValor','evPixChave','evPixNome','evDescricao'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('evPixCidade').value = 'CURITIBA';
    document.getElementById('onibusContainer').innerHTML = '';
    /* Sugerir 1 ônibus padrão */
    adicionarOnibusForm();
}

function fecharModalEvento() {
    document.getElementById('modalEvento').classList.add('oculto');
}

function adicionarOnibusForm(defaults = {}) {
    const container = document.getElementById('onibusContainer');
    const num = container.children.length + 1;
    const div = document.createElement('div');
    div.className = 'ps-onibus-row';
    if (defaults.id) div.dataset.obId = defaults.id; // ← preservar ID no DOM
    div.innerHTML = `
        <div class="ps-onibus-label">Ônibus ${num}</div>
        <input class="ps-input ob-nome" type="text" placeholder="Nome (ex: Azul)" value="${esc(defaults.nome || '')}">
        <input class="ps-input ob-cap" type="number" min="1" placeholder="Capacidade" value="${defaults.capacidade || 40}" style="width:80px">
        <input class="ps-input ob-monitor" type="text" placeholder="Monitor" value="${esc(defaults.monitor_nome || '')}">
        <input class="ps-input ob-tel" type="tel" placeholder="Telefone" value="${esc(defaults.monitor_telefone || '')}">
        <input class="ps-input ob-cor" type="color" value="${defaults.cor || '#3b82f6'}" style="width:36px;height:36px;padding:2px;cursor:pointer">
        <button class="ps-btn-rm" onclick="this.closest('.ps-onibus-row').remove();atualizarLabelsOnibus()" title="Remover">✕</button>
    `;
    container.appendChild(div);
}

function atualizarLabelsOnibus() {
    document.querySelectorAll('.ps-onibus-row').forEach((row, i) => {
        const lbl = row.querySelector('.ps-onibus-label');
        if (lbl) lbl.textContent = `Ônibus ${i + 1}`;
    });
}

function coletarOnibusForm() {
    return [...document.querySelectorAll('.ps-onibus-row')].map(row => ({
        id:               row.dataset.obId ? parseInt(row.dataset.obId) : undefined, // ← enviar ID existente
        nome:             row.querySelector('.ob-nome')?.value.trim()    || null,
        capacidade:       parseInt(row.querySelector('.ob-cap')?.value)  || 40,
        monitor_nome:     row.querySelector('.ob-monitor')?.value.trim() || null,
        monitor_telefone: row.querySelector('.ob-tel')?.value.trim()     || null,
        cor:              row.querySelector('.ob-cor')?.value             || '#3b82f6',
    }));
}

async function salvarEvento() {
    const nome      = document.getElementById('evNome').value.trim();
    const destino   = document.getElementById('evDestino').value.trim();
    const data      = document.getElementById('evData').value;

    if (!nome)    { toast('Informe o nome do evento'); return; }
    if (!destino) { toast('Informe o destino'); return; }
    if (!data)    { toast('Informe a data'); return; }

    const body = {
        nome, destino,
        data_evento:     data,
        prazo_pagamento: document.getElementById('evPrazo').value || null,
        valor_aluno:     parseFloat(document.getElementById('evValor').value) || 0,
        pix_chave:       document.getElementById('evPixChave').value.trim()  || null,
        pix_nome:        document.getElementById('evPixNome').value.trim()   || null,
        pix_cidade:      document.getElementById('evPixCidade').value.trim() || 'CURITIBA',
        descricao:       document.getElementById('evDescricao').value.trim() || null,
        onibus:          coletarOnibusForm(),
    };

    try {
        let r;
        if (editandoEvento) {
            r = await fetch(`${API}/passeios/${editandoEvento}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
        } else {
            r = await fetch(`${API}/passeios`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
        }
        const data2 = await r.json();
        if (!r.ok) { toast('Erro: ' + (data2.erro || r.statusText)); return; }

        fecharModalEvento();
        toast(editandoEvento ? 'Evento atualizado!' : 'Evento criado!', 'sucesso');
        await carregarEventos();

        /* Se criando, abrir detalhe direto */
        if (!editandoEvento) abrirDetalhe(data2.id);
    } catch (e) { toast('Erro: ' + e.message); }
}

async function excluirEvento(id) {
    const ok = await confirmar('Excluir Evento', 'Esta ação é irreversível. Todas as inscrições, pagamentos e dados do evento serão perdidos.', { confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    try {
        await fetch(`${API}/passeios/${id}`, { method: 'DELETE' });
        toast('Evento excluído');
        carregarEventos();
    } catch (e) { toast('Erro: ' + e.message); }
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Modal: Detalhe do Evento                                           */
/* ─────────────────────────────────────────────────────────────────── */
async function abrirDetalhe(id) {
    document.getElementById('modalDetalhe').classList.remove('oculto');
    document.getElementById('detalheNome').textContent = 'Carregando...';
    document.getElementById('detalheInfo').textContent = '';
    document.getElementById('tabelaInscricoes').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px">Carregando...</td></tr>';

    try {
        const r  = await fetch(`${API}/passeios/${id}`);
        eventoAtual = await r.json();
        renderizarDetalhe();
    } catch (e) { notificar('Erro ao carregar evento: ' + e.message, 'erro'); }
}

function fecharModalDetalhe() {
    document.getElementById('modalDetalhe').classList.add('oculto');
    eventoAtual = null;
    fecharPainel();
}

function renderizarDetalhe() {
    if (!eventoAtual) return;
    const ev = eventoAtual;

    document.getElementById('detalheNome').textContent = ev.nome;
    document.getElementById('detalheInfo').innerHTML =
        `📍 ${esc(ev.destino)} · 📅 ${fmtData(ev.data_evento)}` +
        (ev.valor_aluno > 0 ? ` · 💰 R$ ${parseFloat(ev.valor_aluno).toFixed(2).replace('.',',')}` : '');

    renderizarFinanceiro();
    renderizarOnibusAba();
    renderizarFiltroOnibusImpressao();
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Aba Financeiro                                                     */
/* ─────────────────────────────────────────────────────────────────── */
function renderizarFinanceiro() {
    const inscs   = eventoAtual.inscricoes || [];
    const pagos   = inscs.filter(i => i.status_pagamento === 'pago').length;
    const pend    = inscs.filter(i => i.status_pagamento === 'pendente').length;
    const total   = inscs.length;
    const valor   = parseFloat(eventoAtual.valor_aluno) || 0;
    const arrec   = pagos * valor;

    document.getElementById('finStats').innerHTML = `
        <div class="ps-fin-stat"><div class="ps-fin-stat-val">${total}</div><div class="ps-fin-stat-label">Total</div></div>
        <div class="ps-fin-stat"><div class="ps-fin-stat-val" style="color:#16a34a">${pagos}</div><div class="ps-fin-stat-label">Pagos</div></div>
        <div class="ps-fin-stat"><div class="ps-fin-stat-val" style="color:#d97706">${pend}</div><div class="ps-fin-stat-label">Pendentes</div></div>
        ${valor > 0 ? `<div class="ps-fin-stat"><div class="ps-fin-stat-val" style="color:var(--accent)">R$&nbsp;${arrec.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div><div class="ps-fin-stat-label">Arrecadado</div></div>` : ''}
    `;

    filtrarPagamentos(filtroAtual);
}

function filtrarPagamentos(filtro) {
    if (filtro !== undefined) {
        filtroAtual = filtro;
        document.querySelectorAll('.ps-filtro').forEach(b => {
            b.classList.toggle('ativo', b.dataset.filtro === filtro);
        });
    }
    const busca = (document.getElementById('buscarAluno')?.value || '').toLowerCase();
    const inscs = (eventoAtual?.inscricoes || []).filter(i => {
        if (filtroAtual !== 'todos' && i.status_pagamento !== filtroAtual) return false;
        if (busca && !i.nome_aluno.toLowerCase().includes(busca)) return false;
        return true;
    });
    renderizarTabelaInscricoes(inscs);
}

function renderizarTabelaInscricoes(inscs) {
    const tbody = document.getElementById('tabelaInscricoes');
    if (!inscs.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-secondary)">Nenhum aluno encontrado</td></tr>';
        return;
    }
    tbody.innerHTML = inscs.map(i => {
        const badge = `<span class="ps-badge ps-badge-${i.status_pagamento}">${statusLabel(i.status_pagamento)}</span>`;
        const pagoEm = i.pago_em ? new Date(i.pago_em).toLocaleDateString('pt-BR') : '—';
        const onibusLabel = i.onibus_id
            ? `<span style="display:inline-flex;align-items:center;gap:4px"><span class="ps-bus-dot" style="background:${esc(i.onibus_cor||'#64748b')}"></span>${esc(i.onibus_nome || 'Ônibus ' + i.onibus_numero)}</span>`
            : '<span style="color:var(--text-muted)">—</span>';

        const btnPagar = i.status_pagamento === 'pendente'
            ? `<button class="ps-btn-action ps-btn-pagar" onclick="marcarPago(${i.id})">✓ Pago</button>`
            : i.status_pagamento === 'pago'
                ? `<button class="ps-btn-action ps-btn-confirmar" onclick="confirmarPagamento(${i.id})">✅ Confirmar</button>
                   <button class="ps-btn-action" onclick="reverterPagamento(${i.id})">↩ Reverter</button>`
                : i.status_pagamento === 'confirmado'
                    ? `<button class="ps-btn-action" onclick="reverterPagamento(${i.id})">↩ Reverter</button>`
                    : `<button class="ps-btn-action" onclick="reverterPagamento(${i.id})">↩ Reverter</button>`;

        return `<tr>
            <td style="font-weight:600">${esc(i.nome_aluno)}</td>
            <td style="color:var(--text-secondary);font-size:13px">${esc(i.turma||'')}</td>
            <td>${badge}</td>
            <td style="font-size:13px;color:var(--text-secondary)">${pagoEm}</td>
            <td>${onibusLabel}</td>
            <td>
                <div class="ps-row-actions">
                    ${btnPagar}
                    <button class="ps-btn-action ps-btn-pix" onclick="verPix(${i.id},${JSON.stringify(i.nome_aluno).replace(/"/g,'&quot;')})">💰 PIX</button>
                    <button class="ps-btn-action" onclick="editarInscricao(${i.id})">✏️</button>
                    <button class="ps-btn-action ps-btn-danger" onclick="removerInscricao(${i.id})">🗑️</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function marcarPago(inscId) {
    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/inscricoes/${inscId}/pagar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        });
        if (!r.ok) { toast('Erro ao confirmar pagamento'); return; }
        toast('Pagamento confirmado! ✓', 'sucesso');
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

async function confirmarPagamento(inscId) {
    const insc = (eventoAtual?.inscricoes || []).find(i => i.id === inscId);
    const obs   = await solicitarTexto('Observação do comprovante (opcional):', '', 'Confirmar Pagamento');
    if (obs === null) return; // cancelado
    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/inscricoes/${inscId}/confirmar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comprovante_obs: obs || undefined }),
        });
        const d = await r.json();
        if (!r.ok) { toast('Erro: ' + (d.erro || r.status), 'erro'); return; }
        toast('Pagamento confirmado ✅', 'sucesso');
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message, 'erro'); }
}

async function reverterPagamento(inscId) {
    const ok = await confirmar('Reverter Pagamento', 'Deseja marcar o pagamento como pendente novamente?', { confirmLabel: 'Reverter' });
    if (!ok) return;
    try {
        await fetch(`${API}/passeios/${eventoAtual.id}/inscricoes/${inscId}/reverter`, { method: 'POST' });
        toast('Pagamento revertido');
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

async function removerInscricao(inscId) {
    const ok = await confirmar('Remover Aluno', 'Deseja remover este aluno do evento?', { confirmLabel: 'Remover', danger: true });
    if (!ok) return;
    try {
        await fetch(`${API}/passeios/${eventoAtual.id}/inscricoes/${inscId}`, { method: 'DELETE' });
        toast('Aluno removido');
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

async function enviarLembretes() {
    const pendentes = (eventoAtual?.inscricoes || []).filter(i => i.status_pagamento === 'pendente');
    if (!pendentes.length) { toast('Não há pagamentos pendentes'); return; }

    const comTel = pendentes.filter(i => i.contato_responsavel);
    const semTel = pendentes.length - comTel.length;

    const ok = await confirmar(
        'Enviar Lembretes',
        `Enviar lembrete via WhatsApp para ${comTel.length} responsável(is) com telefone cadastrado.${semTel > 0 ? `\n${semTel} aluno(s) sem telefone serão ignorados.` : ''}`,
        { confirmLabel: 'Enviar' }
    );
    if (!ok) return;

    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/lembrete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        });
        const d = await r.json();
        toast(d.sem_n8n ? 'WhatsApp não configurado (simulado)' : `${d.enviados} lembrete(s) enviados!`, 'sucesso');
    } catch (e) { toast('Erro: ' + e.message); }
}

async function notificarOnibus(tipo) {
    const labels = { saida: 'Ônibus Saiu', chegada: 'Chegamos!', retorno: 'Estamos Retornando' };
    const msgs = {
        saida:   'Notifica todos os responsáveis que o ônibus saiu com os alunos.',
        chegada: 'Notifica todos os responsáveis que chegamos ao destino com segurança.',
        retorno: 'Notifica todos os responsáveis que o ônibus está retornando.',
    };
    const comTel = (eventoAtual?.inscricoes || []).filter(i => i.contato_responsavel);
    if (!comTel.length) { toast('Nenhum responsável com telefone cadastrado'); return; }

    const ok = await confirmar(`📢 ${labels[tipo]}`, `${msgs[tipo]}\n\nEnvia WhatsApp para ${comTel.length} responsável(is).`, { confirmLabel: 'Enviar' });
    if (!ok) return;

    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/notificar-onibus`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo }),
        });
        const d = await r.json();
        if (!r.ok) { toast('Erro: ' + (d.erro || r.status), 'erro'); return; }
        toast(d.sem_n8n ? `${labels[tipo]} — simulado (WhatsApp não configurado)` : `${d.enviados} notificação(ões) enviada(s)!`, 'sucesso');
    } catch (e) { toast('Erro: ' + e.message, 'erro'); }
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Modal: PIX                                                         */
/* ─────────────────────────────────────────────────────────────────── */
async function verPix(inscId, alunoNome) {
    document.getElementById('pixAlunoNome').textContent = alunoNome;
    document.getElementById('pixQrImg').innerHTML = '<div class="spinner" style="margin:20px auto"></div>';
    document.getElementById('pixValor').textContent = '';
    document.getElementById('pixPayloadText').textContent = '';
    document.getElementById('pixTxid').textContent = '';
    document.getElementById('modalPix').classList.remove('oculto');

    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/pix/${inscId}`);
        const d = await r.json();
        if (!r.ok) {
            document.getElementById('pixQrImg').innerHTML = `<p style="color:#dc2626">${esc(d.erro)}</p>`;
            return;
        }
        document.getElementById('pixQrImg').innerHTML =
            `<img src="${d.qrDataUrl}" style="width:200px;height:200px;border-radius:8px;border:1px solid var(--border-color)">`;
        document.getElementById('pixValor').textContent =
            d.valor > 0 ? `R$ ${parseFloat(d.valor).toFixed(2).replace('.',',')}` : 'Valor livre';
        document.getElementById('pixPayloadText').textContent = d.payload;
        document.getElementById('pixTxid').textContent = `txid: ${d.txid}`;
    } catch (e) {
        document.getElementById('pixQrImg').innerHTML = `<p style="color:#dc2626">${esc(e.message)}</p>`;
    }
}

function copiarPix() {
    const txt = document.getElementById('pixPayloadText').textContent;
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(() => toast('PIX copiado!', 'sucesso')).catch(() => {});
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Modal: Editar Inscrição                                            */
/* ─────────────────────────────────────────────────────────────────── */
function editarInscricao(inscId) {
    const insc = (eventoAtual?.inscricoes || []).find(i => i.id === inscId);
    if (!insc) return;
    editandoInscId = inscId;
    document.getElementById('editInscNome').textContent = insc.nome_aluno;
    document.getElementById('editNomeResp').value  = insc.nome_responsavel || '';
    document.getElementById('editTelResp').value   = insc.contato_responsavel || '';
    document.getElementById('editRestricoes').value = insc.restricoes_medicas || '';
    document.getElementById('modalEditarInsc').classList.remove('oculto');
}

function fecharModalEditarInsc() {
    document.getElementById('modalEditarInsc').classList.add('oculto');
    editandoInscId = null;
}

async function salvarEdicaoInsc() {
    if (!editandoInscId) return;
    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/inscricoes/${editandoInscId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome_responsavel:    document.getElementById('editNomeResp').value.trim() || null,
                contato_responsavel: document.getElementById('editTelResp').value.trim() || null,
                restricoes_medicas:  document.getElementById('editRestricoes').value.trim() || null,
            }),
        });
        if (!r.ok) { toast('Erro ao salvar'); return; }
        toast('Salvo!', 'sucesso');
        fecharModalEditarInsc();
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Modal: Inscrever Turmas                                            */
/* ─────────────────────────────────────────────────────────────────── */
async function carregarTurmas() {
    try {
        const r  = await fetch(`${API}/alunos/turmas/lista`);
        turmasList = await r.json();
    } catch {}
}

function abrirInscricaoModal() {
    document.getElementById('modalInscricao').classList.remove('oculto');
    renderizarTurmasModal();
}

function fecharModalInscricao() {
    document.getElementById('modalInscricao').classList.add('oculto');
}

function renderizarTurmasModal() {
    const el = document.getElementById('listaTurmasModal');
    if (!turmasList.length) {
        el.innerHTML = '<p style="color:var(--text-secondary)">Nenhuma turma encontrada</p>';
        return;
    }

    /* Agrupar por turma (nome curto), ignorar duplicatas */
    const seen = new Map();
    turmasList.forEach(t => {
        if (!seen.has(t.codturma)) seen.set(t.codturma, t);
    });

    el.innerHTML = [...seen.values()].map(t => `
        <div class="ps-turma-item">
            <input type="checkbox" id="turma_${t.codturma}" value="${t.codturma}">
            <label for="turma_${t.codturma}">${esc(t.turma)}</label>
        </div>
    `).join('');
}

async function confirmarInscricao() {
    const selecionadas = [...document.querySelectorAll('#listaTurmasModal input:checked')].map(el => parseInt(el.value));
    if (!selecionadas.length) { toast('Selecione ao menos uma turma'); return; }

    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/inscrever`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codturmas: selecionadas }),
        });
        const d = await r.json();
        if (!r.ok) { toast('Erro: ' + d.erro); return; }
        toast(`${d.inseridos} aluno(s) inscrito(s)!`, 'sucesso');
        fecharModalInscricao();
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Aba Ônibus                                                         */
/* ─────────────────────────────────────────────────────────────────── */
function renderizarOnibusAba() {
    const grid  = document.getElementById('onibusDetalheGrid');
    const onibus = eventoAtual.onibus || [];

    if (!onibus.length) {
        grid.innerHTML = '<div style="color:var(--text-secondary);font-size:14px">Nenhum ônibus cadastrado. Crie ônibus ao editar o evento.</div>';
        return;
    }

    grid.innerHTML = onibus.map(ob => {
        const alunosOb = (eventoAtual.inscricoes || []).filter(i => i.onibus_id === ob.id);
        const embarcados = alunosOb.filter(i => i.embarcou).length;
        const pct = alunosOb.length ? Math.round(embarcados / alunosOb.length * 100) : 0;

        return `
        <div class="ps-onibus-card">
            <div class="ps-onibus-card-header" style="background:${esc(ob.cor||'#3b82f6')}">
                <span>🚌 ${esc(ob.nome || 'Ônibus ' + ob.numero)}</span>
                <span class="ps-onibus-count">${alunosOb.length}/${ob.capacidade}</span>
            </div>
            <div class="ps-onibus-card-body">
                ${ob.monitor_nome ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Monitor: ${esc(ob.monitor_nome)}</div>` : ''}
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">${embarcados} embarcados</div>
                <div class="ps-painel-ob-bar">
                    <div class="ps-painel-ob-bar-fill" style="width:${pct}%;background:${esc(ob.cor||'#22c55e')}"></div>
                </div>
                ${alunosOb.slice(0, 8).map(a => `
                    <div class="ps-onibus-aluno ${a.embarcou ? 'embarcou' : ''}">
                        <select onchange="moverOnibus(${a.id}, this.value)" class="ps-input" style="padding:3px 6px;font-size:11px;border:none;background:transparent;width:auto">
                            <option value="">—</option>
                            ${(eventoAtual.onibus||[]).map(o =>
                                `<option value="${o.id}" ${o.id===a.onibus_id?'selected':''}>${esc(o.nome||'Ôn.'+o.numero)}</option>`
                            ).join('')}
                        </select>
                        <span style="flex:1;font-size:12px">${esc(a.nome_aluno.split(' ')[0])}</span>
                        ${a.embarcou ? '<span style="color:#16a34a;font-size:12px">✓</span>' : ''}
                    </div>
                `).join('')}
                ${alunosOb.length > 8 ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">+${alunosOb.length - 8} mais...</div>` : ''}
            </div>
            <div class="ps-onibus-card-footer">
                <button class="ps-btn-action" onclick="editarOnibusDetalhe(${ob.id})">✏️ Editar</button>
                <button class="ps-btn-action ps-btn-danger" onclick="removerOnibusDetalhe(${ob.id})">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

async function distribuirOnibus() {
    const ok = await confirmar('Distribuir Automaticamente', 'O sistema vai redistribuir os alunos com pagamento confirmado entre os ônibus. A distribuição atual será substituída.', { confirmLabel: 'Distribuir' });
    if (!ok) return;
    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/distribuir`, { method: 'POST' });
        const d = await r.json();
        if (!r.ok) { toast('Erro: ' + d.erro); return; }
        toast(`${d.distribuidos} aluno(s) distribuídos!`, 'sucesso');
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

async function moverOnibus(inscId, onibusId) {
    try {
        await fetch(`${API}/passeios/${eventoAtual.id}/inscricoes/${inscId}/onibus`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ onibus_id: onibusId ? parseInt(onibusId) : null }),
        });
        await recarregarDetalhe();
    } catch {}
}

async function adicionarOnibusDetalhe() {
    const nome = await solicitarTexto('Nome do ônibus (opcional):', '', 'Novo Ônibus');
    if (nome === null) return;
    try {
        await fetch(`${API}/passeios/${eventoAtual.id}/onibus`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: nome || null, capacidade: 40 }),
        });
        toast('Ônibus adicionado!', 'sucesso');
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

async function editarOnibusDetalhe(obId) {
    const ob = (eventoAtual.onibus || []).find(o => o.id === obId);
    if (!ob) return;
    const nome = await solicitarTexto('Nome do ônibus:', ob.nome || '', 'Editar Ônibus');
    if (nome === null) return;
    try {
        await fetch(`${API}/passeios/${eventoAtual.id}/onibus/${obId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: nome || null }),
        });
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

async function removerOnibusDetalhe(obId) {
    const ok = await confirmar('Remover Ônibus', 'Alunos atribuídos a este ônibus ficarão sem ônibus atribuído.', { confirmLabel: 'Remover', danger: true });
    if (!ok) return;
    try {
        await fetch(`${API}/passeios/${eventoAtual.id}/onibus/${obId}`, { method: 'DELETE' });
        toast('Ônibus removido');
        await recarregarDetalhe();
    } catch (e) { toast('Erro: ' + e.message); }
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Aba Pulseiras                                                      */
/* ─────────────────────────────────────────────────────────────────── */
function renderizarFiltroOnibusImpressao() {
    const sel = document.getElementById('filtroOnibusImpressao');
    sel.innerHTML = '<option value="">Todos os ônibus</option>' +
        (eventoAtual.onibus || []).map(ob =>
            `<option value="${ob.id}">${esc(ob.nome || 'Ônibus ' + ob.numero)}</option>`
        ).join('');
}

async function imprimirPulseiras() {
    const onibusId = document.getElementById('filtroOnibusImpressao').value;
    const preview  = document.getElementById('pulseirasPreview');
    preview.innerHTML = '<div class="spinner" style="margin:30px auto"></div>';

    try {
        let url = `${API}/passeios/${eventoAtual.id}/pulseiras`;
        if (onibusId) url += `?onibus_id=${onibusId}`;
        const r = await fetch(url);
        const d = await r.json();

        if (!d.inscricoes?.length) {
            preview.innerHTML = '<div class="ps-empty">Nenhuma inscrição encontrada</div>';
            return;
        }

        const html = renderizarFolhasPulseiras(d.inscricoes, d.evento);
        preview.innerHTML = `<div id="printArea">${html}</div>`;
        setTimeout(() => window.print(), 300);
    } catch (e) {
        preview.innerHTML = `<div class="ps-empty" style="color:#dc2626">Erro: ${esc(e.message)}</div>`;
    }
}

function iniciais(nome) {
    if (!nome) return '?';
    const p = nome.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[p.length - 1]?.[0] || '')).toUpperCase();
}

function renderizarFolhasPulseiras(inscricoes, evento) {
    const POR_PAGINA = 24;
    let html = '';

    for (let i = 0; i < inscricoes.length; i += POR_PAGINA) {
        const lote = inscricoes.slice(i, i + POR_PAGINA);
        html += `<div class="ps-pulseiras-sheet" style="page-break-after:always">`;
        html += lote.map(a => {
            const cor = a.onibus_cor || '#64748b';
            const avatarHtml = a.foto_url
                ? `<img src="${esc(a.foto_url)}" alt="" class="ps-pulseira-foto" onerror="this.outerHTML='<div class=ps-pulseira-ini>${iniciais(a.nome_aluno)}</div>'">`
                : `<div class="ps-pulseira-ini">${iniciais(a.nome_aluno)}</div>`;
            return `
            <div class="ps-pulseira" style="border-color:${esc(cor)}">
                ${avatarHtml}
                <img src="${a.qrDataUrl}" alt="QR" style="width:70px;height:70px">
                <div class="ps-pulseira-nome">${esc(a.nome_aluno)}</div>
                <div class="ps-pulseira-turma">${esc(a.turma || '')}</div>
                ${a.onibus_id ? `<div class="ps-pulseira-bus" style="background:${esc(cor)}">🚌 ${esc(a.onibus_label)}</div>` : ''}
                <div style="font-size:9px;color:#94a3b8">${esc(evento.nome)}</div>
            </div>`;
        }).join('');
        html += '</div>';
    }
    return html;
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Scanner link                                                       */
/* ─────────────────────────────────────────────────────────────────── */
function abrirScanner() {
    window.open('/pages/passeios/scanner/', '_blank');
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Painel ao Vivo                                                     */
/* ─────────────────────────────────────────────────────────────────── */
function abrirPainel() {
    document.getElementById('painelEventoNome').textContent = eventoAtual.nome;
    document.getElementById('modalPainel').classList.remove('oculto');
    carregarPainel();
    /* Auto-refresh a cada 15s */
    painelTimer = setInterval(carregarPainel, 15000);
}

function fecharPainel() {
    document.getElementById('modalPainel').classList.add('oculto');
    clearInterval(painelTimer);
    painelTimer = null;
}

async function carregarPainel() {
    if (!eventoAtual) return;
    try {
        const r = await fetch(`${API}/passeios/${eventoAtual.id}/painel`);
        const d = await r.json();
        renderizarPainel(d);
        document.getElementById('painelAtualizado').textContent =
            'Atualizado: ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {}
}

function renderizarPainel(d) {
    const g = d.geral || {};
    const content = document.getElementById('painelContent');

    const ausentes = d.ausentes_retorno || [];

    content.innerHTML = `
        <!-- Resumo geral -->
        <div class="ps-painel-geral">
            <div class="ps-painel-stat">
                <div class="ps-painel-stat-val">${g.total || 0}</div>
                <div class="ps-painel-stat-lbl">Total Inscritos</div>
            </div>
            <div class="ps-painel-stat">
                <div class="ps-painel-stat-val" style="color:#22c55e">${g.embarcados || 0}</div>
                <div class="ps-painel-stat-lbl">Embarcaram</div>
            </div>
            <div class="ps-painel-stat">
                <div class="ps-painel-stat-val" style="color:#3b82f6">${g.desembarcados || 0}</div>
                <div class="ps-painel-stat-lbl">Retornaram</div>
            </div>
            <div class="ps-painel-stat">
                <div class="ps-painel-stat-val" style="color:#16a34a">${g.pagos || 0}</div>
                <div class="ps-painel-stat-lbl">Pagos</div>
            </div>
        </div>

        <!-- Por ônibus -->
        <div class="ps-painel-onibus-grid">
            ${(d.onibus || []).map(ob => {
                const total = parseInt(ob.total) || 0;
                const emb   = parseInt(ob.embarcados) || 0;
                const des   = parseInt(ob.desembarcados) || 0;
                const pct   = total ? Math.round(emb / total * 100) : 0;
                return `
                <div class="ps-painel-ob">
                    <div class="ps-painel-ob-header" style="background:${esc(ob.cor||'#3b82f6')}">
                        🚌 ${esc(ob.nome || 'Ônibus ' + ob.numero)} &nbsp;
                        <small style="opacity:.8">${emb}/${total}</small>
                    </div>
                    <div class="ps-painel-ob-body">
                        <div class="ps-painel-ob-bar">
                            <div class="ps-painel-ob-bar-fill" style="width:${pct}%;background:${esc(ob.cor||'#22c55e')}"></div>
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary)">
                            ${emb} embarcados · ${des} retornaram · ${parseInt(ob.ausentes)||0} ausentes
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>

        <!-- Notificações de momento -->
        <div class="ps-painel-notif-moment">
            <div class="ps-painel-notif-titulo">📢 Notificações de Momento</div>
            <div class="ps-painel-notif-btns">
                <button class="ps-btn-notif-saida"   onclick="notificarOnibus('saida')">🚌 Ônibus Saiu</button>
                <button class="ps-btn-notif-chegada" onclick="notificarOnibus('chegada')">🎉 Chegamos!</button>
                <button class="ps-btn-notif-retorno" onclick="notificarOnibus('retorno')">🏠 Retornando</button>
            </div>
            <div style="font-size:12px;color:#94a3b8;margin-top:6px">Envia WhatsApp para responsáveis de todos os alunos inscritos com telefone cadastrado</div>
        </div>

        <!-- Ausentes no retorno -->
        ${ausentes.length ? `
        <div class="ps-painel-ausentes">
            <h4>⚠️ Embarcaram mas ainda não retornaram (${ausentes.length})</h4>
            ${ausentes.map(a => `
                <div class="ps-painel-ausente-item">${esc(a.nome_aluno)} — ${esc(a.turma||'')}</div>
            `).join('')}
        </div>` : ''}
    `;
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Abas                                                               */
/* ─────────────────────────────────────────────────────────────────── */
function mudarAba(aba) {
    document.querySelectorAll('.ps-tab').forEach(b => b.classList.toggle('ativo', b.dataset.tab === aba));
    document.getElementById('abaFinanceiro').classList.toggle('oculto', aba !== 'financeiro');
    document.getElementById('abaOnibus').classList.toggle('oculto', aba !== 'onibus');
    document.getElementById('abaPulseiras').classList.toggle('oculto', aba !== 'pulseiras');
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Utilitários                                                        */
/* ─────────────────────────────────────────────────────────────────── */
async function recarregarDetalhe() {
    if (!eventoAtual) return;
    const r    = await fetch(`${API}/passeios/${eventoAtual.id}`);
    eventoAtual = await r.json();
    renderizarDetalhe();
    renderizarEventos(); // atualiza cards
    await carregarEventos();
}

function fmtData(iso) {
    if (!iso) return '—';
    return new Date(iso + (iso.includes('T') ? '' : 'T12:00')).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    });
}

function statusLabel(s) {
    return { pago: 'Pago ✓', confirmado: 'Confirmado ✅', pendente: 'Pendente', isento: 'Isento' }[s] || s;
}

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Prompt simples em modal inline */
function solicitarTexto(label, valorAtual = '', titulo = 'Informar') {
    return new Promise(resolve => {
        const id  = 'ps-prompt-' + Date.now();
        const el  = document.createElement('div');
        el.className = 'ps-modal-overlay';
        el.id = id;
        el.style.zIndex = '1100';
        el.innerHTML = `
            <div class="ps-modal-box ps-modal-sm" onclick="event.stopPropagation()" style="margin:auto">
                <div class="ps-modal-header">
                    <h3>${esc(titulo)}</h3>
                </div>
                <div class="ps-modal-body">
                    <label style="font-size:13px;color:var(--text-secondary)">${esc(label)}</label>
                    <input id="${id}_inp" type="text" class="ps-input" value="${esc(valorAtual)}" style="margin-top:8px;width:100%">
                </div>
                <div class="ps-modal-footer">
                    <button class="ps-btn-cancel" id="${id}_cancel">Cancelar</button>
                    <button class="ps-btn-save"   id="${id}_ok">OK</button>
                </div>
            </div>`;
        document.body.appendChild(el);
        const inp = document.getElementById(id + '_inp');
        inp.focus(); inp.select();
        const fim = (val) => { el.remove(); resolve(val); };
        document.getElementById(id + '_cancel').onclick = () => fim(null);
        document.getElementById(id + '_ok').onclick     = () => fim(inp.value);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') fim(inp.value); if (e.key === 'Escape') fim(null); });
    });
}

function fecharModalSeOverlay(e, id) {
    if (e.target === document.getElementById(id)) {
        document.getElementById(id).classList.add('oculto');
        if (id === 'modalDetalhe') { eventoAtual = null; fecharPainel(); }
    }
}

function toast(msg, tipo = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (tipo ? ' toast-' + tipo : '') + ' show';
    setTimeout(() => el.classList.remove('show'), 3000);
}

/* Alias */
const notificar = toast;
