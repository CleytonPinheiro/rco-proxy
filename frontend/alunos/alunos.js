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

/* ── Tarefas de 2ª correção (sortição) ───────────────── */
async function carregarTarefasCorretor() {
    try {
        const r = await fetch('/api/alunos-portal/segundo-corretor/pendentes', { credentials: 'include' });
        if (!r.ok) return;
        const { pendentes } = await r.json();
        const sec   = document.getElementById('paCorretorSection');
        const lista = document.getElementById('paCorretorLista');
        if (!sec || !lista) return;
        if (!pendentes || pendentes.length === 0) {
            sec.style.display = 'none';
            return;
        }
        sec.style.display = '';
        lista.innerHTML = pendentes.map(p => `
            <div class="pa-solicita-card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border:1px solid #f59e0b;border-radius:8px;margin-bottom:8px;background:#fffbeb">
                <div>
                    <strong>${(p.prova_nome || 'Prova').replace(/[<>]/g, '')}</strong>
                    <div style="font-size:0.85em;color:#666">Variante ${p.variante_codigo} · ${p.qtd_questoes} questões · sorteada em ${new Date(p.criado_em).toLocaleDateString('pt-BR')}</div>
                </div>
                <a class="pa-btn pa-btn-primary" href="/alunos/prova/?seg=${p.submissao_ref_id}" style="background:#f59e0b;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Corrigir agora →</a>
            </div>
        `).join('');
    } catch (_) {
        /* silencioso — módulo opcional */
    }
}

