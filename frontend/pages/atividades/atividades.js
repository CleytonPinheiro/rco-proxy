// ── Atividades de Sala ─────────────────────────────────────────────────────
const API    = '';
const N      = 15;   // número de aulas
const COLS   = Array.from({ length: N }, (_, i) => `aula${i + 1}`);

let turmas    = [];
let alunos    = [];
let registros = {};   // codmatrizaluno → { atividades:{}, observacao:'' }
let modificado = false;
let codturmaAtual = '';

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

// ── Datas das aulas (localStorage por turma) ──────────────────────────────
function lsKey(cod) { return `atv_datas_${cod}`; }

function carregarDatasAula(cod) {
    try { return JSON.parse(localStorage.getItem(lsKey(cod))) || {}; }
    catch { return {}; }
}

function salvarDatasAula(cod, datas) {
    localStorage.setItem(lsKey(cod), JSON.stringify(datas));
}

function onDataAula(inp) {
    const datas = carregarDatasAula(codturmaAtual);
    datas[inp.dataset.col] = inp.value;
    salvarDatasAula(codturmaAtual, datas);
}

// ── Thead dinâmico ────────────────────────────────────────────────────────
function renderThead() {
    const datas = carregarDatasAula(codturmaAtual);
    const thead = document.getElementById('tabelaHead');

    thead.innerHTML = `
        <tr class="tr-header-aulas">
            <th class="col-num">Nº</th>
            <th class="col-nome">Aluno</th>
            ${COLS.map((col, i) => `<th class="col-check">Aula ${i + 1}</th>`).join('')}
            <th class="col-obs">Observação</th>
        </tr>
        <tr class="tr-datas-aulas">
            <td colspan="2" class="td-label-data">📅 Data</td>
            ${COLS.map(col => `
            <td class="col-check">
                <input type="text" class="input-data-aula" data-col="${col}"
                    placeholder="--/--"
                    value="${(datas[col] || '').replace(/"/g, '&quot;')}"
                    oninput="onDataAula(this)"
                    maxlength="8">
            </td>`).join('')}
            <td></td>
        </tr>
        <tr class="tr-marcar-todos no-print">
            <td colspan="2" class="td-marcar-label">Marcar todos</td>
            ${COLS.map(col => `
            <td class="col-check">
                <input type="checkbox" class="chk-todos" data-col="${col}"
                    onchange="marcarTodos('${col}', this.checked)">
            </td>`).join('')}
            <td></td>
        </tr>
    `;
}

// ── Mudança de turma ──────────────────────────────────────────────────────
function onTurmaChange() {
    if (modificado) {
        if (!confirm('Há alterações não salvas. Deseja trocar de turma sem salvar?')) {
            document.getElementById('selTurma').value = codturmaAtual;
            return;
        }
    }
    marcarSalvo();
    carregarPagina();
}

// ── Carregar dados ────────────────────────────────────────────────────────
async function carregarPagina() {
    const codturma = document.getElementById('selTurma').value;
    const data     = document.getElementById('selData').value;

    if (!codturma || !data) { mostrarPlaceholder(); return; }

    codturmaAtual = codturma;
    mostrarLoading();

    try {
        const [resAlunos, resReg] = await Promise.all([
            fetch(`${API}/api/alunos?codturma=${codturma}`),
            fetch(`${API}/api/atividades?codturma=${codturma}&data=${data}`),
        ]);

        alunos = await resAlunos.json();
        const regArr = await resReg.json();

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

// ── Renderização ──────────────────────────────────────────────────────────
function renderTabela() {
    if (!alunos.length) { mostrarPlaceholder(); return; }

    document.getElementById('atv-placeholder').style.display = 'none';
    document.getElementById('atv-loading').style.display     = 'none';
    document.getElementById('tabelaWrap').style.display      = 'block';
    document.getElementById('btnSalvar').disabled   = false;
    document.getElementById('btnImprimir').disabled = false;

    renderThead();

    const tbody = document.getElementById('tabelaBody');
    tbody.innerHTML = '';

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
                <input type="text" class="atv-obs-input no-print" placeholder="Observação..."
                    value="${(reg.observacao || '').replace(/"/g, '&quot;')}"
                    data-cod="${al.codmatrizaluno}"
                    oninput="onObs(this)">
                <span class="obs-print">${(reg.observacao || '').replace(/</g, '&lt;')}</span>
            </td>
        `;
        tbody.appendChild(tr);
    });

    atualizarChkTodos();
    marcarSalvo();
}

// ── Eventos de interação ──────────────────────────────────────────────────
function onCheck(chk) {
    const cod = chk.dataset.cod;
    const col = chk.dataset.col;

    if (!registros[cod]) registros[cod] = { atividades: {}, observacao: '' };
    registros[cod].atividades[col] = chk.checked;

    const tr = chk.closest('tr');
    const todasMarcadas = COLS.every(c => {
        const inp = tr.parentElement.querySelector(`input[data-cod="${cod}"][data-col="${c}"]`);
        return inp ? inp.checked : false;
    });
    tr.classList.toggle('linha-ok', todasMarcadas);

    atualizarChkTodos();
    marcarModificado();
}

function onObs(inp) {
    const cod = inp.dataset.cod;
    if (!registros[cod]) registros[cod] = { atividades: {}, observacao: '' };
    registros[cod].observacao = inp.value;
    const span = inp.closest('td').querySelector('.obs-print');
    if (span) span.textContent = inp.value;
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
    atualizarChkTodos();
    marcarModificado();
}

function atualizarChkTodos() {
    COLS.forEach(col => {
        const todos    = document.querySelectorAll(`.atv-chk[data-col="${col}"]`);
        const marcados = document.querySelectorAll(`.atv-chk[data-col="${col}"]:checked`);
        const chkTodos = document.querySelector(`.chk-todos[data-col="${col}"]`);
        if (!chkTodos) return;
        chkTodos.checked       = todos.length > 0 && marcados.length === todos.length;
        chkTodos.indeterminate = marcados.length > 0 && marcados.length < todos.length;
    });
}

// ── Imprimir ──────────────────────────────────────────────────────────────
function imprimir() {
    const selTurma = document.getElementById('selTurma');
    const data     = document.getElementById('selData').value;

    const nomeTurma = selTurma.options[selTurma.selectedIndex]?.text || '';
    const dataFmt   = data
        ? new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
        : '';

    document.getElementById('printTurma').textContent = nomeTurma;
    document.getElementById('printData').textContent  = dataFmt;
    document.getElementById('printHeader').style.display = 'block';

    window.print();

    document.getElementById('printHeader').style.display = 'none';
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
    document.getElementById('btnSalvar').classList.remove('pendente');
}

// ── Estados visuais ───────────────────────────────────────────────────────
function mostrarPlaceholder() {
    document.getElementById('atv-placeholder').style.display = 'block';
    document.getElementById('atv-loading').style.display     = 'none';
    document.getElementById('tabelaWrap').style.display      = 'none';
    document.getElementById('btnSalvar').disabled   = true;
    document.getElementById('btnImprimir').disabled = true;
}

function mostrarLoading() {
    document.getElementById('atv-loading').style.display     = 'block';
    document.getElementById('atv-placeholder').style.display = 'none';
    document.getElementById('tabelaWrap').style.display      = 'none';
}

// ── Guarda de navegação ────────────────────────────────────────────────────
window.addEventListener('beforeunload', e => {
    if (modificado) { e.preventDefault(); e.returnValue = ''; }
});
