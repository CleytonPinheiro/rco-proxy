/* ── Comunicados de Falta ───────────────────────────────────────────── */

const API = '/api';

let todos         = [];   // todos os comunicados carregados
let filtrados     = [];   // após filtros
let abaAtual      = 'todas';
let selecionados  = new Set();
let turmasCache   = [];
let alunosCache   = {};   // { cod_turma: [aluno, ...] }
let contatoAtual  = null; // comunicado aberto no modal contato
let detAtual      = null; // comunicado aberto no modal detalhes

// ── Init ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    verificarAuth();
    setDataDefault();
    initSyncStatus();
    await Promise.all([
        carregarStats(),
        carregarComunicados(),
        carregarTurmas(),
        carregarConfig(),
    ]);
});

function setDataDefault() {
    const hoje = dataHojeBrasilia();
    document.getElementById('filtroDataFim').value   = hoje;
    const mesAtras = new Date(hoje);
    mesAtras.setDate(mesAtras.getDate() - 30);
    document.getElementById('filtroDataInicio').value = mesAtras.toISOString().split('T')[0];
}

function dataHojeBrasilia() {
    return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        .split('/').reverse().join('-');
}

// ── Auth ──────────────────────────────────────────────────────────────

function verificarAuth() {
    document.getElementById('btnLogout').onclick = async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        window.location.replace('/login/');
    };
}

// ── Dados ─────────────────────────────────────────────────────────────

async function carregarStats() {
    try {
        const r    = await fetch(`${API}/comunicados/stats`);
        const data = await r.json();
        document.getElementById('statTotal').textContent      = data.total     || 0;
        document.getElementById('statPendente').textContent   = data.pendente  || 0;
        document.getElementById('statEnviado').textContent    = data.enviado   || 0;
        document.getElementById('statRespondido').textContent = data.respondido|| 0;
        document.getElementById('statJustificado').textContent= data.justificado||0;
        const taxa = data.enviado > 0
            ? Math.round(((data.respondido + data.justificado) / (data.enviado + data.respondido + data.justificado)) * 100)
            : 0;
        document.getElementById('statTaxa').textContent = taxa + '%';
    } catch { /* silencioso */ }
}

async function carregarComunicados() {
    const inicio = document.getElementById('filtroDataInicio').value;
    const fim    = document.getElementById('filtroDataFim').value;
    try {
        const params = new URLSearchParams({ data_inicio: inicio, data_fim: fim, limit: 500 });
        const r    = await fetch(`${API}/comunicados?${params}`);
        const data = await r.json();
        todos = Array.isArray(data) ? data : [];
    } catch { todos = []; }
    aplicarFiltros();
}

async function carregarTurmas() {
    try {
        const r = await fetch(`${API}/alunos/turmas`);
        const data = await r.json();
        turmasCache = Array.isArray(data) ? data : [];
    } catch {
        // Fallback: busca do alunos
        try {
            const r = await fetch(`${API}/alunos`);
            const alunos = await r.json();
            const turmasMap = {};
            (alunos || []).forEach(a => {
                if (a.codturma && a.descr_turma) turmasMap[a.codturma] = a.descr_turma;
            });
            turmasCache = Object.entries(turmasMap).map(([cod, nome]) => ({ cod_turma: parseInt(cod), descr_turma: nome }));
        } catch { turmasCache = []; }
    }
    renderFiltroTurma();
    renderImpTurma();
}

async function carregarConfig() {
    try {
        const r    = await fetch(`${API}/comunicados/config`);
        const data = await r.json();
        const temN8n = !!data.n8n_webhook_url;
        document.getElementById('alertaN8n').classList.toggle('oculto', temN8n);
        // Preenche modal de config
        document.getElementById('cfgWebhook').value  = data.n8n_webhook_url || '';
        document.getElementById('cfgToken').value    = data.comunicados_token || '';
        document.getElementById('cfgTemplate').value = data.msg_template || '';
    } catch { /* silencioso */ }
    // Endpoint de callback
    const base = location.origin;
    document.getElementById('cfgEndpoint').value = `${base}/api/comunicados/resposta`;
}

// ── Filtros e Abas ────────────────────────────────────────────────────

function trocarAba(aba) {
    abaAtual = aba;
    document.querySelectorAll('.aba').forEach(b => b.classList.remove('ativa'));
    document.querySelector(`.aba[data-aba="${aba}"]`).classList.add('ativa');
    selecionados.clear();
    aplicarFiltros();
}

