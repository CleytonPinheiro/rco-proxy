'use strict';

/* ── Configurações ──────────────────────────────────────────────── */
const ENCAMINHAMENTOS = [
    { value: '',           label: '— sem encaminhamento —' },
    { value: 'Família',    label: '👨‍👩‍👦 Comunicado à família' },
    { value: 'Direção',    label: '🏫 Encaminhado à direção' },
    { value: 'Orientação', label: '🧭 Encaminhado à orientação' },
    { value: 'Conselho',   label: '📋 Conselho de classe' },
    { value: 'Outro',      label: '📌 Outro' },
];

const TIPO_LABELS = {
    grave:    { label: '⛔ Grave',    cls: 'grave' },
    atencao:  { label: '⚠️ Atenção',  cls: 'atencao' },
    positivo: { label: '✅ Positivo', cls: 'positivo' },
};

/* ── Estado ─────────────────────────────────────────────────────── */
let todasOcorrencias = [];
let tipoFiltro  = 'todos';
let statusFiltro = 'todos';

/* ── Elementos ──────────────────────────────────────────────────── */
const elGrid      = document.getElementById('pedGrid');
const elLoading   = document.getElementById('pedLoading');
const elVazio     = document.getElementById('pedVazio');
const selTurma    = document.getElementById('filtroTurma');
const selStatus   = document.getElementById('filtroStatus');
const selPeriodo  = document.getElementById('filtroPeriodo');

/* ── Data helpers ────────────────────────────────────────────────── */
function isoParaBR(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
}
function dataInicioFromPeriodo(dias) {
    if (!dias) return null;
    const d = new Date();
    d.setDate(d.getDate() - parseInt(dias));
    return d.toISOString().split('T')[0];
}

/* ── Carregar turmas para o select ──────────────────────────────── */
async function carregarTurmas() {
    try {
        const res = await fetch('/api/alunos/turmas/lista');
        if (!res.ok) return;
        const turmas = await res.json();
        turmas.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.codturma;
            opt.textContent = t.turma;
            selTurma.appendChild(opt);
        });
    } catch (_) {}
}

/* ── Buscar ocorrências + notas ─────────────────────────────────── */
async function carregarOcorrencias() {
    elLoading.style.display  = 'block';
    elVazio.style.display    = 'none';
    elGrid.style.display     = 'none';

    try {
        const params = new URLSearchParams();
        if (tipoFiltro !== 'todos') params.set('tipo', tipoFiltro);
        const codTurma = selTurma.value;
        if (codTurma) params.set('codTurma', codTurma);
        const dias = selPeriodo.value;
        if (dias && parseInt(dias) > 0) {
            params.set('dataInicio', dataInicioFromPeriodo(dias));
        }
        const res = await fetch('/api/pedagogico?' + params);
        if (!res.ok) throw new Error('Falha ao buscar ocorrências');
        todasOcorrencias = await res.json();
    } catch (e) {
        console.error('[PEDAGOGICO]', e);
        todasOcorrencias = [];
    }

    renderStats();
    renderGrid();
}

/* ── Calcular e exibir estatísticas ─────────────────────────────── */
function renderStats() {
    const avisos = todasOcorrencias.filter(o => o.tipo !== 'positivo');
    const graves   = avisos.filter(o => o.tipo === 'grave').length;
    const atencao  = avisos.filter(o => o.tipo === 'atencao').length;
    const pendentes = avisos.filter(o => !o.pedagogo?.visto).length;
    document.getElementById('statTotal').textContent    = todasOcorrencias.length;
    document.getElementById('statGraves').textContent   = graves;
    document.getElementById('statAtencao').textContent  = atencao;
    document.getElementById('statPendentes').textContent = pendentes;
}

/* ── Filtrar localmente por status ──────────────────────────────── */
function filtrarLocal(ocorrencias) {
    if (statusFiltro === 'pendente') return ocorrencias.filter(o => !o.pedagogo?.visto);
    if (statusFiltro === 'visto')    return ocorrencias.filter(o => o.pedagogo?.visto);
    return ocorrencias;
}

