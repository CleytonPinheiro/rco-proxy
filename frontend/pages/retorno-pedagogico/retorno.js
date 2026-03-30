'use strict';

/* ── Labels ──────────────────────────────────────────────────────── */
const TIPO_LABELS = {
    grave:    { label: '⛔ Grave',     cls: 'grave' },
    atencao:  { label: '⚠️ Atenção',  cls: 'atencao' },
    positivo: { label: '✅ Positivo', cls: 'positivo' },
    rco_obs:  { label: '📝 Obs. RCO', cls: 'rco_obs' },
};

const ENCAM_LABELS = {
    'Família':    '👨‍👩‍👦 Comunicado à família',
    'Direção':    '🏫 Encaminhado à direção',
    'Orientação': '🧭 Encaminhado à orientação',
    'Conselho':   '📋 Conselho de classe',
    'Outro':      '📌 Outro',
};

/* ── Estado ──────────────────────────────────────────────────────── */
let todosRegistros = [];
let tipoFiltro   = 'todos';

/* ── Elementos ───────────────────────────────────────────────────── */
const elGrid    = document.getElementById('retGrid');
const elLoading = document.getElementById('retLoading');
const elVazio   = document.getElementById('retVazio');
const selTurma  = document.getElementById('filtroTurma');
const selStatus = document.getElementById('filtroStatus');
const selPeriodo = document.getElementById('filtroPeriodo');

/* ── Helpers de data ──────────────────────────────────────────────── */
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

/* ── Carregar turmas no select ────────────────────────────────────── */
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

/* ── Parâmetros de filtro para a API ─────────────────────────────── */
function buildParams() {
    const params = new URLSearchParams();
    if (selTurma.value) params.set('codTurma', selTurma.value);
    if (tipoFiltro !== 'todos') params.set('tipo', tipoFiltro);
    const dias = parseInt(selPeriodo.value);
    if (dias > 0) params.set('dataInicio', dataInicioFromPeriodo(dias));
    return params;
}

/* ── Buscar dados do backend ──────────────────────────────────────── */
async function carregarDados() {
    elLoading.style.display = 'block';
    elVazio.style.display   = 'none';
    elGrid.style.display    = 'none';

    try {
        const params = buildParams();
        const res = await fetch('/api/pedagogico/retorno?' + params);
        if (!res.ok) throw new Error();
        todosRegistros = await res.json();
    } catch {
        todosRegistros = [];
    }

    renderStats();
    renderGrid();
}

/* ── Stats ────────────────────────────────────────────────────────── */
function temRetorno(o) {
    return !!(o.pedagogo?.nota || o.pedagogo?.encaminhamento);
}
function isNovo(o) {
    return temRetorno(o) && !o.pedagogo?.visto_professor;
}

function renderStats() {
    const total      = todosRegistros.length;
    const comRetorno = todosRegistros.filter(temRetorno).length;
    const aguardando = todosRegistros.filter(o => !temRetorno(o)).length;
    const novos      = todosRegistros.filter(isNovo).length;

    document.getElementById('statTotal').textContent      = total;
    document.getElementById('statComRetorno').textContent = comRetorno;
    document.getElementById('statAguardando').textContent = aguardando;
    document.getElementById('statNovos').textContent      = novos;
}

/* ── Filtro de status (aplicado no front) ─────────────────────────── */
function filtrarPorStatus(lista) {
    const v = selStatus.value;
    if (v === 'com_retorno') return lista.filter(temRetorno);
    if (v === 'aguardando')  return lista.filter(o => !temRetorno(o));
    if (v === 'novo')        return lista.filter(isNovo);
    return lista;
}

