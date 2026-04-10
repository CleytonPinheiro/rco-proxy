'use strict';

/* ══════════════════════════════════════════════════════
   Portal do Aluno — frontend
   ══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

/* ── Estado global de solicitações ──────────────────────────────── */
let _solicitadasMap  = {};   /* courseworkId → { status, criado_em } */
let _solicitaModal   = null; /* dados da atividade no modal atual */
let _cursoAtualReq   = null; /* { cursoId, cursoNome } da atividade no modal */

/* ── Estado global de notificações bloqueantes ───────────────────── */
let _notifQueue   = [];   /* notificações não lidas aguardando exibição */
let _notifAtual   = null; /* notificação sendo exibida agora */
let _notifTimerId = null; /* id do setInterval de polling */

const TIPO_LABEL = {
    ASSIGNMENT:                  'Atividade',
    SHORT_ANSWER_QUESTION:       'Pergunta',
    MULTIPLE_CHOICE_QUESTION:    'Múltipla escolha',
    MATERIAL:                    'Material',
};

/* ── Tema ────────────────────────────────────────────── */
const TEMA_KEY = 'aluno_tema';

function temaAtual() {
    return document.documentElement.getAttribute('data-theme') || 'light';
}

function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem(TEMA_KEY, tema);
    atualizarIconeTema(tema);
}

function atualizarIconeTema(tema) {
    const icone = tema === 'dark' ? '☀️' : '🌙';
    const el1 = $('paThemeIcon');
    const el2 = $('paThemeIconPre');
    if (el1) el1.textContent = icone;
    if (el2) el2.textContent = icone;
}

function toggleTema() {
    aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark');
}

/* ── Dropdown de perfil ──────────────────────────────── */
function toggleDropdown(e) {
    e.stopPropagation();
    const wrap     = $('paPerfilWrap');
    const dropdown = $('paDropdown');
    const aberto   = wrap.classList.toggle('open');
    dropdown.style.display = aberto ? '' : 'none';
}

document.addEventListener('click', () => {
    const wrap     = $('paPerfilWrap');
    const dropdown = $('paDropdown');
    if (!wrap) return;
    wrap.classList.remove('open');
    if (dropdown) dropdown.style.display = 'none';
});

/* ── Init ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    /* Aplica ícone correto após carregamento */
    atualizarIconeTema(temaAtual());

    const params = new URLSearchParams(location.search);
    const erro   = params.get('erro');
    if (erro) {
        const msgs = {
            acesso_negado:  'Acesso negado pelo Google.',
            sem_email:      'Não foi possível obter seu e-mail. Tente novamente.',
            falha_auth:     'Erro durante a autenticação. Tente novamente.',
            sem_credenciais:'Google não configurado no servidor.',
        };
        mostrarErroLogin(msgs[erro] || 'Erro desconhecido. Tente novamente.');
        history.replaceState({}, '', '/alunos/');
    }

    await verificarStatus();
});

/* ── Verifica sessão ─────────────────────────────────── */
async function verificarStatus() {
    mostrarLoading(true);
    try {
        const resp = await fetch('/api/alunos-portal/status', { credentials: 'include' });
        const data = await resp.json();
        if (data.aluno) {
            mostrarTelaLogado(data.aluno);
            carregarAtividades();
            iniciarPollingNotificacoes();
        } else {
            mostrarTelaLogin();
            mostrarLoading(false);
        }
    } catch (_) {
        mostrarTelaLogin();
        mostrarLoading(false);
    }
}

/* ── Telas ───────────────────────────────────────────── */
function mostrarTelaLogin() {
    $('paTelalogin').style.display      = '';
    $('paTelaAtividades').style.display = 'none';
    $('paUserArea').style.display       = 'none';
    $('paThemeBtnPre').style.display    = 'flex';
}

