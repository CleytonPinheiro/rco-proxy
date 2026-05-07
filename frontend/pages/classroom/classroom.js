'use strict';

/* ── (Submenu Classroom agora é inline — theme.js controla visibilidade) ── */

/* ══════════════════════════════════════════════════════════════════
   Modal de confirmação — substitui confirm() nativo
   Uso: await confirmar('Mensagem', { titulo, confirmLabel, tipo, icone })
   Retorna: true (confirmou) | false (cancelou)
══════════════════════════════════════════════════════════════════ */
function confirmar(mensagem, { titulo = 'Confirmar ação', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', tipo = 'info', icone, html = false } = {}) {
    return new Promise(resolve => {
        const overlay  = document.getElementById('clConfirmModal');
        const elTitulo = document.getElementById('clConfirmTitulo');
        const elMsg    = document.getElementById('clConfirmMsg');
        const elIcone  = document.getElementById('clConfirmIcone');
        const elOk     = document.getElementById('clConfirmOk');
        const elCancel = document.getElementById('clConfirmCancelar');
        const elModal  = overlay.querySelector('.cl-confirm-modal');

        elTitulo.textContent = titulo;
        if (html) { elMsg.innerHTML = mensagem; } else { elMsg.textContent = mensagem; }
        elOk.textContent     = confirmLabel;
        elCancel.textContent = cancelLabel;

        const iconeDefault = tipo === 'danger' ? '⚠️' : '❓';
        elIcone.textContent = icone || iconeDefault;

        elModal.classList.toggle('cl-confirm--danger', tipo === 'danger');
        overlay.classList.add('cl-modal-overlay--visivel');
        elOk.focus();

        function fechar(resultado) {
            overlay.classList.remove('cl-modal-overlay--visivel');
            elOk.removeEventListener('click', onOk);
            elCancel.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(resultado);
        }
        function onOk()      { fechar(true); }
        function onCancel()  { fechar(false); }
        function onBackdrop(e) { if (e.target === overlay) fechar(false); }
        function onKey(e)    { if (e.key === 'Escape') fechar(false); if (e.key === 'Enter' && document.activeElement === elOk) { e.preventDefault(); fechar(true); } }

        elOk.addEventListener('click', onOk);
        elCancel.addEventListener('click', onCancel);
        overlay.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

/* ── BroadcastChannel (sync com janela popout) ── */
const CL_BC_NAME = 'cl-notas-sync';
let clBc;
try { clBc = new BroadcastChannel(CL_BC_NAME); } catch(_) { clBc = null; }

/* ── Estado global ── */
let cursoAtivo      = null;   // { id, nome, link }
let ativAtiva       = null;   // { id, titulo, pontos }
let grupoAtivo      = null;   // { id, nome, pontosMeta, cor, atividades }
let _grupoAnterior  = null;   // salva grupo ao navegar para atividade individual (botão voltar)
let viewMode        = 'atividades'; // 'atividades' | 'sem-grupo' | 'grupos' | 'auditoria'
let semGrupoCache   = [];            // atividades órfãs do curso atual
const semGrupoSel   = new Set();     // ids selecionados na aba "Sem grupo"
let alunos          = {};     // { [userId]: { nome, email, foto } }
let submissions     = [];     // entregas da atividade individual
let todasNotas      = [];     // cache filtrado da atividade individual
let atividadesCache = [];     // todas atividades do curso atual
let gruposCache     = [];     // todos grupos do curso atual
let auditResultado  = null;   // resultado da auditoria { atividades, semCorrespondencia }
let auditAtivAtiva  = null;   // atividade selecionada no modo auditoria
let auditCodClasse    = null;   // codClasse vinculado ao curso atual
let auditClassesCache = [];    // todas as classes RCO { codClasse, nomeDisciplina, descrTurma }
let auditTurmaFiltro  = '';    // turma selecionada para filtrar disciplinas
let corSelecionada  = '#4285F4';

/* ── Colunas da listagem de alunos ── */
const RESUMO_COLS = {
    aluno:     { label: 'Aluno',     width: '1fr'   },
    soma:      { label: 'Soma',      width: '100px' },
    rec:       { label: 'Rec.',      width: '72px'  },
    pendentes: { label: 'Pendentes', width: '90px'  },
};
let colOrder  = ['aluno', 'soma', 'rec', 'pendentes'];
let sortState = { col: null, dir: 'asc' };
try {
    const sc = JSON.parse(localStorage.getItem('cl-col-order')); if (Array.isArray(sc)) colOrder = sc;
    const ss = JSON.parse(localStorage.getItem('cl-col-sort'));  if (ss?.col !== undefined)  sortState = ss;
} catch (_) {}
let acessosCache    = null;   // cache do /api/acessos para o seletor RCO
let grupoResumoData  = null;   // { atividades, alunosResumo, meta } do grupo aberto
let alunoDetalheAberto = null; // userId do aluno cujo detalhe está aberto (para refresh após edição do grupo)
let filtrosGrupoAtivos = new Set(['todos']); // filtros de faixa de cor ativos (múltiplos)
let quizizzCache     = {};    // quizId → dados retornados pela API do Quizizz
let solicitacoesCache = [];

async function carregarSolicitacoesCache() {
    try {
        const d = await api('/solicitacoes?status=pendente');
        solicitacoesCache = d.solicitacoes || [];
    } catch (_) {}
}
let solicitBadgeCount = 0;   // contagem de pendentes

/* ── Elementos ── */
const elConnectScreen  = document.getElementById('clConnectScreen');
const elConnectDesc    = document.getElementById('clConnectDesc');
const elWorkspace      = document.getElementById('clWorkspace');
const elBtnConectar    = document.getElementById('clBtnConectar');
const elSemCredenciais = document.getElementById('clSemCredenciais');
const elCursoLista     = document.getElementById('clCursoLista');
const elAtivLista      = document.getElementById('clAtivLista');
const elGrupoLista     = document.getElementById('clGrupoLista');
const elAuditPanel     = document.getElementById('clAuditPanel');
const elAuditClasseSel = document.getElementById('clAuditClasseSel');
const elAuditResults   = document.getElementById('clAuditResults');
const elAuditAtivLista = document.getElementById('clAuditAtivLista');
const elAuditHint      = document.getElementById('clAuditHint');
const elAuditChipWrap  = document.getElementById('clAuditChipWrap');
const elAuditChipNome  = document.getElementById('clAuditChipNome');
const elAuditSelWrap   = document.getElementById('clAuditSelWrap');
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
const elBtnImprimir    = document.getElementById('clBtnImprimir');
const elBtnAtualizar   = document.getElementById('clBtnAtualizar');
const elBtnAtualizarIcon = document.getElementById('clBtnAtualizarIcon');
const elBtnLivro       = document.getElementById('clBtnLivro');
const elBtnRco         = document.getElementById('clBtnRco');
const elBtnCriarRec    = document.getElementById('clBtnCriarRec');
const elBtnFecharNota  = document.getElementById('clBtnFecharNota');
const elBtnTardias     = document.getElementById('clBtnTardias');
const elTardiasModal   = document.getElementById('clTardiasModal');
const elTardiasInfo    = document.getElementById('clTardiasInfo');
const elTardiasBody    = document.getElementById('clTardiasBody');
const elTardiasDetectar = document.getElementById('clTardiasDetectar');
const elTardiasFechar  = document.getElementById('clTardiasFechar');
const elTardiasFecharBtn = document.getElementById('clTardiasFecharBtn');
const elBusca          = document.getElementById('clBuscaAluno');
const elFiltroStatus   = document.getElementById('clFiltroStatus');
const elToast          = document.getElementById('clToast');
const elTabs           = document.getElementById('clTabs');
const elTabAtiv        = document.getElementById('clTabAtiv');
const elTabSemGrupo    = document.getElementById('clTabSemGrupo');
const elSemGrupoBadge  = document.getElementById('clSemGrupoBadge');
const elSemGrupoLista  = document.getElementById('clSemGrupoLista');
const elTabGrupos      = document.getElementById('clTabGrupos');
const elTabAudit       = document.getElementById('clTabAudit');
const elBtnClonarTri   = document.getElementById('clBtnClonarTrimestre');
const elGrupoTrimestre = document.getElementById('clGrupoTrimestre');
const elGrupoAno       = document.getElementById('clGrupoAno');
const elSideNavSolitaBadge = document.getElementById('sideNavSolitaBadge');
const elBtnNovoGrupo   = document.getElementById('clBtnNovoGrupo');
const elColAtivTitulo  = document.getElementById('clColAtivTitulo');
const elNotasTitulo    = document.getElementById('clNotasTitulo');
const elNotasBreadcrumb = document.getElementById('clNotasBreadcrumb');
const elCorrecaoAviso  = document.getElementById('clCorrecaoAviso');

/* ── Toast ── */
let toastTimer;
function toast(msg, tipo = '', duracao = 3500) {
    clearTimeout(toastTimer);
    elToast.textContent = msg;
    elToast.className = `cl-toast cl-toast--visivel${tipo ? ' cl-toast--' + tipo : ''}`;
    toastTimer = setTimeout(() => elToast.classList.remove('cl-toast--visivel'), duracao);
}
elToast.addEventListener('click', () => {
    clearTimeout(toastTimer);
    elToast.classList.remove('cl-toast--visivel');
});

/* ── Escala RCO: divide por 10, 1 casa decimal ── */
const rco = v => (v != null && v !== '' ? (Number(v) / 10).toFixed(1) : '—');

/* ── API helper (prefixo /api/classroom) ── */
async function api(path, opts = {}) {
    const r = await fetch('/api/classroom' + path, {
        ...opts,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) {
        toast('Sessão expirada. Redirecionando para login...', 'erro');
        setTimeout(() => { window.location.href = '/login/'; }, 1500);
        throw new Error('Sessão expirada. Faça login novamente.');
    }
    let data;
    try { data = await r.json(); }
    catch { throw new Error(`Erro ${r.status} — resposta inválida do servidor.`); }
    if (!r.ok) {
        const err = new Error(data.erro || 'Erro na requisição');
        err.status = r.status;
        err.body   = data;
        throw err;
    }
    return data;
}

/* ── API raw (/api/...) ── */
async function apiRaw(path, opts = {}) {
    const r = await fetch('/api' + path, {
        ...opts,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) {
        toast('Sessão expirada. Redirecionando para login...', 'erro');
        setTimeout(() => { window.location.href = '/login/'; }, 1500);
        throw new Error('Sessão expirada. Faça login novamente.');
    }
    let data;
    try { data = await r.json(); }
    catch { throw new Error(`Erro ${r.status} — resposta inválida do servidor.`); }
    if (!r.ok) {
        const err = new Error(data.erro || 'Erro na requisição');
        err.status = r.status;
        err.body   = data;
        throw err;
    }
    return data;
}

/* ── Utilitários ── */
function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Converte ISO UTC string → valor de input[datetime-local] (YYYY-MM-DDTHH:mm, horário local) */
function toDatetimeLocal(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const offset = d.getTimezoneOffset(); // minutos, positivo = atrás do UTC
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
}

/* Formata ISO UTC string → "DD/MM/YYYY às HH:mm" no fuso local */
function fmtDatetime(isoStr) {
    if (!isoStr) return '';
    return new Date(isoStr).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}
const TIPO_LABELS = {
    ASSIGNMENT:               'Atividade',
    SHORT_ANSWER_QUESTION:    'Pergunta',
    MULTIPLE_CHOICE_QUESTION: 'Múltipla escolha',
    QUIZ:                     'Quiz',
    MATERIAL:                 'Material',
};
const GRUPO_CORES = ['#4285F4','#EA4335','#34A853','#FBBC05','#8B5CF6','#EC4899','#14B8A6','#F97316','#0ea5e9','#a3e635'];

/* ── Chave localStorage para mapeamento curso→codClasse ── */
function auditMapKey(courseId) {
    return `cl_audit_classe_${courseId}`;
}

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
        const keepTab = params.get('tab');
        const cleanUrl = keepTab
            ? window.location.pathname + '?tab=' + keepTab
            : window.location.pathname;
        history.replaceState({}, '', cleanUrl);
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
    carregarSolicitacoesBadge();
    carregarSolicitacoesCache();


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
    if (!await confirmar('Você precisará autorizar novamente para usar o Classroom.', { titulo: 'Desconectar conta Google?', confirmLabel: 'Desconectar', tipo: 'danger', icone: '🔌' })) return;
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
    auditResultado  = null;
    auditAtivAtiva  = null;
    viewMode     = 'atividades';
    carregarCursos();
    resetColuna2();
    resetColuna3();
});

function resetColuna2() {
    elAtivLista.innerHTML     = '<div class="cl-empty-state"><p>← Selecione uma disciplina</p></div>';
    elSemGrupoLista.innerHTML = '<div class="cl-empty-state"><p>Selecione uma disciplina para ver atividades sem grupo.</p></div>';
    elGrupoLista.innerHTML    = '<div class="cl-empty-state"><p>Nenhum grupo criado.<br>Clique em <strong>+</strong> para criar.</p></div>';
    elAtivCount.textContent   = 'Selecione uma disciplina';
    elColAtivTitulo.textContent = 'Atividades';
    elTabs.style.display      = 'none';
    elBtnNovoGrupo.style.display = 'none';
    elBtnClonarTri.style.display = 'none';
    elAtivLink.style.display  = 'none';
    elAuditResults.style.display = 'none';
    semGrupoCache = [];
    semGrupoSel.clear();
    atualizarBadgeSemGrupo();
    setTab('atividades');
}

function atualizarBadgeSemGrupo() {
    if (!elSemGrupoBadge) return;
    if (semGrupoCache.length > 0) {
        elSemGrupoBadge.textContent = String(semGrupoCache.length);
        elSemGrupoBadge.style.display = '';
    } else {
        elSemGrupoBadge.style.display = 'none';
    }
}

function resetColuna3() {
    elNotasLista.innerHTML        = '<div class="cl-empty-state"><p>← Selecione uma atividade para ver as entregas</p></div>';
    elNotasCount.textContent      = 'Selecione uma atividade';
    elNotasTitulo.textContent     = 'Notas & Entregas';
    elNotasBreadcrumb.style.display = 'none';
    elNotasBreadcrumb.textContent = '';
    elNotasStats.style.display    = 'none';
    elNotasFiltro.style.display   = 'none';
    elNotasActions.style.display  = 'none';
    if (elCorrecaoAviso) elCorrecaoAviso.style.display = 'none';
}

/* ══════════════════════════════════════════════════════════════
   CURSOS
══════════════════════════════════════════════════════════════ */
const CURSO_CORES = ['#4285F4','#EA4335','#34A853','#FBBC05','#8B5CF6','#EC4899','#14B8A6','#F97316'];

/* Extrai a turma do nome do curso, ex: "Logica - 1º Ano C Manha" → "1º Ano C" */
function extrairTurma(nome) {
    const m = (nome || '').match(/(\d+[ºo°]\s*Ano\s+[A-Z])/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : 'Outras';
}

/* Ordena turmas: 1º < 2º < 3º; dentro do mesmo ano por letra */
function ordenarTurmas(a, b) {
    const numA = parseInt(a) || 0, numB = parseInt(b) || 0;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
}

/* ── Ocultar disciplinas — persistência em localStorage ── */
const CL_OCULTOS_KEY = 'cl_disciplinas_ocultas';

function carregarOcultos() {
    try { return new Set(JSON.parse(localStorage.getItem(CL_OCULTOS_KEY) || '[]')); }
    catch { return new Set(); }
}

function salvarOcultos(set) {
    localStorage.setItem(CL_OCULTOS_KEY, JSON.stringify([...set]));
}

/* Cria um item de curso (visível ou oculto) e retorna o elemento */
function criarItemCurso(c, ocultos, onToggle) {
    const item = document.createElement('div');
    item.className  = 'cl-curso-item';
    item.dataset.id = c.id;
    const oculto = ocultos.has(c.id);

    item.innerHTML = `
        <div class="cl-curso-cor" style="background:${c.cor}"></div>
        <div class="cl-curso-info">
            <div class="cl-curso-nome" title="${esc(c.nome)}">${esc(c.nome)}</div>
            <div class="cl-curso-secao">${esc(c.secao || 'Sem seção')}</div>
        </div>
        <button class="cl-curso-ocultar" title="${oculto ? 'Mostrar disciplina' : 'Ocultar disciplina'}" tabindex="-1">
            ${oculto
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
            }
        </button>`;

    /* Clique no botão de ocultar */
    item.querySelector('.cl-curso-ocultar').addEventListener('click', e => {
        e.stopPropagation();
        onToggle(c.id);
    });

    /* Clique no item abre o curso (apenas para itens visíveis) */
    if (!oculto) {
        item.addEventListener('click', () => selecionarCurso(c, item, c.cor));
    }

    return item;
}

let _cursosCache = [];   // cache da última resposta da API
let _ocultosPanelAberto = false;

async function carregarCursos() {
    elCursoLista.innerHTML    = '<div class="cl-loading">Carregando disciplinas...</div>';
    elCursosCount.textContent = '—';
    try {
        const cursos = await api('/courses');
        _cursosCache = cursos;
        if (!cursos.length) {
            elCursoLista.innerHTML    = '<div class="cl-empty-state"><p>Nenhum curso encontrado.</p></div>';
            elCursosCount.textContent = '0 disciplinas';
            return;
        }

        /* Atribui cor permanente por índice global */
        const cursosComCor = cursos.map((c, i) => ({ ...c, cor: CURSO_CORES[i % CURSO_CORES.length] }));
        renderListaCursos(cursosComCor);
    } catch (e) {
        elCursoLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    }
}

function renderListaCursos(cursosComCor) {
    const ocultos = carregarOcultos();

    /* Separa visíveis e ocultos */
    const visiveis = cursosComCor.filter(c => !ocultos.has(c.id));
    const ocultosLista = cursosComCor.filter(c => ocultos.has(c.id));

    /* Atualiza contador */
    const total = cursosComCor.length;
    const vis   = visiveis.length;
    elCursosCount.textContent = ocultos.size > 0
        ? `${vis} de ${total} disciplina${total !== 1 ? 's' : ''}`
        : `${total} disciplina${total !== 1 ? 's' : ''}`;

    /* Callback de toggle — altera localStorage e re-renderiza */
    function onToggle(cursoId) {
        const set = carregarOcultos();
        if (set.has(cursoId)) set.delete(cursoId);
        else set.add(cursoId);
        salvarOcultos(set);
        renderListaCursos(cursosComCor);
    }

    /* Agrupa visíveis por turma */
    const grupos = {};
    visiveis.forEach(c => {
        const turma = extrairTurma(c.nome);
        if (!grupos[turma]) grupos[turma] = [];
        grupos[turma].push(c);
    });
    const turmasOrdenadas = Object.keys(grupos).sort(ordenarTurmas);
    turmasOrdenadas.forEach(t => grupos[t].sort((a, b) => a.nome.localeCompare(b.nome)));

    elCursoLista.innerHTML = '';

    /* Renderiza disciplinas visíveis */
    turmasOrdenadas.forEach(turma => {
        const hdr = document.createElement('div');
        hdr.className = 'cl-turma-header';
        hdr.textContent = turma;
        elCursoLista.appendChild(hdr);

        grupos[turma].forEach(c => {
            elCursoLista.appendChild(criarItemCurso(c, ocultos, onToggle));
        });
    });

    /* Seção de disciplinas ocultas */
    if (ocultosLista.length > 0) {
        const secao = document.createElement('div');
        secao.className = 'cl-ocultos-secao';

        const toggle = document.createElement('button');
        toggle.className = 'cl-ocultos-toggle';
        toggle.innerHTML = `
            <svg class="cl-ocultos-arrow${_ocultosPanelAberto ? ' cl-ocultos-arrow--aberto' : ''}"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            <span>Ocultas (${ocultosLista.length})</span>`;

        const lista = document.createElement('div');
        lista.className = 'cl-ocultos-lista';
        lista.style.display = _ocultosPanelAberto ? '' : 'none';

        toggle.addEventListener('click', () => {
            _ocultosPanelAberto = !_ocultosPanelAberto;
            lista.style.display = _ocultosPanelAberto ? '' : 'none';
            toggle.querySelector('.cl-ocultos-arrow').classList.toggle('cl-ocultos-arrow--aberto', _ocultosPanelAberto);
        });

        ocultosLista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach(c => {
            lista.appendChild(criarItemCurso(c, ocultos, onToggle));
        });

        secao.appendChild(toggle);
        secao.appendChild(lista);
        elCursoLista.appendChild(secao);
    }

    /* Restaura item ativo se ainda visível */
    if (cursoAtivo) {
        const itemAtivo = elCursoLista.querySelector(`.cl-curso-item[data-id="${cursoAtivo.id}"]`);
        if (itemAtivo) itemAtivo.classList.add('cl-curso-item--ativo');
    }
}

async function selecionarCurso(curso, itemEl, cor) {
    document.querySelectorAll('.cl-curso-item--ativo').forEach(el => el.classList.remove('cl-curso-item--ativo'));
    itemEl.classList.add('cl-curso-item--ativo');
    cursoAtivo      = curso;
    ativAtiva       = null;
    grupoAtivo      = null;
    auditAtivAtiva  = null;
    auditResultado  = null;
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
    else if (viewMode === 'auditoria') setTab('auditoria');

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

    // Se a aba auditoria estava ativa, preparar seletor
    if (viewMode === 'auditoria') prepararAuditSelector();
}

/* ══════════════════════════════════════════════════════════════
   ABAS
══════════════════════════════════════════════════════════════ */
function setTab(tab) {
    viewMode = tab;
    elTabAtiv.classList.toggle('cl-tab--ativo', tab === 'atividades');
    elTabSemGrupo.classList.toggle('cl-tab--ativo', tab === 'sem-grupo');
    elTabGrupos.classList.toggle('cl-tab--ativo', tab === 'grupos');
    elTabAudit.classList.toggle('cl-tab--ativo', tab === 'auditoria');

    elAtivLista.style.display        = tab === 'atividades' ? '' : 'none';
    elSemGrupoLista.style.display    = tab === 'sem-grupo' ? '' : 'none';
    elGrupoLista.style.display       = tab === 'grupos' ? '' : 'none';
    elAuditPanel.style.display       = tab === 'auditoria' ? '' : 'none';
    elAtivLink.style.display         = tab === 'atividades' && cursoAtivo?.link ? 'flex' : 'none';
    elBtnNovoGrupo.style.display     = tab === 'grupos' && cursoAtivo ? 'flex' : 'none';
    elBtnClonarTri.style.display     = tab === 'grupos' && cursoAtivo && gruposCache.length ? 'flex' : 'none';
    elBtnCriarRec.style.display      = tab === 'grupos' && grupoAtivo?.tipo === 'normal' && !grupoAtivo?.recuperacaoId ? 'flex' : 'none';
    elColAtivTitulo.textContent      = tab === 'grupos' ? 'Grupos'
                                     : tab === 'auditoria' ? 'Auditoria'
                                     : tab === 'sem-grupo' ? 'Sem grupo'
                                     : 'Atividades';

    if (tab === 'atividades') {
        elAtivCount.textContent = atividadesCache.length
            ? `${atividadesCache.length} atividade${atividadesCache.length !== 1 ? 's' : ''}`
            : 'Selecione uma disciplina';
    } else if (tab === 'sem-grupo') {
        elAtivCount.textContent = semGrupoCache.length
            ? `${semGrupoCache.length} sem grupo`
            : 'Tudo organizado!';
    } else if (tab === 'grupos') {
        elAtivCount.textContent = gruposCache.length
            ? `${gruposCache.length} grupo${gruposCache.length !== 1 ? 's' : ''}`
            : 'Nenhum grupo criado';
    } else {
        elAtivCount.textContent = auditResultado
            ? `${auditResultado.atividades.length} atividade${auditResultado.atividades.length !== 1 ? 's' : ''} auditadas`
            : 'Analisando...';
    }

    if (tab === 'atividades' && (grupoAtivo || auditAtivAtiva)) {
        grupoAtivo     = null;
        auditAtivAtiva = null;
        resetColuna3();
    }
    if ((tab === 'grupos' || tab === 'sem-grupo') && (ativAtiva || auditAtivAtiva)) {
        ativAtiva      = null;
        auditAtivAtiva = null;
        if (tab === 'sem-grupo') grupoAtivo = null;
        resetColuna3();
    }
    if (tab === 'sem-grupo') {
        elNotasBreadcrumb.style.display = 'none';
        elNotasBreadcrumb.textContent   = '';
        if (cursoAtivo) renderSemGrupo();
    }
    if (tab === 'auditoria') {
        ativAtiva  = null;
        grupoAtivo = null;
        elNotasBreadcrumb.style.display = 'none';
        elNotasBreadcrumb.textContent = '';
        if (cursoAtivo) {
            prepararAuditSelector();
            if (auditResultado) renderAuditAtividades();
        }
    }
}

elTabAtiv.addEventListener('click', () => setTab('atividades'));
elTabSemGrupo.addEventListener('click', () => setTab('sem-grupo'));
elTabGrupos.addEventListener('click', () => setTab('grupos'));
elTabAudit.addEventListener('click', () => setTab('auditoria'));

/* ══════════════════════════════════════════════════════════════
   SOLICITAÇÕES DE REABERTURA
══════════════════════════════════════════════════════════════ */
function atualizarBadgeSolicita(total) {
    solicitBadgeCount = total;
    if (total > 0) {
        elSolitaBadge.textContent     = total;
        elSolitaBadge.style.display   = '';
        if (elSideNavSolitaBadge) {
            elSideNavSolitaBadge.textContent   = total;
            elSideNavSolitaBadge.style.display = '';
        }
    } else {
        elSolitaBadge.style.display = 'none';
        if (elSideNavSolitaBadge) elSideNavSolitaBadge.style.display = 'none';
    }
}

async function carregarSolicitacoesBadge() {
    try {
        const d = await api('/solicitacoes/badge');
        atualizarBadgeSolicita(d.total ?? 0);
    } catch (_) {}
}


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
        item.dataset.ativId = a.id;
        item.innerHTML = `
            <div class="cl-ativ-header">
                <span class="cl-ativ-titulo" title="${esc(a.titulo)}">${esc(a.titulo)}</span>
                ${a.pontos !== null
                    ? `<span class="cl-ativ-pontos cl-ativ-pontos--editavel" title="Clique para editar pontos">${rco(a.pontos)} pts</span>`
                    : `<span class="cl-ativ-pontos cl-ativ-pontos--vazio cl-ativ-pontos--editavel" title="Clique para definir pontos">— pts</span>`}
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
    if (grupoAtivo) _grupoAnterior = grupoAtivo;
    ativAtiva  = ativ;
    grupoAtivo = null;
    clBc?.postMessage({ type: 'atividade', cursoId: cursoAtivo?.id, ativId: ativ.id });

    if (_grupoAnterior && cursoAtivo) {
        const tipoLabel = _grupoAnterior.tipo === 'recuperacao' ? 'Recuperação' : 'Atividades';
        elNotasBreadcrumb.innerHTML = `<span class="cl-breadcrumb-back" id="clBreadcrumbBack" title="Voltar para ${esc(_grupoAnterior.nome)}">← ${esc(cursoAtivo.nome)} — ${esc(tipoLabel)} — ${esc(_grupoAnterior.nome)}</span>`;
        elNotasBreadcrumb.style.display = '';
    } else {
        elNotasBreadcrumb.textContent = cursoAtivo ? `${cursoAtivo.nome} — Atividades` : '';
        elNotasBreadcrumb.style.display = cursoAtivo ? '' : 'none';
    }
    elNotasTitulo.textContent    = 'Notas & Entregas';
    elNotasCount.textContent     = 'Carregando...';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'none';
    if (elCorrecaoAviso) elCorrecaoAviso.style.display = 'none';
    elNotasLista.innerHTML       = '<div class="cl-loading">Carregando entregas...</div>';
    elBusca.value                = '';
    elFiltroStatus.value         = '';

    try {
        submissions = await api(`/courses/${cursoAtivo.id}/coursework/${ativ.id}/submissions`);
        todasNotas  = submissions.map(s => ({
            ...s,
            aluno: alunos[s.userId] || { nome: 'Aluno ' + s.userId, email: '', foto: null },
        })).sort((a, b) => {
            const na = a.aluno.numChamada ?? 9999;
            const nb = b.aluno.numChamada ?? 9999;
            return na !== nb ? na - nb : (a.aluno.nome || '').localeCompare(b.aluno.nome || '');
        });

        elNotasCount.textContent     = `${todasNotas.length} aluno${todasNotas.length !== 1 ? 's' : ''}`;
        elNotasStats.style.display   = 'grid';
        elNotasFiltro.style.display  = 'flex';
        elNotasActions.style.display  = 'flex';
        elBtnImprimir.style.display  = 'none';
        elBtnAtualizar.style.display = 'none';
        elBtnLivro.style.display     = 'none';
        elBtnRco.style.display       = 'none';
        elBtnFecharNota.style.display = 'none';
        elBtnTardias.style.display    = 'none';

        document.getElementById('clStEntreguesLabel').textContent = 'Entregues';
        document.getElementById('clStPendentesLabel').textContent = 'Pendentes';
        atualizarStats();
        renderNotas();

        const backBtn = document.getElementById('clBreadcrumbBack');
        if (backBtn) {
            backBtn.addEventListener('click', () => voltarParaGrupo());
        }
    } catch (e) {
        elNotasLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    }
}

function voltarParaGrupo() {
    if (!_grupoAnterior) return;
    const grupo = _grupoAnterior;
    _grupoAnterior = null;
    if (viewMode !== 'grupos') {
        elTabGrupos.click();
    }
    setTimeout(() => {
        const itemEl = document.querySelector(`.cl-grupo-item[data-id="${grupo.id}"]`);
        if (itemEl) {
            itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            selecionarGrupo(grupo, itemEl);
        } else {
            selecionarGrupo(grupo, document.createElement('div'));
        }
    }, 50);
}

/* ── Stats (atividade individual) ── */
function atualizarStats() {
    const total     = todasNotas.length;
    const entregues = todasNotas.filter(n => n.entregue || n.estado === 'RETURNED').length;
    const pendentes = todasNotas.filter(n => !n.entregue && n.estado !== 'RETURNED').length;
    const comNota   = todasNotas.filter(n => n.nota !== null || n.notaRascunho != null);
    const media     = comNota.length ? rco(comNota.reduce((s, n) => s + (n.nota !== null ? n.nota : n.notaRascunho), 0) / comNota.length) : '—';

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
        if (status === 'ausente' && !n.ausente) return false;
        if (status === 'corrigir' && !(n.estado === 'TURNED_IN' && n.nota === null && (n.notaRascunho === undefined || n.notaRascunho === null))) return false;
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
            <span style="text-align:center">Nota${maxPts !== null ? ` /${rco(maxPts)}` : ''}</span>
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

    const isDraft      = n.nota === null && n.notaRascunho != null;
    const inputVal     = n.nota !== null
        ? (n.nota / 10).toFixed(1)
        : (isDraft ? (n.notaRascunho / 10).toFixed(1) : '');
    const podeDevolver = n.entregue && n.estado !== 'RETURNED';
    const ausenteBadge = n.ausente
        ? `<span class="cl-ausente-badge" title="Aluno estava ausente neste dia — zero aplicado pela auditoria">AUSENTE</span>`
        : '';
    const rascunhoBadge = isDraft
        ? `<span class="cl-rascunho-badge" title="Nota em rascunho — ainda não devolvida ao aluno">Rascunho</span>`
        : '';

    const numBadgeNota = a.numChamada ? `<span class="cl-num-chamada">${a.numChamada}</span>` : '';
    return `<div class="cl-nota-row${n.ausente ? ' cl-nota-row--ausente' : ''}" data-user="${n.userId}" data-sub="${n.id}">
        <div class="cl-nota-avatar">${fotoHtml}</div>
        <div class="cl-nota-nome" title="${esc(a.email)}">${numBadgeNota}${esc(a.nome || '—')}${ausenteBadge}</div>
        <div style="text-align:center">
            <span class="cl-nota-status-badge cl-nota-status--${statusCls}">${statusLabel}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
            <input class="cl-nota-input${isDraft ? ' cl-nota-input--rascunho' : ''}" type="number" min="0" max="${ativAtiva?.pontos != null ? (ativAtiva.pontos / 10).toFixed(1) : 10}"
                step="0.1" value="${inputVal}" placeholder="—"
                data-sub="${n.id}" data-original="${inputVal}"${isDraft ? ' data-rascunho="true"' : ''}/>
            ${rascunhoBadge}
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
        // Converte de volta para escala Classroom (×10) antes de enviar
        const notaInterno = nova === '' ? null : Math.round(Number(nova) * 10);
        await api(`/courses/${cursoAtivo.id}/coursework/${ativAtiva.id}/submissions/${subId}/grade`, {
            method: 'PATCH', body: { nota: notaInterno },
        });
        input.classList.add('cl-nota-input--salva');
        input.classList.remove('cl-nota-input--rascunho');
        delete input.dataset.rascunho;
        const badge = input.parentElement?.querySelector('.cl-rascunho-badge');
        if (badge) badge.remove();
        input.dataset.original = nova;
        const sub = todasNotas.find(n => n.id === subId);
        if (sub) { sub.nota = notaInterno; sub.notaRascunho = null; }
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
    if (!await confirmar(`Devolver a entrega de ${aluno?.nome || 'aluno'} para revisão?`, { titulo: 'Devolver entrega', confirmLabel: 'Devolver', tipo: 'danger', icone: '↩️' })) return;
    btn.disabled    = true;
    btn.textContent = '...';
    try {
        const r = await apiRaw(`/courses/${cursoAtivo.id}/coursework/${ativAtiva.id}/submissions/${subId}/return`, { method: 'POST' });
        if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            if (r.status === 403) {
                toast(data.erro || 'Sem permissão para devolver. Faça a devolução pelo Google Classroom.', 'alerta');
            } else {
                toast('Erro: ' + (data.erro || r.statusText), 'erro');
            }
            btn.disabled    = false;
            btn.textContent = 'Devolver';
            return;
        }
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
elBtnImprimir.addEventListener('click', () => {
    if (grupoAtivo) imprimirRelatorioGrupo();
});

elBtnAtualizar.addEventListener('click', async () => {
    if (!cursoAtivo) return;
    if (grupoAtivo) {
        try {
            const estudantes = await api(`/courses/${cursoAtivo.id}/students`);
            alunos = {};
            estudantes.forEach(a => { alunos[a.userId] = a; });
        } catch (_) {}
        carregarResumoGrupo(grupoAtivo);
    }
});

elBtnExportar.addEventListener('click', () => {
    if (grupoAtivo)      { exportarGrupoCSV();  return; }
    if (auditAtivAtiva)  { exportarAuditCSV();  return; }
    const lista  = filtrarNotas();
    const titulo = ativAtiva?.titulo || 'atividade';
    const curso  = cursoAtivo?.nome  || 'disciplina';
    const maxPts = ativAtiva?.pontos ?? '';
    let csv = `Disciplina,Atividade,Pontuação máxima\n"${curso}","${titulo}","${maxPts}"\n\n`;
    csv    += 'Nº,Aluno,Email,Status,Nota,Ausente\n';
    lista.forEach((n, i) => {
        const status = n.estado === 'RETURNED' ? 'Devolvido' : n.atrasado ? 'Atrasado' : n.entregue ? 'Entregue' : 'Pendente';
        csv += `${i+1},"${n.aluno.nome || ''}","${n.aluno.email || ''}","${status}","${n.nota ?? ''}","${n.ausente ? 'Sim' : ''}"\n`;
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
async function carregarSemGrupo() {
    if (!cursoAtivo) { semGrupoCache = []; atualizarBadgeSemGrupo(); return; }
    try {
        const r = await api(`/orphan-activities?courseId=${cursoAtivo.id}`);
        semGrupoCache = r.atividades || [];
    } catch (e) {
        console.error('[CLASSROOM] Erro ao carregar atividades sem grupo:', e.message);
        semGrupoCache = [];
    }
    /* Limpa seleções que sumiram */
    const ids = new Set(semGrupoCache.map(a => a.id));
    [...semGrupoSel].forEach(id => { if (!ids.has(id)) semGrupoSel.delete(id); });
    atualizarBadgeSemGrupo();
    if (viewMode === 'sem-grupo') {
        renderSemGrupo();
        elAtivCount.textContent = semGrupoCache.length
            ? `${semGrupoCache.length} sem grupo`
            : 'Tudo organizado!';
    }
}

function renderSemGrupo() {
    if (!cursoAtivo) {
        elSemGrupoLista.innerHTML = '<div class="cl-empty-state"><p>Selecione uma disciplina.</p></div>';
        return;
    }
    if (!semGrupoCache.length) {
        elSemGrupoLista.innerHTML = `
            <div class="cl-empty-state" style="padding:24px 16px">
                <p style="font-size:1.6rem;margin:0 0 8px">✅</p>
                <p><strong>Tudo organizado!</strong><br>Todas as atividades deste curso já estão em algum grupo.</p>
            </div>`;
        return;
    }

    const opcoes = gruposCache
        .filter(g => !g.dataFechamento)
        .map(g => `<option value="${g.id}">${esc(g.nome)} · ${g.trimestre}º Trimestre · ${g.ano}</option>`)
        .join('');

    const itensHtml = semGrupoCache.map(a => {
        const checked = semGrupoSel.has(a.id) ? 'checked' : '';
        const pts = a.pontos != null ? `<span class="cl-ativ-pontos">${rco(a.pontos)} pts</span>` : '';
        const due = a.dueDate ? ` &middot; entrega ${a.dueDate.day}/${a.dueDate.month}/${a.dueDate.year}` : '';
        return `
        <label class="cl-sem-grupo-item" data-id="${esc(a.id)}">
            <input type="checkbox" class="cl-sem-grupo-cb" value="${esc(a.id)}" ${checked}/>
            <div class="cl-sem-grupo-info">
                <div class="cl-sem-grupo-nome">${esc(a.titulo)}</div>
                <div class="cl-sem-grupo-meta">${pts}${due}</div>
            </div>
        </label>`;
    }).join('');

    elSemGrupoLista.innerHTML = `
        <div class="cl-sem-grupo-toolbar">
            <label class="cl-sem-grupo-selall">
                <input type="checkbox" id="clSemGrupoSelAll"/>
                <span>Selecionar todas</span>
            </label>
            <span id="clSemGrupoSelCount" class="cl-sem-grupo-count">${semGrupoSel.size} selecionada${semGrupoSel.size === 1 ? '' : 's'}</span>
            <div class="cl-sem-grupo-actions">
                <select id="clSemGrupoDest" class="cl-select cl-select--compact">
                    <option value="">— escolha um grupo —</option>
                    ${opcoes || '<option disabled>Nenhum grupo aberto disponível</option>'}
                </select>
                <button class="cl-btn cl-btn--sm cl-btn--primary" id="clSemGrupoAdd">Adicionar</button>
            </div>
        </div>
        <div class="cl-sem-grupo-lista">${itensHtml}</div>`;

    const cbAll  = elSemGrupoLista.querySelector('#clSemGrupoSelAll');
    const cnt    = elSemGrupoLista.querySelector('#clSemGrupoSelCount');
    const destEl = elSemGrupoLista.querySelector('#clSemGrupoDest');
    const btnAdd = elSemGrupoLista.querySelector('#clSemGrupoAdd');
    cbAll.checked = semGrupoSel.size === semGrupoCache.length && semGrupoCache.length > 0;

    elSemGrupoLista.querySelectorAll('.cl-sem-grupo-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) semGrupoSel.add(cb.value);
            else semGrupoSel.delete(cb.value);
            cnt.textContent = `${semGrupoSel.size} selecionada${semGrupoSel.size === 1 ? '' : 's'}`;
            cbAll.checked = semGrupoSel.size === semGrupoCache.length;
        });
    });
    cbAll.addEventListener('change', () => {
        if (cbAll.checked) semGrupoCache.forEach(a => semGrupoSel.add(a.id));
        else semGrupoSel.clear();
        elSemGrupoLista.querySelectorAll('.cl-sem-grupo-cb').forEach(cb => { cb.checked = cbAll.checked; });
        cnt.textContent = `${semGrupoSel.size} selecionada${semGrupoSel.size === 1 ? '' : 's'}`;
    });
    btnAdd.addEventListener('click', async () => {
        const grupoId = destEl.value;
        if (!grupoId) { toast('Selecione um grupo de destino.', 'erro'); return; }
        if (semGrupoSel.size === 0) { toast('Selecione ao menos uma atividade.', 'erro'); return; }
        const ativs = semGrupoCache
            .filter(a => semGrupoSel.has(a.id))
            .map(a => ({ atividade_id: a.id, atividade_titulo: a.titulo, pontos_max: a.pontos ?? null }));
        btnAdd.disabled = true; btnAdd.textContent = 'Adicionando...';
        try {
            const r = await api(`/groups/${grupoId}/activities`, { method: 'POST', body: { atividades: ativs } });
            const nIgn = (r.ignoradas || []).length;
            if (nIgn > 0) {
                toast(`${r.inseridas} adicionada(s); ${nIgn} ignorada(s) — já estavam em outro grupo.`, nIgn === ativs.length ? 'erro' : 'ok', 5000);
            } else {
                toast(`${r.inseridas} atividade(s) adicionada(s) ao grupo.`, 'ok');
            }
            semGrupoSel.clear();
            await Promise.all([carregarSemGrupo(), carregarGrupos()]);
        } catch (e) {
            toast('Erro ao adicionar: ' + e.message, 'erro');
        } finally {
            btnAdd.disabled = false; btnAdd.textContent = 'Adicionar';
        }
    });
}

async function carregarGrupos() {
    if (!cursoAtivo) return;
    try {
        gruposCache = await api(`/groups?courseId=${cursoAtivo.id}`);
        renderGrupos();
        carregarSemGrupo();
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
        elBtnClonarTri.style.display = 'none';
        return;
    }
    if (viewMode === 'grupos' && cursoAtivo) elBtnClonarTri.style.display = 'flex';

    /* Ordena: ano DESC, trimestre DESC, id DESC (mais recente no topo) */
    gruposCache.sort((a, b) => {
        if ((b.ano || 0) !== (a.ano || 0)) return (b.ano || 0) - (a.ano || 0);
        if ((b.trimestre || 0) !== (a.trimestre || 0)) return (b.trimestre || 0) - (a.trimestre || 0);
        return (b.id || 0) - (a.id || 0);
    });

    /* Reordena para que cada filho (subgrupo) apareça LOGO ABAIXO do seu pai.
       Os filhos são removidos da posição original e injetados após o pai.
       Pais sem filhos e grupos avulsos mantêm a ordem do sort acima. */
    const filhosPorPai = {};
    const orfaos = []; // grupos sem pai (ou cujo pai não está no cache)
    const idsNoCache = new Set(gruposCache.map(g => g.id));
    gruposCache.forEach(g => {
        if (g.grupoPaiId && idsNoCache.has(g.grupoPaiId)) {
            (filhosPorPai[g.grupoPaiId] = filhosPorPai[g.grupoPaiId] || []).push(g);
        } else {
            orfaos.push(g);
        }
    });
    const gruposOrdenados = [];
    orfaos.forEach(g => {
        gruposOrdenados.push(g);
        (filhosPorPai[g.id] || []).forEach(f => gruposOrdenados.push(f));
    });

    elGrupoLista.innerHTML = '';
    let chaveAtual = null;
    gruposOrdenados.forEach(g => {
        const chave = `${g.ano || '?'}|${g.trimestre || '?'}`;
        if (chave !== chaveAtual) {
            chaveAtual = chave;
            const header = document.createElement('div');
            header.className = 'cl-grupo-trimestre-header';
            header.style.cssText = 'padding:10px 12px 6px;font-size:.78rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #e2e8f0;background:#f8fafc';
            header.textContent = `${g.trimestre || '?'}º Trimestre — ${g.ano || '?'}`;
            elGrupoLista.appendChild(header);
        }
        const item      = document.createElement('div');
        item.className  = 'cl-grupo-item';
        item.dataset.id = g.id;
        const nAtiv     = g.atividades.length;
        if (g.lancadoLivro)           item.classList.add('cl-grupo-item--lancado');
        if (g.tipo === 'recuperacao') item.classList.add('cl-grupo-item--recuperacao');
        const ehSubgrupo = !!g.grupoPaiId;
        const temSubgrupos = (g.subgrupos?.length || 0) > 0;
        if (ehSubgrupo)   item.classList.add('cl-grupo-item--subgrupo');
        if (temSubgrupos) item.classList.add('cl-grupo-item--pai');

        const lancadoHtml = g.lancadoLivro
            ? `<span class="cl-grupo-livro-badge" title="Lançado no livro${g.lancadoEm ? ' em ' + new Date(g.lancadoEm).toLocaleDateString('pt-BR') : ''}">📗 Lançado</span>`
            : '';
        const dataInicioStr = fmtDatetime(g.dataInicio);
        const recBadgeHtml = g.tipo === 'recuperacao'
            ? `<span class="cl-grupo-rec-badge" title="Recuperação${dataInicioStr ? ' — a partir de ' + dataInicioStr : ''}">🔄 Recuperação</span>`
            : '';
        const temRecHtml = g.recuperacaoId
            ? `<span class="cl-grupo-tem-rec" title="Tem grupo de recuperação: ${esc(g.recuperacaoNome || '')}">📎 Rec.</span>`
            : '';
        const fechadoHtml = g.dataFechamento
            ? `<span class="cl-grupo-fechado-badge" title="Notas fechadas em ${fmtDatetime(g.dataFechamento)}">🔒 Fechado</span>`
            : '';
        const fontesHtml = g.fontes?.length
            ? `<span class="cl-fonte-badge" title="Importa notas de: ${esc(g.fontes.map(f => f.fonteNome).join(', '))}">📥 ${g.fontes.length} fonte${g.fontes.length > 1 ? 's' : ''}</span>`
            : '';
        /* Chip que mostra a relação pai-filho na própria linha do card. */
        let subgrupoBadgeHtml = '';
        if (ehSubgrupo) {
            const pai = gruposCache.find(p => p.id === g.grupoPaiId);
            const nomePai = pai ? pai.nome : 'grupo principal';
            subgrupoBadgeHtml = `<span class="cl-grupo-subgrupo-badge" title="A nota deste grupo soma em '${esc(nomePai)}'">↑ soma em ${esc(nomePai)}</span>`;
        } else if (temSubgrupos) {
            const nomesFilhos = g.subgrupos.map(s => s.nome).join(', ');
            subgrupoBadgeHtml = `<span class="cl-grupo-pai-badge" title="Este grupo recebe a soma de: ${esc(nomesFilhos)}">+${g.subgrupos.length} subgrupo${g.subgrupos.length > 1 ? 's' : ''}</span>`;
        }
        if (g.dataFechamento) item.classList.add('cl-grupo-item--fechado');

        item.innerHTML  = `
            <div class="cl-grupo-cor" style="background:${g.cor}"></div>
            <div class="cl-grupo-info">
                <div class="cl-grupo-nome">${esc(g.nome)} ${lancadoHtml}${recBadgeHtml}${temRecHtml}${fechadoHtml}${fontesHtml}${subgrupoBadgeHtml}</div>
                <div class="cl-grupo-meta">
                    ${nAtiv} atividade${nAtiv !== 1 ? 's' : ''} &bull;
                    <span class="cl-grupo-pts">${rco(g.pontosMeta)} pts</span>
                    ${dataInicioStr ? `&bull; <span class="cl-grupo-data-rec">📅 a partir de ${dataInicioStr}</span>` : ''}
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
    _grupoAnterior = null;
    clBc?.postMessage({ type: 'grupo', cursoId: cursoAtivo?.id, grupoId: grupo.id });

    const tipoLabel = grupo.tipo === 'recuperacao' ? 'Recuperação' : 'Atividades';
    elNotasBreadcrumb.textContent = `${cursoAtivo?.nome || 'Disciplina'} — ${tipoLabel}`;
    elNotasBreadcrumb.style.display = '';
    elNotasTitulo.textContent    = `Soma — ${grupo.nome}`;
    elNotasCount.textContent     = 'Carregando...';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'flex';
    elBtnImprimir.style.display  = 'inline-flex';
    elBtnLivro.style.display     = 'inline-flex';
    atualizarBtnLivro(grupo);
    elBtnRco.style.display       = grupo.codClasseRco ? 'inline-flex' : 'none';
    /* Atalho "Criar Recuperação": só aparece para grupos normais sem recuperação vinculada */
    elBtnCriarRec.style.display = (grupo.tipo === 'normal' && !grupo.recuperacaoId) ? 'flex' : 'none';
    atualizarBtnFecharNota(grupo);
    elNotasLista.innerHTML       = '<div class="cl-loading">Calculando somas...</div>';

    if (!grupo.atividades.length) {
        elNotasLista.innerHTML   = '<div class="cl-empty-state"><p>Este grupo não tem atividades.<br>Edite o grupo para adicionar.</p></div>';
        elNotasCount.textContent = '0 atividades';
        return;
    }

    await carregarResumoGrupo(grupo);
}

/* ── Atualiza visual do botão "Lançar no livro" conforme estado do grupo ── */
function atualizarBtnLivro(grupo) {
    if (!grupo) { elBtnLivro.style.display = 'none'; return; }
    if (grupo.lancadoLivro) {
        elBtnLivro.innerHTML = '✅ Lançado no livro';
        elBtnLivro.classList.add('cl-btn--livro--ok');
        elBtnLivro.title = grupo.lancadoEm
            ? `Lançado em ${new Date(grupo.lancadoEm).toLocaleString('pt-BR')} — clique para desmarcar`
            : 'Lançado — clique para desmarcar';
    } else {
        elBtnLivro.innerHTML = '📒 Lançar no livro';
        elBtnLivro.classList.remove('cl-btn--livro--ok');
        elBtnLivro.title = 'Marcar que as notas deste grupo já foram lançadas no livro de chamada';
    }
}

/* ── Handler: marcar/desmarcar lançamento no livro ── */
elBtnLivro.addEventListener('click', async () => {
    if (!grupoAtivo) return;
    const novoEstado = !grupoAtivo.lancadoLivro;

    if (novoEstado && grupoResumoData?.alunosResumo) {
        const naoCorrigidos = [];
        grupoResumoData.alunosResumo.forEach(a => {
            Object.entries(a.atividades || {}).forEach(([atvId, atv]) => {
                if (atv.estado === 'TURNED_IN' && atv.nota === null && (atv.notaRascunho === undefined || atv.notaRascunho === null) && !atv.eDeRecuperacao && !atv.eTardia) {
                    const atvInfo = grupoResumoData.atividades?.find(x => String(x.id) === String(atvId));
                    naoCorrigidos.push({
                        aluno: a.aluno?.nome || a.userId,
                        atividade: atvInfo?.titulo || atvId,
                    });
                }
            });
        });

        if (naoCorrigidos.length) {
            const lista = naoCorrigidos.slice(0, 10).map(x => `• ${x.aluno} → ${x.atividade}`).join('\n');
            const extra = naoCorrigidos.length > 10 ? `\n… e mais ${naoCorrigidos.length - 10}` : '';
            const prosseguir = await confirmar(
                `⚠️ ${naoCorrigidos.length} entrega${naoCorrigidos.length > 1 ? 's' : ''} ainda não corrigida${naoCorrigidos.length > 1 ? 's' : ''}:\n\n${lista}${extra}\n\nEssas notas ficarão como 0 no cálculo. Deseja prosseguir mesmo assim?`,
                {
                    titulo: 'Entregas sem correção',
                    confirmLabel: 'Prosseguir mesmo assim',
                    tipo: 'warning',
                    icone: '⚠️',
                }
            );
            if (!prosseguir) return;
        }
    }

    const msg        = novoEstado
        ? `As notas do grupo "${grupoAtivo.nome}" foram lançadas no livro de chamada?`
        : `Desmarcar o grupo "${grupoAtivo.nome}" como lançado no livro?`;
    const confirmado = await confirmar(msg, {
        titulo:       novoEstado ? 'Lançar no livro' : 'Remover marcação',
        confirmLabel: novoEstado ? '📒 Confirmar lançamento' : 'Remover',
        tipo:         novoEstado ? 'info' : 'danger',
        icone:        novoEstado ? '📒' : '↩️',
    });
    if (!confirmado) return;

    elBtnLivro.disabled = true;
    try {
        const data = await api(`/groups/${grupoAtivo.id}/livro`, {
            method: 'PATCH',
            body:   { lancado: novoEstado },
        });

        grupoAtivo.lancadoLivro = data.lancadoLivro;
        grupoAtivo.lancadoEm    = data.lancadoEm;

        // Atualiza cache
        const idx = gruposCache.findIndex(g => g.id === grupoAtivo.id);
        if (idx !== -1) {
            gruposCache[idx].lancadoLivro = data.lancadoLivro;
            gruposCache[idx].lancadoEm    = data.lancadoEm;
        }

        atualizarBtnLivro(grupoAtivo);
        renderGrupos();                      // atualiza badge no card da lista

        // Restaura seleção visual após re-render
        document.querySelectorAll('.cl-grupo-item').forEach(el => {
            if (Number(el.dataset.id) === grupoAtivo.id) el.classList.add('cl-grupo-item--ativo');
        });

        toast(novoEstado ? 'Grupo marcado como lançado no livro!' : 'Marcação removida.', 'ok');
    } catch (e) {
        toast(e.message, 'erro');
    } finally {
        elBtnLivro.disabled = false;
    }
});

/* ══════════════════════════════════════════════════════════════
   ATALHO: CRIAR GRUPO DE RECUPERAÇÃO RAPIDAMENTE
══════════════════════════════════════════════════════════════ */

/**
 * Abre o modal já preenchido como recuperação do grupoOrigem,
 * usando a data de hoje como data de corte (data_inicio).
 */
function criarRecuperacaoRapida(grupoOrigem) {
    /* 1. Abre modal vazio (preenche cor, atividades, etc.) */
    abrirModalGrupo(null);

    /* 2. Força tipo = recuperação */
    elTipoGrupo.querySelectorAll('.cl-tipo-btn').forEach(b => {
        b.classList.toggle('cl-tipo-btn--ativo', b.dataset.tipo === 'recuperacao');
    });
    elRecOrigemWrap.style.display = '';

    /* 3. Pré-preenche o grupo de origem (select já populado por abrirModalGrupo) */
    elRecOrigemSel.value = grupoOrigem.id;

    /* 4. Data e horário atual como corte */
    elRecDataInicio.value = toDatetimeLocal(new Date().toISOString());

    /* 5. Sugestão de nome e mesma meta de pontos */
    elGrupoNome.value    = `Recuperação — ${grupoOrigem.nome}`;
    elGrupoPontos.value  = (grupoOrigem.pontosMeta / 10).toFixed(1);

    /* 6. Marca as mesmas atividades do grupo de origem */
    preencherAtividadesDoGrupoPai(grupoOrigem.id);

    /* 7. Herda e bloqueia o código de classe RCO do grupo de origem */
    configurarCampoCodClasse(true, grupoOrigem.id);
}

elBtnCriarRec.addEventListener('click', () => {
    if (grupoAtivo) criarRecuperacaoRapida(grupoAtivo);
});

function atualizarBtnFecharNota(grupo) {
    if (!grupo) {
        elBtnFecharNota.style.display = 'none';
        elBtnTardias.style.display    = 'none';
        return;
    }
    elBtnFecharNota.style.display = 'inline-flex';
    if (grupo.dataFechamento) {
        elBtnFecharNota.innerHTML = '🔓 Reabrir nota';
        elBtnFecharNota.classList.add('cl-btn--fechar--ativo');
        elBtnFecharNota.title = `Notas fechadas em ${fmtDatetime(grupo.dataFechamento)} — clique para reabrir`;
        elBtnTardias.style.display = 'inline-flex';
        elBtnTardias.innerHTML = '⏰ Entregas tardias';
        verificarTardiasExistentes(grupo.id);
    } else {
        elBtnFecharNota.innerHTML = '🔒 Fechar nota';
        elBtnFecharNota.classList.remove('cl-btn--fechar--ativo');
        elBtnFecharNota.title = 'Fechar notas deste grupo — entregas após o fechamento serão registradas como tardias';
        elBtnTardias.style.display = 'none';
    }
}

async function verificarTardiasExistentes(grupoId) {
    try {
        const tardias = await api(`/groups/${grupoId}/tardias`);
        atualizarTardiasBadgeCount(tardias.length);
    } catch (_) {}
}

function atualizarTardiasBadgeCount(count) {
    const badge = elBtnTardias.querySelector('.cl-tardias-badge');
    if (badge) badge.remove();
    if (count > 0) {
        const span = document.createElement('span');
        span.className = 'cl-tardias-badge';
        span.textContent = count;
        elBtnTardias.appendChild(span);
    }
}

function atualizarTardiasBadgeFromResumo() {
    if (!grupoResumoData?.alunosResumo) return;
    let count = 0;
    grupoResumoData.alunosResumo.forEach(a => {
        Object.values(a.atividades || {}).forEach(atv => {
            if (atv.eTardia) count++;
        });
    });
    atualizarTardiasBadgeCount(count);
}

function detectarTardiasBackground(grupo) {
    if (!grupo?.id || !cursoAtivo?.id) return;
    api(`/groups/${grupo.id}/detectar-tardias`, {
        method: 'POST',
        body: { courseId: cursoAtivo.id },
    }).then(() => verificarTardiasExistentes(grupo.id)).catch(() => {});
}

elBtnFecharNota.addEventListener('click', async () => {
    if (!grupoAtivo || !cursoAtivo) return;
    const jaFechado = !!grupoAtivo.dataFechamento;

    if (jaFechado) {
        const reabrirHtml = `
            <div class="cl-fechar-resumo">
                <p>Deseja reabrir as notas do grupo "<strong>${esc(grupoAtivo.nome)}</strong>"? Entregas tardias registradas serão mantidas.</p>
                <div class="cl-fechar-sync-opt" style="margin-top:12px">
                    <label class="cl-fechar-sync-label">
                        <input type="checkbox" id="clAbrirRestaurarDueDate" checked>
                        <span>Restaurar prazos originais no Google Classroom</span>
                    </label>
                    <div class="cl-fechar-sync-desc">Reverte o prazo das atividades para o valor que tinham antes do fechamento.</div>
                </div>
            </div>`;
        const ok = await confirmar(reabrirHtml, {
            titulo: 'Reabrir notas', confirmLabel: 'Sim, reabrir', tipo: 'info', icone: '🔓', html: true,
        });
        if (!ok) return;
        const restaurarDueDate = document.getElementById('clAbrirRestaurarDueDate')?.checked ?? false;
        try {
            elBtnFecharNota.disabled = true;
            if (restaurarDueDate) toast('Reabrindo notas e restaurando prazos no Classroom...', 'info');
            const r = await api(`/groups/${grupoAtivo.id}/abrir`, { method: 'POST', body: { restaurarDueDate } });
            grupoAtivo.dataFechamento = null;
            atualizarBtnFecharNota(grupoAtivo);
            await carregarGrupos();
            await carregarResumoGrupo(grupoAtivo);
            if (r.classroomSync?.tentou) {
                const { sucessos, erros } = r.classroomSync;
                if (erros.length === 0) {
                    toast(`Notas reabertas! Prazo restaurado em ${sucessos} atividade(s).`, 'ok');
                } else {
                    toast(`Notas reabertas. ${sucessos} restaurada(s), ${erros.length} com erro.`, 'alerta');
                }
            } else {
                toast('Notas reabertas!', 'ok');
            }
            elBtnFecharNota.disabled = false;
        } catch (e) { elBtnFecharNota.disabled = false; toast('Erro ao reabrir: ' + e.message, 'erro'); }
    } else {
        toast('Recalculando dados do Classroom antes de fechar...', 'info');
        elBtnFecharNota.disabled = true;
        try {
            await carregarResumoGrupo(grupoAtivo);
        } catch (e) {
            toast('Erro ao recalcular: ' + e.message, 'erro');
            elBtnFecharNota.disabled = false;
            return;
        }
        elBtnFecharNota.disabled = false;

        const dados = grupoResumoData;
        const totalAlunos = dados?.alunosResumo?.length || 0;
        const media = totalAlunos
            ? rco(dados.alunosResumo.reduce((s, a) => s + a.soma, 0) / totalAlunos)
            : '—';
        const pendentes = dados?.alunosResumo?.filter(a => a.pendentes > 0).length || 0;
        const nAtivs = dados?.atividades?.length || 0;

        const semCorrecao = {};
        (dados?.alunosResumo || []).forEach(a => {
            Object.entries(a.atividades || {}).forEach(([atvId, atv]) => {
                if (atv.estado === 'TURNED_IN' && atv.nota === null && (atv.notaRascunho === undefined || atv.notaRascunho === null) && !atv.eDeRecuperacao && !atv.eTardia) {
                    if (!semCorrecao[atvId]) semCorrecao[atvId] = { count: 0, alunos: [] };
                    semCorrecao[atvId].count++;
                    semCorrecao[atvId].alunos.push(a.aluno?.nome || a.userId);
                }
            });
        });
        const atvsSemCorrecao = Object.keys(semCorrecao);
        const totalSemCorrecao = atvsSemCorrecao.reduce((s, id) => s + semCorrecao[id].count, 0);

        const fontesData = dados?.fontes || [];
        const fonteSemCorrecao = {};
        if (fontesData.length > 0) {
            (dados?.alunosResumo || []).forEach(a => {
                for (const fonte of fontesData) {
                    if (!fonte.atividades?.length) continue;
                    for (const fatv of fonte.atividades) {
                        const key = `f_${fonte.fonteGrupoId}_${fatv.id}`;
                        const sub = a.fontesAtividades?.[key];
                        if (sub && sub.estado === 'TURNED_IN' && sub.nota === null) {
                            const fkey = `${fonte.fonteGrupoId}_${fatv.id}`;
                            if (!fonteSemCorrecao[fkey]) fonteSemCorrecao[fkey] = { fonteNome: fonte.nome, titulo: fatv.titulo, count: 0, alunos: [] };
                            fonteSemCorrecao[fkey].count++;
                            fonteSemCorrecao[fkey].alunos.push(a.aluno?.nome || a.userId);
                        }
                    }
                }
            });
        }
        const fontesKeys = Object.keys(fonteSemCorrecao);
        const totalFonteSemCorrecao = fontesKeys.reduce((s, k) => s + fonteSemCorrecao[k].count, 0);

        let pendenciasHtml = '';
        if (atvsSemCorrecao.length > 0) {
            pendenciasHtml = `
                <div class="cl-fechar-pendencias">
                    <div class="cl-fechar-pendencias-header">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" style="flex-shrink:0">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <strong>${totalSemCorrecao} entrega(s) sem corrigir em ${atvsSemCorrecao.length} atividade(s)</strong>
                    </div>
                    <div class="cl-fechar-pendencias-list">
                        ${atvsSemCorrecao.map((atvId, idx) => {
                            const info = dados.atividades?.find(x => String(x.id) === String(atvId));
                            const titulo = info?.titulo || atvId;
                            const { count, alunos } = semCorrecao[atvId];
                            const alunosHtml = alunos.sort((a, b) => a.localeCompare(b)).map(n =>
                                `<div class="cl-fechar-sc-aluno">${esc(n)}</div>`
                            ).join('');
                            return `<div class="cl-fechar-pendencias-item" data-atv-id="${esc(atvId)}">
                                <div class="cl-fechar-sc-row">
                                    <span class="cl-fechar-pendencias-icon">⚠</span>
                                    <span class="cl-fechar-pendencias-nome">${esc(titulo)}</span>
                                    <span class="cl-fechar-pendencias-qty">${count} sem nota</span>
                                    <span class="cl-fechar-sc-toggle" data-idx="${idx}">▼</span>
                                </div>
                                <div class="cl-fechar-sc-alunos" id="clFecharScAlunos${idx}" style="display:none">
                                    ${alunosHtml}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                    <div class="cl-fechar-pendencias-dica">Clique em ▼ para ver os alunos, ou no nome da atividade para ir até ela.</div>
                </div>`;
        } else {
            pendenciasHtml = `
                <div class="cl-fechar-correcao-ok">
                    <span class="cl-fechar-correcao-ok-icon">✅</span>
                    <span>Nenhuma entrega pendente de correção</span>
                </div>`;
        }

        if (fontesKeys.length > 0) {
            const baseIdx = atvsSemCorrecao.length;
            pendenciasHtml += `
                <div class="cl-fechar-pendencias cl-fechar-pendencias--fonte">
                    <div class="cl-fechar-pendencias-header">
                        <span style="flex-shrink:0;font-size:14px">📥</span>
                        <strong>${totalFonteSemCorrecao} entrega(s) sem corrigir no grupo de origem (fontes externas)</strong>
                    </div>
                    <div class="cl-fechar-pendencias-list">
                        ${fontesKeys.map((fkey, i) => {
                            const idx = baseIdx + i;
                            const { fonteNome, titulo, count, alunos } = fonteSemCorrecao[fkey];
                            const alunosHtml = alunos.sort((a, b) => a.localeCompare(b)).map(n =>
                                `<div class="cl-fechar-sc-aluno">${esc(n)}</div>`
                            ).join('');
                            return `<div class="cl-fechar-pendencias-item">
                                <div class="cl-fechar-sc-row">
                                    <span class="cl-fechar-pendencias-icon">📥</span>
                                    <span class="cl-fechar-pendencias-nome cl-fechar-pendencias-nome--fonte">${esc(fonteNome)} → ${esc(titulo)}</span>
                                    <span class="cl-fechar-pendencias-qty">${count} sem nota</span>
                                    <span class="cl-fechar-sc-toggle" data-idx="${idx}">▼</span>
                                </div>
                                <div class="cl-fechar-sc-alunos" id="clFecharScAlunos${idx}" style="display:none">
                                    ${alunosHtml}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                    <div class="cl-fechar-pendencias-dica">Corrija essas atividades no grupo de origem antes de fechar, para que as notas sejam contabilizadas.</div>
                </div>`;
        }

        const alunosPendentes = (dados?.alunosResumo || [])
            .filter(a => a.pendentes > 0)
            .map(a => {
                const naoEntregues = [];
                Object.entries(a.atividades || {}).forEach(([atvId, atv]) => {
                    if (!atv.eDeRecuperacao && !atv.eTardia && atv.nota === null) {
                        const info = dados.atividades?.find(x => String(x.id) === String(atvId));
                        naoEntregues.push(info?.titulo || atvId);
                    }
                });
                return { nome: a.aluno?.nome || a.userId, pendentes: a.pendentes, naoEntregues };
            })
            .sort((a, b) => b.pendentes - a.pendentes);

        let pendentesDetailHtml = '';
        if (alunosPendentes.length > 0) {
            pendentesDetailHtml = `
                <div class="cl-fechar-pendentes-detail" id="clFecharPendentesDetail" style="display:none">
                    <div class="cl-fechar-pendentes-detail-list">
                        ${alunosPendentes.map(a => `<div class="cl-fechar-pendentes-aluno">
                            <span class="cl-fechar-pendentes-aluno-nome">${esc(a.nome)}</span>
                            <span class="cl-fechar-pendentes-aluno-qty">${a.pendentes} faltando</span>
                            ${a.naoEntregues.length > 0 ? `<div class="cl-fechar-pendentes-aluno-atvs">${a.naoEntregues.map(t => esc(t)).join(' · ')}</div>` : ''}
                        </div>`).join('')}
                    </div>
                </div>`;
        }

        const resumoHtml = `
            <div class="cl-fechar-resumo">
                <div class="cl-fechar-grupo-nome">${esc(grupoAtivo.nome)}</div>
                <div class="cl-fechar-stats">
                    <div class="cl-fechar-stat">
                        <span class="cl-fechar-stat-valor">${totalAlunos}</span>
                        <span class="cl-fechar-stat-label">Alunos</span>
                    </div>
                    <div class="cl-fechar-stat">
                        <span class="cl-fechar-stat-valor">${nAtivs}</span>
                        <span class="cl-fechar-stat-label">Atividades</span>
                    </div>
                    <div class="cl-fechar-stat">
                        <span class="cl-fechar-stat-valor">${media}</span>
                        <span class="cl-fechar-stat-label">Média (pts)</span>
                    </div>
                    <div class="cl-fechar-stat ${pendentes > 0 ? 'cl-fechar-stat--alerta cl-fechar-stat--clicavel' : ''}" ${pendentes > 0 ? 'id="clFecharPendentesToggle" title="Clique para ver os alunos com pendências"' : ''}>
                        <span class="cl-fechar-stat-valor">${pendentes} ${pendentes > 0 ? '<span class="cl-fechar-stat-expand">▼</span>' : ''}</span>
                        <span class="cl-fechar-stat-label">Com pendências</span>
                    </div>
                </div>
                ${pendentesDetailHtml}
                ${pendenciasHtml}
                <div class="cl-fechar-sync-opt">
                    <label class="cl-fechar-sync-label">
                        <input type="checkbox" id="clFecharSyncClassroom" checked>
                        <span>Definir prazo no Google Classroom</span>
                    </label>
                    <div class="cl-fechar-sync-desc">Atualiza o prazo (dueDate) de todas as atividades deste grupo no Classroom para agora. O prazo original é salvo e pode ser restaurado ao reabrir.</div>
                </div>
                <div class="cl-fechar-aviso">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;margin-top:2px"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.5h1.5v5h-1.5v-5zm.75 7.5a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
                    <span>Toda entrega recebida <strong>após este momento</strong> será registrada como <strong>tardia</strong> e não entrará no cálculo da nota.</span>
                </div>
            </div>`;

        const temPendencias = atvsSemCorrecao.length > 0 || fontesKeys.length > 0;
        const confirmarPromise = confirmar(resumoHtml, {
            titulo: 'Fechar notas',
            confirmLabel: temPendencias ? 'Fechar mesmo assim' : 'Sim, fechar agora',
            tipo: 'danger',
            icone: '🔒',
            html: true,
        });

        setTimeout(() => {
            const pendToggle = document.getElementById('clFecharPendentesToggle');
            const pendDetail = document.getElementById('clFecharPendentesDetail');
            if (pendToggle && pendDetail) {
                pendToggle.addEventListener('click', () => {
                    const aberto = pendDetail.style.display !== 'none';
                    pendDetail.style.display = aberto ? 'none' : 'block';
                    const arrow = pendToggle.querySelector('.cl-fechar-stat-expand');
                    if (arrow) arrow.textContent = aberto ? '▼' : '▲';
                });
            }
            document.querySelectorAll('.cl-fechar-sc-toggle').forEach(tog => {
                tog.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = tog.dataset.idx;
                    const panel = document.getElementById(`clFecharScAlunos${idx}`);
                    if (!panel) return;
                    const aberto = panel.style.display !== 'none';
                    panel.style.display = aberto ? 'none' : 'block';
                    tog.textContent = aberto ? '▼' : '▲';
                });
            });
            document.querySelectorAll('.cl-fechar-pendencias-nome').forEach(nomeEl => {
                nomeEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const item = nomeEl.closest('.cl-fechar-pendencias-item');
                    const atvId = item?.dataset?.atvId;
                    if (!atvId) return;
                    const ativ = atividadesCache.find(a => String(a.id) === String(atvId));
                    if (!ativ) { toast('Atividade não encontrada.', 'erro'); return; }
                    document.getElementById('clConfirmCancelar').click();
                    if (viewMode !== 'atividades') elTabAtiv.click();
                    setTimeout(async () => {
                        const itemEl = document.querySelector(`.cl-ativ-item[data-ativ-id="${atvId}"]`);
                        if (itemEl) {
                            itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                        await selecionarAtividade(ativ, itemEl || document.createElement('div'));
                        elFiltroStatus.value = 'corrigir';
                        renderNotas();
                    }, 150);
                });
            });
        }, 0);

        const ok = await confirmarPromise;
        if (!ok) return;
        const syncClassroom = document.getElementById('clFecharSyncClassroom')?.checked ?? false;
        try {
            elBtnFecharNota.disabled = true;
            if (syncClassroom) toast('Fechando notas e sincronizando prazos com o Classroom...', 'info');
            const r = await api(`/groups/${grupoAtivo.id}/fechar`, { method: 'POST', body: { syncClassroom } });
            grupoAtivo.dataFechamento = r.dataFechamento;
            atualizarBtnFecharNota(grupoAtivo);
            await carregarGrupos();
            await carregarResumoGrupo(grupoAtivo);
            if (r.classroomSync?.tentou) {
                const { sucessos, erros } = r.classroomSync;
                if (erros.length === 0) {
                    toast(`Notas fechadas! Prazo atualizado em ${sucessos} atividade(s) no Classroom.`, 'ok');
                } else {
                    toast(`Notas fechadas. ${sucessos} atividade(s) sincronizadas, ${erros.length} com erro.`, 'alerta');
                }
            } else {
                toast('Notas fechadas! Entregas futuras serão registradas como tardias.', 'ok');
            }
            elBtnFecharNota.disabled = false;
        } catch (e) { elBtnFecharNota.disabled = false; toast('Erro ao fechar: ' + e.message, 'erro'); }
    }
});

elBtnTardias.addEventListener('click', () => abrirModalTardias());
elTardiasFechar.addEventListener('click', () => fecharModalTardias());
elTardiasFecharBtn.addEventListener('click', () => fecharModalTardias());
elTardiasModal.addEventListener('click', e => { if (e.target === elTardiasModal) fecharModalTardias(); });

function fecharModalTardias() {
    elTardiasModal.classList.remove('cl-modal-overlay--visivel');
}

async function abrirModalTardias() {
    if (!grupoAtivo || !cursoAtivo) return;
    elTardiasModal.classList.add('cl-modal-overlay--visivel');
    elTardiasInfo.innerHTML = `<p>Grupo: <strong>${esc(grupoAtivo.nome)}</strong> — Fechado em: <strong>${fmtDatetime(grupoAtivo.dataFechamento)}</strong></p>`;
    elTardiasBody.innerHTML = '<div class="cl-loading">Buscando entregas tardias...</div>';

    try {
        const tardiasSalvas = await api(`/groups/${grupoAtivo.id}/tardias`);
        if (tardiasSalvas.length > 0) {
            renderTardias(tardiasSalvas);
        } else {
            elTardiasBody.innerHTML = '<div class="cl-loading">Verificando entregas tardias no Classroom...</div>';
            elTardiasDetectar.disabled = true;
            elTardiasDetectar.textContent = 'Verificando...';
            try {
                const r = await api(`/groups/${grupoAtivo.id}/detectar-tardias`, {
                    method: 'POST',
                    body: { courseId: cursoAtivo.id },
                });
                const tardias = await api(`/groups/${grupoAtivo.id}/tardias`);
                renderTardias(tardias);
                verificarTardiasExistentes(grupoAtivo.id);
            } finally {
                elTardiasDetectar.disabled = false;
                elTardiasDetectar.textContent = 'Verificar novas entregas tardias';
            }
        }
    } catch (e) {
        elTardiasBody.innerHTML = `<div class="cl-tardias-empty"><div class="cl-tardias-empty-icon">❌</div><div class="cl-tardias-empty-title" style="color:#ef4444">${esc(e.message)}</div></div>`;
    }
}

elTardiasDetectar.addEventListener('click', async () => {
    if (!grupoAtivo || !cursoAtivo) return;
    elTardiasDetectar.disabled = true;
    elTardiasDetectar.textContent = 'Verificando...';
    try {
        const r = await api(`/groups/${grupoAtivo.id}/detectar-tardias`, {
            method: 'POST',
            body: { courseId: cursoAtivo.id },
        });
        toast(`${r.total} entrega(s) tardia(s) detectada(s).`, r.total > 0 ? 'alerta' : 'ok');
        const tardias = await api(`/groups/${grupoAtivo.id}/tardias`);
        renderTardias(tardias);
        verificarTardiasExistentes(grupoAtivo.id);
    } catch (e) {
        toast('Erro ao detectar tardias: ' + e.message, 'erro');
    } finally {
        elTardiasDetectar.disabled = false;
        elTardiasDetectar.textContent = 'Verificar novas entregas tardias';
    }
});

function renderTardias(tardias) {
    if (!tardias.length) {
        elTardiasBody.innerHTML = '<div class="cl-tardias-empty"><div class="cl-tardias-empty-icon">✅</div><div class="cl-tardias-empty-title">Nenhuma entrega tardia detectada</div><div class="cl-tardias-empty-desc">Clique em "Verificar novas entregas tardias" para buscar no Classroom.</div></div>';
        return;
    }

    const porAtividade = {};
    tardias.forEach(t => {
        if (!porAtividade[t.atividadeId]) porAtividade[t.atividadeId] = { titulo: t.atividadeTitulo, alunos: [] };
        porAtividade[t.atividadeId].alunos.push(t);
    });

    let html = `<div class="cl-tardias-resumo">${tardias.length} entrega(s) tardia(s) em ${Object.keys(porAtividade).length} atividade(s)</div>`;

    for (const [atvId, data] of Object.entries(porAtividade)) {
        html += `<div class="cl-tardias-grupo">
            <div class="cl-tardias-grupo-titulo">${esc(data.titulo)}</div>
            <table class="cl-tardias-table">
                <thead><tr><th>Aluno</th><th>Email</th><th>Entregou em</th><th>Nota (RCO)</th><th>Status</th></tr></thead>
                <tbody>`;
        data.alunos.sort((a, b) => (a.nomeAluno || '').localeCompare(b.nomeAluno || ''));
        for (const a of data.alunos) {
            const dtEntrega = fmtDatetime(a.dataEntrega);
            const nota = a.nota !== null ? rco(Number(a.nota)) : '—';
            const estadoBadge = a.estado === 'RETURNED' ? '<span class="cl-badge cl-badge--returned">Devolvida</span>'
                : a.estado === 'TURNED_IN' ? '<span class="cl-badge cl-badge--turned-in">Entregue</span>'
                : `<span class="cl-badge">${a.estado}</span>`;
            html += `<tr>
                <td>${esc(a.nomeAluno)}</td>
                <td class="cl-tardias-email">${esc(a.emailAluno)}</td>
                <td>${dtEntrega}</td>
                <td>${nota}</td>
                <td>${estadoBadge}</td>
            </tr>`;
        }
        html += `</tbody></table></div>`;
    }

    elTardiasBody.innerHTML = html;
}

async function carregarResumoGrupo(grupo) {
    if (!grupo || !grupo.atividades.length) return;

    elNotasLista.innerHTML     = '<div class="cl-loading">Calculando somas...</div>';
    elNotasCount.textContent   = 'Carregando...';
    elNotasStats.style.display = 'none';

    elBtnAtualizar.disabled = true;
    elBtnAtualizarIcon.style.animation = 'clSpinIcon 0.8s linear infinite';

    try {
        /* Busca o resumo principal; se o grupo tem recuperação vinculada,
           busca em paralelo para montar o overlay de notas de recuperação */
        const [resumo, resumoRec] = await Promise.all([
            api(`/groups/${grupo.id}/summary?courseId=${cursoAtivo.id}`),
            grupo.recuperacaoId
                ? api(`/groups/${grupo.recuperacaoId}/summary?courseId=${cursoAtivo.id}`).catch(() => null)
                : Promise.resolve(null),
        ]);

        const isRec = !!resumo.isRecuperacao;
        const meta  = grupo.pontosMeta;

        /* Monta mapa userId → dados de recuperação (se houver grupo de rec. vinculado) */
        let recMeta = meta;
        const recMap = {};
        if (resumoRec?.alunos) {
            recMeta = gruposCache.find(g => String(g.id) === String(grupo.recuperacaoId))?.pontosMeta || meta;
            resumoRec.alunos.forEach(a => {
                recMap[a.userId] = {
                    soma:     ((a.mediaIndice ?? 0) / 100) * recMeta,
                    pendentes: a.pendentes,
                };
            });
        }

        const hasFontes = (resumo.fontes || []).length > 0;
        const alunosResumo = resumo.alunos.map(a => ({
            ...a,
            aluno:     alunos[a.userId] || { nome: 'Aluno ' + a.userId, email: '', foto: null },
            soma:      ((a.mediaIndice ?? 0) / 100) * meta,
            somaInterna: ((a.mediaIndiceInterno ?? a.mediaIndice ?? 0) / 100) * meta,
            /* somaPrevista: oficial + rascunhos pendentes de devolução. Sempre >= soma. */
            somaPrevista: ((a.mediaIndicePrevisto ?? a.mediaIndice ?? 0) / 100) * meta,
            temEntrou: Object.values(a.atividades || {}).some(s => s.nota === 0 && s.entregue),
            recData:   recMap[a.userId] ?? null,
        })).sort((a, b) => {
            const na = a.aluno.numChamada ?? 9999;
            const nb = b.aluno.numChamada ?? 9999;
            return na !== nb ? na - nb : (a.aluno.nome || '').localeCompare(b.aluno.nome || '');
        });

        const total   = alunosResumo.length;
        const comTudo = alunosResumo.filter(a => a.pendentes === 0).length;
        const pend    = alunosResumo.filter(a => a.pendentes > 0).length;
        const media   = total ? rco(alunosResumo.reduce((s, a) => s + a.soma, 0) / total) : '—';

        document.getElementById('clStTotal').textContent          = total;
        document.getElementById('clStEntregues').textContent      = comTudo;
        document.getElementById('clStEntreguesLabel').textContent = isRec ? 'Fizeram rec.' : 'Completos';
        document.getElementById('clStPendentes').textContent      = pend;
        document.getElementById('clStPendentesLabel').textContent = isRec ? 'Com pendências' : 'Com pendências';
        document.getElementById('clStMedia').textContent          = media;
        elNotasCount.textContent   = `${total} aluno${total !== 1 ? 's' : ''}`;
        elNotasStats.style.display = 'grid';

        if (!alunosResumo.length) {
            const msg = isRec
                ? '<p>Nenhum aluno realizou atividades neste grupo de recuperação ainda.</p>'
                : '<p>Nenhum aluno encontrado nas atividades do grupo.</p>';
            elNotasLista.innerHTML = `<div class="cl-empty-state">${msg}</div>`;
            return;
        }

        const hasRec = Object.keys(recMap).length > 0;
        grupoResumoData    = { atividades: resumo.atividades, alunosResumo, meta, recMeta, isRec, hasRec, dataInicio: resumo.dataInicio, dataCorteOriginal: resumo.dataCorteOriginal ?? null, dataFechamento: resumo.dataFechamento ?? null, fontes: resumo.fontes || [], subgrupos: resumo.subgruposInjetados || [] };
        filtrosGrupoAtivos = new Set(['todos']);
        renderListaFiltrada();
        renderAvisoCorrecao();

        if (grupo.dataFechamento) {
            atualizarTardiasBadgeFromResumo();
            detectarTardiasBackground(grupo);
        }

        toast('Dados atualizados do Classroom', 'ok');

        /* Sincroniza notas Quizizz (draftGrade → assignedGrade) em background */
        syncQuizizzBackground(grupo, resumo.atividades);

        /* Enriquece atividades Quizizz em background (sem bloquear a UI) */
        enriquecerQuizizz(resumo.atividades);

    } catch (e) {
        elNotasLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    } finally {
        elBtnAtualizar.disabled = false;
        elBtnAtualizarIcon.style.animation = '';
    }
}

function renderAvisoCorrecao() {
    if (!elCorrecaoAviso) return;
    if (!grupoResumoData?.alunosResumo) {
        elCorrecaoAviso.style.display = 'none';
        return;
    }

    const porAtividade = {};
    grupoResumoData.alunosResumo.forEach(a => {
        Object.entries(a.atividades || {}).forEach(([atvId, atv]) => {
            if (atv.estado === 'TURNED_IN' && atv.nota === null && (atv.notaRascunho === undefined || atv.notaRascunho === null) && !atv.eDeRecuperacao && !atv.eTardia) {
                if (!porAtividade[atvId]) porAtividade[atvId] = { count: 0, alunos: [] };
                porAtividade[atvId].count++;
                if (porAtividade[atvId].alunos.length < 3) {
                    porAtividade[atvId].alunos.push(a.aluno?.nome || a.userId);
                }
            }
        });
    });

    const atvIds = Object.keys(porAtividade);
    if (!atvIds.length) {
        elCorrecaoAviso.style.display = 'none';
        return;
    }

    const totalEntregas = atvIds.reduce((s, id) => s + porAtividade[id].count, 0);

    let linksHtml = '';
    atvIds.forEach(atvId => {
        const info = grupoResumoData.atividades?.find(x => String(x.id) === String(atvId));
        const titulo = info?.titulo || atvId;
        const isQuizizz = !!info?.quizizzId;
        const { count, alunos } = porAtividade[atvId];
        const nomes = alunos.join(', ') + (count > 3 ? ` +${count - 3}` : '');
        linksHtml += `
            <div class="cl-correcao-link" data-atv-id="${esc(atvId)}" title="${esc(nomes)}">
                <span class="cl-correcao-link__icon">${isQuizizz ? '🎮' : '!'}</span>
                <span class="cl-correcao-link__ativ">${esc(titulo)}${isQuizizz ? ' <small style="opacity:.6">(Quizizz)</small>' : ''}</span>
                <span class="cl-correcao-link__qty">${count} entrega${count > 1 ? 's' : ''}</span>
                <span class="cl-correcao-link__arrow">→</span>
            </div>`;
    });

    elCorrecaoAviso.innerHTML = `
        <div class="cl-correcao-aviso__header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Correções pendentes
            <span class="cl-correcao-aviso__count">${totalEntregas}</span>
        </div>
        <div class="cl-correcao-aviso__list">${linksHtml}</div>`;
    elCorrecaoAviso.style.display = '';

    elCorrecaoAviso.querySelectorAll('.cl-correcao-link').forEach(link => {
        link.addEventListener('click', () => {
            const atvId = link.dataset.atvId;
            const ativ = atividadesCache.find(a => String(a.id) === String(atvId));
            if (!ativ) {
                toast('Atividade não encontrada. Navegue manualmente pela lista.', 'erro');
                return;
            }
            if (grupoAtivo) _grupoAnterior = grupoAtivo;
            if (viewMode !== 'atividades') {
                elTabAtiv.click();
            }
            setTimeout(async () => {
                const itemEl = document.querySelector(`.cl-ativ-item[data-ativ-id="${atvId}"]`);
                if (itemEl) {
                    itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                await selecionarAtividade(ativ, itemEl || document.createElement('div'));
                elFiltroStatus.value = 'corrigir';
                renderNotas();
            }, 100);
        });
    });
}

function faixaCor(soma, meta) {
    const pct = meta > 0 ? Math.min(100, (soma / meta) * 100) : 0;
    if (pct >= 100) return 'meta';
    if (pct >= 60)  return 'prog';
    return 'abaixo';
}

/* Busca dados oficiais do Quizizz para atividades detectadas e re-renderiza o painel */
let _syncQuizizzRunning = false;
async function syncQuizizzBackground(grupo, atividades = []) {
    if (_syncQuizizzRunning) return;
    if (!grupo?.id || !cursoAtivo?.id) return;
    _syncQuizizzRunning = true;
    try {
        const r = await api(`/groups/${grupo.id}/sync-quizizz`, {
            method: 'POST',
            body: { courseId: cursoAtivo.id },
        });
        if (r.sincronizados > 0) {
            toast(`${r.sincronizados} nota(s) auto-corrigida(s) publicada(s).`, 'ok');
            await carregarResumoGrupo(grupo);
        }
    } catch (_) {} finally {
        _syncQuizizzRunning = false;
    }
}

async function enriquecerQuizizz(atividades = []) {
    const aQuizizz = atividades.filter(a => a.quizizzId && /^[0-9a-f]{24}$/i.test(a.quizizzId));
    if (!aQuizizz.length) return;

    await Promise.allSettled(aQuizizz.map(async atv => {
        if (quizizzCache[atv.quizizzId]) return; // já buscado
        try {
            const r = await fetch(`/api/classroom/quizizz/quiz/${atv.quizizzId}`);
            if (r.ok) quizizzCache[atv.quizizzId] = await r.json();
        } catch (_) { /* silencioso */ }
    }));

    /* Re-renderiza se o grupo ainda está aberto (dados não mudaram, só enriquece o painel) */
    const painel = document.getElementById('clQuizizzPainel');
    if (painel) renderQuizizzPainel(atividades, painel);
}

function renderQuizizzPainel(atividades, container) {
    const aQuizizz = atividades.filter(a => a.quizizzId);
    if (!aQuizizz.length) { container.innerHTML = ''; container.style.display = 'none'; return; }

    container.style.display = 'block';
    container.innerHTML = `
        <div class="cl-quizizz-painel">
            <div class="cl-quizizz-header">
                <span class="cl-quizizz-logo">🎮</span>
                <strong>Atividades Quizizz detectadas</strong>
                <span class="cl-quizizz-count">${aQuizizz.length}</span>
            </div>
            <div class="cl-quizizz-lista">
                ${aQuizizz.map(atv => {
                    const qz   = /^[0-9a-f]{24}$/i.test(atv.quizizzId) ? quizizzCache[atv.quizizzId] : null;
                    const link = /^[0-9a-f]{24}$/i.test(atv.quizizzId)
                        ? `https://quizizz.com/admin/quiz/${atv.quizizzId}` : null;
                    const carregando = /^[0-9a-f]{24}$/i.test(atv.quizizzId) && !qz;
                    return `<div class="cl-quizizz-item">
                        <div class="cl-quizizz-ativ-titulo">${esc(atv.titulo)}</div>
                        ${carregando
                            ? `<div class="cl-quizizz-loading">Buscando dados no Quizizz…</div>`
                            : qz
                                ? `<div class="cl-quizizz-dados">
                                    <span class="cl-qz-badge cl-qz-badge--titulo">${esc(qz.titulo)}</span>
                                    <span class="cl-qz-badge">${qz.totalQ} questões</span>
                                    ${qz.assunto  ? `<span class="cl-qz-badge">${esc(qz.assunto)}</span>`  : ''}
                                    ${qz.topico   ? `<span class="cl-qz-badge">${esc(qz.topico)}</span>`   : ''}
                                    ${qz.criador  ? `<span class="cl-qz-badge cl-qz-badge--criador">por ${esc(qz.criador)}</span>` : ''}
                                    ${link ? `<a class="cl-qz-badge cl-qz-badge--link" href="${link}" target="_blank" rel="noopener">Ver no Quizizz ↗</a>` : ''}
                                   </div>`
                                : `<div class="cl-quizizz-loading">Detectado pelo título — ID do quiz não disponível</div>`
                        }
                    </div>`;
                }).join('')}
            </div>
        </div>`;
}

function toggleFiltro(chave) {
    if (chave === 'todos') {
        filtrosGrupoAtivos = new Set(['todos']);
    } else {
        filtrosGrupoAtivos.delete('todos');
        if (filtrosGrupoAtivos.has(chave)) {
            filtrosGrupoAtivos.delete(chave);
        } else {
            filtrosGrupoAtivos.add(chave);
        }
        if (filtrosGrupoAtivos.size === 0) filtrosGrupoAtivos = new Set(['todos']);
    }
    renderListaFiltrada();
}

function renderListaFiltrada() {
    if (!grupoResumoData) return;
    const { alunosResumo, meta, atividades, isRec, hasRec, dataInicio, dataCorteOriginal, dataFechamento, fontes, subgrupos } = grupoResumoData;

    // Contagens por faixa
    const nMeta    = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'meta').length;
    const nProg    = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'prog').length;
    const nAbaixo  = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'abaixo').length;
    const nEntrou  = alunosResumo.filter(a => a.temEntrou).length;
    const nTodos   = alunosResumo.length;

    const chip = (key, cor, label, count) => {
        const ativo  = filtrosGrupoAtivos.has(key) ? ' cl-faixa-chip--ativo' : '';
        const pctStr = nTodos > 0 ? Math.round((count / nTodos) * 100) + '%' : '0%';
        const numLabel = key === 'todos' ? count : `${count} · ${pctStr}`;
        return `<button class="cl-faixa-chip${ativo}" data-faixa="${key}" style="--chip-cor:${cor}">
            <span class="cl-faixa-dot" style="background:${cor}"></span>${label}
            <span class="cl-faixa-num">${numLabel}</span>
        </button>`;
    };

    let filtrados = filtrosGrupoAtivos.has('todos')
        ? alunosResumo
        : filtrosGrupoAtivos.has('entrou')
            ? alunosResumo.filter(a => a.temEntrou)
            : alunosResumo.filter(a => filtrosGrupoAtivos.has(faixaCor(a.soma, meta)));

    /* ── Ordenação ── */
    if (sortState.col) {
        const mult = sortState.dir === 'asc' ? 1 : -1;
        filtrados = [...filtrados].sort((a, b) => {
            switch (sortState.col) {
                case 'aluno':     return mult * (a.aluno.nome || '').localeCompare(b.aluno.nome || '', 'pt-BR');
                case 'soma':      return mult * ((a.soma ?? 0) - (b.soma ?? 0));
                case 'rec':       return mult * ((a.recData?.soma ?? -1) - (b.recData?.soma ?? -1));
                case 'pendentes': return mult * ((a.pendentes ?? 0) - (b.pendentes ?? 0));
                default:          return 0;
            }
        });
    }

    /* Banner de fechamento de nota */
    const dataFechStr        = fmtDatetime(dataFechamento);
    const fechBannerHtml = dataFechamento
        ? `<div class="cl-rec-banner cl-rec-banner--fechamento">
               <span class="cl-rec-banner-icon">🔒</span>
               <div>
                   <div><strong>Notas fechadas</strong> em ${dataFechStr}</div>
                   <div class="cl-rec-banner-data">Entregas após o fechamento são registradas como tardias e não entram no cálculo.</div>
               </div>
           </div>`
        : '';

    /* Banner de grupo de recuperação / aviso de corte no grupo original */
    const dataInicioStr      = fmtDatetime(dataInicio);
    const dataCorteStr       = fmtDatetime(dataCorteOriginal);
    const recBannerHtml = isRec
        ? `<div class="cl-rec-banner">
               <span class="cl-rec-banner-icon">🔄</span>
               <div>
                   <div>Grupo de <strong>Recuperação</strong> — exibindo apenas alunos que entregaram após a data e horário de corte.</div>
                   ${dataInicioStr ? `<div class="cl-rec-banner-data">📅 A partir de <strong>${dataInicioStr}</strong></div>` : ''}
               </div>
           </div>`
        : dataCorteOriginal
        ? `<div class="cl-rec-banner cl-rec-banner--corte">
               <span class="cl-rec-banner-icon">🔒</span>
               <div>
                   <div><strong>Avaliação original protegida</strong> — entregas após o início da recuperação não alteram esta nota.</div>
                   <div class="cl-rec-banner-data">📅 Corte da recuperação: <strong>${dataCorteStr}</strong> &nbsp;·&nbsp; <span class="cl-rec-banner-hint">Entregas pós-corte mostradas com 🔄</span></div>
               </div>
           </div>`
        : '';

    /* ── Colunas visíveis (filtra 'rec' se grupo não tem recuperação) ── */
    const colsVisiveis = colOrder.filter(k => k !== 'rec' || hasRec);
    const gridTpl = ['36px', ...colsVisiveis.map(k => RESUMO_COLS[k].width)].join(' ');

    /* ── Rótulo dinâmico para coluna soma ── */
    const somaLabel = `Soma / ${rco(meta)} pts`;

    /* ── Header com drag + sort ── */
    const sortIcon = (col) => {
        if (sortState.col !== col) return `<span class="cl-sort-ico cl-sort-ico--none">⇅</span>`;
        return sortState.dir === 'asc'
            ? `<span class="cl-sort-ico cl-sort-ico--asc">↑</span>`
            : `<span class="cl-sort-ico cl-sort-ico--desc">↓</span>`;
    };

    const colLabels = { aluno: 'Aluno', soma: somaLabel, rec: 'Rec.', pendentes: 'Pendentes' };

    const headerCols = colsVisiveis.map(k =>
        `<span class="cl-col-header" data-col="${k}" draggable="true"
              title="Arrastar para reordenar · Clique para ordenar">
            ${colLabels[k]}${sortIcon(k)}
        </span>`
    ).join('');

    elNotasLista.innerHTML = `
        ${fechBannerHtml}
        ${recBannerHtml}
        <div id="clQuizizzPainel" style="display:none"></div>
        <div class="cl-passos-legenda">
            <span class="cl-legenda-item"><span class="cl-legenda-dot" style="background:#10b981"></span>Nota lançada</span>
            <span class="cl-legenda-item"><span class="cl-legenda-dot" style="background:#f97316"></span>Entrou (0 pts)</span>
            <span class="cl-legenda-item"><span class="cl-legenda-dot" style="background:#4285F4"></span>Entregue s/ nota</span>
            <span class="cl-legenda-item"><span class="cl-legenda-dot" style="background:var(--border)"></span>Pendente</span>
            ${fontes.length > 0 ? '<span class="cl-legenda-item"><span class="cl-legenda-sep">│</span>Fonte externa</span>' : ''}
            <span class="cl-legenda-hint">Clique no aluno para ver detalhes</span>
        </div>
        <div class="cl-faixa-filtros">
            ${chip('todos',   '#6b7280', 'Todos',        nTodos)}
            ${chip('meta',    '#10b981', 'Meta',          nMeta)}
            ${chip('prog',    '#4285F4', 'Em progresso',  nProg)}
            ${chip('abaixo',  '#f59e0b', 'Abaixo',       nAbaixo)}
            ${nEntrou > 0 ? chip('entrou', '#f97316', '↩ Entrou (0 pts)', nEntrou) : ''}
        </div>
        <div class="cl-resumo-header" style="grid-template-columns:${gridTpl}">
            <span></span>
            ${headerCols}
        </div>
        <div class="cl-faixa-lista" id="clFaixaLista">
            ${filtrados.length
                ? filtrados.map(a => renderResumoRow(a, meta, atividades, hasRec, colsVisiveis, gridTpl, fontes)).join('')
                : `<div class="cl-empty-state"><p>Nenhum aluno nessa faixa.</p></div>`}
        </div>`;

    // Chips → toggle
    elNotasLista.querySelectorAll('.cl-faixa-chip').forEach(btn => {
        btn.addEventListener('click', () => toggleFiltro(btn.dataset.faixa));
    });

    // Rows → detalhe do aluno
    elNotasLista.querySelectorAll('.cl-resumo-row').forEach((row, i) => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => mostrarDetalheAluno(filtrados[i], atividades, meta, fontes, subgrupos));
    });

    // Headers → drag-to-reorder + click-to-sort
    bindColHeaders(elNotasLista);

    // Renderiza painel Quizizz com dados já em cache (se houver)
    const painel = document.getElementById('clQuizizzPainel');
    if (painel) renderQuizizzPainel(atividades, painel);
}

function renderResumoRow(a, meta, atividades = [], hasRec = false, colsVisiveis = ['aluno','soma','pendentes'], gridTpl = '36px 1fr 100px 90px', fontes = []) {
    const al       = a.aluno;
    const iniciais = (al.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = al.foto ? `<img src="${esc(al.foto)}" alt="" loading="lazy"/>` : iniciais;
    const soma     = a.soma ?? 0;
    const pct      = meta > 0 ? Math.min(100, (soma / meta) * 100) : 0;
    const somaCor  = pct >= 100 ? '#10b981' : pct >= 60 ? '#4285F4' : '#f59e0b';

    const stepHtml = (atv, sub, prefixLabel = '') => {
        const nota   = sub?.nota ?? null;
        const ent    = sub?.entregue ?? false;
        const fezRec = sub?.fezRec ?? false;
        const entrou = nota === 0 && ent;
        const cor    = entrou             ? '#f97316'
                     : nota !== null      ? '#10b981'
                     : ent               ? '#4285F4'
                     : 'var(--border)';
        const label  = prefixLabel + (fezRec ? '🔄 Recuperação — ' : '')
            + (entrou
                ? `${atv.titulo}: Entrou (0 pts) — não realizou`
                : nota !== null
                    ? `${atv.titulo}: ${rco(nota)}${atv.pontos != null ? '/' + rco(atv.pontos) : ''} pts`
                    : ent ? `${atv.titulo}: Entregue` : `${atv.titulo}: Pendente`);
        return `<span class="cl-passo${entrou ? ' cl-passo--entrou' : ''}${fezRec ? ' cl-passo--rec' : ''}" style="background:${cor}" title="${esc(label)}"></span>`;
    };

    let stepsHtml = atividades.map(atv => stepHtml(atv, a.atividades?.[atv.id])).join('');

    if (fontes.length > 0) {
        for (const fonte of fontes) {
            if (!fonte.atividades?.length) continue;
            stepsHtml += `<span class="cl-passo-sep" title="Fonte: ${esc(fonte.nome)}">│</span>`;
            for (const fatv of fonte.atividades) {
                const key = `f_${fonte.fonteGrupoId}_${fatv.id}`;
                const sub = a.fontesAtividades?.[key] || null;
                stepsHtml += stepHtml(fatv, sub, `📥 ${fonte.nome} → `);
            }
        }
    }

    const numBadge = al.numChamada ? `<span class="cl-num-chamada">${al.numChamada}</span>` : '';

    const somaInt    = a.somaInterna ?? soma;
    const hasFontes  = fontes.length > 0;
    const pctInt     = meta > 0 ? Math.min(100, (somaInt / meta) * 100) : 0;
    const somaIntCor = pctInt >= 100 ? '#10b981' : pctInt >= 60 ? '#4285F4' : '#f59e0b';
    const fonteDiff  = hasFontes ? soma - somaInt : 0;

    /* Células indexadas por chave */
    const cells = {
        aluno: `<div class="cl-resumo-info">
            <div class="cl-nota-nome" title="${esc(al.email)}">${numBadge}${esc(al.nome || '—')}</div>
            <div class="cl-passos-barra">${stepsHtml || '<span class="cl-passos-vazia">—</span>'}</div>
        </div>`,
        soma: hasFontes
            ? `<div class="cl-resumo-soma cl-resumo-soma--dupla">
                <div class="cl-resumo-soma-linha">
                    <span class="cl-resumo-num" style="color:${somaIntCor}">${rco(somaInt)}</span>
                    <span class="cl-resumo-den">/${rco(meta)}</span>
                </div>
                <div class="cl-resumo-soma-total" title="Soma total (grupo + fontes externas)">
                    <span class="cl-resumo-total-icon">📥</span>
                    <span style="color:${somaCor}">${rco(soma)}</span>
                    ${fonteDiff > 0 ? `<span class="cl-resumo-fonte-add">+${rco(fonteDiff)}</span>` : ''}
                </div>
            </div>`
            : `<div class="cl-resumo-soma">
                <span class="cl-resumo-num" style="color:${somaCor}">${rco(soma)}</span>
                <span class="cl-resumo-den">/${rco(meta)}</span>
            </div>`,
        rec: hasRec
            ? (a.recData
                ? `<div style="text-align:center"><span class="cl-rec-nota-badge" title="Nota da recuperação">🔄 ${rco(a.recData.soma)}</span></div>`
                : `<div style="text-align:center"><span class="cl-rec-nota-badge cl-rec-nota-badge--vazio">—</span></div>`)
            : '',
        pendentes: `<div style="text-align:center">
            ${a.pendentes > 0
                ? `<span class="cl-nota-status-badge cl-nota-status--pendente">${a.pendentes} pend.</span>`
                : `<span class="cl-nota-status-badge cl-nota-status--entregue">✓</span>`}
        </div>`,
    };

    const cellsHtml = colsVisiveis.map(k => cells[k] || '').join('');

    return `<div class="cl-resumo-row" style="grid-template-columns:${gridTpl}">
        <div class="cl-nota-avatar">${fotoHtml}</div>
        ${cellsHtml}
    </div>`;
}

/* ── Drag-to-reorder + click-to-sort nos cabeçalhos de coluna ── */
function bindColHeaders(container) {
    const headers = Array.from(container.querySelectorAll('.cl-col-header[data-col]'));
    let dragSrc = null;

    headers.forEach(th => {
        /* Drag */
        th.addEventListener('dragstart', e => {
            dragSrc = th.dataset.col;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragSrc);
            th.classList.add('cl-col--dragging');
        });
        th.addEventListener('dragend', () => {
            th.classList.remove('cl-col--dragging');
            headers.forEach(h => h.classList.remove('cl-col--drag-over'));
        });
        th.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            headers.forEach(h => h.classList.remove('cl-col--drag-over'));
            if (th.dataset.col !== dragSrc) th.classList.add('cl-col--drag-over');
        });
        th.addEventListener('dragleave', () => th.classList.remove('cl-col--drag-over'));
        th.addEventListener('drop', e => {
            e.preventDefault();
            const target = th.dataset.col;
            if (dragSrc && dragSrc !== target) {
                const fromIdx = colOrder.indexOf(dragSrc);
                const toIdx   = colOrder.indexOf(target);
                if (fromIdx !== -1 && toIdx !== -1) {
                    colOrder.splice(fromIdx, 1);
                    colOrder.splice(toIdx, 0, dragSrc);
                    try { localStorage.setItem('cl-col-order', JSON.stringify(colOrder)); } catch (_) {}
                    renderListaFiltrada();
                }
            }
            dragSrc = null;
        });

        /* Sort ao clicar (não dispara se houve arraste) */
        th.addEventListener('click', () => {
            if (dragSrc) return; // estava arrastando
            const col = th.dataset.col;
            if (sortState.col === col) {
                sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            } else {
                sortState = { col, dir: 'asc' };
            }
            try { localStorage.setItem('cl-col-sort', JSON.stringify(sortState)); } catch (_) {}
            renderListaFiltrada();
        });
    });
}

function exportarGrupoCSV() {
    const curso = cursoAtivo?.nome || 'disciplina';
    let csv = `Disciplina,Grupo,Meta de pontos (RCO)\n"${curso}","${grupoAtivo?.nome || ''}","${grupoAtivo?.pontosMeta ? rco(grupoAtivo.pontosMeta) : ''}"\n\n`;
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

function imprimirRelatorioGrupo() {
    if (!grupoResumoData) return;
    const { alunosResumo, meta, atividades } = grupoResumoData;
    const curso    = cursoAtivo?.nome || '—';
    const grupo    = grupoAtivo?.nome || '—';
    const dataHoje = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });

    /* ── Nome do arquivo ao salvar em PDF: "Turma | Disciplina — Grupo" ───
       O navegador usa <title> do documento como nome padrão no diálogo de
       impressão / "Salvar como PDF". */
    const turmaPdf      = (cursoAtivo?.nome ? extrairTurma(cursoAtivo.nome) : null) || '';
    const disciplinaPdf = (cursoAtivo?.nome || '')
        .replace(/\s*[-–—]\s*\d+[ºo°]\s*Ano\s+[A-Z].*$/i, '') /* remove turma e tudo após */
        .trim();
    const tituloPdf = [turmaPdf, disciplinaPdf].filter(Boolean).join(' | ')
        + (grupo && grupo !== '—' ? ` — ${grupo}` : '');

    // Aplicar filtros ativos (pode ser múltiplos)
    const faixaNomeMap = { todos: 'Todos', meta: 'Meta atingida', prog: 'Em progresso', abaixo: 'Abaixo da meta' };
    const isTodos    = filtrosGrupoAtivos.has('todos');
    const filtroLabel = isTodos
        ? 'Todos'
        : [...filtrosGrupoAtivos].map(k => faixaNomeMap[k]).join(' + ');
    const lista = isTodos
        ? alunosResumo
        : alunosResumo.filter(a => filtrosGrupoAtivos.has(faixaCor(a.soma, meta)));

    // Estatísticas sobre a turma toda (para referência)
    const totalTurma = alunosResumo.length;
    const total   = lista.length;
    const nMeta   = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'meta').length;
    const nProg   = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'prog').length;
    const nAbaixo = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'abaixo').length;
    const media   = lista.length ? rco(lista.reduce((s, a) => s + (a.soma ?? 0), 0) / lista.length) : '—';
    const pMeta   = totalTurma ? Math.round((nMeta   / totalTurma) * 100) : 0;
    const pProg   = totalTurma ? Math.round((nProg   / totalTurma) * 100) : 0;
    const pAbaixo = totalTurma ? Math.round((nAbaixo / totalTurma) * 100) : 0;

    const faixaNome  = { meta: 'Meta atingida', prog: 'Em progresso', abaixo: 'Abaixo da meta' };
    const faixaCores = { meta: '#10b981',        prog: '#4285F4',      abaixo: '#f59e0b' };

    // Linhas da tabela — apenas alunos do filtro ativo
    const linhas = lista.map((a, i) => {
        const soma   = a.soma ?? 0;
        const pct    = meta > 0 ? Math.min(100, (soma / meta) * 100) : 0;
        const faixa  = faixaCor(soma, meta);
        const cor    = faixaCores[faixa];
        const fLabel = faixaNome[faixa];

        // Mini dots por atividade
        const dots = atividades.map(atv => {
            const sub  = a.atividades?.[atv.id];
            const nota = sub?.nota ?? null;
            const ent  = sub?.entregue ?? false;
            const c    = nota !== null ? '#10b981' : ent ? '#4285F4' : '#d1d5db';
            const t    = nota !== null ? `${atv.titulo}: ${rco(nota)}pts` : ent ? `${atv.titulo}: Entregue` : `${atv.titulo}: Pendente`;
            return `<span title="${t}" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin:1px"></span>`;
        }).join('');

        const numCh = a.aluno.numChamada ? `<span style="font-size:.65rem;font-weight:700;color:#9ca3af;background:#f3f4f6;border-radius:3px;padding:0 4px;margin-right:4px">${a.aluno.numChamada}</span>` : '';
        return `<tr>
            <td style="text-align:center;color:#6b7280">${i+1}</td>
            <td>${numCh}<strong>${esc(a.aluno.nome || '—')}</strong></td>
            <td style="text-align:center;font-weight:700;color:${cor}">${rco(soma)}</td>
            <td style="text-align:center">${pct.toFixed(0)}%</td>
            <td style="text-align:center">
                <span style="background:${cor}22;color:${cor};padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600;white-space:nowrap">${fLabel}</span>
            </td>
            <td style="text-align:center;color:${a.pendentes > 0 ? '#dc2626' : '#16a34a'}">${a.pendentes > 0 ? a.pendentes + ' pend.' : '✓'}</td>
            <td style="text-align:center">${dots}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head>
    <meta charset="UTF-8">
    <title>${esc(tituloPdf || 'Relatório — ' + grupo)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #111; padding: 24px; }
        @media print { body { padding: 0; } .no-print { display: none; } }
        h1 { font-size: 1.2rem; font-weight: 700; margin-bottom: 2px; }
        .sub { color: #6b7280; font-size: .8rem; margin-bottom: 16px; }
        .stats { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .stat { background: #f3f4f6; border-radius: 8px; padding: 10px 16px; text-align: center; min-width: 80px; }
        .stat-num { font-size: 1.4rem; font-weight: 800; display: block; }
        .stat-lbl { font-size: .68rem; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
        .dist { display: flex; border-radius: 8px; overflow: hidden; height: 28px; margin-bottom: 6px; }
        .dist-seg { display: flex; align-items: center; justify-content: center; font-size: .7rem; font-weight: 700; color: #fff; transition: width .3s; }
        .dist-leg { display: flex; gap: 16px; margin-bottom: 16px; }
        .dist-leg span { display: flex; align-items: center; gap: 4px; font-size: .75rem; color: #374151; }
        .dist-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #f3f4f6; padding: 6px 8px; text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
        td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #fafafa; }
        .footer { margin-top: 20px; font-size: .68rem; color: #9ca3af; text-align: right; }
        button.no-print { margin-bottom: 16px; padding: 8px 18px; background: #4285F4; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: .85rem; }
    </style></head><body>
    <button class="no-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
    <h1>${esc(grupo)}${!isTodos ? ` — ${filtroLabel}` : ''}</h1>
    <p class="sub">${esc(curso)} &nbsp;·&nbsp; Meta: ${rco(meta)} pts &nbsp;·&nbsp; Gerado em ${dataHoje}
    ${!isTodos ? `&nbsp;·&nbsp; <strong>${total} de ${totalTurma} alunos</strong> (filtro: ${filtroLabel})` : ''}</p>

    <div class="stats">
        <div class="stat"><span class="stat-num">${total}${!isTodos ? `<span style="font-size:.7rem;color:#6b7280">/${totalTurma}</span>` : ''}</span><span class="stat-lbl">Alunos${!isTodos ? ' (filtrados)' : ''}</span></div>
        <div class="stat"><span class="stat-num" style="color:#10b981">${nMeta}</span><span class="stat-lbl">Meta (${pMeta}%)</span></div>
        <div class="stat"><span class="stat-num" style="color:#4285F4">${nProg}</span><span class="stat-lbl">Progresso (${pProg}%)</span></div>
        <div class="stat"><span class="stat-num" style="color:#f59e0b">${nAbaixo}</span><span class="stat-lbl">Abaixo (${pAbaixo}%)</span></div>
        <div class="stat"><span class="stat-num" style="color:#4285F4">${media}</span><span class="stat-lbl">Média ${!isTodos ? 'filtro' : 'geral'}</span></div>
    </div>

    <div class="dist">
        ${nMeta   > 0 ? `<div class="dist-seg" style="width:${pMeta}%;background:#10b981">${pMeta > 8 ? pMeta + '%' : ''}</div>` : ''}
        ${nProg   > 0 ? `<div class="dist-seg" style="width:${pProg}%;background:#4285F4">${pProg > 8 ? pProg + '%' : ''}</div>` : ''}
        ${nAbaixo > 0 ? `<div class="dist-seg" style="width:${pAbaixo}%;background:#f59e0b">${pAbaixo > 8 ? pAbaixo + '%' : ''}</div>` : ''}
        ${total === 0 ? `<div class="dist-seg" style="width:100%;background:#e5e7eb"></div>` : ''}
    </div>
    <div class="dist-leg">
        <span><span class="dist-dot" style="background:#10b981"></span>Meta atingida</span>
        <span><span class="dist-dot" style="background:#4285F4"></span>Em progresso (60–99%)</span>
        <span><span class="dist-dot" style="background:#f59e0b"></span>Abaixo da meta (&lt;60%)</span>
    </div>

    <table>
        <thead><tr>
            <th style="width:30px">#</th>
            <th>Aluno</th>
            <th style="width:60px;text-align:center">Soma</th>
            <th style="width:45px;text-align:center">%</th>
            <th style="width:120px;text-align:center">Faixa</th>
            <th style="width:65px;text-align:center">Pendentes</th>
            <th style="text-align:center">Atividades</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
    </table>

    <div class="footer">EduSync &nbsp;·&nbsp; ${dataHoje}</div>
    </body></html>`;

    const win = window.open('', '_blank');
    if (!win) { toast('Permite pop-ups para imprimir.', 'erro'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
}

/* ══════════════════════════════════════════════════════════════
   DETALHE DO ALUNO NO GRUPO
══════════════════════════════════════════════════════════════ */
function mostrarDetalheAluno(alunoData, atividades, meta, fontes = [], subgrupos = []) {
    alunoDetalheAberto = alunoData.userId;
    const al      = alunoData.aluno;
    const iniciais = (al.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = al.foto ? `<img src="${esc(al.foto)}" alt="" loading="lazy"/>` : iniciais;
    const soma     = alunoData.soma ?? 0;
    const somaInt  = alunoData.somaInterna ?? soma;
    const somaPrev = alunoData.somaPrevista ?? soma;
    const pct      = meta > 0 ? Math.min(100, (soma / meta) * 100) : 0;
    const pctInt   = meta > 0 ? Math.min(100, (somaInt / meta) * 100) : 0;
    const pctPrev  = meta > 0 ? Math.min(100, (somaPrev / meta) * 100) : 0;
    const barCor     = pct    >= 100 ? '#10b981' : pct    >= 60 ? '#4285F4' : '#f59e0b';
    const somaIntCor = pctInt >= 100 ? '#10b981' : pctInt >= 60 ? '#4285F4' : '#f59e0b';
    /* Diferença entre oficial e previsto = soma de rascunhos pendentes de devolução.
       Tolerância pequena para evitar mostrar "+0,0" por arredondamento de ponto flutuante. */
    const deltaRascunho = somaPrev - soma;
    const temRascunho   = deltaRascunho > 0.05;

    // Preparar linhas de atividade
    const rows = atividades.map(atv => {
        const sub      = alunoData.atividades?.[atv.id];
        const nota     = sub?.nota ?? null;
        const notaRasc = sub?.notaRascunho ?? null;
        const entregue = sub?.entregue ?? false;
        const atrasado = sub?.atrasado ?? false;
        const estado   = sub?.estado ?? null;

        let statusHtml, tipo;
        const notaEfetiva = nota ?? notaRasc;
        const entrou = notaEfetiva === 0 && entregue;

        if (entrou) {
            const ptMax = atv.pontos ?? 100;
            statusHtml  = `<span class="cl-nota-status-badge cl-nota-status--entrou">↩ Entrou (0 / ${rco(ptMax)} pts)</span>`;
            tipo        = 'entrou';
        } else if (notaEfetiva !== null) {
            const ptMax  = atv.pontos ?? 100;
            const pctAtv = ptMax > 0 ? ((notaEfetiva / ptMax) * 100).toFixed(0) : notaEfetiva;
            const ehRasc = nota === null && notaRasc !== null;
            if (ehRasc) {
                statusHtml = `<span class="cl-nota-status-badge cl-nota-status--rasc" title="Nota em rascunho — devolva no Classroom para entrar no cálculo oficial">📝 ${rco(notaEfetiva)} / ${rco(ptMax)} pts &nbsp;(${pctAtv}%) — rascunho</span>`;
            } else {
                statusHtml = `<span class="cl-nota-status-badge cl-nota-status--entregue">${rco(notaEfetiva)} / ${rco(ptMax)} pts &nbsp;(${pctAtv}%)</span>`;
            }
            tipo = 'realizada';
        } else if (entregue) {
            statusHtml = `<span class="cl-nota-status-badge cl-nota-status--aguard">⏳ Realizou — aguardando correção</span>`;
            tipo = 'realizada';
        } else if (atrasado) {
            statusHtml = `<span class="cl-nota-status-badge" style="background:#fff3e0;color:#c05621">Atrasado</span>`;
            tipo = 'nao-realizada';
        } else if (estado) {
            statusHtml = `<span class="cl-nota-status-badge" style="background:#fef2f2;color:#dc2626">Não entregue</span>`;
            tipo = 'nao-realizada';
        } else {
            statusHtml = `<span class="cl-nota-status-badge" style="background:var(--bg-alt);color:var(--text-muted)">Sem dados</span>`;
            tipo = 'nao-realizada';
        }

        /* ── Bloco Quizizz (somente para atividades detectadas como Quizizz) ── */
        let quizizzHtml = '';
        if (atv.quizizzId) {
            const qzId  = /^[0-9a-f]{24}$/i.test(atv.quizizzId) ? atv.quizizzId : null;
            const qzDat = qzId ? quizizzCache[qzId] : null;
            const qzLink = qzId ? `https://quizizz.com/admin/quiz/${qzId}` : null;

            /* Status do aluno neste quiz */
            let qzStatusTxt, qzStatusCls;
            if (entrou) {
                qzStatusTxt = '↩ Entrou no jogo mas saiu sem realizar — ficou com 0 pts';
                qzStatusCls = 'cl-qz-status--entrou';
            } else if (notaEfetiva !== null && notaEfetiva > 0) {
                const ptMax = atv.pontos ?? 0;
                const pctQ  = ptMax > 0 ? ` (${((notaEfetiva / ptMax) * 100).toFixed(0)}%)` : '';
                qzStatusTxt = `✓ Realizou — nota no Quizizz: ${rco(notaEfetiva)} pts${pctQ}`;
                qzStatusCls = 'cl-qz-status--ok';
            } else if (notaEfetiva === 0 && !entregue) {
                qzStatusTxt = '✗ Não realizou o quiz';
                qzStatusCls = 'cl-qz-status--nao';
            } else if (entregue) {
                qzStatusTxt = '⏳ Realizou — aguardando correção';
                qzStatusCls = 'cl-qz-status--aguard';
            } else {
                qzStatusTxt = '✗ Não realizou o quiz';
                qzStatusCls = 'cl-qz-status--nao';
            }

            quizizzHtml = `
            <div class="cl-detalhe-qz-tag">
                <span class="cl-detalhe-qz-ico">🎮</span>
                <span class="cl-detalhe-qz-label">Quizizz</span>
                ${qzDat ? `<span class="cl-detalhe-qz-nome">${esc(qzDat.titulo)}</span><span class="cl-detalhe-qz-questoes">${qzDat.totalQ}q</span>` : ''}
                <span class="cl-detalhe-qz-status ${qzStatusCls}">${qzStatusTxt}</span>
                ${qzLink ? `<a class="cl-detalhe-qz-link" href="${qzLink}" target="_blank" rel="noopener">Ver quiz ↗</a>` : ''}
            </div>`;
        }

        return { atv, statusHtml, tipo, nota, entregue, quizizzHtml };
    });

    const totalAtiv     = atividades.length;
    const realizadas    = rows.filter(r => r.tipo === 'realizada').length;
    const naoRealizadas = rows.filter(r => r.tipo === 'nao-realizada').length;
    const entrarEm      = rows.filter(r => r.tipo === 'entrou').length;

    /* Mapa de courseworkId → solicitação pendente para este aluno */
    const solicitaSet = new Set(
        solicitacoesCache
            .filter(s => s.aluno_email === al.email && s.status === 'pendente')
            .map(s => s.coursework_id)
    );

    const rowsHtml = rows.map(r => {
        const temSolicita = al.email && solicitaSet.has(String(r.atv.id));
        const solicitaBadge = temSolicita
            ? `<span class="cl-sol-inline-badge">↩ Reabertura solicitada</span>` : '';
        return `
        <div class="cl-detalhe-row" data-tipo="${r.tipo}">
            <div class="cl-detalhe-row-titulo">
                ${esc(r.atv.titulo)}
                ${solicitaBadge}
                ${r.quizizzHtml}
            </div>
            <div class="cl-detalhe-row-status">${r.statusHtml}</div>
        </div>`;
    }).join('');

    let fontesHtml = '';
    let fonteRealizadas = 0, fonteNaoRealizadas = 0, fonteEntrou = 0;
    if (fontes.length > 0) {
        for (const fonte of fontes) {
            if (!fonte.atividades?.length) continue;
            const pesoLabel = fonte.peso !== 100 ? ` (peso ${fonte.peso}%)` : '';
            let fonteRows = '';
            for (const fatv of fonte.atividades) {
                const key = `f_${fonte.fonteGrupoId}_${fatv.id}`;
                const sub = alunoData.fontesAtividades?.[key];
                const nota = sub?.nota ?? null;
                const entregue = sub?.entregue ?? false;
                const entrou = nota === 0 && entregue;

                let statusHtml, tipo;
                if (entrou) {
                    statusHtml = `<span class="cl-nota-status-badge cl-nota-status--entrou">↩ Entrou (0 / ${rco(fatv.pontos)} pts)</span>`;
                    tipo = 'entrou';
                    fonteEntrou++;
                } else if (nota !== null) {
                    const pctAtv = fatv.pontos > 0 ? ((nota / fatv.pontos) * 100).toFixed(0) : nota;
                    statusHtml = `<span class="cl-nota-status-badge cl-nota-status--entregue">${rco(nota)} / ${rco(fatv.pontos)} pts &nbsp;(${pctAtv}%)</span>`;
                    tipo = 'realizada';
                    fonteRealizadas++;
                } else if (entregue) {
                    statusHtml = `<span class="cl-nota-status-badge cl-nota-status--aguard">⏳ Realizou — aguardando correção</span>`;
                    tipo = 'realizada';
                    fonteRealizadas++;
                } else {
                    statusHtml = `<span class="cl-nota-status-badge" style="background:var(--bg-alt);color:var(--text-muted)">Pendente</span>`;
                    tipo = 'nao-realizada';
                    fonteNaoRealizadas++;
                }

                fonteRows += `
                <div class="cl-detalhe-row cl-detalhe-row--fonte" data-tipo="${tipo}">
                    <div class="cl-detalhe-row-titulo">${esc(fatv.titulo)}</div>
                    <div class="cl-detalhe-row-status">${statusHtml}</div>
                </div>`;
            }
            fontesHtml += `
            <div class="cl-detalhe-fonte-section">
                <div class="cl-detalhe-fonte-header">
                    <span class="cl-detalhe-fonte-ico">📥</span>
                    <span class="cl-detalhe-fonte-nome">${esc(fonte.nome)}${pesoLabel}</span>
                    <span class="cl-detalhe-fonte-pts">${rco(fonte.pontosMax)} pts</span>
                </div>
                ${fonteRows}
            </div>`;
        }
    }

    /* ── Bloco SUBGRUPOS — atividades dos grupos-filho cujas notas SOMAM neste grupo.
       Renderizado em uma seção por subgrupo, com cabeçalho mostrando nome, pts máx
       e a soma das notas do aluno naquele subgrupo. */
    let subgruposHtml = '';
    let subRealizadas = 0, subNaoRealizadas = 0, subEntrou = 0, totalSubAtivs = 0;
    if (subgrupos.length > 0) {
        for (const sub of subgrupos) {
            if (!sub.atividades?.length) continue;
            totalSubAtivs += sub.atividades.length;
            let subRows = '';
            let somaSub = 0;
            for (const satv of sub.atividades) {
                const key   = `s_${sub.id}_${satv.id}`;
                const subm  = alunoData.subgruposAtividades?.[key];
                const nota  = subm?.nota ?? null;
                const rasc  = subm?.notaRascunho ?? null;
                const entregue = subm?.entregue ?? false;
                const notaEf  = nota ?? rasc;
                const entrou  = notaEf === 0 && entregue;
                const ptMax   = satv.pontos ?? 0;

                let statusHtml, tipo;
                if (entrou) {
                    statusHtml = `<span class="cl-nota-status-badge cl-nota-status--entrou">↩ Entrou (0 / ${rco(ptMax)} pts)</span>`;
                    tipo = 'entrou'; subEntrou++;
                } else if (notaEf !== null) {
                    const pctAtv = ptMax > 0 ? ((notaEf / ptMax) * 100).toFixed(0) : notaEf;
                    const ehRasc = nota === null && rasc !== null;
                    if (ehRasc) {
                        statusHtml = `<span class="cl-nota-status-badge cl-nota-status--rasc" title="Nota em rascunho — devolva no Classroom para entrar no cálculo oficial">📝 ${rco(notaEf)} / ${rco(ptMax)} pts &nbsp;(${pctAtv}%) — rascunho</span>`;
                    } else {
                        statusHtml = `<span class="cl-nota-status-badge cl-nota-status--entregue">${rco(notaEf)} / ${rco(ptMax)} pts &nbsp;(${pctAtv}%)</span>`;
                    }
                    tipo = 'realizada'; subRealizadas++;
                    /* Soma do subgrupo SEMPRE usa nota oficial (nota), nunca rascunho —
                       coerente com totalGanho do backend. */
                    if (nota !== null) somaSub += Math.min(nota, ptMax);
                } else if (entregue) {
                    statusHtml = `<span class="cl-nota-status-badge cl-nota-status--aguard">⏳ Realizou — aguardando correção</span>`;
                    tipo = 'realizada'; subRealizadas++;
                } else {
                    statusHtml = `<span class="cl-nota-status-badge" style="background:var(--bg-alt);color:var(--text-muted)">Pendente</span>`;
                    tipo = 'nao-realizada'; subNaoRealizadas++;
                }

                subRows += `
                <div class="cl-detalhe-row cl-detalhe-row--fonte" data-tipo="${tipo}">
                    <div class="cl-detalhe-row-titulo">${esc(satv.titulo)}</div>
                    <div class="cl-detalhe-row-status">${statusHtml}</div>
                </div>`;
            }
            const somaCor = somaSub >= sub.pontosMax ? '#10b981' : somaSub > 0 ? '#4285F4' : '#94a3b8';
            subgruposHtml += `
            <div class="cl-detalhe-fonte-section">
                <div class="cl-detalhe-fonte-header">
                    <span class="cl-detalhe-fonte-ico">↑</span>
                    <span class="cl-detalhe-fonte-nome">Subgrupo: ${esc(sub.nome)}</span>
                    <span class="cl-detalhe-fonte-pts" style="color:${somaCor}">
                        ${rco(somaSub)} / ${rco(sub.pontosMax)} pts
                    </span>
                </div>
                ${subRows}
            </div>`;
        }
    }

    const totalRealizadas    = realizadas + fonteRealizadas + subRealizadas;
    const totalNaoRealizadas = naoRealizadas + fonteNaoRealizadas + subNaoRealizadas;
    const totalEntrou        = entrarEm + fonteEntrou + subEntrou;
    const totalFonteAtivs    = fontes.reduce((s, f) => s + (f.atividades?.length || 0), 0);
    const totalGeral         = totalAtiv + totalFonteAtivs + totalSubAtivs;

    elNotasLista.innerHTML = `
        <div class="cl-detalhe-header">
            <button class="cl-btn cl-btn--ghost cl-detalhe-voltar" id="clDetalheVoltar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
                Voltar
            </button>
            <div class="cl-detalhe-aluno-info">
                <div class="cl-nota-avatar cl-nota-avatar--lg">${fotoHtml}</div>
                <div>
                    <div class="cl-nota-nome">${esc(al.nome || '—')}</div>
                    ${fontes.length > 0
                        ? `<div class="cl-detalhe-soma" style="color:${somaIntCor}">
                            Grupo: ${rco(somaInt)} / ${rco(meta)} pts
                            <span class="cl-detalhe-pct">(${pctInt.toFixed(0)}%)</span>
                        </div>
                        <div class="cl-detalhe-soma cl-detalhe-soma--total" style="color:${barCor}">
                            📥 Total: ${rco(soma)} / ${rco(meta)} pts (oficial)
                            <span class="cl-detalhe-pct">(${pct.toFixed(0)}%)</span>
                        </div>`
                        : `<div class="cl-detalhe-soma" style="color:${barCor}">
                            ${rco(soma)} / ${rco(meta)} pts (oficial)
                            <span class="cl-detalhe-pct">(${pct.toFixed(0)}%)</span>
                        </div>`
                    }
                    ${temRascunho ? `
                    <div class="cl-detalhe-soma cl-detalhe-soma--rasc"
                         title="Inclui notas em rascunho que ainda não foram devolvidas no Classroom">
                        📝 Previsto com rascunhos: ${rco(somaPrev)} / ${rco(meta)} pts
                        <span class="cl-detalhe-pct">(${pctPrev.toFixed(0)}%)</span>
                        <span class="cl-detalhe-rasc-delta">+${rco(deltaRascunho)} pendente${deltaRascunho >= 0.95 ? 's' : ''} de devolução</span>
                    </div>` : ''}
                </div>
            </div>
        </div>

        <div class="cl-detalhe-tabs">
            <button class="cl-detalhe-tab cl-detalhe-tab--ativa" data-filtro="todas">
                Todas <span class="cl-detalhe-tab-cnt">${totalGeral}</span>
            </button>
            <button class="cl-detalhe-tab" data-filtro="realizada">
                Realizadas <span class="cl-detalhe-tab-cnt cl-tab-cnt--ok">${totalRealizadas}</span>
            </button>
            ${totalEntrou > 0 ? `
            <button class="cl-detalhe-tab" data-filtro="entrou">
                Entrou (0 pts) <span class="cl-detalhe-tab-cnt cl-tab-cnt--entrou">${totalEntrou}</span>
            </button>` : ''}
            <button class="cl-detalhe-tab" data-filtro="nao-realizada">
                Não realizadas <span class="cl-detalhe-tab-cnt cl-tab-cnt--err">${totalNaoRealizadas}</span>
            </button>
        </div>

        <div class="cl-detalhe-lista" id="clDetalheLista">
            ${rowsHtml}
            ${fontesHtml}
            ${subgruposHtml}
        </div>`;

    // Tabs de filtro
    elNotasLista.querySelectorAll('.cl-detalhe-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            elNotasLista.querySelectorAll('.cl-detalhe-tab').forEach(b => b.classList.remove('cl-detalhe-tab--ativa'));
            btn.classList.add('cl-detalhe-tab--ativa');
            const filtro = btn.dataset.filtro;
            elNotasLista.querySelectorAll('.cl-detalhe-row').forEach(row => {
                row.style.display = filtro === 'todas' || row.dataset.tipo === filtro ? '' : 'none';
            });
            elNotasLista.querySelectorAll('.cl-detalhe-fonte-section').forEach(sec => {
                const visibleRows = sec.querySelectorAll('.cl-detalhe-row:not([style*="display: none"])');
                sec.style.display = filtro === 'todas' || visibleRows.length > 0 ? '' : 'none';
            });
        });
    });

    // Voltar
    document.getElementById('clDetalheVoltar').addEventListener('click', () => {
        alunoDetalheAberto = null;
        if (grupoAtivo) selecionarGrupo(grupoAtivo, document.querySelector('.cl-grupo-item--ativo'));
    });
}

/* Re-renderiza o detalhe do aluno aberto usando os dados frescos do grupoResumoData.
   Usado após editar o grupo (adicionar/remover atividade) sem precisar voltar para a lista. */
function refrescarDetalheAlunoAberto() {
    if (!alunoDetalheAberto || !grupoResumoData?.alunosResumo) return;
    const novo = grupoResumoData.alunosResumo.find(a => a.userId === alunoDetalheAberto);
    if (!novo) {
        /* Aluno sumiu do resumo (improvável) → volta para a lista */
        alunoDetalheAberto = null;
        renderListaFiltrada();
        return;
    }
    mostrarDetalheAluno(novo, grupoResumoData.atividades, grupoResumoData.meta, grupoResumoData.fontes || [], grupoResumoData.subgrupos || []);
}

/* ══════════════════════════════════════════════════════════════
   MODAL DE GRUPO
══════════════════════════════════════════════════════════════ */
const elModal            = document.getElementById('clGrupoModal');
const elModalTitulo      = document.getElementById('clGrupoModalTitulo');
const elGrupoId          = document.getElementById('clGrupoId');
const elGrupoNome        = document.getElementById('clGrupoNome');
const elGrupoPontos      = document.getElementById('clGrupoPontos');
const elGrupoCodClasseRco= document.getElementById('clGrupoCodClasseRco');
const elBtnBuscarClasse  = document.getElementById('clBtnBuscarClasse');
const elCorPicker        = document.getElementById('clCorPicker');
const elModalAtivs       = document.getElementById('clModalAtividades');
const elTipoGrupo        = document.getElementById('clTipoGrupo');
const elRecOrigemWrap    = document.getElementById('clRecOrigemWrap');
const elRecOrigemSel     = document.getElementById('clRecOrigemSel');
const elGrupoPaiWrap     = document.getElementById('clGrupoPaiWrap');
const elGrupoPaiSel      = document.getElementById('clGrupoPaiSel');
const elRecDataInicio    = document.getElementById('clRecDataInicio');

/* ── Campo de código RCO: bloqueia/desbloqueia conforme tipo do grupo ──
   Grupos de recuperação herdam o código do grupo pai — campo somente consulta. */
let _campoCodBloqueado = false;

function configurarCampoCodClasse(isRec, grupoOrigemId = null) {
    _campoCodBloqueado = isRec;

    if (!isRec) {
        /* Grupo normal — totalmente editável */
        elGrupoCodClasseRco.disabled = false;
        elGrupoCodClasseRco.classList.remove('cl-input--herdado');
        elBtnBuscarClasse.style.display = '';
        return;
    }

    /* Grupo de recuperação — herda código do pai, campo apenas consulta */
    const origem = gruposCache.find(g => String(g.id) === String(grupoOrigemId));
    const codPai = origem?.codClasseRco ?? null;

    /* Substitui valor apenas se o pai tiver código definido */
    if (codPai) elGrupoCodClasseRco.value = String(codPai);

    /* Desabilita o campo e esconde o botão */
    elGrupoCodClasseRco.disabled = true;
    elGrupoCodClasseRco.classList.add('cl-input--herdado');
    elBtnBuscarClasse.style.display = 'none';

    /* Exibe info da classe vinculada se disponível no cache */
    const cod = elGrupoCodClasseRco.value;
    if (cod && _classesRcoCache) {
        const c = _classesRcoCache.find(x => String(x.codClasse) === String(cod));
        if (c) mostrarInfoClasseRco(c);
    }
}

/* ── Lógica dos botões de tipo ── */
elTipoGrupo.addEventListener('click', e => {
    const btn = e.target.closest('.cl-tipo-btn');
    if (!btn) return;
    elTipoGrupo.querySelectorAll('.cl-tipo-btn').forEach(b => b.classList.remove('cl-tipo-btn--ativo'));
    btn.classList.add('cl-tipo-btn--ativo');
    const isRec = btn.dataset.tipo === 'recuperacao';
    elRecOrigemWrap.style.display = isRec ? '' : 'none';
    /* Subgrupo só faz sentido em grupos normais (rec já tem grupo de origem). */
    elGrupoPaiWrap.style.display  = isRec ? 'none' : '';
    configurarCampoCodClasse(isRec, elRecOrigemSel.value || null);
});

/* Pré-seleciona no modal as atividades do grupo de origem informado */
function preencherAtividadesDoGrupoPai(grupoOrigemId) {
    if (!grupoOrigemId) return;
    const pai = gruposCache.find(g => String(g.id) === String(grupoOrigemId));
    if (!pai?.atividades?.length) return;
    const idsPai = new Set(pai.atividades.map(a => String(a.atividade_id)));
    elModalAtivs.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.checked = idsPai.has(String(cb.value));
    });
}

/* Ao trocar o grupo de origem, herda código e atividades imediatamente */
elRecOrigemSel.addEventListener('change', () => {
    if (tipoModalAtivo() === 'recuperacao') {
        configurarCampoCodClasse(true, elRecOrigemSel.value || null);
        preencherAtividadesDoGrupoPai(elRecOrigemSel.value);
    }
});

function tipoModalAtivo() {
    return elTipoGrupo.querySelector('.cl-tipo-btn--ativo')?.dataset.tipo || 'normal';
}

/* Popula o select de "grupo pai" (subgrupo). Filtros aplicados:
   - Mesmo trimestre/ano do grupo sendo editado (ou padrão do modal)
   - Apenas grupos NORMAIS
   - Exclui o próprio grupo
   - Exclui grupos que já são subgrupos (preserva profundidade 1)
   - Se este grupo já tem subgrupos, oculta tudo (não pode virar subgrupo) */
let grupoModalAtual = null;

function popularGrupoPaiSelect(grupoAtual = null) {
    if (!elGrupoPaiSel) return;
    const trim = Number(elGrupoTrimestre.value) || (grupoAtual?.trimestre || 1);
    const ano  = Number(elGrupoAno.value)       || (grupoAtual?.ano       || new Date().getFullYear());
    elGrupoPaiSel.innerHTML = '<option value="">— este grupo é independente —</option>';

    /* Bloqueia se este grupo já tem subgrupos (depth=1) */
    if (grupoAtual) {
        const temFilhos = gruposCache.some(g => Number(g.grupoPaiId) === Number(grupoAtual.id));
        if (temFilhos) {
            const opt = document.createElement('option');
            opt.value = ''; opt.disabled = true;
            opt.textContent = 'Este grupo já tem subgrupos — não pode ser subgrupo';
            elGrupoPaiSel.appendChild(opt);
            elGrupoPaiSel.value = '';
            elGrupoPaiSel.disabled = true;
            return;
        }
    }
    elGrupoPaiSel.disabled = false;

    /* Pai pode ser Normal OU Recuperação (a nota do filho completa a nota do pai
       em ambos os casos). Mesmo período + não-self + não-já-filho. */
    const elegiveis = gruposCache.filter(g =>
        (g.trimestre || 1) === trim
        && (g.ano || new Date().getFullYear()) === ano
        && !g.grupoPaiId                                // não pode ser pai se já é filho
        && (!grupoAtual || g.id !== grupoAtual.id)      // não pode ser pai de si mesmo
    );

    if (!elegiveis.length) {
        const opt = document.createElement('option');
        opt.value = ''; opt.disabled = true;
        opt.textContent = `Nenhum grupo disponível em ${trim}º Trimestre · ${ano}`;
        elGrupoPaiSel.appendChild(opt);
    } else {
        /* Ordena: Normais primeiro, depois Recuperações (visualmente agrupado). */
        const normais = elegiveis.filter(g => g.tipo === 'normal');
        const recs    = elegiveis.filter(g => g.tipo === 'recuperacao');
        normais.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.nome + ` (${rco(g.pontosMeta)} pts)`;
            elGrupoPaiSel.appendChild(opt);
        });
        if (recs.length) {
            if (normais.length) {
                const sep = document.createElement('option');
                sep.disabled = true; sep.value = '';
                sep.textContent = '──── Recuperações ────';
                elGrupoPaiSel.appendChild(sep);
            }
            recs.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = `🔄 ${g.nome} (${rco(g.pontosMeta)} pts)`;
                elGrupoPaiSel.appendChild(opt);
            });
        }
    }

    if (grupoAtual?.grupoPaiId) {
        /* Se o pai atual está num período diferente (raro — só por dado legado),
           injeta opção avulsa para que o usuário enxergue o vínculo atual. */
        if (!elegiveis.some(g => Number(g.id) === Number(grupoAtual.grupoPaiId))) {
            const pai = gruposCache.find(g => Number(g.id) === Number(grupoAtual.grupoPaiId));
            if (pai) {
                const opt = document.createElement('option');
                opt.value = pai.id;
                opt.textContent = `${pai.nome} (${pai.trimestre}º/${pai.ano} — vínculo atual)`;
                elGrupoPaiSel.appendChild(opt);
            }
        }
        elGrupoPaiSel.value = String(grupoAtual.grupoPaiId);
    }
}

/* Repopula o select de subgrupo quando trimestre/ano mudam dentro do modal,
   pois os elegíveis são filtrados pelo período atualmente selecionado. */
['change', 'input'].forEach(ev => {
    elGrupoTrimestre?.addEventListener(ev, () => popularGrupoPaiSelect(grupoModalAtual));
    elGrupoAno?.addEventListener(ev,       () => popularGrupoPaiSelect(grupoModalAtual));
});

function popularRecOrigem(grupoIdAtual = null) {
    elRecOrigemSel.innerHTML = '<option value="">— selecione o grupo de origem —</option>';
    gruposCache
        .filter(g => g.tipo !== 'recuperacao' && String(g.id) !== String(grupoIdAtual))
        .forEach(g => {
            const opt = document.createElement('option');
            opt.value       = g.id;
            opt.textContent = g.nome;
            elRecOrigemSel.appendChild(opt);
        });
}

function abrirModalGrupo(grupo = null) {
    elCorPicker.innerHTML = '';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'cl-cor-input';
    colorInput.value = corSelecionada;
    colorInput.addEventListener('input', () => {
        corSelecionada = colorInput.value;
        elCorPicker.querySelectorAll('.cl-cor-btn').forEach(b => b.classList.remove('cl-cor-btn--ativo'));
    });
    elCorPicker.appendChild(colorInput);
    GRUPO_CORES.forEach(cor => {
        const btn = document.createElement('button');
        btn.className = 'cl-cor-btn';
        btn.style.background = cor;
        btn.title    = cor;
        btn.type     = 'button';
        btn.addEventListener('click', () => {
            corSelecionada = cor;
            colorInput.value = cor;
            elCorPicker.querySelectorAll('.cl-cor-btn').forEach(b => b.classList.remove('cl-cor-btn--ativo'));
            btn.classList.add('cl-cor-btn--ativo');
        });
        elCorPicker.appendChild(btn);
    });

    /* Tipo do grupo */
    const tipo = grupo?.tipo || 'normal';
    elTipoGrupo.querySelectorAll('.cl-tipo-btn').forEach(b => {
        b.classList.toggle('cl-tipo-btn--ativo', b.dataset.tipo === tipo);
    });
    popularRecOrigem(grupo?.id);
    elRecOrigemWrap.style.display = tipo === 'recuperacao' ? '' : 'none';
    elGrupoPaiWrap.style.display  = tipo === 'recuperacao' ? 'none' : '';
    if (grupo?.grupoOrigemId) elRecOrigemSel.value = grupo.grupoOrigemId;
    elRecDataInicio.value = toDatetimeLocal(grupo?.dataInicio);

    /* Trimestre/ano: edição usa do grupo; novo usa o mais recente entre os grupos do curso (ou ano atual / T1) */
    const anoAtual = new Date().getFullYear();
    let trimDefault = 1, anoDefault = anoAtual;
    if (gruposCache.length) {
        const top = gruposCache[0]; // já ordenado por mais recente
        trimDefault = top.trimestre || 1;
        anoDefault  = top.ano || anoAtual;
    }

    if (grupo) {
        elModalTitulo.textContent    = 'Editar Grupo';
        elGrupoId.value              = grupo.id;
        elGrupoNome.value            = grupo.nome;
        elGrupoPontos.value          = (grupo.pontosMeta / 10).toFixed(1);
        elGrupoCodClasseRco.value    = grupo.codClasseRco || '';
        elGrupoTrimestre.value       = String(grupo.trimestre || trimDefault);
        elGrupoAno.value             = String(grupo.ano || anoDefault);
        corSelecionada               = grupo.cor;
        elClasseRcoInfo.style.display = 'none';
    } else {
        elModalTitulo.textContent    = 'Novo Grupo';
        elGrupoId.value              = '';
        elGrupoNome.value            = '';
        elGrupoPontos.value          = 4;
        elGrupoCodClasseRco.value    = '';
        elGrupoTrimestre.value       = String(trimDefault);
        elGrupoAno.value             = String(anoDefault);
        elClasseRcoInfo.style.display = 'none';
        corSelecionada               = GRUPO_CORES[gruposCache.length % GRUPO_CORES.length];
    }

    /* Popula o select de subgrupo APÓS trimestre/ano estarem definidos
       (o filtro depende desses valores). Guarda referência para repopular
       quando o usuário trocar trimestre/ano dentro do modal. */
    popularGrupoPaiSelect(grupo);
    grupoModalAtual = grupo;

    /* Configura campo de código RCO conforme tipo (herda e bloqueia se for recuperação) */
    configurarCampoCodClasse(tipo === 'recuperacao', grupo?.grupoOrigemId ?? null);

    const corInp = elCorPicker.querySelector('.cl-cor-input');
    if (corInp) corInp.value = corSelecionada;
    elCorPicker.querySelectorAll('.cl-cor-btn').forEach(b => {
        b.classList.toggle('cl-cor-btn--ativo', b.style.background === corSelecionada ||
            b.title === corSelecionada);
    });

    const ativsNoGrupo = new Set((grupo?.atividades || []).map(a => a.atividade_id));
    // pontos_max salvo no banco para cada atividade do grupo (pode diferir do maxPoints do Classroom)
    const pontosNoGrupo = {};
    (grupo?.atividades || []).forEach(a => { pontosNoGrupo[a.atividade_id] = a.pontos_max; });

    /* Atividades vinculadas em OUTROS grupos (qualquer trimestre/ano) — devem
       ficar fora da lista, pois o usuário só pode adicionar órfãs ou manter
       as que já pertencem a este grupo. */
    const ativsEmOutrosGrupos = new Map(); // id → nome do grupo dono
    gruposCache.forEach(g => {
        if (grupo && g.id === grupo.id) return;
        (g.atividades || []).forEach(ga => {
            if (!ativsEmOutrosGrupos.has(ga.atividade_id)) {
                ativsEmOutrosGrupos.set(ga.atividade_id, `${g.nome} (${g.trimestre}º/${g.ano})`);
            }
        });
    });

    const ativsVisiveis = atividadesCache.filter(a =>
        ativsNoGrupo.has(a.id) || !ativsEmOutrosGrupos.has(a.id)
    );
    const nOcultas = atividadesCache.length - ativsVisiveis.length;

    if (!atividadesCache.length) {
        elModalAtivs.innerHTML = '<div class="cl-empty-state" style="padding:12px">Selecione uma disciplina primeiro.</div>';
    } else if (!ativsVisiveis.length) {
        elModalAtivs.innerHTML = `
            <div class="cl-empty-state" style="padding:14px">
                <p style="margin:0 0 6px"><strong>Nenhuma atividade disponível.</strong></p>
                <p style="margin:0;font-size:.78rem">Todas as ${atividadesCache.length} atividades deste curso já estão em outros grupos.</p>
            </div>`;
    } else {
        const avisoOcultas = nOcultas > 0
            ? `<div class="cl-modal-ativ-info">ℹ ${nOcultas} atividade${nOcultas !== 1 ? 's' : ''} oculta${nOcultas !== 1 ? 's' : ''} — já ${nOcultas !== 1 ? 'pertencem' : 'pertence'} a outro grupo.</div>`
            : '';
        elModalAtivs.innerHTML = avisoOcultas + ativsVisiveis.map(a => {
            // Para atividades já no grupo: usa pontos_max do banco (editável pelo professor)
            // Se pontos_max do banco for null, cai para maxPoints do Classroom como fallback
            // Para atividades novas (não vinculadas): usa maxPoints da API do Classroom
            const pontosInterno = ativsNoGrupo.has(a.id) && pontosNoGrupo[a.id] != null
                ? Number(pontosNoGrupo[a.id])
                : (a.pontos ?? null);
            const pontosSuspeito = pontosInterno !== null && pontosInterno > 0 && pontosInterno < 10;
            return `
            <label class="cl-modal-ativ-item${pontosSuspeito ? ' cl-modal-ativ-item--alerta' : ''}">
                <input type="checkbox" value="${esc(a.id)}"
                    data-titulo="${esc(a.titulo)}"
                    data-pontos="${pontosInterno ?? ''}"
                    ${ativsNoGrupo.has(a.id) ? 'checked' : ''}/>
                <span class="cl-modal-ativ-nome">${esc(a.titulo)}</span>
                ${pontosInterno !== null
                    ? `<span class="cl-ativ-pontos${pontosSuspeito ? ' cl-ativ-pontos--alerta' : ''}" title="${pontosSuspeito ? '⚠ Valor muito baixo — clique para corrigir' : 'Clique para editar pontos'}">${rco(pontosInterno)} pts${pontosSuspeito ? ' ⚠' : ''}</span>`
                    : ''
                }
            </label>`;
        }).join('');
    }

    _fontesModalData = (grupo?.fontes || []).map(f => ({
        fonteGrupoId: f.fonteGrupoId,
        peso: f.peso ?? 100,
    }));
    if (_fontesModalData.length > 0) {
        carregarTodosGrupos().then(() => renderFontesLista());
    } else {
        renderFontesLista();
    }

    elModal.classList.add('cl-modal-overlay--visivel');
}

function fecharModal() {
    elModal.classList.remove('cl-modal-overlay--visivel');
}

elBtnNovoGrupo.addEventListener('click', () => abrirModalGrupo(null));

/* ── Modal: Clonar trimestre inteiro ── */
const elCloneModal     = document.getElementById('clCloneTrimestreModal');
const elCloneOrigem    = document.getElementById('clCloneOrigem');
const elCloneDestTri   = document.getElementById('clCloneDestinoTri');
const elCloneDestAno   = document.getElementById('clCloneDestinoAno');
const elClonePreview   = document.getElementById('clClonePreview');
const elCloneConfirmar = document.getElementById('clCloneConfirmar');

function fecharCloneModal() { elCloneModal.classList.remove('cl-modal-overlay--visivel'); }

function abrirCloneTrimestreModal() {
    if (!cursoAtivo) { toast('Selecione uma disciplina primeiro.', 'erro'); return; }
    if (!gruposCache.length) { toast('Não há grupos para clonar.', 'erro'); return; }

    /* Origens disponíveis: períodos únicos com pelo menos 1 grupo NORMAL */
    const periodos = {};
    gruposCache.forEach(g => {
        if (g.tipo !== 'normal') return;
        const k = `${g.ano}|${g.trimestre}`;
        if (!periodos[k]) periodos[k] = { ano: g.ano, trimestre: g.trimestre, n: 0 };
        periodos[k].n++;
    });
    const lista = Object.values(periodos).sort((a, b) =>
        b.ano !== a.ano ? b.ano - a.ano : b.trimestre - a.trimestre);

    if (!lista.length) { toast('Não há grupos normais para clonar.', 'erro'); return; }

    elCloneOrigem.innerHTML = lista.map(p =>
        `<option value="${p.trimestre}|${p.ano}">${p.trimestre}º Trimestre — ${p.ano} (${p.n} grupo${p.n !== 1 ? 's' : ''})</option>`
    ).join('');

    /* Sugere destino: próximo trimestre */
    const top = lista[0];
    let destTri = top.trimestre + 1;
    let destAno = top.ano;
    if (destTri > 3) { destTri = 1; destAno += 1; }
    elCloneDestTri.value = String(destTri);
    elCloneDestAno.value = String(destAno);

    atualizarClonePreview();
    elCloneModal.classList.add('cl-modal-overlay--visivel');
}

function atualizarClonePreview() {
    const [tOrig, aOrig] = (elCloneOrigem.value || '|').split('|').map(Number);
    const tDest = Number(elCloneDestTri.value);
    const aDest = Number(elCloneDestAno.value);
    const conflito = gruposCache.some(g => g.trimestre === tDest && g.ano === aDest);
    if (tOrig === tDest && aOrig === aDest) {
        elClonePreview.innerHTML = '<span style="color:#dc2626">⚠ Origem e destino não podem ser iguais.</span>';
        elCloneConfirmar.disabled = true;
    } else if (conflito) {
        elClonePreview.innerHTML = `<span style="color:#dc2626">⚠ Já existem grupos no ${tDest}º Trimestre/${aDest}. Exclua-os antes ou escolha outro destino.</span>`;
        elCloneConfirmar.disabled = true;
    } else {
        const grupsOrig = gruposCache.filter(g => g.trimestre === tOrig && g.ano === aOrig);
        const nNormais = grupsOrig.filter(g => g.tipo === 'normal').length;
        const nRecs    = grupsOrig.filter(g => g.tipo === 'recuperacao').length;
        const detalheRec = nRecs > 0
            ? ` + <strong>${nRecs}</strong> de recuperação (estrutura, sem atividades)`
            : '';
        elClonePreview.innerHTML = `Serão criados <strong>${nNormais}</strong> grupo(s) normais${detalheRec} no <strong>${tDest}º Trimestre/${aDest}</strong>, todos vazios.`;
        elCloneConfirmar.disabled = false;
    }
}

elBtnClonarTri.addEventListener('click', abrirCloneTrimestreModal);
document.getElementById('clCloneModalFechar').addEventListener('click', fecharCloneModal);
document.getElementById('clCloneCancelar').addEventListener('click', fecharCloneModal);
elCloneModal.addEventListener('click', e => { if (e.target === elCloneModal) fecharCloneModal(); });
elCloneOrigem.addEventListener('change', atualizarClonePreview);
elCloneDestTri.addEventListener('change', atualizarClonePreview);
elCloneDestAno.addEventListener('input',  atualizarClonePreview);

elCloneConfirmar.addEventListener('click', async () => {
    const [tOrig, aOrig] = (elCloneOrigem.value || '|').split('|').map(Number);
    const tDest = Number(elCloneDestTri.value);
    const aDest = Number(elCloneDestAno.value);
    if (!tOrig || !aOrig || !tDest || !aDest) { toast('Preencha origem e destino.', 'erro'); return; }
    elCloneConfirmar.disabled = true;
    elCloneConfirmar.textContent = 'Clonando...';
    try {
        const r = await api('/groups/clone-trimester', {
            method: 'POST',
            body: { courseId: cursoAtivo.id, trimestreOrigem: tOrig, anoOrigem: aOrig, trimestreDestino: tDest, anoDestino: aDest },
        });
        toast(`${r.grupos.length} grupo(s) clonado(s) para o ${tDest}º Trimestre/${aDest}.`, 'ok');
        fecharCloneModal();
        _allGroupsCache = null;
        await carregarGrupos();
    } catch (e) {
        toast('Erro ao clonar: ' + e.message, 'erro');
    } finally {
        elCloneConfirmar.disabled = false;
        elCloneConfirmar.textContent = 'Clonar grupos';
    }
});
document.getElementById('clGrupoModalFechar').addEventListener('click', fecharModal);
document.getElementById('clGrupoModalCancelar').addEventListener('click', fecharModal);
elModal.addEventListener('click', e => { if (e.target === elModal) fecharModal(); });

/* ── Fontes de nota ── */
const elFontesLista = document.getElementById('clFontesLista');
const elBtnAddFonte = document.getElementById('clBtnAddFonte');
let _allGroupsCache = null;
let _fontesModalData = [];

async function carregarTodosGrupos() {
    if (_allGroupsCache) return _allGroupsCache;
    try {
        _allGroupsCache = await api('/all-groups');
    } catch (_) {
        _allGroupsCache = [];
    }
    return _allGroupsCache;
}

function _getFontesGruposAptos() {
    const cursoAtualId = cursoAtivo?.id;
    const cursoAtual = _cursosCache?.find(c => c.id === cursoAtualId);
    const turmaAtual = cursoAtual ? extrairTurma(cursoAtual.nome) : null;
    return (_allGroupsCache || [])
        .filter(g => {
            if (String(g.id) === String(elGrupoId.value)) return false;
            if (g.cursoId === cursoAtualId) return false;
            if (!turmaAtual) return true;
            const curso = _cursosCache?.find(c => c.id === g.cursoId);
            if (!curso) return false;
            return extrairTurma(curso.nome) === turmaAtual;
        });
}

function _buildFontesAgrupados() {
    const grupos = _getFontesGruposAptos();
    const porCurso = {};
    for (const g of grupos) {
        const curso = _cursosCache?.find(c => c.id === g.cursoId);
        const cursoNome = curso?.nome || 'Outra disciplina';
        if (!porCurso[g.cursoId]) porCurso[g.cursoId] = { nome: cursoNome, grupos: [] };
        porCurso[g.cursoId].grupos.push(g);
    }
    return Object.values(porCurso).sort((a, b) => a.nome.localeCompare(b.nome));
}

const elFontesModal      = document.getElementById('clFontesModal');
const elFontesModalList  = document.getElementById('clFontesModalList');
const elFontesModalBusca = document.getElementById('clFontesModalBusca');
let _fontesModalEditIdx  = -1;
let _fontesModalSelGid   = null;

function abrirFontesSelecaoModal(editIdx) {
    _fontesModalEditIdx = editIdx;
    _fontesModalSelGid  = editIdx >= 0 ? (_fontesModalData[editIdx]?.fonteGrupoId || null) : null;
    const cursosAgrupados = _buildFontesAgrupados();
    const jaUsados = new Set(_fontesModalData.filter((_, i) => i !== editIdx).map(f => String(f.fonteGrupoId)));

    elFontesModalList.innerHTML = cursosAgrupados.length === 0
        ? '<div class="cl-fontes-empty">Nenhum grupo disponível em outras disciplinas desta turma</div>'
        : cursosAgrupados.map(c => {
            const items = c.grupos
                .filter(g => !jaUsados.has(String(g.id)))
                .map(g => {
                    const active = String(g.id) === String(_fontesModalSelGid) ? ' cl-fmodal-item--active' : '';
                    const tipoTag = g.tipo === 'recuperacao' ? '<span class="cl-fdrop-tag">Rec.</span>' : '';
                    const pts = g.pontosMeta ? `${(g.pontosMeta / 10).toFixed(1)} pts` : '';
                    return `<div class="cl-fmodal-item${active}" data-gid="${g.id}">
                        <div class="cl-fmodal-item-nome">${esc(g.nome)} ${tipoTag}</div>
                        <div class="cl-fmodal-item-pts">${pts}</div>
                    </div>`;
                }).join('');
            if (!items) return '';
            return `<div class="cl-fmodal-group">
                <div class="cl-fmodal-header">${esc(c.nome)}</div>
                ${items}
            </div>`;
        }).join('');

    elFontesModalBusca.value = '';
    elFontesModal.classList.add('cl-modal-overlay--visivel');

    elFontesModalList.querySelectorAll('.cl-fmodal-item').forEach(item => {
        item.addEventListener('click', () => {
            elFontesModalList.querySelectorAll('.cl-fmodal-item').forEach(i => i.classList.remove('cl-fmodal-item--active'));
            item.classList.add('cl-fmodal-item--active');
            _fontesModalSelGid = Number(item.dataset.gid);
        });
    });
}

function fecharFontesSelecaoModal() {
    elFontesModal.classList.remove('cl-modal-overlay--visivel');
}

document.getElementById('clFontesModalFechar').addEventListener('click', fecharFontesSelecaoModal);
document.getElementById('clFontesModalCancelar').addEventListener('click', fecharFontesSelecaoModal);
elFontesModal.addEventListener('click', e => { if (e.target === elFontesModal) fecharFontesSelecaoModal(); });

document.getElementById('clFontesModalConfirmar').addEventListener('click', () => {
    if (!_fontesModalSelGid) { toast('Selecione um grupo.', 'alerta'); return; }
    if (_fontesModalEditIdx >= 0) {
        _fontesModalData[_fontesModalEditIdx].fonteGrupoId = _fontesModalSelGid;
    } else {
        _fontesModalData.push({ fonteGrupoId: _fontesModalSelGid, peso: 100 });
    }
    fecharFontesSelecaoModal();
    renderFontesLista();
});

elFontesModalBusca.addEventListener('input', () => {
    const q = elFontesModalBusca.value.toLowerCase().trim();
    elFontesModalList.querySelectorAll('.cl-fmodal-group').forEach(grp => {
        let any = false;
        const headerMatch = grp.querySelector('.cl-fmodal-header').textContent.toLowerCase().includes(q);
        grp.querySelectorAll('.cl-fmodal-item').forEach(it => {
            const match = !q || headerMatch || it.textContent.toLowerCase().includes(q);
            it.style.display = match ? '' : 'none';
            if (match) any = true;
        });
        grp.style.display = any ? '' : 'none';
    });
});

function renderFontesLista() {
    if (!_fontesModalData.length) {
        elFontesLista.innerHTML = '<div class="cl-fontes-empty">Nenhuma fonte externa configurada</div>';
        return;
    }
    elFontesLista.innerHTML = _fontesModalData.map((f, i) => {
        const g = f.fonteGrupoId ? (_allGroupsCache || []).find(x => String(x.id) === String(f.fonteGrupoId)) : null;
        const nome = g ? esc(g.nome) + (g.tipo === 'recuperacao' ? ' <span class="cl-fdrop-tag">Rec.</span>' : '') : '<em>Não definido</em>';
        const curso = g ? (_cursosCache?.find(c => c.id === g.cursoId)?.nome || '') : '';
        const pts = g?.pontosMeta ? `${(g.pontosMeta / 10).toFixed(1)} pts` : '';

        return `
            <div class="cl-fonte-row" data-idx="${i}">
                <div class="cl-fonte-row-main">
                    <button type="button" class="cl-fonte-trigger cl-fonte-trigger--card" data-idx="${i}" title="Alterar grupo">
                        <div class="cl-fonte-trigger-top">
                            <span class="cl-fonte-trigger-label">${nome}</span>
                            ${pts ? `<span class="cl-fonte-info-pts">${pts}</span>` : ''}
                        </div>
                        ${curso ? `<span class="cl-fonte-trigger-curso">${esc(curso)}</span>` : ''}
                    </button>
                    <div class="cl-fonte-peso-wrap">
                        <label class="cl-fonte-peso-label">Aproveitar</label>
                        <input type="number" class="cl-fonte-peso" value="${f.peso}" min="1" max="200" step="1">
                        <span class="cl-fonte-peso-label">%</span>
                    </div>
                    <button type="button" class="cl-fonte-remove" title="Remover fonte">✕</button>
                </div>
            </div>`;
    }).join('');

    elFontesLista.querySelectorAll('.cl-fonte-trigger--card').forEach(btn => {
        btn.addEventListener('click', () => {
            abrirFontesSelecaoModal(Number(btn.dataset.idx));
        });
    });
    elFontesLista.querySelectorAll('.cl-fonte-peso').forEach(inp => {
        inp.addEventListener('change', () => {
            const idx = Number(inp.closest('.cl-fonte-row').dataset.idx);
            _fontesModalData[idx].peso = Math.max(1, Math.min(200, Number(inp.value) || 100));
        });
    });
    elFontesLista.querySelectorAll('.cl-fonte-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.closest('.cl-fonte-row').dataset.idx);
            _fontesModalData.splice(idx, 1);
            renderFontesLista();
        });
    });
}

