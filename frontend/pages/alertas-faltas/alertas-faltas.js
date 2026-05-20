'use strict';

/* ── Estado ─────────────────────────────────────────────────────── */
let _dadosAtuais = null;   // resposta bruta do backend
let _filtroNome  = '';

/* ── Elementos DOM ───────────────────────────────────────────────── */
const btnAtualizar  = document.getElementById('btnAtualizar');
const selTurma      = document.getElementById('selTurma');
const inpConsec     = document.getElementById('inpConsec');
const inpTotal      = document.getElementById('inpTotal');
const inpBusca      = document.getElementById('inpBusca');
const txtConsec     = document.getElementById('txtConsec');
const txtTotal      = document.getElementById('txtTotal');
const secInicial    = document.getElementById('secInicial');
const secLoading    = document.getElementById('secLoading');
const secVazio      = document.getElementById('secVazio');
const secErro       = document.getElementById('secErro');
const secResultado  = document.getElementById('secResultado');
const msgErro       = document.getElementById('msgErro');
const lblTotal      = document.getElementById('lblTotal');
const lblProcessado = document.getElementById('lblProcessado');
const listaAlertas  = document.getElementById('listaAlertas');
const btnExportar   = document.getElementById('btnExportar');

/* ── Auth guard ─────────────────────────────────────────────────── */
async function checkAuth() {
    try {
        const r = await fetch('/api/me');
        if (!r.ok) { location.href = '/'; return false; }
        const u = await r.json();
        if (!u?.perfil) { location.href = '/'; return false; }
        return true;
    } catch { location.href = '/'; return false; }
}

/* ── Bootstrap ───────────────────────────────────────────────────── */
(async () => {
    const ok = await checkAuth();
    if (!ok) return;

    await carregarTurmas();

    btnAtualizar.addEventListener('click', analisar);
    btnExportar.addEventListener('click', exportarCSV);
    inpBusca.addEventListener('input', () => {
        _filtroNome = inpBusca.value.trim().toLowerCase();
        if (_dadosAtuais) renderizarLista(_dadosAtuais);
    });
    inpConsec.addEventListener('change', atualizarSubtitulo);
    inpTotal.addEventListener('change',  atualizarSubtitulo);
    atualizarSubtitulo();

    /* Aplica filtro de escola ativa */
    try {
        const raw = localStorage.getItem('edusync_escola_codturmas');
        if (raw) {
            const cods = JSON.parse(raw);
            [...selTurma.options].forEach(opt => {
                if (opt.value && !cods.includes(Number(opt.value))) opt.remove();
            });
        }
    } catch {}
})();

function atualizarSubtitulo() {
    txtConsec.textContent = inpConsec.value || 3;
    txtTotal.textContent  = inpTotal.value  || 5;
}

/* ── Carrega lista de turmas no seletor ──────────────────────────── */
async function carregarTurmas() {
    try {
        const r = await fetch('/api/alertas-faltas/turmas');
        if (!r.ok) return;
        const turmas = await r.json();
        turmas.forEach(t => {
            const opt = document.createElement('option');
            opt.value       = t.cod_turma;
            opt.textContent = t.descr_turma;
            selTurma.appendChild(opt);
        });
    } catch { /* ignora — filtro de turma é opcional */ }
}

/* ── Analisa todas as classes ────────────────────────────────────── */
async function analisar() {
    const minConsec = Number(inpConsec.value) || 3;
    const minTotal  = Number(inpTotal.value)  || 5;
    const codTurma  = selTurma.value;

    mostrarEstado('loading');
    _dadosAtuais = null;

    const params = new URLSearchParams({
        minConsecutivas: minConsec,
        minTotal,
        ...(codTurma ? { codTurma } : {}),
    });

    try {
        const r = await fetch(`/api/alertas-faltas?${params}`);
        const json = await r.json();
        if (!r.ok) {
            mostrarErro(json.erro || `Erro ${r.status}`);
            return;
        }
        _dadosAtuais = json;
        renderizarLista(json);
    } catch (e) {
        mostrarErro('Erro de rede: ' + e.message);
    }
}

/* ── Renderiza lista de alertas ──────────────────────────────────── */
function renderizarLista(dados) {
    let alertas = dados.alertas ?? [];

    /* Filtro de nome */
    if (_filtroNome) {
        alertas = alertas.filter(a => (a.nome ?? '').toLowerCase().includes(_filtroNome));
    }

    lblTotal.textContent      = `${alertas.length} aluno${alertas.length !== 1 ? 's' : ''} em alerta`;
    lblProcessado.textContent = `${dados.processado} classe${dados.processado !== 1 ? 's' : ''} analisada${dados.processado !== 1 ? 's' : ''}`;

    if (alertas.length === 0) {
        mostrarEstado(_filtroNome ? 'resultado-vazio-filtro' : 'vazio');
        return;
    }

    listaAlertas.innerHTML = '';
    alertas.forEach(aluno => listaAlertas.appendChild(renderCard(aluno, dados.minConsec, dados.minTotal)));
    mostrarEstado('resultado');
}

