const elBusca  = document.getElementById('solBusca');
const elStatus = document.getElementById('solStatus');
const elLista  = document.getElementById('solLista');
const elInfo   = document.getElementById('solInfo');
const elCntP   = document.getElementById('solCountPendente');
const elCntA   = document.getElementById('solCountAprovada');
const elCntN   = document.getElementById('solCountNegada');

let allData = [];
const collapsedTurmas = new Set();
const selecionados    = new Set();

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toast(msg, tipo, dur) {
    const el = document.getElementById('solToast');
    if (!el) { alert(msg); return; }
    clearTimeout(toast._t);
    el.textContent = msg;
    el.className = 'sol-toast sol-toast--visivel' + (tipo ? ' sol-toast--' + tipo : '');
    toast._t = setTimeout(() => el.classList.remove('sol-toast--visivel'), dur || 3500);
}

async function carregar() {
    elLista.innerHTML = '<div class="sol-empty">Carregando…</div>';
    elInfo.style.display = 'none';
    selecionados.clear();

    try {
        const res = await fetch('/api/classroom/solicitacoes', { credentials: 'include' });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const data = await res.json();
        allData = data.solicitacoes || [];
        atualizarStats();
        renderizar();
    } catch (e) {
        elLista.innerHTML = `<div class="sol-empty" style="color:var(--danger,#dc2626)">Erro: ${e.message}</div>`;
    }
}

function atualizarStats() {
    const p = allData.filter(s => s.status === 'pendente').length;
    const a = allData.filter(s => s.status === 'aprovada').length;
    const n = allData.filter(s => s.status === 'negada').length;
    elCntP.textContent = p;
    elCntA.textContent = a;
    elCntN.textContent = n;
}

function agruparPorTurma(lista) {
    const map = new Map();

    lista.forEach(s => {
        const turma = s.curso_nome || 'Sem turma';
        if (!map.has(turma)) map.set(turma, []);
        map.get(turma).push(s);
    });

    const result = [];
    for (const [turma, items] of map) {
        items.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
        result.push({ turma, items });
    }
    result.sort((a, b) => a.turma.localeCompare(b.turma, 'pt-BR'));
    return result;
}

const fmtHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', {
    hour: '2-digit', minute: '2-digit'
}) : '';
const fmtFull = iso => iso ? new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
}) : '—';
const fmtData = iso => iso ? new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit'
}) : '';

const STATUS_ICON  = { pendente: '⏳', aprovada: '✅', negada: '❌' };
const STATUS_LABEL = { pendente: 'Pendente', aprovada: 'Aprovada', negada: 'Negada' };

function cardHtml(s) {
    const cls  = s.status;
    const icon = STATUS_ICON[s.status] || '•';
    const isPend = s.status === 'pendente';
    const checked = selecionados.has(s.id) ? 'checked' : '';
    const checkboxHtml = isPend
        ? `<input type="checkbox" class="sol-check" data-id="${s.id}" ${checked} title="Selecionar para ação em lote">`
        : '';
    return `
        <div class="sol-tl-item" data-id="${s.id}">
            <div class="sol-tl-dot sol-tl-dot--${cls}">${icon}</div>
            <div class="sol-card sol-card--${cls}">
                <div class="sol-card-header">
                    <div class="sol-aluno">
                        ${checkboxHtml}
                        <span class="sol-nome">${esc(s.aluno_nome || s.aluno_email)}</span>
                        <span class="sol-email">${esc(s.aluno_email)}</span>
                    </div>
                    <span class="sol-status sol-status--${cls}">${STATUS_LABEL[s.status] || s.status}</span>
                </div>
                <div class="sol-ativ">
                    <span class="sol-disciplina">${esc(s.coursework_titulo || '—')}</span>
                    ${s.submission_link ? `<a href="${esc(s.submission_link)}" target="_blank" class="sol-link" title="Ver no Classroom">↗</a>` : ''}
                </div>
                ${s.justificativa ? `<div class="sol-justi">"${esc(s.justificativa)}"</div>` : ''}
                ${s.resposta ? `<div class="sol-resposta">💬 ${esc(s.resposta)}</div>` : ''}
                <div class="sol-footer">
                    <span class="sol-time"><span class="sol-time-icon">🕐</span> ${fmtData(s.criado_em)} ${fmtHora(s.criado_em)}</span>
                    ${s.respondido_em ? `<span class="sol-time"><span class="sol-time-icon">✔</span> Respondido ${fmtFull(s.respondido_em)}</span>` : ''}
                    ${isPend ? `
                    <div class="sol-acoes">
                        <button class="sol-btn sol-btn--sm sol-btn--primary" onclick="responder(${s.id},'aprovar')">✅ Aprovar</button>
                        <button class="sol-btn sol-btn--sm sol-btn--danger" onclick="responder(${s.id},'negar')">❌ Negar</button>
                    </div>` : ''}
                    ${s.status === 'aprovada' && s.submission_link ? `
                    <a href="${esc(s.submission_link)}" target="_blank" class="sol-btn sol-btn--sm sol-btn--outline sol-btn--classroom">📎 Abrir no Classroom</a>` : ''}
                </div>
            </div>
        </div>`;
}