elBtnAddFonte.addEventListener('click', async () => {
    await carregarTodosGrupos();
    abrirFontesSelecaoModal(-1);
});

/* ── Edição inline dos pontos de cada atividade no modal ── */
elModalAtivs.addEventListener('click', e => {
    const span = e.target.closest('.cl-modal-ativ-item .cl-ativ-pontos');
    if (!span) return;

    // Impede que o clique no badge marque/desmarque o checkbox
    e.preventDefault();
    e.stopPropagation();

    const cb      = span.closest('.cl-modal-ativ-item')?.querySelector('input[type=checkbox]');
    if (!cb) return;
    // dataset.pontos guarda o valor interno (escala ×10)
    const currentInterno = cb.dataset.pontos !== '' ? parseFloat(cb.dataset.pontos) : 0;
    const currentRCO     = (currentInterno / 10);   // escala 0–10 para o usuário

    const input = document.createElement('input');
    input.type      = 'number';
    input.min       = '0';
    input.max       = '10';
    input.step      = '0.1';
    input.value     = currentRCO.toFixed(1);
    input.className = 'cl-pontos-edit';
    input.title     = 'Nota RCO (0–10) · Enter confirma · Esc cancela';
    span.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
        if (committed) return;
        committed = true;
        const raw        = parseFloat(input.value);
        // Converte de volta para escala interna (×10), arredonda para 1 decimal
        const valRCO     = (!isNaN(raw) && raw >= 0) ? Math.min(10, raw) : currentRCO;
        const valInterno = Math.round(valRCO * 10);
        cb.dataset.pontos = valInterno;
        const newSpan       = document.createElement('span');
        newSpan.className   = 'cl-ativ-pontos';
        newSpan.textContent = rco(valInterno) + ' pts';
        input.replaceWith(newSpan);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { input.value = currentRCO.toFixed(1); input.blur(); }
    });
});

