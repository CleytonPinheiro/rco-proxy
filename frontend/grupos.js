// ── Grupos de Trabalho ────────────────────────────────────────────────────────

const API = '';
let turmaAtual    = null;   // { codTurma, nomeTurma, codClasse }
let todosAlunos   = [];     // todos os alunos da turma
let todosGrupos   = [];     // grupos da turma
let ativGrupoId   = null;   // id do grupo para modal de atividade
let ativEditId    = null;   // id da atividade sendo editada (null = nova)
let verAtivGrupoId = null;  // id do grupo para modal de ver atividades
let dragAluno     = null;   // { codMatrizAluno, nome, numChamada, fromGrupoId }

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        if (!d.credenciaisConfiguradas) { window.location.href = '/'; return false; }
        return true;
    } catch { window.location.href = '/'; return false; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    if (!await checkAuth()) return;

    let acessos;
    try {
        const r = await fetch(`${API}/api/acessos`);
        acessos = await r.json();
    } catch (e) {
        document.getElementById('loading').innerHTML = `<p style="color:red">Erro ao carregar turmas: ${e.message}</p>`;
        return;
    }

    const turmas = extrairTurmas(acessos);
    renderTurmaTabs(turmas);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';

    if (turmas.length > 0) await selecionarTurma(turmas[0]);
}

// ── Extrair turmas do payload de acessos ──────────────────────────────────────
function extrairTurmas(acessos) {
    const mapa = {};
    const root = Array.isArray(acessos) ? acessos[0] : acessos;
    for (const periodo of (root.periodoLetivos || [])) {
        for (const livro of (periodo.livros || [])) {
            const classe = livro.classe; if (!classe) continue;
            const turma  = classe.turma || {};
            const cod    = turma.codTurma;
            if (!cod || mapa[cod]) continue;
            const desc  = turma.descrTurma || '';
            const serie = (desc.match(/(\d+[ªa]?\s*[sS]érie)/i) || ['', desc])[1];
            mapa[cod] = { codTurma: cod, nomeTurma: desc, serie, codClasse: classe.codClasse };
        }
    }
    return Object.values(mapa).sort((a, b) => (parseInt(a.serie) || 99) - (parseInt(b.serie) || 99));
}

// ── Tabs de turma ─────────────────────────────────────────────────────────────
function renderTurmaTabs(turmas) {
    const el = document.getElementById('turmaTabs');
    el.innerHTML = turmas.map(t => `
        <button class="turma-tab" data-cod="${t.codTurma}" onclick="selecionarTurma(${JSON.stringify(t).split('"').join("'")})"
            title="${t.nomeTurma}">${t.serie || t.nomeTurma}</button>
    `).join('');
}

async function selecionarTurma(turma) {
    turmaAtual = turma;
    document.querySelectorAll('.turma-tab').forEach(b => {
        b.classList.toggle('active', String(b.dataset.cod) === String(turma.codTurma));
    });

    document.getElementById('poolAlunos').innerHTML = '<p class="pool-vazio">Carregando alunos...</p>';
    document.getElementById('listaGrupos').innerHTML = '';

    await Promise.all([carregarAlunos(turma), carregarGrupos(turma.codTurma)]);
    renderPool();
    renderGrupos();
}

// ── Carregar alunos da turma via API ──────────────────────────────────────────
async function carregarAlunos(turma) {
    try {
        const r = await fetch(`${API}/api/alunos-rco?codClasse=${turma.codClasse}`);
        const d = await r.json();
        todosAlunos = Array.isArray(d) ? d : (d.alunos || []);
    } catch { todosAlunos = []; }
}

// ── Carregar grupos do backend ────────────────────────────────────────────────
async function carregarGrupos(codTurma) {
    try {
        const r = await fetch(`${API}/api/grupos?codTurma=${codTurma}`);
        todosGrupos = await r.json();
    } catch { todosGrupos = []; }
}

