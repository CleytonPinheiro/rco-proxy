// ── Atividades de Sala ─────────────────────────────────────────────────────
const API = '';
const COLS = ['tarefa', 'atividade', 'participacao', 'caderno', 'material'];

let turmas      = [];
let alunos      = [];
let registros   = {};   // codmatrizaluno → { atividades:{}, observacao:'' }
let modificado  = false;

// ── Auth ──────────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        if (!d.tokenEmCache) window.location.href = '/';
    } catch { window.location.href = '/'; }
}

// ── Inicialização ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await carregarTurmas();

    // Data padrão = hoje
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('selData').value = hoje;
});

async function carregarTurmas() {
    try {
        const r = await fetch(`${API}/api/alunos/turmas/lista`);
        turmas = await r.json();
        const sel = document.getElementById('selTurma');
        turmas.forEach(t => {
            const op = document.createElement('option');
            op.value = t.codturma;
            op.textContent = t.turma;
            sel.appendChild(op);
        });
    } catch (e) { console.error('Erro ao carregar turmas:', e); }
}

// ── Mudança de turma ──────────────────────────────────────────────────────
function onTurmaChange() {
    if (modificado) {
        if (!confirm('Há alterações não salvas. Deseja trocar de turma sem salvar?')) {
            const sel = document.getElementById('selTurma');
            const turmaAtual = alunos.length ? alunos[0].codturma : '';
            sel.value = turmaAtual;
            return;
        }
    }
    marcarSalvo();
    carregarPagina();
}

// ── Carregar dados (alunos + registros do dia) ────────────────────────────
async function carregarPagina() {
    const codturma = document.getElementById('selTurma').value;
    const data     = document.getElementById('selData').value;

    if (!codturma || !data) {
        mostrarPlaceholder();
        return;
    }

    mostrarLoading();

    try {
        const [resAlunos, resReg] = await Promise.all([
            fetch(`${API}/api/alunos?codturma=${codturma}`),
            fetch(`${API}/api/atividades?codturma=${codturma}&data=${data}`),
        ]);

        alunos = await resAlunos.json();
        const regArr = await resReg.json();

        // Indexa registros por codmatrizaluno
        registros = {};
        regArr.forEach(r => {
            registros[r.codmatrizaluno] = {
                atividades: r.atividades || {},
                observacao: r.observacao || '',
            };
        });

        renderTabela();
    } catch (e) {
        console.error('Erro ao carregar:', e);
        mostrarPlaceholder();
    }
}

