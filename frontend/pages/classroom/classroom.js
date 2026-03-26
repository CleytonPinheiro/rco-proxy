'use strict';

/* ── Estado global ── */
let cursoAtivo      = null;   // { id, nome, link }
let ativAtiva       = null;   // { id, titulo, pontos }
let grupoAtivo      = null;   // { id, nome, pontosMeta, cor, atividades }
let viewMode        = 'atividades'; // 'atividades' | 'grupos'
let alunos          = {};     // { [userId]: { nome, email, foto } }
let submissions     = [];     // entregas da atividade individual
let todasNotas      = [];     // cache filtrado da atividade individual
let atividadesCache = [];     // todas atividades do curso atual
let gruposCache     = [];     // todos grupos do curso atual
let corSelecionada  = '#4285F4';

/* ── Elementos ── */
const elConnectScreen  = document.getElementById('clConnectScreen');
const elConnectDesc    = document.getElementById('clConnectDesc');
const elWorkspace      = document.getElementById('clWorkspace');
const elBtnConectar    = document.getElementById('clBtnConectar');
const elSemCredenciais = document.getElementById('clSemCredenciais');
const elCursoLista     = document.getElementById('clCursoLista');
const elAtivLista      = document.getElementById('clAtivLista');
const elGrupoLista     = document.getElementById('clGrupoLista');
const elNotasLista     = document.getElementById('clNotasLista');
const elCursosCount    = document.getElementById('clCursosCount');
const elAtivCount      = document.getElementById('clAtivCount');
const elNotasCount     = document.getElementById('clNotasCount');
const elNotasStats     = document.getElementById('clNotasStats');
const elNotasFiltro    = document.getElementById('clNotasFiltro');
const elNotasActions   = document.getElementById('clNotasActions');
const elContaBadge     = document.getElementById('clContaBadge');
const elAtivLink       = document.getElementById('clAtivLink');
const elBtnExportar    = document.getElementById('clBtnExportar');
const elBusca          = document.getElementById('clBuscaAluno');
const elFiltroStatus   = document.getElementById('clFiltroStatus');
const elToast          = document.getElementById('clToast');
const elTabs           = document.getElementById('clTabs');
const elTabAtiv        = document.getElementById('clTabAtiv');
const elTabGrupos      = document.getElementById('clTabGrupos');
const elBtnNovoGrupo   = document.getElementById('clBtnNovoGrupo');
const elColAtivTitulo  = document.getElementById('clColAtivTitulo');
const elNotasTitulo    = document.getElementById('clNotasTitulo');

/* ── Toast ── */
let toastTimer;
function toast(msg, tipo = '') {
    clearTimeout(toastTimer);
    elToast.textContent = msg;
    elToast.className = `cl-toast cl-toast--visivel${tipo ? ' cl-toast--' + tipo : ''}`;
    toastTimer = setTimeout(() => elToast.classList.remove('cl-toast--visivel'), 3000);
}

/* ── API helper ── */
async function api(path, opts = {}) {
    const r = await fetch('/api/classroom' + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.erro || 'Erro na requisição');
    return data;
}

/* ── Utilitários ── */
function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const TIPO_LABELS = {
    ASSIGNMENT:               'Atividade',
    SHORT_ANSWER_QUESTION:    'Pergunta',
    MULTIPLE_CHOICE_QUESTION: 'Múltipla escolha',
    QUIZ:                     'Quiz',
    MATERIAL:                 'Material',
};
const GRUPO_CORES = ['#4285F4','#EA4335','#34A853','#FBBC05','#8B5CF6','#EC4899','#14B8A6','#F97316','#0ea5e9','#a3e635'];

/* ══════════════════════════════════════════════════════════════
   INICIALIZAÇÃO
══════════════════════════════════════════════════════════════ */
async function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('sucesso')) toast('Conectado com sucesso ao Google Classroom!', 'ok');
    if (params.has('erro')) {
        const erros = {
            acesso_negado:   'Acesso negado pelo Google.',
            sem_credenciais: 'Credenciais não configuradas.',
            falha_auth:      'Falha na autenticação Google.',
        };
        toast(erros[params.get('erro')] || 'Erro desconhecido.', 'erro');
    }
    if (params.has('sucesso') || params.has('erro')) {
        history.replaceState({}, '', window.location.pathname);
    }

    const status = await api('/status');
    if (!status.hasCredentials) {
        elSemCredenciais.style.display = 'block';
        elBtnConectar.style.display    = 'none';
        elConnectDesc.textContent      = 'Configure as credenciais do Google para ativar a integração.';
        return;
    }
    if (!status.connected) {
        elConnectScreen.style.display = 'flex';
        elWorkspace.style.display     = 'none';
        return;
    }
    elConnectScreen.style.display = 'none';
    elWorkspace.style.display     = 'grid';
    if (status.email) elContaBadge.textContent = '🔗 ' + status.email;
    carregarCursos();
}

