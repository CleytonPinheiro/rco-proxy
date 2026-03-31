'use strict';

/* ══════════════════════════════════════════════════════════════════
   Modal de confirmação — substitui confirm() nativo
   Uso: await confirmar('Mensagem', { titulo, confirmLabel, tipo, icone })
   Retorna: true (confirmou) | false (cancelou)
══════════════════════════════════════════════════════════════════ */
function confirmar(mensagem, { titulo = 'Confirmar ação', confirmLabel = 'Confirmar', tipo = 'info', icone } = {}) {
    return new Promise(resolve => {
        const overlay  = document.getElementById('clConfirmModal');
        const elTitulo = document.getElementById('clConfirmTitulo');
        const elMsg    = document.getElementById('clConfirmMsg');
        const elIcone  = document.getElementById('clConfirmIcone');
        const elOk     = document.getElementById('clConfirmOk');
        const elCancel = document.getElementById('clConfirmCancelar');
        const elModal  = overlay.querySelector('.cl-confirm-modal');

        elTitulo.textContent = titulo;
        elMsg.textContent    = mensagem;
        elOk.textContent     = confirmLabel;

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

/* ── Estado global ── */
let cursoAtivo      = null;   // { id, nome, link }
let ativAtiva       = null;   // { id, titulo, pontos }
let grupoAtivo      = null;   // { id, nome, pontosMeta, cor, atividades }
let viewMode        = 'atividades'; // 'atividades' | 'grupos' | 'auditoria'
let alunos          = {};     // { [userId]: { nome, email, foto } }
let submissions     = [];     // entregas da atividade individual
let todasNotas      = [];     // cache filtrado da atividade individual
let atividadesCache = [];     // todas atividades do curso atual
let gruposCache     = [];     // todos grupos do curso atual
let auditResultado  = null;   // resultado da auditoria { atividades, semCorrespondencia }
let auditAtivAtiva  = null;   // atividade selecionada no modo auditoria
let auditCodClasse  = null;   // codClasse vinculado ao curso atual
let corSelecionada  = '#4285F4';
let acessosCache    = null;   // cache do /api/acessos para o seletor RCO
let grupoResumoData  = null;   // { atividades, alunosResumo, meta } do grupo aberto
let filtrosGrupoAtivos = new Set(['todos']); // filtros de faixa de cor ativos (múltiplos)

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
const elBusca          = document.getElementById('clBuscaAluno');
const elFiltroStatus   = document.getElementById('clFiltroStatus');
const elToast          = document.getElementById('clToast');
const elTabs           = document.getElementById('clTabs');
const elTabAtiv        = document.getElementById('clTabAtiv');
const elTabGrupos      = document.getElementById('clTabGrupos');
const elTabAudit       = document.getElementById('clTabAudit');
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

/* ── Escala RCO: divide por 10, 1 casa decimal ── */
const rco = v => (v != null && v !== '' ? (Number(v) / 10).toFixed(1) : '—');

/* ── API helper (prefixo /api/classroom) ── */
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

/* ── API raw (/api/...) ── */
async function apiRaw(path, opts = {}) {
    const r = await fetch('/api' + path, {
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
    elGrupoLista.innerHTML    = '<div class="cl-empty-state"><p>Nenhum grupo criado.<br>Clique em <strong>+</strong> para criar.</p></div>';
    elAtivCount.textContent   = 'Selecione uma disciplina';
    elColAtivTitulo.textContent = 'Atividades';
    elTabs.style.display      = 'none';
    elBtnNovoGrupo.style.display = 'none';
    elAtivLink.style.display  = 'none';
    elAuditResults.style.display = 'none';
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

        /* Atribui cor permanente por índice global */
        const cursosComCor = cursos.map((c, i) => ({ ...c, cor: CURSO_CORES[i % CURSO_CORES.length] }));

        /* Agrupa por turma */
        const grupos = {};
        cursosComCor.forEach(c => {
            const turma = extrairTurma(c.nome);
            if (!grupos[turma]) grupos[turma] = [];
            grupos[turma].push(c);
        });

        /* Ordena turmas e dentro de cada turma ordena por nome */
        const turmasOrdenadas = Object.keys(grupos).sort(ordenarTurmas);
        turmasOrdenadas.forEach(t => {
            grupos[t].sort((a, b) => a.nome.localeCompare(b.nome));
        });

        elCursoLista.innerHTML = '';

        turmasOrdenadas.forEach(turma => {
            /* Cabeçalho de turma */
            const hdr = document.createElement('div');
            hdr.className = 'cl-turma-header';
            hdr.textContent = turma;
            elCursoLista.appendChild(hdr);

            /* Itens da turma */
            grupos[turma].forEach(c => {
                const item = document.createElement('div');
                item.className  = 'cl-curso-item';
                item.dataset.id = c.id;
                item.innerHTML  = `
                    <div class="cl-curso-cor" style="background:${c.cor}"></div>
                    <div class="cl-curso-info">
                        <div class="cl-curso-nome" title="${esc(c.nome)}">${esc(c.nome)}</div>
                        <div class="cl-curso-secao">${esc(c.secao || 'Sem seção')}</div>
                    </div>`;
                item.addEventListener('click', () => selecionarCurso(c, item, c.cor));
                elCursoLista.appendChild(item);
            });
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
    elTabGrupos.classList.toggle('cl-tab--ativo', tab === 'grupos');
    elTabAudit.classList.toggle('cl-tab--ativo', tab === 'auditoria');

    elAtivLista.style.display        = tab === 'atividades' ? '' : 'none';
    elGrupoLista.style.display       = tab === 'grupos' ? '' : 'none';
    elAuditPanel.style.display       = tab === 'auditoria' ? '' : 'none';
    elAtivLink.style.display         = tab === 'atividades' && cursoAtivo?.link ? 'flex' : 'none';
    elBtnNovoGrupo.style.display     = tab === 'grupos' && cursoAtivo ? 'flex' : 'none';
    elColAtivTitulo.textContent      = tab === 'grupos' ? 'Grupos' : tab === 'auditoria' ? 'Auditoria' : 'Atividades';

    if (tab === 'atividades') {
        elAtivCount.textContent = atividadesCache.length
            ? `${atividadesCache.length} atividade${atividadesCache.length !== 1 ? 's' : ''}`
            : 'Selecione uma disciplina';
    } else if (tab === 'grupos') {
        elAtivCount.textContent = gruposCache.length
            ? `${gruposCache.length} grupo${gruposCache.length !== 1 ? 's' : ''}`
            : 'Nenhum grupo criado';
    } else {
        elAtivCount.textContent = auditResultado
            ? `${auditResultado.atividades.length} atividade${auditResultado.atividades.length !== 1 ? 's' : ''} auditadas`
            : 'Selecione o vinculo RCO';
    }

    if (tab === 'atividades' && (grupoAtivo || auditAtivAtiva)) {
        grupoAtivo     = null;
        auditAtivAtiva = null;
        resetColuna3();
    }
    if (tab === 'grupos' && (ativAtiva || auditAtivAtiva)) {
        ativAtiva      = null;
        auditAtivAtiva = null;
        resetColuna3();
    }
    if (tab === 'auditoria' && cursoAtivo) {
        ativAtiva  = null;
        grupoAtivo = null;
        prepararAuditSelector();
        if (auditResultado) renderAuditAtividades();
    }
}

elTabAtiv.addEventListener('click', () => setTab('atividades'));
elTabGrupos.addEventListener('click', () => setTab('grupos'));
elTabAudit.addEventListener('click', () => setTab('auditoria'));

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
    const media     = comNota.length ? rco(comNota.reduce((s, n) => s + n.nota, 0) / comNota.length) : '—';

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

    const inputVal     = n.nota !== null ? (n.nota / 10).toFixed(1) : '';
    const podeDevolver = n.entregue && n.estado !== 'RETURNED';
    const ausenteBadge = n.ausente
        ? `<span class="cl-ausente-badge" title="Aluno estava ausente neste dia — zero aplicado pela auditoria">AUSENTE</span>`
        : '';

    const numBadgeNota = a.numChamada ? `<span class="cl-num-chamada">${a.numChamada}</span>` : '';
    return `<div class="cl-nota-row${n.ausente ? ' cl-nota-row--ausente' : ''}" data-user="${n.userId}" data-sub="${n.id}">
        <div class="cl-nota-avatar">${fotoHtml}</div>
        <div class="cl-nota-nome" title="${esc(a.email)}">${numBadgeNota}${esc(a.nome || '—')}${ausenteBadge}</div>
        <div style="text-align:center">
            <span class="cl-nota-status-badge cl-nota-status--${statusCls}">${statusLabel}</span>
        </div>
        <div>
            <input class="cl-nota-input" type="number" min="0" max="${ativAtiva?.pontos != null ? (ativAtiva.pontos / 10).toFixed(1) : 10}"
                step="0.1" value="${inputVal}" placeholder="—"
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
        // Converte de volta para escala Classroom (×10) antes de enviar
        const notaInterno = nova === '' ? null : Math.round(Number(nova) * 10);
        await api(`/courses/${cursoAtivo.id}/coursework/${ativAtiva.id}/submissions/${subId}/grade`, {
            method: 'PATCH', body: { nota: notaInterno },
        });
        input.classList.add('cl-nota-input--salva');
        input.dataset.original = nova;
        const sub = todasNotas.find(n => n.id === subId);
        if (sub) sub.nota = notaInterno;   // mantém escala interna em todasNotas
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
elBtnImprimir.addEventListener('click', () => {
    if (grupoAtivo) imprimirRelatorioGrupo();
});

elBtnAtualizar.addEventListener('click', () => {
    if (grupoAtivo) carregarResumoGrupo(grupoAtivo);
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
                    <span class="cl-grupo-pts">${rco(g.pontosMeta)} pts</span>
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

    elNotasTitulo.textContent    = `Soma — ${grupo.nome}`;
    elNotasCount.textContent     = 'Carregando...';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'flex';
    elBtnImprimir.style.display  = 'inline-flex';
    elNotasLista.innerHTML       = '<div class="cl-loading">Calculando somas...</div>';

    if (!grupo.atividades.length) {
        elNotasLista.innerHTML   = '<div class="cl-empty-state"><p>Este grupo não tem atividades.<br>Edite o grupo para adicionar.</p></div>';
        elNotasCount.textContent = '0 atividades';
        return;
    }

    await carregarResumoGrupo(grupo);
}

async function carregarResumoGrupo(grupo) {
    if (!grupo || !grupo.atividades.length) return;

    elNotasLista.innerHTML     = '<div class="cl-loading">Calculando somas...</div>';
    elNotasCount.textContent   = 'Carregando...';
    elNotasStats.style.display = 'none';

    elBtnAtualizar.disabled = true;
    elBtnAtualizarIcon.style.animation = 'clSpinIcon 0.8s linear infinite';

    try {
        const resumo = await api(`/groups/${grupo.id}/summary?courseId=${cursoAtivo.id}`);

        const meta = grupo.pontosMeta;

        const alunosResumo = resumo.alunos.map(a => ({
            ...a,
            aluno: alunos[a.userId] || { nome: 'Aluno ' + a.userId, email: '', foto: null },
            soma: ((a.mediaIndice ?? 0) / 100) * meta,
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
        document.getElementById('clStEntreguesLabel').textContent = 'Completos';
        document.getElementById('clStPendentes').textContent      = pend;
        document.getElementById('clStPendentesLabel').textContent = 'Com pendências';
        document.getElementById('clStMedia').textContent          = media;
        elNotasCount.textContent   = `${total} aluno${total !== 1 ? 's' : ''}`;
        elNotasStats.style.display = 'grid';

        if (!alunosResumo.length) {
            elNotasLista.innerHTML = '<div class="cl-empty-state"><p>Nenhum aluno encontrado nas atividades do grupo.</p></div>';
            return;
        }

        grupoResumoData    = { atividades: resumo.atividades, alunosResumo, meta };
        filtrosGrupoAtivos = new Set(['todos']);
        renderListaFiltrada();

        toast('Dados atualizados do Classroom', 'ok');

    } catch (e) {
        elNotasLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    } finally {
        elBtnAtualizar.disabled = false;
        elBtnAtualizarIcon.style.animation = '';
    }
}

function faixaCor(soma, meta) {
    const pct = meta > 0 ? Math.min(100, (soma / meta) * 100) : 0;
    if (pct >= 100) return 'meta';
    if (pct >= 60)  return 'prog';
    return 'abaixo';
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
    const { alunosResumo, meta, atividades } = grupoResumoData;

    // Contagens por faixa
    const nMeta   = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'meta').length;
    const nProg   = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'prog').length;
    const nAbaixo = alunosResumo.filter(a => faixaCor(a.soma, meta) === 'abaixo').length;
    const nTodos  = alunosResumo.length;

    const chip = (key, cor, label, count) => {
        const ativo  = filtrosGrupoAtivos.has(key) ? ' cl-faixa-chip--ativo' : '';
        const pctStr = nTodos > 0 ? Math.round((count / nTodos) * 100) + '%' : '0%';
        const numLabel = key === 'todos' ? count : `${count} · ${pctStr}`;
        return `<button class="cl-faixa-chip${ativo}" data-faixa="${key}" style="--chip-cor:${cor}">
            <span class="cl-faixa-dot" style="background:${cor}"></span>${label}
            <span class="cl-faixa-num">${numLabel}</span>
        </button>`;
    };

    const filtrados = filtrosGrupoAtivos.has('todos')
        ? alunosResumo
        : alunosResumo.filter(a => filtrosGrupoAtivos.has(faixaCor(a.soma, meta)));

    elNotasLista.innerHTML = `
        <div class="cl-passos-legenda">
            <span class="cl-legenda-item"><span class="cl-legenda-dot" style="background:#10b981"></span>Nota lançada</span>
            <span class="cl-legenda-item"><span class="cl-legenda-dot" style="background:#4285F4"></span>Entregue</span>
            <span class="cl-legenda-item"><span class="cl-legenda-dot" style="background:var(--border)"></span>Pendente</span>
            <span class="cl-legenda-hint">Clique no aluno para ver detalhes</span>
        </div>
        <div class="cl-faixa-filtros">
            ${chip('todos',  '#6b7280', 'Todos',      nTodos)}
            ${chip('meta',   '#10b981', 'Meta',        nMeta)}
            ${chip('prog',   '#4285F4', 'Em progresso', nProg)}
            ${chip('abaixo', '#f59e0b', 'Abaixo',     nAbaixo)}
        </div>
        <div class="cl-resumo-header">
            <span></span>
            <span>Aluno</span>
            <span>Soma / ${rco(meta)} pts</span>
            <span style="text-align:center">Pendentes</span>
        </div>
        <div class="cl-faixa-lista" id="clFaixaLista">
            ${filtrados.length
                ? filtrados.map(a => renderResumoRow(a, meta, atividades)).join('')
                : `<div class="cl-empty-state"><p>Nenhum aluno nessa faixa.</p></div>`}
        </div>`;

    // Chips → toggle
    elNotasLista.querySelectorAll('.cl-faixa-chip').forEach(btn => {
        btn.addEventListener('click', () => toggleFiltro(btn.dataset.faixa));
    });

    // Rows → detalhe do aluno
    elNotasLista.querySelectorAll('.cl-resumo-row').forEach((row, i) => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => mostrarDetalheAluno(filtrados[i], atividades, meta));
    });
}

function renderResumoRow(a, meta, atividades = []) {
    const al       = a.aluno;
    const iniciais = (al.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = al.foto ? `<img src="${esc(al.foto)}" alt="" loading="lazy"/>` : iniciais;
    const soma     = a.soma ?? 0;
    const pct      = meta > 0 ? Math.min(100, (soma / meta) * 100) : 0;
    const somaCor  = pct >= 100 ? '#10b981' : pct >= 60 ? '#4285F4' : '#f59e0b';

    // Barra de passos: um segmento por atividade
    const stepsHtml = atividades.map(atv => {
        const sub  = a.atividades?.[atv.id];
        const nota = sub?.nota ?? null;
        const ent  = sub?.entregue ?? false;
        // verde = nota lançada | azul = entregue s/ nota | cinza = pendente
        const cor   = nota !== null ? '#10b981' : ent ? '#4285F4' : 'var(--border)';
        const label = nota !== null
            ? `${atv.titulo}: ${rco(nota)}${atv.pontos != null ? '/' + rco(atv.pontos) : ''} pts`
            : ent ? `${atv.titulo}: Entregue` : `${atv.titulo}: Pendente`;
        return `<span class="cl-passo" style="background:${cor}" title="${esc(label)}"></span>`;
    }).join('');

    const numBadge = al.numChamada ? `<span class="cl-num-chamada">${al.numChamada}</span>` : '';
    return `<div class="cl-resumo-row">
        <div class="cl-nota-avatar">${fotoHtml}</div>
        <div class="cl-resumo-info">
            <div class="cl-nota-nome" title="${esc(al.email)}">${numBadge}${esc(al.nome || '—')}</div>
            <div class="cl-passos-barra">${stepsHtml || '<span class="cl-passos-vazia">—</span>'}</div>
        </div>
        <div class="cl-resumo-soma">
            <span class="cl-resumo-num" style="color:${somaCor}">${rco(soma)}</span>
            <span class="cl-resumo-den">/${rco(meta)}</span>
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
    <title>Relatório — ${grupo}</title>
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
function mostrarDetalheAluno(alunoData, atividades, meta) {
    const al      = alunoData.aluno;
    const iniciais = (al.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = al.foto ? `<img src="${esc(al.foto)}" alt="" loading="lazy"/>` : iniciais;
    const soma     = alunoData.soma ?? 0;
    const pct      = meta > 0 ? Math.min(100, (soma / meta) * 100) : 0;
    const barCor   = pct >= 100 ? '#10b981' : pct >= 60 ? '#4285F4' : '#f59e0b';

    // Preparar linhas de atividade
    const rows = atividades.map(atv => {
        const sub      = alunoData.atividades?.[atv.id];
        const nota     = sub?.nota ?? null;
        const entregue = sub?.entregue ?? false;
        const atrasado = sub?.atrasado ?? false;
        const estado   = sub?.estado ?? null;

        let statusHtml, tipo;
        if (nota !== null) {
            const ptMax  = atv.pontos ?? 100;
            const pctAtv = ptMax > 0 ? ((nota / ptMax) * 100).toFixed(0) : nota;
            statusHtml   = `<span class="cl-nota-status-badge cl-nota-status--entregue">${rco(nota)} / ${rco(ptMax)} pts &nbsp;(${pctAtv}%)</span>`;
            tipo = 'realizada';
        } else if (entregue) {
            statusHtml = `<span class="cl-nota-status-badge cl-nota-status--pendente">Entregue – sem nota</span>`;
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

        return { atv, statusHtml, tipo, nota, entregue };
    });

    const totalAtiv     = atividades.length;
    const realizadas    = rows.filter(r => r.tipo === 'realizada').length;
    const naoRealizadas = rows.filter(r => r.tipo === 'nao-realizada').length;

    const rowsHtml = rows.map(r => `
        <div class="cl-detalhe-row" data-tipo="${r.tipo}">
            <div class="cl-detalhe-row-titulo">${esc(r.atv.titulo)}</div>
            <div class="cl-detalhe-row-status">${r.statusHtml}</div>
        </div>`).join('');

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
                    <div class="cl-detalhe-soma" style="color:${barCor}">
                        ${rco(soma)} / ${rco(meta)} pts
                        <span class="cl-detalhe-pct">(${pct.toFixed(0)}%)</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="cl-detalhe-tabs">
            <button class="cl-detalhe-tab cl-detalhe-tab--ativa" data-filtro="todas">
                Todas <span class="cl-detalhe-tab-cnt">${totalAtiv}</span>
            </button>
            <button class="cl-detalhe-tab" data-filtro="realizada">
                Realizadas <span class="cl-detalhe-tab-cnt cl-tab-cnt--ok">${realizadas}</span>
            </button>
            <button class="cl-detalhe-tab" data-filtro="nao-realizada">
                Não realizadas <span class="cl-detalhe-tab-cnt cl-tab-cnt--err">${naoRealizadas}</span>
            </button>
        </div>

        <div class="cl-detalhe-lista" id="clDetalheLista">
            ${rowsHtml}
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
        });
    });

    // Voltar
    document.getElementById('clDetalheVoltar').addEventListener('click', () => {
        if (grupoAtivo) selecionarGrupo(grupoAtivo, document.querySelector('.cl-grupo-item--ativo'));
    });
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
        elGrupoPontos.value       = (grupo.pontosMeta / 10).toFixed(1);
        corSelecionada            = grupo.cor;
    } else {
        elModalTitulo.textContent = 'Novo Grupo';
        elGrupoId.value           = '';
        elGrupoNome.value         = '';
        elGrupoPontos.value       = 4;
        corSelecionada            = GRUPO_CORES[gruposCache.length % GRUPO_CORES.length];
    }

    elCorPicker.querySelectorAll('.cl-cor-btn').forEach(b => {
        b.classList.toggle('cl-cor-btn--ativo', b.style.background === corSelecionada ||
            b.title === corSelecionada);
    });

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
                ${a.pontos !== null ? `<span class="cl-ativ-pontos">${rco(a.pontos)} pts</span>` : ''}
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
    const nome      = elGrupoNome.value.trim();
    const pontos    = Math.round((Number(elGrupoPontos.value) || 4) * 10);
    const id        = elGrupoId.value;

    if (!nome) { elGrupoNome.focus(); toast('Informe o nome do grupo.', 'erro'); return; }
    if (!cursoAtivo) { toast('Selecione uma disciplina primeiro.', 'erro'); return; }

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

/* ── Carrega acessos e popula seletor de classe RCO ── */
async function prepararAuditSelector() {
    if (!cursoAtivo) return;

    // Recuperar classe salva para este curso
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

    // Deduplicar por codClasse
    const vistas = new Set();
    const classesUnicas = classes.filter(c => {
        if (vistas.has(c.codClasse)) return false;
        vistas.add(c.codClasse);
        return true;
    }).sort((a, b) => (a.descrTurma + a.nomeDisciplina).localeCompare(b.descrTurma + b.nomeDisciplina));

    elAuditClasseSel.innerHTML = '<option value="">— selecione a turma/disciplina —</option>';
    classesUnicas.forEach(c => {
        const opt = document.createElement('option');
        opt.value       = c.codClasse;
        opt.textContent = `${c.descrTurma} — ${c.nomeDisciplina}`;
        if (String(c.codClasse) === String(savedClasse)) opt.selected = true;
        elAuditClasseSel.appendChild(opt);
    });
    syncCustomSel();

    if (savedClasse) {
        auditCodClasse = savedClasse;
        elAuditHint.textContent = '✓ Vínculo RCO salvo para esta disciplina';
        elAuditHint.style.color = 'var(--text-muted)';
    } else {
        elAuditHint.textContent = '';
    }

    // Mostrar resultados anteriores se existirem
    if (auditResultado) {
        elAuditResults.style.display = '';
        renderAuditAtividades();
    }
}

elAuditClasseSel.addEventListener('change', () => {
    auditCodClasse = elAuditClasseSel.value || null;
    if (auditCodClasse && cursoAtivo) {
        localStorage.setItem(auditMapKey(cursoAtivo.id), auditCodClasse);
        elAuditHint.textContent = '✓ Vínculo salvo';
        elAuditHint.style.color = '#16a34a';
    } else {
        elAuditHint.textContent = '';
    }
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
    elBtnImprimir.style.display  = 'none';
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
   CUSTOM SELECT — AUDITORIA
══════════════════════════════════════════════════════════════ */
let _cselClose = null;   // fecha o dropdown de qualquer lugar

function syncCustomSel() {
    const sel   = elAuditClasseSel;
    const valEl = document.getElementById('clAuditSelVal');
    const list  = document.getElementById('clAuditSelList');
    if (!list || !valEl) return;

    list.innerHTML = '';
    [...sel.options].forEach(opt => {
        const item = document.createElement('div');
        item.className = 'cl-csel-item'
            + (opt.value === '' ? ' cl-csel-item--placeholder' : '')
            + (opt.selected  ? ' cl-csel-item--sel' : '');
        item.textContent = opt.textContent;
        item.title = opt.textContent;
        item.addEventListener('click', () => {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change'));
            syncCustomSel();
            _cselClose?.();
        });
        list.appendChild(item);
    });

    const selOpt = sel.options[sel.selectedIndex];
    const txt    = selOpt?.textContent || '— selecione a turma/disciplina —';
    valEl.textContent = txt;
    valEl.classList.toggle('cl-csel-val--placeholder', !sel.value);
}

function initCustomSel() {
    const btn  = document.getElementById('clAuditSelBtn');
    const drop = document.getElementById('clAuditSelDrop');
    if (!btn || !drop) return;

    function openDrop()  { drop.style.display = ''; btn.classList.add('cl-csel-btn--open'); }
    function closeDrop() { drop.style.display = 'none'; btn.classList.remove('cl-csel-btn--open'); }
    _cselClose = closeDrop;

    btn.addEventListener('click', e => {
        e.stopPropagation();
        drop.style.display === 'none' ? openDrop() : closeDrop();
    });
    drop.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => closeDrop());

    syncCustomSel();
}

/* ══════════════════════════════════════════════════════════════
   HANDLES DE REDIMENSIONAMENTO DE COLUNAS
══════════════════════════════════════════════════════════════ */
function initResizeHandles() {
    const workspace = document.getElementById('clWorkspace');
    if (!workspace) return;

    const MIN_W   = 150;
    const LS_KEY1 = 'cl-col1-w';
    const LS_KEY2 = 'cl-col2-w';

    let w1 = parseInt(localStorage.getItem(LS_KEY1) || '260', 10);
    let w2 = parseInt(localStorage.getItem(LS_KEY2) || '280', 10);

    function applyWidths() {
        workspace.style.gridTemplateColumns = `${w1}px 4px ${w2}px 4px 1fr`;
    }
    applyWidths();

    function setupHandle(handleEl, colIdx) {
        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
            handleEl.classList.add('cl-resize-handle--dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const startX = e.clientX;
            const startW = colIdx === 1 ? w1 : w2;

            const onMove = ev => {
                const delta = ev.clientX - startX;
                const newW  = Math.max(MIN_W, startW + delta);
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
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
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
initCustomSel();

/* ══════════════════════════════════════════════════════════════
   INICIA
══════════════════════════════════════════════════════════════ */
init();