/* ── Edição inline de pontos na lista de atividades (aba Atividades) ── */
elAtivLista.addEventListener('click', async e => {
    const span = e.target.closest('.cl-ativ-item .cl-ativ-pontos--editavel');
    if (!span) return;

    e.preventDefault();
    e.stopPropagation();   // impede seleção da atividade

    const item    = span.closest('.cl-ativ-item');
    const ativId  = item?.dataset.ativId;
    if (!ativId || !cursoAtivo) return;

    const cacheEntry = atividadesCache.find(a => a.id === ativId);
    const currentInterno = cacheEntry?.pontos ?? 0;
    const currentRCO     = currentInterno / 10;

    // Mostra input
    const input = document.createElement('input');
    input.type      = 'number';
    input.min       = '0';
    input.max       = '10';
    input.step      = '0.1';
    input.value     = currentRCO > 0 ? currentRCO.toFixed(1) : '';
    input.className = 'cl-pontos-edit';
    input.title     = 'Nota RCO (0–10) · Enter confirma · Esc cancela';
    span.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = async () => {
        if (committed) return;
        committed = true;

        const raw        = parseFloat(input.value);
        const valRCO     = (!isNaN(raw) && raw >= 0) ? Math.min(10, raw) : currentRCO;
        const valInterno = Math.round(valRCO * 10);

        // Restaura o badge imediatamente (feedback visual)
        const newSpan       = document.createElement('span');
        newSpan.className   = `cl-ativ-pontos cl-ativ-pontos--editavel${valInterno === 0 ? ' cl-ativ-pontos--vazio' : ''}`;
        newSpan.title       = 'Clique para editar pontos';
        newSpan.textContent = rco(valInterno) + ' pts';
        input.replaceWith(newSpan);

        if (valInterno === currentInterno) return;   // sem mudança

        try {
            await api(`/courses/${cursoAtivo.id}/activities/${ativId}/pontos_max`, {
                method: 'PATCH',
                body: { pontos_max: valInterno },
            });
            // Atualiza cache local
            if (cacheEntry) cacheEntry.pontos = valInterno;
            // Se a atividade editada for a que está aberta no painel direito,
            // atualiza ativAtiva e re-renderiza as notas sem chamada extra à API
            if (ativAtiva && ativAtiva.id === ativId) {
                ativAtiva.pontos = valInterno;
                renderNotas();
            }
            // Se houver grupo aberto com esta atividade, recarrega o resumo
            if (grupoAtivo) {
                const contemAtiv = grupoAtivo.atividades?.some(a => a.atividade_id === ativId);
                if (contemAtiv) selecionarGrupo(grupoAtivo, document.querySelector('.cl-grupo-item--ativo'));
            }
            toast(`Pontos atualizados em todos os grupos (${rco(valInterno)} pts)`, 'ok');
        } catch (err) {
            // Reverte o badge para o valor original
            newSpan.textContent = rco(currentInterno) + ' pts';
            if (cacheEntry) cacheEntry.pontos = currentInterno;
            toast('Erro ao salvar pontos: ' + err.message, 'erro');
        }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { committed = true; const s2 = document.createElement('span'); s2.className = `cl-ativ-pontos cl-ativ-pontos--editavel${currentInterno === 0 ? ' cl-ativ-pontos--vazio' : ''}`; s2.title = 'Clique para editar pontos'; s2.textContent = rco(currentInterno) + ' pts'; input.replaceWith(s2); }
    });
});