/* ── Verifica sessão ─────────────────────────────────── */
async function verificarStatus() {
    mostrarLoading(true);
    try {
        const resp = await fetch('/api/alunos-portal/status', { credentials: 'include' });
        const data = await resp.json();
        if (data.aluno) {
            mostrarTelaLogado(data.aluno);
            carregarAtividades();
            carregarTarefasCorretor();
            iniciarPollingNotificacoes();
            /* Conquistas: verifica silenciosamente após atividades carregarem */
            setTimeout(verificarConquistas, 3000);
            /* Lança o tour após as atividades terem tempo de renderizar */
            setTimeout(iniciarTourSeNecessario, 900);
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
    $('paTourBtn').style.display        = 'none';
    $('paTourOverlay').style.display    = 'none';
}

function mostrarTelaLogado(aluno) {
    $('paTelalogin').style.display      = 'none';
    $('paTelaAtividades').style.display = '';
    $('paUserArea').style.display       = 'flex';
    $('paThemeBtnPre').style.display    = 'none';
    $('paTourBtn').style.display         = 'flex';
    $('paConquistasBtn').style.display   = 'flex';

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
            const cls      = reaberturaAberta ? 'pa-solicita-btn pa-solicita-btn--aberta' : 'pa-solicita-btn pa-solicita-btn--destaque';
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
            const primeiro = (sol.aluno_nome || '').split(/\s+/)[0] || '';
            reaberturaPart = `<span class="pa-solicita-badge pa-solicita-badge--pendente">⏳ Reabertura solicitada</span>
                ${primeiro ? `<span class="pa-solicita-quem">por ${esc(primeiro)}</span>` : ''}`;
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
    gruposMap.forEach(({ nome, atividades: gAtivs }, grupoId) => {
        const secao = document.createElement('div');
        secao.className = 'pa-grupo-secao';

        const primeiraAtiv = gAtivs[0];
        const grupoFechado = primeiraAtiv?.grupoFechado;
        const grupoDataFech = primeiraAtiv?.grupoDataFechamento;

        const label = document.createElement('div');
        label.className = 'pa-grupo-label';
        label.innerHTML = `<span class="pa-grupo-icon">📋</span><span class="pa-grupo-nome">${esc(nome)}</span>`;
        secao.appendChild(label);

        if (grupoFechado) {
            secao.classList.add('pa-grupo-secao--fechado');
            const aviso = document.createElement('div');
            aviso.className = 'pa-grupo-fechado-aviso';
            const dtFech = grupoDataFech ? new Date(grupoDataFech).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            aviso.innerHTML = `<span class="pa-fechado-icon">🔒</span> <strong>Notas fechadas${dtFech ? ` em ${dtFech}` : ''}</strong> — Entregas após o fechamento não serão contabilizadas na nota.`;
            secao.appendChild(aviso);
        }

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
    prazo_dias:          '📅',
};
const NOTIF_COR = {
    reabertura_aprovada: 'verde',
    reabertura_negada:   'vermelho',
    prazo_proximo:       'laranja',
    prazo_dias:          'amarelo',
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

/* ══ Tour Guiado ════════════════════════════════════════════════════ */

const PA_TOUR_KEY = 'pa_tour_concluido';

const PA_TOUR_PASSOS = [
    {
        alvo: null, pos: 'center',
        icone: '👋', titulo: 'Bem-vindo ao Portal do Aluno!',
        texto: 'Este é o seu espaço pessoal para acompanhar suas atividades do Google Classroom, solicitar reaberturas e receber avisos dos seus professores.<br><br>Vamos fazer um tour rápido — leva menos de 2 minutos! 🚀',
    },
    {
        alvo: '.pa-resumo-bar', pos: 'bottom',
        icone: '📊', titulo: 'Painel de resumo',
        texto: 'Aqui você vê de relance quantas atividades estão <strong>pendentes</strong>, <strong>zeradas</strong> e <strong>aguardando correção</strong>. Os contadores são atualizados a cada acesso.',
    },
    {
        alvo: '#paCursos', pos: 'top',
        icone: '📚', titulo: 'Atividades Pendentes',
        texto: 'Suas atividades do Classroom que ainda precisam ser feitas aparecem aqui, organizadas por disciplina. Clique em <strong>"Abrir ↗"</strong> para ir diretamente à atividade.',
    },
    {
        alvo: null, pos: 'center',
        icone: '🎮', titulo: 'Atividades Zeradas',
        texto: 'Se você abriu uma atividade e saiu sem responder, ela aparece em <strong>"Entrou mas não realizou"</strong> com pontuação 0. Ainda é possível pedir ao professor que reabra!',
    },
    {
        alvo: null, pos: 'center',
        icone: '↩', titulo: 'Solicitar Reabertura',
        texto: 'Em atividades zeradas, clique em <strong>"Solicitar reabertura"</strong> e escreva uma justificativa. O professor decidirá se aprova. Se aprovado, você poderá tentar novamente!',
    },
    {
        alvo: null, pos: 'center',
        icone: '⏳', titulo: 'Aguardando Correção',
        texto: 'Quando você entrega uma atividade subjetiva (redação, resposta aberta), ela aparece em <strong>"Aguardando correção"</strong> até o professor lançar a nota.',
    },
    {
        alvo: null, pos: 'center',
        icone: '📋', titulo: 'Minhas Solicitações',
        texto: 'Acompanhe o histórico de todas as suas solicitações de reabertura: <strong>⏳ pendente</strong>, <strong>✅ aprovada</strong> ou <strong>❌ negada</strong> — tudo em um só lugar.',
    },
    {
        alvo: '.pa-qr-btn', pos: 'bottom',
        icone: '📲', titulo: 'Gerador de QR Code',
        texto: 'Crie QR Codes personalizados com diferentes <strong>estilos, cores e temas</strong>. Use para compartilhar links, textos ou qualquer outra informação de forma visual.',
    },
    {
        alvo: null, pos: 'center',
        icone: '🔔', titulo: 'Notificações de Prazo',
        texto: 'Quando uma atividade estiver próxima do vencimento (menos de 2h ou até 3 dias), você receberá um <strong>aviso automático</strong> na tela que precisa ser confirmado antes de continuar.',
    },
    {
        alvo: '#paTourBtn', pos: 'bottom',
        icone: '❓', titulo: 'Precisa de ajuda?',
        texto: 'Você pode rever este guia a qualquer momento clicando neste botão <strong>"?"</strong> aqui no cabeçalho. Ele estará sempre disponível.',
    },
    {
        alvo: null, pos: 'center',
        icone: '🎓', titulo: 'Você está pronto!',
        texto: 'Agora você conhece todos os recursos do Portal do Aluno. Bons estudos e aproveite a plataforma ao máximo! 🌟',
        ultimo: true,
    },
];

let _tourAtivo       = false;
let _tourObrigatorio = false; /* true = primeiro acesso, sem botão fechar */
let _tourPasso       = 0;

function iniciarTourSeNecessario() {
    if (!localStorage.getItem(PA_TOUR_KEY)) {
        _tourObrigatorio = true;
        iniciarTour();
    }
}

window.abrirTour = function () {
    _tourObrigatorio = false;
    iniciarTour();
};

function iniciarTour() {
    _tourAtivo = true;
    _tourPasso = 0;
    $('paTourOverlay').style.display = '';
    $('paTourTotal').textContent     = PA_TOUR_PASSOS.length;
    /* Mostra/oculta botão fechar conforme modo */
    $('paTourFechar').style.display  = _tourObrigatorio ? 'none' : '';
    _renderizarPassoTour();
}

window.fecharTour = function () {
    if (_tourObrigatorio) return; /* bloqueado no primeiro acesso */
    _encerrarTour();
};

function _encerrarTour() {
    _tourAtivo = false;
    $('paTourOverlay').style.display = 'none';
    _limparSpotlight();
}

function _concluirTour() {
    localStorage.setItem(PA_TOUR_KEY, '1');
    _tourObrigatorio = false;
    _encerrarTour();
}

window.paTourProximo = function () {
    if (_tourPasso < PA_TOUR_PASSOS.length - 1) {
        _tourPasso++;
        _renderizarPassoTour();
    } else {
        _concluirTour();
    }
};

window.paTourAnterior = function () {
    if (_tourPasso > 0) {
        _tourPasso--;
        _renderizarPassoTour();
    }
};

function _renderizarPassoTour() {
    const passo = PA_TOUR_PASSOS[_tourPasso];
    const total = PA_TOUR_PASSOS.length;

    /* Conteúdo */
    $('paTourIcone').textContent      = passo.icone;
    $('paTourTitulo').textContent     = passo.titulo;
    $('paTourTexto').innerHTML        = passo.texto;
    $('paTourPassoNum').textContent   = _tourPasso + 1;

    /* Dots */
    const dots = $('paTourDots');
    dots.innerHTML = PA_TOUR_PASSOS.map((_, i) =>
        `<div class="pa-tour-dot${i === _tourPasso ? ' pa-tour-dot--ativo' : ''}"></div>`
    ).join('');

    /* Botões */
    const btnPrev = $('paTourBtnPrev');
    const btnNext = $('paTourBtnNext');
    btnPrev.style.display = _tourPasso === 0 ? 'none' : '';
    if (passo.ultimo) {
        btnNext.textContent = '✅ Concluir';
        btnNext.className   = 'pa-tour-btn pa-tour-btn--concluir';
    } else {
        btnNext.textContent = 'Próximo →';
        btnNext.className   = 'pa-tour-btn pa-tour-btn--next';
    }

    /* Spotlight + posição do card */
    const alvoEl = passo.alvo ? document.querySelector(passo.alvo) : null;
    const alvoVisivel = alvoEl && _elVisivel(alvoEl);

    if (alvoVisivel) {
        alvoEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        /* Pequeno delay para o scroll completar */
        setTimeout(() => _posicionarComAlvo(alvoEl, passo.pos), 350);
    } else {
        _limparSpotlight();
        _posicionarCentro();
    }
}

function _elVisivel(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

function _posicionarComAlvo(el, pos) {
    const PAD  = 10;
    const r    = el.getBoundingClientRect();
    const spot = $('paTourSpot');
    const card = $('paTourCard');

    /* Spotlight */
    spot.className = 'pa-tour-spot';
    spot.style.top    = (r.top    - PAD) + 'px';
    spot.style.left   = (r.left   - PAD) + 'px';
    spot.style.width  = (r.width  + PAD * 2) + 'px';
    spot.style.height = (r.height + PAD * 2) + 'px';

    /* Posição do card */
    const cardW = Math.min(380, window.innerWidth * 0.9);
    const GAP   = 14;
    let top, left;

    if (pos === 'bottom' || r.bottom + GAP + 260 < window.innerHeight) {
        top  = r.bottom + PAD + GAP;
    } else {
        top  = r.top - PAD - GAP - 260; /* acima */
    }
    /* Centraliza horizontalmente sobre o elemento, clamped */
    left = r.left + r.width / 2 - cardW / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - cardW - 12));
    top  = Math.max(12, top);

    card.style.position = 'fixed';
    card.style.top      = top  + 'px';
    card.style.left     = left + 'px';
    card.style.width    = cardW + 'px';
    card.style.transform = '';
    card.className = 'pa-tour-card';
}

function _posicionarCentro() {
    const card = $('paTourCard');
    card.style.position  = 'fixed';
    card.style.top       = '50%';
    card.style.left      = '50%';
    card.style.width     = '';
    card.style.transform = 'translate(-50%,-50%)';
}

function _limparSpotlight() {
    const spot = $('paTourSpot');
    spot.className    = 'pa-tour-spot pa-tour-spot--oculto';
    spot.style.top    = '50%';
    spot.style.left   = '50%';
    spot.style.width  = '0';
    spot.style.height = '0';
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

/* ══════════════════════════════════════════════════════════════
   CONQUISTAS — Nota Máxima do Grupo
══════════════════════════════════════════════════════════════ */

let _conquistasCache = null;

/* Verifica conquistas silenciosamente após o login */
async function verificarConquistas() {
    try {
        const r = await fetch('/api/alunos-portal/conquistas', { credentials: 'include' });
        if (!r.ok) return;
        const { conquistas } = await r.json();
        _conquistasCache = conquistas || [];

        const novas = _conquistasCache.filter(c => c.nova);

        /* Badge no botão troféu */
        const badge = $('paCqBadge');
        if (novas.length > 0) {
            badge.textContent    = novas.length;
            badge.style.display  = '';
        } else {
            badge.style.display  = 'none';
        }

        /* Dispara celebração apenas se há novas conquistas */
        if (novas.length > 0) {
            mostrarCelebracao(novas);
        }
    } catch { /* silencioso */ }
}

/* Abre o painel de conquistas */
async function abrirConquistas() {
    const panel = $('paConquistasPanel');
    panel.style.display = '';
    panel.classList.add('pa-cq-panel--open');
    document.body.style.overflow = 'hidden';

    $('paCqLoading').style.display = '';
    $('paCqVazio').style.display   = 'none';
    $('paCqCards').style.display   = 'none';
    $('paCqMural').style.display   = 'none';

    try {
        /* Usa cache se já calculado, senão busca novamente */
        if (!_conquistasCache) {
            const r = await fetch('/api/alunos-portal/conquistas', { credentials: 'include' });
            const d = await r.json();
            _conquistasCache = d.conquistas || [];
        }

        $('paCqLoading').style.display = 'none';

        if (_conquistasCache.length === 0) {
            $('paCqVazio').style.display = '';
        } else {
            renderConquistaCards(_conquistasCache);
            $('paCqCards').style.display = '';
        }

        carregarMural();
    } catch {
        $('paCqLoading').style.display = 'none';
        $('paCqVazio').style.display   = '';
    }
}

/* Fecha o painel */
function fecharConquistas() {
    const panel = $('paConquistasPanel');
    panel.classList.remove('pa-cq-panel--open');
    setTimeout(() => { panel.style.display = 'none'; }, 250);
    document.body.style.overflow = '';
}

/* Renderiza os cartões colecionáveis */
function renderConquistaCards(conquistas) {
    const container = $('paCqCards');
    container.innerHTML = conquistas.map(c => {
        const data = new Date(c.conquistadoEm).toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'long', year: 'numeric',
        });
        return `<div class="pa-cq-card" style="--cq-cor:${esc(c.cor || '#4285F4')}">
            <div class="pa-cq-card-shimmer"></div>
            <div class="pa-cq-card-badge-topo">Nota Máxima ⭐</div>
            <div class="pa-cq-card-body">
                <div class="pa-cq-card-icon">🏆</div>
                <div class="pa-cq-card-info">
                    <div class="pa-cq-card-grupo">${esc(c.grupoNome)}</div>
                    <div class="pa-cq-card-curso">${esc(c.cursoNome)}</div>
                </div>
            </div>
            <div class="pa-cq-card-footer">
                <span class="pa-cq-card-pts">⭐ ${c.notaTeto} pontos</span>
                <span class="pa-cq-card-data">${data}</span>
            </div>
        </div>`;
    }).join('');
}

/* Carrega e renderiza o mural de destaque */
async function carregarMural() {
    try {
        const r = await fetch('/api/alunos-portal/mural', { credentials: 'include' });
        if (!r.ok) return;
        const { grupos } = await r.json();
        if (!grupos || !grupos.length) return;
        renderMural(grupos);
    } catch { /* silencioso */ }
}

function renderMural(grupos) {
    const lista = $('paCqMuralLista');
    lista.innerHTML = grupos.map(g => `
        <div class="pa-cq-mural-grupo" style="--cq-cor:${esc(g.cor || '#4285F4')}">
            <div class="pa-cq-mural-grupo-header">
                <span class="pa-cq-mural-dot"></span>
                <span class="pa-cq-mural-grupo-nome">${esc(g.grupoNome)}</span>
            </div>
            <div class="pa-cq-mural-nomes">
                ${g.achievers.map(n => `<span class="pa-cq-mural-nome">${esc(n)}</span>`).join('')}
            </div>
        </div>
    `).join('');
    $('paCqMural').style.display = '';
}

/* Exibe o modal de celebração com confetti */
function mostrarCelebracao(novas) {
    const el     = $('paCelebracao');
    const grupos = $('paCelebGrupos');

    grupos.innerHTML = novas.map(c =>
        `<div class="pa-celebracao-grupo-tag" style="--cq-cor:${esc(c.cor || '#4285F4')}">
            <strong>${esc(c.grupoNome)}</strong>
            <span>${esc(c.cursoNome)}</span>
        </div>`
    ).join('');

    el.style.display = '';

    /* Inicia confetti */
    const canvas  = $('paCelebCanvas');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    lancarConfetti(canvas);
}

/* Fecha o modal e abre o painel */
function fecharCelebracao() {
    $('paCelebracao').style.display = 'none';
    /* Marca conquistas como vistas */
    fetch('/api/alunos-portal/conquistas/notificado', {
        method: 'PATCH', credentials: 'include',
    }).catch(() => {});
    /* Remove badge */
    $('paCqBadge').style.display = 'none';
    /* Invalida cache para próxima abertura do painel não mostrar "nova" */
    _conquistasCache = _conquistasCache?.map(c => ({ ...c, nova: false }));
    /* Abre painel de conquistas */
    abrirConquistas();
}

/* Motor de confetti (puro JS + Canvas, sem biblioteca) */
function lancarConfetti(canvas) {
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    const CORS = ['#FFD700','#FF6B6B','#4285F4','#34A853','#FBBC05','#EA4335','#9C27B0','#FF9800','#00BCD4','#E91E63'];

    const pts = Array.from({ length: 200 }, () => ({
        x:    Math.random() * W,
        y:    Math.random() * H * -0.6 - 10,
        sz:   Math.random() * 9 + 4,
        cor:  CORS[Math.floor(Math.random() * CORS.length)],
        vx:   (Math.random() - 0.5) * 4,
        vy:   Math.random() * 5 + 1.5,
        rot:  Math.random() * 360,
        rs:   (Math.random() - 0.5) * 14,
        tipo: Math.random() > 0.4 ? 'rect' : 'circle',
    }));

    const t0  = performance.now();
    const DUR = 5000;

    (function frame(now) {
        const elapsed = now - t0;
        ctx.clearRect(0, 0, W, H);

        let viva = false;
        pts.forEach(p => {
            p.x   += p.vx;
            p.y   += p.vy;
            p.rot += p.rs;
            p.vy  += 0.06;

            if (p.y > H + 20) return;
            viva = true;

            const alpha = elapsed > 3500 ? Math.max(0, 1 - (elapsed - 3500) / 1500) : 1;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle   = p.cor;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            if (p.tipo === 'rect') {
                ctx.fillRect(-p.sz / 2, -p.sz / 4, p.sz, p.sz / 2);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.sz / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });

        if (viva && elapsed < DUR) requestAnimationFrame(frame);
        else ctx.clearRect(0, 0, W, H);
    })(performance.now());
}
