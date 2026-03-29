/**
 * Módulo de Livros Didáticos — Empréstimos Anuais
 * Tabs: Empréstimos | Acervo (livros) | Imprimir (etiquetas + lista de responsabilidade)
 */

const API = '';
let todoAlunos   = [];   // [{codMatrizAluno, nome, codTurma, descrTurma, numChamada}]
let livros       = [];   // catálogo de livros
let emprestimos  = [];   // registros de empréstimo ativos + histórico
let tabAtual     = 'emprestimos';

/* ─── Helpers ─────────────────────────────────────────────────────── */
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function fmtData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
}

function labelStatus(s) {
    return { emprestado: '📖 Emprestado', devolvido: '✅ Devolvido', perdido: '❌ Perdido' }[s] || s;
}

function toast(msg, tipo) {
    const el = document.getElementById('toastLivros');
    el.textContent = msg;
    el.className   = `toast-livros${tipo ? ' ' + tipo : ''}`;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3200);
}

async function apiFetch(url, opts = {}) {
    const r = await fetch(`${API}/api${url}`, { credentials: 'include', ...opts });
    if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.erro || `HTTP ${r.status}`);
    }
    return r.json();
}

/* ─── Init ────────────────────────────────────────────────────────── */
async function init() {
    try {
        const [alunosRaw, livrosRaw, empRaw] = await Promise.all([
            apiFetch('/alunos'),
            apiFetch('/livros'),
            apiFetch('/livros-emprestimos'),
        ]);

        todoAlunos  = alunosRaw.map(a => ({
            codMatrizAluno: a.cod_matriz_aluno || a.codMatrizAluno || a.codmatrizaluno,
            nome:           a.nome || '(sem nome)',
            descrTurma:     a.descr_turma || a.descrTurma || a.turma || '',
            numChamada:     a.num_chamada || a.numChamada || a.numchamada || '',
        }));
        todoAlunos.sort((a, b) => a.descrTurma.localeCompare(b.descrTurma) || (a.numChamada - b.numChamada));

        livros      = livrosRaw;
        emprestimos = empRaw;

        popularSelectLivros();
        popularSelectTurmas();
        popularSelectSerieModal();
        atualizarStats();
        renderEmprestimos();
        renderAcervo();

        // Inicializa data estimada de entrega com hoje
        const inputData = document.getElementById('printDataEntregaLista');
        if (inputData && !inputData.value) {
            inputData.value = new Date().toISOString().slice(0, 10);
        }
    } catch (e) {
        toast('Erro ao carregar dados: ' + e.message, 'erro');
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
}

/* ─── Stats ─────────────────────────────────────────────────────── */
function atualizarStats() {
    document.getElementById('numEmprestados').textContent = emprestimos.filter(e => e.status === 'emprestado').length;
    document.getElementById('numDevolvidos').textContent  = emprestimos.filter(e => e.status === 'devolvido').length;
    document.getElementById('numPerdidos').textContent    = emprestimos.filter(e => e.status === 'perdido').length;
    document.getElementById('numAcervo').textContent      = livros.length;
}

/* ─── Populate selects ───────────────────────────────────────────── */
function popularSelectLivros() {
    const ids = ['filtroLivro', 'modalEmpLivro', 'printFiltroLivro', 'printFiltroLivroLista'];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const val = sel.value;
        sel.innerHTML = '<option value="">— Todos os livros —</option>';
        livros.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.text  = `${l.titulo}${l.disciplina ? ' — ' + l.disciplina : ''}${l.serie ? ' — ' + l.serie : ''}`;
            sel.appendChild(opt);
        });
        if (val) sel.value = val;
    });
}

function popularSelectSerieModal() {
    const sel = document.getElementById('modalLivroSerie');
    if (!sel) return;

    // Valores já presentes na lista estática do HTML
    const existentes = new Set(
        [...sel.querySelectorAll('option')].map(o => o.value).filter(Boolean),
    );

    // Séries encontradas nas turmas carregadas que não estão na lista estática
    const extras = new Set();
    todoAlunos.forEach(a => {
        const m = a.descrTurma.match(/(\d+[ºaª°]?\s*(?:Ano|[Ss][eé]rie))/i);
        if (m) {
            const s = m[1].trim();
            if (!existentes.has(s)) extras.add(s);
        }
    });

    if (!extras.size) return;

    // Agrupa as extras em um optgroup separado
    const grp = document.createElement('optgroup');
    grp.label = 'Outras séries (da escola)';
    [...extras].sort((a, b) => {
        const na = parseInt(a), nb = parseInt(b);
        return na !== nb ? na - nb : a.localeCompare(b, 'pt-BR');
    }).forEach(s => {
        const opt = document.createElement('option');
        opt.value       = s;
        opt.textContent = s;
        grp.appendChild(opt);
    });
    sel.appendChild(grp);
}

function popularSelectTurmas() {
    const turmas = [...new Set(todoAlunos.map(a => a.descrTurma))].sort();
    const ids    = ['filtroTurma', 'printFiltroTurma', 'printFiltroTurmaLista'];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const val = sel.value;
        sel.innerHTML = '<option value="">— Todas as turmas —</option>';
        turmas.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.text  = t;
            sel.appendChild(opt);
        });
        if (val) sel.value = val;
    });
    // Modal de empréstimo: select de turma
    const selModal = document.getElementById('modalEmpTurma');
    if (selModal) {
        selModal.innerHTML = '<option value="">— Selecione a turma —</option>';
        turmas.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t; opt.text = t;
            selModal.appendChild(opt);
        });
    }
}

