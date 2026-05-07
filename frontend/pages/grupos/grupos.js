// ── Grupos de Trabalho ────────────────────────────────────────────────────────

const API = '';
let turmaAtual     = null;   // { codTurma, nomeTurma, codClasse }
let todosAlunos    = [];     // todos os alunos da turma
let todosGrupos    = [];     // grupos da turma
let ativGrupoId    = null;   // id do grupo para modal de atividade
let ativEditId     = null;   // id da atividade sendo editada (null = nova)
let verAtivGrupoId = null;   // id do grupo para modal de ver atividades
let dragAluno      = null;   // { codMatrizAluno, nome, numChamada, fromGrupoId }
let projetosGrupoId = null;  // id do grupo para modal de projetos

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

// ── Botão de atualização manual da lista de alunos ───────────────────────────
async function atualizarListaAlunos() {
    if (!turmaAtual) return;
    const btn = document.getElementById('btnAtualizarAlunos');
    if (btn) { btn.disabled = true; btn.classList.add('atualizando'); }
    const elPool = document.getElementById('poolAlunos');
    if (elPool) elPool.style.opacity = '0.5';

    const totalAntes = todosAlunos.length;
    await carregarAlunos(turmaAtual);
    const totalDepois = todosAlunos.length;
    const diff = totalDepois - totalAntes;

    renderPool();
    if (elPool) elPool.style.opacity = '';
    if (btn) { btn.disabled = false; btn.classList.remove('atualizando'); }

    /* Aviso rápido inline sobre resultado */
    const msg = diff > 0
        ? `+${diff} aluno(s) encontrado(s)`
        : diff < 0
            ? `${Math.abs(diff)} aluno(s) removido(s) da turma`
            : 'Lista atualizada';
    mostrarAvisoPool(msg, diff !== 0 ? 'ok' : 'neutro');
}