// ── Pool: alunos sem grupo ────────────────────────────────────────────────────
function alunosSemGrupo() {
    const nosGrupos = new Set(todosGrupos.flatMap(g => g.alunos.map(a => a.codMatrizAluno)));
    return todosAlunos
        .filter(a => !nosGrupos.has(a.codMatrizAluno))
        .sort((a, b) => (a.numChamada || 0) - (b.numChamada || 0));
}

function renderPool() {
    const pool = alunosSemGrupo();
    const el   = document.getElementById('poolAlunos');
    document.getElementById('poolCount').textContent = pool.length;

    if (!pool.length) {
        el.innerHTML = '<p class="pool-vazio">Todos os alunos estão em grupos.</p>';
        return;
    }
    el.innerHTML = pool.map(a => cartaoAlunoPool(a)).join('');
}

function cartaoAlunoPool(a) {
    return `
        <div class="aluno-chip pool-chip" draggable="true"
             id="chip-pool-${a.codMatrizAluno}"
             ondragstart="iniciaDrag(event, ${JSON.stringify({ codMatrizAluno: a.codMatrizAluno, nome: a.nome, numChamada: a.numChamada, fromGrupoId: null }).split('"').join('&quot;')})">
            <span class="chip-num">${a.numChamada || '?'}</span>
            <span class="chip-nome">${a.nome}</span>
            <span class="chip-drag-icon">⠿</span>
        </div>`;
}

// ── Grupos ────────────────────────────────────────────────────────────────────
function renderGrupos() {
    const el = document.getElementById('listaGrupos');
    if (!todosGrupos.length) {
        el.innerHTML = '<div class="grupos-vazio"><p>Nenhum grupo criado ainda.</p><p>Clique em <strong>+ Novo Grupo</strong> para começar.</p></div>';
        return;
    }
    el.innerHTML = todosGrupos.map(g => renderCardGrupo(g)).join('');
}