/* ─── Tab: EMPRÉSTIMOS ───────────────────────────────────────────── */
function filtrarEmprestimos() {
    const busca  = (document.getElementById('filtroAluno')?.value  || '').toLowerCase();
    const status = document.getElementById('filtroStatus')?.value  || '';
    const turma  = document.getElementById('filtroTurma')?.value   || '';
    const livroId= document.getElementById('filtroLivro')?.value   || '';

    let lista = [...emprestimos];
    if (busca)   lista = lista.filter(e => e.nome_aluno.toLowerCase().includes(busca));
    if (status)  lista = lista.filter(e => e.status === status);
    if (turma)   lista = lista.filter(e => e.turma === turma);
    if (livroId) lista = lista.filter(e => String(e.livro_id) === livroId);

    renderEmprestimos(lista);
}

function renderEmprestimos(lista) {
    if (!lista) lista = emprestimos;
    const container = document.getElementById('listaEmprestimos');
    if (!lista.length) {
        container.innerHTML = `<div class="empty-livros"><div class="ei">📚</div><p>Nenhum empréstimo encontrado</p></div>`;
        return;
    }

    // Agrupar por turma
    const grupos = {};
    for (const e of lista) {
        const key = e.turma || 'Sem turma';
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(e);
    }

    container.innerHTML = Object.entries(grupos).sort(([a],[b]) => a.localeCompare(b)).map(([turma, items]) => `
    <div class="turma-secao-livros">
        <div class="turma-header-livros">
            <div style="display:flex;align-items:center;gap:10px;">
                <span class="turma-header-nome">${esc(turma)}</span>
                <span class="turma-header-count">${items.length} empréstimo(s)</span>
            </div>
        </div>
        <div class="emprestimos-grid">
            ${items.map(e => renderCardEmprestimo(e)).join('')}
        </div>
    </div>`).join('');
}

function renderCardEmprestimo(e) {
    const atrasado = e.status === 'emprestado' && new Date() > new Date(new Date(e.data_emprestimo).setFullYear(new Date(e.data_emprestimo).getFullYear() + 1));
    const statusReal = atrasado ? 'atrasado' : e.status;
    return `
    <div class="emp-card status-${statusReal}">
        <div class="emp-card-top">
            <div>
                <div class="emp-aluno-nome">${esc(e.nome_aluno)}</div>
                <div class="emp-livro-nome">${esc(e.livro_titulo)}</div>
                <div class="emp-livro-detalhe">${esc(e.livro_disciplina || '')}${e.livro_serie ? ' · ' + esc(e.livro_serie) : ''}</div>
            </div>
            <div class="emp-chamada">${e.num_chamada || '—'}</div>
        </div>
        <div class="emp-status-badge badge-${e.status}">${labelStatus(e.status)}</div>
        <div class="emp-data-info">Empréstimo: ${fmtData(e.data_emprestimo)} · Ano: ${e.ano_letivo}</div>
        ${e.data_devolucao ? `<div class="emp-data-info">Devolvido: ${fmtData(e.data_devolucao)}</div>` : ''}
        ${e.status === 'emprestado' ? `
        <div class="emp-acoes">
            <button class="btn-acao-livro btn-acao-livro--success" onclick="devolverEmprestimo(${e.id}, '${esc(e.nome_aluno)}')">✅ Devolvido</button>
            <button class="btn-acao-livro btn-acao-livro--danger"  onclick="marcarPerdido(${e.id}, '${esc(e.nome_aluno)}')">❌ Perdido</button>
        </div>` : ''}
    </div>`;
}

/* ─── Modal de Confirmação ────────────────────────────────────────── */
let _confirmPendente = null;

const _modalConfirm    = () => document.getElementById('modalConfirmAcao');
const _confirmObs      = () => document.getElementById('confirmObs');
const _confirmTitulo   = () => document.getElementById('confirmTitulo');
const _confirmDesc     = () => document.getElementById('confirmDesc');
const _confirmIcone    = () => document.getElementById('confirmIcone');
const _btnConfirmar    = () => document.getElementById('btnConfirmarAcao');

function _abrirConfirm({ icone, titulo, desc, tipo, acao }) {
    _confirmIcone().textContent   = icone;
    _confirmTitulo().textContent  = titulo;
    _confirmDesc().innerHTML      = desc;
    _confirmObs().value           = '';
    _btnConfirmar().className     = tipo === 'devolvido' ? 'confirmar-devolvido' : 'confirmar-perdido';
    _btnConfirmar().textContent   = tipo === 'devolvido' ? '✅ Confirmar Devolução' : '❌ Confirmar Perda';
    _confirmPendente              = acao;
    _modalConfirm().classList.add('aberto');
    _confirmObs().focus();
}

function _fecharConfirm() {
    _modalConfirm().classList.remove('aberto');
    _confirmPendente = null;
}

document.getElementById('btnFecharModalConfirm').addEventListener('click', _fecharConfirm);
document.getElementById('btnCancelarConfirm').addEventListener('click', _fecharConfirm);
_modalConfirm().addEventListener('click', e => { if (e.target === _modalConfirm()) _fecharConfirm(); });

document.getElementById('btnConfirmarAcao').addEventListener('click', async () => {
    if (!_confirmPendente) return;
    const obs = _confirmObs().value.trim() || null;
    const btn = _btnConfirmar();
    btn.disabled = true;
    try {
        await _confirmPendente(obs);
    } finally {
        btn.disabled = false;
        _fecharConfirm();
    }
});

