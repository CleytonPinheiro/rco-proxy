const elBusca = document.getElementById('solBusca');
const elStatus = document.getElementById('solStatus');
const elLista = document.getElementById('solLista');
const elInfo = document.getElementById('solInfo');

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toast(msg, tipo, dur) {
    if (typeof window.toast === 'function') { window.toast(msg, tipo, dur); return; }
    alert(msg);
}

async function carregar() {
    const status = elStatus.value;
    const busca = elBusca.value.trim();

    const params = new URLSearchParams();
    if (status) params.set('status', status);

    elLista.innerHTML = '<div class="sol-empty">Carregando…</div>';
    elInfo.style.display = 'none';

    try {
        const res = await fetch(`/api/classroom/solicitacoes?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const data = await res.json();
        renderizar(data.solicitacoes || [], busca);
    } catch (e) {
        elLista.innerHTML = `<div class="sol-empty" style="color:var(--danger,#dc2626)">Erro: ${e.message}</div>`;
    }
}

function renderizar(lista, filtroTexto) {
    const q = (filtroTexto || '').toLowerCase().trim();
    const filtrada = q
        ? lista.filter(s => (s.aluno_nome || '').toLowerCase().includes(q)
                        || (s.aluno_email || '').toLowerCase().includes(q)
                        || (s.coursework_titulo || '').toLowerCase().includes(q)
                        || (s.curso_nome || '').toLowerCase().includes(q))
        : lista;

    if (!filtrada.length) {
        elLista.innerHTML = '<div class="sol-empty">Nenhuma solicitação encontrada.</div>';
        elInfo.style.display = 'none';
        return;
    }

    elInfo.textContent = `${filtrada.length} solicitação${filtrada.length !== 1 ? 'ões' : ''}`;
    elInfo.style.display = '';

    const fmt = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const statusLabel = { pendente: '⏳ Pendente', aprovada: '✅ Aprovada', negada: '❌ Negada' };
    const statusCls   = { pendente: 'pendente', aprovada: 'aprovada', negada: 'negada' };

    elLista.innerHTML = filtrada.map(s => `
        <div class="sol-card" data-id="${s.id}">
            <div class="sol-card-header">
                <div class="sol-aluno">
                    <span class="sol-nome">${esc(s.aluno_nome || s.aluno_email)}</span>
                    <span class="sol-email">${esc(s.aluno_email)}</span>
                </div>
                <span class="sol-status sol-status--${statusCls[s.status] || ''}">${statusLabel[s.status] || s.status}</span>
            </div>
            <div class="sol-ativ">
                <span class="sol-disciplina">${esc(s.curso_nome || '—')}</span>
                <span class="sol-sep">›</span>
                <span>${esc(s.coursework_titulo || '—')}</span>
                ${s.submission_link ? `<a href="${esc(s.submission_link)}" target="_blank" class="sol-link" title="Ver no Classroom">↗</a>` : ''}
            </div>
            ${s.justificativa ? `<div class="sol-justi">"${esc(s.justificativa)}"</div>` : ''}
            ${s.resposta      ? `<div class="sol-resposta">Resposta: ${esc(s.resposta)}</div>` : ''}
            <div class="sol-footer">
                <span class="sol-data">Solicitado em ${fmt(s.criado_em)}</span>
                ${s.respondido_em ? `<span class="sol-data">Respondido em ${fmt(s.respondido_em)}</span>` : ''}
                ${s.status === 'pendente' ? `
                <div class="sol-acoes">
                    <button class="sol-btn sol-btn--sm sol-btn--primary" onclick="responder(${s.id},'aprovar')">✅ Aprovar</button>
                    <button class="sol-btn sol-btn--sm sol-btn--danger" onclick="responder(${s.id},'negar')">❌ Negar</button>
                </div>` : ''}
            </div>
        </div>`).join('');
}

window.responder = async function(id, acao) {
    let resposta = null;
    if (acao === 'negar') {
        resposta = prompt('Motivo da negativa (opcional):');
        if (resposta === null) return;
    }
    const card = elLista.querySelector(`[data-id="${id}"]`);
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
elBusca.addEventListener('input', () => carregar());
elStatus.addEventListener('change', () => carregar());

carregar();
