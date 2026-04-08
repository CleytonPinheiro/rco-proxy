/* ─────────────────────────────────────────────────────────────
   Mapa de Sala — lógica principal
   ──────────────────────────────────────────────────────────── */

const API = '/api';

// Estado global
let turmaAtual      = null;   // { codturma, turma }
let todosAlunos     = [];     // lista completa da turma
let grade           = [];     // array de objetos: { pos, fila, coluna, aluno|null }
let alunosFora      = [];     // alunos ainda não posicionados
let alunosExcluidos = [];     // alunos removidos da turma (transferidos, etc.)
let dragSource      = null;   // { tipo: 'banco'|'carteira', pos?, aluno }
let modificado      = false;

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

    // Guardar valor anterior para poder reverter se usuário cancelar
    if (modificado) {
        const ok = confirm('Há alterações não salvas no mapa atual.\nTrocar de turma irá descartar essas alterações.\n\nDeseja continuar sem salvar?');
        if (!ok) {
            // Reverter seleção para a turma anterior
            sel.value = turmaAtual?.codturma || '';
            return;
        }
    }

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
            alunosExcluidos = mapa.alunos_excluidos || [];
            document.getElementById('inpColunas').value = mapa.colunas;
            document.getElementById('lblColunas').textContent = mapa.colunas;
            document.getElementById('inpFilas').value = mapa.filas;
            document.getElementById('lblFilas').textContent = mapa.filas;
            construirGrade(mapa.colunas, mapa.filas, mapa.posicoes);
        } else {
            alunosExcluidos = [];
            const col = parseInt(document.getElementById('inpColunas').value);
            const fil = parseInt(document.getElementById('inpFilas').value);
            construirGrade(col, fil, []);
        }
    } catch (e) {
        alunosExcluidos = [];
        const col = parseInt(document.getElementById('inpColunas').value);
        const fil = parseInt(document.getElementById('inpFilas').value);
        construirGrade(col, fil, []);
    }
    atualizarBotoesAcoes();
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

    // Calcula alunos fora: todos que não estão em nenhuma carteira nem foram excluídos
    const ocupados  = new Set(grade.filter(c => c.aluno).map(c => c.aluno.codmatrizaluno));
    const excluidos = new Set(alunosExcluidos.map(a => a.codmatrizaluno));
    alunosFora = todosAlunos.filter(a => !ocupados.has(a.codmatrizaluno) && !excluidos.has(a.codmatrizaluno));

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
    grade = []; alunosFora = []; alunosExcluidos = [];
    document.getElementById('grade').innerHTML    = '';
    document.getElementById('grade').style.display = 'none';
    document.getElementById('vazioMsg').style.display = '';
    renderBanco();
    document.getElementById('btnSalvar').disabled = true;
    atualizarBotoesAcoes();
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

    // Atualiza indicador de excluídos
    let exclBtn = document.getElementById('bancoExclBtn');
    if (alunosExcluidos.length) {
        if (!exclBtn) {
            exclBtn = document.createElement('button');
            exclBtn.id = 'bancoExclBtn';
            exclBtn.className = 'ms-banco-excl-btn';
            exclBtn.onclick = restaurarExcluidos;
            document.getElementById('banco').querySelector('.ms-banco-header').appendChild(exclBtn);
        }
        exclBtn.textContent = `${alunosExcluidos.length} excluído${alunosExcluidos.length !== 1 ? 's' : ''} · Restaurar`;
        exclBtn.style.display = '';
    } else if (exclBtn) {
        exclBtn.style.display = 'none';
    }

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
            <button class="ms-chip-rem" title="Remover aluno da lista (transferido)" onclick="excluirAluno(${a.codmatrizaluno})">✕</button>
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
    const ocupados  = new Set(grade.filter(c => c.aluno).map(c => c.aluno.codmatrizaluno));
    const excluidos = new Set(alunosExcluidos.map(a => a.codmatrizaluno));
    alunosFora = todosAlunos.filter(a => !ocupados.has(a.codmatrizaluno) && !excluidos.has(a.codmatrizaluno));
    alunosFora.sort((a, b) => (a.numchamada || 999) - (b.numchamada || 999));
}

// ── Resetar mapa ─────────────────────────────────────────────
function resetarMapa() {
    if (!turmaAtual || !grade.length) return;
    const totalOcupadas = grade.filter(c => c.aluno).length;
    if (!totalOcupadas) { mostrarToast('O mapa já está vazio.', ''); return; }
    const ok = confirm(
        `Resetar o mapa da turma "${turmaAtual.turma}"?\n\n` +
        `Todos os ${totalOcupadas} aluno${totalOcupadas !== 1 ? 's' : ''} posicionado${totalOcupadas !== 1 ? 's' : ''} voltarão para a lista de disponíveis.\n\n` +
        `Esta ação pode ser desfeita salvando o mapa em branco ou recarregando a página sem salvar.`
    );
    if (!ok) return;
    grade.forEach(c => { c.aluno = null; });
    const excluidos = new Set(alunosExcluidos.map(a => a.codmatrizaluno));
    alunosFora = todosAlunos.filter(a => !excluidos.has(a.codmatrizaluno));
    alunosFora.sort((a, b) => (a.numchamada || 999) - (b.numchamada || 999));
    renderGrade(parseInt(document.getElementById('inpColunas').value));
    renderBanco();
    marcarModificado();
    mostrarToast('Mapa resetado — todos os alunos estão disponíveis.', 'ok');
}