function mostrarTelaLogado(aluno) {
    $('paTelalogin').style.display      = 'none';
    $('paTelaAtividades').style.display = '';
    $('paUserArea').style.display       = 'flex';
    $('paThemeBtnPre').style.display    = 'none';

    const inicial = (aluno.nome || aluno.email || '?')[0].toUpperCase();

    /* Header pill */
    $('paUserNome').textContent = aluno.nome ? primeiroNome(aluno.nome) : aluno.email;
    if (aluno.foto) {
        const img = $('paUserFoto');
        img.src = aluno.foto;
        img.style.display = '';
        $('paAvatarPlaceholder').style.display = 'none';
    } else {
        $('paAvatarPlaceholder').textContent  = inicial;
        $('paAvatarPlaceholder').style.display = '';
        $('paUserFoto').style.display = 'none';
    }

    /* Dropdown */
    $('paDropNome').textContent  = aluno.nome  || '';
    $('paDropEmail').textContent = aluno.email || '';
    if (aluno.foto) {
        const di = $('paDropFoto');
        di.src = aluno.foto;
        di.style.display = '';
        $('paDropPlaceholder').style.display = 'none';
    } else {
        $('paDropPlaceholder').textContent  = inicial;
        $('paDropPlaceholder').style.display = '';
        $('paDropFoto').style.display = 'none';
    }
}

function mostrarErroLogin(msg) {
    const el = $('paLoginErro');
    el.textContent   = msg;
    el.style.display = '';
}

function mostrarLoading(show) {
    $('paLoading').style.display = show ? 'flex' : 'none';
}

/* ── OAuth Google ────────────────────────────────────── */
async function entrarComGoogle() {
    const btn = $('btnEntrarGoogle');
    btn.disabled    = true;
    btn.textContent = 'Aguarde…';
    try {
        const resp = await fetch('/api/alunos-portal/auth-url', { credentials: 'include' });
        const { url, erro } = await resp.json();
        if (erro || !url) throw new Error(erro || 'URL não retornada');
        location.href = url;
    } catch (_) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="pa-google-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg> Entrar com Google`;
        mostrarErroLogin('Erro ao conectar. Verifique sua conexão e tente novamente.');
    }
}

/* ── Carrega atividades ──────────────────────────────── */
async function carregarAtividades() {
    mostrarLoading(true);
    $('paVazio').style.display           = 'none';
    $('paSemConexao').style.display      = 'none';
    $('paCursos').innerHTML              = '';
    $('paCursosZerados').innerHTML       = '';
    $('paZeradasSection').style.display  = 'none';
    $('paResumoZeradas').style.display   = 'none';
    $('paSolicitaSection').style.display = 'none';

    try {
        const [respAtiv, respSol] = await Promise.all([
            fetch('/api/alunos-portal/atividades',          { credentials: 'include' }),
            fetch('/api/alunos-portal/minhas-solicitacoes', { credentials: 'include' }),
        ]);

        if (respAtiv.status === 401) { mostrarTelaLogin(); return; }

        if (respSol.ok) {
            const solData = await respSol.json();
            _solicitadasMap = {};
            (solData.solicitacoes || []).forEach(s => {
                _solicitadasMap[s.coursework_id] = s;
            });
        }

        const data = await respAtiv.json();

        if (!respAtiv.ok) {
            $('paSemConexao').style.display  = '';
            $('paSemConexaoMsg').textContent = data.erro || 'Erro ao carregar atividades.';
            $('paResumoNum').textContent     = '0';
            return;
        }

        renderAtividades(data);
    } catch (_) {
        $('paSemConexao').style.display  = '';
        $('paSemConexaoMsg').textContent = 'Erro de conexão ao carregar atividades.';
    } finally {
        mostrarLoading(false);
    }
}