function aplicarFiltros() {
    const busca  = document.getElementById('inputBusca').value.trim().toLowerCase();
    const turma  = document.getElementById('filtroTurma').value;
    const inicio = document.getElementById('filtroDataInicio').value;
    const fim    = document.getElementById('filtroDataFim').value;

    filtrados = todos.filter(c => {
        if (abaAtual !== 'todas' && c.status !== abaAtual) return false;
        if (busca  && !c.nome_aluno?.toLowerCase().includes(busca)) return false;
        if (turma  && String(c.cod_turma) !== turma) return false;
        if (inicio && c.data_falta < inicio) return false;
        if (fim    && c.data_falta > fim)    return false;
        return true;
    });

    renderTabela();
}

function limparFiltros() {
    document.getElementById('inputBusca').value   = '';
    document.getElementById('filtroTurma').value  = '';
    setDataDefault();
    aplicarFiltros();
}

function renderFiltroTurma() {
    const sel = document.getElementById('filtroTurma');
    sel.innerHTML = '<option value="">Todas as turmas</option>' +
        turmasCache.map(t => `<option value="${t.cod_turma}">${t.descr_turma}</option>`).join('');
}

function renderImpTurma() {
    const sel = document.getElementById('impTurma');
    sel.innerHTML = '<option value="">Selecione...</option>' +
        turmasCache.map(t => `<option value="${t.cod_turma}" data-nome="${t.descr_turma}">${t.descr_turma}</option>`).join('');
}

// ── Tabela ────────────────────────────────────────────────────────────