/* ── Conectar ── */
elBtnConectar.addEventListener('click', async () => {
    try {
        const { url } = await api('/auth-url');
        try { window.top.location.href = url; }
        catch (_) { window.open(url, '_blank', 'noopener'); }
    } catch (e) {
        toast(e.message, 'erro');
    }
});

/* ── Desconectar ── */
document.getElementById('clBtnDesconectar').addEventListener('click', async () => {
    if (!confirm('Desconectar a conta Google? Você precisará autorizar novamente para usar o Classroom.')) return;
    await api('/disconnect', { method: 'POST' });
    location.reload();
});

/* ── Refresh ── */
document.getElementById('clBtnRefresh').addEventListener('click', () => {
    cursoAtivo   = null;
    ativAtiva    = null;
    grupoAtivo   = null;
    alunos       = {};
    atividadesCache = [];
    gruposCache     = [];
    viewMode     = 'atividades';
    carregarCursos();
    resetColuna2();
    resetColuna3();
});

function resetColuna2() {
    elAtivLista.innerHTML     = '<div class="cl-empty-state"><p>← Selecione uma disciplina</p></div>';
    elGrupoLista.innerHTML    = '<div class="cl-empty-state"><p>Nenhum grupo criado.<br>Clique em <strong>+</strong> para criar.</p></div>';
    elAtivCount.textContent   = 'Selecione uma disciplina';
    elColAtivTitulo.textContent = 'Atividades';
    elTabs.style.display      = 'none';
    elBtnNovoGrupo.style.display = 'none';
    elAtivLink.style.display  = 'none';
    setTab('atividades');
}

function resetColuna3() {
    elNotasLista.innerHTML        = '<div class="cl-empty-state"><p>← Selecione uma atividade para ver as entregas</p></div>';
    elNotasCount.textContent      = 'Selecione uma atividade';
    elNotasTitulo.textContent     = 'Notas & Entregas';
    elNotasStats.style.display    = 'none';
    elNotasFiltro.style.display   = 'none';
    elNotasActions.style.display  = 'none';
}

/* ══════════════════════════════════════════════════════════════
   CURSOS
══════════════════════════════════════════════════════════════ */
const CURSO_CORES = ['#4285F4','#EA4335','#34A853','#FBBC05','#8B5CF6','#EC4899','#14B8A6','#F97316'];

async function carregarCursos() {
    elCursoLista.innerHTML    = '<div class="cl-loading">Carregando disciplinas...</div>';
    elCursosCount.textContent = '—';
    try {
        const cursos = await api('/courses');
        if (!cursos.length) {
            elCursoLista.innerHTML    = '<div class="cl-empty-state"><p>Nenhum curso encontrado.</p></div>';
            elCursosCount.textContent = '0 disciplinas';
            return;
        }
        elCursosCount.textContent = `${cursos.length} disciplina${cursos.length !== 1 ? 's' : ''}`;
        elCursoLista.innerHTML = '';
        cursos.forEach((c, i) => {
            const cor  = CURSO_CORES[i % CURSO_CORES.length];
            const item = document.createElement('div');
            item.className  = 'cl-curso-item';
            item.dataset.id = c.id;
            item.innerHTML  = `
                <div class="cl-curso-cor" style="background:${cor}"></div>
                <div class="cl-curso-info">
                    <div class="cl-curso-nome" title="${esc(c.nome)}">${esc(c.nome)}</div>
                    <div class="cl-curso-secao">${esc(c.secao || 'Sem seção')}</div>
                </div>`;
            item.addEventListener('click', () => selecionarCurso(c, item, cor));
            elCursoLista.appendChild(item);
        });
    } catch (e) {
        elCursoLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    }
}