document.getElementById('clGrupoModalSalvar').addEventListener('click', async () => {
    const nome          = elGrupoNome.value.trim();
    const pontos        = Math.round((Number(elGrupoPontos.value) || 4) * 10);
    const id            = elGrupoId.value;
    const tipo          = tipoModalAtivo();
    const grupoOrigemId = tipo === 'recuperacao' ? (elRecOrigemSel.value || null) : null;
    const grupoPaiId    = tipo === 'normal'      ? (elGrupoPaiSel.value  || null) : null;
    /* Converte datetime-local (horário local) para ISO UTC antes de enviar */
    const dataInicio    = tipo === 'recuperacao' && elRecDataInicio.value
        ? new Date(elRecDataInicio.value).toISOString()
        : null;

    if (!nome) { elGrupoNome.focus(); toast('Informe o nome do grupo.', 'erro'); return; }
    if (!cursoAtivo) { toast('Selecione uma disciplina primeiro.', 'erro'); return; }
    if (tipo === 'recuperacao' && !grupoOrigemId) {
        toast('Selecione o grupo de origem da recuperação.', 'erro');
        elRecOrigemSel.focus();
        return;
    }
    if (tipo === 'recuperacao' && !dataInicio) {
        toast('Informe a data de início da recuperação.', 'erro');
        elRecDataInicio.focus();
        return;
    }

    const atividades = [];
    elModalAtivs.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
        atividades.push({
            atividade_id:     cb.value,
            atividade_titulo: cb.dataset.titulo,
            pontos_max:       cb.dataset.pontos !== '' ? Number(cb.dataset.pontos) : null,
        });
    });

    const ativsCom100 = atividades.filter(a => a.pontos_max === 100);
    if (ativsCom100.length > 0) {
        const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const nomes = ativsCom100.map(a => `• ${esc(a.atividade_titulo)}`).join('<br>');
        const continuar = await confirmar(
            `${ativsCom100.length} atividade${ativsCom100.length > 1 ? 's' : ''} com <b>10.0 pts</b> (valor padrão do Classroom):<br><br>${nomes}<br><br>Deseja continuar mesmo assim ou voltar para ajustar?`,
            { titulo: 'Atividades com pontuação padrão', confirmLabel: 'Continuar assim', cancelLabel: 'Voltar e ajustar', tipo: 'alerta', icone: '⚠️', html: true }
        );
        if (!continuar) return;
    }

    const btn = document.getElementById('clGrupoModalSalvar');
    btn.disabled    = true;
    btn.textContent = 'Salvando...';

    const codClasseRco = elGrupoCodClasseRco.value.trim() || null;
    const trimestre    = Number(elGrupoTrimestre.value) || 1;
    const ano          = Number(elGrupoAno.value) || new Date().getFullYear();

    try {
        let grupoId = id;
        if (id) {
            await api(`/groups/${id}`, { method: 'PUT', body: { nome, pontosMeta: pontos, cor: corSelecionada, tipo, grupoOrigemId, grupoPaiId, dataInicio, codClasseRco, trimestre, ano } });
        } else {
            const r = await api('/groups', { method: 'POST', body: { courseId: cursoAtivo.id, nome, pontosMeta: pontos, cor: corSelecionada, tipo, grupoOrigemId, grupoPaiId, dataInicio, codClasseRco, trimestre, ano } });
            grupoId = r.id;
        }
        await api(`/groups/${grupoId}/activities`, { method: 'PUT', body: { atividades } });

        const fontesValidas = _fontesModalData.filter(f => f.fonteGrupoId);
        await api(`/groups/${grupoId}/fontes`, { method: 'PUT', body: { fontes: fontesValidas } });

        fecharModal();
        _allGroupsCache = null;
        toast('Grupo salvo!', 'ok');
        await carregarGrupos();
        if (viewMode === 'grupos') {
            elAtivCount.textContent = `${gruposCache.length} grupo${gruposCache.length !== 1 ? 's' : ''}`;
        }
        if (grupoAtivo && String(grupoAtivo.id) === String(grupoId)) {
            grupoAtivo = gruposCache.find(g => String(g.id) === String(grupoId)) || null;
            if (grupoAtivo) {
                await carregarResumoGrupo(grupoAtivo);
                /* Se o detalhe de um aluno estava aberto, re-renderiza com a nova lista
                   de atividades do grupo (atividades removidas somem, notas recalculadas). */
                refrescarDetalheAlunoAberto();
            }
        }
    } catch (e) {
        toast('Erro ao salvar: ' + e.message, 'erro');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Salvar grupo';
    }
});

