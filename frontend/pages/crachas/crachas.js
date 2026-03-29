// ── Crachás — Gerenciamento de Crachás dos Alunos ────────────────────────────

const API = '';
let todosAlunos     = [];    // [{codMatrizAluno, nome, codTurma, descrTurma, numChamada, serie}]
let statusMap       = {};    // codMatrizAluno → {status, data_impressao, data_entrega, obs}
let turmasAtivas    = new Set();  // vazio = todas; com itens = multi-seleção
let selecionados    = new Set();
let collapseState       = {};    // turma   → bool (true = recolhido)
let collapseStatePeriodo = {};   // período → bool (true = recolhido)

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

// Extrai o nome do curso (primeiro segmento) como chave de agrupamento
function extrairCurso(descrTurma) {
    return descrTurma.split(' - ')[0].trim();
}

// Extrai o período do dia da descrição da turma
function extrairPeriodo(descrTurma) {
    const m = descrTurma.match(/\b(Manhã|Tarde|Noite)\b/i);
    if (!m) return 'Outro';
    const p = m[1].toLowerCase();
    return p.charAt(0).toUpperCase() + p.slice(1);  // capitaliza
}

// Abrevia o nome da turma para exibição nos botões (série + período + classe)
function abreviarParaTab(descrTurma) {
    const parts = descrTurma.split(' - ').map(p => p.trim()).filter(Boolean);
    const serieIdx = parts.findIndex((p, i) =>
        i > 0 && /\d+[ªoaº°]?\s*(s[eé]rie|ano)/i.test(p)
    );
    if (serieIdx > 0) return parts.slice(serieIdx).join(' · ');
    return parts.length > 1 ? parts.slice(1).join(' · ') : descrTurma.trim();
}

// Versão sem o período (usado quando o período já aparece como sub-cabeçalho)
function abreviarSemPeriodo(descrTurma) {
    return abreviarParaTab(descrTurma)
        .split(' · ')
        .filter(p => !/^(Manhã|Tarde|Noite)$/i.test(p.trim()))
        .join(' · ');
}

// Agrupa lista de turmas por período, já ordenado Manhã→Tarde→Noite→Outro
function agruparTabsPorPeriodo(turmas) {
    const ORDEM = { 'Manhã': 1, 'Tarde': 2, 'Noite': 3, 'Outro': 4 };
    const ICONE = { 'Manhã': '☀️', 'Tarde': '🌤️', 'Noite': '🌙', 'Outro': '📋' };
    const map = {};
    turmas.forEach(t => {
        const p = extrairPeriodo(t);
        if (!map[p]) map[p] = [];
        map[p].push(t);
    });
    return Object.entries(map)
        .sort(([a], [b]) => (ORDEM[a] || 9) - (ORDEM[b] || 9))
        .map(([periodo, ts]) => ({ periodo, icone: ICONE[periodo] || '📋', turmas: ts }));
}

// Renderiza os botões de turma dentro de um grupo, sub-agrupados por período
function renderBotoesPorPeriodo(turmas) {
    const periodos = agruparTabsPorPeriodo(turmas);
    const multiPeriodo = periodos.length > 1;

    return periodos.map(({ periodo, icone, turmas: ts }) => {
        const btns = ts.map(t => {
            const count = todosAlunos.filter(a => a.descrTurma === t).length;
            const label = multiPeriodo ? abreviarSemPeriodo(t) : abreviarParaTab(t);
            const ativa = turmasAtivas.has(t);
            return `<button class="turma-tab ${ativa ? 'active' : ''}" onclick="selecionarTurma('${t.replace(/'/g, "\\'")}')">
                ${label} <span class="tab-count">${count}</span>
            </button>`;
        }).join('');

        if (!multiPeriodo) return `<div class="tab-grupo-btns">${btns}</div>`;

        return `<div class="tab-periodo-linha">
            <span class="tab-periodo-label">${icone} ${periodo}</span>
            <div class="tab-grupo-btns">${btns}</div>
        </div>`;
    }).join('');
}