async function selecionarCurso(curso, itemEl, cor) {
    document.querySelectorAll('.cl-curso-item--ativo').forEach(el => el.classList.remove('cl-curso-item--ativo'));
    itemEl.classList.add('cl-curso-item--ativo');
    cursoAtivo      = curso;
    ativAtiva       = null;
    grupoAtivo      = null;
    atividadesCache = [];
    gruposCache     = [];

    elAtivLink.href          = curso.link || '#';
    elAtivLink.style.display = curso.link ? 'flex' : 'none';
    elTabs.style.display     = 'flex';
    elBtnNovoGrupo.style.display = 'none';

    resetColuna3();

    elAtivCount.textContent   = 'Carregando...';
    elAtivLista.innerHTML     = '<div class="cl-loading">Carregando atividades...</div>';
    elGrupoLista.innerHTML    = '<div class="cl-loading">Carregando grupos...</div>';

    if (viewMode === 'grupos') setTab('grupos');

    try {
        const [atividades, estudantes] = await Promise.all([
            api(`/courses/${curso.id}/coursework`),
            api(`/courses/${curso.id}/students`),
        ]);

        atividadesCache = atividades;
        alunos = {};
        estudantes.forEach(a => { alunos[a.userId] = a; });

        renderAtividades(atividades);
        await carregarGrupos();
    } catch (e) {
        const semPermissao = e.message?.toLowerCase().includes('permission') || e.status === 403;
        if (semPermissao) {
            elAtivLista.innerHTML = `
                <div style="padding:20px 16px;display:flex;flex-direction:column;gap:14px">
                    <div style="display:flex;align-items:center;gap:10px;color:#dc2626">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <strong style="font-size:.95rem">Acesso bloqueado pelo Workspace</strong>
                    </div>
                    <p style="color:#475569;font-size:.83rem;line-height:1.6;margin:0">
                        A conta <strong>escola.pr.gov.br</strong> é gerenciada pela SEED-PR, que bloqueia
                        apps externos de acessar dados pedagógicos do Classroom por padrão.
                    </p>
                    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:12px;font-size:.82rem;color:#713f12;line-height:1.6">
                        <strong>Como resolver:</strong><br>
                        <strong>Opção 1 —</strong> Use uma <strong>conta Gmail pessoal</strong> com as mesmas
                        turmas adicionadas como co-professor.<br><br>
                        <strong>Opção 2 —</strong> Solicite ao TI da escola que acesse
                        <em>Admin Console → Segurança → Controles de API</em>
                        e aprove o acesso do app à API do Classroom.
                    </div>
                    <button onclick="document.getElementById('clBtnDesconectar').click()"
                            style="align-self:flex-start;padding:7px 14px;border-radius:8px;border:1px solid #94a3b8;color:#475569;background:#f8fafc;cursor:pointer;font-size:.82rem">
                        Trocar conta
                    </button>
                </div>`;
            elAtivCount.textContent = 'Sem permissão';
        } else {
            elAtivLista.innerHTML   = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
            elAtivCount.textContent = 'Erro';
        }
        toast(semPermissao ? 'Acesso bloqueado pelo Workspace.' : e.message, 'erro');
    }
}

/* ══════════════════════════════════════════════════════════════
   ABAS
══════════════════════════════════════════════════════════════ */
function setTab(tab) {
    viewMode = tab;
    elTabAtiv.classList.toggle('cl-tab--ativo', tab === 'atividades');
    elTabGrupos.classList.toggle('cl-tab--ativo', tab === 'grupos');

    elAtivLista.style.display        = tab === 'atividades' ? '' : 'none';
    elGrupoLista.style.display       = tab === 'grupos' ? '' : 'none';
    elAtivLink.style.display         = tab === 'atividades' && cursoAtivo?.link ? 'flex' : 'none';
    elBtnNovoGrupo.style.display     = tab === 'grupos' && cursoAtivo ? 'flex' : 'none';
    elColAtivTitulo.textContent      = tab === 'grupos' ? 'Grupos' : 'Atividades';

    if (tab === 'atividades') {
        elAtivCount.textContent = atividadesCache.length
            ? `${atividadesCache.length} atividade${atividadesCache.length !== 1 ? 's' : ''}`
            : 'Selecione uma disciplina';
    } else {
        elAtivCount.textContent = gruposCache.length
            ? `${gruposCache.length} grupo${gruposCache.length !== 1 ? 's' : ''}`
            : 'Nenhum grupo criado';
    }

    if (tab === 'atividades' && grupoAtivo) {
        grupoAtivo = null;
        resetColuna3();
    }
}

elTabAtiv.addEventListener('click', () => setTab('atividades'));
elTabGrupos.addEventListener('click', () => setTab('grupos'));