function renderCardGrupo(g) {
    const locked     = g.bloqueado;
    const lockIcon   = locked ? '🔒' : '🔓';
    const lockTip    = locked ? 'Desbloqueie para editar membros' : 'Bloquear grupo (impede alterações acidentais)';
    const numAtiv    = g.atividades.length;
    const alunosHtml = g.alunos.length
        ? g.alunos.map(a => `
            <div class="aluno-chip grupo-chip" draggable="${!locked}"
                 id="chip-g-${g.id}-${a.codMatrizAluno}"
                 ondragstart="${locked ? '' : `iniciaDrag(event, ${JSON.stringify({ codMatrizAluno: a.codMatrizAluno, nome: a.nome, numChamada: a.numChamada, fromGrupoId: g.id }).split('"').join('&quot;')})`}">
                <span class="chip-num">${a.numChamada || '?'}</span>
                <span class="chip-nome">${a.nome}</span>
                ${locked ? '' : `<button class="chip-remove" title="Remover do grupo" onclick="removerAluno('${g.id}', ${a.codMatrizAluno})">✕</button>`}
            </div>`).join('')
        : `<p class="drop-hint">Arraste alunos para cá</p>`;

    return `
        <div class="grupo-card ${locked ? 'grupo-locked' : ''}" id="grupo-card-${g.id}">
            <div class="grupo-card-header">
                <div class="grupo-info">
                    <input class="grupo-nome-input ${locked ? 'locked' : ''}" value="${escHtml(g.nome)}"
                           ${locked ? 'readonly' : ''}
                           onchange="atualizarGrupo('${g.id}', { nome: this.value })">
                    <textarea class="grupo-desc-input ${locked ? 'locked' : ''}" placeholder="Descrição / objetivo da atividade..."
                              ${locked ? 'readonly' : ''}
                              onchange="atualizarGrupo('${g.id}', { descricao: this.value })">${escHtml(g.descricao)}</textarea>
                </div>
                <div class="grupo-actions">
                    <button class="btn-lock ${locked ? 'locked' : ''}" title="${lockTip}"
                            onclick="toggleLock('${g.id}', ${!locked})">${lockIcon}</button>
                    <button class="btn-ativ" title="Ver / registrar atividades (${numAtiv})"
                            onclick="abrirModalAtividade('${g.id}', '${escHtml(g.nome)}')">
                        📋<span class="ativ-count">${numAtiv}</span>
                    </button>
                    ${locked ? '' : `<button class="btn-excluir-grupo" title="Excluir grupo" onclick="excluirGrupo('${g.id}')">🗑</button>`}
                </div>
            </div>
            <div class="grupo-drop-zone ${locked ? '' : 'droppable'}"
                 ${locked ? '' : `ondragover="event.preventDefault(); this.classList.add('drag-over')"
                 ondragleave="this.classList.remove('drag-over')"
                 ondrop="dropNoGrupo(event, '${g.id}')"`}>
                ${alunosHtml}
            </div>
        </div>`;
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
function iniciaDrag(event, alunoJson) {
    dragAluno = typeof alunoJson === 'string' ? JSON.parse(alunoJson.split('&quot;').join('"')) : alunoJson;
    event.dataTransfer.effectAllowed = 'move';
}

async function dropNoGrupo(event, grupoId) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    if (!dragAluno) return;

    const grupo = todosGrupos.find(g => g.id === grupoId);
    if (!grupo || grupo.bloqueado) return;
    if (dragAluno.fromGrupoId === grupoId) return; // já está neste grupo

    await fetch(`${API}/api/grupos/${grupoId}/alunos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dragAluno),
    });

    await carregarGrupos(turmaAtual.codTurma);
    renderPool();
    renderGrupos();
    dragAluno = null;
}

async function dropNoPool(event) {
    event.preventDefault();
    if (!dragAluno || !dragAluno.fromGrupoId) return;

    const grupo = todosGrupos.find(g => g.id === dragAluno.fromGrupoId);
    if (grupo && grupo.bloqueado) return;

    await fetch(`${API}/api/grupos/${dragAluno.fromGrupoId}/alunos/${dragAluno.codMatrizAluno}`, { method: 'DELETE' });
    await carregarGrupos(turmaAtual.codTurma);
    renderPool();
    renderGrupos();
    dragAluno = null;
}

// ── CRUD Grupos ───────────────────────────────────────────────────────────────
function abrirModalNovoGrupo() {
    document.getElementById('novoGrupoNome').value = '';
    document.getElementById('novoGrupoDesc').value = '';
    document.getElementById('modalNovoGrupo').style.display = 'flex';
    setTimeout(() => document.getElementById('novoGrupoNome').focus(), 50);
}
function fecharModalNovoGrupo(e) {
    if (e && e.target !== document.getElementById('modalNovoGrupo')) return;
    document.getElementById('modalNovoGrupo').style.display = 'none';
}

async function criarGrupo() {
    const nome = document.getElementById('novoGrupoNome').value.trim();
    if (!nome) { alert('Informe o nome do grupo.'); return; }
    await fetch(`${API}/api/grupos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codTurma: turmaAtual.codTurma, nome, descricao: document.getElementById('novoGrupoDesc').value.trim() }),
    });
    document.getElementById('modalNovoGrupo').style.display = 'none';
    await carregarGrupos(turmaAtual.codTurma);
    renderGrupos();
}

async function atualizarGrupo(id, campos) {
    await fetch(`${API}/api/grupos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campos),
    });
    await carregarGrupos(turmaAtual.codTurma);
}

async function toggleLock(id, bloquear) {
    await atualizarGrupo(id, { bloqueado: bloquear });
    renderPool();
    renderGrupos();
}

async function excluirGrupo(id) {
    if (!confirm('Excluir este grupo? Os alunos voltarão ao pool.')) return;
    const r = await fetch(`${API}/api/grupos/${id}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json(); alert(e.erro); return; }
    await carregarGrupos(turmaAtual.codTurma);
    renderPool();
    renderGrupos();
}