function renderizar() {
    const statusFiltro = elStatus.value;
    const q = (elBusca.value || '').toLowerCase().trim();

    let filtrada = allData;
    if (statusFiltro) filtrada = filtrada.filter(s => s.status === statusFiltro);
    if (q) filtrada = filtrada.filter(s =>
        (s.aluno_nome || '').toLowerCase().includes(q) ||
        (s.aluno_email || '').toLowerCase().includes(q) ||
        (s.coursework_titulo || '').toLowerCase().includes(q) ||
        (s.curso_nome || '').toLowerCase().includes(q)
    );

    if (!filtrada.length) {
        elLista.innerHTML = '<div class="sol-empty">Nenhuma solicitação encontrada.</div>';
        elInfo.style.display = 'none';
        atualizarBarraSelecao();
        return;
    }

    elInfo.textContent = `${filtrada.length} solicitaç${filtrada.length !== 1 ? 'ões' : 'ão'}`;
    elInfo.style.display = '';

    const grupos = agruparPorTurma(filtrada);

    let html = '';
    for (const { turma, items } of grupos) {
        const pendentes = items.filter(i => i.status === 'pendente').length;
        const idsPendTurma = items.filter(i => i.status === 'pendente').map(i => i.id);
        const todasMarcadas = idsPendTurma.length > 0 && idsPendTurma.every(id => selecionados.has(id));
        const badgeCount = pendentes > 0 ? `<span class="sol-turma-count">${pendentes} pendente${pendentes > 1 ? 's' : ''}</span>` : '';
        const collapsed = collapsedTurmas.has(turma);
        const chevron = collapsed ? '▶' : '▼';
        const selAllHtml = pendentes > 0
            ? `<label class="sol-sel-turma" title="Selecionar todas pendentes desta turma" onclick="event.stopPropagation()">
                 <input type="checkbox" class="sol-check-turma" data-turma="${esc(turma)}" ${todasMarcadas ? 'checked' : ''}>
                 <span>Selecionar tudo</span>
               </label>` : '';
        html += `<div class="sol-day-group${collapsed ? ' sol-group--collapsed' : ''}">`;
        html += `<div class="sol-day-label sol-day-label--toggle" data-turma="${esc(turma)}"><span class="sol-chevron">${chevron}</span> 📚 ${esc(turma)} ${badgeCount} ${selAllHtml}</div>`;
        html += `<div class="sol-group-items"${collapsed ? ' style="display:none"' : ''}>`;
        items.forEach(s => { html += cardHtml(s); });
        html += `</div></div>`;
    }

    elLista.innerHTML = html;

    elLista.querySelectorAll('.sol-day-label--toggle').forEach(label => {
        label.addEventListener('click', () => {
            const turma = label.dataset.turma;
            if (collapsedTurmas.has(turma)) collapsedTurmas.delete(turma);
            else collapsedTurmas.add(turma);
            renderizar();
        });
    });

    elLista.querySelectorAll('.sol-check').forEach(cb => {
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
            const id = Number(cb.dataset.id);
            if (cb.checked) selecionados.add(id);
            else selecionados.delete(id);
            atualizarBarraSelecao();
            atualizarSelTurmaCheckboxes();
        });
    });

    elLista.querySelectorAll('.sol-check-turma').forEach(cb => {
        cb.addEventListener('change', () => {
            const turma = cb.dataset.turma;
            const idsPend = allData
                .filter(s => (s.curso_nome || 'Sem turma') === turma && s.status === 'pendente')
                .map(s => s.id);
            if (cb.checked) idsPend.forEach(id => selecionados.add(id));
            else            idsPend.forEach(id => selecionados.delete(id));
            renderizar();
            atualizarBarraSelecao();
        });
    });

    atualizarBarraSelecao();
}