/* ══════════════════════════════════════════════════════════════
   ATIVIDADES (lista individual)
══════════════════════════════════════════════════════════════ */
function renderAtividades(atividades) {
    if (!atividades.length) {
        elAtivLista.innerHTML   = '<div class="cl-empty-state"><p>Nenhuma atividade encontrada.</p></div>';
        elAtivCount.textContent = '0 atividades';
        return;
    }
    if (viewMode === 'atividades') {
        elAtivCount.textContent = `${atividades.length} atividade${atividades.length !== 1 ? 's' : ''}`;
    }
    elAtivLista.innerHTML = '';
    atividades.forEach(a => {
        const item     = document.createElement('div');
        item.className = 'cl-ativ-item';
        const tipoCls  = `cl-ativ-tipo--${a.tipo || 'ASSIGNMENT'}`;
        item.innerHTML = `
            <div class="cl-ativ-header">
                <span class="cl-ativ-titulo" title="${esc(a.titulo)}">${esc(a.titulo)}</span>
                ${a.pontos !== null ? `<span class="cl-ativ-pontos">${a.pontos} pts</span>` : ''}
            </div>
            <div class="cl-ativ-meta">
                <span class="cl-ativ-tipo-badge ${tipoCls}">${TIPO_LABELS[a.tipo] || a.tipo || 'Atividade'}</span>
                ${a.prazo ? `<span class="cl-ativ-meta-chip">📅 ${a.prazo}</span>` : ''}
            </div>`;
        item.addEventListener('click', () => selecionarAtividade(a, item));
        elAtivLista.appendChild(item);
    });
}

async function selecionarAtividade(ativ, itemEl) {
    document.querySelectorAll('.cl-ativ-item--ativo').forEach(el => el.classList.remove('cl-ativ-item--ativo'));
    itemEl.classList.add('cl-ativ-item--ativo');
    ativAtiva  = ativ;
    grupoAtivo = null;

    elNotasTitulo.textContent    = 'Notas & Entregas';
    elNotasCount.textContent     = 'Carregando...';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'none';
    elNotasLista.innerHTML       = '<div class="cl-loading">Carregando entregas...</div>';
    elBusca.value                = '';
    elFiltroStatus.value         = '';

    try {
        submissions = await api(`/courses/${cursoAtivo.id}/coursework/${ativ.id}/submissions`);
        todasNotas  = submissions.map(s => ({
            ...s,
            aluno: alunos[s.userId] || { nome: 'Aluno ' + s.userId, email: '', foto: null },
        })).sort((a, b) => (a.aluno.nome || '').localeCompare(b.aluno.nome || ''));

        elNotasCount.textContent     = `${todasNotas.length} aluno${todasNotas.length !== 1 ? 's' : ''}`;
        elNotasStats.style.display   = 'grid';
        elNotasFiltro.style.display  = 'flex';
        elNotasActions.style.display = 'flex';

        document.getElementById('clStEntreguesLabel').textContent = 'Entregues';
        document.getElementById('clStPendentesLabel').textContent = 'Pendentes';
        atualizarStats();
        renderNotas();
    } catch (e) {
        elNotasLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    }
}

/* ── Stats (atividade individual) ── */
function atualizarStats() {
    const total     = todasNotas.length;
    const entregues = todasNotas.filter(n => n.entregue || n.estado === 'RETURNED').length;
    const pendentes = todasNotas.filter(n => !n.entregue && n.estado !== 'RETURNED').length;
    const comNota   = todasNotas.filter(n => n.nota !== null);
    const media     = comNota.length ? (comNota.reduce((s, n) => s + n.nota, 0) / comNota.length).toFixed(1) : '—';

    document.getElementById('clStTotal').textContent     = total;
    document.getElementById('clStEntregues').textContent = entregues;
    document.getElementById('clStPendentes').textContent = pendentes;
    document.getElementById('clStMedia').textContent     = media;
}

/* ── Filtros ── */
elBusca.addEventListener('input', renderNotas);
elFiltroStatus.addEventListener('change', renderNotas);

function filtrarNotas() {
    const busca  = elBusca.value.toLowerCase().trim();
    const status = elFiltroStatus.value;
    return todasNotas.filter(n => {
        if (busca && !(n.aluno.nome || '').toLowerCase().includes(busca)) return false;
        if (status === 'entregue' && !n.entregue && n.estado !== 'RETURNED') return false;
        if (status === 'pendente' && (n.entregue || n.estado === 'RETURNED')) return false;
        if (status === 'atrasado' && !n.atrasado) return false;
        return true;
    });
}

function renderNotas() {
    const lista  = filtrarNotas();
    const maxPts = ativAtiva?.pontos ?? null;
    if (!lista.length) {
        elNotasLista.innerHTML = '<div class="cl-empty-state"><p>Nenhum aluno com os filtros selecionados.</p></div>';
        return;
    }
    elNotasLista.innerHTML = `
        <div class="cl-nota-row cl-nota-row--header">
            <span></span>
            <span>Aluno</span>
            <span style="text-align:center">Status</span>
            <span style="text-align:center">Nota${maxPts !== null ? ` /${maxPts}` : ''}</span>
            <span style="text-align:center">Ação</span>
        </div>
        ${lista.map(n => renderNotaRow(n)).join('')}`;

    elNotasLista.querySelectorAll('.cl-nota-input').forEach(input => {
        input.addEventListener('change', () => salvarNota(input));
    });
    elNotasLista.querySelectorAll('.cl-btn-devolver').forEach(btn => {
        btn.addEventListener('click', () => devolverEntrega(btn));
    });
}

