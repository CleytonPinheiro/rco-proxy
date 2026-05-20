'use strict';

/* ── Estado ─────────────────────────────────────────────────────── */
let _classes      = [];   // lista completa do backend
let _classeAtual  = null; // { codClasse, codTurma, descrTurma, nomeDisciplina, codPeriodoAvaliacao, … }
let _dadosBoletim = null; // resposta de /api/boletim/notas

/* ── Elementos DOM ───────────────────────────────────────────────── */
const selTurma       = document.getElementById('selTurma');
const selDisciplina  = document.getElementById('selDisciplina');
const btnBuscar      = document.getElementById('btnBuscar');
const btnExportar    = document.getElementById('btnExportar');
const secResultado   = document.getElementById('secResultado');
const secVazio       = document.getElementById('secVazio');
const secLoading     = document.getElementById('secLoading');
const secErro        = document.getElementById('secErro');
const msgErro        = document.getElementById('msgErro');
const tituloRes      = document.getElementById('tituloResultado');
const subtituloRes   = document.getElementById('subtituloResultado');
const theadBoletim   = document.getElementById('theadBoletim');
const tbodyBoletim   = document.getElementById('tbodyBoletim');

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

/* ── Inicialização ───────────────────────────────────────────────── */
(async () => {
    const ok = await checkAuth();
    if (!ok) return;
    await carregarClasses();
    selTurma.addEventListener('change', onTurmaMudou);
    selDisciplina.addEventListener('change', onDisciplinaMudou);
    btnBuscar.addEventListener('click', buscarNotas);
    btnExportar.addEventListener('click', exportarCSV);
})();

/* ── Carrega lista de classes do backend ─────────────────────────── */
async function carregarClasses() {
    try {
        const r = await fetch('/api/boletim/classes');
        if (!r.ok) {
            mostrarErro('Não foi possível carregar as turmas e disciplinas.');
            return;
        }
        _classes = await r.json();

        /* Aplica filtro de escola se gravado no localStorage */
        const raw = localStorage.getItem('edusync_escola_codturmas');
        if (raw) {
            try {
                const codsTurmaEscola = JSON.parse(raw);
                if (Array.isArray(codsTurmaEscola) && codsTurmaEscola.length) {
                    _classes = _classes.filter(c => codsTurmaEscola.includes(c.codTurma));
                }
            } catch { /* ignora */ }
        }

        popularSelTurmas();
    } catch (e) {
        mostrarErro('Erro de rede ao carregar classes: ' + e.message);
    }
}

/* ── Popula select de turmas (distinct) ──────────────────────────── */
function popularSelTurmas() {
    const turmasVistas = new Map(); // codTurma → descrTurma
    for (const c of _classes) {
        if (!turmasVistas.has(c.codTurma)) turmasVistas.set(c.codTurma, c.descrTurma);
    }

    selTurma.innerHTML = '<option value="">— selecione a turma —</option>';
    for (const [cod, descr] of [...turmasVistas].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) {
        const opt = document.createElement('option');
        opt.value       = cod;
        opt.textContent = descr;
        selTurma.appendChild(opt);
    }
}

/* ── Turma selecionada → popula disciplinas ──────────────────────── */
function onTurmaMudou() {
    const codTurma = selTurma.value;
    selDisciplina.innerHTML = '<option value="">— selecione a disciplina —</option>';
    selDisciplina.disabled  = !codTurma;
    btnBuscar.disabled      = true;
    ocultarResultado();

    if (!codTurma) return;

    const disciplinas = _classes
        .filter(c => String(c.codTurma) === String(codTurma))
        .sort((a, b) => a.nomeDisciplina.localeCompare(b.nomeDisciplina, 'pt-BR'));

    for (const c of disciplinas) {
        const opt = document.createElement('option');
        opt.value       = c.codClasse;
        opt.textContent = c.nomeDisciplina + (c.siglaDisciplina ? ` (${c.siglaDisciplina})` : '');
        selDisciplina.appendChild(opt);
    }
    selDisciplina.disabled = false;
}