function atualizarSelTurmaCheckboxes() {
    elLista.querySelectorAll('.sol-check-turma').forEach(cb => {
        const turma = cb.dataset.turma;
        const idsPend = allData
            .filter(s => (s.curso_nome || 'Sem turma') === turma && s.status === 'pendente')
            .map(s => s.id);
        cb.checked = idsPend.length > 0 && idsPend.every(id => selecionados.has(id));
    });
}

/* ── Barra flutuante de ações em lote ─────────────────────────── */
function atualizarBarraSelecao() {
    let bar = document.getElementById('solBulkBar');
    const n = selecionados.size;
    if (n === 0) {
        if (bar) bar.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'solBulkBar';
        bar.className = 'sol-bulk-bar';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `
        <span class="sol-bulk-count">${n} selecionada${n > 1 ? 's' : ''}</span>
        <button class="sol-btn sol-btn--sm sol-btn--primary" id="solBulkAprovar">✅ Aprovar todas</button>
        <button class="sol-btn sol-btn--sm sol-btn--danger"  id="solBulkNegar">❌ Negar todas</button>
        <button class="sol-btn sol-btn--sm sol-btn--outline" id="solBulkLimpar">Limpar</button>
    `;
    document.getElementById('solBulkAprovar').onclick = () => bulkResponder('aprovar');
    document.getElementById('solBulkNegar').onclick   = () => bulkResponder('negar');
    document.getElementById('solBulkLimpar').onclick  = () => { selecionados.clear(); renderizar(); };
}

async function bulkResponder(acao) {
    const ids = [...selecionados];
    if (!ids.length) return;
    let resposta = null;
    if (acao === 'negar') {
        resposta = await solicitarTexto(
            'Negar solicitações',
            `Motivo da negação para ${ids.length} solicitação(ões) (opcional):`,
            '',
            { confirmLabel: 'Negar', icone: '❌', placeholder: 'Deixe em branco para não informar motivo' }
        );
        if (resposta === null) return;
        resposta = resposta.trim() || null;
    } else {
        if (!await confirmar('Aprovar solicitações?', `Aprovar ${ids.length} solicitação(ões) selecionada(s)?`, { confirmLabel: 'Aprovar' })) return;
    }

    /* Marca cards com opacidade reduzida */
    ids.forEach(id => {
        const card = elLista.querySelector(`[data-id="${id}"] .sol-card`);
        if (card) card.style.opacity = '.5';
    });

    try {
        const res = await fetch('/api/classroom/solicitacoes/bulk-responder', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, acao, resposta }),
        });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const data = await res.json();

        /* Atualiza in-place cada item afetado, sem recarregar */
        (data.resultados || []).forEach(r => {
            const idx = allData.findIndex(s => s.id === r.id);
            if (idx >= 0) allData[idx] = r.solicitacao;
        });
        selecionados.clear();
        atualizarStats();
        renderizar();

        const aprovadasCR = (data.resultados || []).filter(r => r.classroomReaberto).length;
        if (acao === 'aprovar') {
            toast(`✅ ${data.total} aprovada(s)${aprovadasCR ? ` — ${aprovadasCR} reaberta(s) no Classroom` : ''}.`, 'ok', 4500);
        } else {
            toast(`❌ ${data.total} solicitação(ões) negada(s).`, 'ok');
        }
    } catch (e) {
        ids.forEach(id => {
            const card = elLista.querySelector(`[data-id="${id}"] .sol-card`);
            if (card) card.style.opacity = '';
        });
        toast('Erro: ' + e.message, 'erro', 8000);
    }
}