async function excluirGrupo(grupo) {
    if (!await confirmar(`Excluir o grupo "${grupo.nome}"? As atividades do Classroom não serão afetadas.`, { titulo: 'Excluir grupo', confirmLabel: 'Excluir', tipo: 'danger', icone: '🗑️' })) return;
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
   AUDITORIA DE FREQUÊNCIA
══════════════════════════════════════════════════════════════ */

/* ── Infere o codClasse RCO mais comum nos grupos do curso atual ── */
function inferirCodClasseDosCursos() {
    if (!gruposCache?.length) return null;
    const counts = {};
    gruposCache.forEach(g => {
        if (g.codClasseRco) counts[String(g.codClasseRco)] = (counts[String(g.codClasseRco)] || 0) + 1;
    });
    const entries = Object.entries(counts);
    if (!entries.length) return null;
    return entries.sort((a, b) => b[1] - a[1])[0][0];
}

/* ── Exibe o chip de vínculo (modo compacto) ── */
function mostrarChipAudit(nomeClasse) {
    elAuditChipNome.textContent = nomeClasse;
    elAuditChipWrap.style.display = '';
    elAuditSelWrap.style.display  = 'none';
}

/* ── Exibe o seletor manual de classe ── */
function mostrarSeletorAudit() {
    elAuditChipWrap.style.display = 'none';
    elAuditSelWrap.style.display  = '';
    elAuditHint.textContent = '';
}

/* ── Filtra o custom-select de disciplinas conforme a turma selecionada ── */
function aplicarFiltroDisciplinas() {
    const turma    = auditTurmaFiltro;
    const filtradas = turma
        ? auditClassesCache.filter(c => c.descrTurma === turma)
        : auditClassesCache;

    const curVal = elAuditClasseSel.value;
    elAuditClasseSel.innerHTML = '<option value="">— selecione a disciplina —</option>';
    filtradas.forEach(c => {
        const opt = document.createElement('option');
        opt.value       = c.codClasse;
        opt.textContent = c.nomeDisciplina;
        elAuditClasseSel.appendChild(opt);
    });
    // Preservar seleção se ainda válida após filtro
    elAuditClasseSel.value = filtradas.some(c => String(c.codClasse) === String(curVal)) ? curVal : '';
    syncCustomSel();
}

/* ── Listener: turma mudou → atualiza disciplinas e sincroniza custom select ── */
document.getElementById('clAuditTurmaSel').addEventListener('change', function () {
    auditTurmaFiltro = this.value;
    syncTurmaSel();
    aplicarFiltroDisciplinas();
});

async function prepararAuditSelector() {
    if (!cursoAtivo) return;

    const savedClasse = localStorage.getItem(auditMapKey(cursoAtivo.id));

    if (!acessosCache) {
        try {
            acessosCache = await apiRaw('/acessos');
        } catch (_) {
            acessosCache = {};
        }
    }

    // Montar lista de classes do RCO
    const classes = [];
    const root = Array.isArray(acessosCache) ? acessosCache[0] : acessosCache;
    if (root) {
        for (const periodo of (root.periodoLetivos || [])) {
            if (!periodo) continue;
            for (const livro of (periodo.livros || [])) {
                const classe = livro.classe;
                if (!classe) continue;
                const disc  = classe.disciplina || {};
                const turma = classe.turma || {};
                classes.push({
                    codClasse:       classe.codClasse,
                    nomeDisciplina:  disc.nomeDisciplina || 'Disciplina',
                    descrTurma:      turma.descrTurma   || '',
                });
            }
        }
    }

    // Deduplicar e ordenar
    const vistas = new Set();
    auditClassesCache = classes.filter(c => {
        if (vistas.has(c.codClasse)) return false;
        vistas.add(c.codClasse);
        return true;
    }).sort((a, b) => (a.descrTurma + a.nomeDisciplina).localeCompare(b.descrTurma + b.nomeDisciplina));

    // Popular o seletor de turmas (sem repetição)
    const turmaSel = document.getElementById('clAuditTurmaSel');
    const turmasUnicas = [...new Set(auditClassesCache.map(c => c.descrTurma))].sort();
    turmaSel.innerHTML = '<option value="">— selecione a turma —</option>';
    turmasUnicas.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        turmaSel.appendChild(opt);
    });

    // Determinar vínculo efetivo: salvo > inferido dos grupos
    const infClasseCod = inferirCodClasseDosCursos();
    const codEfetivo   = savedClasse || infClasseCod || null;

    if (codEfetivo) {
        auditCodClasse = codEfetivo;

        // Pré-selecionar turma e disciplina correspondentes ao vínculo
        const c = auditClassesCache.find(x => String(x.codClasse) === String(codEfetivo));
        if (c) {
            auditTurmaFiltro = c.descrTurma;
            turmaSel.value   = c.descrTurma;
        }
        syncTurmaSel();
        aplicarFiltroDisciplinas();
        elAuditClasseSel.value = codEfetivo;
        syncCustomSel();

        // Salvar no localStorage caso tenha sido apenas inferido (sem salvo prévio)
        if (!savedClasse) localStorage.setItem(auditMapKey(cursoAtivo.id), codEfetivo);

        const nomeChip = c ? `${c.descrTurma} — ${c.nomeDisciplina}` : `Classe ${codEfetivo}`;
        mostrarChipAudit(nomeChip);

        // Auto-rodar se ainda não há resultado e a análise não está em andamento
        const _btnAudit = document.getElementById('clBtnRodarAudit');
        if (!auditResultado && !_btnAudit?.disabled) {
            rodarAuditoria();
        } else {
            elAuditResults.style.display = '';
            renderAuditAtividades();
        }
    } else {
        // Vínculo desconhecido: exibir seletor manual
        syncTurmaSel();
        aplicarFiltroDisciplinas();
        mostrarSeletorAudit();
        if (auditResultado) {
            elAuditResults.style.display = '';
            renderAuditAtividades();
        }
    }
}