/* ── Renderiza um card de aluno ──────────────────────────────────── */
function renderCard(aluno, minConsec, minTotal) {
    const maxFaltas = Math.max(...aluno.disciplinas.map(d => d.totalFaltas));
    const maxConsec = Math.max(...aluno.disciplinas.map(d => d.maxConsecutivas));
    const nDisc     = aluno.disciplinas.length;

    const card = document.createElement('div');
    card.className = 'af-aluno-card';

    /* Cabeçalho clicável */
    const header = document.createElement('div');
    header.className = 'af-aluno-header';
    header.innerHTML = `
        <div class="af-aluno-chamada">${escHtml(aluno.numChamada ?? '?')}</div>
        <div class="af-aluno-nome">${escHtml(aluno.nome ?? '—')}</div>
        <div class="af-aluno-resumo">
            <span class="af-pill af-pill-disc">📚 ${nDisc} disciplina${nDisc !== 1 ? 's' : ''}</span>
            ${maxFaltas >= (minTotal ?? 5) ? `<span class="af-pill af-pill-total">❌ ${maxFaltas} falta${maxFaltas !== 1 ? 's' : ''}</span>` : ''}
            ${maxConsec >= (minConsec ?? 3) ? `<span class="af-pill af-pill-consec">🔴 ${maxConsec} seguida${maxConsec !== 1 ? 's' : ''}</span>` : ''}
        </div>
        <span class="af-chevron">▼</span>
    `;
    header.addEventListener('click', () => {
        card.classList.toggle('aberto');
    });

    /* Detalhes por disciplina */
    const detalhes = document.createElement('div');
    detalhes.className = 'af-detalhes';

    aluno.disciplinas
        .sort((a, b) => b.totalFaltas - a.totalFaltas)
        .forEach(disc => {
            const row = document.createElement('div');
            row.className = 'af-disc-row';

            /* Dias destacando sequências consecutivas */
            const seqSet = new Set(disc.sequencias.flat());
            const chipsHtml = disc.datasAulas.map(dt =>
                `<span class="af-dia-chip${seqSet.has(dt) ? ' consec' : ''}" title="${seqSet.has(dt) ? 'Falta seguida' : 'Falta isolada'}">${escHtml(dt)}</span>`
            ).join('');

            const temConsec = disc.maxConsecutivas >= (minConsec ?? 3);
            const temTotal  = disc.totalFaltas     >= (minTotal  ?? 5);

            row.innerHTML = `
                <div class="af-disc-nome">
                    <strong>${escHtml(disc.disciplina)}${disc.sigla ? ` <em style="opacity:.65;font-style:normal">(${escHtml(disc.sigla)})</em>` : ''}</strong>
                    <span class="af-disc-turma">${escHtml(disc.turma)}</span>
                </div>
                <div class="af-disc-badges">
                    <div class="af-badge-faltas">
                        ${temTotal  ? `<span class="af-badge-num total">❌ ${disc.totalFaltas} falta${disc.totalFaltas !== 1 ? 's' : ''}</span>` : `<span class="af-badge-num" style="background:var(--bg-subtle);color:var(--text-secondary)">${disc.totalFaltas} falta${disc.totalFaltas !== 1 ? 's' : ''}</span>`}
                        ${temConsec ? `<span class="af-badge-num consec">🔴 ${disc.maxConsecutivas} seguida${disc.maxConsecutivas !== 1 ? 's' : ''}</span>` : ''}
                    </div>
                    ${chipsHtml ? `<div class="af-dias">${chipsHtml}</div>` : '<div class="af-dias"><em style="font-size:.78rem;color:var(--text-secondary)">datas não disponíveis</em></div>'}
                    ${disc.sequencias.length ? `<div style="font-size:.75rem;color:var(--text-secondary);margin-top:.2rem">🟡 chips amarelos = sequências consecutivas</div>` : ''}
                </div>
            `;
            detalhes.appendChild(row);
        });

    card.appendChild(header);
    card.appendChild(detalhes);
    return card;
}

/* ── Exportar CSV ────────────────────────────────────────────────── */
function exportarCSV() {
    if (!_dadosAtuais) return;
    let alertas = _dadosAtuais.alertas ?? [];
    if (_filtroNome) alertas = alertas.filter(a => (a.nome ?? '').toLowerCase().includes(_filtroNome));
    if (!alertas.length) return;

    const linhas = [
        ['Aluno', 'Chamada', 'Disciplina', 'Turma', 'Total Faltas', 'Máx. Consecutivas', 'Datas das Faltas'].join(';')
    ];
    for (const aluno of alertas) {
        for (const disc of aluno.disciplinas) {
            linhas.push([
                csvCell(aluno.nome),
                csvCell(aluno.numChamada ?? ''),
                csvCell(disc.disciplina),
                csvCell(disc.turma),
                disc.totalFaltas,
                disc.maxConsecutivas,
                csvCell(disc.datasAulas.join(', ')),
            ].join(';'));
        }
    }

    const bom  = '\uFEFF';
    const blob = new Blob([bom + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'alertas_faltas.csv';
    a.click();
    URL.revokeObjectURL(url);
}

/* ── Helpers de estado ───────────────────────────────────────────── */
function mostrarEstado(estado) {
    secInicial.style.display   = 'none';
    secLoading.style.display   = 'none';
    secVazio.style.display     = 'none';
    secErro.style.display      = 'none';
    secResultado.style.display = 'none';

    if (estado === 'loading')              { secLoading.style.display   = ''; btnAtualizar.disabled = true; }
    else if (estado === 'vazio')           { secVazio.style.display     = ''; secResultado.style.display = ''; btnAtualizar.disabled = false; }
    else if (estado === 'resultado-vazio-filtro') { secResultado.style.display = ''; listaAlertas.innerHTML = `<div class="af-estado"><span class="af-estado-icone">🔍</span><p>Nenhum aluno encontrado com o filtro "<strong>${escHtml(_filtroNome)}</strong>".</p></div>`; btnAtualizar.disabled = false; }
    else if (estado === 'resultado')       { secResultado.style.display = ''; btnAtualizar.disabled = false; }
    else if (estado === 'erro')            { secErro.style.display      = ''; btnAtualizar.disabled = false; }
    else                                   { secInicial.style.display   = ''; btnAtualizar.disabled = false; }
}

function mostrarErro(msg) {
    msgErro.textContent = msg;
    mostrarEstado('erro');
}

function csvCell(v) {
    const s = String(v ?? '');
    return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