// ── Tabs de turma ─────────────────────────────────────────────────────────────
function renderTabs() {
    const container = document.getElementById('turmaTabs');
    const turmasUnicas = [...new Set(todosAlunos.map(a => a.descrTurma))].sort();

    // Agrupar por curso
    const grupos = {};
    turmasUnicas.forEach(t => {
        const curso = extrairCurso(t);
        if (!grupos[curso]) grupos[curso] = [];
        grupos[curso].push(t);
    });

    const totalGeral = todosAlunos.length;
    const nGrupos    = Object.keys(grupos).length;
    const todasAtivo = turmasAtivas.size === 0;

    // Botão "Todas"
    let html = `<div class="tab-geral-wrap">
        <button class="turma-tab turma-tab-todas ${todasAtivo ? 'active' : ''}" onclick="selecionarTurma('todos')">
            Todas <span class="tab-count">${totalGeral}</span>
        </button>
        ${!todasAtivo ? `<span class="tab-sel-hint">${turmasAtivas.size} selecionada${turmasAtivas.size > 1 ? 's' : ''} — clique em "Todas" para limpar</span>` : ''}
    </div>`;

    if (nGrupos === 1) {
        html += `<div class="tab-grupo tab-grupo-unico">
            ${renderBotoesPorPeriodo(turmasUnicas)}
        </div>`;
    } else {
        Object.entries(grupos).forEach(([curso, turmas]) => {
            const labelCurso = curso.length > 45 ? curso.substring(0, 43) + '…' : curso;
            html += `<div class="tab-grupo">
                <span class="tab-grupo-label">${labelCurso}</span>
                ${renderBotoesPorPeriodo(turmas)}
            </div>`;
        });
    }

    container.innerHTML = html;
}

function selecionarTurma(turma) {
    if (turma === 'todos') {
        turmasAtivas.clear();
    } else if (turmasAtivas.has(turma)) {
        turmasAtivas.delete(turma);
    } else {
        turmasAtivas.add(turma);
    }
    renderTabs();
    filtrar();
}