function mostrarAvisoPool(texto, tipo) {
    const el = document.getElementById('poolAlunos');
    const aviso = document.createElement('div');
    aviso.style.cssText = `
        position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
        background:${tipo === 'ok' ? '#d1fae5' : '#f3f4f6'};
        color:${tipo === 'ok' ? '#065f46' : '#374151'};
        border:1px solid ${tipo === 'ok' ? '#6ee7b7' : '#d1d5db'};
        border-radius:8px;padding:4px 14px;font-size:.78rem;font-weight:600;
        white-space:nowrap;pointer-events:none;z-index:10;
    `;
    aviso.textContent = texto;
    const col = el.closest('.pool-col');
    if (!col) return;
    col.style.position = 'relative';
    col.appendChild(aviso);
    setTimeout(() => aviso.remove(), 2500);
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
                    <button class="btn-proj" title="Projetos monitorados deste grupo"
                            onclick="abrirModalProjetos('${g.id}', '${escHtml(g.nome)}')">
                        📂 Projetos
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

// ── Projetos do Grupo ─────────────────────────────────────────────────────────

const TIPO_ICON = { github:'🐙', replit:'🔷', supabase:'⚡', vercel:'▲', netlify:'🌿', deploy:'🚀', outro:'🔗' };

async function abrirModalProjetos(grupoId, grupoNome) {
    projetosGrupoId = grupoId;
    document.getElementById('modalProjetosTitulo').textContent = `Projetos — ${grupoNome}`;
    document.getElementById('modalProjetos').style.display = 'flex';
    document.getElementById('modalProjetosBody').innerHTML = '<div class="proj-loading">Carregando projetos...</div>';
    const projetos = await carregarProjetos(grupoId);
    document.getElementById('modalProjetosBody').innerHTML = renderProjetosHtml(projetos, grupoId);
}

function fecharModalProjetos(e) {
    if (e && e.target !== document.getElementById('modalProjetos')) return;
    document.getElementById('modalProjetos').style.display = 'none';
    projetosGrupoId = null;
}

async function carregarProjetos(grupoId) {
    try {
        const r = await fetch(`${API}/api/grupos/${grupoId}/projetos`);
        return r.ok ? await r.json() : [];
    } catch { return []; }
}

function renderProjetosHtml(projetos, grupoId) {
    const listaHtml = projetos.length
        ? projetos.map(p => renderProjetoCard(p, grupoId)).join('')
        : '<p class="proj-vazio">Nenhum projeto cadastrado ainda. Adicione um link abaixo.</p>';

    return `
        <div class="proj-add-form">
            <div class="proj-add-inputs">
                <input id="projUrlInput" class="form-input" type="url"
                       placeholder="URL do projeto (GitHub, Replit, Supabase...)" autocomplete="off">
                <input id="projNomeInput" class="form-input" type="text"
                       placeholder="Nome do projeto" maxlength="80">
                <button class="btn-salvar" onclick="adicionarProjeto('${grupoId}')">Adicionar</button>
            </div>
            <p class="proj-add-hint">
                Para repositórios GitHub públicos, commits são monitorados automaticamente a cada hora.
                Repositórios privados requerem GITHUB_TOKEN configurado no servidor.
            </p>
        </div>
        <div class="proj-lista">${listaHtml}</div>`;
}

function renderProjetoCard(p, grupoId) {
    const icon        = TIPO_ICON[p.tipo] || '🔗';
    const totalEvt    = parseInt(p.total_eventos) || 0;
    const ultimoCheck = p.ultimo_check
        ? new Date(p.ultimo_check).toLocaleString('pt-BR')
        : 'Nunca verificado';

    const eventosHtml = (p.eventos || []).length
        ? `<div class="proj-timeline">${p.eventos.map(e => renderEvento(e)).join('')}</div>`
        : p.tipo === 'github'
            ? '<p class="proj-sem-eventos">Sem commits detectados. Clique em ↻ para sincronizar agora.</p>'
            : '';

    return `
        <div class="proj-card" id="proj-card-${p.id}">
            <div class="proj-card-header">
                <span class="proj-tipo-badge proj-tipo-${p.tipo}">${icon} ${p.tipo}</span>
                <div class="proj-card-title">
                    <a href="${escHtml(p.url)}" target="_blank" rel="noopener" class="proj-nome-link"
                       title="${escHtml(p.url)}">${escHtml(p.nome)}</a>
                    ${p.tipo === 'github' ? `<span class="proj-commits-badge">${totalEvt} commit${totalEvt !== 1 ? 's' : ''}</span>` : ''}
                </div>
                <div class="proj-card-actions">
                    ${p.tipo === 'github'
                        ? `<button class="proj-btn-sync" title="Sincronizar agora"
                                   onclick="sincronizarProjeto(${p.id}, '${grupoId}')">↻</button>`
                        : ''}
                    <button class="proj-btn-del" title="Remover projeto"
                            onclick="removerProjeto(${p.id}, '${grupoId}')">🗑</button>
                </div>
            </div>
            ${p.tipo === 'github' ? `<p class="proj-ultimo-check">Última verificação: ${ultimoCheck}</p>` : ''}
            ${eventosHtml}
        </div>`;
}

function renderEvento(e) {
    const sha  = e.sha  ? `<span class="proj-evento-sha">${e.sha.slice(0, 7)}</span>` : '';
    const link = e.url_evento
        ? `<a href="${escHtml(e.url_evento)}" target="_blank" rel="noopener" class="proj-evento-link">↗</a>`
        : '';
    return `
        <div class="proj-evento">
            <span class="proj-evento-dot"></span>
            <div class="proj-evento-info">
                <span class="proj-evento-titulo">${escHtml(e.titulo)}</span>
                <span class="proj-evento-meta">
                    ${escHtml(e.autor)} · ${formatarDataHora(e.detectado_em)} ${link} ${sha}
                </span>
            </div>
        </div>`;
}

async function adicionarProjeto(grupoId) {
    const url  = document.getElementById('projUrlInput').value.trim();
    const nome = document.getElementById('projNomeInput').value.trim();
    if (!url || !nome) { alert('Informe a URL e o nome do projeto.'); return; }
    const btn = document.querySelector('#modalProjetosBody .btn-salvar');
    if (btn) btn.disabled = true;
    const r = await fetch(`${API}/api/grupos/${grupoId}/projetos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, nome, codTurma: turmaAtual?.codTurma }),
    });
    if (!r.ok) { const e = await r.json(); alert(e.erro); if (btn) btn.disabled = false; return; }
    const projetos = await carregarProjetos(grupoId);
    document.getElementById('modalProjetosBody').innerHTML = renderProjetosHtml(projetos, grupoId);
}

async function removerProjeto(projId, grupoId) {
    if (!confirm('Remover este projeto do grupo?')) return;
    await fetch(`${API}/api/grupos/${grupoId}/projetos/${projId}`, { method: 'DELETE' });
    const projetos = await carregarProjetos(grupoId);
    document.getElementById('modalProjetosBody').innerHTML = renderProjetosHtml(projetos, grupoId);
}

async function sincronizarProjeto(projId, grupoId) {
    const card = document.getElementById(`proj-card-${projId}`);
    const btn  = card?.querySelector('.proj-btn-sync');
    if (btn) { btn.disabled = true; btn.textContent = '⟳'; }

    const r = await fetch(`${API}/api/grupos/${grupoId}/projetos/${projId}/sync`, { method: 'POST' });
    const d = await r.json();

    const projetos = await carregarProjetos(grupoId);
    document.getElementById('modalProjetosBody').innerHTML = renderProjetosHtml(projetos, grupoId);

    if (d.novos > 0) mostrarAvisoPool(`+${d.novos} commit(s) detectado(s)`, 'ok');
    else             mostrarAvisoPool('Nenhum commit novo', 'neutro');
}

// ── Monitor Geral de Projetos ─────────────────────────────────────────────────

async function abrirMonitorGeral() {
    document.getElementById('modalMonitor').style.display = 'flex';
    document.getElementById('modalMonitorBody').innerHTML = '<div class="proj-loading">Carregando atividade recente...</div>';
    await carregarMonitor();
}

function fecharModalMonitor(e) {
    if (e && e.target !== document.getElementById('modalMonitor')) return;
    document.getElementById('modalMonitor').style.display = 'none';
}

async function carregarMonitor() {
    try {
        const qs = turmaAtual ? `?codTurma=${turmaAtual.codTurma}` : '';
        const r  = await fetch(`${API}/api/grupos/monitor-projetos${qs}`);
        const projetos = r.ok ? await r.json() : [];
        document.getElementById('modalMonitorBody').innerHTML = renderMonitorHtml(projetos);
    } catch (e) {
        document.getElementById('modalMonitorBody').innerHTML =
            `<p style="color:red">Erro ao carregar monitor: ${e.message}</p>`;
    }
}

function renderMonitorHtml(projetos) {
    if (!projetos.length)
        return '<p class="proj-vazio">Nenhum projeto monitorado ainda. Abra um grupo, clique em "Projetos" e adicione um link.</p>';

    /* Agrupar por grupo_id */
    const porGrupo = {};
    for (const p of projetos) {
        if (!porGrupo[p.grupo_id]) porGrupo[p.grupo_id] = [];
        porGrupo[p.grupo_id].push(p);
    }

    const grupoNomes = Object.fromEntries(todosGrupos.map(g => [g.id, g.nome]));

    /* Ordenar grupos: primeiro os com eventos mais recentes */
    const gruposSorted = Object.entries(porGrupo).sort(([, psA], [, psB]) => {
        const lastA = psA.flatMap(p => p.eventos_recentes || [])
                         .map(e => e.detectado_em).sort().reverse()[0] || '';
        const lastB = psB.flatMap(p => p.eventos_recentes || [])
                         .map(e => e.detectado_em).sort().reverse()[0] || '';
        return lastB.localeCompare(lastA);
    });

    return gruposSorted.map(([grupoId, ps]) => {
        const nomeGrupo = grupoNomes[grupoId] || `Grupo ${grupoId}`;
        const projetosHtml = ps.map(p => {
            const icon     = TIPO_ICON[p.tipo] || '🔗';
            const totalEvt = parseInt(p.total_eventos) || 0;
            const eventos  = p.eventos_recentes || [];
            const evtHtml  = eventos.length
                ? `<div class="proj-timeline proj-timeline-sm">${eventos.map(e => renderEvento(e)).join('')}</div>`
                : '<p class="proj-sem-eventos">Sem atividade recente.</p>';
            return `
                <div class="monitor-proj-item">
                    <div class="monitor-proj-header">
                        <span class="proj-tipo-badge proj-tipo-${p.tipo}">${icon} ${p.tipo}</span>
                        <a href="${escHtml(p.url)}" target="_blank" rel="noopener" class="proj-nome-link">
                            ${escHtml(p.nome)}</a>
                        ${p.tipo === 'github'
                            ? `<span class="proj-commits-badge">${totalEvt} commit${totalEvt !== 1 ? 's' : ''}</span>`
                            : ''}
                    </div>
                    ${evtHtml}
                </div>`;
        }).join('');

        return `
            <div class="monitor-group-section">
                <h4 class="monitor-group-nome">👥 ${escHtml(nomeGrupo)}</h4>
                ${projetosHtml}
            </div>`;
    }).join('');
}

// ── Sugestões de Links dos Alunos ─────────────────────────────────────────────

async function abrirSugestoes() {
    document.getElementById('modalSugestoes').style.display = 'flex';
    document.getElementById('modalSugestoesBody').innerHTML = '<div class="proj-loading">Carregando sugestões...</div>';
    await carregarSugestoes();
}

function fecharModalSugestoes(e) {
    if (e && e.target !== document.getElementById('modalSugestoes')) return;
    document.getElementById('modalSugestoes').style.display = 'none';
}

async function carregarSugestoes() {
    try {
        const r = await fetch(`${API}/api/grupos/projetos-sugestoes`);
        const sugestoes = r.ok ? await r.json() : [];
        document.getElementById('modalSugestoesBody').innerHTML = renderSugestoesHtml(sugestoes);
    } catch (e) {
        document.getElementById('modalSugestoesBody').innerHTML =
            `<p style="color:red">Erro: ${e.message}</p>`;
    }
}

function renderSugestoesHtml(sugestoes) {
    if (!sugestoes.length)
        return '<p class="proj-vazio">Nenhum link submetido pelos alunos ainda.</p>' +
               '<p style="font-size:12px;color:#6b7280;margin-top:8px">Alunos podem submeter links no Portal do Aluno após fazer login com o Google.</p>';

    const grupoOptions = todosGrupos.map(g =>
        `<option value="${g.id}">${escHtml(g.nome)}</option>`
    ).join('');

    return sugestoes.map(s => {
        const statusClass = `sugestao-status-${s.status}`;
        const acoes = s.status === 'pendente' ? `
            <div class="sugestao-actions">
                <select class="sugestao-grupo-sel" id="sel-grupo-${s.id}">
                    <option value="">— Escolher grupo —</option>
                    ${grupoOptions}
                </select>
                <button class="btn-aprovar"  onclick="aprovarSugestao(${s.id})">✓ Aprovar</button>
                <button class="btn-rejeitar" onclick="rejeitarSugestao(${s.id})">✕ Rejeitar</button>
            </div>` : `<span class="${statusClass}">${s.status.toUpperCase()}</span>`;

        return `
            <div class="sugestao-card">
                <div class="sugestao-info">
                    <div class="sugestao-nome">${escHtml(s.nome)}
                        <span class="proj-tipo-badge proj-tipo-${s.tipo}" style="font-size:10px;margin-left:6px">
                            ${TIPO_ICON[s.tipo] || '🔗'} ${s.tipo}</span>
                    </div>
                    <div class="sugestao-aluno">👤 ${escHtml(s.aluno_nome || '')} (${escHtml(s.aluno_email)})
                        · ${formatarDataHora(s.criado_em)}</div>
                    <div class="sugestao-url">
                        <a href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(s.url)}</a>
                    </div>
                </div>
                ${acoes}
            </div>`;
    }).join('');
}

async function aprovarSugestao(id) {
    const sel    = document.getElementById(`sel-grupo-${id}`);
    const grupoId = sel?.value;
    if (!grupoId) { alert('Selecione um grupo para aprovar.'); return; }
    await fetch(`${API}/api/grupos/projetos-sugestoes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'aprovado', grupoId, codTurma: turmaAtual?.codTurma }),
    });
    await carregarSugestoes();
    mostrarAvisoPool('Projeto aprovado e adicionado ao grupo', 'ok');
}

async function rejeitarSugestao(id) {
    if (!confirm('Rejeitar esta sugestão?')) return;
    await fetch(`${API}/api/grupos/projetos-sugestoes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejeitado' }),
    });
    await carregarSugestoes();
}

// ── Utilitário de data/hora ───────────────────────────────────────────────────

function formatarDataHora(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
    } catch { return iso; }
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