const elNegarOverlay = document.getElementById('solNegarOverlay');
const elNegarMotivo  = document.getElementById('solNegarMotivo');
const elNegarOk      = document.getElementById('solNegarConfirmar');
const elNegarCancel  = document.getElementById('solNegarCancelar');

function abrirModalNegar(id) {
    elNegarMotivo.value = '';
    elNegarOverlay.classList.add('sol-modal-overlay--visivel');
    elNegarMotivo.focus();

    function fechar() {
        elNegarOverlay.classList.remove('sol-modal-overlay--visivel');
        elNegarOk.removeEventListener('click', onOk);
        elNegarCancel.removeEventListener('click', onCancel);
        elNegarOverlay.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
    }
    function onOk() { fechar(); executarResposta(id, 'negar', elNegarMotivo.value.trim() || null); }
    function onCancel() { fechar(); }
    function onBackdrop(e) { if (e.target === elNegarOverlay) fechar(); }
    function onKey(e) {
        if (e.key === 'Escape') fechar();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onOk(); }
    }

    elNegarOk.addEventListener('click', onOk);
    elNegarCancel.addEventListener('click', onCancel);
    elNegarOverlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
}

/* ── Atualiza apenas o card afetado, sem recarregar a lista inteira ── */
function atualizarItem(novaSol) {
    const idx = allData.findIndex(s => s.id === novaSol.id);
    if (idx < 0) return;
    allData[idx] = novaSol;
    selecionados.delete(novaSol.id);
    atualizarStats();

    const wrapper = elLista.querySelector(`.sol-tl-item[data-id="${novaSol.id}"]`);
    if (wrapper) {
        const tmp = document.createElement('div');
        tmp.innerHTML = cardHtml(novaSol).trim();
        const novo = tmp.firstElementChild;
        wrapper.replaceWith(novo);

        /* Re-anexa listeners no checkbox novo (se houver) */
        const cb = novo.querySelector('.sol-check');
        if (cb) {
            cb.addEventListener('click', e => e.stopPropagation());
            cb.addEventListener('change', () => {
                const id = Number(cb.dataset.id);
                if (cb.checked) selecionados.add(id);
                else selecionados.delete(id);
                atualizarBarraSelecao();
                atualizarSelTurmaCheckboxes();
            });
        }

        /* Atualiza badge da turma (contagem de pendentes) */
        const turma = novaSol.curso_nome || 'Sem turma';
        const label = elLista.querySelector(`.sol-day-label[data-turma="${CSS.escape(turma)}"]`);
        if (label) {
            const pendentes = allData.filter(s => (s.curso_nome || 'Sem turma') === turma && s.status === 'pendente').length;
            const cnt = label.querySelector('.sol-turma-count');
            if (cnt) {
                if (pendentes > 0) cnt.textContent = `${pendentes} pendente${pendentes > 1 ? 's' : ''}`;
                else cnt.remove();
            }
        }
    } else {
        renderizar();
    }
    atualizarBarraSelecao();
    atualizarSelTurmaCheckboxes();
}

async function executarResposta(id, acao, resposta) {
    const card = elLista.querySelector(`[data-id="${id}"] .sol-card`);
    if (card) card.style.opacity = '.5';
    try {
        const res = await fetch(`/api/classroom/solicitacoes/${id}/responder`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao, resposta: resposta || null }),
        });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const data = await res.json();

        if (acao === 'aprovar') {
            if (data.classroomReaberto) {
                toast('✅ Aprovada e reaberta no Classroom!', 'ok', 4000);
            } else {
                toast('✅ Aprovada! (verifique manualmente no Classroom)', 'ok', 5000);
            }
        } else {
            toast('❌ Solicitação negada.', 'ok');
        }

        if (data.solicitacao) atualizarItem(data.solicitacao);
        else carregar();
    } catch (e) {
        if (card) card.style.opacity = '';
        toast('Erro: ' + e.message, 'erro', 8000);
    }
}

window.responder = function(id, acao) {
    if (acao === 'negar') {
        abrirModalNegar(id);
    } else {
        executarResposta(id, 'aprovar', null);
    }
};

document.getElementById('solAtualizar').addEventListener('click', () => carregar());
elBusca.addEventListener('input', () => renderizar());
elStatus.addEventListener('change', () => renderizar());

carregar();
