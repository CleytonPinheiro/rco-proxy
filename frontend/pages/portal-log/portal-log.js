const POR_PAG = 40;
let pagina = 0;
let total = 0;

const ACOES = {
    LOGIN:                 { label: 'Login',                  icon: '🔓', cls: 'login',      cat: 'login' },
    LOGOUT:                { label: 'Logout',                 icon: '🔒', cls: 'logout',     cat: 'logout' },
    SOLICITAR_REABERTURA:  { label: 'Solicitação reabertura', icon: '↩',  cls: 'solicitar',  cat: 'solicitar' },
    NOTIF_LIDA:            { label: 'Notificação lida',       icon: '🔔', cls: 'notif',      cat: 'outros' },
    VER_NOTAS:             { label: 'Ver notas',              icon: '📊', cls: 'notas',      cat: 'outros' },
    VER_FREQUENCIA:        { label: 'Ver frequência',         icon: '📅', cls: 'frequencia', cat: 'outros' },
    ALTERAR_TEMA:          { label: 'Alterar tema',           icon: '🎨', cls: 'tema',       cat: 'outros' },
};

function acaoInfo(acao) {
    return ACOES[acao] || { label: acao, icon: '•', cls: 'default', cat: 'outros' };
}

const elBusca   = document.getElementById('plBusca');
const elAcao    = document.getElementById('plAcao');
const elLista   = document.getElementById('plLista');
const elInfo    = document.getElementById('plInfo');
const elPag     = document.getElementById('plPaginacao');
const elPagInfo = document.getElementById('plPagInfo');
const elPrev    = document.getElementById('plPrev');
const elNext    = document.getElementById('plNext');
const elCntL    = document.getElementById('plCntLogin');
const elCntO    = document.getElementById('plCntLogout');
const elCntS    = document.getElementById('plCntSolicitar');
const elCntX    = document.getElementById('plCntOutros');

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function carregar(resetar = true) {
    if (resetar) pagina = 0;

    const busca = elBusca.value.trim();
    const acao  = elAcao.value;

    const params = new URLSearchParams({ limite: POR_PAG, offset: pagina * POR_PAG });
    if (busca) params.set('busca', busca);
    if (acao)  params.set('acao', acao);

    elLista.innerHTML = '<div class="pl-empty">Carregando…</div>';
    elInfo.style.display = 'none';
    elPag.style.display  = 'none';

    try {
        const res = await fetch(`/api/admin/portal-aluno/audit-log?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const data = await res.json();
        total = data.total;
        atualizarStats(data.logs);
        renderLogs(data.logs);
        renderPaginacao();
    } catch (e) {
        elLista.innerHTML = `<div class="pl-empty" style="color:var(--danger,#dc2626)">Erro: ${e.message}</div>`;
    }
}

function atualizarStats(logs) {
    let login = 0, logout = 0, solicitar = 0, outros = 0;
    logs.forEach(l => {
        const cat = acaoInfo(l.acao).cat;
        if (cat === 'login') login++;
        else if (cat === 'logout') logout++;
        else if (cat === 'solicitar') solicitar++;
        else outros++;
    });
    elCntL.textContent = login;
    elCntO.textContent = logout;
    elCntS.textContent = solicitar;
    elCntX.textContent = outros;
}

function agruparPorDia(logs) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);

    const map = new Map();

    logs.forEach(l => {
        const dt = new Date(l.criado_em);
        dt.setHours(0, 0, 0, 0);
        const key = dt.toISOString().slice(0, 10);
        let label;
        if (dt.getTime() === hoje.getTime()) label = 'Hoje';
        else if (dt.getTime() === ontem.getTime()) label = 'Ontem';
        else label = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        if (!map.has(key)) map.set(key, { label, items: [] });
        map.get(key).items.push(l);
    });

    const sorted = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return sorted.map(([, v]) => v);
}

function renderLogs(logs) {
    if (!logs.length) {
        elLista.innerHTML = '<div class="pl-empty">Nenhum registro encontrado.</div>';
        return;
    }

    const inicio = pagina * POR_PAG + 1;
    const fim    = Math.min(inicio + logs.length - 1, total);
    elInfo.textContent = `Exibindo ${inicio}–${fim} de ${total} registros`;
    elInfo.style.display = '';

    logs.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
    const grupos = agruparPorDia(logs);
    const fmtHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

    let html = '';
    for (const { label, items } of grupos) {
        html += `<div class="pl-day-group">`;
        html += `<div class="pl-day-label">${esc(label)}</div>`;

        items.forEach(log => {
            const info = acaoInfo(log.acao);
            const det  = log.detalhes || {};
            const email = det.email || log.usuario_nome || '—';
            const ip = log.ip || '';

            const dispIcon = { mobile: '📱', tablet: '📲', desktop: '🖥️' };
            const tags = [];
            if (det.dispositivo) tags.push(`${dispIcon[det.dispositivo] || '💻'} ${det.dispositivo}`);
            if (det.so)          tags.push(det.so);
            if (det.navegador)   tags.push(`🌐 ${det.navegador}`);

            const extraLabels = {
                cursoNome: '📚 Disciplina',
                courseworkTitulo: '📝 Atividade',
                cursoId: null,
                courseworkId: null,
                notifId: '🔔 Notificação #',
            };
            const extraKeys = Object.keys(det).filter(k => !['email', 'navegador', 'so', 'dispositivo'].includes(k));
            extraKeys.forEach(k => {
                if (extraLabels[k] === null) return;
                const lbl = extraLabels[k] || k;
                tags.push(`${lbl}: ${det[k]}`);
            });

            html += `
            <div class="pl-tl-item">
                <div class="pl-tl-dot pl-tl-dot--${info.cls}">${info.icon}</div>
                <div class="pl-card pl-card--${info.cls}">
                    <div class="pl-card-header">
                        <span class="pl-badge pl-badge--${info.cls}">${info.label}</span>
                        <span class="pl-nome">${esc(log.usuario_nome || '—')}</span>
                        <span class="pl-email">${esc(email)}</span>
                    </div>
                    ${tags.length ? `<div class="pl-card-body">${tags.map(t => `<span class="pl-tag">${esc(t)}</span>`).join('')}${ip ? `<span class="pl-ip">${esc(ip)}</span>` : ''}</div>` : (ip ? `<div class="pl-card-body"><span class="pl-ip">${esc(ip)}</span></div>` : '')}
                    <div class="pl-card-footer">
                        <span class="pl-time"><span class="pl-time-icon">🕐</span> ${fmtHora(log.criado_em)}</span>
                    </div>
                </div>
            </div>`;
        });

        html += `</div>`;
    }

    elLista.innerHTML = html;
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