// ── Filtrar e renderizar ──────────────────────────────────────────────────────
function filtrar() {
    const busca  = (document.getElementById('inputBusca')?.value || '').toLowerCase();
    const status = document.getElementById('filtroStatus')?.value || '';

    let lista = todosAlunos;
    if (turmasAtivas.size > 0) lista = lista.filter(a => turmasAtivas.has(a.descrTurma));
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

    const ORDEM_PERIODO = { 'Manhã': 1, 'Tarde': 2, 'Noite': 3, 'Outro': 4 };
    const ICONE_PERIODO = { 'Manhã': '☀️', 'Tarde': '🌤️', 'Noite': '🌙', 'Outro': '📋' };
    const CHEVRON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.5 4.5L7 9.5L11.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    // ── 1. Agrupar: período → turma → alunos ──────────────────────────────────
    const porPeriodo = {};
    for (const a of lista) {
        const periodo = extrairPeriodo(a.descrTurma);
        const turma   = a.descrTurma || 'Sem turma';
        if (!porPeriodo[periodo])        porPeriodo[periodo] = {};
        if (!porPeriodo[periodo][turma]) porPeriodo[periodo][turma] = [];
        porPeriodo[periodo][turma].push(a);
    }

    const nPeriodos = Object.keys(porPeriodo).length;
    const periodosOrdenados = Object.entries(porPeriodo)
        .sort(([a], [b]) => (ORDEM_PERIODO[a] || 9) - (ORDEM_PERIODO[b] || 9));

    // ── 2. Renderizar seções de turma (comum aos dois layouts) ────────────────
    function renderTurmas(gruposTurma) {
        return Object.entries(gruposTurma).map(([turma, alunos]) => {
            const todosSelTurma = alunos.every(a => selecionados.has(a.codMatrizAluno));
            const cor       = corTurma(turma);
            const recolhido = !!collapseState[turma];
            const turmaEsc  = turma.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            return `
            <div class="turma-secao" data-turma="${turmaEsc}">
                <div class="turma-secao-header" style="--cor-turma: ${cor}">
                    <div class="turma-secao-left">
                        <button class="btn-toggle-secao${recolhido ? ' colapsado' : ''}" onclick="toggleSecao(this)" title="${recolhido ? 'Expandir' : 'Recolher'} turma">
                            ${CHEVRON}
                        </button>
                        <input type="checkbox" class="chk-turma"
                            ${todosSelTurma ? 'checked' : ''}
                            onchange="toggleTurma('${turma.replace(/'/g,"\\'")}','${turmaEsc}')" title="Selecionar todos da turma">
                        <span class="turma-secao-nome">${turma}</span>
                        <span class="turma-secao-count">${alunos.length} alunos</span>
                    </div>
                    <div class="turma-secao-acoes">
                        <button class="btn-marcar-grupo" onclick="marcarGrupo('${turma.replace(/'/g,"\\'")}', 'impresso')">✅ Marcar impressos</button>
                        <button class="btn-marcar-grupo" onclick="marcarGrupo('${turma.replace(/'/g,"\\'")}', 'entregue')">🤝 Marcar entregues</button>
                    </div>
                </div>
                <div class="alunos-grid-crachas"${recolhido ? ' style="display:none"' : ''}>
                    ${alunos.map(a => renderCardAluno(a)).join('')}
                </div>
            </div>`;
        }).join('');
    }

    // ── 3. Montar HTML final ──────────────────────────────────────────────────
    if (nPeriodos === 1) {
        // Uma única faixa de período → sem wrapper de período
        container.innerHTML = renderTurmas(periodosOrdenados[0][1]);
        return;
    }

    container.innerHTML = periodosOrdenados.map(([periodo, gruposTurma]) => {
        const total     = Object.values(gruposTurma).reduce((s, arr) => s + arr.length, 0);
        const recolhido = !!collapseStatePeriodo[periodo];
        return `
        <div class="periodo-secao" data-periodo="${periodo}">
            <div class="periodo-header">
                <button class="btn-toggle-periodo${recolhido ? ' colapsado' : ''}" onclick="togglePeriodo(this)" title="${recolhido ? 'Expandir' : 'Recolher'} período">
                    ${CHEVRON}
                </button>
                <span class="periodo-icone">${ICONE_PERIODO[periodo] || '📋'}</span>
                <span class="periodo-nome">${periodo}</span>
                <span class="periodo-count">${total} alunos</span>
            </div>
            <div class="periodo-body"${recolhido ? ' style="display:none"' : ''}>
                ${renderTurmas(gruposTurma)}
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

function toggleSecao(btn) {
    const secao  = btn.closest('.turma-secao');
    const grid   = secao.querySelector('.alunos-grid-crachas');
    const turma  = secao.dataset.turma;
    collapseState[turma] = !collapseState[turma];
    grid.style.display   = collapseState[turma] ? 'none' : '';
    btn.classList.toggle('colapsado', !!collapseState[turma]);
    btn.title = collapseState[turma] ? 'Expandir turma' : 'Recolher turma';
}

function togglePeriodo(btn) {
    const periodoEl = btn.closest('.periodo-secao');
    const body      = periodoEl.querySelector('.periodo-body');
    const periodo   = periodoEl.dataset.periodo;
    collapseStatePeriodo[periodo] = !collapseStatePeriodo[periodo];
    body.style.display = collapseStatePeriodo[periodo] ? 'none' : '';
    btn.classList.toggle('colapsado', !!collapseStatePeriodo[periodo]);
    btn.title = collapseStatePeriodo[periodo] ? 'Expandir período' : 'Recolher período';
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
    const base     = turmasAtivas.size === 0 ? todosAlunos : todosAlunos.filter(a => turmasAtivas.has(a.descrTurma));
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
    const base = turmasAtivas.size === 0 ? todosAlunos : todosAlunos.filter(a => turmasAtivas.has(a.descrTurma));
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

    const badges = alunos.map((a, idx) => {
        const cor         = coresMap[a.descrTurma] || '#1d4ed8';
        const serie       = a.serie || '';
        const turmaAbrev  = a.descrTurma.length > 30 ? a.descrTurma.substring(0, 28) + '…' : a.descrTurma;
        const periodoMatch = a.descrTurma.match(/Manhã|Tarde|Noite/i);
        const periodo     = periodoMatch ? periodoMatch[0] : '';
        const codigo      = String(a.codMatrizAluno);
        const nomePartes  = a.nome.split(' ');
        const nomeAbrev   = nomePartes.length > 2
            ? `${nomePartes[0]} ${nomePartes[nomePartes.length - 1]}`
            : a.nome;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(codigo)}&size=200x200&margin=4`;

        return `
        <div class="badge-card">

            <!-- Topo colorido -->
            <div class="badge-topo" style="background:${cor}">
                <div class="badge-topo-serie">${serie}</div>
                <div class="badge-topo-periodo">${periodo || '2026'}</div>
            </div>

            <!-- Área principal: foto 3×4 + dados + QR canto direito -->
            <div class="badge-main">
                <div class="badge-foto-3x4">
                    <div class="foto-placeholder">
                        <div class="foto-icone">👤</div>
                        <div class="foto-label">3×4</div>
                    </div>
                </div>
                <div class="badge-dados">
                    <div class="badge-nome">${a.nome}</div>
                    <div class="badge-serie-txt">${serie}</div>
                    <div class="badge-turma-txt">${turmaAbrev}</div>
                    ${periodo ? `<div class="badge-periodo-txt" style="color:${cor}">${periodo}</div>` : ''}
                    <div class="badge-chamada-row" style="border-color:${cor}20">
                        <span class="badge-chamada-lbl">Nº Chamada</span>
                        <span class="badge-chamada-num" style="color:${cor}">${a.numChamada || '—'}</span>
                    </div>
                    <!-- QR no canto inferior direito dos dados -->
                    <div class="badge-qr-wrap">
                        <img class="badge-qr" src="${qrUrl}" alt="QR ${codigo}">
                    </div>
                </div>
            </div>

            <!-- Código de barras — rodapé do crachá -->
            <div class="badge-barcode-area" style="border-top:2px solid ${cor}30">
                <svg class="barcode" id="bc-${idx}"></svg>
                <div class="badge-barcode-label">${nomeAbrev} · ${codigo}</div>
            </div>

        </div>`;
    }).join('');

    // Dados para inicializar barcodes via JS
    const barcodeData = alunos.map((a, idx) => ({
        id: `bc-${idx}`,
        value: String(a.codMatrizAluno)
    }));

    const html = `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Crachás</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4 portrait; margin: 8mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* ── Grid de crachás — 2 colunas centralizadas, largura de crachá padrão ── */
.badges-grid {
    display: grid;
    grid-template-columns: repeat(2, 90mm);
    justify-content: center;
    gap: 6mm;
    padding: 2mm;
}

/* ── Card do crachá ── */
.badge-card {
    border: 1.5px solid #d1d5db;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    break-inside: avoid;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.10);
}

/* ── Topo colorido ── */
.badge-topo {
    padding: 6px 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 16px;
}
.badge-topo-serie  { font-size: 10px; color: white; font-weight: 800; letter-spacing: 0.3px; }
.badge-topo-periodo { font-size: 9px; color: rgba(255,255,255,0.9); font-weight: 600; }

/* ── Área principal: foto 3×4 + dados ── */
.badge-main {
    display: flex;
    gap: 8px;
    padding: 8px 8px 6px;
    align-items: flex-start;
}

/* ── Foto 3×4 real (30mm × 40mm) ── */
.badge-foto-3x4 {
    flex-shrink: 0;
    width: 30mm;
    height: 40mm;
    border: 1.5px dashed #bbb;
    border-radius: 4px;
    background: #f3f4f6;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
}
.foto-placeholder { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.foto-icone  { font-size: 28px; line-height: 1; opacity: 0.30; }
.foto-label  { font-size: 8px; color: #aaa; font-weight: 700; letter-spacing: 0.5px; }

/* ── Dados do aluno ── */
.badge-dados {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    height: 40mm;
    position: relative;
}
.badge-nome {
    font-size: 11px;
    font-weight: 800;
    color: #111;
    line-height: 1.25;
    word-break: break-word;
}
.badge-serie-txt  { font-size: 9px;  color: #333; font-weight: 700; margin-top: 1px; }
.badge-turma-txt  { font-size: 8px;  color: #666; line-height: 1.3; }
.badge-periodo-txt { font-size: 8.5px; font-weight: 700; margin-top: 1px; }
.badge-chamada-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    margin-top: 5px;
    border-top: 1px solid #e5e7eb;
    padding-top: 3px;
}
.badge-chamada-lbl { font-size: 7px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.4px; }
.badge-chamada-num { font-size: 20px; font-weight: 900; line-height: 1.1; }

/* ── QR Code — canto inferior direito dos dados ── */
.badge-qr-wrap {
    position: absolute;
    bottom: 0;
    right: 0;
}
.badge-qr {
    width: 58px;
    height: 58px;
    border: 1px solid #d1d5db;
    border-radius: 5px;
    background: white;
    display: block;
}

/* ── Código de barras — rodapé do crachá ── */
.badge-barcode-area {
    padding: 5px 8px 4px;
    background: #fafafa;
    display: flex;
    flex-direction: column;
    align-items: center;
}
.barcode {
    width: 100%;
    height: 52px;
}
.badge-barcode-label {
    font-size: 7px;
    color: #9ca3af;
    margin-top: 2px;
    letter-spacing: 0.3px;
    text-align: center;
}

.page-break { break-before: page; }
</style>
</head>
<body>
<div class="badges-grid">${badges}</div>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
<script>
window.onload = function() {
    var data = ${JSON.stringify(barcodeData)};
    data.forEach(function(item) {
        var el = document.getElementById(item.id);
        if (!el) return;
        try {
            JsBarcode(el, item.value, {
                format: 'CODE128',
                width: 1.8,
                height: 52,
                displayValue: false,
                margin: 0,
            });
        } catch(e) {}
    });
    setTimeout(function() { window.print(); }, 600);
};
<\/script>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=750');
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
