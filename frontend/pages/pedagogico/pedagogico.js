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
    grave:    { label: '⛔ Grave',       cls: 'grave' },
    atencao:  { label: '⚠️ Atenção',     cls: 'atencao' },
    positivo: { label: '✅ Positivo',    cls: 'positivo' },
    rco_obs:  { label: '📝 Obs. RCO',   cls: 'rco_obs' },
};

/* ── Estado ─────────────────────────────────────────────────────── */
let todasOcorrencias = [];   // regular (aluno_ocorrencias)
let todasObsRco      = [];   // observações RCO
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

/* ── Carregar turmas ─────────────────────────────────────────────── */
async function carregarTurmas() {
    try {
        const res = await fetch('/api/alunos/turmas/lista');
        if (!res.ok) return;
        let turmas = await res.json();
        /* Filtra pelo contexto de escola salvo no dashboard */
        try {
            const raw = localStorage.getItem('edusync_escola_codturmas');
            if (raw) {
                const validos = JSON.parse(raw);
                if (validos.length > 0)
                    turmas = turmas.filter(t => validos.includes(t.codturma));
            }
        } catch (_) {}
        turmas.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.codturma;
            opt.textContent = t.turma;
            selTurma.appendChild(opt);
        });
    } catch (_) {}
}

/* ── Parâmetros comuns de filtro ─────────────────────────────────── */
function buildParams() {
    const params = new URLSearchParams();
    const codTurma = selTurma.value;
    if (codTurma) params.set('codTurma', codTurma);
    const dias = selPeriodo.value;
    if (dias && parseInt(dias) > 0) {
        params.set('dataInicio', dataInicioFromPeriodo(dias));
    }
    return params;
}

/* ── Buscar ocorrências de professores ──────────────────────────── */
async function carregarOcorrencias() {
    try {
        const params = buildParams();
        if (tipoFiltro !== 'todos' && tipoFiltro !== 'rco_obs') {
            params.set('tipo', tipoFiltro);
        }
        const res = await fetch('/api/pedagogico?' + params);
        if (!res.ok) throw new Error();
        todasOcorrencias = await res.json();
    } catch {
        todasOcorrencias = [];
    }
}

/* ── Buscar observações RCO ─────────────────────────────────────── */
async function carregarObsRco() {
    try {
        const params = buildParams();
        const res = await fetch('/api/pedagogico/observacoes-rco?' + params);
        if (!res.ok) throw new Error();
        todasObsRco = await res.json();
    } catch {
        todasObsRco = [];
    }
}

/* ── Buscar tudo em paralelo ─────────────────────────────────────── */
async function carregarTudo() {
    elLoading.style.display  = 'block';
    elVazio.style.display    = 'none';
    elGrid.style.display     = 'none';

    await Promise.all([carregarOcorrencias(), carregarObsRco()]);

    renderStats();
    renderGrid();
}

/* ── Mescla ativa segundo tipo filtro ────────────────────────────── */
function listaFiltradaPorTipo() {
    if (tipoFiltro === 'todos') {
        return [...todasOcorrencias, ...todasObsRco];
    }
    if (tipoFiltro === 'rco_obs') {
        return [...todasObsRco];
    }
    return [...todasOcorrencias.filter(o => o.tipo === tipoFiltro)];
}

/* ── Estatísticas ─────────────────────────────────────────────────  */
function renderStats() {
    const avisos    = todasOcorrencias;
    const graves    = avisos.filter(o => o.tipo === 'grave').length;
    const atencao   = avisos.filter(o => o.tipo === 'atencao').length;
    const rcoTotal  = todasObsRco.length;

    const todas = [...todasOcorrencias, ...todasObsRco];
    const pendentes = todas.filter(o => !o.pedagogo?.visto).length;

    document.getElementById('statTotal').textContent    = todas.length;
    document.getElementById('statGraves').textContent   = graves;
    document.getElementById('statAtencao').textContent  = atencao;
    document.getElementById('statRco').textContent      = rcoTotal;
    document.getElementById('statPendentes').textContent = pendentes;
}

