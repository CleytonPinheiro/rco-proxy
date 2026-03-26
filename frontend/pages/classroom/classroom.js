'use strict';

/* ── Estado global ── */
let cursoAtivo   = null;   // { id, nome, link }
let ativAtiva    = null;   // { id, titulo, pontos }
let alunos       = {};     // { [userId]: { nome, email, foto } }
let submissions  = [];     // array de entregas
let todasNotas   = [];     // cache para filtragem

/* ── Elementos ── */
const elConnectScreen  = document.getElementById('clConnectScreen');
const elConnectDesc    = document.getElementById('clConnectDesc');
const elWorkspace      = document.getElementById('clWorkspace');
const elBtnConectar    = document.getElementById('clBtnConectar');
const elSemCredenciais = document.getElementById('clSemCredenciais');
const elCursoLista     = document.getElementById('clCursoLista');
const elAtivLista      = document.getElementById('clAtivLista');
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

/* ── Inicialização ── */
async function init() {
    // Verifica params de retorno do OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.has('sucesso')) toast('Conectado com sucesso ao Google Classroom!', 'ok');
    if (params.has('erro')) {
        const erros = {
            acesso_negado:  'Acesso negado pelo Google.',
            sem_credenciais:'Credenciais não configuradas.',
            falha_auth:     'Falha na autenticação Google.',
        };
        toast(erros[params.get('erro')] || 'Erro desconhecido.', 'erro');
    }
    // Limpa params da URL
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

    // Já conectado
    elConnectScreen.style.display = 'none';
    elWorkspace.style.display     = 'grid';
    if (status.email) elContaBadge.textContent = '🔗 ' + status.email;
    carregarCursos();
}