/* ── Disciplina selecionada → habilita botão ─────────────────────── */
function onDisciplinaMudou() {
    btnBuscar.disabled = !selDisciplina.value;
    ocultarResultado();
}

/* ── Busca notas no backend ──────────────────────────────────────── */
async function buscarNotas() {
    const codClasse = selDisciplina.value;
    if (!codClasse) return;

    _classeAtual = _classes.find(c => String(c.codClasse) === String(codClasse)) ?? null;
    const codPeriodo = _classeAtual?.codPeriodoAvaliacao ?? 9;

    mostrarLoading(true);
    ocultarResultado();

    try {
        const r = await fetch(`/api/boletim/notas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodo}`);
        const json = await r.json();

        if (!r.ok) {
            mostrarErro(json.erro || `Erro ${r.status} ao buscar notas.`);
            return;
        }

        _dadosBoletim = json;
        renderizarTabela(json);
    } catch (e) {
        mostrarErro('Erro de rede: ' + e.message);
    } finally {
        mostrarLoading(false);
    }
}

/* ── Renderiza tabela de notas ───────────────────────────────────── */
function renderizarTabela(dados) {
    const alunos = dados.alunos ?? [];

    if (alunos.length === 0) {
        mostrarErro('Nenhum aluno com notas encontrado para esta classe no RCO.');
        return;
    }

    /* Descobre todas as avaliações (colunas dinâmicas) */
    const colunasSet = new Set();
    for (const a of alunos) {
        for (const av of (a.avaliacoes ?? [])) {
            const key = av.nomeAvaliacao ?? av.codAvaliacaoParcialClasse ?? av.titulo ?? 'Av.';
            colunasSet.add(key);
        }
    }
    const colunas = [...colunasSet];

    /* --- THEAD --- */
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <th class="bol-nota-th" title="Número de chamada">#</th>
        <th>Aluno</th>
        ${colunas.map(c => `<th class="bol-nota-th">${escHtml(c)}</th>`).join('')}
        ${colunas.length > 1 ? '<th class="bol-nota-th">Média</th>' : ''}
    `;
    theadBoletim.innerHTML = '';
    theadBoletim.appendChild(tr);

    /* --- TBODY --- */
    tbodyBoletim.innerHTML = '';
    for (const aluno of alunos) {
        const avMap = {};
        for (const av of (aluno.avaliacoes ?? [])) {
            const key = av.nomeAvaliacao ?? av.codAvaliacaoParcialClasse ?? av.titulo ?? 'Av.';
            avMap[key] = av.notaDecimal ?? av.nota ?? null;
        }

        let soma = 0, cnt = 0;
        const notasCells = colunas.map(c => {
            const nota = avMap[c] ?? null;
            if (nota !== null && nota !== undefined) { soma += Number(nota); cnt++; }
            return `<td class="bol-td-nota">${badgeNota(nota)}</td>`;
        }).join('');

        const media = cnt > 0 ? (soma / cnt) : null;
        const mediaCls = media === null ? 'bol-media-none'
            : media >= 6 ? 'bol-media-ok'
            : media >= 5 ? 'bol-media-med'
            : 'bol-media-bad';
        const mediaHtml = colunas.length > 1
            ? `<td class="bol-td-media"><span class="bol-media-val ${mediaCls}">${media !== null ? media.toFixed(1) : '—'}</span></td>`
            : '';

        const rowTr = document.createElement('tr');
        rowTr.innerHTML = `
            <td class="bol-td-chamada">${escHtml(aluno.numChamada ?? '—')}</td>
            <td class="bol-td-nome">${escHtml(aluno.nome ?? '—')}</td>
            ${notasCells}
            ${mediaHtml}
        `;
        tbodyBoletim.appendChild(rowTr);
    }

    /* Título */
    if (_classeAtual) {
        tituloRes.textContent   = `${_classeAtual.descrTurma} — ${_classeAtual.nomeDisciplina}`;
        subtituloRes.textContent = `${alunos.length} aluno${alunos.length !== 1 ? 's' : ''} · ${colunas.length} avaliação${colunas.length !== 1 ? 'ões' : ''}`;
    }

    secVazio.style.display    = 'none';
    secErro.style.display     = 'none';
    secResultado.style.display = '';
}

/* ── Badge de nota com cor ───────────────────────────────────────── */
function badgeNota(nota) {
    if (nota === null || nota === undefined || nota === '') {
        return '<span class="bol-nota-val bol-nota-none">—</span>';
    }
    const n = Number(nota);
    const cls = isNaN(n) ? 'bol-nota-none'
        : n >= 6 ? 'bol-nota-ok'
        : n >= 5 ? 'bol-nota-med'
        : 'bol-nota-bad';
    return `<span class="bol-nota-val ${cls}">${isNaN(n) ? escHtml(String(nota)) : n.toFixed(1)}</span>`;
}

/* ── Exportar CSV ────────────────────────────────────────────────── */
function exportarCSV() {
    if (!_dadosBoletim) return;
    const alunos = _dadosBoletim.alunos ?? [];
    if (!alunos.length) return;

    const colunasSet = new Set();
    for (const a of alunos) {
        for (const av of (a.avaliacoes ?? [])) {
            colunasSet.add(av.nomeAvaliacao ?? av.codAvaliacaoParcialClasse ?? av.titulo ?? 'Av.');
        }
    }
    const colunas = [...colunasSet];

    const cabecalho = ['#', 'Aluno', ...colunas, ...(colunas.length > 1 ? ['Média'] : [])];
    const linhas = [cabecalho.map(csvCell).join(';')];

    for (const a of alunos) {
        const avMap = {};
        for (const av of (a.avaliacoes ?? [])) {
            avMap[av.nomeAvaliacao ?? av.codAvaliacaoParcialClasse ?? av.titulo ?? 'Av.'] = av.notaDecimal ?? av.nota ?? '';
        }
        let soma = 0, cnt = 0;
        const notas = colunas.map(c => {
            const n = avMap[c];
            if (n !== undefined && n !== null && n !== '') { soma += Number(n); cnt++; }
            return n !== undefined && n !== null && n !== '' ? String(n).replace('.', ',') : '';
        });
        const media = cnt > 0 ? (soma / cnt).toFixed(1).replace('.', ',') : '';
        linhas.push([a.numChamada ?? '', a.nome ?? '', ...notas, ...(colunas.length > 1 ? [media] : [])].map(csvCell).join(';'));
    }

    const bom = '\uFEFF';
    const blob = new Blob([bom + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const nome = _classeAtual
        ? `boletim_${_classeAtual.descrTurma}_${_classeAtual.siglaDisciplina || _classeAtual.nomeDisciplina}`.replace(/[^a-z0-9_]/gi, '_')
        : 'boletim';
    a.href     = url;
    a.download = `${nome}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function csvCell(v) {
    const s = String(v ?? '');
    return s.includes(';') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ── Helpers de estado visual ────────────────────────────────────── */
function mostrarLoading(show) {
    secLoading.style.display = show ? '' : 'none';
    secVazio.style.display   = show ? 'none' : (secResultado.style.display === 'none' && secErro.style.display === 'none' ? '' : 'none');
    btnBuscar.disabled       = show;
}

function ocultarResultado() {
    secResultado.style.display = 'none';
    secErro.style.display      = 'none';
    secVazio.style.display     = '';
}

function mostrarErro(msg) {
    msgErro.textContent        = msg;
    secErro.style.display      = '';
    secResultado.style.display = 'none';
    secVazio.style.display     = 'none';
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