/* ─── Devolver / Perdido ─────────────────────────────────────────── */
function devolverEmprestimo(id, nome) {
    _abrirConfirm({
        icone: '📗',
        titulo: 'Confirmar Devolução',
        desc: `O livro de <strong>${nome}</strong> será marcado como devolvido.`,
        tipo: 'devolvido',
        acao: async (obs) => {
            await apiFetch(`/livros-emprestimos/${id}/devolver`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ obs }),
            });
            toast(`${nome} — livro devolvido!`);
            await recarregarEmprestimos();
        },
    });
}

function marcarPerdido(id, nome) {
    _abrirConfirm({
        icone: '📕',
        titulo: 'Marcar como Perdido',
        desc: `O livro de <strong>${nome}</strong> será marcado como <strong>perdido</strong>. Esta ação não pode ser desfeita.`,
        tipo: 'perdido',
        acao: async (obs) => {
            await apiFetch(`/livros-emprestimos/${id}/perdido`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ obs }),
            });
            toast(`${nome} — livro marcado como perdido.`, 'aviso');
            await recarregarEmprestimos();
        },
    });
}

async function recarregarEmprestimos() {
    emprestimos = await apiFetch('/livros-emprestimos');
    atualizarStats();
    filtrarEmprestimos();
}

/* ─── Modal: Novo Empréstimo ─────────────────────────────────────── */
document.getElementById('btnNovoEmprestimo').addEventListener('click', abrirModalEmprestimo);

function abrirModalEmprestimo() {
    document.getElementById('formEmpMsg').className     = 'form-msg-livros';
    document.getElementById('formEmpMsg').textContent   = '';
    document.getElementById('modalEmpAluno').innerHTML  = '<option value="">— Selecione a turma primeiro —</option>';
    document.getElementById('modalEmpTurma').value      = '';
    document.getElementById('modalEmpLivro').value      = '';
    document.getElementById('modalEmpObs').value        = '';
    document.getElementById('modalEmprestimo').classList.add('aberto');
}

document.getElementById('btnFecharModalEmp').addEventListener('click', fecharModalEmprestimo);
document.getElementById('modalEmprestimo').addEventListener('click', e => {
    if (e.target === document.getElementById('modalEmprestimo')) fecharModalEmprestimo();
});
function fecharModalEmprestimo() {
    document.getElementById('modalEmprestimo').classList.remove('aberto');
}

/* Filtrar alunos por turma no modal */
document.getElementById('modalEmpTurma').addEventListener('change', function () {
    const turma = this.value;
    const sel   = document.getElementById('modalEmpAluno');
    const label = document.getElementById('modalEmpAlunoLabel');
    sel.innerHTML = '<option value="">— Selecione o aluno —</option>';
    label.textContent = '';

    if (!turma) return;

    const lista = todoAlunos.filter(a => a.descrTurma === turma);
    lista.sort((a, b) => (a.numChamada || 0) - (b.numChamada || 0));

    // Opção para toda a turma de uma vez
    if (lista.length > 0) {
        const optTodos = document.createElement('option');
        optTodos.value = '__TODOS__';
        optTodos.text  = `📋 Todos os alunos da turma (${lista.length})`;
        sel.appendChild(optTodos);

        // Separador visual
        const grp = document.createElement('optgroup');
        grp.label = '── Aluno individual ──';
        lista.forEach(a => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ cod: a.codMatrizAluno, nome: a.nome, numChamada: a.numChamada });
            opt.text  = `${a.numChamada ? a.numChamada + '. ' : ''}${a.nome}`;
            grp.appendChild(opt);
        });
        sel.appendChild(grp);
    }
});

/* Atualiza label ao mudar aluno */
document.getElementById('modalEmpAluno').addEventListener('change', function () {
    const label = document.getElementById('modalEmpAlunoLabel');
    if (this.value === '__TODOS__') {
        label.textContent = '— lote';
        label.style.color = '#1d4ed8';
        label.style.fontWeight = '700';
    } else {
        label.textContent = '';
    }
});

document.getElementById('formEmprestimo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const alunoJson = document.getElementById('modalEmpAluno').value;
    const livroId   = document.getElementById('modalEmpLivro').value;
    const turma     = document.getElementById('modalEmpTurma').value;
    const obs       = document.getElementById('modalEmpObs').value;
    const msg       = document.getElementById('formEmpMsg');
    const btn       = document.getElementById('btnSalvarEmp');

    if (!alunoJson || !livroId) {
        msg.textContent = 'Selecione o aluno e o livro.';
        msg.className   = 'form-msg-livros erro';
        return;
    }

    btn.disabled = true;

    /* ── Modo lote: todos os alunos da turma ── */
    if (alunoJson === '__TODOS__') {
        const alunos = todoAlunos
            .filter(a => a.descrTurma === turma)
            .sort((a, b) => (a.numChamada || 0) - (b.numChamada || 0));

        let ok = 0, jaEmprestado = 0, semEstoque = 0, outrosErros = 0;

        for (let i = 0; i < alunos.length; i++) {
            const a = alunos[i];
            msg.textContent = `Registrando ${i + 1} / ${alunos.length} — ${a.nome}…`;
            msg.className   = 'form-msg-livros ok';
            try {
                await apiFetch('/livros-emprestimos', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        livro_id:         parseInt(livroId),
                        cod_matriz_aluno: a.codMatrizAluno,
                        nome_aluno:       a.nome,
                        turma,
                        num_chamada:      a.numChamada || null,
                        ano_letivo:       new Date().getFullYear(),
                        obs:              obs || null,
                    }),
                });
                ok++;
            } catch (e) {
                if (e.message.includes('já possui'))       jaEmprestado++;
                else if (e.message.includes('cópias'))     semEstoque++;
                else                                       outrosErros++;
            }
        }

        btn.disabled    = false;
        btn.textContent = 'Registrar';

        const partes = [];
        if (ok > 0)           partes.push(`✅ ${ok} registrado(s)`);
        if (jaEmprestado > 0) partes.push(`⚠️ ${jaEmprestado} já tinham este livro`);
        if (semEstoque > 0)   partes.push(`❌ ${semEstoque} sem estoque`);
        if (outrosErros > 0)  partes.push(`❌ ${outrosErros} erro(s)`);

        const resumo = partes.join(' · ');
        if (ok > 0) {
            toast(resumo);
            fecharModalEmprestimo();
            livros = await apiFetch('/livros');
            await recarregarEmprestimos();
            renderAcervo();
        } else {
            msg.textContent = resumo || 'Nenhum empréstimo registrado.';
            msg.className   = 'form-msg-livros erro';
        }
        return;
    }

    /* ── Modo individual (comportamento original) ── */
    btn.textContent = 'Salvando…';
    const { cod, nome, numChamada } = JSON.parse(alunoJson);
    try {
        await apiFetch('/livros-emprestimos', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                livro_id:         parseInt(livroId),
                cod_matriz_aluno: cod,
                nome_aluno:       nome,
                turma,
                num_chamada:      numChamada || null,
                ano_letivo:       new Date().getFullYear(),
                obs:              obs || null,
            }),
        });
        toast(`Empréstimo registrado para ${nome}!`);
        fecharModalEmprestimo();
        livros      = await apiFetch('/livros');
        await recarregarEmprestimos();
        renderAcervo();
    } catch (e) {
        msg.textContent = e.message;
        msg.className   = 'form-msg-livros erro';
    } finally {
        btn.disabled = false; btn.textContent = 'Registrar';
    }
});