/* ── Filtrar por status pedagógico ──────────────────────────────── */
function filtrarPorStatus(lista) {
    if (statusFiltro === 'pendente') return lista.filter(o => !o.pedagogo?.visto);
    if (statusFiltro === 'visto')    return lista.filter(o =>  o.pedagogo?.visto);
    return lista;
}

/* ── Ordenar por data desc ───────────────────────────────────────── */
function ordenarPorData(lista) {
    return [...lista].sort((a, b) => {
        const da = a.data || a.data_aula || '';
        const db = b.data || b.data_aula || '';
        return db.localeCompare(da);
    });
}

/* ── Render grid ─────────────────────────────────────────────────── */
function renderGrid() {
    elLoading.style.display = 'none';
    const lista = ordenarPorData(filtrarPorStatus(listaFiltradaPorTipo()));

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

/* ── ID único para pedagogo_notas ────────────────────────────────── */
function idParaNota(o) {
    return o._rco_id || o.id;
}

/* ── Criar card de ocorrência ou obs RCO ─────────────────────────── */
function criarCard(o) {
    const isRco   = o.tipo === 'rco_obs';
    const tipo    = TIPO_LABELS[o.tipo] || { label: o.tipo, cls: 'atencao' };
    const visto   = o.pedagogo?.visto || false;
    const nota    = o.pedagogo?.nota || '';
    const encam   = o.pedagogo?.encaminhamento || '';
    const vistoEm = o.pedagogo?.visto_em ? new Date(o.pedagogo.visto_em) : null;

    // Metadados de professor (apenas para ocorrências normais)
    const professorNome = o.meta?.professor_nome || '';
    const nomeTurma     = isRco
        ? (o.nome_turma || (o.cod_turma ? `Turma ${o.cod_turma}` : ''))
        : (o.meta?.nome_turma || (o.cod_turma ? `Turma ${o.cod_turma}` : ''));

    const card = document.createElement('div');
    card.className = `ped-card ped-card--${tipo.cls}${visto ? ' ped-card--visto' : ''}`;
    card.dataset.id = idParaNota(o);

    const encamOpts = ENCAMINHAMENTOS.map(e =>
        `<option value="${e.value}"${e.value === encam ? ' selected' : ''}>${e.label}</option>`
    ).join('');

    const notaTruncada = nota.length > 80 ? nota.slice(0, 80) + '…' : nota;

    // Corpo diferente para RCO obs vs ocorrências normais
    let bodyHtml = '';

    const nomeAluno = o.nome_aluno || 'Aluno não identificado';
    const codMat    = o.cod_matriz_aluno || null;
    // Botão clicável que abre o histórico do aluno
    const nomeBtnHtml = `<button class="ped-aluno-nome-btn js-aluno-btn"
        data-nome="${nomeAluno.replace(/"/g,'&quot;')}"
        data-cod="${codMat || ''}"
        data-turma="${nomeTurma.replace(/"/g,'&quot;')}"
        title="Ver histórico de ${nomeAluno}">${nomeAluno}</button>`;

    if (isRco) {
        // Card de Observação RCO
        const dataAula = isoParaBR(o.data_aula);
        bodyHtml = `
            <div class="ped-card-body">
                <div>
                    ${nomeBtnHtml}
                    <div class="ped-aluno-meta">
                        ${o.num_chamada ? `<span class="ped-meta-chip">Nº ${o.num_chamada}</span>` : ''}
                        ${nomeTurma     ? `<span class="ped-meta-chip">📚 ${nomeTurma}</span>` : ''}
                        ${dataAula      ? `<span class="ped-meta-chip">🗓 Aula de ${dataAula}</span>` : ''}
                    </div>
                </div>
                <div>
                    <div class="ped-rco-aula-label">Observação registrada no RCO pelo professor</div>
                    <div class="ped-rco-obs-bloco">"${o.observacao || '—'}"</div>
                </div>
            </div>`;
    } else {
        // Card de ocorrência normal
        const pontos = o.pontos || 0;
        const pontosClass = pontos < 0 ? 'neg' : pontos > 0 ? 'pos' : 'zero';
        const pontosLabel = pontos === 0 ? '0 pts' : `${pontos > 0 ? '+' : ''}${pontos} pts`;

        bodyHtml = `
            <div class="ped-card-body">
                <div>
                    ${nomeBtnHtml}
                    <div class="ped-aluno-meta">
                        ${o.num_chamada ? `<span class="ped-meta-chip">Nº ${o.num_chamada}</span>` : ''}
                        ${nomeTurma     ? `<span class="ped-meta-chip">📚 ${nomeTurma}</span>` : ''}
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
            </div>`;
    }

    const profFaixa = !isRco && professorNome
        ? `<div class="ped-card-prof">
               <div class="ped-prof-row">
                   <span class="ped-prof-icon">👩‍🏫</span>
                   <span class="ped-prof-nome">${professorNome}</span>
               </div>
           </div>`
        : '';

    const dataDisplay = isoParaBR(o.data || o.data_aula);

    card.innerHTML = `
        <div class="ped-card-head">
            <div class="ped-card-badges">
                <span class="ped-badge ped-badge--${isRco ? 'rco' : tipo.cls}">${tipo.label}</span>
                ${visto
                    ? `<span class="ped-badge ped-badge--visto">✔ Revisado</span>`
                    : `<span class="ped-badge ped-badge--pendente">⏳ Pendente</span>`}
            </div>
            <span class="ped-card-data">${dataDisplay}</span>
        </div>
        ${profFaixa}
        ${bodyHtml}
        <div class="ped-card-footer">
            <div class="ped-footer-label">📝 Nota pedagógica</div>
            ${nota
                ? `<div class="ped-nota-salva js-nota-salva" title="Clique para editar">${notaTruncada}</div>`
                : ''}
            <textarea class="ped-nota-area js-nota-area"
                placeholder="Registre aqui sua observação, encaminhamento realizado, contato com família..."
                rows="3">${nota}</textarea>
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
            ${vistoEm ? `<div class="ped-visto-em">Revisado em ${vistoEm.toLocaleDateString('pt-BR')} às ${vistoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
            ${encam ? `<span class="ped-encaminhamento-badge">➜ ${encam}</span>` : ''}
        </div>`;

    // Expandir nota salva
    const notaSalvaEl = card.querySelector('.js-nota-salva');
    const notaAreaEl  = card.querySelector('.js-nota-area');
    if (notaSalvaEl) {
        notaAreaEl.style.display = 'none';
        notaSalvaEl.addEventListener('click', () => {
            notaSalvaEl.style.display = 'none';
            notaAreaEl.style.display = '';
            notaAreaEl.focus();
        });
    }

    // Botão "Marcar como visto"
    const btnVisto = card.querySelector('.js-btn-visto');
    btnVisto.addEventListener('click', () => {
        const atual = btnVisto.classList.contains('ped-btn-visto--ativo');
        salvarNota(card, o, !atual);
    });

    // Botão Salvar
    card.querySelector('.js-btn-salvar').addEventListener('click', () => {
        salvarNota(card, o, btnVisto.classList.contains('ped-btn-visto--ativo'));
    });

    return card;
}

/* ── Salvar nota via API ─────────────────────────────────────────── */
async function salvarNota(card, o, visto) {
    const idNota    = idParaNota(o);
    const nota      = card.querySelector('.js-nota-area').value.trim();
    const encam     = card.querySelector('.js-encam').value;
    const btnSalvar = card.querySelector('.js-btn-salvar');
    const btnVisto  = card.querySelector('.js-btn-visto');

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';

    try {
        const res = await fetch('/api/pedagogico/nota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_ocorrencia: idNota, nota, encaminhamento: encam, visto }),
        });
        if (!res.ok) throw new Error();
        const salvo = await res.json();

        // Atualiza estado local
        const atualizarLista = (lista) => {
            const idx = lista.findIndex(x => idParaNota(x) === idNota);
            if (idx !== -1) lista[idx].pedagogo = salvo;
        };
        atualizarLista(todasOcorrencias);
        atualizarLista(todasObsRco);

        // Atualiza visuais
        card.classList.toggle('ped-card--visto', visto);
        btnVisto.classList.toggle('ped-btn-visto--ativo', visto);
        btnVisto.textContent = visto ? '✔ Revisado' : '☐ Marcar como visto';

        const badgePendente = card.querySelector('.ped-badge--pendente');
        const badgeVisto    = card.querySelector('.ped-badge--visto');
        if (visto && badgePendente) {
            badgePendente.outerHTML = `<span class="ped-badge ped-badge--visto">✔ Revisado</span>`;
        } else if (!visto && badgeVisto) {
            badgeVisto.outerHTML = `<span class="ped-badge ped-badge--pendente">⏳ Pendente</span>`;
        }

        btnSalvar.textContent = '✔ Salvo!';
        setTimeout(() => { btnSalvar.textContent = 'Salvar'; btnSalvar.disabled = false; }, 1500);
        renderStats();
    } catch {
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
        // Obs. RCO não precisa re-buscar ocorrências do professor
        carregarTudo();
    });
});

selTurma.addEventListener('change', carregarTudo);
selPeriodo.addEventListener('change', carregarTudo);
selStatus.addEventListener('change', () => {
    statusFiltro = selStatus.value;
    renderGrid();
});

/* ── Drawer: Histórico do aluno ──────────────────────────────────── */
const elDrawer   = document.getElementById('alunoDrawer');
const elOverlay  = document.getElementById('alunoOverlay');
const elDNome    = document.getElementById('alunoDrawerNome');
const elDTurma   = document.getElementById('alunoDrawerTurma');
const elDStats   = document.getElementById('alunoDrawerStats');
const elDLista   = document.getElementById('alunoDrawerLista');

function abrirDrawer() {
    document.body.classList.add('drawer-aberto');
    elDrawer.setAttribute('aria-hidden', 'false');
    elOverlay.setAttribute('aria-hidden', 'false');
    elDrawer.focus();
}
function fecharDrawer() {
    document.body.classList.remove('drawer-aberto');
    elDrawer.setAttribute('aria-hidden', 'true');
    elOverlay.setAttribute('aria-hidden', 'true');
}

document.getElementById('alunoDrawerFechar').addEventListener('click', fecharDrawer);
elOverlay.addEventListener('click', fecharDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('drawer-aberto')) fecharDrawer(); });

// Clique nos nomes dos alunos via event delegation no grid
elGrid.addEventListener('click', e => {
    const btn = e.target.closest('.js-aluno-btn');
    if (!btn) return;
    const nomeAluno = btn.dataset.nome;
    const codMat    = btn.dataset.cod ? parseInt(btn.dataset.cod) : null;
    const turma     = btn.dataset.turma;
    abrirHistoricoAluno(nomeAluno, codMat, turma);
});

function abrirHistoricoAluno(nomeAluno, codMatrizAluno, nomeTurma) {
    // Coleta todos os registros desse aluno (por cod_matriz_aluno ou nome como fallback)
    const matchObs = o =>
        (codMatrizAluno && o.cod_matriz_aluno === codMatrizAluno) ||
        (o.nome_aluno || '').toUpperCase().trim() === (nomeAluno || '').toUpperCase().trim();

    const registros = [
        ...todasObsRco.filter(matchObs),
        ...todasOcorrencias.filter(matchObs),
    ].sort((a, b) => {
        const da = a.data_aula || a.data || '';
        const db = b.data_aula || b.data || '';
        return db.localeCompare(da);
    });

    // Atualiza cabeçalho
    elDNome.textContent  = nomeAluno;
    elDTurma.textContent = nomeTurma || '';

    // Mini-estatísticas
    const totalRco    = registros.filter(r => r.tipo === 'rco_obs').length;
    const totalNeg    = registros.filter(r => r.tipo === 'grave' || r.tipo === 'atencao').length;
    const totalPos    = registros.filter(r => r.tipo === 'positivo').length;
    const totalGeral  = registros.length;
    elDStats.innerHTML = `
        <div class="aluno-dstat aluno-dstat--all">
            <span class="aluno-dstat-num">${totalGeral}</span>
            <span class="aluno-dstat-label">Total</span>
        </div>
        <div class="aluno-dstat aluno-dstat--rco">
            <span class="aluno-dstat-num">${totalRco}</span>
            <span class="aluno-dstat-label">Obs. RCO</span>
        </div>
        <div class="aluno-dstat aluno-dstat--neg">
            <span class="aluno-dstat-num">${totalNeg}</span>
            <span class="aluno-dstat-label">Ocorrências</span>
        </div>
        <div class="aluno-dstat aluno-dstat--pos">
            <span class="aluno-dstat-num">${totalPos}</span>
            <span class="aluno-dstat-label">Positivos</span>
        </div>`;

    // Lista de registros
    if (registros.length === 0) {
        elDLista.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:32px 0">Nenhum registro encontrado para este aluno.</p>`;
    } else {
        elDLista.innerHTML = registros.map(r => {
            const isRco  = r.tipo === 'rco_obs';
            const data   = isoParaBR(r.data_aula || r.data);
            const tipo   = TIPO_LABELS[r.tipo] || { label: r.tipo, cls: 'atencao' };
            const nota   = r.pedagogo?.nota || '';
            const encam  = r.pedagogo?.encaminhamento || '';

            let conteudo = '';
            if (isRco) {
                conteudo = `<p class="aluno-hist-texto">"${r.observacao || '—'}"</p>`;
            } else {
                const cat = r.categoria_label || r.categoria || '';
                conteudo = `
                    ${cat ? `<p class="aluno-hist-categoria">${cat}</p>` : ''}
                    ${r.descricao ? `<p class="aluno-hist-texto">"${r.descricao}"</p>` : ''}`;
            }

            const notaHtml  = nota  ? `<div class="aluno-hist-nota">📝 ${nota}</div>` : '';
            const encamHtml = encam ? `<div class="aluno-hist-encam">➜ ${encam}</div>` : '';

            return `
                <div class="aluno-hist-item aluno-hist-item--${r.tipo}">
                    <div class="aluno-hist-header">
                        <span class="aluno-hist-data">📅 ${data || '—'}</span>
                        <span class="aluno-hist-badge aluno-hist-badge--${r.tipo}">${tipo.label}</span>
                        ${r.pedagogo?.visto ? `<span class="aluno-hist-badge" style="background:#dcfce7;color:#16a34a">✔ Revisado</span>` : ''}
                    </div>
                    ${conteudo}
                    ${encamHtml}
                    ${notaHtml}
                </div>`;
        }).join('');
    }

    abrirDrawer();
}

/* ── Sincronização automática com RCO ────────────────────────────── */
const elSyncBar     = document.getElementById('pedSyncBar');
const elSyncSpinner = document.getElementById('pedSyncSpinner');
const elSyncMsg     = document.getElementById('pedSyncMsg');

function setSyncStatus(estado, msg) {
    elSyncBar.style.display = 'flex';
    elSyncBar.className = 'ped-sync-bar' + (estado ? ` ped-sync-bar--${estado}` : '');
    elSyncSpinner.style.display = estado === 'sincronizando' ? 'inline-block' : 'none';
    elSyncMsg.textContent = msg;
}

async function sincronizarRco() {
    setSyncStatus('sincronizando', 'Sincronizando observações RCO com dados mais recentes…');
    try {
        const res = await fetch('/api/pedagogico/sincronizar-rco', { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.status === 'sem_classes') {
            setSyncStatus('ok', '✔ Nenhuma turma encontrada — faça uma sincronização completa primeiro.');
        } else {
            setSyncStatus('ok', `✔ Sincronizado com RCO — ${data.totalObs} observação(ões) atualizadas em ${data.classes} turma(s).`);
        }

        // Recarrega os cards com os dados atualizados do banco
        await carregarTudo();

        setTimeout(() => { elSyncBar.style.display = 'none'; }, 5000);
    } catch (e) {
        setSyncStatus('erro', `⚠ Falha na sincronização com RCO: ${e.message}. Exibindo dados em cache.`);
        setTimeout(() => { elSyncBar.style.display = 'none'; }, 8000);
    }
}

/* ── Inicialização ──────────────────────────────────────────────── */
(async () => {
    await carregarTurmas();
    // Exibe dados em cache imediatamente (rápido)
    await carregarTudo();
    // Sincroniza com RCO em seguida e recarrega com dados frescos
    sincronizarRco();
})();