function renderNotaRow(n) {
    const a        = n.aluno;
    const iniciais = (a.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = a.foto ? `<img src="${esc(a.foto)}" alt="" loading="lazy"/>` : iniciais;

    let statusLabel, statusCls;
    if (n.estado === 'RETURNED')  { statusLabel = 'Devolvido'; statusCls = 'devolvido'; }
    else if (n.atrasado)           { statusLabel = 'Atrasado';  statusCls = 'atrasado'; }
    else if (n.entregue)           { statusLabel = 'Entregue';  statusCls = 'entregue'; }
    else                           { statusLabel = 'Pendente';  statusCls = 'pendente'; }

    const inputVal     = n.nota !== null ? n.nota : '';
    const podeDevolver = n.entregue && n.estado !== 'RETURNED';

    return `<div class="cl-nota-row" data-user="${n.userId}" data-sub="${n.id}">
        <div class="cl-nota-avatar">${fotoHtml}</div>
        <div class="cl-nota-nome" title="${esc(a.email)}">${esc(a.nome || '—')}</div>
        <div style="text-align:center">
            <span class="cl-nota-status-badge cl-nota-status--${statusCls}">${statusLabel}</span>
        </div>
        <div>
            <input class="cl-nota-input" type="number" min="0" max="${ativAtiva?.pontos ?? 100}"
                step="0.5" value="${inputVal}" placeholder="—"
                data-sub="${n.id}" data-original="${inputVal}"/>
        </div>
        <div class="cl-nota-acao">
            ${podeDevolver
                ? `<button class="cl-btn-devolver" data-sub="${n.id}" data-user="${n.userId}">Devolver</button>`
                : '<span style="color:var(--text-muted);font-size:.7rem">—</span>'}
        </div>
    </div>`;
}

/* ── Salvar nota ── */
async function salvarNota(input) {
    const subId    = input.dataset.sub;
    const original = input.dataset.original;
    const nova     = input.value;
    if (nova === original) return;
    input.disabled = true;
    try {
        await api(`/courses/${cursoAtivo.id}/coursework/${ativAtiva.id}/submissions/${subId}/grade`, {
            method: 'PATCH', body: { nota: nova === '' ? null : Number(nova) },
        });
        input.classList.add('cl-nota-input--salva');
        input.dataset.original = nova;
        const sub = todasNotas.find(n => n.id === subId);
        if (sub) sub.nota = nova === '' ? null : Number(nova);
        atualizarStats();
        toast('Nota salva!', 'ok');
        setTimeout(() => input.classList.remove('cl-nota-input--salva'), 2000);
    } catch (e) {
        input.value = original;
        toast('Erro ao salvar nota: ' + e.message, 'erro');
    } finally {
        input.disabled = false;
    }
}

/* ── Devolver entrega ── */
async function devolverEntrega(btn) {
    const subId  = btn.dataset.sub;
    const userId = btn.dataset.user;
    const aluno  = alunos[userId];
    if (!confirm(`Devolver entrega de ${aluno?.nome || 'aluno'} para revisão?`)) return;
    btn.disabled    = true;
    btn.textContent = '...';
    try {
        await api(`/courses/${cursoAtivo.id}/coursework/${ativAtiva.id}/submissions/${subId}/return`, { method: 'POST' });
        const sub = todasNotas.find(n => n.id === subId);
        if (sub) sub.estado = 'RETURNED';
        toast('Entrega devolvida!', 'ok');
        atualizarStats();
        renderNotas();
    } catch (e) {
        toast('Erro: ' + e.message, 'erro');
        btn.disabled    = false;
        btn.textContent = 'Devolver';
    }
}

/* ── Exportar CSV (atividade individual) ── */
elBtnExportar.addEventListener('click', () => {
    if (grupoAtivo) { exportarGrupoCSV(); return; }
    const lista  = filtrarNotas();
    const titulo = ativAtiva?.titulo || 'atividade';
    const curso  = cursoAtivo?.nome  || 'disciplina';
    const maxPts = ativAtiva?.pontos ?? '';
    let csv = `Disciplina,Atividade,Pontuação máxima\n"${curso}","${titulo}","${maxPts}"\n\n`;
    csv    += 'Nº,Aluno,Email,Status,Nota\n';
    lista.forEach((n, i) => {
        const status = n.estado === 'RETURNED' ? 'Devolvido' : n.atrasado ? 'Atrasado' : n.entregue ? 'Entregue' : 'Pendente';
        csv += `${i+1},"${n.aluno.nome || ''}","${n.aluno.email || ''}","${status}","${n.nota ?? ''}"\n`;
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${curso} – ${titulo}.csv`.replace(/[\\/:*?"<>|]/g,'_');
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exportado!', 'ok');
});

/* ══════════════════════════════════════════════════════════════
   GRUPOS
══════════════════════════════════════════════════════════════ */
async function carregarGrupos() {
    if (!cursoAtivo) return;
    try {
        gruposCache = await api(`/groups?courseId=${cursoAtivo.id}`);
        renderGrupos();
        if (viewMode === 'grupos') {
            elAtivCount.textContent = `${gruposCache.length} grupo${gruposCache.length !== 1 ? 's' : ''}`;
        }
    } catch (e) {
        elGrupoLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
    }
}

function renderGrupos() {
    if (!gruposCache.length) {
        elGrupoLista.innerHTML = '<div class="cl-empty-state"><p>Nenhum grupo criado.<br>Clique em <strong>+</strong> para criar.</p></div>';
        return;
    }
    elGrupoLista.innerHTML = '';
    gruposCache.forEach(g => {
        const item      = document.createElement('div');
        item.className  = 'cl-grupo-item';
        item.dataset.id = g.id;
        const nAtiv     = g.atividades.length;
        item.innerHTML  = `
            <div class="cl-grupo-cor" style="background:${g.cor}"></div>
            <div class="cl-grupo-info">
                <div class="cl-grupo-nome">${esc(g.nome)}</div>
                <div class="cl-grupo-meta">
                    ${nAtiv} atividade${nAtiv !== 1 ? 's' : ''} &bull;
                    <span class="cl-grupo-pts">${g.pontosMeta} pts</span>
                </div>
            </div>
            <div class="cl-grupo-acoes">
                <button class="cl-grupo-btn-editar" data-id="${g.id}" title="Editar grupo">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="cl-grupo-btn-excluir" data-id="${g.id}" title="Excluir grupo">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
            </div>`;

        // Clicar no item (não nos botões)
        item.addEventListener('click', (e) => {
            if (e.target.closest('.cl-grupo-acoes')) return;
            selecionarGrupo(g, item);
        });
        item.querySelector('.cl-grupo-btn-editar').addEventListener('click', () => abrirModalGrupo(g));
        item.querySelector('.cl-grupo-btn-excluir').addEventListener('click', () => excluirGrupo(g));
        elGrupoLista.appendChild(item);
    });
}

async function selecionarGrupo(grupo, itemEl) {
    document.querySelectorAll('.cl-grupo-item--ativo').forEach(el => el.classList.remove('cl-grupo-item--ativo'));
    itemEl.classList.add('cl-grupo-item--ativo');
    grupoAtivo = grupo;
    ativAtiva  = null;

    elNotasTitulo.textContent    = `Soma — ${grupo.nome}`;
    elNotasCount.textContent     = 'Carregando...';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'flex';
    elNotasLista.innerHTML       = '<div class="cl-loading">Calculando somas...</div>';

    if (!grupo.atividades.length) {
        elNotasLista.innerHTML   = '<div class="cl-empty-state"><p>Este grupo não tem atividades.<br>Edite o grupo para adicionar.</p></div>';
        elNotasCount.textContent = '0 atividades';
        return;
    }

    try {
        const resumo = await api(`/groups/${grupo.id}/summary?courseId=${cursoAtivo.id}`);

        const alunosResumo = resumo.alunos.map(a => ({
            ...a,
            aluno: alunos[a.userId] || { nome: 'Aluno ' + a.userId, email: '', foto: null },
        })).sort((a, b) => (a.aluno.nome || '').localeCompare(b.aluno.nome || ''));

        const total   = alunosResumo.length;
        const comTudo = alunosResumo.filter(a => a.pendentes === 0).length;
        const pend    = alunosResumo.filter(a => a.pendentes > 0).length;
        const comNota = alunosResumo.filter(a => a.soma > 0);
        const media   = comNota.length ? (comNota.reduce((s, a) => s + a.soma, 0) / comNota.length).toFixed(1) : '—';

        document.getElementById('clStTotal').textContent              = total;
        document.getElementById('clStEntregues').textContent          = comTudo;
        document.getElementById('clStEntreguesLabel').textContent     = 'Completos';
        document.getElementById('clStPendentes').textContent          = pend;
        document.getElementById('clStPendentesLabel').textContent     = 'Com pendências';
        document.getElementById('clStMedia').textContent              = media;
        elNotasCount.textContent = `${total} aluno${total !== 1 ? 's' : ''}`;
        elNotasStats.style.display = 'grid';

        if (!alunosResumo.length) {
            elNotasLista.innerHTML = '<div class="cl-empty-state"><p>Nenhum aluno encontrado nas atividades do grupo.</p></div>';
            return;
        }

        const meta = grupo.pontosMeta;
        elNotasLista.innerHTML = `
            <div class="cl-resumo-header">
                <span></span>
                <span>Aluno</span>
                <span>Soma / ${meta} pts</span>
                <span style="text-align:center">Pendentes</span>
            </div>
            ${alunosResumo.map(a => renderResumoRow(a, meta)).join('')}`;

    } catch (e) {
        elNotasLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    }
}

function renderResumoRow(a, meta) {
    const al       = a.aluno;
    const iniciais = (al.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = al.foto ? `<img src="${esc(al.foto)}" alt="" loading="lazy"/>` : iniciais;
    const soma     = a.soma;
    const pct      = meta > 0 ? Math.min(100, (soma / meta) * 100).toFixed(1) : 0;
    const barCor   = pct >= 100 ? '#10b981' : pct >= 60 ? '#4285F4' : '#f59e0b';

    return `<div class="cl-resumo-row">
        <div class="cl-nota-avatar">${fotoHtml}</div>
        <div class="cl-resumo-info">
            <div class="cl-nota-nome" title="${esc(al.email)}">${esc(al.nome || '—')}</div>
            <div class="cl-resumo-barra">
                <div class="cl-resumo-fill" style="width:${pct}%;background:${barCor}"></div>
            </div>
        </div>
        <div class="cl-resumo-soma">
            <span class="cl-resumo-num" style="color:${barCor}">${soma.toFixed(1)}</span>
            <span class="cl-resumo-den">/${meta}</span>
        </div>
        <div style="text-align:center">
            ${a.pendentes > 0
                ? `<span class="cl-nota-status-badge cl-nota-status--pendente">${a.pendentes} pend.</span>`
                : `<span class="cl-nota-status-badge cl-nota-status--entregue">✓</span>`}
        </div>
    </div>`;
}

function exportarGrupoCSV() {
    const curso = cursoAtivo?.nome || 'disciplina';
    let csv = `Disciplina,Grupo,Meta de pontos\n"${curso}","${grupoAtivo?.nome || ''}","${grupoAtivo?.pontosMeta || ''}"\n\n`;
    csv    += 'Nº,Aluno,Email,Soma,Pendentes\n';
    elNotasLista.querySelectorAll('.cl-resumo-row').forEach((row, i) => {
        const nome  = row.querySelector('.cl-nota-nome')?.textContent.trim() || '';
        const soma  = row.querySelector('.cl-resumo-num')?.textContent.trim() || '';
        const pend  = row.querySelector('.cl-nota-status-badge')?.textContent.trim() || '0';
        csv += `${i+1},"${nome}","","${soma}","${pend}"\n`;
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${curso} – ${grupoAtivo?.nome || 'grupo'}.csv`.replace(/[\\/:*?"<>|]/g,'_');
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exportado!', 'ok');
}

/* ══════════════════════════════════════════════════════════════
   MODAL DE GRUPO
══════════════════════════════════════════════════════════════ */
const elModal          = document.getElementById('clGrupoModal');
const elModalTitulo    = document.getElementById('clGrupoModalTitulo');
const elGrupoId        = document.getElementById('clGrupoId');
const elGrupoNome      = document.getElementById('clGrupoNome');
const elGrupoPontos    = document.getElementById('clGrupoPontos');
const elCorPicker      = document.getElementById('clCorPicker');
const elModalAtivs     = document.getElementById('clModalAtividades');

function abrirModalGrupo(grupo = null) {
    // Preencher seletor de cor
    elCorPicker.innerHTML = '';
    GRUPO_CORES.forEach(cor => {
        const btn = document.createElement('button');
        btn.className = 'cl-cor-btn';
        btn.style.background = cor;
        btn.title    = cor;
        btn.type     = 'button';
        btn.addEventListener('click', () => {
            corSelecionada = cor;
            elCorPicker.querySelectorAll('.cl-cor-btn').forEach(b => b.classList.remove('cl-cor-btn--ativo'));
            btn.classList.add('cl-cor-btn--ativo');
        });
        elCorPicker.appendChild(btn);
    });

    if (grupo) {
        elModalTitulo.textContent = 'Editar Grupo';
        elGrupoId.value           = grupo.id;
        elGrupoNome.value         = grupo.nome;
        elGrupoPontos.value       = grupo.pontosMeta;
        corSelecionada            = grupo.cor;
    } else {
        elModalTitulo.textContent = 'Novo Grupo';
        elGrupoId.value           = '';
        elGrupoNome.value         = '';
        elGrupoPontos.value       = 40;
        corSelecionada            = GRUPO_CORES[gruposCache.length % GRUPO_CORES.length];
    }

    // Marcar cor ativa
    elCorPicker.querySelectorAll('.cl-cor-btn').forEach(b => {
        b.classList.toggle('cl-cor-btn--ativo', b.style.background === corSelecionada ||
            b.title === corSelecionada);
    });

    // Preencher lista de atividades
    const ativsNoGrupo = new Set((grupo?.atividades || []).map(a => a.atividade_id));
    if (!atividadesCache.length) {
        elModalAtivs.innerHTML = '<div class="cl-empty-state" style="padding:12px">Selecione uma disciplina primeiro.</div>';
    } else {
        elModalAtivs.innerHTML = atividadesCache.map(a => `
            <label class="cl-modal-ativ-item">
                <input type="checkbox" value="${esc(a.id)}"
                    data-titulo="${esc(a.titulo)}"
                    data-pontos="${a.pontos ?? ''}"
                    ${ativsNoGrupo.has(a.id) ? 'checked' : ''}/>
                <span class="cl-modal-ativ-nome">${esc(a.titulo)}</span>
                ${a.pontos !== null ? `<span class="cl-ativ-pontos">${a.pontos} pts</span>` : ''}
            </label>`).join('');
    }

    elModal.classList.add('cl-modal-overlay--visivel');
}

function fecharModal() {
    elModal.classList.remove('cl-modal-overlay--visivel');
}

elBtnNovoGrupo.addEventListener('click', () => abrirModalGrupo(null));
document.getElementById('clGrupoModalFechar').addEventListener('click', fecharModal);
document.getElementById('clGrupoModalCancelar').addEventListener('click', fecharModal);
elModal.addEventListener('click', e => { if (e.target === elModal) fecharModal(); });

document.getElementById('clGrupoModalSalvar').addEventListener('click', async () => {
    const nome      = elGrupoNome.value.trim();
    const pontos    = Number(elGrupoPontos.value) || 40;
    const id        = elGrupoId.value;

    if (!nome) { elGrupoNome.focus(); toast('Informe o nome do grupo.', 'erro'); return; }
    if (!cursoAtivo) { toast('Selecione uma disciplina primeiro.', 'erro'); return; }

    // Coleta atividades marcadas
    const atividades = [];
    elModalAtivs.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
        atividades.push({
            atividade_id:     cb.value,
            atividade_titulo: cb.dataset.titulo,
            pontos_max:       cb.dataset.pontos !== '' ? Number(cb.dataset.pontos) : null,
        });
    });

    const btn = document.getElementById('clGrupoModalSalvar');
    btn.disabled    = true;
    btn.textContent = 'Salvando...';

    try {
        let grupoId = id;
        if (id) {
            await api(`/groups/${id}`, { method: 'PUT', body: { nome, pontosMeta: pontos, cor: corSelecionada } });
        } else {
            const r = await api('/groups', { method: 'POST', body: { courseId: cursoAtivo.id, nome, pontosMeta: pontos, cor: corSelecionada } });
            grupoId = r.id;
        }
        await api(`/groups/${grupoId}/activities`, { method: 'PUT', body: { atividades } });
        fecharModal();
        toast('Grupo salvo!', 'ok');
        await carregarGrupos();
        if (viewMode === 'grupos') {
            elAtivCount.textContent = `${gruposCache.length} grupo${gruposCache.length !== 1 ? 's' : ''}`;
        }
        // Reatualiza grupo ativo se for o mesmo
        if (grupoAtivo && String(grupoAtivo.id) === String(grupoId)) {
            grupoAtivo = gruposCache.find(g => String(g.id) === String(grupoId)) || null;
        }
    } catch (e) {
        toast('Erro ao salvar: ' + e.message, 'erro');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Salvar grupo';
    }
});

async function excluirGrupo(grupo) {
    if (!confirm(`Excluir o grupo "${grupo.nome}"? As atividades do Classroom não serão afetadas.`)) return;
    try {
        await api(`/groups/${grupo.id}`, { method: 'DELETE' });
        if (grupoAtivo?.id === grupo.id) { grupoAtivo = null; resetColuna3(); }
        await carregarGrupos();
        elAtivCount.textContent = `${gruposCache.length} grupo${gruposCache.length !== 1 ? 's' : ''}`;
        toast('Grupo excluído.', 'ok');
    } catch (e) {
        toast('Erro ao excluir: ' + e.message, 'erro');
    }
}

/* ══════════════════════════════════════════════════════════════
   INICIA
══════════════════════════════════════════════════════════════ */
init();
