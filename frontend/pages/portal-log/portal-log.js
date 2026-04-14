const POR_PAG = 30;
let pagina = 0;
let total = 0;

const ACOES_LABEL = {
    LOGIN: 'Login',
    LOGOUT: 'Logout',
    SOLICITAR_REABERTURA: 'Solicitação de reabertura',
    NOTIF_LIDA: 'Notificação lida',
    VER_NOTAS: 'Ver notas',
    VER_FREQUENCIA: 'Ver frequência',
    ALTERAR_TEMA: 'Alterar tema',
};

const ACOES_BADGE = {
    LOGIN: 'login',
    LOGOUT: 'logout',
    SOLICITAR_REABERTURA: 'solicitar',
    NOTIF_LIDA: 'notif',
};

const elBusca = document.getElementById('plBusca');
const elAcao = document.getElementById('plAcao');
const elLista = document.getElementById('plLista');
const elInfo = document.getElementById('plInfo');
const elPag = document.getElementById('plPaginacao');
const elPagInfo = document.getElementById('plPagInfo');
const elPrev = document.getElementById('plPrev');
const elNext = document.getElementById('plNext');

async function carregar(resetar = true) {
    if (resetar) pagina = 0;

    const busca = elBusca.value.trim();
    const acao = elAcao.value;

    const params = new URLSearchParams({ limite: POR_PAG, offset: pagina * POR_PAG });
    if (busca) params.set('busca', busca);
    if (acao) params.set('acao', acao);

    elLista.innerHTML = '<div class="pl-empty">Carregando…</div>';
    elInfo.style.display = 'none';
    elPag.style.display = 'none';

    try {
        const res = await fetch(`/api/admin/portal-aluno/audit-log?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const data = await res.json();
        total = data.total;
        renderLogs(data.logs);
        renderPaginacao();
    } catch (e) {
        elLista.innerHTML = `<div class="pl-empty" style="color:var(--danger,#dc2626)">Erro: ${e.message}</div>`;
    }
}

function renderLogs(logs) {
    if (!logs.length) {
        elLista.innerHTML = '<div class="pl-empty">Nenhum registro encontrado.</div>';
        return;
    }

    const inicio = pagina * POR_PAG + 1;
    const fim = Math.min(inicio + logs.length - 1, total);
    elInfo.textContent = `Exibindo ${inicio}–${fim} de ${total} registros`;
    elInfo.style.display = '';

    elLista.innerHTML = logs.map(log => {
        const det = log.detalhes || {};
        const label = ACOES_LABEL[log.acao] || log.acao;
        const badgeCls = ACOES_BADGE[log.acao] || 'default';
        const email = det.email || log.usuario_nome || '—';
        const dataStr = new Date(log.criado_em).toLocaleString('pt-BR');
        const ip = log.ip ? `<span class="pl-ip">${log.ip}</span>` : '';

        const dispIcon = { mobile: '📱', tablet: '📲', desktop: '🖥️' };
        const dispLabel = det.dispositivo || null;
        const dispIco = dispLabel ? (dispIcon[dispLabel] || '💻') : null;

        const uaParts = [
            dispIco ? `${dispIco} ${dispLabel}` : null,
            det.so ? det.so : null,
            det.navegador ? `🌐 ${det.navegador}` : null,
        ].filter(Boolean);

        const extraKeys = Object.keys(det).filter(k => !['email', 'navegador', 'so', 'dispositivo'].includes(k));
        const extraParts = extraKeys.map(k => `<span>${k}: ${det[k]}</span>`);

        const detalhesHtml = [...uaParts.map(p => `<span>${p}</span>`), ...extraParts];

        return `<div class="pl-card">
            <div class="pl-card-top">
                <span class="pl-badge pl-badge--${badgeCls}">${label}</span>
                <span class="pl-acao">${log.usuario_nome || '—'}</span>
                <span class="pl-email">${email}</span>
                ${ip}
                <span class="pl-data">${dataStr}</span>
            </div>
            ${detalhesHtml.length ? `<div class="pl-card-detalhes">${detalhesHtml.join('')}</div>` : ''}
        </div>`;
    }).join('');
}

function renderPaginacao() {
    const totalPags = Math.ceil(total / POR_PAG);
    if (totalPags <= 1) { elPag.style.display = 'none'; return; }
    elPag.style.display = 'flex';
    elPagInfo.textContent = `Página ${pagina + 1} de ${totalPags}`;
    elPrev.disabled = pagina === 0;
    elNext.disabled = pagina >= totalPags - 1;
}

document.getElementById('plAtualizar').addEventListener('click', () => carregar(true));
elBusca.addEventListener('input', () => carregar(true));
elAcao.addEventListener('change', () => carregar(true));
elPrev.addEventListener('click', () => { if (pagina > 0) { pagina--; carregar(false); } });
elNext.addEventListener('click', () => {
    if (pagina < Math.ceil(total / POR_PAG) - 1) { pagina++; carregar(false); }
});

carregar();