/* ─── Tab: ACERVO ────────────────────────────────────────────────── */
function filtrarAcervo() {
    const busca = (document.getElementById('buscaLivro')?.value || '').toLowerCase();
    const lista = busca ? livros.filter(l =>
        l.titulo.toLowerCase().includes(busca) ||
        (l.disciplina || '').toLowerCase().includes(busca) ||
        (l.autor || '').toLowerCase().includes(busca)
    ) : livros;
    renderAcervo(lista);
}

function renderAcervo(lista) {
    if (!lista) lista = livros;
    const wrap = document.getElementById('tabelaLivros');
    if (!lista.length) {
        wrap.innerHTML = `<div class="empty-livros"><div class="ei">📖</div><p>Nenhum livro cadastrado</p></div>`;
        return;
    }
    wrap.innerHTML = `
    <div class="livros-table-wrap">
    <table class="livros-table">
        <thead><tr>
            <th>Título</th><th>Disciplina</th><th>Série</th><th>Editora</th>
            <th>Qtde</th><th>Disponível</th><th></th>
        </tr></thead>
        <tbody>
            ${lista.map(l => {
                const emp   = parseInt(l.emprestados || 0);
                const disp  = l.quantidade - emp;
                const cls   = disp === 0 ? 'badge-disp--zero' : disp < l.quantidade ? 'badge-disp--parcial' : 'badge-disp--ok';
                const label = disp === 0 ? 'Esgotado' : disp === l.quantidade ? 'Disponível' : `${disp}/${l.quantidade}`;
                return `
                <tr>
                    <td class="td-titulo">${esc(l.titulo)}${l.autor ? `<br><span style="font-weight:400;font-size:11px;color:var(--text-muted)">${esc(l.autor)}</span>` : ''}</td>
                    <td>${esc(l.disciplina || '—')}</td>
                    <td>${esc(l.serie || '—')}</td>
                    <td>${esc(l.editora || '—')}</td>
                    <td style="text-align:center">${l.quantidade}</td>
                    <td><span class="badge-disp ${cls}">${label}</span></td>
                    <td style="white-space:nowrap">
                        <button class="btn-acao-livro" onclick="abrirModalEditarLivro(${l.id})">Editar</button>
                        <button class="btn-acao-livro btn-acao-livro--danger" onclick="excluirLivro(${l.id}, '${esc(l.titulo)}')">Remover</button>
                    </td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>
    </div>`;
}

/* ─── Busca externa Open Library ────────────────────────────────── */
const OL_BASE = 'https://openlibrary.org';

document.getElementById('btnBuscarLivro').addEventListener('click', buscarLivroExterno);
document.getElementById('livroSearchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); buscarLivroExterno(); }
});

async function buscarLivroExterno() {
    const query = document.getElementById('livroSearchInput').value.trim();
    if (!query) return;
    const btn = document.getElementById('btnBuscarLivro');
    btn.disabled    = true;
    btn.textContent = 'Buscando…';
    try {
        // ISBN: somente dígitos (10 ou 13)
        const isbn = query.replace(/[\s\-]/g, '');
        if (/^\d{10}$|^\d{13}$/.test(isbn)) {
            await _buscarPorIsbn(isbn);
        } else {
            await _buscarPorTitulo(query);
        }
    } finally {
        btn.disabled    = false;
        btn.textContent = '🔍 Buscar';
    }
}

async function _buscarPorIsbn(isbn) {
    const div = document.getElementById('livroSearchResultados');
    div.innerHTML = '<div class="livro-busca-status">Consultando Open Library…</div>';
    try {
        const r    = await fetch(`${OL_BASE}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
        const data = await r.json();
        const key  = `ISBN:${isbn}`;
        if (!data[key]) {
            div.innerHTML = '<div class="livro-busca-status">Nenhum resultado para este ISBN.</div>';
            return;
        }
        const b = data[key];
        _renderResultados([{
            titulo:  b.title || '',
            autores: (b.authors || []).map(a => a.name).join(', '),
            editora: (b.publishers || [{}])[0]?.name || '',
            ano:     b.publish_date ? parseInt(b.publish_date) || null : null,
            isbn,
        }]);
    } catch {
        div.innerHTML = '<div class="livro-busca-status erro">Falha ao consultar Open Library. Verifique a conexão.</div>';
    }
}