function renderTabela() {
    const tbody = document.getElementById('corpoTabela');
    document.getElementById('countTotal').textContent = `${filtrados.length} registro${filtrados.length !== 1 ? 's' : ''}`;
    document.getElementById('checkAll').checked = false;

    if (!filtrados.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum comunicado encontrado</td></tr>';
        atualizarBotaoEnviar();
        return;
    }

    tbody.innerHTML = filtrados.map(c => {
        const sel = selecionados.has(c.id);
        const dataFmt = c.data_falta ? new Date(c.data_falta + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
        const tel  = c.telefone ? `📱 ${formatarTel(c.telefone)}` : '<span class="sem-telefone">⚠️ Sem telefone</span>';
        const resp = c.resposta_texto
            ? `<div class="resp-texto">${escHtml(c.resposta_texto)}</div>`
            : (c.status === 'sem_resposta' ? '<span style="color:#6b7280;font-size:.78rem">Sem resposta</span>' : '—');

        const acoes = botoesAcao(c);

        return `<tr class="${sel ? 'selecionado' : ''}">
            <td class="th-check">
                <input type="checkbox" ${sel ? 'checked' : ''} onchange="toggleSel(${c.id}, this.checked)">
            </td>
            <td>
                <div class="td-nome">${escHtml(c.nome_aluno)}</div>
                ${c.num_chamada ? `<div class="td-turma">Nº ${c.num_chamada}</div>` : ''}
            </td>
            <td class="td-turma">${escHtml(c.descr_turma || '—')}</td>
            <td class="td-data">${dataFmt}</td>
            <td>${badgeStatus(c.status)}</td>
            <td>
                <div style="font-size:.82rem">${c.nome_responsavel ? escHtml(c.nome_responsavel) : '<span style="color:var(--text-muted)">—</span>'}</div>
                <div>${tel}</div>
            </td>
            <td class="td-resp">${resp}</td>
            <td><div class="acoes-cell">${acoes}</div></td>
        </tr>`;
    }).join('');

    atualizarBotaoEnviar();
}

function botoesAcao(c) {
    const btns = [];
    if (c.status === 'pendente' || c.status === 'enviado') {
        btns.push(`<button class="btn-ac enviar" onclick="enviarUm(${c.id})" title="Enviar via WhatsApp">📱</button>`);
    }
    if (c.status === 'respondido') {
        btns.push(`<button class="btn-ac aceitar" onclick="validarDireto(${c.id},true)" title="Aceitar justificativa">✅</button>`);
        btns.push(`<button class="btn-ac rejeitar" onclick="validarDireto(${c.id},false)" title="Rejeitar justificativa">❌</button>`);
    }
    btns.push(`<button class="btn-ac" onclick="abrirContato(${c.id})" title="Editar contato">✏️</button>`);
    btns.push(`<button class="btn-ac" onclick="abrirDetalhes(${c.id})" title="Ver detalhes">👁</button>`);
    btns.push(`<button class="btn-ac danger" onclick="excluir(${c.id})" title="Excluir">🗑</button>`);
    return btns.join('');
}

function badgeStatus(st) {
    const labels = { pendente:'Pendente', enviado:'Enviado', respondido:'Respondido',
        justificado:'Justificado', sem_resposta:'Sem resposta', cancelado:'Cancelado' };
    return `<span class="badge-st ${st}">${labels[st] || st}</span>`;
}

// ── Seleção ───────────────────────────────────────────────────────────

function toggleSel(id, checked) {
    checked ? selecionados.add(id) : selecionados.delete(id);
    atualizarBotaoEnviar();
    document.querySelectorAll('#corpoTabela tr').forEach((tr, i) => {
        if (filtrados[i] && filtrados[i].id === id) {
            tr.classList.toggle('selecionado', checked);
        }
    });
}

function toggleTodos(checked) {
    selecionados.clear();
    if (checked) filtrados.forEach(c => selecionados.add(c.id));
    renderTabela();
}

function atualizarBotaoEnviar() {
    const n = selecionados.size;
    document.getElementById('btnEnviarSel').disabled = n === 0;
    document.getElementById('countSel').textContent  = `${n} selecionado${n !== 1 ? 's' : ''}`;
}

// ── Enviar ────────────────────────────────────────────────────────────

async function enviarUm(id) {
    await enviarIds([id]);
}

async function enviarSelecionados() {
    if (!selecionados.size) return;
    await enviarIds([...selecionados]);
}

async function enviarIds(ids) {
    try {
        const r    = await fetch(`${API}/comunicados/enviar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        const data = await r.json();
        if (!r.ok) return mostrarToast(data.erro || 'Erro ao enviar', 'error');

        const ok   = (data.resultados || []).filter(x => x.ok).length;
        const fail = (data.resultados || []).filter(x => !x.ok).length;

        let msg = `✅ ${ok} enviado${ok !== 1 ? 's' : ''}`;
        if (data.sem_n8n) msg += ' (modo simulado — configure N8n)';
        if (fail) msg += ` · ${fail} sem telefone`;
        mostrarToast(msg);
        selecionados.clear();
        await Promise.all([carregarStats(), carregarComunicados()]);
    } catch { mostrarToast('Erro de conexão', 'error'); }
}

async function reenviarSemResposta() {
    const semResposta = filtrados.filter(c => c.status === 'enviado');
    if (!semResposta.length) return mostrarToast('⚠️ Nenhum comunicado enviado sem resposta', 'warn');
    if (!await confirmar('Reenviar comunicados?', `Reenviar para ${semResposta.length} responsável(is) sem resposta?`)) return;
    await enviarIds(semResposta.map(c => c.id));
}

// ── Validar ───────────────────────────────────────────────────────────

async function validarDireto(id, valida) {
    try {
        const r = await fetch(`${API}/comunicados/${id}/validar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ justificativa_valida: valida })
        });
        if (!r.ok) { const d = await r.json(); return mostrarToast(d.erro, 'error'); }
        mostrarToast(valida ? '✅ Justificativa aceita' : '❌ Justificativa rejeitada');
        await Promise.all([carregarStats(), carregarComunicados()]);
    } catch { mostrarToast('Erro', 'error'); }
}

// ── Excluir ───────────────────────────────────────────────────────────

async function excluir(id) {
    if (!await confirmar('Excluir comunicado?', 'Excluir este comunicado?', { confirmLabel: 'Excluir', tipo: 'danger' })) return;
    try {
        await fetch(`${API}/comunicados/${id}`, { method: 'DELETE' });
        mostrarToast('Excluído');
        await Promise.all([carregarStats(), carregarComunicados()]);
    } catch { mostrarToast('Erro', 'error'); }
}

// ── Modal: Detalhes ───────────────────────────────────────────────────