async function removerAluno(grupoId, codMatrizAluno) {
    const grupo = todosGrupos.find(g => g.id === grupoId);
    if (grupo && grupo.bloqueado) { alert('Grupo bloqueado. Desbloqueie antes de remover membros.'); return; }
    await fetch(`${API}/api/grupos/${grupoId}/alunos/${codMatrizAluno}`, { method: 'DELETE' });
    await carregarGrupos(turmaAtual.codTurma);
    renderPool();
    renderGrupos();
}

// ── Modal Atividade ───────────────────────────────────────────────────────────
function abrirModalAtividade(grupoId, grupoNome) {
    ativGrupoId = grupoId;
    ativEditId  = null;
    document.getElementById('modalAtivTitulo').textContent = `Registrar Atividade — ${grupoNome}`;
    document.getElementById('ativData').value = new Date().toISOString().split('T')[0];
    document.getElementById('ativDescricao').value = '';
    document.getElementById('btnSalvarAtiv').textContent = 'Registrar';

    // Mostrar histórico de atividades abaixo do form no modal
    const grupo  = todosGrupos.find(g => g.id === grupoId);
    const ativs  = (grupo?.atividades || []).slice().sort((a, b) => b.data.localeCompare(a.data));

    let historicoHtml = '';
    if (ativs.length) {
        historicoHtml = `
            <div class="ativ-historico">
                <p class="ativ-historico-titulo">Atividades registradas (${ativs.length})</p>
                ${ativs.map(a => `
                    <div class="ativ-item">
                        <div class="ativ-item-top">
                            <span class="ativ-data">${formatarData(a.data)}</span>
                            <div class="ativ-item-btns">
                                <button class="btn-ativ-edit" onclick="editarAtividade('${grupoId}', '${a.id}', '${grupoNome}')">✏️</button>
                                <button class="btn-ativ-del" onclick="excluirAtividade('${grupoId}', '${a.id}', '${grupoNome}')">🗑</button>
                            </div>
                        </div>
                        <p class="ativ-desc">${escHtml(a.descricao)}</p>
                    </div>`).join('')}
            </div>`;
    }

    document.getElementById('modalAtividade').style.display = 'flex';
    // Injetar histórico dinamicamente (após inputs no modal-body)
    const body = document.querySelector('#modalAtividade .modal-body');
    const existente = body.querySelector('.ativ-historico');
    if (existente) existente.remove();
    body.insertAdjacentHTML('beforeend', historicoHtml);
}

function fecharModalAtividade(e) {
    if (e && e.target !== document.getElementById('modalAtividade')) return;
    document.getElementById('modalAtividade').style.display = 'none';
    ativGrupoId = null; ativEditId = null;
}