// ── Renderização da tabela ────────────────────────────────────────────────
function renderTabela() {
    if (!alunos.length) { mostrarPlaceholder(); return; }

    document.getElementById('atv-placeholder').style.display = 'none';
    document.getElementById('atv-loading').style.display     = 'none';
    document.getElementById('atv-legenda').style.display     = 'flex';
    document.getElementById('tabelaWrap').style.display      = 'block';
    document.getElementById('btnSalvar').disabled = false;

    const tbody = document.getElementById('tabelaBody');
    tbody.innerHTML = '';

    // Ordena por num_chamada depois nome
    const ordenados = [...alunos].sort((a, b) => {
        const na = a.numchamada || 9999;
        const nb = b.numchamada || 9999;
        return na !== nb ? na - nb : a.nome.localeCompare(b.nome);
    });

    ordenados.forEach(al => {
        const reg = registros[al.codmatrizaluno] || { atividades: {}, observacao: '' };
        const todasMarcadas = COLS.every(c => reg.atividades[c]);

        const tr = document.createElement('tr');
        if (todasMarcadas) tr.classList.add('linha-ok');
        tr.dataset.cod = al.codmatrizaluno;

        tr.innerHTML = `
            <td class="td-num">${al.numchamada || '—'}</td>
            <td class="td-nome">${al.nome}</td>
            ${COLS.map(col => `
            <td class="col-check">
                <input type="checkbox" class="atv-chk" data-col="${col}" data-cod="${al.codmatrizaluno}"
                    ${reg.atividades[col] ? 'checked' : ''}
                    onchange="onCheck(this)">
            </td>`).join('')}
            <td class="col-obs">
                <input type="text" class="atv-obs-input" placeholder="Observação..."
                    value="${(reg.observacao || '').replace(/"/g, '&quot;')}"
                    data-cod="${al.codmatrizaluno}"
                    oninput="onObs(this)">
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderRodape(ordenados);
    atualizarChkTodos();
    marcarSalvo();
}

function renderRodape(ordenados) {
    const tfoot = document.getElementById('tabelaFoot');
    tfoot.innerHTML = '';
    const tr = document.createElement('tr');

    const totais = {};
    COLS.forEach(c => { totais[c] = 0; });
    ordenados.forEach(al => {
        const reg = registros[al.codmatrizaluno] || { atividades: {} };
        COLS.forEach(c => { if (reg.atividades[c]) totais[c]++; });
    });

    tr.innerHTML = `
        <td colspan="2" class="td-label">Totais por atividade</td>
        ${COLS.map(c => `<td><span class="total-chip">${totais[c]}/${ordenados.length}</span></td>`).join('')}
        <td></td>
    `;
    tfoot.appendChild(tr);
}

// ── Eventos de interação ──────────────────────────────────────────────────
function onCheck(chk) {
    const cod = chk.dataset.cod;
    const col = chk.dataset.col;

    if (!registros[cod]) registros[cod] = { atividades: {}, observacao: '' };
    registros[cod].atividades[col] = chk.checked;

    // Atualiza classe da linha
    const tr = chk.closest('tr');
    const todasMarcadas = COLS.every(c => {
        const inp = tr.parentElement.querySelector(`input[data-cod="${cod}"][data-col="${c}"]`);
        return inp ? inp.checked : false;
    });
    tr.classList.toggle('linha-ok', todasMarcadas);

    // Atualiza rodapé e checkbox de "todos"
    atualizarRodape();
    atualizarChkTodos();
    marcarModificado();
}

function onObs(inp) {
    const cod = inp.dataset.cod;
    if (!registros[cod]) registros[cod] = { atividades: {}, observacao: '' };
    registros[cod].observacao = inp.value;
    marcarModificado();
}

function marcarTodos(col, checked) {
    document.querySelectorAll(`.atv-chk[data-col="${col}"]`).forEach(chk => {
        const cod = chk.dataset.cod;
        chk.checked = checked;
        if (!registros[cod]) registros[cod] = { atividades: {}, observacao: '' };
        registros[cod].atividades[col] = checked;

        const tr = chk.closest('tr');
        const todasMarcadas = COLS.every(c => {
            const inp = tr.parentElement.querySelector(`input[data-cod="${cod}"][data-col="${c}"]`);
            return inp ? inp.checked : false;
        });
        tr.classList.toggle('linha-ok', todasMarcadas);
    });
    atualizarRodape();
    marcarModificado();
}

function atualizarRodape() {
    const tfoot = document.getElementById('tabelaFoot');
    if (!tfoot.children.length) return;
    const total = alunos.length;
    const chips = tfoot.querySelectorAll('.total-chip');
    COLS.forEach((col, i) => {
        const marcados = document.querySelectorAll(`.atv-chk[data-col="${col}"]:checked`).length;
        chips[i].textContent = `${marcados}/${total}`;
    });
}

function atualizarChkTodos() {
    COLS.forEach(col => {
        const todos     = document.querySelectorAll(`.atv-chk[data-col="${col}"]`);
        const marcados  = document.querySelectorAll(`.atv-chk[data-col="${col}"]:checked`);
        const chkTodos  = document.querySelector(`.chk-todos[data-col="${col}"]`);
        if (!chkTodos) return;
        chkTodos.checked       = todos.length > 0 && marcados.length === todos.length;
        chkTodos.indeterminate = marcados.length > 0 && marcados.length < todos.length;
    });
}

// ── Salvar ────────────────────────────────────────────────────────────────
async function salvar() {
    const codturma = document.getElementById('selTurma').value;
    const data     = document.getElementById('selData').value;

    if (!codturma || !data || !alunos.length) return;

    const btn = document.getElementById('btnSalvar');
    btn.textContent = 'Salvando...';
    btn.disabled = true;

    const registrosArr = alunos.map(al => ({
        codmatrizaluno: al.codmatrizaluno,
        nome_aluno:     al.nome,
        num_chamada:    al.numchamada || null,
        atividades:     (registros[al.codmatrizaluno] || {}).atividades || {},
        observacao:     (registros[al.codmatrizaluno] || {}).observacao || '',
    }));

    try {
        const r = await fetch(`${API}/api/atividades/salvar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codturma, data, registros: registrosArr }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao salvar');

        marcarSalvo();
        btn.textContent = 'Salvo ✓';
        setTimeout(() => { btn.textContent = 'Salvar'; }, 2000);
    } catch (e) {
        alert('Erro ao salvar: ' + e.message);
        btn.textContent = 'Salvar';
        btn.disabled = false;
    }
}

// ── Estado salvo / modificado ─────────────────────────────────────────────
function marcarModificado() {
    modificado = true;
    const btn = document.getElementById('btnSalvar');
    btn.disabled = false;
    btn.classList.add('pendente');
    btn.textContent = 'Salvar';
}

function marcarSalvo() {
    modificado = false;
    const btn = document.getElementById('btnSalvar');
    btn.classList.remove('pendente');
}

// ── Estados visuais ───────────────────────────────────────────────────────
function mostrarPlaceholder() {
    document.getElementById('atv-placeholder').style.display = 'block';
    document.getElementById('atv-loading').style.display     = 'none';
    document.getElementById('atv-legenda').style.display     = 'none';
    document.getElementById('tabelaWrap').style.display      = 'none';
    document.getElementById('btnSalvar').disabled = true;
}

function mostrarLoading() {
    document.getElementById('atv-loading').style.display     = 'block';
    document.getElementById('atv-placeholder').style.display = 'none';
    document.getElementById('atv-legenda').style.display     = 'none';
    document.getElementById('tabelaWrap').style.display      = 'none';
}

// ── Guarda de navegação ────────────────────────────────────────────────────
window.addEventListener('beforeunload', e => {
    if (modificado) { e.preventDefault(); e.returnValue = ''; }
});