/* ── Conectar ── */
elBtnConectar.addEventListener('click', async () => {
    try {
        const { url } = await api('/auth-url');
        // Tenta navegar o frame raiz; se bloqueado por sandbox, abre em nova aba
        try {
            window.top.location.href = url;
        } catch (_) {
            window.open(url, '_blank', 'noopener');
        }
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
    cursoAtivo  = null;
    ativAtiva   = null;
    alunos      = {};
    carregarCursos();
    elAtivLista.innerHTML  = '<div class="cl-empty-state"><p>← Selecione uma disciplina</p></div>';
    elNotasLista.innerHTML = '<div class="cl-empty-state"><p>← Selecione uma atividade</p></div>';
    elAtivCount.textContent  = 'Selecione uma disciplina';
    elNotasCount.textContent = 'Selecione uma atividade';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'none';
});

/* ── Cursos ── */
const CURSO_CORES = ['#4285F4','#EA4335','#34A853','#FBBC05','#8B5CF6','#EC4899','#14B8A6','#F97316'];

async function carregarCursos() {
    elCursoLista.innerHTML = '<div class="cl-loading">Carregando disciplinas...</div>';
    elCursosCount.textContent = '—';
    try {
        const cursos = await api('/courses');
        if (!cursos.length) {
            elCursoLista.innerHTML = '<div class="cl-empty-state"><p>Nenhum curso encontrado.</p></div>';
            elCursosCount.textContent = '0 disciplinas';
            return;
        }
        elCursosCount.textContent = `${cursos.length} disciplina${cursos.length !== 1 ? 's' : ''}`;
        elCursoLista.innerHTML = '';
        cursos.forEach((c, i) => {
            const cor = CURSO_CORES[i % CURSO_CORES.length];
            const item = document.createElement('div');
            item.className = 'cl-curso-item';
            item.dataset.id = c.id;
            item.innerHTML = `
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
    cursoAtivo = curso;
    ativAtiva  = null;

    // Exibe link do curso
    elAtivLink.href = curso.link || '#';
    elAtivLink.style.display = curso.link ? 'flex' : 'none';

    // Reset notas
    elNotasLista.innerHTML   = '<div class="cl-empty-state"><p>← Selecione uma atividade</p></div>';
    elNotasCount.textContent = 'Selecione uma atividade';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'none';

    elAtivCount.textContent = 'Carregando...';
    elAtivLista.innerHTML   = '<div class="cl-loading">Carregando atividades...</div>';

    // Carrega alunos e atividades em paralelo
    try {
        const [atividades, estudantes] = await Promise.all([
            api(`/courses/${curso.id}/coursework`),
            api(`/courses/${curso.id}/students`),
        ]);

        // Indexa alunos
        alunos = {};
        estudantes.forEach(a => { alunos[a.userId] = a; });

        // Renderiza atividades
        if (!atividades.length) {
            elAtivLista.innerHTML   = '<div class="cl-empty-state"><p>Nenhuma atividade encontrada.</p></div>';
            elAtivCount.textContent = '0 atividades';
            return;
        }
        elAtivCount.textContent = `${atividades.length} atividade${atividades.length !== 1 ? 's' : ''}`;
        elAtivLista.innerHTML = '';
        atividades.forEach(a => {
            const item = document.createElement('div');
            item.className = 'cl-ativ-item';
            const tipoCls = `cl-ativ-tipo--${a.tipo || 'ASSIGNMENT'}`;
            const tipoLabel = TIPO_LABELS[a.tipo] || a.tipo || 'Atividade';
            item.innerHTML = `
                <div class="cl-ativ-header">
                    <span class="cl-ativ-titulo" title="${esc(a.titulo)}">${esc(a.titulo)}</span>
                    ${a.pontos !== null ? `<span class="cl-ativ-pontos">${a.pontos} pts</span>` : ''}
                </div>
                <div class="cl-ativ-meta">
                    <span class="cl-ativ-tipo-badge ${tipoCls}">${tipoLabel}</span>
                    ${a.prazo ? `<span class="cl-ativ-meta-chip">📅 ${a.prazo}</span>` : ''}
                </div>`;
            item.addEventListener('click', () => selecionarAtividade(a, item));
            elAtivLista.appendChild(item);
        });
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
                        turmas adicionadas como co-professor. Contas Gmail não têm essa restrição.<br><br>
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
            elAtivLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
            elAtivCount.textContent = 'Erro';
        }
        toast(semPermissao ? 'Acesso bloqueado pelo Workspace da escola.' : e.message, 'erro');
    }
}

/* ── Atividade ── */
async function selecionarAtividade(ativ, itemEl) {
    document.querySelectorAll('.cl-ativ-item--ativo').forEach(el => el.classList.remove('cl-ativ-item--ativo'));
    itemEl.classList.add('cl-ativ-item--ativo');
    ativAtiva = ativ;

    elNotasCount.textContent     = 'Carregando...';
    elNotasStats.style.display   = 'none';
    elNotasFiltro.style.display  = 'none';
    elNotasActions.style.display = 'none';
    elNotasLista.innerHTML       = '<div class="cl-loading">Carregando entregas...</div>';
    elBusca.value                = '';
    elFiltroStatus.value         = '';

    try {
        submissions = await api(`/courses/${cursoAtivo.id}/coursework/${ativ.id}/submissions`);

        // Enriquecer com dados dos alunos
        todasNotas = submissions.map(s => ({
            ...s,
            aluno: alunos[s.userId] || { nome: 'Aluno ' + s.userId, email: '', foto: null },
        })).sort((a, b) => (a.aluno.nome || '').localeCompare(b.aluno.nome || ''));

        elNotasCount.textContent = `${todasNotas.length} aluno${todasNotas.length !== 1 ? 's' : ''}`;
        elNotasStats.style.display   = 'grid';
        elNotasFiltro.style.display  = 'flex';
        elNotasActions.style.display = 'flex';
        atualizarStats();
        renderNotas();
    } catch (e) {
        elNotasLista.innerHTML = `<div class="cl-empty-state" style="color:#dc2626">${e.message}</div>`;
        toast(e.message, 'erro');
    }
}

/* ── Stats ── */
function atualizarStats() {
    const total     = todasNotas.length;
    const entregues = todasNotas.filter(n => n.entregue || n.estado === 'RETURNED').length;
    const pendentes = todasNotas.filter(n => !n.entregue && n.estado !== 'RETURNED').length;
    const comNota   = todasNotas.filter(n => n.nota !== null);
    const media     = comNota.length ? (comNota.reduce((s, n) => s + n.nota, 0) / comNota.length).toFixed(1) : '—';

    document.getElementById('clStTotal').textContent    = total;
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

/* ── Renderizar lista de notas ── */
function renderNotas() {
    const lista = filtrarNotas();
    if (!lista.length) {
        elNotasLista.innerHTML = '<div class="cl-empty-state"><p>Nenhum aluno encontrado com os filtros.</p></div>';
        return;
    }

    const maxPts = ativAtiva?.pontos ?? null;

    elNotasLista.innerHTML = `
        <div class="cl-nota-row cl-nota-row--header">
            <span></span>
            <span>Aluno</span>
            <span style="text-align:center">Status</span>
            <span style="text-align:center">Nota${maxPts !== null ? ` /${maxPts}` : ''}</span>
            <span style="text-align:center">Ação</span>
        </div>
        ${lista.map(n => renderNotaRow(n)).join('')}`;

    // Eventos de edição de nota
    elNotasLista.querySelectorAll('.cl-nota-input').forEach(input => {
        input.addEventListener('change', () => salvarNota(input));
    });
    elNotasLista.querySelectorAll('.cl-btn-devolver').forEach(btn => {
        btn.addEventListener('click', () => devolverEntrega(btn));
    });
}

function renderNotaRow(n) {
    const a = n.aluno;
    const iniciais = (a.nome || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const fotoHtml = a.foto
        ? `<img src="${esc(a.foto)}" alt="" loading="lazy"/>`
        : iniciais;

    let statusLabel, statusCls;
    if (n.estado === 'RETURNED') { statusLabel = 'Devolvido'; statusCls = 'devolvido'; }
    else if (n.atrasado)          { statusLabel = 'Atrasado';  statusCls = 'atrasado'; }
    else if (n.entregue)          { statusLabel = 'Entregue';  statusCls = 'entregue'; }
    else                          { statusLabel = 'Pendente';  statusCls = 'pendente'; }

    const inputVal = n.nota !== null ? n.nota : '';
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
            method: 'PATCH',
            body: { nota: nova === '' ? null : Number(nova) },
        });
        input.classList.add('cl-nota-input--salva');
        input.dataset.original = nova;
        // Atualiza em memória
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

    btn.disabled   = true;
    btn.textContent = '...';
    try {
        await api(`/courses/${cursoAtivo.id}/coursework/${ativAtiva.id}/submissions/${subId}/return`, {
            method: 'POST',
        });
        // Atualiza em memória
        const sub = todasNotas.find(n => n.id === subId);
        if (sub) { sub.estado = 'RETURNED'; }
        toast('Entrega devolvida!', 'ok');
        atualizarStats();
        renderNotas();
    } catch (e) {
        toast('Erro: ' + e.message, 'erro');
        btn.disabled   = false;
        btn.textContent = 'Devolver';
    }
}

/* ── Exportar CSV ── */
elBtnExportar.addEventListener('click', () => {
    const lista  = filtrarNotas();
    const titulo = ativAtiva?.titulo || 'atividade';
    const curso  = cursoAtivo?.nome  || 'disciplina';
    const maxPts = ativAtiva?.pontos ?? '';

    let csv = `Disciplina,Atividade,Pontuação máxima\n"${curso}","${titulo}","${maxPts}"\n\n`;
    csv    += 'Nº,Aluno,Email,Status,Nota\n';
    lista.forEach((n, i) => {
        const status = n.estado === 'RETURNED' ? 'Devolvido'
            : n.atrasado ? 'Atrasado'
            : n.entregue ? 'Entregue' : 'Pendente';
        csv += `${i + 1},"${n.aluno.nome || ''}","${n.aluno.email || ''}","${status}","${n.nota ?? ''}"\n`;
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${curso} – ${titulo}.csv`.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exportado!', 'ok');
});

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

/* ── Inicia ── */
init();