async function salvarAtividade() {
    const data      = document.getElementById('ativData').value;
    const descricao = document.getElementById('ativDescricao').value.trim();
    if (!descricao) { alert('Informe a descrição da atividade.'); return; }

    if (ativEditId) {
        await fetch(`${API}/api/grupos/${ativGrupoId}/atividades/${ativEditId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, descricao }),
        });
    } else {
        await fetch(`${API}/api/grupos/${ativGrupoId}/atividades`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, descricao }),
        });
    }
    await carregarGrupos(turmaAtual.codTurma);
    renderGrupos();

    // Reabrir modal com historico atualizado
    const grupoNome = todosGrupos.find(g => g.id === ativGrupoId)?.nome || '';
    document.getElementById('modalAtividade').style.display = 'none';
    abrirModalAtividade(ativGrupoId, grupoNome);
}

function editarAtividade(grupoId, ativId, grupoNome) {
    const grupo = todosGrupos.find(g => g.id === grupoId);
    const ativ  = grupo?.atividades.find(a => a.id === ativId);
    if (!ativ) return;
    ativGrupoId = grupoId;
    ativEditId  = ativId;
    document.getElementById('ativData').value      = ativ.data;
    document.getElementById('ativDescricao').value = ativ.descricao;
    document.getElementById('btnSalvarAtiv').textContent = 'Salvar alteração';
    document.getElementById('modalAtivTitulo').textContent = `Editar Atividade — ${grupoNome}`;
}

async function excluirAtividade(grupoId, ativId, grupoNome) {
    if (!confirm('Excluir este registro de atividade?')) return;
    await fetch(`${API}/api/grupos/${grupoId}/atividades/${ativId}`, { method: 'DELETE' });
    await carregarGrupos(turmaAtual.codTurma);
    renderGrupos();
    abrirModalAtividade(grupoId, grupoNome);
}

function fecharModalVerAtiv(e) {
    if (e && e.target !== document.getElementById('modalVerAtiv')) return;
    document.getElementById('modalVerAtiv').style.display = 'none';
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatarData(iso) {
    const [y, m, d] = (iso || '').split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
}

// ── Impressão / PDF ───────────────────────────────────────────────────────────
function imprimirGrupos() {
    if (!turmaAtual) { alert('Selecione uma turma antes de imprimir.'); return; }
    if (!todosGrupos.length) { alert('Não há grupos para imprimir nesta turma.'); return; }

    const agora  = new Date();
    const dataFmt = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const horFmt  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Decide número de colunas baseado na quantidade de grupos e tamanho médio
    const totalAlunos = todosGrupos.reduce((s, g) => s + g.alunos.length, 0);
    const totalAtiv   = todosGrupos.reduce((s, g) => s + g.atividades.length, 0);
    const grande      = totalAtiv > 0 || totalAlunos / todosGrupos.length > 12;
    const cols = todosGrupos.length <= 2 ? 'cols-1'
               : grande && todosGrupos.length <= 4 ? 'cols-2'
               : 'cols-3';

    // Gera os cards de cada grupo
    const cardsHtml = todosGrupos.map(g => {
        const alunosOrdenados = [...g.alunos].sort((a, b) => (a.numChamada || 0) - (b.numChamada || 0));

        const alunosHtml = alunosOrdenados.length
            ? alunosOrdenados.map(a => `
                <div class="print-aluno-row">
                    <div class="print-aluno-num">${a.numChamada || '?'}</div>
                    <div class="print-aluno-nome">${escHtml(a.nome)}</div>
                </div>`).join('')
            : '<p class="print-sem-membros">Nenhum membro neste grupo.</p>';

        const ativsHtml = g.atividades.length ? `
            <div class="print-ativ-section">
                <div class="print-section-title">Atividades registradas (${g.atividades.length})</div>
                ${[...g.atividades].sort((a, b) => b.data.localeCompare(a.data)).map(a => `
                    <div class="print-ativ-item">
                        <span class="print-ativ-data">${formatarData(a.data)}</span>
                        <span class="print-ativ-desc">${escHtml(a.descricao)}</span>
                    </div>`).join('')}
            </div>` : '';

        return `
            <div class="print-grupo-card">
                <div class="print-grupo-header">
                    <p class="print-grupo-nome">${escHtml(g.nome)}</p>
                    ${g.descricao ? `<p class="print-grupo-desc">${escHtml(g.descricao)}</p>` : ''}
                </div>
                <div class="print-grupo-body">
                    <div class="print-section-title">Membros (${alunosOrdenados.length})</div>
                    ${alunosHtml}
                    ${ativsHtml}
                </div>
            </div>`;
    }).join('');

    const html = `
        <div class="print-header">
            <div class="print-header-left">
                <h1>Grupos de Trabalho</h1>
                <p>${escHtml(turmaAtual.nomeTurma)} &nbsp;·&nbsp; ${todosGrupos.length} grupo${todosGrupos.length !== 1 ? 's' : ''}</p>
            </div>
            <div class="print-header-right">
                <div>${dataFmt}</div>
                <div>${horFmt}</div>
            </div>
        </div>
        <div class="print-grupos-grid ${cols}">
            ${cardsHtml}
        </div>
        <div class="print-footer">
            RCO Digital &nbsp;·&nbsp; Impresso em ${dataFmt} às ${horFmt}
        </div>`;

    const area = document.getElementById('printArea');
    area.innerHTML = html;
    area.style.display = 'block';

    window.print();

    // Oculta novamente após o diálogo de impressão fechar
    setTimeout(() => { area.style.display = 'none'; }, 500);
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