function abrirDetalhes(id) {
    detAtual = filtrados.find(c => c.id === id);
    if (!detAtual) return;

    const c = detAtual;
    const dataFmt = c.data_falta ? new Date(c.data_falta + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
    const enviado = c.enviado_em ? `${formatHora(c.enviado_em)} de ${new Date(c.enviado_em).toLocaleDateString('pt-BR')}` : '—';
    const respondido = c.resposta_em ? `${formatHora(c.resposta_em)} de ${new Date(c.resposta_em).toLocaleDateString('pt-BR')}` : '—';

    let html = `<div class="det-section">
        <div class="det-linha"><span class="det-label">Aluno</span><span class="det-val"><strong>${escHtml(c.nome_aluno)}</strong>${c.num_chamada ? ` — Nº ${c.num_chamada}` : ''}</span></div>
        <div class="det-linha"><span class="det-label">Turma</span><span class="det-val">${escHtml(c.descr_turma || '—')}</span></div>
        <div class="det-linha"><span class="det-label">Data da falta</span><span class="det-val">${dataFmt}</span></div>
        <div class="det-linha"><span class="det-label">Responsável</span><span class="det-val">${escHtml(c.nome_responsavel || '—')}</span></div>
        <div class="det-linha"><span class="det-label">Telefone</span><span class="det-val">${c.telefone ? formatarTel(c.telefone) : '<span style="color:#dc2626">Não cadastrado</span>'}</span></div>
        <div class="det-linha"><span class="det-label">Status</span><span class="det-val">${badgeStatus(c.status)}</span></div>
        <div class="det-linha"><span class="det-label">Enviado em</span><span class="det-val">${enviado}</span></div>
    </div>`;

    if (c.resposta_texto) {
        const tipoLabel = { doenca:'Doença', consulta:'Consulta médica', viagem:'Viagem', outro:'Outro', nao_justificado:'Não justificado' };
        html += `<div class="resp-box">
            <div class="resp-box-titulo">💬 Resposta do responsável — ${respondido}</div>
            <div class="resp-box-texto">${escHtml(c.resposta_texto)}</div>
            ${c.tipo_justificativa ? `<div style="margin-top:8px;font-size:.8rem;color:var(--text-muted)">Tipo: ${tipoLabel[c.tipo_justificativa] || c.tipo_justificativa}</div>` : ''}
        </div>`;

        if (c.status === 'respondido') {
            html += `<div>
                <div style="font-size:.82rem;font-weight:600;color:var(--text-muted);margin-bottom:8px">Classificar justificativa:</div>
                <select id="detTipoJust" class="input-form tipo-just-select">
                    <option value="">Selecione o tipo</option>
                    <option value="doenca">Doença</option>
                    <option value="consulta">Consulta médica</option>
                    <option value="viagem">Viagem/compromisso</option>
                    <option value="outro">Outro</option>
                    <option value="nao_justificado">Não justificado</option>
                </select>
                <div class="valid-acoes" style="margin-top:10px">
                    <button class="btn-aceitar-valid" onclick="validarModal(true)">✅ Aceitar justificativa</button>
                    <button class="btn-rejeitar-valid" onclick="validarModal(false)">❌ Rejeitar</button>
                </div>
            </div>`;
        }
    }

    if (c.justificativa_valida !== null && c.justificativa_valida !== undefined) {
        html += `<div class="det-linha">
            <span class="det-label">Validação</span>
            <span class="det-val">
                <span class="badge-just ${c.justificativa_valida ? 'valida' : 'invalida'}">
                    ${c.justificativa_valida ? '✅ Aceita' : '❌ Rejeitada'}
                </span>
                ${c.validado_em ? `<span style="font-size:.75rem;color:var(--text-muted);margin-left:8px">em ${new Date(c.validado_em).toLocaleDateString('pt-BR')}</span>` : ''}
            </span>
        </div>`;
    }

    if (c.obs) {
        html += `<div class="det-linha"><span class="det-label">Observação</span><span class="det-val">${escHtml(c.obs)}</span></div>`;
    }

    document.getElementById('detTitulo').textContent = `Comunicado — ${c.nome_aluno}`;
    document.getElementById('detCorpo').innerHTML = html;
    document.getElementById('modalDetalhes').classList.remove('oculto');
}

async function validarModal(valida) {
    if (!detAtual) return;
    const tipo = document.getElementById('detTipoJust')?.value || null;
    try {
        const r = await fetch(`${API}/comunicados/${detAtual.id}/validar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ justificativa_valida: valida, tipo_justificativa: tipo })
        });
        if (!r.ok) { const d = await r.json(); return mostrarToast(d.erro, 'error'); }
        mostrarToast(valida ? '✅ Justificativa aceita' : '❌ Rejeitada');
        fecharModal('modalDetalhes');
        await Promise.all([carregarStats(), carregarComunicados()]);
    } catch { mostrarToast('Erro', 'error'); }
}

// ── Modal: Contato ────────────────────────────────────────────────────

async function abrirContato(id) {
    contatoAtual = filtrados.find(c => c.id === id);
    if (!contatoAtual) return;
    document.getElementById('contatoCod').value   = contatoAtual.cod_matriz_aluno;
    document.getElementById('contatoNome').value  = contatoAtual.nome_responsavel || '';
    document.getElementById('contatoTel').value   = contatoAtual.telefone || '';
    document.getElementById('contatoEmail').value = '';
    // Busca dados mais completos
    try {
        const r = await fetch(`${API}/responsaveis/${contatoAtual.cod_matriz_aluno}`);
        const d = await r.json();
        if (d) {
            document.getElementById('contatoNome').value  = d.nome_responsavel || contatoAtual.nome_responsavel || '';
            document.getElementById('contatoTel').value   = d.telefone || contatoAtual.telefone || '';
            document.getElementById('contatoEmail').value = d.email || '';
        }
    } catch { /* silencioso */ }
    document.getElementById('modalContato').classList.remove('oculto');
}

async function salvarContato() {
    const cod   = document.getElementById('contatoCod').value;
    const nome  = document.getElementById('contatoNome').value.trim();
    const tel   = document.getElementById('contatoTel').value.replace(/\D/g, '');
    const email = document.getElementById('contatoEmail').value.trim();

    if (!tel && !email) return mostrarToast('⚠️ Informe telefone ou e-mail', 'warn');

    try {
        const r = await fetch(`${API}/responsaveis/${cod}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome_responsavel: nome, telefone: tel, email })
        });
        if (!r.ok) { const d = await r.json(); return mostrarToast(d.erro, 'error'); }

        // Atualiza o comunicado em aberto com o novo telefone
        if (contatoAtual) {
            await fetch(`${API}/comunicados/${contatoAtual.id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: contatoAtual.status, manter_data: true })
            });
            // Atualiza o telefone diretamente via PUT no comunicado
            await fetch(`${API}/comunicados/${contatoAtual.id}/contato`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telefone: tel, nome_responsavel: nome })
            }).catch(() => {});
        }

        mostrarToast('✅ Contato salvo');
        fecharModal('modalContato');
        await carregarComunicados();
    } catch { mostrarToast('Erro ao salvar', 'error'); }
}

// ── Modal: Importar Faltas ────────────────────────────────────────────

function abrirModalImportar() {
    const hoje = dataHojeBrasilia();
    document.getElementById('impData').value = hoje;
    document.getElementById('impListaAlunos').innerHTML = '<div class="imp-hint">Selecione turma e data para ver os alunos.</div>';
    document.getElementById('impCountSel').textContent  = '0 alunos selecionados';
    document.getElementById('btnGerar').disabled = true;
    document.getElementById('modalImportar').classList.remove('oculto');
}

async function carregarAlunosImportar() {
    const codTurma = document.getElementById('impTurma').value;
    if (!codTurma) return;

    const cont = document.getElementById('impListaAlunos');
    cont.innerHTML = '<div class="imp-hint"><div class="spinner"></div> Carregando alunos...</div>';

    if (!alunosCache[codTurma]) {
        try {
            const r = await fetch(`${API}/alunos?codturma=${codTurma}`);
            const data = await r.json();
            alunosCache[codTurma] = Array.isArray(data)
                ? data.sort((a, b) => (a.num_chamada || 0) - (b.num_chamada || 0))
                : [];
        } catch { alunosCache[codTurma] = []; }
    }

    const alunos = alunosCache[codTurma];
    if (!alunos.length) {
        cont.innerHTML = '<div class="imp-hint">Nenhum aluno encontrado nesta turma.</div>';
        return;
    }

    const nomeTurma = document.getElementById('impTurma').selectedOptions[0]?.text || '';
    cont.innerHTML = `
        <div class="imp-alunos-header">
            <label>
                <input type="checkbox" id="checkTodosImp" onchange="toggleTodosImp(this.checked)">
                Selecionar todos
            </label>
            <span style="flex:1;text-align:right;font-size:.75rem">${alunos.length} alunos</span>
        </div>
        ${alunos.map(a => {
            const cod  = a.codmatrizaluno || a.id;
            const nome = a.nome || `#${cod}`;
            const num  = a.numchamada || '';
            const tel  = a.telefone || '';
            return `<div class="imp-item" onclick="toggleImpAluno(${cod})">
                <input type="checkbox" id="imp-${cod}" value="${cod}"
                    data-nome="${escAttr(nome)}"
                    data-num="${num}"
                    data-turma="${a.codturma || codTurma}"
                    data-turmanome="${escAttr(nomeTurma)}"
                    onchange="atualizarContImp()" onclick="event.stopPropagation()">
                <span class="imp-num">${num || '—'}</span>
                <span class="imp-nome">${escHtml(nome)}</span>
                <span class="imp-tel ${tel ? '' : 'sem-tel'}">${tel ? '📱' : '⚠️ Sem tel.'}</span>
            </div>`;
        }).join('')}`;

    atualizarContImp();
}

function toggleTodosImp(checked) {
    document.querySelectorAll('#impListaAlunos input[type="checkbox"]:not(#checkTodosImp)')
        .forEach(cb => { cb.checked = checked; });
    atualizarContImp();
}

function toggleImpAluno(cod) {
    const cb = document.getElementById(`imp-${cod}`);
    if (cb) { cb.checked = !cb.checked; atualizarContImp(); }
}

function atualizarContImp() {
    const sel = document.querySelectorAll('#impListaAlunos input[type="checkbox"]:not(#checkTodosImp):checked').length;
    document.getElementById('impCountSel').textContent = `${sel} aluno${sel !== 1 ? 's' : ''} selecionado${sel !== 1 ? 's' : ''}`;
    document.getElementById('btnGerar').disabled = sel === 0;
}

async function gerarComunicados() {
    const data = document.getElementById('impData').value;
    if (!data) return mostrarToast('⚠️ Selecione uma data', 'warn');

    const checks = document.querySelectorAll('#impListaAlunos input[type="checkbox"]:not(#checkTodosImp):checked');
    const faltas = [];
    checks.forEach(cb => {
        faltas.push({
            cod_matriz_aluno: parseInt(cb.value),
            nome_aluno:       cb.dataset.nome,
            num_chamada:      parseInt(cb.dataset.num) || null,
            cod_turma:        parseInt(cb.dataset.turma) || null,
            descr_turma:      cb.dataset.turmanome || null,
            data_falta:       data,
        });
    });

    if (!faltas.length) return mostrarToast('⚠️ Selecione ao menos um aluno', 'warn');

    try {
        const r = await fetch(`${API}/comunicados/gerar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ faltas })
        });
        const d = await r.json();
        if (!r.ok) return mostrarToast(d.erro || 'Erro', 'error');
        mostrarToast(`✅ ${d.criados || faltas.length} comunicado(s) gerado(s)`);
        fecharModal('modalImportar');
        await Promise.all([carregarStats(), carregarComunicados()]);
    } catch { mostrarToast('Erro', 'error'); }
}