async function _buscarPorTitulo(titulo) {
    const div = document.getElementById('livroSearchResultados');
    div.innerHTML = '<div class="livro-busca-status">Consultando Open Library…</div>';
    try {
        const url  = `${OL_BASE}/search.json?q=${encodeURIComponent(titulo)}&limit=10&fields=title,author_name,publisher,first_publish_year,isbn,language`;
        const r    = await fetch(url);
        const data = await r.json();
        if (!data.docs?.length) {
            div.innerHTML = '<div class="livro-busca-status">Nenhum resultado encontrado. Tente com ISBN ou outro termo.</div>';
            return;
        }
        _renderResultados(data.docs.map(d => ({
            titulo:  d.title || '',
            autores: (d.author_name || []).join(', '),
            editora: (d.publisher  || [])[0] || '',
            ano:     d.first_publish_year || null,
            isbn:    (d.isbn || [])[0] || '',
        })));
    } catch {
        div.innerHTML = '<div class="livro-busca-status erro">Falha ao consultar Open Library. Verifique a conexão.</div>';
    }
}

function _renderResultados(lista) {
    const div = document.getElementById('livroSearchResultados');
    div.innerHTML = lista.map((l, i) => `
        <div class="livro-busca-item" data-idx="${i}">
            <div class="livro-busca-item-titulo">${esc(l.titulo)}</div>
            <div class="livro-busca-item-meta">
                ${l.autores ? esc(l.autores) : ''}${l.editora ? ' · ' + esc(l.editora) : ''}${l.ano ? ' · ' + l.ano : ''}
            </div>
        </div>`).join('');

    div.querySelectorAll('.livro-busca-item').forEach(el => {
        el.addEventListener('click', () => {
            _preencherFormLivro(lista[parseInt(el.dataset.idx)]);
        });
    });
}

function _preencherFormLivro({ titulo, autores, editora, ano, isbn }) {
    if (titulo)  document.getElementById('modalLivroTituloInput').value = titulo;
    if (autores) document.getElementById('modalLivroAutor').value       = autores;
    if (editora) document.getElementById('modalLivroEditora').value     = editora;
    if (ano)     document.getElementById('modalLivroAno').value         = ano;
    if (isbn)    document.getElementById('modalLivroIsbn').value        = isbn;
    document.getElementById('livroSearchResultados').innerHTML = '';
    document.getElementById('livroSearchInput').value          = '';
    // Foca no campo título para o usuário continuar
    document.getElementById('modalLivroTituloInput').focus();
}

/* ─── Modal: Novo/Editar Livro ───────────────────────────────────── */
document.getElementById('btnNovoLivro').addEventListener('click', () => abrirModalLivro());

function abrirModalLivro(livro) {
    const m = document.getElementById('modalLivro');
    // Limpa busca externa ao abrir
    document.getElementById('livroSearchInput').value          = '';
    document.getElementById('livroSearchResultados').innerHTML = '';
    document.getElementById('modalLivroTitulo').textContent = livro ? 'Editar livro' : 'Cadastrar livro';
    document.getElementById('modalLivroId').value           = livro?.id || '';
    document.getElementById('modalLivroTituloInput').value  = livro?.titulo || '';
    document.getElementById('modalLivroAutor').value        = livro?.autor || '';
    document.getElementById('modalLivroEditora').value      = livro?.editora || '';
    document.getElementById('modalLivroAno').value          = livro?.ano_publicacao || '';
    document.getElementById('modalLivroDisciplina').value   = livro?.disciplina || '';
    const selSerie = document.getElementById('modalLivroSerie');
    selSerie.value = livro?.serie || '';
    // Se o valor salvo não existir nas opções, insere como opção avulsa
    if (livro?.serie && selSerie.value !== livro.serie) {
        const opt = document.createElement('option');
        opt.value = livro.serie;
        opt.textContent = livro.serie;
        selSerie.insertBefore(opt, selSerie.children[1]);
        selSerie.value = livro.serie;
    }
    document.getElementById('modalLivroIsbn').value         = livro?.isbn || '';
    document.getElementById('modalLivroQtde').value         = livro?.quantidade || 1;
    document.getElementById('formLivroMsg').className       = 'form-msg-livros';
    document.getElementById('formLivroMsg').textContent     = '';
    m.classList.add('aberto');
}

window.abrirModalEditarLivro = async function (id) {
    const livro = livros.find(l => l.id === id);
    if (livro) abrirModalLivro(livro);
};

document.getElementById('btnFecharModalLivro').addEventListener('click', () => {
    document.getElementById('modalLivro').classList.remove('aberto');
});
document.getElementById('modalLivro').addEventListener('click', e => {
    if (e.target === document.getElementById('modalLivro'))
        document.getElementById('modalLivro').classList.remove('aberto');
});