/* ── Ordenação: novos primeiro, depois com retorno, depois aguardando ─ */
function ordenar(lista) {
    return [...lista].sort((a, b) => {
        const novoA = isNovo(a) ? 2 : temRetorno(a) ? 1 : 0;
        const novoB = isNovo(b) ? 2 : temRetorno(b) ? 1 : 0;
        if (novoB !== novoA) return novoB - novoA;
        const da = a.data || a.data_aula || '';
        const db = b.data || b.data_aula || '';
        return db.localeCompare(da);
    });
}

/* ── Render grid ──────────────────────────────────────────────────── */
function renderGrid() {
    elLoading.style.display = 'none';
    const lista = ordenar(filtrarPorStatus(todosRegistros));

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

/* ── Criar card ───────────────────────────────────────────────────── */
function criarCard(o) {
    const isRco   = o.tipo === 'rco_obs';
    const tipo    = TIPO_LABELS[o.tipo] || { label: o.tipo, cls: 'atencao' };
    const temRet  = temRetorno(o);
    const novo    = isNovo(o);

    const nomeAluno  = o.nome_aluno || 'Aluno não identificado';
    const nomeTurma  = isRco
        ? (o.nome_turma || (o.cod_turma ? `Turma ${o.cod_turma}` : ''))
        : (o.meta?.nome_turma || (o.cod_turma ? `Turma ${o.cod_turma}` : ''));
    const dataOcorr  = isoParaBR(o.data || o.data_aula);

    const card = document.createElement('div');
    card.className = `ret-card ret-card--${tipo.cls}${temRet ? ' ret-card--com-retorno' : ''}`;
    card.dataset.id = o._rco_id || o.id;

    /* ── Header ── */
    card.innerHTML = `
        <div class="ret-card-header">
            <div class="ret-card-left">
                <div class="ret-aluno-nome">${nomeAluno}</div>
                <div class="ret-aluno-meta">
                    ${o.num_chamada ? `<span class="ret-meta-chip">Nº ${o.num_chamada}</span>` : ''}
                    ${nomeTurma     ? `<span class="ret-meta-chip">📚 ${nomeTurma}</span>` : ''}
                </div>
            </div>
            <div class="ret-card-right">
                <span class="ret-tipo-badge ret-tipo-badge--${tipo.cls}">${tipo.label}</span>
                ${dataOcorr ? `<span class="ret-data-chip">🗓 ${dataOcorr}</span>` : ''}
                ${novo ? '<span class="ret-novo-badge">Novo</span>' : ''}
            </div>
        </div>`;

    /* ── Body: conteúdo da ocorrência ── */
    const body = document.createElement('div');
    body.className = 'ret-card-body';

    if (isRco) {
        if (o.observacao) {
            body.innerHTML = `
                <div>
                    <div class="ret-ocorr-label">Observação registrada no RCO</div>
                    <p class="ret-ocorr-texto">"${o.observacao}"</p>
                </div>`;
        }
    } else {
        const pontos = o.pontos || 0;
        const pontosClass = pontos < 0 ? 'neg' : pontos > 0 ? 'pos' : 'zero';
        const pontosLabel = pontos === 0 ? '0 pts' : `${pontos > 0 ? '+' : ''}${pontos} pts`;
        body.innerHTML = `
            <div class="ret-categoria-row">
                <span class="ret-categoria-label">${o.categoria_label || o.categoria || '—'}</span>
                <span class="ret-pontos-badge ret-pontos--${pontosClass}">${pontosLabel}</span>
            </div>
            ${o.descricao ? `
            <div>
                <div class="ret-ocorr-label">Sua observação</div>
                <p class="ret-ocorr-texto">"${o.descricao}"</p>
            </div>` : ''}`;
    }

    card.appendChild(body);

    /* ── Divisor ── */
    const div = document.createElement('div');
    div.className = 'ret-divider';
    card.appendChild(div);

    /* ── Seção de retorno pedagógico ── */
    const secRetorno = document.createElement('div');
    secRetorno.className = 'ret-pedagogo';

    if (!temRet) {
        secRetorno.innerHTML = `
            <div class="ret-pedagogo-titulo">Retorno da equipe pedagógica</div>
            <div class="ret-aguardando-bloco">
                ⏳ Aguardando retorno da equipe pedagógica
            </div>`;
    } else {
        const nota         = o.pedagogo?.nota || '';
        const encam        = o.pedagogo?.encaminhamento || '';
        const vistoProf    = o.pedagogo?.visto_professor || false;
        const vistoProfEm  = o.pedagogo?.visto_prof_em ? isoParaBR(o.pedagogo.visto_prof_em) : '';
        const retornoEm    = o.pedagogo?.updated_at ? isoParaBR(o.pedagogo.updated_at) : '';
        const encamLabel   = encam ? (ENCAM_LABELS[encam] || encam) : '';
        const idOcorr      = o._rco_id || o.id;

        secRetorno.innerHTML = `
            <div class="ret-pedagogo-titulo">Retorno da equipe pedagógica</div>
            ${encamLabel ? `<div><span class="ret-encaminhamento-badge">${encamLabel}</span></div>` : ''}
            ${nota ? `
            <div class="ret-nota-bloco">
                <div class="ret-nota-label">Nota da equipe</div>
                <p class="ret-nota-texto">${nota}</p>
            </div>` : ''}
            <div class="ret-retorno-meta">
                ${retornoEm ? `<span class="ret-retorno-data">Retorno em ${retornoEm}</span>` : '<span></span>'}
                ${vistoProf
                    ? `<span class="ret-lido-tag">✓ Lido${vistoProfEm ? ' em ' + vistoProfEm : ''}</span>`
                    : `<button class="ret-confirmar-btn" data-id="${idOcorr}">✓ Confirmar leitura</button>`
                }
            </div>`;

        /* Evento do botão de confirmação */
        const btn = secRetorno.querySelector('.ret-confirmar-btn');
        if (btn) {
            btn.addEventListener('click', () => confirmarLeitura(btn, o));
        }
    }

    card.appendChild(secRetorno);
    return card;
}

/* ── Confirmar leitura ────────────────────────────────────────────── */
async function confirmarLeitura(btn, o) {
    btn.disabled = true;
    btn.textContent = '⏳ Confirmando…';
    try {
        const idOcorr = o._rco_id || o.id;
        const res = await fetch('/api/pedagogico/retorno/confirmar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id_ocorrencia: idOcorr }),
        });
        if (!res.ok) throw new Error();

        /* Atualiza o estado local e re-renderiza o card */
        if (o.pedagogo) {
            o.pedagogo.visto_professor = true;
            o.pedagogo.visto_prof_em = new Date().toISOString();
        }

        /* Substitui o botão pelo tag de lido */
        const meta = btn.closest('.ret-retorno-meta');
        if (meta) {
            btn.replaceWith(Object.assign(document.createElement('span'), {
                className: 'ret-lido-tag',
                textContent: '✓ Lido agora',
            }));
        }

        /* Atualiza stats e remove badge "Novo" do card */
        renderStats();
        const novoBadge = btn.closest('.ret-card')?.querySelector('.ret-novo-badge');
        if (novoBadge) novoBadge.remove();

    } catch {
        btn.disabled = false;
        btn.textContent = '✓ Confirmar leitura';
    }
}

/* ── Filtros: eventos ────────────────────────────────────────────── */
document.querySelectorAll('.ret-tipo-btn').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('.ret-tipo-btn').forEach(x => x.classList.remove('ret-tipo-btn--active'));
        b.classList.add('ret-tipo-btn--active');
        tipoFiltro = b.dataset.tipo;
        carregarDados();
    });
});

selTurma.addEventListener('change',  carregarDados);
selStatus.addEventListener('change', () => renderGrid());
selPeriodo.addEventListener('change', carregarDados);

/* ── Init ────────────────────────────────────────────────────────── */
async function init() {
    await carregarTurmas();
    await carregarDados();
}

init();