/* ── Ao selecionar manualmente: salva, muda para chip e auto-roda ── */
elAuditClasseSel.addEventListener('change', () => {
    auditCodClasse = elAuditClasseSel.value || null;
    if (auditCodClasse && cursoAtivo) {
        localStorage.setItem(auditMapKey(cursoAtivo.id), auditCodClasse);
        const c = auditClassesCache.find(x => String(x.codClasse) === String(auditCodClasse));
        const nomeChip = c ? `${c.descrTurma} — ${c.nomeDisciplina}` : `Classe ${auditCodClasse}`;
        mostrarChipAudit(nomeChip);
        auditResultado = null;
        rodarAuditoria();
    } else {
        elAuditHint.textContent = '';
    }
});

/* ── Botão "alterar": volta ao seletor manual ── */
document.getElementById('clAuditChipAlter').addEventListener('click', () => {
    mostrarSeletorAudit();
    syncTurmaSel();
    syncCustomSel();
});

document.getElementById('clBtnRodarAudit').addEventListener('click', rodarAuditoria);

async function rodarAuditoria() {
    if (!cursoAtivo) { toast('Selecione uma disciplina do Classroom primeiro.', 'erro'); return; }
    if (!auditCodClasse) { toast('Selecione a turma/disciplina correspondente no RCO.', 'erro'); return; }

    const btn = document.getElementById('clBtnRodarAudit');
    btn.disabled    = true;
    btn.textContent = 'Analisando...';
    elAuditResults.style.display = 'none';
    elAuditAtivLista.innerHTML   = '<div class="cl-loading">Cruzando dados de frequência com atividades…<br><small style="color:var(--text-muted)">Isso pode levar alguns instantes.</small></div>';
    elNotasLista.innerHTML       = '<div class="cl-empty-state"><p>← Selecione uma atividade na lista de auditoria</p></div>';
    elNotasCount.textContent     = 'Aguardando...';
    elNotasTitulo.textContent    = 'Auditoria de Frequência';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'none';

    try {
        const resultado = await apiRaw(
            `/classroom/audit?courseId=${cursoAtivo.id}&codClasse=${auditCodClasse}`
        );
        auditResultado = resultado;
        elAuditResults.style.display = '';

        const totalAusencias = resultado.atividades.reduce((s, a) => s + a.ausentes.length, 0);
        const header = document.getElementById('clAuditResultsHeader');
        header.innerHTML = `
            <div class="cl-audit-summary">
                <span class="cl-audit-summary-num ${totalAusencias > 0 ? 'cl-audit-summary-num--warn' : 'cl-audit-summary-num--ok'}">${totalAusencias}</span>
                <span class="cl-audit-summary-label">ausência${totalAusencias !== 1 ? 's' : ''} detectada${totalAusencias !== 1 ? 's' : ''}</span>
                <span class="cl-audit-summary-sep">•</span>
                <span class="cl-audit-summary-detail">${resultado.atividades.length} atividade${resultado.atividades.length !== 1 ? 's' : ''} com aula na chamada</span>
                ${resultado.semCorrespondencia?.length ? `<span class="cl-audit-summary-sep">•</span><span class="cl-audit-summary-detail" style="color:var(--text-muted)">${resultado.semCorrespondencia.length} sem data na chamada</span>` : ''}
            </div>`;

        elAtivCount.textContent = `${resultado.atividades.length} atividade${resultado.atividades.length !== 1 ? 's' : ''} auditadas`;
        renderAuditAtividades();
        toast(`Auditoria concluída: ${totalAusencias} ausência${totalAusencias !== 1 ? 's' : ''} detectada${totalAusencias !== 1 ? 's' : ''}.`, totalAusencias > 0 ? '' : 'ok');
    } catch (e) {
        elAuditAtivLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast('Erro na auditoria: ' + e.message, 'erro');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Analisar frequência';
    }
}

function renderAuditAtividades() {
    if (!auditResultado) return;
    const { atividades } = auditResultado;
    if (!atividades.length) {
        elAuditAtivLista.innerHTML = '<div class="cl-empty-state"><p>Nenhuma atividade com data correspondente na chamada.</p></div>';
        return;
    }

    elAuditAtivLista.innerHTML = '';
    atividades.forEach(a => {
        const nAus  = a.ausentes.length;
        const item  = document.createElement('div');
        item.className = 'cl-audit-ativ-item';
        if (auditAtivAtiva?.id === a.id) item.classList.add('cl-audit-ativ-item--ativo');

        let badgeHtml;
        if (nAus === 0) {
            badgeHtml = `<span class="cl-audit-badge cl-audit-badge--ok">Sem faltas</span>`;
        } else {
            badgeHtml = `<span class="cl-audit-badge cl-audit-badge--warn">${nAus} ausente${nAus !== 1 ? 's' : ''}</span>`;
        }

        item.innerHTML = `
            <div class="cl-audit-ativ-info">
                <div class="cl-audit-ativ-titulo" title="${esc(a.titulo)}">${esc(a.titulo)}</div>
                <div class="cl-audit-ativ-data">📅 Aula: ${a.data}${a.prazo ? ` &bull; Prazo: ${a.prazo}` : ''}</div>
            </div>
            ${badgeHtml}`;

        item.addEventListener('click', () => selecionarAuditAtiv(a, item));
        elAuditAtivLista.appendChild(item);
    });
}

async function selecionarAuditAtiv(ativ, itemEl) {
    document.querySelectorAll('.cl-audit-ativ-item--ativo').forEach(el => el.classList.remove('cl-audit-ativ-item--ativo'));
    itemEl.classList.add('cl-audit-ativ-item--ativo');
    auditAtivAtiva = ativ;
    ativAtiva      = null;
    grupoAtivo     = null;

    elNotasTitulo.textContent    = `Auditoria — ${ativ.titulo}`;
    elNotasCount.textContent     = 'Carregando...';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'flex';
    elBtnImprimir.style.display   = 'none';
    elBtnLivro.style.display      = 'none';
    elBtnRco.style.display        = 'none';
    elBtnFecharNota.style.display = 'none';
    elBtnTardias.style.display    = 'none';
    elNotasLista.innerHTML       = '<div class="cl-loading">Carregando dados da atividade...</div>';

    try {
        // Buscar submissions para obter subId e nota atual
        const subs = await api(`/courses/${cursoAtivo.id}/coursework/${ativ.id}/submissions`);
        const subMap = {};
        subs.forEach(s => { subMap[s.userId] = s; });

        // Buscar todos os alunos matriculados, ordenar por nome
        const todosAlunos = Object.values(alunos).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
        const ausentesSet = new Set(ativ.ausentes.map(a => a.userId));

        // Montar lista completa com flag de ausente
        const lista = todosAlunos.map(al => ({
            ...al,
            sub:     subMap[al.userId] || null,
            ausente: ausentesSet.has(al.userId),
            nomeRco: ativ.ausentes.find(a => a.userId === al.userId)?.nomeRco || null,
        }));

        const totalAusentes = lista.filter(l => l.ausente).length;
        const jaZerados     = lista.filter(l => l.ausente && l.sub?.ausente).length;
        const pendentes     = totalAusentes - jaZerados;

        elNotasCount.textContent = `${lista.length} aluno${lista.length !== 1 ? 's' : ''} — ${totalAusentes} ausente${totalAusentes !== 1 ? 's' : ''}`;

        // Estatísticas da auditoria
        document.getElementById('clStTotal').textContent          = lista.length;
        document.getElementById('clStEntregues').textContent      = totalAusentes;
        document.getElementById('clStEntreguesLabel').textContent  = 'Ausentes';
        document.getElementById('clStPendentes').textContent      = jaZerados;
        document.getElementById('clStPendentesLabel').textContent  = 'Já zerados';
        document.getElementById('clStMedia').textContent          = pendentes > 0 ? pendentes : '✓';
        elNotasStats.style.display = 'grid';

        renderAuditDetalhe(lista, ativ, pendentes > 0);
    } catch (e) {
        elNotasLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    }
}

function renderAuditDetalhe(lista, ativ, temPendentes) {
    const ausentes   = lista.filter(l => l.ausente);
    const presentes  = lista.filter(l => !l.ausente);

    let html = '';

    if (ausentes.length > 0) {
        html += `<div class="cl-audit-section-head">
            <span>Ausentes nesta aula (${ausentes.length})</span>
            ${temPendentes ? `<button class="cl-btn cl-btn--sm cl-btn--danger" id="clBtnAplicarTodos">
                Registrar todos os ausentes
            </button>` : '<span class="cl-audit-todos-ok">✓ Todos zerados</span>'}
        </div>`;
        html += ausentes.map(l => renderAuditRow(l, ativ)).join('');
    }

    if (presentes.length > 0) {
        html += `<div class="cl-audit-section-head cl-audit-section-head--present">Presentes (${presentes.length})</div>`;
        html += presentes.map(l => renderAuditRow(l, ativ)).join('');
    }

    elNotasLista.innerHTML = html;

    // Botão aplicar todos
    document.getElementById('clBtnAplicarTodos')?.addEventListener('click', () => aplicarZerosTodos(ausentes, ativ));

    // Botões individuais
    elNotasLista.querySelectorAll('.cl-btn-audit-zero').forEach(btn => {
        btn.addEventListener('click', () => {
            const userId = btn.dataset.user;
            const subId  = btn.dataset.sub;
            const nome   = btn.dataset.nome;
            aplicarZeroIndividual(userId, subId, nome, ativ);
        });
    });
}