// ── Distribuir automaticamente ────────────────────────────────
function distribuirAutomaticamente() {
    if (!turmaAtual || !grade.length) return;
    if (!alunosFora.length) { mostrarToast('Não há alunos disponíveis para distribuir.', ''); return; }

    const disponiveis = [...alunosFora].sort((a, b) => (a.numchamada || 999) - (b.numchamada || 999));
    const alocados = new Set();

    // Tentativa 1: posiciona cada aluno na carteira cujo número = numchamada
    disponiveis.forEach(aluno => {
        const pos = (aluno.numchamada || 0) - 1;
        if (pos >= 0 && pos < grade.length && !grade[pos].aluno) {
            grade[pos].aluno = aluno;
            alocados.add(aluno.codmatrizaluno);
        }
    });

    // Tentativa 2: alunos que não encontraram a carteira exata → próxima vazia em ordem
    const sobras     = disponiveis.filter(a => !alocados.has(a.codmatrizaluno));
    const carteiras  = grade.filter(c => !c.aluno);
    let idx = 0;
    sobras.forEach(aluno => {
        if (idx < carteiras.length) {
            carteiras[idx].aluno = aluno;
            alocados.add(aluno.codmatrizaluno);
            idx++;
        }
    });

    alunosFora = alunosFora.filter(a => !alocados.has(a.codmatrizaluno));
    renderGrade(parseInt(document.getElementById('inpColunas').value));
    renderBanco();
    marcarModificado();
    mostrarToast(`${alocados.size} aluno${alocados.size !== 1 ? 's' : ''} distribuído${alocados.size !== 1 ? 's' : ''} pela ordem de chamada.`, 'ok');
}

// ── Excluir aluno (transferido) ───────────────────────────────
function excluirAluno(codmatrizaluno) {
    const aluno = alunosFora.find(a => a.codmatrizaluno === codmatrizaluno);
    if (!aluno) return;
    const ok = confirm(
        `Remover "${aluno.nome}" da lista de alunos?\n\n` +
        `Use esta opção para alunos que foram transferidos ou que não fazem mais parte desta turma.\n\n` +
        `O aluno pode ser restaurado a qualquer momento clicando em "Restaurar" no painel de alunos.`
    );
    if (!ok) return;
    alunosExcluidos.push(aluno);
    alunosFora = alunosFora.filter(a => a.codmatrizaluno !== codmatrizaluno);
    renderBanco();
    marcarModificado();
    mostrarToast(`${aluno.nome.split(' ')[0]} removido da lista.`, 'ok');
}

// ── Restaurar excluídos ───────────────────────────────────────
function restaurarExcluidos() {
    if (!alunosExcluidos.length) return;
    const n = alunosExcluidos.length;
    const ok = confirm(`Restaurar ${n} aluno${n !== 1 ? 's' : ''} excluído${n !== 1 ? 's' : ''} de volta para a lista de disponíveis?`);
    if (!ok) return;
    const ocupados = new Set(grade.filter(c => c.aluno).map(c => c.aluno.codmatrizaluno));
    alunosExcluidos.forEach(a => { if (!ocupados.has(a.codmatrizaluno)) alunosFora.push(a); });
    alunosExcluidos = [];
    alunosFora.sort((a, b) => (a.numchamada || 999) - (b.numchamada || 999));
    renderBanco();
    marcarModificado();
    mostrarToast(`${n} aluno${n !== 1 ? 's' : ''} restaurado${n !== 1 ? 's' : ''}.`, 'ok');
}

// ── Habilitar/desabilitar botões de ação ─────────────────────
function atualizarBotoesAcoes() {
    const ativo = !!turmaAtual;
    document.getElementById('btnResetar').disabled    = !ativo;
    document.getElementById('btnDistribuir').disabled = !ativo;
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
                alunos_fora:      alunosFora,
                alunos_excluidos: alunosExcluidos,
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
    btn.textContent = '💾 Salvar Mapa';
    btn.disabled = false;
    btn.classList.add('pendente');
}
function marcarSalvo() {
    modificado = false;
    const btn = document.getElementById('btnSalvar');
    btn.textContent = '💾 Salvar Mapa';
    btn.classList.remove('pendente');
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
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    window.location.replace('/login/');
});

// Avisar sobre alterações não salvas ao sair da página (F5, fechar aba, URL manual)
window.addEventListener('beforeunload', e => {
    if (modificado) { e.preventDefault(); e.returnValue = ''; }
});

// Interceptar cliques em links de navegação (sidebar, header) para avisar sobre pendências
document.addEventListener('click', e => {
    if (!modificado) return;
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('#')) return;
    e.preventDefault();
    const ok = confirm('Há alterações não salvas no mapa.\nDeseja sair sem salvar?');
    if (ok) {
        modificado = false;
        window.location.href = href;
    }
}, true);

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
