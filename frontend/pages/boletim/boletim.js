'use strict';

/* ── Estado ─────────────────────────────────────────────────────── */
let _classes      = [];
let _classeAtual  = null;
let _dadosBoletim = null;

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
        if (!r.ok) { mostrarErro('Não foi possível carregar as turmas e disciplinas.'); return; }
        _classes = await r.json();

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

function popularSelTurmas() {
    const turmasVistas = new Map();
    for (const c of _classes) {
        if (!turmasVistas.has(c.codTurma)) turmasVistas.set(c.codTurma, c.descrTurma);
    }
    selTurma.innerHTML = '<option value="">— selecione a turma —</option>';
    for (const [cod, descr] of [...turmasVistas].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) {
        const opt = document.createElement('option');
        opt.value = cod; opt.textContent = descr;
        selTurma.appendChild(opt);
    }
}

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
        opt.value = c.codClasse;
        opt.textContent = c.nomeDisciplina + (c.siglaDisciplina ? ` (${c.siglaDisciplina})` : '');
        selDisciplina.appendChild(opt);
    }
    selDisciplina.disabled = false;
}

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
        const r    = await fetch(`/api/boletim/notas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPeriodo}`);
        const json = await r.json();
        if (!r.ok) { mostrarErro(json.erro || `Erro ${r.status} ao buscar notas.`); return; }
        _dadosBoletim = json;
        renderizarTabela(json);
    } catch (e) {
        mostrarErro('Erro de rede: ' + e.message);
    } finally {
        mostrarLoading(false);
    }
}

/* ── Normaliza colunas e grades (suporta formato novo e legado) ──── */
function normalizarDados(dados) {
    const alunos = dados.alunos ?? [];

    /* Formato novo: dados.colunas + aluno.notas{} */
    if (dados.colunas?.length) {
        return {
            colunas: dados.colunas,
            getNota: (aluno, col) => aluno.notas?.[String(col.id)] ?? null,
        };
    }

    /* Formato legado: descobrir colunas dos alunos[].avaliacoes[] */
    const seen = new Set();
    const colunas = [];
    for (const a of alunos) {
        for (const av of (a.avaliacoes ?? [])) {
            const id = String(av.codAvaliacaoParcialClasse ?? av.nomeAvaliacao ?? 'av');
            if (!seen.has(id)) {
                seen.add(id);
                colunas.push({
                    id,
                    nome:         av.nomeAvaliacao ?? id,
                    tipo:         av.tipo          ?? 'principal',
                    avPrincipalId: av.avPrincipalId ?? null,
                });
            }
        }
    }
    return {
        colunas,
        getNota: (aluno, col) => {
            const av = (aluno.avaliacoes ?? []).find(a => String(a.codAvaliacaoParcialClasse ?? a.nomeAvaliacao) === String(col.id));
            return av?.notaDecimal ?? av?.nota ?? null;
        },
    };
}

/* ── Calcula Nota Final: soma de max(principal, recuperação) ─────── */
function calcNotaFinal(aluno, colunas, getNota) {
    /* Mapa principal → [recIds] */
    const pairMap = {};
    for (const col of colunas) {
        if (col.tipo === 'recuperacao' && col.avPrincipalId) {
            const key = String(col.avPrincipalId);
            if (!pairMap[key]) pairMap[key] = [];
            pairMap[key].push(String(col.id));
        }
    }
    let total = 0, temAlguma = false;
    for (const col of colunas) {
        if (col.tipo !== 'principal') continue;
        const mainNota = getNota(aluno, col);
        const recs     = pairMap[String(col.id)] ?? [];
        let best       = mainNota;
        for (const recId of recs) {
            const recNota = aluno.notas ? (aluno.notas[recId] ?? null)
                : getNota(aluno, { id: recId });
            if (recNota !== null && (best === null || Number(recNota) > Number(best))) best = recNota;
        }
        if (best !== null) { total += Number(best); temAlguma = true; }
    }
    return temAlguma ? total : null;
}