document.getElementById('formLivro').addEventListener('submit', async ev => {
    ev.preventDefault();
    const id   = document.getElementById('modalLivroId').value;
    const msg  = document.getElementById('formLivroMsg');
    const btn  = document.getElementById('btnSalvarLivro');
    const body = {
        titulo:         document.getElementById('modalLivroTituloInput').value.trim(),
        autor:          document.getElementById('modalLivroAutor').value.trim() || null,
        editora:        document.getElementById('modalLivroEditora').value.trim() || null,
        ano_publicacao: parseInt(document.getElementById('modalLivroAno').value)    || null,
        disciplina:     document.getElementById('modalLivroDisciplina').value.trim() || null,
        serie:          document.getElementById('modalLivroSerie').value.trim() || null,
        isbn:           document.getElementById('modalLivroIsbn').value.trim() || null,
        quantidade:     parseInt(document.getElementById('modalLivroQtde').value) || 1,
    };
    if (!body.titulo) {
        msg.textContent = 'Título é obrigatório.';
        msg.className   = 'form-msg-livros erro';
        return;
    }
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
        if (id) {
            await apiFetch(`/livros/${id}`, { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
        } else {
            await apiFetch('/livros', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
        }
        toast(id ? 'Livro atualizado.' : 'Livro cadastrado!');
        document.getElementById('modalLivro').classList.remove('aberto');
        livros = await apiFetch('/livros');
        popularSelectLivros();
        atualizarStats();
        renderAcervo();
    } catch (e) {
        msg.textContent = e.message;
        msg.className   = 'form-msg-livros erro';
    } finally {
        btn.disabled = false; btn.textContent = 'Salvar';
    }
});

window.excluirLivro = async function (id, titulo) {
    if (!confirm(`Remover "${titulo}" do acervo? Empréstimos existentes não serão apagados.`)) return;
    try {
        await apiFetch(`/livros/${id}`, { method: 'DELETE' });
        toast('Livro removido.');
        livros = await apiFetch('/livros');
        popularSelectLivros();
        atualizarStats();
        renderAcervo();
    } catch (e) { toast('Erro: ' + e.message, 'erro'); }
};

/* ─── Tab: IMPRIMIR ─────────────────────────────────────────────── */

/* Etiquetas de livro (coladas na capa) — 3 colunas, estilo crachás */
function imprimirEtiquetas() {
    const turmaFiltro = document.getElementById('printFiltroTurma')?.value || '';
    const livroFiltro = document.getElementById('printFiltroLivro')?.value || '';

    let lista = emprestimos.filter(e => e.status === 'emprestado');
    if (turmaFiltro) lista = lista.filter(e => e.turma === turmaFiltro);
    if (livroFiltro) lista = lista.filter(e => String(e.livro_id) === livroFiltro);

    if (!lista.length) { toast('Nenhum empréstimo encontrado para os filtros selecionados.', 'aviso'); return; }

    const turmas     = [...new Set(lista.map(e => e.turma || ''))];
    const coresMap   = {};
    turmas.forEach((t, i) => {
        const paleta = ['#1d4ed8','#059669','#d97706','#9333ea','#dc2626','#0891b2','#65a30d'];
        coresMap[t] = paleta[i % paleta.length];
    });

    const etiquetas = lista.map((e, idx) => {
        const cor        = coresMap[e.turma || ''] || '#1d4ed8';
        const nomePartes = (e.nome_aluno || '').split(' ');
        const nomeAbrev  = nomePartes.length > 2 ? `${nomePartes[0]} ${nomePartes[nomePartes.length-1]}` : e.nome_aluno;
        const serie      = extrairSerie(e.turma || '');
        const periodo    = (e.turma || '').match(/Manhã|Tarde|Noite/i)?.[0] || '';
        const qrUrl      = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(e.cod_matriz_aluno)}&size=60x60&margin=2`;

        return `
        <div class="badge-card">
            <div class="badge-topo" style="background:${cor}">
                <div class="badge-topo-serie">${esc(serie)}</div>
                <div class="badge-topo-periodo">${esc(periodo || e.ano_letivo)}</div>
            </div>
            <div class="badge-livro-nome">${esc(e.livro_titulo)}</div>
            <div class="badge-main">
                <div class="badge-foto-3x4">
                    <div class="foto-placeholder">
                        <div class="foto-icone">👤</div>
                        <div class="foto-label">3×4</div>
                    </div>
                </div>
                <div class="badge-dados">
                    <div class="badge-nome">${esc(e.nome_aluno)}</div>
                    <div class="badge-serie-txt">${esc(serie)}</div>
                    <div class="badge-turma-txt">${esc(e.turma || '')}</div>
                    ${periodo ? `<div class="badge-periodo-txt" style="color:${cor}">${esc(periodo)}</div>` : ''}
                    <div class="badge-chamada-row" style="border-color:${cor}20">
                        <span class="badge-chamada-lbl">Nº Chamada</span>
                        <span class="badge-chamada-num" style="color:${cor}">${e.num_chamada || '—'}</span>
                    </div>
                </div>
            </div>
            <div class="badge-rodape" style="border-top:2px solid ${cor}40">
                <img class="badge-qr" src="${qrUrl}" alt="QR" width="44" height="44">
                <div class="badge-qr-info">
                    <div class="badge-qr-nome" style="font-size:7px">${esc(e.livro_disciplina || '')}${e.livro_serie ? ' · '+esc(e.livro_serie) : ''}</div>
                    <div class="badge-qr-nome">${esc(nomeAbrev)}</div>
                    <div class="badge-qr-cod">ID: ${e.cod_matriz_aluno}</div>
                </div>
            </div>
            <div class="badge-barcode-wrap">
                <svg id="bc-${idx}" class="badge-barcode"></svg>
            </div>
        </div>`;
    }).join('');

    const barcodeData = lista.map((e, idx) => ({ id: `bc-${idx}`, value: String(e.cod_matriz_aluno) }));

    const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8">
<title>Etiquetas de Livros — EduSync</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4 portrait;margin:8mm}
body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.badges-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm;padding:2mm}
.badge-card{border:1.5px solid #d1d5db;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;break-inside:avoid;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.10)}
.badge-topo{padding:5px 8px;display:flex;justify-content:space-between;align-items:center;min-height:16px}
.badge-topo-serie{font-size:11px;color:white;font-weight:800;letter-spacing:.3px}
.badge-topo-periodo{font-size:10px;color:rgba(255,255,255,.85);font-weight:600}
.badge-livro-nome{font-size:10px;font-weight:800;color:#222;padding:3px 7px 2px;background:#f0f4ff;border-bottom:1px solid #e0e7ff;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge-main{display:flex;gap:6px;padding:6px 7px 5px;align-items:flex-start}
.badge-foto-3x4{flex-shrink:0;width:22mm;height:29mm;border:1.5px dashed #aaa;border-radius:4px;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.foto-placeholder{display:flex;flex-direction:column;align-items:center;gap:2px}
.foto-icone{font-size:20px;line-height:1;opacity:.35}
.foto-label{font-size:8px;color:#aaa;font-weight:700;letter-spacing:.5px}
.badge-dados{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}
.badge-nome{font-size:18px;font-weight:800;color:#111;line-height:1.2;white-space:nowrap;overflow:hidden;display:block}
.badge-serie-txt{font-size:10px;color:#444;font-weight:700;margin-top:1px}
.badge-turma-txt{font-size:9px;color:#777;line-height:1.3}
.badge-periodo-txt{font-size:9px;font-weight:700;margin-top:1px}
.badge-chamada-row{display:flex;flex-direction:column;align-items:flex-start;margin-top:4px;border-top:1px solid #e5e7eb;padding-top:3px}
.badge-chamada-lbl{font-size:8px;color:#9ca3af;text-transform:uppercase;letter-spacing:.4px}
.badge-chamada-num{font-size:18px;font-weight:900;line-height:1.1}
.badge-rodape{display:flex;align-items:center;gap:7px;padding:5px 7px 6px;background:#f9fafb}
.badge-qr{flex-shrink:0;width:44px;height:44px;border:1px solid #e5e7eb;border-radius:4px;background:white}
.badge-qr-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.badge-qr-nome{font-size:9px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge-qr-cod{font-size:8px;color:#6b7280;font-weight:600}
.badge-barcode-wrap{padding:4px 6px 5px;background:#fff;border-top:1px solid #e5e7eb;display:flex;justify-content:center}
.badge-barcode{width:100%;height:32px;display:block}
</style></head><body>
<div class="badges-grid">${etiquetas}</div>
<script>
window.onload = function() {
    const data = ${JSON.stringify(barcodeData)};
    data.forEach(d => {
        const el = document.getElementById(d.id);
        if (el) JsBarcode(el, d.value, {format:'CODE128',displayValue:false,height:24,margin:2});
    });
    // Auto-ajuste: reduz fonte do nome até caber em uma linha
    document.querySelectorAll('.badge-nome').forEach(el => {
        let size = 18;
        el.style.fontSize = size + 'px';
        while (el.scrollWidth > el.offsetWidth && size > 8) {
            size -= 0.5;
            el.style.fontSize = size + 'px';
        }
    });
    setTimeout(() => window.print(), 600);
};
<\/script></body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
}

function extrairSerie(descrTurma) {
    const m = descrTurma.match(/(\d+[ªa°]?\s*[Ss][ée]rie)/i);
    return m ? m[1] : descrTurma.split(' - ')[0] || '';
}

/* Lista de responsabilidade — uma por turma ou por livro */
function imprimirListaResponsabilidade() {
    const turmaFiltro = document.getElementById('printFiltroTurmaLista')?.value || '';
    const livroFiltro = document.getElementById('printFiltroLivroLista')?.value || '';
    const dataInputVal = document.getElementById('printDataEntregaLista')?.value || '';

    let lista = emprestimos.filter(e => e.status === 'emprestado');
    if (turmaFiltro) lista = lista.filter(e => e.turma === turmaFiltro);
    if (livroFiltro) lista = lista.filter(e => String(e.livro_id) === livroFiltro);

    if (!lista.length) { toast('Nenhum empréstimo encontrado para os filtros selecionados.', 'aviso'); return; }

    // Data de entrega selecionada (ou hoje como fallback)
    const dataEntregaObj  = dataInputVal ? new Date(dataInputVal + 'T12:00:00') : new Date();
    const dataEntregaStr  = dataEntregaObj.toLocaleDateString('pt-BR');
    const dataEntregaLong = dataEntregaObj.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    // Agrupar por livro
    const grupos = {};
    for (const e of lista) {
        if (!grupos[e.livro_id]) {
            grupos[e.livro_id] = {
                titulo: e.livro_titulo,
                autor:  e.livro_autor || '',
                editora:e.livro_editora || '',
                disciplina: e.livro_disciplina || '',
                serie:  e.livro_serie || '',
                itens:  [],
            };
        }
        grupos[e.livro_id].itens.push(e);
    }

    const anoLetivo   = new Date().getFullYear();
    const dataFormato = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    const secoes = Object.values(grupos).map(g => {
        g.itens.sort((a, b) => (a.num_chamada || 999) - (b.num_chamada || 999));

        const linhas = g.itens.map(e => `
            <tr>
                <td class="col-num">${e.num_chamada || '—'}</td>
                <td class="col-nome">${e.nome_aluno}</td>
                <td class="col-turma">${e.turma || ''}</td>
                <td class="col-data">${dataEntregaStr}</td>
                <td class="col-ass">
                    <div class="ass-cell">
                        <span class="ass-num">${e.num_chamada || ''}</span>
                        <div class="ass-linha"></div>
                    </div>
                </td>
            </tr>`).join('');

        return `
        <div class="lista-secao">
            <div class="lista-header">
                <div class="lista-escola">EduSync — Lista de Responsabilidade de Livros Didáticos</div>
                <div class="lista-livro">
                    <span class="lista-livro-titulo">${g.titulo}</span>
                    ${g.autor    ? `<span class="lista-livro-detalhe">Autor: ${g.autor}</span>` : ''}
                    ${g.editora  ? `<span class="lista-livro-detalhe">Editora: ${g.editora}</span>` : ''}
                    ${g.disciplina ? `<span class="lista-livro-detalhe">Disciplina: ${g.disciplina}</span>` : ''}
                    ${g.serie    ? `<span class="lista-livro-detalhe">Série/Ano: ${g.serie}</span>` : ''}
                    <span class="lista-livro-detalhe">Ano Letivo: ${anoLetivo}</span>
                </div>
                <div class="lista-aviso">
                    <strong>TERMO DE RESPONSABILIDADE</strong><br>
                    Eu, abaixo assinado(a), declaro ter recebido em perfeitas condições o livro didático acima identificado,
                    cedido pelo Estado do Paraná para uso durante o ano letivo de <strong>${anoLetivo}</strong>.
                    Comprometo-me a zelar pela sua conservação e devolvê-lo ao término do ano letivo, ciente de que
                    danos ou extravio poderão resultar em ressarcimento ou substituição.
                </div>
            </div>
            <table class="lista-table">
                <thead>
                    <tr>
                        <th class="col-num">Nº</th>
                        <th class="col-nome">Nome do Aluno</th>
                        <th class="col-turma">Turma</th>
                        <th class="col-data">Data Entrega</th>
                        <th class="col-ass">Nº / Assinatura</th>
                    </tr>
                </thead>
                <tbody>${linhas}</tbody>
            </table>
            <div class="lista-rodape">
                <div class="lista-assinatura-campo">
                    <div class="lista-linha"></div>
                    <div class="lista-assinatura-label">Professor(a) Responsável</div>
                </div>
                <div class="lista-assinatura-campo">
                    <div class="lista-linha"></div>
                    <div class="lista-assinatura-label">Direção / Secretaria</div>
                </div>
                <div class="lista-data">${dataFormato}</div>
            </div>
        </div>`;
    }).join('<div class="page-break"></div>');

    const html = `<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8">
<title>Lista de Responsabilidade — EduSync</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4 portrait;margin:15mm}
body{font-family:'Times New Roman',Times,serif;background:#fff;color:#000}
.lista-secao{margin-bottom:16mm}
.page-break{break-before:page}
.lista-escola{font-size:11pt;font-weight:bold;text-align:center;margin-bottom:10px;letter-spacing:.5px}
.lista-livro{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;padding:8px 12px;border:1pt solid #333;border-radius:4px;background:#f9f9f9}
.lista-livro-titulo{font-size:12pt;font-weight:900;color:#1a1a6e}
.lista-livro-detalhe{font-size:9pt;color:#444;background:#e8e8e8;padding:2px 6px;border-radius:3px}
.lista-aviso{font-size:9pt;line-height:1.6;padding:10px 12px;border:1pt solid #bbb;border-radius:4px;margin-bottom:12px;background:#fffef0;text-align:justify}
.lista-table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:10pt;table-layout:fixed}
.lista-table th{padding:6px 8px;border:1pt solid #333;background:#e8e8f0;font-weight:700;text-align:left;font-size:9pt}
.lista-table td{padding:5px 8px;border:1pt solid #ccc;vertical-align:middle;height:36px}
.lista-table tr:nth-child(even) td{background:#fafafa}
.col-num{width:36px;text-align:center}
.col-nome{width:28%}
.col-turma{width:auto}
.col-data{width:88px;text-align:center;white-space:nowrap}
.col-ass{width:160px}
.ass-cell{display:flex;align-items:flex-end;gap:6px;padding-bottom:2px}
.ass-num{font-size:10pt;font-weight:800;min-width:22px;text-align:right;flex-shrink:0;line-height:1}
.ass-linha{flex:1;border-bottom:1pt solid #333;height:28px}
.lista-rodape{display:flex;align-items:flex-end;justify-content:space-between;margin-top:20px;gap:20px;flex-wrap:wrap}
.lista-assinatura-campo{flex:1;min-width:160px}
.lista-linha{border-bottom:1pt solid #333;margin-bottom:4px;height:24px}
.lista-assinatura-label{font-size:8pt;text-align:center;color:#555}
.lista-data{font-size:9pt;color:#444;white-space:nowrap;align-self:flex-end}
</style></head><body>
${secoes}
<script>setTimeout(() => window.print(), 400);<\/script>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
}

/* ─── Navegação por tabs ─────────────────────────────────────────── */
document.querySelectorAll('.livros-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        tabAtual = btn.dataset.tab;
        document.querySelectorAll('.livros-tab').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.livros-panel').forEach(p => p.style.display = 'none');
        document.getElementById(`panel-${tabAtual}`).style.display = 'block';
    });
});

/* ─── Expor funções para HTML ────────────────────────────────────── */
window.devolverEmprestimo     = devolverEmprestimo;
window.marcarPerdido          = marcarPerdido;
window.filtrarEmprestimos     = filtrarEmprestimos;
window.filtrarAcervo          = filtrarAcervo;
window.imprimirEtiquetas      = imprimirEtiquetas;
window.imprimirListaResponsabilidade = imprimirListaResponsabilidade;

/* ─── Start ─────────────────────────────────────────────────────── */
init();