function renderAuditRow(l, ativ) {
    const iniciais = (l.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = l.foto ? `<img src="${esc(l.foto)}" alt="" loading="lazy"/>` : iniciais;
    const nota     = l.sub?.nota ?? null;
    const notaStr  = nota !== null ? `<span class="cl-audit-nota">${nota} pts</span>` : '<span class="cl-audit-nota cl-audit-nota--vazia">—</span>';

    if (!l.ausente) {
        return `<div class="cl-audit-row cl-audit-row--presente">
            <div class="cl-nota-avatar">${fotoHtml}</div>
            <div class="cl-audit-row-info">
                <div class="cl-nota-nome">${esc(l.nome || '—')}</div>
            </div>
            <div class="cl-audit-row-nota">${notaStr}</div>
            <div class="cl-audit-row-status">
                <span class="cl-nota-status-badge cl-nota-status--entregue">Presente</span>
            </div>
        </div>`;
    }

    const subId    = l.sub?.id || '';
    const jaZerado = l.sub?.ausente === true;
    let acaoHtml;

    if (jaZerado) {
        acaoHtml = `<span class="cl-nota-status-badge cl-nota-status--devolvido">Registrado ✓</span>`;
    } else {
        acaoHtml = `<button class="cl-btn cl-btn--sm cl-btn--danger cl-btn-audit-zero"
            data-user="${esc(l.userId)}" data-sub="${esc(subId)}" data-nome="${esc(l.nome || '')}">
            Registrar ausência
        </button>`;
    }

    return `<div class="cl-audit-row cl-audit-row--ausente">
        <div class="cl-nota-avatar cl-nota-avatar--ausente">${fotoHtml}</div>
        <div class="cl-audit-row-info">
            <div class="cl-nota-nome">${esc(l.nome || '—')} <span class="cl-ausente-badge">AUSENTE</span></div>
            ${l.nomeRco ? `<div class="cl-audit-rco-nome">RCO: ${esc(l.nomeRco)}</div>` : ''}
        </div>
        <div class="cl-audit-row-nota">${notaStr}</div>
        <div class="cl-audit-row-status">${acaoHtml}</div>
    </div>`;
}

async function aplicarZeroIndividual(userId, subId, nome, ativ) {
    if (!await confirmar(`Registrar ${nome} como ausente na atividade "${ativ.titulo}"?`, { titulo: 'Registrar ausência', confirmLabel: 'Registrar', icone: '📋' })) return;

    try {
        await apiRaw('/classroom/ausencias', {
            method: 'POST',
            body: {
                courseId:      cursoAtivo.id,
                atividadeId:   ativ.id,
                userId,
                nomeAluno:     nome,
                dataAtividade: ativ.data,
                codClasse:     auditCodClasse,
            },
        });

        toast(`Ausência registrada para ${nome}.`, 'ok');
        await selecionarAuditAtiv(ativ, document.querySelector('.cl-audit-ativ-item--ativo'));
    } catch (e) {
        toast('Erro ao registrar ausência: ' + e.message, 'erro');
    }
}

async function aplicarZerosTodos(ausentesLista, ativ) {
    const pendentes = ausentesLista.filter(l => !l.sub?.ausente);
    if (!pendentes.length) { toast('Todos os ausentes já foram registrados.', 'ok'); return; }
    if (!await confirmar(`Registrar ${pendentes.length} aluno${pendentes.length !== 1 ? 's' : ''} ausente${pendentes.length !== 1 ? 's' : ''} nesta atividade?`, { titulo: 'Registrar todos os ausentes', confirmLabel: 'Registrar todos', icone: '📋' })) return;

    const btn = document.getElementById('clBtnAplicarTodos');
    if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

    let ok = 0;
    let erros = 0;
    for (const l of pendentes) {
        try {
            await apiRaw('/classroom/ausencias', {
                method: 'POST',
                body: {
                    courseId:      cursoAtivo.id,
                    atividadeId:   ativ.id,
                    userId:        l.userId,
                    nomeAluno:     l.nome,
                    dataAtividade: ativ.data,
                    codClasse:     auditCodClasse,
                },
            });
            ok++;
        } catch (_) {
            erros++;
        }
    }

    toast(`${ok} ausência${ok !== 1 ? 's' : ''} registrada${ok !== 1 ? 's' : ''}${erros > 0 ? ` (${erros} erro${erros !== 1 ? 's' : ''})` : ''}.`, erros > 0 ? '' : 'ok');
    await selecionarAuditAtiv(ativ, document.querySelector('.cl-audit-ativ-item--ativo'));
}

function exportarAuditCSV() {
    if (!auditAtivAtiva || !auditResultado) return;
    const curso = cursoAtivo?.nome || 'disciplina';
    const ativ  = auditAtivAtiva;
    let csv = `Disciplina,Atividade,Data da aula\n"${curso}","${ativ.titulo}","${ativ.data}"\n\n`;
    csv    += 'Nº,Aluno,Status Frequência,Nota\n';
    elNotasLista.querySelectorAll('.cl-audit-row').forEach((row, i) => {
        const nome   = row.querySelector('.cl-nota-nome')?.textContent.replace('AUSENTE','').trim() || '';
        const ausent = row.classList.contains('cl-audit-row--ausente') ? 'Ausente' : 'Presente';
        const nota   = row.querySelector('.cl-audit-nota')?.textContent.trim().replace(' pts', '') || '';
        csv += `${i+1},"${nome}","${ausent}","${nota}"\n`;
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `Auditoria – ${curso} – ${ativ.titulo} – ${ativ.data.replace('/','.')}.csv`.replace(/[\\/:*?"<>|]/g,'_');
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exportado!', 'ok');
}

/* ── Filtro de status (adicionar opção "Ausente") ── */
(function adicionarFiltroAusente() {
    const sel = document.getElementById('clFiltroStatus');
    if (sel && !sel.querySelector('option[value="ausente"]')) {
        const opt = document.createElement('option');
        opt.value       = 'ausente';
        opt.textContent = 'Ausentes';
        sel.appendChild(opt);
    }
})();

/* ══════════════════════════════════════════════════════════════
   CUSTOM SELECTS — AUDITORIA (Turma + Disciplina)
══════════════════════════════════════════════════════════════ */
let _cselClose  = null;   // fecha o dropdown de disciplina
let _tselClose  = null;   // fecha o dropdown de turma

/* ── Helpers genéricos para qualquer custom-select ── */
function _syncCsel(selId, valId, listId, onSelect, placeholder) {
    const sel   = document.getElementById(selId);
    const valEl = document.getElementById(valId);
    const list  = document.getElementById(listId);
    if (!sel || !valEl || !list) return;

    list.innerHTML = '';
    [...sel.options].forEach(opt => {
        const item = document.createElement('div');
        item.className = 'cl-csel-item'
            + (opt.value === '' ? ' cl-csel-item--placeholder' : '')
            + (opt.selected     ? ' cl-csel-item--sel' : '');
        item.textContent = opt.textContent;
        item.title = opt.textContent;
        item.addEventListener('click', () => {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change'));
            onSelect?.();
        });
        list.appendChild(item);
    });

    const selOpt = sel.options[sel.selectedIndex];
    valEl.textContent = selOpt?.textContent || placeholder;
    valEl.classList.toggle('cl-csel-val--placeholder', !sel.value);
}

function _initCsel(btnId, dropId, openCb, closeSibling) {
    const btn  = document.getElementById(btnId);
    const drop = document.getElementById(dropId);
    if (!btn || !drop) return () => {};

    const open  = () => { closeSibling?.(); drop.style.display = ''; btn.classList.add('cl-csel-btn--open'); openCb?.(); };
    const close = () => { drop.style.display = 'none'; btn.classList.remove('cl-csel-btn--open'); };

    btn.addEventListener('click', e => { e.stopPropagation(); drop.style.display === 'none' ? open() : close(); });
    drop.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', close);

    return close;
}

/* ── Turma ── */
function syncTurmaSel() {
    _syncCsel('clAuditTurmaSel', 'clAuditTurmaVal', 'clAuditTurmaList',
        () => { syncTurmaSel(); _tselClose?.(); },
        '— selecione a turma —');
}

function initTurmaSel() {
    _tselClose = _initCsel('clAuditTurmaBtn', 'clAuditTurmaDrop',
        null,
        () => _cselClose?.());
    syncTurmaSel();
}

/* ── Disciplina ── */
function syncCustomSel() {
    _syncCsel('clAuditClasseSel', 'clAuditSelVal', 'clAuditSelList',
        () => { syncCustomSel(); _cselClose?.(); },
        '— selecione a disciplina —');
}

function initCustomSel() {
    _cselClose = _initCsel('clAuditSelBtn', 'clAuditSelDrop',
        null,
        () => _tselClose?.());
    syncCustomSel();
}

/* ══════════════════════════════════════════════════════════════
   HANDLES DE REDIMENSIONAMENTO DE COLUNAS
══════════════════════════════════════════════════════════════ */
function initResizeHandles() {
    const workspace = document.getElementById('clWorkspace');
    if (!workspace) return;

    const MIN_W   = 140;
    const MAX_W   = 500;
    const LS_KEY1 = 'cl-col1-w';
    const LS_KEY2 = 'cl-col2-w';

    let w1 = Math.max(MIN_W, Math.min(MAX_W, parseInt(localStorage.getItem(LS_KEY1) || '260', 10)));
    let w2 = Math.max(MIN_W, Math.min(MAX_W, parseInt(localStorage.getItem(LS_KEY2) || '280', 10)));

    function applyWidths() {
        if (window.innerWidth <= 768) return;
        workspace.style.gridTemplateColumns = `${w1}px 4px ${w2}px 4px 1fr`;
    }
    applyWidths();

    function setupHandle(handleEl, colIdx) {
        if (!handleEl) return;

        function startDrag(startX) {
            handleEl.classList.add('cl-resize-handle--dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            const startW = colIdx === 1 ? w1 : w2;

            const onMove = ev => {
                const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
                const delta = clientX - startX;
                const newW  = Math.max(MIN_W, Math.min(MAX_W, startW + delta));
                if (colIdx === 1) w1 = newW;
                else              w2 = newW;
                applyWidths();
            };

            const onUp = () => {
                handleEl.classList.remove('cl-resize-handle--dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                localStorage.setItem(colIdx === 1 ? LS_KEY1 : LS_KEY2, colIdx === 1 ? w1 : w2);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
        }

        handleEl.addEventListener('mousedown', e => { e.preventDefault(); startDrag(e.clientX); });
        handleEl.addEventListener('touchstart', e => { e.preventDefault(); startDrag(e.touches[0].clientX); }, { passive: false });
    }

    setupHandle(document.getElementById('clHandle1'), 1);
    setupHandle(document.getElementById('clHandle2'), 2);
}
initResizeHandles();

/* ── Handle vertical da área de config de auditoria ── */
function initAuditConfigHandle() {
    const handle = document.getElementById('clAuditConfigHandle');
    const config = document.getElementById('clAuditConfig');
    if (!handle || !config) return;

    const LS_KEY  = 'cl-audit-config-h';
    const MIN_H   = 80;
    const MAX_H   = 500;

    const saved = parseInt(localStorage.getItem(LS_KEY) || '0', 10);
    if (saved >= MIN_H) {
        config.style.height    = saved + 'px';
        config.style.flexShrink = '0';
    }

    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        handle.classList.add('cl-hresize-handle--dragging');
        document.body.style.cursor    = 'row-resize';
        document.body.style.userSelect = 'none';

        const startY = e.clientY;
        const startH = config.getBoundingClientRect().height;

        const onMove = ev => {
            const newH = Math.min(MAX_H, Math.max(MIN_H, startH + (ev.clientY - startY)));
            config.style.height    = newH + 'px';
            config.style.flexShrink = '0';
        };

        const onUp = () => {
            handle.classList.remove('cl-hresize-handle--dragging');
            document.body.style.cursor    = '';
            document.body.style.userSelect = '';
            localStorage.setItem(LS_KEY, parseInt(config.style.height, 10));
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}
initAuditConfigHandle();
initTurmaSel();
initCustomSel();

/* ══════════════════════════════════════════════════════════════
   SELETOR DE CLASSE RCO (para o modal de grupo)
══════════════════════════════════════════════════════════════ */
const elClassePickerModal       = document.getElementById('clClassePickerModal');
const elClassePickerBusca       = document.getElementById('clClassePickerBusca');
const elClassePickerLista       = document.getElementById('clClassePickerLista');
const elClassePickerFiltro      = document.getElementById('clClassePickerFiltro');
const elClassePickerFiltroLabel = document.getElementById('clClassePickerFiltroLabel');
const elClasseRcoInfo           = document.getElementById('clClasseRcoInfo');

let _classesRcoCache  = null;   // cache da lista completa
let _classesRcoTimer  = null;   // debounce do filtro
let _serieAtiva       = null;   // { ano, letra } — filtro pré-aplicado pela série do curso

/* Extrai {ano, letra} do nome de um curso Classroom, ex: "Logica - 1º Ano C Manha" → { ano:'1', letra:'C' } */
function extrairSerieCurso(nome) {
    const m = (nome || '').match(/(\d+)\s*[ºo°]\s*Ano\s+([A-Z])/i);
    if (!m) return null;
    return { ano: m[1], letra: m[2].toUpperCase() };
}

/* Verifica se uma classe RCO pertence à série dada.
   Formato real do RCO: "TEC EM DES DE SISTEMAS - ET IC - 2ª série - Manhã - C"
   — a letra é SEMPRE o último segmento separado por " - "
   — o número da série aparece antes de "série" ou "Ano"             */
function classeMatchSerie(c, serie) {
    if (!serie) return true;
    const s = c.descrTurma || '';

    /* Letra: último segmento após " - " */
    const segmentos = s.split(/\s*-\s*/);
    const letra = segmentos[segmentos.length - 1].trim().toUpperCase();
    if (letra !== serie.letra) return false;

    /* Número de série: dígito antes de "série" ou "Ano" (ignora maiúsculas/acentos) */
    const mSerie = s.match(/(\d+)\s*[ªºo°]?\s*(?:s[eé]rie|ano)/i);
    if (!mSerie) return false;
    return mSerie[1] === serie.ano;
}

function fecharClassePicker() {
    elClassePickerModal.classList.remove('cl-modal-overlay--visivel');
}

document.getElementById('clClassePickerFechar').addEventListener('click', fecharClassePicker);
document.getElementById('clClassePickerCancelar').addEventListener('click', fecharClassePicker);
elClassePickerModal.addEventListener('click', e => {
    if (e.target === elClassePickerModal) fecharClassePicker();
});

/* Botão "ver todas" — limpa o filtro de série e re-renderiza */
document.getElementById('clClassePickerFiltroLimpar').addEventListener('click', () => {
    _serieAtiva = null;
    elClassePickerFiltro.style.display = 'none';
    filtrarClassePicker();
});

function renderClassePicker(lista) {
    if (!lista.length) {
        elClassePickerLista.innerHTML = '<div class="cl-empty-state">Nenhuma classe encontrada.</div>';
        return;
    }
    elClassePickerLista.innerHTML = '';
    lista.forEach(c => {
        const item = document.createElement('div');
        item.className = 'cl-classe-item';
        item.innerHTML = `
            <div class="cl-classe-item-label">${c.descrTurma}</div>
            <div class="cl-classe-item-disc">${c.nomeDisciplina || '—'}${c.siglaDisciplina ? ` <span class="cl-classe-sigla">${c.siglaDisciplina}</span>` : ''}</div>
            <div class="cl-classe-item-cod">cod. ${c.codClasse}${c.periodoLetivo ? ` &middot; ${c.periodoLetivo}` : ''}</div>
        `;
        item.addEventListener('click', () => {
            elGrupoCodClasseRco.value = String(c.codClasse);
            mostrarInfoClasseRco(c);
            fecharClassePicker();
        });
        elClassePickerLista.appendChild(item);
    });
}

function filtrarClassePicker() {
    clearTimeout(_classesRcoTimer);
    _classesRcoTimer = setTimeout(() => {
        if (!_classesRcoCache) return;
        const q = elClassePickerBusca.value.toLowerCase().trim();

        let filtrado = _classesRcoCache;

        /* 1º — filtro de série (pré-aplicado pelo curso selecionado) */
        if (_serieAtiva) filtrado = filtrado.filter(c => classeMatchSerie(c, _serieAtiva));

        /* 2º — filtro de texto digitado */
        if (q) filtrado = filtrado.filter(c =>
            c.label.toLowerCase().includes(q) || String(c.codClasse).includes(q));

        renderClassePicker(filtrado);
    }, 200);
}

elClassePickerBusca.addEventListener('input', filtrarClassePicker);

async function abrirClassePicker() {
    elClassePickerBusca.value = '';
    elClassePickerModal.classList.add('cl-modal-overlay--visivel');
    elClassePickerLista.innerHTML = '<div class="cl-loading">Carregando classes…</div>';

    /* Pré-aplica filtro de série a partir do curso selecionado */
    _serieAtiva = cursoAtivo ? extrairSerieCurso(cursoAtivo.nome) : null;
    if (_serieAtiva) {
        elClassePickerFiltroLabel.textContent =
            `Mostrando apenas ${_serieAtiva.ano}º Ano ${_serieAtiva.letra}`;
        elClassePickerFiltro.style.display = 'flex';
    } else {
        elClassePickerFiltro.style.display = 'none';
    }

    /* Usa cache se já carregado */
    if (_classesRcoCache) {
        filtrarClassePicker();
        setTimeout(() => elClassePickerBusca.focus(), 80);
        return;
    }

    try {
        const lista = await apiRaw('/rco-lancamento/classes');
        _classesRcoCache = lista;
        filtrarClassePicker();
        setTimeout(() => elClassePickerBusca.focus(), 80);
    } catch (e) {
        elClassePickerLista.innerHTML = `<div class="cl-rco-erro">Erro ao buscar classes: ${e.message}</div>`;
    }
}

function mostrarInfoClasseRco(c) {
    if (!c) { elClasseRcoInfo.style.display = 'none'; return; }
    elClasseRcoInfo.style.display = '';
    elClasseRcoInfo.innerHTML = `
        ✅ <strong>${c.descrTurma}</strong> — ${c.nomeDisciplina || '—'}
        <span class="cl-classe-cod-badge">cod. ${c.codClasse}</span>
    `;
}

/* Quando o usuário digita o código manualmente, limpa o info
   (guard: bloqueia completamente a edição se campo estiver em modo herdado) */
elGrupoCodClasseRco.addEventListener('input', () => {
    if (_campoCodBloqueado) return;
    elClasseRcoInfo.style.display = 'none';
});
elGrupoCodClasseRco.addEventListener('keydown', e => {
    if (_campoCodBloqueado) e.preventDefault();
});

elBtnBuscarClasse.addEventListener('click', () => {
    if (_campoCodBloqueado) return;   // bloqueado em grupos de recuperação
    abrirClassePicker();
});

/* ══════════════════════════════════════════════════════════════
   MODAL LANÇAMENTO RCO
══════════════════════════════════════════════════════════════ */
const elRcoModal          = document.getElementById('clRcoModal');
const elRcoPasso1         = document.getElementById('clRcoPasso1');
const elRcoPasso2         = document.getElementById('clRcoPasso2');
const elRcoAvaliacoesLista= document.getElementById('clRcoAvaliacoesLista');
const elRcoAvaliacaoInfo  = document.getElementById('clRcoAvaliacaoInfo');
const elRcoTableBody      = document.getElementById('clRcoTableBody');
const elRcoModalConfirmar = document.getElementById('clRcoModalConfirmar');
const elRcoModalZerar     = document.getElementById('clRcoModalZerar');
const elRcoModalSalvarDb  = document.getElementById('clRcoModalSalvarDb');

/* Normaliza nome para comparação (remove acentos, pontuação, caixa) */
function normNome(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/gi, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

let rcoAvaliacaoSelecionada  = null;   // avaliação escolhida no passo 1
let rcoAlunosMapeados        = null;   // array de alunos com nota calculada (passo 2)
let lancamentoPendenteBd     = null;   // payload aguardando persistência (quando dbSalvo=false)
let rcoConteudosSelecionados = [];     // conteúdos a enviar junto com as notas

function fecharModalRco() {
    elRcoModal.classList.remove('cl-modal-overlay--visivel');
    rcoAvaliacaoSelecionada = null;
    rcoAlunosMapeados        = null;
    lancamentoPendenteBd     = null;
    rcoConteudosSelecionados = [];
    elRcoModalConfirmar.style.display = 'none';
    elRcoModalZerar.style.display     = 'none';
    elRcoModalSalvarDb.style.display  = 'none';
    elRcoPasso1.style.display = '';
    elRcoPasso2.style.display = 'none';
}

document.getElementById('clRcoModalFechar').addEventListener('click', fecharModalRco);
document.getElementById('clRcoModalCancelar').addEventListener('click', fecharModalRco);
elRcoModal.addEventListener('click', e => { if (e.target === elRcoModal) fecharModalRco(); });

/* Abre o modal e carrega avaliações */
async function abrirModalRco() {
    if (!grupoAtivo?.codClasseRco) {
        toast('Este grupo não tem código de classe RCO configurado.', 'erro');
        return;
    }
    if (!grupoResumoData?.alunosResumo?.length) {
        toast('Carregue as notas do grupo antes de lançar.', 'erro');
        return;
    }

    rcoAvaliacaoSelecionada = null;
    rcoAlunosMapeados       = null;
    elRcoPasso1.style.display = '';
    elRcoPasso2.style.display = 'none';
    elRcoModalConfirmar.style.display = 'none';
    elRcoAvaliacoesLista.innerHTML = '<div class="cl-loading">Buscando avaliações no RCO…</div>';
    elRcoModal.classList.add('cl-modal-overlay--visivel');

    try {
        const data = await apiRaw(`/rco-lancamento/avaliacoes?codClasse=${grupoAtivo.codClasseRco}`);
        const lista = Array.isArray(data) ? data : (data.data ?? data.items ?? data.resultado ?? []);

        const avalComId = lista.filter(av => av.codAvaliacaoParcialClasse);
        const tiposDisponiveis = lista.filter(av => !av.codAvaliacaoParcialClasse)
            .map(av => Number(av.codTipoAvaliacaoParcial) === 2 ? 'Recuperação' : `AV${av.numAvaliacaoParcial || 1}`);

        elRcoAvaliacoesLista.innerHTML = '';

        if (!avalComId.length) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'cl-rco-criar-wrap';
            emptyDiv.innerHTML = `
                <div class="cl-empty-state" style="margin-bottom:12px">Nenhuma avaliação criada no RCO para esta classe.</div>
                <div class="cl-rco-criar-form">
                    <div class="cl-rco-criar-titulo">Criar Avaliação no RCO</div>
                    <div class="cl-rco-criar-campo">
                        <label>Tipo:</label>
                        <select id="clRcoCriarTipo" class="cl-rco-criar-select">
                            ${tiposDisponiveis.map(t => `<option value="${t}">${t}</option>`).join('')}
                            ${!tiposDisponiveis.length ? '<option value="AV1">AV1</option><option value="Recuperação">Recuperação</option>' : ''}
                        </select>
                    </div>
                    <div class="cl-rco-criar-campo">
                        <label>Data:</label>
                        <input type="date" id="clRcoCriarData" class="cl-rco-criar-input" value="${new Date().toISOString().slice(0,10)}">
                    </div>
                    <button id="clRcoCriarBtn" class="cl-btn cl-btn--primary" style="margin-top:8px">
                        Criar no RCO
                    </button>
                    <div id="clRcoCriarStatus" class="cl-rco-criar-status" style="display:none"></div>
                </div>
            `;
            elRcoAvaliacoesLista.appendChild(emptyDiv);

            document.getElementById('clRcoCriarBtn')?.addEventListener('click', () => criarAvaliacaoRco());
            return;
        }

        avalComId.forEach(av => {
            const isRec  = Number(av.codTipoAvaliacaoParcial) === 2;
            const label  = String(av.descrAvaliacaoParcial ?? (av.numAvaliacaoParcial != null ? `AV${av.numAvaliacaoParcial}` : '—'))
                               .replace(/\n\s*/g, ' ').trim();

            const subPartes = [];
            if (av.pesoDecimal != null)        subPartes.push(`Peso: ${av.pesoDecimal}`);
            if (av.dataAvaliacaoParcial)        subPartes.push(`Data: ${av.dataAvaliacaoParcial.slice(0,10)}`);

            const item = document.createElement('div');
            item.className = 'cl-rco-av-item' + (isRec ? ' cl-rco-av-item--rec' : '');
            item.innerHTML = `
                <div class="cl-rco-av-header">
                    ${isRec
                        ? '<span class="cl-rco-tipo-badge cl-rco-tipo-badge--rec">🔄 Recuperação</span>'
                        : '<span class="cl-rco-tipo-badge cl-rco-tipo-badge--av">📊 Avaliação</span>'
                    }
                </div>
                <div class="cl-rco-av-nome">${label}</div>
                ${subPartes.length ? `<div class="cl-rco-av-sub">${subPartes.join(' &nbsp;|&nbsp; ')}</div>` : ''}
                ${isRec ? '<div class="cl-rco-av-aviso-rec">⚠️ Notas serão salvas localmente — lance no RCO manualmente</div>' : ''}
            `;
            item.addEventListener('click', () => selecionarAvaliacao(av, item));
            elRcoAvaliacoesLista.appendChild(item);
        });

        if (tiposDisponiveis.length) {
            const criarDiv = document.createElement('div');
            criarDiv.className = 'cl-rco-criar-inline';
            criarDiv.innerHTML = `
                <details class="cl-rco-criar-details">
                    <summary>Criar outra avaliação</summary>
                    <div class="cl-rco-criar-form" style="margin-top:8px">
                        <div class="cl-rco-criar-campo">
                            <label>Tipo:</label>
                            <select id="clRcoCriarTipo" class="cl-rco-criar-select">
                                ${tiposDisponiveis.map(t => `<option value="${t}">${t}</option>`).join('')}
                            </select>
                        </div>
                        <div class="cl-rco-criar-campo">
                            <label>Data:</label>
                            <input type="date" id="clRcoCriarData" class="cl-rco-criar-input" value="${new Date().toISOString().slice(0,10)}">
                        </div>
                        <button id="clRcoCriarBtn" class="cl-btn cl-btn--primary cl-btn--sm" style="margin-top:8px">
                            Criar no RCO
                        </button>
                        <div id="clRcoCriarStatus" class="cl-rco-criar-status" style="display:none"></div>
                    </div>
                </details>
            `;
            elRcoAvaliacoesLista.appendChild(criarDiv);
            document.getElementById('clRcoCriarBtn')?.addEventListener('click', () => criarAvaliacaoRco());
        }
    } catch (e) {
        elRcoAvaliacoesLista.innerHTML = `<div class="cl-rco-erro">Erro ao buscar avaliações: ${e.message}</div>`;
    }
}

async function criarAvaliacaoRco() {
    const tipo = document.getElementById('clRcoCriarTipo')?.value;
    const data = document.getElementById('clRcoCriarData')?.value;
    const btn  = document.getElementById('clRcoCriarBtn');
    const statusEl = document.getElementById('clRcoCriarStatus');

    if (!tipo || !data) {
        toast('Selecione o tipo e a data da avaliação.', 'erro');
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Criando…';
    statusEl.style.display = '';
    statusEl.textContent   = 'Automatizando criação no RCO Digital (pode levar até 30s)…';
    statusEl.className     = 'cl-rco-criar-status cl-rco-criar-status--info';

    try {
        const codClasse = grupoAtivo?.codClasseRco;
        const nomeDisciplina = grupoAtivo?.nomeDisciplina || grupoAtivo?.nome || '';
        const result = await apiRaw('/rco-lancamento/avaliacoes/criar', {
            method: 'POST',
            body: { codClasse, tipo, dataAvaliacao: data, nomeDisciplina },
        });

        statusEl.textContent = 'Avaliação criada com sucesso! Recarregando lista…';
        statusEl.className   = 'cl-rco-criar-status cl-rco-criar-status--ok';
        toast('Avaliação criada no RCO! Recarregando…', 'ok');

        await new Promise(r => setTimeout(r, 1500));
        await abrirModalRco();
    } catch (e) {
        statusEl.textContent = `Erro: ${e.message}`;
        statusEl.className   = 'cl-rco-criar-status cl-rco-criar-status--erro';
        toast(`Erro ao criar avaliação: ${e.message}`, 'erro', 8000);
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Criar no RCO';
    }
}

/* Passo 1 → 2: carrega detalhe e monta preview */
async function selecionarAvaliacao(av, itemEl) {
    elRcoAvaliacoesLista.querySelectorAll('.cl-rco-av-item').forEach(el =>
        el.classList.remove('cl-rco-av-item--selecionado'));
    itemEl.classList.add('cl-rco-av-item--selecionado');

    elRcoAvaliacoesLista.innerHTML = '<div class="cl-loading">Carregando detalhes da avaliação…</div>';

    try {
        const codClasse = grupoAtivo?.codClasseRco ?? '';
        const detalhe = await apiRaw(`/rco-lancamento/avaliacoes/${av.codAvaliacaoParcialClasse}?codClasse=${codClasse}`);
        rcoAvaliacaoSelecionada  = detalhe;
        /* Preserva os conteúdos já vinculados — serão re-enviados no PUT */
        rcoConteudosSelecionados = Array.isArray(detalhe.conteudos) ? detalhe.conteudos : [];

        /* Monta o mapeamento aluno-por-aluno */
        const alunosRco = detalhe.alunos ?? [];
        const alunosClass = grupoResumoData.alunosResumo;

        const temRec = grupoResumoData.hasRec;

        /* Índice Classroom por codMatrizAluno (chave primária confiável) */
        const classIdx = {};
        alunosClass.forEach(a => {
            const cod = a.aluno?.codMatrizAluno ?? a.codMatrizAluno;
            if (cod) classIdx[String(cod)] = a;
        });

        /* Peso da avaliação no RCO e metas dos grupos para normalização das notas */
        const { meta: metaG, recMeta: recMetaG } = grupoResumoData;
        const pesoRco = rcoAvaliacaoSelecionada?.pesoDecimal ?? 1;

        rcoAlunosMapeados = alunosRco.map(rcoAluno => {
            /* Match 1º por codMatrizAluno (exato), 2º por nome normalizado (fallback) */
            let classAluno = classIdx[String(rcoAluno.codMatrizAluno)] ?? null;
            if (!classAluno && rcoAluno.nome) {
                const keyRco = normNome(rcoAluno.nome);
                if (keyRco) {
                    classAluno = alunosClass.find(a =>
                        normNome(a.aluno?.nome ?? a.nome ?? '') === keyRco
                    ) ?? null;
                    if (!classAluno) {
                        const tok = keyRco.split(' ').slice(0, 3).join(' ');
                        if (tok) {
                            classAluno = alunosClass.find(a =>
                                normNome(a.aluno?.nome ?? a.nome ?? '').startsWith(tok)
                            ) ?? null;
                        }
                    }
                }
            }

            /* Nota original do RCO — preservada separadamente para exibição */
            const notaRcoOrig = rcoAluno.notaDecimal != null ? Number(rcoAluno.notaDecimal) : null;

            /* Lógica de recuperação:
               - Aluno FEZ recuperação (recData.soma existe) → nota = nota da recuperação
               - Aluno NÃO fez recuperação                  → nota = nota do grupo principal
               A nota da recuperação é enviada independentemente de ser maior ou menor. */
            let notaCalc = null;
            let usouRec  = false;

            if (classAluno) {
                const somaRec = classAluno.recData?.soma ?? null;
                if (somaRec !== null) {
                    /* Nota da recuperação: soma em recMeta → normaliza para escala RCO */
                    const mR = recMetaG > 0 ? recMetaG : 1;
                    notaCalc = Number(Math.min(somaRec / mR * pesoRco, pesoRco).toFixed(1));
                    usouRec  = true;
                } else {
                    /* Nota do grupo principal: soma em meta → normaliza para escala RCO */
                    const mG = metaG > 0 ? metaG : 1;
                    notaCalc = Number(Math.min((classAluno.soma ?? 0) / mG * pesoRco, pesoRco).toFixed(1));
                }
            }

            return {
                ...rcoAluno,
                _classNome:   classAluno?.aluno?.nome ?? classAluno?.nome ?? null,
                _notaRcoOrig: notaRcoOrig,          /* nota ATUAL no RCO — só para exibição */
                _notaCalc:    notaCalc,
                _usouRec:     usouRec,
                /* notaDecimal: calculada se mapeado, null se não mapeado
                   (alunos sem dados no Classroom NÃO recebem 0 — campo fica ausente no PUT,
                    replicando o comportamento do RCO web que só envia nota para quem tem) */
                notaDecimal:  notaCalc,
                _matched:     classAluno !== null,
            };
        });

        /* Ordena: encontrados (com recuperação > grupo principal) no topo, não-encontrados no fim */
        rcoAlunosMapeados.sort((a, b) => {
            const prioA = a._matched ? (a._usouRec ? 0 : 1) : 2;
            const prioB = b._matched ? (b._usouRec ? 0 : 1) : 2;
            if (prioA !== prioB) return prioA - prioB;
            return (a.numChamada ?? 9999) - (b.numChamada ?? 9999);
        });

        /* Renderiza passo 2 */
        const nMapeados    = rcoAlunosMapeados.filter(a => a._matched).length;
        const nRecuperados = rcoAlunosMapeados.filter(a => a._usouRec).length;

        elRcoPasso1.style.display = 'none';
        elRcoPasso2.style.display = '';
        elRcoAvaliacaoInfo.innerHTML = `
            <strong>${detalhe.descrAvaliacaoParcial ? String(detalhe.descrAvaliacaoParcial).replace(/\n\s*/g,' ').trim() : `Avaliação #${detalhe.numAvaliacaoParcial}`}</strong>
            &nbsp;|&nbsp; Peso: ${detalhe.pesoDecimal}
            &nbsp;|&nbsp; Data: ${detalhe.dataAvaliacaoParcial?.slice(0,10) ?? '—'}
            &nbsp;|&nbsp; ${nMapeados}/${rcoAlunosMapeados.length} alunos encontrados
            ${nRecuperados ? `&nbsp;|&nbsp; <span class="cl-rco-rec-badge">🔄 ${nRecuperados} com recuperação</span>` : ''}
        `;

        /* Cabeçalho da tabela — coluna extra se houver recuperação */
        document.querySelector('#clRcoTable thead tr').innerHTML = temRec
            ? '<th>#</th><th>Aluno (RCO)</th><th>Nota RCO atual</th><th>Nota orig.</th><th>Nota rec.</th><th>Nota final</th><th>Status</th>'
            : '<th>#</th><th>Aluno (RCO)</th><th>Nota RCO atual</th><th>Nota Classroom</th><th>Status</th>';

        /* Helper: formata nota sem zeros desnecessários (RCO usa 1 decimal) */
        const fmtNota = v => (v != null ? Number(v).toFixed(1) : '—');

        elRcoTableBody.innerHTML = '';
        rcoAlunosMapeados
            .slice()
            .sort((a, b) => (a.numChamada ?? 9999) - (b.numChamada ?? 9999))
            .forEach(a => {
            const tr = document.createElement('tr');
            tr.className = a._matched ? (a._usouRec ? 'cl-rco-row--rec' : '') : 'cl-rco-row--naoencontrado';

            /* Nome: vem do Supabase (via backend) ou do _classNome matched */
            const nomeExibir  = a.nome ?? a._classNome ?? `cod: ${a.codMatrizAluno ?? '?'}`;
            /* Nota atual no RCO (real, preservada antes do cálculo) */
            const notaRcoAtual = fmtNota(a._notaRcoOrig);
            /* Nota que será enviada ao RCO: calculada se mapeado, 0.0 se não encontrado */
            const notaEnviar  = a._notaCalc !== null ? fmtNota(a._notaCalc) : '0.0';

            /* Badge de status */
            let badge;
            if (!a._matched) {
                badge = '<span class="cl-rco-badge cl-rco-badge--miss">✕ não encontrado</span>';
            } else if (grupoResumoData?.isRec) {
                /* Estamos dentro do próprio grupo de recuperação */
                badge = '<span class="cl-rco-badge cl-rco-badge--rec">🔄 grupo de rec.</span>';
            } else if (a._usouRec) {
                /* Aluno fez recuperação — a nota da rec. substituirá a nota original */
                badge = '<span class="cl-rco-badge cl-rco-badge--rec">🔄 usa nota rec.</span>';
            } else {
                badge = '<span class="cl-rco-badge cl-rco-badge--ok">✓ grupo principal</span>';
            }

            if (temRec) {
                /* Mostra notas do classAluno já normalizadas para escala RCO */
                const classAluno = classIdx[String(a.codMatrizAluno)]
                    ?? (a._matched ? alunosClass.find(c =>
                        normNome(c.aluno?.nome ?? c.nome ?? '') === normNome(a.nome ?? '')
                    ) : null) ?? null;
                const mG = metaG  > 0 ? metaG  : 1;
                const mR = recMetaG > 0 ? recMetaG : 1;
                const somaOrig = classAluno
                    ? fmtNota(Math.min((classAluno.soma ?? 0) / mG * pesoRco, pesoRco))
                    : '—';
                const somaRec  = classAluno?.recData
                    ? fmtNota(Math.min(classAluno.recData.soma / mR * pesoRco, pesoRco))
                    : '—';

                const notaFinalExibir = a._usouRec
                    ? `<strong class="cl-rco-nota-rec">${notaEnviar}</strong>`
                    : (a._matched
                        ? `<span>${notaEnviar} <small style="opacity:.55">(principal)</small></span>`
                        : `<span class="cl-rco-mantido">${notaEnviar}</span>`);

                tr.innerHTML = `
                    <td>${a.numChamada ?? '—'}</td>
                    <td>${nomeExibir}</td>
                    <td>${notaRcoAtual}</td>
                    <td>${somaOrig}</td>
                    <td>${somaRec}</td>
                    <td>${notaFinalExibir}</td>
                    <td>${badge}</td>
                `;
            } else {
                tr.innerHTML = `
                    <td>${a.numChamada ?? '—'}</td>
                    <td>${nomeExibir}</td>
                    <td>${notaRcoAtual}</td>
                    <td><strong>${notaEnviar}</strong></td>
                    <td>${badge}</td>
                `;
            }
            elRcoTableBody.appendChild(tr);
        });

        const isRecAv = Number(detalhe.codTipoAvaliacaoParcial) === 2;
        elRcoModalConfirmar.style.display = '';
        elRcoModalZerar.style.display     = isRecAv ? 'none' : '';

        if (isRecAv) {
            elRcoModalConfirmar.textContent = 'Salvar localmente';
            elRcoModalConfirmar.title = 'Notas de recuperação não podem ser enviadas ao RCO via API. Serão salvas apenas no banco local do EduSync.';
        } else {
            elRcoModalConfirmar.textContent = 'Lançar notas no RCO';
            elRcoModalConfirmar.title = '';
        }

        /* Remove aviso residual de navegações anteriores */
        document.getElementById('clRcoAvisoRecVinculo')?.remove();
    } catch (e) {
        elRcoAvaliacoesLista.innerHTML = `<div class="cl-rco-erro">Erro ao carregar avaliação: ${e.message}</div>`;
        elRcoPasso1.style.display = '';
        elRcoPasso2.style.display = 'none';
    }
}

/* Confirmar lançamento */
elRcoModalConfirmar.addEventListener('click', async () => {
    if (!rcoAvaliacaoSelecionada || !rcoAlunosMapeados) return;

    const mapeados   = rcoAlunosMapeados.filter(a => a._matched).length;
    const total      = rcoAlunosMapeados.length;
    const semMatch   = total - mapeados;

    const av     = rcoAvaliacaoSelecionada;
    const isRec  = Number(av.codTipoAvaliacaoParcial) === 2;

    const msgRco = isRec
        ? `${mapeados} de ${total} notas de recuperação serão salvas localmente no EduSync. Para lançar no RCO, use o site oficial.`
        : (semMatch > 0
            ? `${mapeados} de ${total} alunos têm nota do Classroom e receberão a nota calculada. ${semMatch} aluno(s) não fazem parte do grupo de recuperação e receberão nota 0 no RCO.`
            : `${mapeados} nota${mapeados !== 1 ? 's' : ''} serão enviadas ao RCO para todos os alunos mapeados.`);

    if (!await confirmar(msgRco, {
        titulo:       isRec ? 'Salvar recuperação localmente' : 'Confirmar lançamento no RCO',
        confirmLabel: isRec ? 'Salvar localmente' : 'Lançar notas',
        icone:        isRec ? '💾' : '🚀',
    })) return;

    elRcoModalConfirmar.disabled    = true;
    elRcoModalConfirmar.textContent = isRec ? 'Salvando…' : 'Lançando…';

    /* Para tipo=2: envia 'recuperadas' com os objetos completos exatamente como vieram do GET.
       O RCO rejeita tanto o objeto completo quanto só o código — enviamos completo para o log
       mostrar tudo e o backend poder ver a estrutura exata no erro.
       Para tipo=1: 'recuperacaos' re-enviado do GET (já funciona). */
    const recuperadasParaPut = isRec
        ? (av.recuperadas ?? []).map(({ alunos: _al, conteudos: _co, ...r }) => r)
        : [];

    const meta = {
        codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse,
        codTipoAvaliacaoParcial:   av.codTipoAvaliacaoParcial,
        numAvaliacaoParcial:       av.numAvaliacaoParcial,
        dataAvaliacaoParcial:      av.dataAvaliacaoParcial,
        pesoDecimal:               av.pesoDecimal,
        /* codClasse necessário para /matrizAlunos no backend (tipo=2) */
        ...(isRec ? { codClasse: grupoAtivo?.codClasseRco ?? null } : {}),
        /* Conteúdos: apenas em avaliações principais (tipo 1). */
        ...(!isRec && rcoConteudosSelecionados.length ? { conteudos: rcoConteudosSelecionados }  : {}),
        /* recuperadas com objeto completo do GET para tipo=2 */
        ...(recuperadasParaPut.length               ? { recuperadas: recuperadasParaPut }        : {}),
        /* recuperacaos: re-enviado do GET para tipo=1 (já funcionava) */
        ...(av.recuperacaos?.length                 ? { recuperacaos: av.recuperacaos }          : {}),
    };

    /* Remove campos internos (_*) antes de enviar; expõe usouRecuperacao e matched para o backend salvar */
    const alunosPayload = rcoAlunosMapeados.map(
        ({ _classNome, _notaCalc, _matched, _usouRec, _notaRcoOrig, ...rest }) => ({
            ...rest,
            matched:         !!_matched,
            usouRecuperacao: !!_usouRec,
        })
    );

    try {
        const resp = await apiRaw(`/rco-lancamento/avaliacoes/${av.codAvaliacaoParcialClasse}/lancar`, {
            method: 'POST',
            body: { meta, alunos: alunosPayload },
        });

        if (resp.apenasLocal) {
            toast(`💾 ${resp.msg}`, 'ok', 6000);
            fecharModalRco();
            return;
        }

        /* Verifica se o banco local foi atualizado */
        if (resp.dbSalvo === false) {
            /* PUT no RCO OK, mas banco falhou — armazena payload e mostra botão de recuperação */
            lancamentoPendenteBd = {
                codAvaliacao: av.codAvaliacaoParcialClasse,
                alunos:       alunosPayload,
            };
            elRcoModalSalvarDb.style.display  = '';   /* mostra botão de recuperação */
            elRcoModalConfirmar.style.display = 'none'; /* esconde o confirmar */
            toast(
                '⚠️ Notas enviadas ao RCO com sucesso, mas falha ao salvar no banco local. ' +
                'Use o botão "Salvar no banco" para tentar novamente sem reenviar ao RCO.',
                'alerta'
            );
            console.error('[CLASSROOM] Falha no banco após lançamento RCO:', resp.dbErro);
            return; /* mantém modal aberto */
        }

        /* Monta mensagem de sucesso com nível de verificação */
        const verMsg = resp.rcoVerificado
            ? ' ✓ valores confirmados no RCO.'
            : ' (verificação pós-lançamento indisponível).';
        toast(`✅ Notas lançadas e salvas! (${mapeados}/${total} alunos)${verMsg}`, 'ok');
        fecharModalRco();
    } catch (e) {
        const msg = e.message || 'Erro desconhecido';

        /* Detecta erro de recuperação não suportada pelo RCO */
        if (/recupera[cç][aã]o.*n[aã]o.suportad/i.test(msg) || (e.body?.tipo === 'recuperacao_nao_suportada')) {
            toast('⚠️ O RCO não permite lançar notas de recuperação via API. Lance manualmente no site do RCO Digital.', 'alerta', 10000);
            console.warn('[CLASSROOM] Recuperação não suportada pela API do RCO.');
            fecharModalRco();
            return;
        }

        /* Detecta erro do RCO sobre conteúdos — abre modal de seleção */
        const erroConteudos = /conteúdos?\s*(vinculad|obrigat)|sem\s*conteúdos?|registrar.*conteúd|conteúd.*vinculad/i.test(msg);
        if (erroConteudos) {
            toast('⚠️ Avaliação sem conteúdos. Selecione abaixo e tente novamente.', 'alerta', 6000);
            console.warn('[CLASSROOM] Erro de conteúdos — abrindo modal de seleção:', msg);
            await abrirModalConteudos();
            return; /* mantém modal RCO aberto atrás */
        }
        /* Outros erros */
        const isRcoErro = msg.length > 30;
        const prefixo   = isRcoErro ? '⚠️ RCO: ' : '❌ Erro: ';
        toast(prefixo + msg, 'erro', 8000);
        console.error('[CLASSROOM] Erro no lançamento:', msg);
    } finally {
        elRcoModalConfirmar.disabled    = false;
        elRcoModalConfirmar.textContent = isRec ? 'Salvar localmente' : 'Lançar notas no RCO';
    }
});

/* ── Recuperação de banco: salvar sem re-enviar ao RCO ── */
elRcoModalSalvarDb.addEventListener('click', async () => {
    if (!lancamentoPendenteBd) return;

    elRcoModalSalvarDb.disabled    = true;
    elRcoModalSalvarDb.textContent = 'Salvando…';

    const { codAvaliacao, alunos } = lancamentoPendenteBd;

    try {
        const resp = await apiRaw(
            `/rco-lancamento/avaliacoes/${codAvaliacao}/salvar-db`,
            { method: 'POST', body: { alunos } }
        );

        if (resp.dbSalvo) {
            const verMsg = resp.rcoVerificado
                ? ' ✓ valores confirmados no RCO.'
                : '';
            toast(`✅ Banco sincronizado com sucesso!${verMsg}`, 'ok');
            lancamentoPendenteBd           = null;
            elRcoModalSalvarDb.style.display = 'none';
            fecharModalRco();
        } else {
            toast('❌ Falha ao salvar no banco. Tente novamente.', 'erro');
        }
    } catch (e) {
        toast('Erro ao salvar no banco: ' + e.message, 'erro');
        console.error('[CLASSROOM] Erro no salvar-db:', e);
    } finally {
        elRcoModalSalvarDb.disabled    = false;
        elRcoModalSalvarDb.textContent = '💾 Salvar no banco';
    }
});

/* ── Zerar avaliação no RCO ── */
elRcoModalZerar.addEventListener('click', async () => {
    if (!rcoAvaliacaoSelecionada || !rcoAlunosMapeados) return;

    const av    = rcoAvaliacaoSelecionada;
    const total = rcoAlunosMapeados.length;
    const nomeAv = av.descrAvaliacaoParcial ? String(av.descrAvaliacaoParcial).replace(/\n\s*/g,' ').trim() : `Avaliação #${av.numAvaliacaoParcial}`;

    if (!await confirmar(
        `Isso enviará nota vazia para todos os ${total} alunos da avaliação "${nomeAv}". O RCO irá limpar as notas desta avaliação. Esta ação não pode ser desfeita.`,
        {
            titulo:       '⚠️ Zerar avaliação no RCO',
            confirmLabel: '🗑️ Sim, zerar notas',
            tipo:         'danger',
            icone:        '⚠️',
        }
    )) return;

    elRcoModalZerar.disabled    = true;
    elRcoModalZerar.textContent = 'Zerando…';

    const isRecZ = av.codTipoAvaliacaoParcial === 2;

    const recuperadasParaPutZ = isRecZ
        ? (av.recuperadas ?? []).map(({ alunos: _al, conteudos: _co, ...r }) => r)
        : [];

    const meta = {
        codAvaliacaoParcialClasse: av.codAvaliacaoParcialClasse,
        codTipoAvaliacaoParcial:   av.codTipoAvaliacaoParcial,
        numAvaliacaoParcial:       av.numAvaliacaoParcial,
        dataAvaliacaoParcial:      av.dataAvaliacaoParcial,
        pesoDecimal:               av.pesoDecimal,
        ...(!isRecZ && rcoConteudosSelecionados.length ? { conteudos:    rcoConteudosSelecionados }  : {}),
        ...(recuperadasParaPutZ.length                 ? { recuperadas:  recuperadasParaPutZ }       : {}),
        ...(av.recuperacaos?.length                    ? { recuperacaos: av.recuperacaos }           : {}),
    };

    /* Payload com notaDecimal = null para todos os alunos (limpa notas no RCO) */
    const alunosPayload = rcoAlunosMapeados.map(
        ({ _classNome, _notaCalc, _matched, _usouRec, _notaRcoOrig, ...rest }) => ({
            ...rest,
            matched:         false,
            usouRecuperacao: false,
            notaDecimal:     null,
        })
    );

    try {
        await apiRaw(`/rco-lancamento/avaliacoes/${av.codAvaliacaoParcialClasse}/lancar`, {
            method: 'POST',
            body: { meta, alunos: alunosPayload },
        });
        toast(`🗑️ Avaliação zerada no RCO — ${total} alunos com nota vazia.`, 'ok');
        fecharModalRco();
    } catch (e) {
        toast('Erro ao zerar no RCO: ' + e.message, 'erro');
    } finally {
        elRcoModalZerar.disabled    = false;
        elRcoModalZerar.textContent = '🗑️ Zerar avaliação no RCO';
    }
});

elBtnRco.addEventListener('click', () => abrirModalRco());

/* ══════════════════════════════════════════════════════════════
   MODAL DE CONTEÚDOS (fallback quando RCO rejeita sem conteúdos)
══════════════════════════════════════════════════════════════ */
const elConteudosModal          = document.getElementById('clConteudosModal');
const elConteudosSugestoesLista = document.getElementById('clConteudosSugestoesLista');
const elConteudosSelecionadosLista = document.getElementById('clConteudosSelecionadosLista');
const elConteudosSelecionadosWrap  = document.getElementById('clConteudosSelecionadosWrap');
const elConteudosSelecionadosCount = document.getElementById('clConteudosSelecionadosCount');
const elConteudoNovoInput       = document.getElementById('clConteudoNovoInput');
const elConteudoNovoBtn         = document.getElementById('clConteudoNovoBtn');
const elConteudosModalConfirmar = document.getElementById('clConteudosModalConfirmar');

/* Seleção interna do modal (acumulada antes de confirmar) */
let _conteudosModalSelecionados = [];

function _renderizarConteudosSelecionados() {
    elConteudosSelecionadosCount.textContent = _conteudosModalSelecionados.length;
    elConteudosSelecionadosWrap.style.display = _conteudosModalSelecionados.length ? '' : 'none';
    elConteudosModalConfirmar.disabled = _conteudosModalSelecionados.length === 0;

    elConteudosSelecionadosLista.innerHTML = '';
    _conteudosModalSelecionados.forEach((c, idx) => {
        const el = document.createElement('div');
        el.className = 'cl-conteudo-item--selecionado';
        el.innerHTML = `
            <span>${c.descrConteudo ?? '(sem descrição)'}</span>
            <button class="cl-conteudo-remover" title="Remover" data-idx="${idx}">✕</button>
        `;
        el.querySelector('.cl-conteudo-remover').addEventListener('click', () => {
            _conteudosModalSelecionados.splice(idx, 1);
            _renderizarConteudosSelecionados();
            /* Desmarca checkbox de sugestão, se existir */
            const descr = c.descrConteudo ?? '';
            const cb = Array.from(elConteudosSugestoesLista.querySelectorAll('input[type="checkbox"]'))
                .find(el => el.dataset.key === descr);
            if (cb) cb.checked = false;
        });
        elConteudosSelecionadosLista.appendChild(el);
    });
}

function _adicionarConteudo(obj) {
    const descr = (obj.descrConteudo ?? '').trim();
    if (!descr) return;
    if (_conteudosModalSelecionados.some(c => c.descrConteudo === descr)) return; /* sem duplicata */
    _conteudosModalSelecionados.push(obj);
    _renderizarConteudosSelecionados();
}

/* Abre o modal de conteúdos e busca sugestões */
async function abrirModalConteudos() {
    _conteudosModalSelecionados = [];
    _renderizarConteudosSelecionados();
    elConteudoNovoInput.value = '';
    elConteudosSugestoesLista.innerHTML = '<div class="cl-loading">Buscando conteúdos…</div>';
    elConteudosModal.classList.add('cl-modal-overlay--visivel');

    const codClasse = grupoAtivo?.codClasseRco ?? '';
    try {
        const sugestoes = codClasse
            ? await apiRaw(`/rco-lancamento/conteudos-sugeridos?codClasse=${codClasse}`)
            : [];

        elConteudosSugestoesLista.innerHTML = '';
        if (!sugestoes.length) {
            elConteudosSugestoesLista.innerHTML =
                '<span style="color:var(--text-secondary);font-size:.82rem;font-style:italic">Nenhum conteúdo encontrado em outras avaliações da turma.</span>';
        } else {
            sugestoes.forEach(c => {
                const descr = (c.descrConteudo ?? '').trim();
                if (!descr) return;
                const label = document.createElement('label');
                label.className = 'cl-conteudo-item';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.dataset.key = descr; /* sem escapar — dataset é seguro */
                const spanCb = document.createElement('span');
                spanCb.textContent = descr;
                label.append(cb, spanCb);
                cb.addEventListener('change', () => {
                    if (cb.checked) _adicionarConteudo(c);
                    else {
                        const i = _conteudosModalSelecionados.findIndex(x => x.descrConteudo === descr);
                        if (i !== -1) _conteudosModalSelecionados.splice(i, 1);
                        _renderizarConteudosSelecionados();
                    }
                });
                elConteudosSugestoesLista.appendChild(label);
            });
        }
    } catch (err) {
        console.warn('[CONTEUDOS] Falha ao buscar sugestões:', err.message);
        elConteudosSugestoesLista.innerHTML =
            '<span style="color:var(--text-secondary);font-size:.82rem">Não foi possível carregar sugestões.</span>';
    }
}

function fecharModalConteudos() {
    elConteudosModal.classList.remove('cl-modal-overlay--visivel');
    _conteudosModalSelecionados = [];
}

/* Adicionar conteúdo personalizado */
function adicionarConteudoPersonalizado() {
    const texto = elConteudoNovoInput.value.trim();
    if (!texto) return;
    _adicionarConteudo({ descrConteudo: texto });
    elConteudoNovoInput.value = '';
    elConteudoNovoInput.focus();
}

elConteudoNovoBtn.addEventListener('click', adicionarConteudoPersonalizado);
elConteudoNovoInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); adicionarConteudoPersonalizado(); }
});

/* Confirmar — aplica seleção e re-tenta o lançamento */
elConteudosModalConfirmar.addEventListener('click', async () => {
    if (!_conteudosModalSelecionados.length) return;

    /* Atualiza o estado global com os conteúdos escolhidos */
    rcoConteudosSelecionados = [..._conteudosModalSelecionados];
    fecharModalConteudos();

    /* Re-clica o botão de confirmar lançamento no modal RCO */
    elRcoModalConfirmar.click();
});

document.getElementById('clConteudosModalFechar').addEventListener('click',   fecharModalConteudos);
document.getElementById('clConteudosModalCancelar').addEventListener('click', fecharModalConteudos);
elConteudosModal.addEventListener('click', e => { if (e.target === elConteudosModal) fecharModalConteudos(); });

/* ══════════════════════════════════════════════════════════════
   GAVETA — colapsa col1 + col2 para a esquerda
══════════════════════════════════════════════════════════════ */
const CL_LS_GAVETA = 'cl-gaveta-fechada';
let _gavetaFechada = localStorage.getItem(CL_LS_GAVETA) === '1';

function toggleGaveta(forcarAbrir) {
    const workspace = document.getElementById('clWorkspace');
    const tab       = document.getElementById('clGavetaTab');
    if (!workspace) return;

    if (forcarAbrir === true) _gavetaFechada = false;
    else _gavetaFechada = !_gavetaFechada;

    workspace.classList.toggle('cl-workspace--gaveta', _gavetaFechada);
    tab?.classList.toggle('cl-gaveta-tab--visivel', _gavetaFechada);

    /* Se gaveta abriu, restaura widths salvas no resize */
    if (!_gavetaFechada) {
        const w1 = parseInt(localStorage.getItem('cl-col1-w') || '260', 10);
        const w2 = parseInt(localStorage.getItem('cl-col2-w') || '280', 10);
        workspace.style.gridTemplateColumns = `${w1}px 4px ${w2}px 4px 1fr`;
    }
    localStorage.setItem(CL_LS_GAVETA, _gavetaFechada ? '1' : '0');
}

/* Aplica estado salvo da gaveta ao abrir a página */
(function initGaveta() {
    if (!_gavetaFechada) return;
    /* Espera o workspace aparecer */
    const obs = new MutationObserver(() => {
        const ws = document.getElementById('clWorkspace');
        if (ws && ws.style.display !== 'none') {
            ws.classList.add('cl-workspace--gaveta');
            document.getElementById('clGavetaTab')?.classList.add('cl-gaveta-tab--visivel');
            obs.disconnect();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
})();

/* ══════════════════════════════════════════════════════════════
   POPOUT — abre Notas & Entregas em janela separada
══════════════════════════════════════════════════════════════ */
function popoutNotas() {
    const url = new URL(window.location.href);
    url.searchParams.set('popout', '1');
    url.searchParams.delete('code');
    const w = window.open(
        url.toString(),
        'cl-notas-popout',
        'width=1100,height=780,resizable=yes,menubar=no,toolbar=no,location=no,status=no'
    );
    if (!w) toast('⚠ Popup bloqueado — permita popups para este site.', 'erro', 6000);
}

/* ── Modo popout: colapsa col1+col2, escuta broadcast ── */
(function initPopout() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('popout') !== '1') return;

    /* Aplica classe que estiliza o header como minimalista */
    document.body.classList.add('cl-popout');

    /* Oculta col1, col2 e handles imediatamente */
    const hide = ids => ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    hide(['clCol1', 'clHandle1', 'clCol2', 'clHandle2', 'clGavetaTab', 'clBtnGaveta', 'clBtnPopout']);

    /* Ajusta grid para 1 coluna */
    const applyGrid = () => {
        const ws = document.getElementById('clWorkspace');
        if (ws) ws.style.gridTemplateColumns = '1fr';
    };
    applyGrid();
    new MutationObserver(applyGrid).observe(document.body, { childList: true, subtree: true, attributes: true });

    /* Atualiza title da janela */
    document.title = 'EduSync — Notas & Entregas';

    /* Escuta mensagens da janela principal */
    if (!clBc) return;
    clBc.onmessage = async ({ data }) => {
        try {
            if (data.type === 'grupo') {
                /* Seleciona curso e grupo automaticamente */
                if (!cursoAtivo || cursoAtivo.id !== data.cursoId) {
                    /* Carrega lista de cursos e seleciona o certo */
                    const cursos = await api('/courses');
                    const curso = cursos.find(c => c.id === data.cursoId);
                    if (!curso) return;
                    const itemFake = { classList: { add: ()=>{}, remove: ()=>{} } };
                    await selecionarCurso(curso, itemFake, curso.cor);
                }
                /* Agora seleciona o grupo */
                await new Promise(r => setTimeout(r, 400)); /* aguarda render */
                const grupo = gruposCache.find(g => g.id === data.grupoId);
                if (grupo) {
                    const itemEl = document.querySelector(`.cl-grupo-item[data-id="${grupo.id}"]`)
                        || { classList: { add: ()=>{}, remove: ()=>{} } };
                    await selecionarGrupo(grupo, itemEl);
                }
            } else if (data.type === 'atividade') {
                if (!cursoAtivo || cursoAtivo.id !== data.cursoId) {
                    const cursos = await api('/courses');
                    const curso = cursos.find(c => c.id === data.cursoId);
                    if (!curso) return;
                    const itemFake = { classList: { add: ()=>{}, remove: ()=>{} } };
                    await selecionarCurso(curso, itemFake, curso.cor);
                }
                await new Promise(r => setTimeout(r, 400));
                const ativ = atividadesCache.find(a => a.id === data.ativId);
                if (ativ) {
                    const itemFake = { classList: { add: ()=>{}, remove: ()=>{} } };
                    await selecionarAtividade(ativ, itemFake);
                }
            }
        } catch(e) { console.warn('[POPOUT]', e); }
    };
})();

/* ══════════════════════════════════════════════════════════════
   BANNER DE PLANO
══════════════════════════════════════════════════════════════ */
(function injetarBannerPlano() {
    const user = window.__edusync?.user;
    if (!user || user.perfil === 'admin' || user.perfilReal === 'admin') return;
    const pi = user.planoInfo;
    if (!pi) return;

    const container = document.querySelector('.container') || document.querySelector('.cl-main');
    if (!container) return;

    const banner = document.createElement('div');
    banner.className = 'cl-plano-banner';

    if (pi.expirado) {
        banner.classList.add('cl-plano-banner--expirado');
        banner.innerHTML = `<span class="cl-plano-banner-icon">⏰</span>
            <span>Seu plano <strong>${pi.config?.nome || pi.plano}</strong> expirou. Contate o administrador para renovar.</span>`;
    } else if (!pi.plano) {
        banner.classList.add('cl-plano-banner--sem');
        banner.innerHTML = `<span class="cl-plano-banner-icon">🔒</span>
            <span>Você não possui um plano ativo. Algumas funcionalidades estão bloqueadas. Contate o administrador.</span>`;
    } else if (pi.plano === 'trial' && pi.diasRestantes !== null) {
        banner.classList.add('cl-plano-banner--trial');
        banner.innerHTML = `<span class="cl-plano-banner-icon">⏳</span>
            <span>Plano <strong>Trial</strong> — ${pi.diasRestantes} dia(s) restante(s). Funcionalidades de escrita estão desabilitadas.</span>`;
    } else {
        return;
    }

    container.insertBefore(banner, container.firstChild);
})();

/* ══════════════════════════════════════════════════════════════
   ACESSO PEDAGOGO — professor concede/revoga acesso
══════════════════════════════════════════════════════════════ */
let _pedagogosPanelOpen = false;

function togglePedagogoPanel() {
    _pedagogosPanelOpen = !_pedagogosPanelOpen;
    document.getElementById('clPedagogoPanel').style.display = _pedagogosPanelOpen ? '' : 'none';
    if (_pedagogosPanelOpen) carregarPedagogos();
}

async function carregarPedagogos() {
    const el = document.getElementById('clPedagogoLista');
    try {
        const resp = await fetch('/api/classroom/acesso-pedagogos', { credentials: 'include' });
        const lista = await resp.json();
        const badge = document.getElementById('clPedagogoBadge');
        if (lista.length > 0) {
            badge.textContent = lista.length;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
        if (!lista.length) {
            el.innerHTML = '<div style="color:var(--text-secondary,#9ca3af);text-align:center;padding:8px">Nenhum acesso concedido.</div>';
            return;
        }
        el.innerHTML = lista.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border,#e5e7eb)">
                <span style="color:var(--text-primary,#111)">${p.pedagogo_email}</span>
                <button onclick="revogarPedagogo(${p.id})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:.75rem;font-weight:600;padding:2px 6px" title="Revogar acesso">✕</button>
            </div>
        `).join('');
    } catch (e) {
        el.innerHTML = '<div style="color:#ef4444">Erro ao carregar.</div>';
    }
}

async function adicionarPedagogo() {
    const input = document.getElementById('clPedagogoEmail');
    const email = input.value.trim().toLowerCase();
    if (!email || !email.includes('@')) { toast('Informe um email válido.', 'erro'); return; }
    try {
        const resp = await fetch('/api/classroom/acesso-pedagogos', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        if (!resp.ok) { const d = await resp.json(); toast(d.erro || 'Erro', 'erro'); return; }
        input.value = '';
        toast('Acesso concedido!', 'ok');
        carregarPedagogos();
    } catch (e) {
        toast('Erro: ' + e.message, 'erro');
    }
}

async function revogarPedagogo(id) {
    if (!await confirmar('Deseja revogar o acesso desta pedagoga?', { titulo: 'Revogar acesso', confirmLabel: 'Revogar', tipo: 'danger', icone: '🔒' })) return;
    try {
        await fetch(`/api/classroom/acesso-pedagogos/${id}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        toast('Acesso revogado.', 'ok');
        carregarPedagogos();
    } catch (e) {
        toast('Erro: ' + e.message, 'erro');
    }
}

(async function initPedagogoAccess() {
    try {
        const resp = await fetch('/api/classroom/acesso-pedagogos', { credentials: 'include' });
        if (resp.ok) {
            document.getElementById('clPedagogoAccess').style.display = '';
            const lista = await resp.json();
            const badge = document.getElementById('clPedagogoBadge');
            if (lista.length > 0) {
                badge.textContent = lista.length;
                badge.style.display = '';
            }
        }
        await carregarSolicitacoesAcesso();
    } catch (_) {}
})();

async function carregarSolicitacoesAcesso() {
    try {
        const resp = await fetch('/api/classroom/solicitacoes-acesso', { credentials: 'include' });
        if (!resp.ok) return;
        const lista = await resp.json();
        const pendentes = lista.filter(s => s.status === 'pendente');
        const solBadge = document.getElementById('clSolicitacoesBadge');
        if (solBadge) {
            if (pendentes.length > 0) {
                solBadge.textContent = pendentes.length;
                solBadge.style.display = '';
            } else {
                solBadge.style.display = 'none';
            }
        }
        const solLista = document.getElementById('clSolicitacoesLista');
        if (!solLista) return;
        if (!lista.length) {
            solLista.innerHTML = '<div style="color:var(--text-secondary,#9ca3af);text-align:center;padding:8px">Nenhuma solicitação.</div>';
            return;
        }
        solLista.innerHTML = lista.map(s => {
            const data = new Date(s.criado_em).toLocaleDateString('pt-BR');
            if (s.status === 'pendente') {
                return `<div style="padding:8px 0;border-bottom:1px solid var(--border,#e5e7eb)">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div>
                            <div style="font-weight:600;font-size:.88rem;color:var(--text-primary,#111)">${s.pedagogo_nome || s.pedagogo_email}</div>
                            <div style="font-size:.78rem;color:var(--text-secondary,#666)">${s.pedagogo_email} &middot; ${data}</div>
                            ${s.mensagem ? `<div style="font-size:.8rem;color:var(--text-secondary,#888);margin-top:2px;font-style:italic">"${s.mensagem}"</div>` : ''}
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;margin-top:6px">
                        <button onclick="responderSolicitacao(${s.id},true)" style="flex:1;padding:5px 0;background:#22c55e;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:.78rem;font-weight:600">Aprovar</button>
                        <button onclick="responderSolicitacao(${s.id},false)" style="flex:1;padding:5px 0;background:#ef4444;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:.78rem;font-weight:600">Recusar</button>
                    </div>
                </div>`;
            }
            const statusLabel = s.status === 'aprovado' ? 'Aprovado' : 'Recusado';
            const statusColor = s.status === 'aprovado' ? '#22c55e' : '#ef4444';
            return `<div style="padding:6px 0;border-bottom:1px solid var(--border,#e5e7eb);opacity:.7">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:.84rem;color:var(--text-primary,#111)">${s.pedagogo_nome || s.pedagogo_email}</span>
                    <span style="font-size:.72rem;font-weight:600;color:${statusColor}">${statusLabel}</span>
                </div>
            </div>`;
        }).join('');
    } catch (_) {}
}

async function responderSolicitacao(id, aceitar) {
    const acao = aceitar ? 'aprovar' : 'recusar';
    if (!await confirmar(
        aceitar ? 'Deseja aprovar esta solicitação e conceder acesso pedagógico?' : 'Deseja recusar esta solicitação?',
        { titulo: aceitar ? 'Aprovar solicitação' : 'Recusar solicitação', confirmLabel: aceitar ? 'Aprovar' : 'Recusar', tipo: aceitar ? 'info' : 'danger', icone: aceitar ? '✅' : '❌' }
    )) return;
    try {
        const resp = await fetch(`/api/classroom/solicitacoes-acesso/${id}/responder`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aceitar }),
        });
        if (!resp.ok) { const d = await resp.json(); toast(d.erro || 'Erro', 'erro'); return; }
        toast(aceitar ? 'Acesso concedido!' : 'Solicitação recusada.', 'ok');
        carregarSolicitacoesAcesso();
        if (aceitar) carregarPedagogos();
    } catch (e) {
        toast('Erro: ' + e.message, 'erro');
    }
}

/* ══════════════════════════════════════════════════════════════
   INICIA
══════════════════════════════════════════════════════════════ */
init();