/* ── Renderiza tabela de notas ───────────────────────────────────── */
function renderizarTabela(dados) {
    const alunos = dados.alunos ?? [];
    if (alunos.length === 0) {
        mostrarErro('Nenhum aluno encontrado para esta classe no RCO.');
        return;
    }

    const { colunas, getNota } = normalizarDados(dados);
    const temRecuperacao = colunas.some(c => c.tipo === 'recuperacao');

    /* ── THEAD ── */
    const tr = document.createElement('tr');
    const thsAv = colunas.map(col => {
        const isRec = col.tipo === 'recuperacao';
        return `<th class="bol-nota-th${isRec ? ' bol-th-rec' : ''}">${escHtml(col.nome)}</th>`;
    }).join('');
    tr.innerHTML = `
        <th class="bol-nota-th" title="Número de chamada">#</th>
        <th>Aluno</th>
        ${thsAv}
        <th class="bol-nota-th bol-th-final">${temRecuperacao ? 'Nota Final' : 'Total'}</th>
    `;
    theadBoletim.innerHTML = '';
    theadBoletim.appendChild(tr);

    /* ── TBODY ── */
    tbodyBoletim.innerHTML = '';
    for (const aluno of alunos) {
        const notasCells = colunas.map(col => {
            const nota  = getNota(aluno, col);
            const isRec = col.tipo === 'recuperacao';
            return `<td class="bol-td-nota${isRec ? ' bol-td-rec' : ''}">${badgeNota(nota)}</td>`;
        }).join('');

        const nf    = calcNotaFinal(aluno, colunas, getNota);
        const nfCls = nf === null ? 'bol-media-none'
            : nf >= 6 ? 'bol-media-ok'
            : nf >= 5 ? 'bol-media-med'
            : 'bol-media-bad';
        const nfHtml = `<td class="bol-td-media"><span class="bol-media-val ${nfCls}">${nf !== null ? nf.toFixed(1) : '—'}</span></td>`;

        const rowTr = document.createElement('tr');
        rowTr.innerHTML = `
            <td class="bol-td-chamada">${escHtml(aluno.numChamada ?? '—')}</td>
            <td class="bol-td-nome">${escHtml(aluno.nome ?? '—')}</td>
            ${notasCells}
            ${nfHtml}
        `;
        tbodyBoletim.appendChild(rowTr);
    }

    /* ── Título ── */
    if (_classeAtual) {
        tituloRes.textContent = `${_classeAtual.descrTurma} — ${_classeAtual.nomeDisciplina}`;
        const nPrincipais = colunas.filter(c => c.tipo === 'principal').length;
        const nRec        = colunas.filter(c => c.tipo === 'recuperacao').length;
        const avParte     = `${nPrincipais} avaliação${nPrincipais !== 1 ? 'ões' : ''}`;
        const recParte    = nRec ? ` + ${nRec} recuperação${nRec > 1 ? 'ões' : ''}` : '';
        subtituloRes.textContent = `${alunos.length} aluno${alunos.length !== 1 ? 's' : ''} · ${avParte}${recParte}`;
    }

    secVazio.style.display     = 'none';
    secErro.style.display      = 'none';
    secResultado.style.display = '';
}

/* ── Badge de nota com cor ───────────────────────────────────────── */
function badgeNota(nota) {
    if (nota === null || nota === undefined || nota === '') {
        return '<span class="bol-nota-val bol-nota-none">—</span>';
    }
    const n   = Number(nota);
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

    const { colunas, getNota } = normalizarDados(_dadosBoletim);
    const temRecuperacao = colunas.some(c => c.tipo === 'recuperacao');

    const cabecalho = [
        '#', 'Aluno',
        ...colunas.map(c => c.nome + (c.tipo === 'recuperacao' ? ' (Rec)' : '')),
        temRecuperacao ? 'Nota Final' : 'Total',
    ];
    const linhas = [cabecalho.map(csvCell).join(';')];

    for (const a of alunos) {
        const notas = colunas.map(col => {
            const n = getNota(a, col);
            return n !== null && n !== undefined ? String(n).replace('.', ',') : '';
        });
        const nf  = calcNotaFinal(a, colunas, getNota);
        const nfs = nf !== null ? nf.toFixed(1).replace('.', ',') : '';
        linhas.push([a.numChamada ?? '', a.nome ?? '', ...notas, nfs].map(csvCell).join(';'));
    }

    const bom  = '\uFEFF';
    const blob = new Blob([bom + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const el   = document.createElement('a');
    const nome = _classeAtual
        ? `boletim_${_classeAtual.descrTurma}_${_classeAtual.siglaDisciplina || _classeAtual.nomeDisciplina}`.replace(/[^a-z0-9_]/gi, '_')
        : 'boletim';
    el.href     = url;
    el.download = `${nome}.csv`;
    el.click();
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
    secVazio.style.display   = show ? 'none'
        : (secResultado.style.display === 'none' && secErro.style.display === 'none' ? '' : 'none');
    btnBuscar.disabled = show;
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
