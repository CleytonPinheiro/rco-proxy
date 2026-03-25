/* ─────────────────────────────────────────────────────────────
   Mapa de Sala — lógica principal
   ──────────────────────────────────────────────────────────── */

const API = '/api';

// Estado global
let turmaAtual   = null;   // { codturma, turma }
let todosAlunos  = [];     // lista completa da turma
let grade        = [];     // array de objetos: { pos, fila, coluna, aluno|null }
let alunosFora   = [];     // alunos ainda não posicionados
let dragSource   = null;   // { tipo: 'banco'|'carteira', pos?, aluno }
let modificado   = false;

// ── Init ────────────────────────────────────────────────────
async function init() {
    await carregarTurmas();
}

// ── Turmas ──────────────────────────────────────────────────
async function carregarTurmas() {
    try {
        const r = await fetch(`${API}/alunos/turmas/lista`);
        const turmas = await r.json();
        const sel = document.getElementById('selTurma');
        (Array.isArray(turmas) ? turmas : []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.codturma;
            opt.textContent = abreviarNomeTurma(t.turma);
            opt.dataset.turma = t.turma;
            sel.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

async function onTurmaChange() {
    const sel = document.getElementById('selTurma');
    const opt = sel.options[sel.selectedIndex];
    if (!sel.value) {
        turmaAtual = null;
        limparWorkspace();
        return;
    }
    turmaAtual = { codturma: parseInt(sel.value), turma: opt.dataset.turma };
    await carregarAlunos();
    await carregarMapaSalvo();
}

async function carregarAlunos() {
    try {
        const r = await fetch(`${API}/alunos?codturma=${turmaAtual.codturma}`);
        const data = await r.json();
        todosAlunos = (data || []).sort((a, b) => (a.numchamada || 999) - (b.numchamada || 999));
    } catch (e) { todosAlunos = []; }
}

// ── Carregar mapa salvo ───────────────────────────────────────
async function carregarMapaSalvo() {
    try {
        const r = await fetch(`${API}/mapa-sala?codturma=${turmaAtual.codturma}`);
        const mapa = await r.json();

        if (mapa) {
            // Restaurar configuração salva
            document.getElementById('inpColunas').value = mapa.colunas;
            document.getElementById('lblColunas').textContent = mapa.colunas;
            document.getElementById('inpFilas').value = mapa.filas;
            document.getElementById('lblFilas').textContent = mapa.filas;
            construirGrade(mapa.colunas, mapa.filas, mapa.posicoes);
        } else {
            // Nova configuração padrão
            const col = parseInt(document.getElementById('inpColunas').value);
            const fil = parseInt(document.getElementById('inpFilas').value);
            construirGrade(col, fil, []);
        }
    } catch (e) {
        const col = parseInt(document.getElementById('inpColunas').value);
        const fil = parseInt(document.getElementById('inpFilas').value);
        construirGrade(col, fil, []);
    }
    marcarSalvo();
}

// ── Construir grade ──────────────────────────────────────────
function construirGrade(colunas, filas, posicoesExistentes) {
    const total = colunas * filas;
    grade = [];

    // Monta grade vazia
    for (let pos = 0; pos < total; pos++) {
        const fila   = Math.floor(pos / colunas) + 1;
        const coluna = (pos % colunas) + 1;
        grade.push({ pos, fila, coluna, aluno: null });
    }

    // Preenche com posições salvas
    const posMap = {};
    (posicoesExistentes || []).forEach(p => { if (p && p.pos != null) posMap[p.pos] = p.aluno; });
    grade.forEach(c => {
        if (posMap[c.pos]) c.aluno = posMap[c.pos];
    });

    // Calcula alunos fora: todos que não estão em nenhuma carteira
    const ocupados = new Set(grade.filter(c => c.aluno).map(c => c.aluno.codmatrizaluno));
    alunosFora = todosAlunos.filter(a => !ocupados.has(a.codmatrizaluno));

    renderGrade(colunas);
    renderBanco();
    document.getElementById('vazioMsg').style.display = 'none';
    document.getElementById('grade').style.display    = 'grid';
    document.getElementById('btnSalvar').disabled = false;
}

function reconstruirGrade() {
    if (!turmaAtual) return;
    const col = parseInt(document.getElementById('inpColunas').value);
    const fil = parseInt(document.getElementById('inpFilas').value);
    // Preservar posicionamento atual
    const posicoesAtuais = grade.map(c => ({ pos: c.pos, aluno: c.aluno }));
    construirGrade(col, fil, posicoesAtuais);
    marcarModificado();
}

function limparWorkspace() {
    grade = []; alunosFora = [];
    document.getElementById('grade').innerHTML    = '';
    document.getElementById('grade').style.display = 'none';
    document.getElementById('vazioMsg').style.display = '';
    renderBanco();
    document.getElementById('btnSalvar').disabled = true;
}

// ── Render grade ─────────────────────────────────────────────
function renderGrade(colunas) {
    const el = document.getElementById('grade');
    el.style.gridTemplateColumns = `repeat(${colunas}, var(--ms-desk-w))`;
    el.innerHTML = '';

    grade.forEach(c => {
        const div = criarCarteira(c);
        el.appendChild(div);
    });

    // Turma no grade-wrap para impressão
    document.getElementById('grade').closest('.ms-grade-wrap')
        .setAttribute('data-turma', turmaAtual?.turma || '');
}

function criarCarteira(c) {
    const div = document.createElement('div');
    div.className = 'ms-carteira' + (c.aluno ? ' ocupada' : '');
    div.dataset.pos = c.pos;

    div.innerHTML = `<span class="ms-carteira-num">${c.pos + 1}</span>`;

    if (c.aluno) {
        const ini = iniciais2(c.aluno.nome);
        div.draggable = true;
        div.innerHTML += `
            <button class="ms-carteira-btn-rem" onclick="removerDaCarteira(${c.pos})" title="Remover">✕</button>
            <div class="ms-carteira-avatar">${ini}</div>
            <div class="ms-carteira-nome">${primeiroNomePrimUlt(c.aluno.nome)}</div>
            ${c.aluno.numchamada ? `<div class="ms-carteira-chamada">#${c.aluno.numchamada}</div>` : ''}
        `;
        div.addEventListener('dragstart', e => onDragStartCarteira(e, c.pos));
        div.addEventListener('dragend', () => div.classList.remove('dragging-from'));
    } else {
        div.innerHTML += `<span class="ms-carteira-vazia-icon">
            <svg viewBox="0 0 44 60" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <!-- vista aérea: superfície da escrivaninha (lado da lousa) -->
                <rect x="1" y="1" width="42" height="22" rx="3"/>
                <!-- borda frontal (profundidade sutil) -->
                <rect x="1" y="21" width="42" height="2.5" rx="1" opacity=".35"/>
                <!-- assento da cadeira -->
                <rect x="5" y="32" width="34" height="24" rx="4"/>
                <!-- encosto da cadeira (barra fina na extremidade) -->
                <rect x="7" y="53" width="30" height="3" rx="1.5" opacity=".55"/>
            </svg>
        </span>`;
    }

    div.addEventListener('dragover',  e => onDragOver(e));
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop',      e => onDropCarteira(e, c.pos));

    return div;
}

// ── Render banco ─────────────────────────────────────────────
function renderBanco() {
    const lista = document.getElementById('bancoLista');
    const cont  = document.getElementById('bancoCont');
    const vazio = document.getElementById('bancoVazio');

    cont.textContent = alunosFora.length;

    // Remove apenas chips — preserva #bancoVazio no DOM
    lista.querySelectorAll('.ms-aluno-chip').forEach(el => el.remove());

    if (!alunosFora.length) {
        vazio.style.display = '';
        return;
    }
    vazio.style.display = 'none';

    alunosFora.forEach(a => {
        const div = document.createElement('div');
        div.className   = 'ms-aluno-chip';
        div.draggable   = true;
        div.dataset.cod = a.codmatrizaluno;
        div.innerHTML = `
            <div class="ms-aluno-avatar">${iniciais2(a.nome)}</div>
            <div class="ms-aluno-info">
                <div class="ms-aluno-nome">${primeiroNomePrimUlt(a.nome)}</div>
                ${a.numchamada ? `<div class="ms-aluno-num">#${a.numchamada}</div>` : ''}
            </div>
        `;
        div.addEventListener('dragstart', e => onDragStartBanco(e, a));
        div.addEventListener('dragend',   () => div.classList.remove('dragging'));
        lista.appendChild(div);
    });
}

// ── Drag & Drop ──────────────────────────────────────────────
function onDragStartBanco(e, aluno) {
    dragSource = { tipo: 'banco', aluno };
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function onDragStartCarteira(e, pos) {
    const carteira = grade[pos];
    if (!carteira?.aluno) return;
    dragSource = { tipo: 'carteira', pos, aluno: carteira.aluno };
    e.currentTarget.classList.add('dragging-from');
    e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    // Para carteiras: evitar highlight se é o próprio elemento
    if (target.classList.contains('ms-carteira')) {
        const targetPos = parseInt(target.dataset.pos);
        if (dragSource?.tipo === 'carteira' && dragSource.pos === targetPos) return;
        target.classList.add('drag-over');
    }
    // Para banco
    if (target.id === 'bancoLista') target.classList.add('drag-over');
}

function onDropCarteira(e, targetPos) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.ms-carteira').forEach(el => el.classList.remove('drag-over'));

    if (!dragSource) return;
    const carteiraDest = grade[targetPos];

    if (dragSource.tipo === 'banco') {
        // Aluno do banco → carteira
        const alunoAnterior = carteiraDest.aluno;
        carteiraDest.aluno = dragSource.aluno;
        alunosFora = alunosFora.filter(a => a.codmatrizaluno !== dragSource.aluno.codmatrizaluno);
        if (alunoAnterior) alunosFora.push(alunoAnterior);
    } else {
        // Carteira → carteira
        const carteiraOrigem = grade[dragSource.pos];
        const alunoAnterior = carteiraDest.aluno;
        carteiraDest.aluno  = carteiraOrigem.aluno;
        carteiraOrigem.aluno = alunoAnterior;
    }

    dragSource = null;
    atualizarBancoFora();
    renderGrade(parseInt(document.getElementById('inpColunas').value));
    renderBanco();
    marcarModificado();
}

function onDropBanco(e) {
    e.preventDefault();
    document.getElementById('bancoLista').classList.remove('drag-over');

    if (!dragSource || dragSource.tipo !== 'carteira') return;
    removerDaCarteira(dragSource.pos);
    dragSource = null;
}

function removerDaCarteira(pos) {
    const c = grade[pos];
    if (!c?.aluno) return;
    alunosFora.push(c.aluno);
    c.aluno = null;
    alunosFora.sort((a, b) => (a.numchamada || 999) - (b.numchamada || 999));
    renderGrade(parseInt(document.getElementById('inpColunas').value));
    renderBanco();
    marcarModificado();
}

function atualizarBancoFora() {
    const ocupados = new Set(grade.filter(c => c.aluno).map(c => c.aluno.codmatrizaluno));
    alunosFora = todosAlunos.filter(a => !ocupados.has(a.codmatrizaluno));
    alunosFora.sort((a, b) => (a.numchamada || 999) - (b.numchamada || 999));
}

// ── Salvar ───────────────────────────────────────────────────
async function salvarMapa() {
    if (!turmaAtual) return;

    const colunas = parseInt(document.getElementById('inpColunas').value);
    const filas   = parseInt(document.getElementById('inpFilas').value);
    const posicoes = grade.map(c => ({ pos: c.pos, fila: c.fila, coluna: c.coluna, aluno: c.aluno || null }));

    try {
        const r = await fetch(`${API}/mapa-sala`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                codturma: turmaAtual.codturma,
                turma:    turmaAtual.turma,
                colunas, filas, posicoes,
                alunos_fora: alunosFora,
            }),
        });
        const data = await r.json();
        if (data.erro) throw new Error(data.erro);
        mostrarToast('Mapa salvo com sucesso!', 'ok');
        marcarSalvo();
    } catch (e) {
        mostrarToast('Erro ao salvar: ' + e.message, 'erro');
    }
}

// ── Imprimir ─────────────────────────────────────────────────
function imprimirMapa() {
    window.print();
}

// ── Helpers ──────────────────────────────────────────────────
function marcarModificado() {
    modificado = true;
    const btn = document.getElementById('btnSalvar');
    btn.textContent = '💾 Salvar Mapa *';
    btn.disabled = false;
}
function marcarSalvo() {
    modificado = false;
    document.getElementById('btnSalvar').textContent = '💾 Salvar Mapa';
}

function iniciais2(nome) {
    const p = String(nome || '?').trim().split(/\s+/);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function primeiroNomePrimUlt(nome) {
    const p = String(nome || '').trim().split(/\s+/);
    if (p.length <= 2) return nome;
    return `${p[0]} ${p[p.length - 1]}`;
}

function abreviarNomeTurma(nome) {
    if (!nome) return nome;
    const partes = nome.split(' - ');
    const serieIdx = partes.findIndex(p => /\d+[ªoaº°]?\s*(s[eé]rie|ano)/i.test(p));
    if (serieIdx === -1) return nome;
    const serie = partes[serieIdx].replace(/série/i, 'série').trim();
    const resto = partes.filter((_, i) => i !== serieIdx).join(' · ');
    return `${serie} · ${resto}`;
}

function mostrarToast(msg, tipo) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${tipo || ''}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Logout
document.getElementById('btnLogout').addEventListener('click', async () => {
    await fetch(`${API}/logout`, { method: 'POST' }).catch(() => {});
    window.location.href = '/';
});

// Avisar sobre alterações não salvas ao sair da página
window.addEventListener('beforeunload', e => {
    if (modificado) { e.preventDefault(); e.returnValue = ''; }
});

// Impressão A4: expandir grade para largura total da folha
window.addEventListener('beforeprint', () => {
    const el = document.getElementById('grade');
    if (!el) return;
    el._origGridCols = el.style.gridTemplateColumns;
    const colunas = parseInt(document.getElementById('inpColunas').value) || 5;
    el.style.gridTemplateColumns = `repeat(${colunas}, 1fr)`;
});
window.addEventListener('afterprint', () => {
    const el = document.getElementById('grade');
    if (el && el._origGridCols !== undefined) {
        el.style.gridTemplateColumns = el._origGridCols;
    }
});

init();
