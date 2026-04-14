const elBusca  = document.getElementById('solBusca');
const elStatus = document.getElementById('solStatus');
const elLista  = document.getElementById('solLista');
const elInfo   = document.getElementById('solInfo');
const elCntP   = document.getElementById('solCountPendente');
const elCntA   = document.getElementById('solCountAprovada');
const elCntN   = document.getElementById('solCountNegada');

let allData = [];

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toast(msg, tipo, dur) {
    if (typeof window.toast === 'function') { window.toast(msg, tipo, dur); return; }
    alert(msg);
}

async function carregar() {
    elLista.innerHTML = '<div class="sol-empty">Carregando…</div>';
    elInfo.style.display = 'none';

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

function agruparPorDia(lista) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);

    const map = new Map();

    lista.forEach(s => {
        const dt = new Date(s.criado_em);
        dt.setHours(0, 0, 0, 0);
        const key = dt.toISOString().slice(0, 10);
        let label;
        if (dt.getTime() === hoje.getTime()) {
            label = 'Hoje';
        } else if (dt.getTime() === ontem.getTime()) {
            label = 'Ontem';
        } else {
            label = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        }
        if (!map.has(key)) map.set(key, { label, items: [] });
        map.get(key).items.push(s);
    });

    const sorted = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const result = [];
    sorted.forEach(([, v]) => result.push(v));
    return result;
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

    filtrada.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));

    if (!filtrada.length) {
        elLista.innerHTML = '<div class="sol-empty">Nenhuma solicitação encontrada.</div>';
        elInfo.style.display = 'none';
        return;
    }

    elInfo.textContent = `${filtrada.length} solicitação${filtrada.length !== 1 ? 'ões' : ''}`;
    elInfo.style.display = '';

    const grupos = agruparPorDia(filtrada);
    const statusIcon = { pendente: '⏳', aprovada: '✅', negada: '❌' };
    const statusLabel = { pendente: 'Pendente', aprovada: 'Aprovada', negada: 'Negada' };
    const statusCls   = { pendente: 'pendente', aprovada: 'aprovada', negada: 'negada' };

    const fmtHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', {
        hour: '2-digit', minute: '2-digit'
    }) : '';
    const fmtFull = iso => iso ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
    }) : '—';

    let html = '';
    for (const { label, items } of grupos) {
        html += `<div class="sol-day-group">`;
        html += `<div class="sol-day-label">${esc(label)}</div>`;
        items.forEach(s => {
            const cls = statusCls[s.status] || '';
            const icon = statusIcon[s.status] || '•';
            html += `
            <div class="sol-tl-item" data-id="${s.id}">
                <div class="sol-tl-dot sol-tl-dot--${cls}">${icon}</div>
                <div class="sol-card sol-card--${cls}">
                    <div class="sol-card-header">
                        <div class="sol-aluno">
                            <span class="sol-nome">${esc(s.aluno_nome || s.aluno_email)}</span>
                            <span class="sol-email">${esc(s.aluno_email)}</span>
                        </div>
                        <span class="sol-status sol-status--${cls}">${statusLabel[s.status] || s.status}</span>
                    </div>
                    <div class="sol-ativ">
                        <span class="sol-disciplina">${esc(s.curso_nome || '—')}</span>
                        <span class="sol-sep">›</span>
                        <span>${esc(s.coursework_titulo || '—')}</span>
                        ${s.submission_link ? `<a href="${esc(s.submission_link)}" target="_blank" class="sol-link" title="Ver no Classroom">↗</a>` : ''}
                    </div>
                    ${s.justificativa ? `<div class="sol-justi">"${esc(s.justificativa)}"</div>` : ''}
                    ${s.resposta ? `<div class="sol-resposta">💬 ${esc(s.resposta)}</div>` : ''}
                    <div class="sol-footer">
                        <span class="sol-time"><span class="sol-time-icon">🕐</span> ${fmtHora(s.criado_em)}</span>
                        ${s.respondido_em ? `<span class="sol-time"><span class="sol-time-icon">✔</span> Respondido ${fmtFull(s.respondido_em)}</span>` : ''}
                        ${s.status === 'pendente' ? `
                        <div class="sol-acoes">
                            <button class="sol-btn sol-btn--sm sol-btn--primary" onclick="responder(${s.id},'aprovar')">✅ Aprovar</button>
                            <button class="sol-btn sol-btn--sm sol-btn--danger" onclick="responder(${s.id},'negar')">❌ Negar</button>
                        </div>` : ''}
                    </div>
                </div>
            </div>`;
        });
        html += `</div>`;
    }

    elLista.innerHTML = html;
}

window.responder = async function(id, acao) {
    let resposta = null;
    if (acao === 'negar') {
        resposta = prompt('Motivo da negativa (opcional):');
        if (resposta === null) return;
    }
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
        toast(acao === 'aprovar' ? '✅ Solicitação aprovada!' : '❌ Solicitação negada.', 'ok');
        carregar();
    } catch (e) {
        if (card) card.style.opacity = '';
        toast('Erro: ' + e.message, 'erro', 8000);
    }
};

document.getElementById('solAtualizar').addEventListener('click', () => carregar());
elBusca.addEventListener('input', () => renderizar());
elStatus.addEventListener('change', () => renderizar());

carregar();