// ── Modal: Configuração N8n ───────────────────────────────────────────

function abrirModalConfig() {
    document.getElementById('modalConfig').classList.remove('oculto');
    carregarConfig();
}

function gerarToken() {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    document.getElementById('cfgToken').value = token;
}

function copiarEndpoint() {
    const val = document.getElementById('cfgEndpoint').value;
    navigator.clipboard.writeText(val).then(() => mostrarToast('✅ Copiado!'));
}

async function salvarConfig() {
    const webhook  = document.getElementById('cfgWebhook').value.trim();
    const token    = document.getElementById('cfgToken').value.trim();
    const template = document.getElementById('cfgTemplate').value.trim();
    try {
        const r = await fetch(`${API}/comunicados/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ n8n_webhook_url: webhook, comunicados_token: token, msg_template: template })
        });
        if (!r.ok) { const d = await r.json(); return mostrarToast(d.erro, 'error'); }
        mostrarToast('✅ Configuração salva');
        fecharModal('modalConfig');
        await carregarConfig();
    } catch { mostrarToast('Erro ao salvar', 'error'); }
}

// ── Helpers de modal ──────────────────────────────────────────────────

function fecharModal(id) {
    document.getElementById(id).classList.add('oculto');
}

function fecharModalSeOverlay(e, id) {
    if (e.target === document.getElementById(id)) fecharModal(id);
}

// ── Utilitários ───────────────────────────────────────────────────────

function formatarTel(tel) {
    if (!tel) return '—';
    const t = tel.replace(/\D/g, '');
    if (t.length === 11) return `(${t.slice(0,2)}) ${t.slice(2,7)}-${t.slice(7)}`;
    if (t.length === 10) return `(${t.slice(0,2)}) ${t.slice(2,6)}-${t.slice(6)}`;
    return tel;
}

function formatHora(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) { return escHtml(s).replace(/'/g,'&#39;'); }

function mostrarToast(msg, tipo) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${tipo || ''}`;
    setTimeout(() => t.classList.remove('show'), 3200);
}
