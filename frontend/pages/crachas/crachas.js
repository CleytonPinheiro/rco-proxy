// ── Crachás — Gerenciamento de Crachás dos Alunos ────────────────────────────

const API = '';
let todosAlunos     = [];    // [{codMatrizAluno, nome, codTurma, descrTurma, numChamada, serie}]
let statusMap       = {};    // codMatrizAluno → {status, data_impressao, data_entrega, obs}
let turmaAtual      = 'todos';
let selecionados    = new Set();

// ── Auth guard ────────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        if (!d.credenciaisConfiguradas) { window.location.href = '/'; return false; }
        return true;
    } catch { window.location.href = '/'; return false; }
}

document.getElementById('btnLogout').addEventListener('click', async () => {
    await fetch(`${API}/api/logout`, { method: 'POST' });
    window.location.href = '/';
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
    const ok = await checkAuth();
    if (!ok) return;

    try {
        const [alunosResp, crachasResp] = await Promise.all([
            fetch(`${API}/api/alunos`),
            fetch(`${API}/api/crachas`)
        ]);

        if (!alunosResp.ok) throw new Error(`Alunos: HTTP ${alunosResp.status}`);
        const alunos = await alunosResp.json();

        // crachas pode retornar vazio se tabela ainda não existir
        let crachas = [];
        if (crachasResp.ok) {
            crachas = await crachasResp.json();
        }

        // Montar statusMap
        for (const c of crachas) {
            statusMap[c.cod_matriz_aluno] = {
                status:          c.status || 'pendente',
                data_impressao:  c.data_impressao,
                data_entrega:    c.data_entrega,
                obs:             c.obs || ''
            };
        }

        // Normalizar alunos (suporta colunas com e sem underscore)
        todosAlunos = alunos.map(a => {
            const descrTurma = a.descr_turma || a.descrTurma || a.turma || '';
            return {
                codMatrizAluno: a.cod_matriz_aluno || a.codMatrizAluno || a.codmatrizaluno,
                nome:           a.nome || '(sem nome)',
                codTurma:       a.cod_turma || a.codTurma || a.codturma,
                descrTurma,
                numChamada:     a.num_chamada || a.numChamada || a.numchamada || '',
                serie:          extrairSerie(descrTurma),
            };
        });

        todosAlunos.sort((a, b) => {
            if (a.descrTurma < b.descrTurma) return -1;
            if (a.descrTurma > b.descrTurma) return 1;
            return (a.numChamada || 0) - (b.numChamada || 0);
        });

    } catch (e) {
        mostrarToast('Erro ao carregar dados: ' + e.message, 'erro');
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    renderTabs();
    filtrar();
}

function extrairSerie(descrTurma) {
    const m = descrTurma.match(/(\d+[ªa°]?\s*[Ss][ée]rie)/i);
    return m ? m[1] : descrTurma.split(' - ')[0] || '';
}

// ── Tabs de turma ─────────────────────────────────────────────────────────────
function renderTabs() {
    const turmasUnicas = [...new Set(todosAlunos.map(a => a.descrTurma))].sort();
    const container = document.getElementById('turmaTabs');

    container.innerHTML = `
        <button class="turma-tab ${turmaAtual === 'todos' ? 'active' : ''}" onclick="selecionarTurma('todos')">
            Todas (${todosAlunos.length})
        </button>
        ${turmasUnicas.map(t => {
            const count = todosAlunos.filter(a => a.descrTurma === t).length;
            const id    = t;
            return `<button class="turma-tab ${turmaAtual === id ? 'active' : ''}" onclick="selecionarTurma('${t.replace(/'/g,"\\'")}')">
                ${t} <span class="tab-count">${count}</span>
            </button>`;
        }).join('')}
    `;
}

function selecionarTurma(turma) {
    turmaAtual = turma;
    selecionados.clear();
    renderTabs();
    filtrar();
}

// ── Filtrar e renderizar ──────────────────────────────────────────────────────
function filtrar() {
    const busca  = (document.getElementById('inputBusca')?.value || '').toLowerCase();
    const status = document.getElementById('filtroStatus')?.value || '';

    let lista = todosAlunos;
    if (turmaAtual !== 'todos') lista = lista.filter(a => a.descrTurma === turmaAtual);
    if (busca)  lista = lista.filter(a => a.nome.toLowerCase().includes(busca));
    if (status) lista = lista.filter(a => (statusMap[a.codMatrizAluno]?.status || 'pendente') === status);

    renderLista(lista);
    atualizarStats();
    atualizarBtnImprimir();
}

function renderLista(lista) {
    const container = document.getElementById('listaAlunos');

    if (lista.length === 0) {
        container.innerHTML = `
            <div class="empty-crachas">
                <div class="empty-icon">🪪</div>
                <p>Nenhum aluno encontrado</p>
            </div>`;
        return;
    }

    // Agrupar por turma para exibir em seções
    const grupos = {};
    for (const a of lista) {
        const key = a.descrTurma || 'Sem turma';
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(a);
    }

    container.innerHTML = Object.entries(grupos).map(([turma, alunos]) => {
        const todosSelTurma = alunos.every(a => selecionados.has(a.codMatrizAluno));
        const cor = corTurma(turma);
        return `
        <div class="turma-secao">
            <div class="turma-secao-header" style="--cor-turma: ${cor}">
                <div class="turma-secao-left">
                    <input type="checkbox" class="chk-turma"
                        ${todosSelTurma ? 'checked' : ''}
                        onchange="toggleTurma('${turma.replace(/'/g,"\\'")}')" title="Selecionar todos da turma">
                    <span class="turma-secao-nome">${turma}</span>
                    <span class="turma-secao-count">${alunos.length} alunos</span>
                </div>
                <div class="turma-secao-acoes">
                    <button class="btn-marcar-grupo" onclick="marcarGrupo('${turma.replace(/'/g,"\\'")}', 'impresso')">✅ Marcar impressos</button>
                    <button class="btn-marcar-grupo" onclick="marcarGrupo('${turma.replace(/'/g,"\\'")}', 'entregue')">🤝 Marcar entregues</button>
                </div>
            </div>
            <div class="alunos-grid-crachas">
                ${alunos.map(a => renderCardAluno(a)).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderCardAluno(a) {
    const st   = statusMap[a.codMatrizAluno]?.status || 'pendente';
    const sel  = selecionados.has(a.codMatrizAluno);
    const info = statusMap[a.codMatrizAluno];

    const dataImp = info?.data_impressao ? new Date(info.data_impressao).toLocaleDateString('pt-BR') : null;
    const dataEnt = info?.data_entrega   ? new Date(info.data_entrega).toLocaleDateString('pt-BR')   : null;

    return `
    <div class="aluno-cracha-card status-${st} ${sel ? 'selecionado' : ''}" data-id="${a.codMatrizAluno}">
        <div class="card-check-area" onclick="toggleSel(${a.codMatrizAluno})">
            <input type="checkbox" class="chk-aluno" ${sel ? 'checked' : ''} onclick="event.stopPropagation(); toggleSel(${a.codMatrizAluno})">
        </div>
        <div class="card-chamada">${a.numChamada || '—'}</div>
        <div class="card-info">
            <div class="card-nome">${a.nome}</div>
            <div class="card-turma-mini">${a.descrTurma}</div>
            <div class="card-status-badge badge-${st}">${labelStatus(st)}</div>
            ${dataImp ? `<div class="card-data-info">🖨️ ${dataImp}</div>` : ''}
            ${dataEnt ? `<div class="card-data-info">🤝 ${dataEnt}</div>` : ''}
        </div>
        <div class="card-acoes">
            ${st !== 'impresso'  ? `<button class="btn-status-mini btn-impresso"  onclick="atualizarStatus(${a.codMatrizAluno},'impresso')"  title="Marcar como impresso">🖨️</button>` : ''}
            ${st !== 'entregue'  ? `<button class="btn-status-mini btn-entregue"  onclick="atualizarStatus(${a.codMatrizAluno},'entregue')"  title="Marcar como entregue">🤝</button>` : ''}
            ${st !== 'pendente'  ? `<button class="btn-status-mini btn-pendente"  onclick="atualizarStatus(${a.codMatrizAluno},'pendente')"  title="Reverter para pendente">↩️</button>` : ''}
        </div>
    </div>`;
}

function labelStatus(st) {
    return { pendente: '⏳ Pendente', impresso: '✅ Impresso', entregue: '🤝 Entregue' }[st] || st;
}

// ── Seleção ───────────────────────────────────────────────────────────────────
function toggleSel(id) {
    if (selecionados.has(id)) selecionados.delete(id);
    else selecionados.add(id);
    atualizarBtnImprimir();
    // Re-render apenas o card
    const card = document.querySelector(`.aluno-cracha-card[data-id="${id}"]`);
    if (card) {
        const aluno = todosAlunos.find(a => a.codMatrizAluno === id);
        if (aluno) card.outerHTML = renderCardAluno(aluno);
    }
}

function toggleTurma(turma) {
    const alunosTurma = todosAlunos.filter(a => a.descrTurma === turma);
    const todosJaSel  = alunosTurma.every(a => selecionados.has(a.codMatrizAluno));
    if (todosJaSel) alunosTurma.forEach(a => selecionados.delete(a.codMatrizAluno));
    else alunosTurma.forEach(a => selecionados.add(a.codMatrizAluno));
    atualizarBtnImprimir();
    filtrar();
}

function atualizarBtnImprimir() {
    const btn = document.getElementById('btnImprimirSel');
    const cnt = document.getElementById('countSel');
    if (!btn) return;
    cnt.textContent = selecionados.size;
    btn.disabled = selecionados.size === 0;
}

// ── Status ────────────────────────────────────────────────────────────────────
async function atualizarStatus(codMatrizAluno, novoStatus) {
    const ids = [codMatrizAluno];
    await salvarStatus(ids, novoStatus);
    filtrar();
}

async function marcarGrupo(turma, novoStatus) {
    const ids = todosAlunos
        .filter(a => a.descrTurma === turma)
        .map(a => a.codMatrizAluno);
    await salvarStatus(ids, novoStatus);
    filtrar();
}

async function salvarStatus(ids, status) {
    try {
        const r = await fetch(`${API}/api/crachas/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, status })
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const agora = new Date().toISOString();
        for (const id of ids) {
            if (!statusMap[id]) statusMap[id] = {};
            statusMap[id].status = status;
            if (status === 'impresso' && !statusMap[id].data_impressao) statusMap[id].data_impressao = agora;
            if (status === 'entregue' && !statusMap[id].data_entrega)   statusMap[id].data_entrega   = agora;
            if (status === 'pendente') {
                statusMap[id].data_impressao = null;
                statusMap[id].data_entrega   = null;
            }
        }
        atualizarStats();
        mostrarToast(`${ids.length} crachá(s) marcado(s) como "${status}"`);
    } catch (e) {
        mostrarToast('Erro ao salvar: ' + e.message, 'erro');
    }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function atualizarStats() {
    const base     = turmaAtual === 'todos' ? todosAlunos : todosAlunos.filter(a => a.descrTurma === turmaAtual);
    const total    = base.length;
    const pendente = base.filter(a => (statusMap[a.codMatrizAluno]?.status || 'pendente') === 'pendente').length;
    const impresso = base.filter(a => (statusMap[a.codMatrizAluno]?.status || 'pendente') === 'impresso').length;
    const entregue = base.filter(a => (statusMap[a.codMatrizAluno]?.status || 'pendente') === 'entregue').length;

    document.getElementById('numTotal').textContent    = total;
    document.getElementById('numPendente').textContent = pendente;
    document.getElementById('numImpresso').textContent = impresso;
    document.getElementById('numEntregue').textContent = entregue;
}

// ── Impressão ─────────────────────────────────────────────────────────────────
function imprimirSelecionados() {
    const alunos = todosAlunos.filter(a => selecionados.has(a.codMatrizAluno));
    abrirJanelaImpressao(alunos);
}

function imprimirTodos() {
    const base = turmaAtual === 'todos' ? todosAlunos : todosAlunos.filter(a => a.descrTurma === turmaAtual);
    abrirJanelaImpressao(base);
}

function abrirJanelaImpressao(alunos) {
    if (alunos.length === 0) {
        mostrarToast('Nenhum aluno para imprimir.', 'aviso');
        return;
    }

    const coresMap = {};
    [...new Set(alunos.map(a => a.descrTurma))].forEach((t, i) => {
        const paleta = ['#1d4ed8','#059669','#d97706','#9333ea','#dc2626','#0891b2','#65a30d'];
        coresMap[t] = paleta[i % paleta.length];
    });

    const badges = alunos.map(a => {
        const cor    = coresMap[a.descrTurma] || '#1d4ed8';
        const serie  = a.serie || '';
        const turmaAbrev = a.descrTurma.length > 28 ? a.descrTurma.substring(0, 26) + '…' : a.descrTurma;
        const periodoMatch = a.descrTurma.match(/Manhã|Tarde|Noite/i);
        const periodo = periodoMatch ? periodoMatch[0] : '';
        return `
        <div class="badge-card">
            <div class="badge-topo" style="background:${cor}">
                <div class="badge-logo">📚 EduGest</div>
                <div class="badge-ano">2026</div>
            </div>
            <div class="badge-foto">
                <div class="badge-foto-circle">${a.nome.charAt(0).toUpperCase()}</div>
            </div>
            <div class="badge-corpo">
                <div class="badge-nome">${a.nome}</div>
                <div class="badge-serie">${serie}</div>
                <div class="badge-turma">${turmaAbrev}</div>
                ${periodo ? `<div class="badge-periodo" style="color:${cor}">${periodo}</div>` : ''}
            </div>
            <div class="badge-rodape" style="background:${cor}20; border-top: 2px solid ${cor}">
                <div class="badge-chamada-label">Nº Chamada</div>
                <div class="badge-chamada" style="color:${cor}">${a.numChamada || '—'}</div>
                <div class="badge-cod">ID: ${a.codMatrizAluno}</div>
            </div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Crachás — EduGest</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4; margin: 10mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }

.badges-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8mm;
    padding: 4mm;
}

.badge-card {
    width: 60mm;
    min-height: 90mm;
    border: 1.5px solid #ddd;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    break-inside: avoid;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    background: #fff;
}

.badge-topo {
    padding: 6px 8px 4px;
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.badge-logo { font-size: 10px; color: white; font-weight: 700; }
.badge-ano  { font-size: 9px;  color: rgba(255,255,255,0.85); }

.badge-foto {
    display: flex;
    justify-content: center;
    padding: 8px 0 4px;
}
.badge-foto-circle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 800;
    color: #374151;
    border: 2px solid #d1d5db;
}

.badge-corpo {
    flex: 1;
    padding: 4px 8px 6px;
    text-align: center;
}
.badge-nome {
    font-size: 10.5px;
    font-weight: 800;
    color: #111;
    line-height: 1.25;
    margin-bottom: 3px;
    word-break: break-word;
}
.badge-serie {
    font-size: 9px;
    color: #555;
    margin-bottom: 2px;
    font-weight: 600;
}
.badge-turma {
    font-size: 8px;
    color: #777;
    margin-bottom: 2px;
}
.badge-periodo {
    font-size: 8.5px;
    font-weight: 700;
    margin-top: 2px;
}

.badge-rodape {
    padding: 5px 8px 6px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
}
.badge-chamada-label { font-size: 7px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
.badge-chamada { font-size: 18px; font-weight: 900; line-height: 1.1; }
.badge-cod { font-size: 6.5px; color: #bbb; margin-top: 2px; }

.print-header {
    text-align: center;
    margin-bottom: 6mm;
    padding-bottom: 4mm;
    border-bottom: 1px solid #eee;
}
.print-header h1 { font-size: 16px; color: #333; }
.print-header p  { font-size: 11px; color: #888; margin-top: 2px; }

.page-break { break-before: page; }
</style>
</head>
<body>
<div class="print-header">
    <h1>📚 EduGest — Crachás dos Alunos</h1>
    <p>Gerado em ${new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })} — ${alunos.length} crachá(s)</p>
</div>
<div class="badges-grid">${badges}</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(html);
    win.document.close();

    // Marcar como impresso
    const ids = alunos
        .filter(a => (statusMap[a.codMatrizAluno]?.status || 'pendente') === 'pendente')
        .map(a => a.codMatrizAluno);
    if (ids.length > 0) salvarStatus(ids, 'impresso').then(() => filtrar());
}

// ── Cores por turma ───────────────────────────────────────────────────────────
const CORES = ['#1d4ed8','#059669','#d97706','#9333ea','#dc2626','#0891b2','#65a30d','#c2410c'];
const corCache = {};
let corIdx = 0;
function corTurma(turma) {
    if (!corCache[turma]) corCache[turma] = CORES[corIdx++ % CORES.length];
    return corCache[turma];
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function mostrarToast(msg, tipo = 'ok') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast toast-${tipo} show`;
    setTimeout(() => t.classList.remove('show'), 3000);
}

init();