/* ── Renderizar grid de cards ───────────────────────────────────── */
function renderGrid() {
    elLoading.style.display = 'none';
    const lista = filtrarLocal(todasOcorrencias);

    if (lista.length === 0) {
        elVazio.style.display = 'block';
        elGrid.style.display  = 'none';
        return;
    }
    elVazio.style.display = 'none';
    elGrid.style.display  = 'grid';

    elGrid.innerHTML = '';
    lista.forEach(o => elGrid.appendChild(criarCard(o)));
}

/* ── Criar card de ocorrência ───────────────────────────────────── */
function criarCard(o) {
    const tipo    = TIPO_LABELS[o.tipo] || { label: o.tipo, cls: 'atencao' };
    const visto   = o.pedagogo?.visto || false;
    const nota    = o.pedagogo?.nota || '';
    const encam   = o.pedagogo?.encaminhamento || '';
    const vistoEm = o.pedagogo?.visto_em ? new Date(o.pedagogo.visto_em) : null;

    const pontos = o.pontos || 0;
    const pontosClass = pontos < 0 ? 'neg' : pontos > 0 ? 'pos' : 'zero';
    const pontosLabel = pontos === 0 ? '0 pts' : `${pontos > 0 ? '+' : ''}${pontos} pts`;

    const card = document.createElement('div');
    card.className = `ped-card ped-card--${tipo.cls}${visto ? ' ped-card--visto' : ''}`;
    card.dataset.id = o.id;

    const encamOpts = ENCAMINHAMENTOS.map(e =>
        `<option value="${e.value}"${e.value === encam ? ' selected' : ''}>${e.label}</option>`
    ).join('');

    const notaTruncada = nota.length > 80 ? nota.slice(0, 80) + '…' : nota;

    card.innerHTML = `
        <div class="ped-card-head">
            <div class="ped-card-badges">
                <span class="ped-badge ped-badge--${tipo.cls}">${tipo.label}</span>
                ${visto
                    ? `<span class="ped-badge ped-badge--visto">✔ Revisado</span>`
                    : `<span class="ped-badge ped-badge--pendente">⏳ Pendente</span>`}
            </div>
            <span class="ped-card-data">${isoParaBR(o.data)}</span>
        </div>
        <div class="ped-card-body">
            <div>
                <p class="ped-aluno-nome">${o.nome_aluno || 'Aluno não identificado'}</p>
                <div class="ped-aluno-meta">
                    ${o.num_chamada ? `<span class="ped-meta-chip">Nº ${o.num_chamada}</span>` : ''}
                    ${o.cod_turma   ? `<span class="ped-meta-chip">Turma ${o.cod_turma}</span>` : ''}
                </div>
            </div>
            <div class="ped-ocorrencia-info">
                <span class="ped-categoria-label">${o.categoria_label || o.categoria || '—'}</span>
                <span class="ped-pontos-badge ped-pontos--${pontosClass}">${pontosLabel}</span>
            </div>
            ${o.descricao ? `
            <div>
                <div class="ped-descricao-label">Observação do professor</div>
                <p class="ped-descricao">"${o.descricao}"</p>
            </div>` : ''}
        </div>
        <div class="ped-card-footer">
            <div class="ped-footer-label">📝 Nota pedagógica</div>
            ${nota && !card._expandido
                ? `<div class="ped-nota-salva js-nota-salva" title="Clique para editar">${notaTruncada}</div>`
                : ''}
            <textarea class="ped-nota-area js-nota-area" placeholder="Registre aqui sua observação, encaminhamento realizado, contato com família..." rows="3">${nota}</textarea>
            <div class="ped-encaminhamento-row">
                <span class="ped-encaminhamento-label">Encaminhamento:</span>
                <select class="ped-encaminhamento-select js-encam">${encamOpts}</select>
            </div>
            <div class="ped-footer-actions">
                <button class="ped-btn-visto js-btn-visto ${visto ? 'ped-btn-visto--ativo' : ''}">
                    ${visto ? '✔ Revisado' : '☐ Marcar como visto'}
                </button>
                <button class="ped-btn-salvar js-btn-salvar">Salvar</button>
            </div>
            ${vistoEm ? `<div class="ped-visto-em">Revisado em ${vistoEm.toLocaleDateString('pt-BR')} às ${vistoEm.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</div>` : ''}
            ${encam && encam !== '' ? `<span class="ped-encaminhamento-badge">➜ ${encam}</span>` : ''}
        </div>
    `;

    // Expandir nota salva ao clicar
    const notaSalvaEl = card.querySelector('.js-nota-salva');
    const notaAreaEl  = card.querySelector('.js-nota-area');
    if (notaSalvaEl) {
        notaSalvaEl.style.display = '';
        notaAreaEl.style.display = 'none';
        notaSalvaEl.addEventListener('click', () => {
            notaSalvaEl.style.display = 'none';
            notaAreaEl.style.display = '';
            notaAreaEl.focus();
        });
    }

    // Botão "Marcar como visto" — toggle
    const btnVisto = card.querySelector('.js-btn-visto');
    btnVisto.addEventListener('click', () => {
        const atual = btnVisto.classList.contains('ped-btn-visto--ativo');
        salvarNota(card, o.id, !atual, true);
    });

    // Botão Salvar
    card.querySelector('.js-btn-salvar').addEventListener('click', () => {
        const vistoAtual = btnVisto.classList.contains('ped-btn-visto--ativo');
        salvarNota(card, o.id, vistoAtual, false);
    });

    return card;
}

/* ── Salvar nota via API ─────────────────────────────────────────── */
async function salvarNota(card, idOcorrencia, visto, somenteVisto) {
    const nota    = card.querySelector('.js-nota-area').value.trim();
    const encam   = card.querySelector('.js-encam').value;
    const btnSalvar = card.querySelector('.js-btn-salvar');
    const btnVisto  = card.querySelector('.js-btn-visto');

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';

    try {
        const body = { id_ocorrencia: idOcorrencia, nota, encaminhamento: encam, visto };
        const res = await fetch('/api/pedagogico/nota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Falha ao salvar');
        const salvo = await res.json();

        // Atualiza estado local
        const idx = todasOcorrencias.findIndex(o => o.id === idOcorrencia);
        if (idx !== -1) todasOcorrencias[idx].pedagogo = salvo;

        // Atualiza visual do card
        card.classList.toggle('ped-card--visto', visto);
        btnVisto.classList.toggle('ped-btn-visto--ativo', visto);
        btnVisto.textContent = visto ? '✔ Revisado' : '☐ Marcar como visto';

        // Atualiza badge
        const badgePendente = card.querySelector('.ped-badge--pendente');
        const badgeVisto    = card.querySelector('.ped-badge--visto');
        if (visto) {
            if (badgePendente) badgePendente.outerHTML = `<span class="ped-badge ped-badge--visto">✔ Revisado</span>`;
        } else {
            if (badgeVisto) badgeVisto.outerHTML = `<span class="ped-badge ped-badge--pendente">⏳ Pendente</span>`;
        }

        btnSalvar.textContent = '✔ Salvo!';
        setTimeout(() => { btnSalvar.textContent = 'Salvar'; btnSalvar.disabled = false; }, 1500);

        // Recontabiliza pendentes
        renderStats();
    } catch (e) {
        btnSalvar.textContent = 'Erro!';
        btnSalvar.style.background = '#ef4444';
        setTimeout(() => {
            btnSalvar.textContent = 'Salvar';
            btnSalvar.style.background = '';
            btnSalvar.disabled = false;
        }, 2000);
    }
}

/* ── Eventos de filtro ───────────────────────────────────────────── */
document.querySelectorAll('.ped-tipo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.ped-tipo-btn').forEach(b => b.classList.remove('ped-tipo-btn--active'));
        btn.classList.add('ped-tipo-btn--active');
        tipoFiltro = btn.dataset.tipo;
        carregarOcorrencias();
    });
});

selTurma.addEventListener('change', carregarOcorrencias);
selPeriodo.addEventListener('change', carregarOcorrencias);
selStatus.addEventListener('change', () => {
    statusFiltro = selStatus.value;
    renderGrid();
});

/* ── Inicialização ──────────────────────────────────────────────── */
(async () => {
    await carregarTurmas();
    await carregarOcorrencias();
})();
