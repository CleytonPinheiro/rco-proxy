'use strict';

/* ══════════════════════════════════════════════════════
   Portal do Aluno — frontend
   ══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

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
    $('paVazio').style.display          = 'none';
    $('paSemConexao').style.display     = 'none';
    $('paCursos').innerHTML             = '';
    $('paCursosZerados').innerHTML      = '';
    $('paZeradasSection').style.display = 'none';
    $('paResumoZeradas').style.display  = 'none';

    try {
        const resp = await fetch('/api/alunos-portal/atividades', { credentials: 'include' });

        if (resp.status === 401) { mostrarTelaLogin(); return; }

        const data = await resp.json();

        if (!resp.ok) {
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

function renderAtivItem(ativ, { zerada = false, aguardando = false } = {}) {
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

    const linkPart = aguardando
        ? `<span class="pa-aguard-status">Entregue</span>`
        : `<a href="${esc(ativ.link)}" target="_blank" rel="noopener" class="pa-link-ativ${zerada ? ' pa-link-ativ--zerada' : ''}">
               ${zerada ? 'Tentar novamente ↗' : 'Abrir ↗'}
           </a>`;

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
        items.forEach(ativ => lista.appendChild(renderAtivItem(ativ, { zerada: true })));
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
        gAtivs.forEach(ativ => lista.appendChild(renderAtivItem(ativ)));
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
        semGrupo.forEach(ativ => lista.appendChild(renderAtivItem(ativ)));
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
}

/* ── Logout ──────────────────────────────────────────── */
async function fazerLogout() {
    try {
        await fetch('/api/alunos-portal/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {}
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