/* ── Render de um item de atividade ─────────────────── */
function renderQuizizzTag(ativ) {
    if (!ativ.quizizzId) return '';
    const isId   = /^[0-9a-f]{24}$/i.test(ativ.quizizzId);
    const link   = isId ? `https://quizizz.com/admin/quiz/${ativ.quizizzId}` : null;
    const linkPart = link
        ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="pa-qz-link">Ver quiz ↗</a>`
        : '';
    return `<div class="pa-qz-tag">
        <span class="pa-qz-ico">🎮</span>
        <span class="pa-qz-label">Quizizz</span>
        ${linkPart}
    </div>`;
}

function renderAtivItem(ativ, { zerada = false, aguardando = false, cursoId = '', cursoNome = '' } = {}) {
    const li        = document.createElement('li');
    li.className    = 'pa-atividade-item'
        + (zerada     ? ' pa-atividade-item--zerada'     : '')
        + (aguardando ? ' pa-atividade-item--aguardando' : '');

    const tipoLabel = TIPO_LABEL[ativ.tipo] || ativ.tipo;
    const tipoCls   = `pa-tipo-${ativ.tipo}`;

    const prazoPart = ativ.prazo
        ? `<span class="pa-prazo ${ativ.vencida ? 'vencida' : ''}">
               <span class="pa-prazo-icon">${ativ.vencida ? '⚠️' : '📅'}</span>
               ${esc(ativ.prazo)}
           </span>`
        : '<span class="pa-prazo"><span class="pa-prazo-icon">📅</span> Sem prazo</span>';

    const devolvidaPart = ativ.devolvida
        ? '<span class="pa-devolvida-badge">↩ Devolvida</span>' : '';

    const zerouPart = zerada
        ? '<span class="pa-zerada-badge">↩ Entrou com 0 pts</span>' : '';

    const aguardPart = aguardando
        ? '<span class="pa-aguard-badge">⏳ Realizou — aguardando correção</span>' : '';

    const pontosPart = ativ.pontos != null
        ? `<span class="pa-pontos">${ativ.pontos} pts</span>` : '';

    const qzPart = renderQuizizzTag(ativ);

    /* ── Botão / badge de reabertura (todas atividades, exceto aguardando) ── */
    /* prazo não encerrado (vencida=false) → botão discreto, pois o aluno ainda consegue acessar.
       prazo encerrado (vencida=true)      → botão destaque laranja, pois é a única saída.       */
    const reaberturaAberta = !ativ.vencida; /* prazo não encerrado → atividade "aberta" → botão discreto */
    let reaberturaPart = '';
    if (!aguardando) {
        const sol = _solicitadasMap[String(ativ.id)];
        if (!sol) {
            const dados = esc(JSON.stringify({ id: ativ.id, titulo: ativ.titulo, link: ativ.link, cursoId, cursoNome }));
            const cls      = reaberturaAberta ? 'pa-solicita-btn pa-solicita-btn--aberta' : 'pa-solicita-btn';
            const disAttr  = reaberturaAberta ? 'disabled title="Disponível apenas após o encerramento do prazo"' : '';
            const onclick  = reaberturaAberta ? '' : `onclick="abrirModalSolicitacao('${dados}')"`;
            reaberturaPart = `<button class="${cls}" ${disAttr} ${onclick}>
                <svg viewBox="0 0 16 16" fill="none" width="13" height="13" style="flex-shrink:0">
                  <path d="M2 8a6 6 0 1 0 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <path d="M2 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Solicitar reabertura
            </button>`;
        } else if (sol.status === 'pendente') {
            reaberturaPart = `<span class="pa-solicita-badge pa-solicita-badge--pendente">⏳ Reabertura solicitada</span>`;
        } else if (sol.status === 'aprovada') {
            reaberturaPart = `<span class="pa-solicita-badge pa-solicita-badge--aprovada">✅ Reabertura aprovada</span>`;
        } else if (sol.status === 'negada') {
            const dados = esc(JSON.stringify({ id: ativ.id, titulo: ativ.titulo, link: ativ.link, cursoId, cursoNome }));
            reaberturaPart = `<span class="pa-solicita-badge pa-solicita-badge--negada">❌ Reabertura negada</span>
                              <button class="pa-solicita-btn pa-solicita-btn--retry" onclick="abrirModalSolicitacao('${dados}')">Solicitar novamente</button>`;
        }
    }

    /* Botão de acesso: desabilitado quando zerada + vencida (não há como refazer) */
    let linkPart;
    if (aguardando) {
        linkPart = `<span class="pa-aguard-status">Entregue</span>`;
    } else if (zerada && ativ.vencida) {
        /* Prazo encerrado — exibe desabilitado para deixar claro o motivo */
        linkPart = `<button class="pa-link-ativ pa-link-ativ--zerada pa-link-ativ--desabilitado"
                        disabled title="Prazo encerrado — solicite a reabertura ao professor">
                        Prazo encerrado ✕
                    </button>`;
    } else {
        linkPart = `<a href="${esc(ativ.link)}" target="_blank" rel="noopener" class="pa-link-ativ${zerada ? ' pa-link-ativ--zerada' : ''}">
               ${zerada ? 'Tentar novamente ↗' : 'Abrir ↗'}
           </a>`;
    }

    li.innerHTML = `
        <div class="pa-ativ-left">
            <div class="pa-ativ-titulo">${esc(ativ.titulo)}</div>
            ${qzPart}
            <div class="pa-ativ-meta">
                <span class="pa-tipo-badge ${tipoCls}">${esc(tipoLabel)}</span>
                ${prazoPart}
                ${zerouPart}
                ${aguardPart}
                ${devolvidaPart}
                ${pontosPart}
            </div>
            ${reaberturaPart}
        </div>
        <div class="pa-ativ-right">
            ${linkPart}
        </div>
    `;
    return li;
}

/* ── Render de um card de curso ─────────────────────── */
function renderCursoCard(curso, { zerada = false, aguardando = false } = {}) {
    const card = document.createElement('div');
    card.className = 'pa-curso-card'
        + (zerada     ? ' pa-curso-card--zerada'     : '')
        + (aguardando ? ' pa-curso-card--aguardando' : '');

    const items = zerada     ? curso.zeradas
                : aguardando ? curso.aguardando
                             : curso.atividades;
    const qtd   = items.length;
    const badgeLabel = zerada     ? `${qtd} zerada${qtd !== 1 ? 's' : ''}`
                     : aguardando ? `${qtd} aguardando`
                                  : `${qtd} pendente${qtd !== 1 ? 's' : ''}`;

    const header = document.createElement('div');
    header.className = 'pa-curso-header';
    header.innerHTML = `
        <div class="pa-curso-info">
            <div class="pa-curso-nome" title="${esc(curso.nome)}">${esc(curso.nome)}</div>
            ${curso.secao ? `<div class="pa-curso-secao">${esc(curso.secao)}</div>` : ''}
        </div>
        <span class="pa-curso-badge${zerada ? ' pa-curso-badge--zerada' : ''}${aguardando ? ' pa-curso-badge--aguardando' : ''}">${badgeLabel}</span>
    `;
    card.appendChild(header);

    if (zerada) {
        const lista = document.createElement('ul');
        lista.className = 'pa-atividade-lista';
        items.forEach(ativ => lista.appendChild(renderAtivItem(ativ, { zerada: true, cursoId: curso.cursoId, cursoNome: curso.nome })));
        card.appendChild(lista);
        return card;
    }

    if (aguardando) {
        const lista = document.createElement('ul');
        lista.className = 'pa-atividade-lista';
        items.forEach(ativ => lista.appendChild(renderAtivItem(ativ, { aguardando: true })));
        card.appendChild(lista);
        return card;
    }

    /* ── Agrupa atividades pendentes por grupo ───────── */
    const gruposMap = new Map();   /* grupoId → { nome, atividades[] } */
    const semGrupo  = [];

    items.forEach(ativ => {
        if (ativ.grupoId) {
            if (!gruposMap.has(ativ.grupoId)) {
                gruposMap.set(ativ.grupoId, { nome: ativ.grupoNome, atividades: [] });
            }
            gruposMap.get(ativ.grupoId).atividades.push(ativ);
        } else {
            semGrupo.push(ativ);
        }
    });

    /* Renderiza cada grupo */
    gruposMap.forEach(({ nome, atividades: gAtivs }) => {
        const secao = document.createElement('div');
        secao.className = 'pa-grupo-secao';

        const label = document.createElement('div');
        label.className = 'pa-grupo-label';
        label.innerHTML = `<span class="pa-grupo-icon">📋</span><span class="pa-grupo-nome">${esc(nome)}</span>`;
        secao.appendChild(label);

        const lista = document.createElement('ul');
        lista.className = 'pa-atividade-lista';
        gAtivs.forEach(ativ => lista.appendChild(renderAtivItem(ativ, { cursoId: curso.cursoId, cursoNome: curso.nome })));
        secao.appendChild(lista);

        card.appendChild(secao);
    });

    /* Atividades sem grupo — só mostra se o curso NÃO tem grupos definidos */
    if (semGrupo.length > 0 && !curso.temGrupos) {
        const secao = document.createElement('div');
        secao.className = 'pa-grupo-secao pa-grupo-secao--outras';

        if (gruposMap.size > 0) {
            const label = document.createElement('div');
            label.className = 'pa-grupo-label pa-grupo-label--outras';
            label.innerHTML = `<span class="pa-grupo-icon">📌</span><span class="pa-grupo-nome">Outras atividades</span>`;
            secao.appendChild(label);
        }

        const lista = document.createElement('ul');
        lista.className = 'pa-atividade-lista';
        semGrupo.forEach(ativ => lista.appendChild(renderAtivItem(ativ, { cursoId: curso.cursoId, cursoNome: curso.nome })));
        secao.appendChild(lista);

        card.appendChild(secao);
    }

    return card;
}

/* ── Render principal ────────────────────────────────── */
function renderAtividades({ cursos = [], totalPendentes = 0, totalZeradas = 0, totalAguardando = 0 }) {
    $('paResumoNum').textContent = totalPendentes;

    const cursosComPend  = cursos.filter(c => c.atividades.length > 0);
    const cursosComZer   = cursos.filter(c => c.zeradas    && c.zeradas.length    > 0);
    const cursosComAguard = cursos.filter(c => c.aguardando && c.aguardando.length > 0);

    if (!cursosComPend.length && !cursosComZer.length && !cursosComAguard.length) {
        $('paVazio').style.display = '';
        return;
    }

    /* Grid de pendentes */
    const grid = $('paCursos');
    grid.innerHTML = '';
    cursosComPend.forEach(curso => grid.appendChild(renderCursoCard(curso)));

    if (!cursosComPend.length) {
        $('paVazio').style.display = '';
    }

    /* Seção zeradas */
    if (cursosComZer.length > 0) {
        $('paResumoZeradas').style.display  = '';
        $('paResumoZeradasNum').textContent = totalZeradas;
        $('paZeradasSection').style.display = '';
        const gridZ = $('paCursosZerados');
        gridZ.innerHTML = '';
        cursosComZer.forEach(curso => gridZ.appendChild(renderCursoCard(curso, { zerada: true })));
    }

    /* Seção aguardando correção */
    if (cursosComAguard.length > 0) {
        $('paResumoAguardando').style.display  = '';
        $('paResumoAguardandoNum').textContent = totalAguardando;
        $('paAguardandoSection').style.display = '';
        const gridA = $('paCursosAguardando');
        gridA.innerHTML = '';
        cursosComAguard.forEach(curso => gridA.appendChild(renderCursoCard(curso, { aguardando: true })));
    }

    /* Seção de solicitações de reabertura */
    renderSolicitacoesSection(Object.values(_solicitadasMap));
}

/* ── Seção "Minhas Solicitações" ─────────────────────── */
function renderSolicitacoesSection(solicitacoes) {
    if (!solicitacoes.length) return;

    const fmt = iso => iso
        ? new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '—';
    const sLabel = { pendente: '⏳ Aguardando resposta', aprovada: '✅ Aprovada', negada: '❌ Negada' };
    const sCls   = { pendente: 'pa-sol-status--pend', aprovada: 'pa-sol-status--ok', negada: 'pa-sol-status--neg' };

    const lista = $('paSolicitaLista');
    lista.innerHTML = solicitacoes.map(s => `
        <div class="pa-sol-card">
            <div class="pa-sol-head">
                <div>
                    <div class="pa-sol-ativ">${esc(s.coursework_titulo || '—')}</div>
                    <div class="pa-sol-curso">${esc(s.curso_nome || '—')}</div>
                </div>
                <span class="pa-sol-status ${sCls[s.status] || ''}">${sLabel[s.status] || s.status}</span>
            </div>
            ${s.justificativa ? `<div class="pa-sol-justi">"${esc(s.justificativa)}"</div>` : ''}
            ${s.resposta      ? `<div class="pa-sol-resposta">Resposta do professor: ${esc(s.resposta)}</div>` : ''}
            <div class="pa-sol-data">Solicitado em ${fmt(s.criado_em)}</div>
        </div>`).join('');

    $('paSolicitaSection').style.display = '';
}

/* ── Modal de solicitação ────────────────────────────── */
function abrirModalSolicitacao(dadosJson) {
    try {
        _solicitaModal   = JSON.parse(dadosJson);
        _cursoAtualReq   = { cursoId: _solicitaModal.cursoId, cursoNome: _solicitaModal.cursoNome };
    } catch (_) { return; }

    $('paSolicitaAtivNome').textContent  = _solicitaModal.titulo || '';
    $('paSolicitaJusti').value           = '';
    $('paSolicitaErro').style.display    = 'none';
    $('paSolicitaEnviar').disabled       = false;
    $('paSolicitaEnviar').textContent    = 'Enviar solicitação';
    $('paSolicitaModal').style.display   = 'flex';
    setTimeout(() => $('paSolicitaJusti').focus(), 100);
}

function fecharModalSolicitacao(ev) {
    if (ev instanceof Event && ev.target !== $('paSolicitaModal')) return;
    $('paSolicitaModal').style.display = 'none';
    _solicitaModal = null;
    _cursoAtualReq = null;
}

async function enviarSolicitacao() {
    if (!_solicitaModal) return;
    const justificativa = $('paSolicitaJusti').value.trim();
    const btn           = $('paSolicitaEnviar');
    const erroEl        = $('paSolicitaErro');
    erroEl.style.display = 'none';
    btn.disabled        = true;
    btn.textContent     = 'Enviando…';

    try {
        const resp = await fetch('/api/alunos-portal/solicitar-reabertura', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                courseworkId:     String(_solicitaModal.id),
                courseworkTitulo: _solicitaModal.titulo,
                cursoId:          _cursoAtualReq?.cursoId || '',
                cursoNome:        _cursoAtualReq?.cursoNome || '',
                submissionLink:   _solicitaModal.link || '',
                justificativa,
            }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.erro || 'Erro ao enviar solicitação.');
        $('paSolicitaModal').style.display = 'none';
        /* Atualiza map local sem recarregar tudo */
        _solicitadasMap[String(_solicitaModal.id)] = {
            coursework_id:     String(_solicitaModal.id),
            coursework_titulo: _solicitaModal.titulo,
            curso_nome:        _cursoAtualReq?.cursoNome || '',
            status:            'pendente',
            justificativa,
            criado_em:         new Date().toISOString(),
        };
        _solicitaModal = null;
        /* Re-renderiza sem recarregar da API */
        carregarAtividades();
    } catch (e) {
        erroEl.textContent   = e.message;
        erroEl.style.display = '';
        btn.disabled         = false;
        btn.textContent      = 'Enviar solicitação';
    }
}

/* ══ Sistema de Notificações Bloqueantes ════════════════════════════ */

const NOTIF_ICONE = {
    reabertura_aprovada: '✅',
    reabertura_negada:   '❌',
    prazo_proximo:       '⏰',
};
const NOTIF_COR = {
    reabertura_aprovada: 'verde',
    reabertura_negada:   'vermelho',
    prazo_proximo:       'laranja',
};

function iniciarPollingNotificacoes() {
    if (_notifTimerId) return; /* já rodando */
    verificarNotificacoes();   /* imediato na primeira vez */
    _notifTimerId = setInterval(verificarNotificacoes, 60_000); /* a cada 60 s */
}

function pararPollingNotificacoes() {
    clearInterval(_notifTimerId);
    _notifTimerId = null;
}

async function verificarNotificacoes() {
    try {
        const resp = await fetch('/api/alunos-portal/notificacoes', { credentials: 'include' });
        if (!resp.ok) return;
        const { notificacoes } = await resp.json();
        if (!notificacoes?.length) return;

        /* Adiciona à fila apenas as que ainda não estão nela */
        const idsNaFila = new Set(_notifQueue.map(n => n.id));
        if (_notifAtual) idsNaFila.add(_notifAtual.id);

        const novas = notificacoes.filter(n => !idsNaFila.has(n.id));
        _notifQueue.push(...novas);

        /* Exibe a primeira se nenhuma estiver sendo mostrada */
        if (!_notifAtual && _notifQueue.length > 0) {
            mostrarProximaNotif();
        }
    } catch (_) { /* silencia erros de rede */ }
}

function mostrarProximaNotif() {
    if (!_notifQueue.length) return;
    _notifAtual = _notifQueue.shift();

    const modal   = $('paNotifModal');
    const icone   = $('paNotifIcone');
    const titulo  = $('paNotifTitulo');
    const msg     = $('paNotifMensagem');
    const contador= $('paNotifContador');
    const btnAcao = $('paNotifBtnAcao');

    /* Cor do header conforme tipo */
    const cor = NOTIF_COR[_notifAtual.tipo] || 'laranja';
    modal.dataset.cor = cor;

    icone.textContent  = NOTIF_ICONE[_notifAtual.tipo] || '🔔';
    titulo.textContent = _notifAtual.titulo;
    msg.textContent    = _notifAtual.mensagem;

    /* Botão de ação extra (ex: abrir atividade reaberta) */
    const link = _notifAtual.dados?.link;
    if (link && _notifAtual.tipo === 'reabertura_aprovada') {
        btnAcao.href         = link;
        btnAcao.style.display = '';
    } else {
        btnAcao.style.display = 'none';
    }

    /* Contador de fila */
    const total = _notifQueue.length + 1; /* atual + restantes */
    const restam = _notifQueue.length;
    contador.textContent = restam > 0 ? `1 de ${total} avisos` : '';
    contador.style.display = restam > 0 ? '' : 'none';

    /* Bloqueia página */
    modal.style.display = 'flex';
}

async function confirmarNotif() {
    if (!_notifAtual) return;
    const id = _notifAtual.id;
    _notifAtual = null;

    /* Marca como lida no servidor (fire-and-forget) */
    fetch(`/api/alunos-portal/notificacoes/${id}/ler`, {
        method: 'POST',
        credentials: 'include',
    }).catch(() => {});

    /* Exibe próxima ou fecha modal */
    if (_notifQueue.length > 0) {
        mostrarProximaNotif();
    } else {
        $('paNotifModal').style.display = 'none';
    }
}

/* ── Logout ──────────────────────────────────────────── */
async function fazerLogout() {
    try {
        await fetch('/api/alunos-portal/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {}
    _solicitadasMap = {};
    _notifQueue     = [];
    _notifAtual     = null;
    pararPollingNotificacoes();
    $('paNotifModal').style.display = 'none';
    $('paCursos').innerHTML      = '';
    $('paResumoNum').textContent = '0';
    mostrarTelaLogin();
}

/* ── Utils ───────────────────────────────────────────── */
function primeiroNome(nome) {
    return (nome || '').split(' ')[0];
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
