'use strict';
/* ════════════════════════════════════════════════════════════════════
   preview-frame.js — roda DENTRO do iframe de prévia do Portal do Aluno
   Recebe dados do professor via window.postMessage e renderiza usando
   as mesmas classes CSS e funções do portal real do aluno (alunos.css).
   ════════════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

/* ── Estado de solicitações (vindo da API admin) ── */
let _solicitadasMap = {};   /* courseworkId → { status, ... } */

const TIPO_LABEL = {
    ASSIGNMENT:               'Atividade',
    SHORT_ANSWER_QUESTION:    'Pergunta',
    MULTIPLE_CHOICE_QUESTION: 'Múltipla escolha',
    MATERIAL:                 'Material',
    QUIZ:                     'Questionário',
};

/* ── Escape HTML ── */
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ── Tema ── */
let _temaAtual = document.documentElement.getAttribute('data-theme') || 'light';

function aplicarTema(tema) {
    _temaAtual = tema;
    document.documentElement.setAttribute('data-theme', tema);
    const btn = $('prevTemaBtnEl');
    if (btn) btn.textContent = tema === 'dark' ? '☀️ Claro' : '🌙 Escuro';
}

window.alternarTema = function () {
    aplicarTema(_temaAtual === 'dark' ? 'light' : 'dark');
};

/* ── Tag Quizizz (idêntica ao alunos.js) ── */
function renderQuizizzTag(ativ) {
    if (!ativ.quizizzId) return '';
    const isId  = /^[0-9a-f]{24}$/i.test(ativ.quizizzId);
    const link  = isId ? `https://quizizz.com/admin/quiz/${ativ.quizizzId}` : null;
    const linkP = link
        ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="pa-qz-link">Ver quiz ↗</a>`
        : '';
    return `<div class="pa-qz-tag">
        <span class="pa-qz-ico">🎮</span>
        <span class="pa-qz-label">Quizizz</span>
        ${linkP}
    </div>`;
}

/* ── Render de item (idêntico ao alunos.js, sem modal de reabertura ativo) ── */
function renderAtivItem(ativ, { zerada = false, aguardando = false, cursoId = '', cursoNome = '' } = {}) {
    const li = document.createElement('li');
    li.className = 'pa-atividade-item'
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

    /* Badge/botão de reabertura — em modo prévia mostra o estado real mas
       sem abrir modal (é apenas visualização). */
    let reaberturaPart = '';
    if (!aguardando) {
        const sol = _solicitadasMap[String(ativ.id)];
        const reaberturaAberta = !ativ.vencida;
        if (!sol) {
            if (reaberturaAberta) {
                reaberturaPart = `<button class="pa-solicita-btn pa-solicita-btn--aberta pa-solicita-btn--preview"
                    disabled title="Disponível apenas após o encerramento do prazo"
                    onclick="event.preventDefault()">
                    <svg viewBox="0 0 16 16" fill="none" width="13" height="13" style="flex-shrink:0">
                      <path d="M2 8a6 6 0 1 0 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M2 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Solicitar reabertura
                </button>`;
            } else {
                reaberturaPart = `<button class="pa-solicita-btn pa-solicita-btn--destaque pa-solicita-btn--preview"
                    title="O aluno pode solicitar reabertura desta atividade"
                    onclick="event.preventDefault();_previewToast('Prévia: o aluno vê aqui o botão para solicitar reabertura.')">
                    <svg viewBox="0 0 16 16" fill="none" width="13" height="13" style="flex-shrink:0">
                      <path d="M2 8a6 6 0 1 0 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <path d="M2 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Solicitar reabertura
                </button>`;
            }
        } else if (sol.status === 'pendente') {
            const primeiro = (sol.aluno_nome || '').split(/\s+/)[0] || '';
            reaberturaPart = `<span class="pa-solicita-badge pa-solicita-badge--pendente">⏳ Reabertura solicitada</span>
                ${primeiro ? `<span class="pa-solicita-quem">por ${esc(primeiro)}</span>` : ''}`;
        } else if (sol.status === 'aprovada') {
            reaberturaPart = `<span class="pa-solicita-badge pa-solicita-badge--aprovada">✅ Reabertura aprovada</span>`;
        } else if (sol.status === 'negada') {
            reaberturaPart = `<span class="pa-solicita-badge pa-solicita-badge--negada">❌ Reabertura negada</span>
                <button class="pa-solicita-btn pa-solicita-btn--retry pa-solicita-btn--preview"
                    title="O aluno pode solicitar novamente"
                    onclick="event.preventDefault();_previewToast('Prévia: o aluno vê aqui o botão para solicitar novamente.')">
                    Solicitar novamente
                </button>`;
        }
    }

    let linkPart;
    if (aguardando) {
        linkPart = `<span class="pa-aguard-status">Entregue</span>`;
    } else if (zerada && ativ.vencida) {
        linkPart = `<button class="pa-link-ativ pa-link-ativ--zerada pa-link-ativ--desabilitado"
                        disabled title="Prazo encerrado — solicite a reabertura ao professor">
                        Prazo encerrado ✕
                    </button>`;
    } else {
        linkPart = ativ.link
            ? `<a href="${esc(ativ.link)}" target="_blank" rel="noopener"
                  class="pa-link-ativ${zerada ? ' pa-link-ativ--zerada' : ''}">
                   ${zerada ? 'Tentar novamente ↗' : 'Abrir ↗'}
               </a>`
            : '';
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

/* ── Render de card de curso (idêntico ao alunos.js) ── */
function renderCursoCard(curso, { zerada = false, aguardando = false } = {}) {
    const card = document.createElement('div');
    card.className = 'pa-curso-card'
        + (zerada     ? ' pa-curso-card--zerada'     : '')
        + (aguardando ? ' pa-curso-card--aguardando' : '');

    const items = zerada ? curso.zeradas : aguardando ? curso.aguardando : curso.atividades;
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
        items.forEach(ativ => lista.appendChild(
            renderAtivItem(ativ, { zerada: true, cursoId: curso.cursoId, cursoNome: curso.nome })
        ));
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

    /* Agrupa por grupo (pendentes) */
    const gruposMap = new Map();
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

/* ── Seção de solicitações ── */
function renderSolicitacoesSection(solicitacoes) {
    if (!solicitacoes.length) return;

    const fmt = iso => iso
        ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
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

/* ── Sino + dropdown de notificações (exclusivo da prévia admin) ── */
function renderBannerNotificacoes(notificacoes = []) {
    const wrap   = $('prevSinoWrap');
    const badge  = $('prevSinoBadge');
    const lista  = $('prevNotifLista');
    const count  = $('prevNotifCount');
    const btn    = $('prevSinoBtn');
    if (!wrap) return;

    if (!notificacoes.length) {
        wrap.style.display = 'none';
        return;
    }

    /* Ordena: urgentes primeiro */
    const ORDEM = { prazo_proximo: 0, prazo_dias: 1 };
    const sorted = [...notificacoes].sort((a, b) => (ORDEM[a.tipo] ?? 9) - (ORDEM[b.tipo] ?? 9));
    const temUrgente = sorted.some(n => n.tipo === 'prazo_proximo');

    /* Badge do sino */
    badge.textContent   = sorted.length;
    badge.className     = 'prev-sino-badge' + (temUrgente ? '' : ' prev-sino-badge--dias');

    /* Itens do dropdown */
    lista.innerHTML = sorted.map(n => {
        const cls = n.tipo === 'prazo_proximo' ? 'prev-notif-item--urgente' : 'prev-notif-item--dias';
        return `<div class="prev-notif-item ${cls}">
            <span class="prev-notif-icone">${n.icone}</span>
            <div class="prev-notif-texto">
                <div class="prev-notif-titulo">${esc(n.titulo)}</div>
                <div class="prev-notif-detalhe">${esc(n.detalhe)}</div>
            </div>
            ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener"
                           class="prev-notif-link">Abrir ↗</a>` : ''}
        </div>`;
    }).join('');

    count.textContent  = sorted.length;
    wrap.style.display = '';
}

/* Abre/fecha o dropdown do sino */
window.toggleNotifDropdown = function () {
    const drop = $('prevNotifDropdown');
    const btn  = $('prevSinoBtn');
    if (!drop) return;
    const aberto = drop.style.display !== 'none';
    drop.style.display = aberto ? 'none' : '';
    btn.classList.toggle('ativo', !aberto);
};

/* Fecha ao clicar fora */
document.addEventListener('click', e => {
    const wrap = $('prevSinoWrap');
    const drop = $('prevNotifDropdown');
    if (!wrap || !drop) return;
    if (!wrap.contains(e.target)) drop.style.display = 'none';
});

/* ── Render principal (idêntico ao alunos.js) ── */
function renderAtividades({ cursos = [], totalPendentes = 0, totalZeradas = 0, totalAguardando = 0, solicitacoes = [] }) {
    $('paResumoNum').textContent = totalPendentes;

    const cursosComPend   = cursos.filter(c => c.atividades?.length > 0);
    const cursosComZer    = cursos.filter(c => c.zeradas?.length    > 0);
    const cursosComAguard = cursos.filter(c => c.aguardando?.length > 0);

    if (!cursosComPend.length && !cursosComZer.length && !cursosComAguard.length) {
        $('paVazio').style.display = '';
        return;
    }

    /* Pendentes */
    const grid = $('paCursos');
    grid.innerHTML = '';
    cursosComPend.forEach(curso => grid.appendChild(renderCursoCard(curso)));
    if (!cursosComPend.length) $('paVazio').style.display = '';

    /* Zeradas */
    if (cursosComZer.length > 0) {
        $('paResumoZeradas').style.display  = '';
        $('paResumoZeradasNum').textContent = totalZeradas;
        $('paZeradasSection').style.display = '';
        const gridZ = $('paCursosZerados');
        gridZ.innerHTML = '';
        cursosComZer.forEach(curso => gridZ.appendChild(renderCursoCard(curso, { zerada: true })));
    }

    /* Aguardando */
    if (cursosComAguard.length > 0) {
        $('paResumoAguardando').style.display  = '';
        $('paResumoAguardandoNum').textContent = totalAguardando;
        $('paAguardandoSection').style.display = '';
        const gridA = $('paCursosAguardando');
        gridA.innerHTML = '';
        cursosComAguard.forEach(curso => gridA.appendChild(renderCursoCard(curso, { aguardando: true })));
    }

    /* Solicitações */
    renderSolicitacoesSection(solicitacoes);
}

/* ══════════════════════════════════════════
   postMessage handler — recebe dados do pai
   ══════════════════════════════════════════ */
window.addEventListener('message', (ev) => {
    if (!ev.data) return;

    /* ── Apenas troca de tema (sem re-renderizar dados) ── */
    if (ev.data.tipo === 'edusync:previa-tema') {
        aplicarTema(ev.data.tema);
        return;
    }

    if (ev.data.tipo !== 'edusync:previa-aluno') return;

    const { nomeAluno, data, tema, solicitacoes } = ev.data;

    /* Aplica tema do admin */
    if (tema) aplicarTema(tema);

    /* Atualiza banner */
    const prevNome = $('prevNomeAluno');
    if (prevNome) prevNome.textContent = nomeAluno || 'Aluno';

    /* Limpa estado anterior */
    _solicitadasMap = {};
    (solicitacoes || []).forEach(s => {
        _solicitadasMap[String(s.coursework_id)] = s;
    });

    /* Oculta estado de espera, mostra tela do aluno */
    const espera = $('prevEspera');
    if (espera) espera.style.display = 'none';
    $('paTelaAtividades').style.display = '';

    /* Limpa renders anteriores */
    $('paCursos').innerHTML             = '';
    $('paCursosZerados').innerHTML      = '';
    $('paCursosAguardando').innerHTML   = '';
    $('paSolicitaLista').innerHTML      = '';
    $('paVazio').style.display          = 'none';
    $('paZeradasSection').style.display = 'none';
    $('paAguardandoSection').style.display = 'none';
    $('paResumoZeradas').style.display  = 'none';
    $('paResumoAguardando').style.display = 'none';
    $('paSolicitaSection').style.display = 'none';
    /* Fecha dropdown do sino ao trocar de aluno */
    const _drop = $('prevNotifDropdown');
    if (_drop) _drop.style.display = 'none';
    const _sinoBtn = $('prevSinoBtn');
    if (_sinoBtn) _sinoBtn.classList.remove('ativo');

    /* Renderiza banner de notificações e lista de atividades */
    renderBannerNotificacoes(data.notificacoes || []);
    renderAtividades({ ...data, solicitacoes: solicitacoes || [] });

    /* Ajusta altura do iframe para o conteúdo */
    window.parent.postMessage({
        tipo:   'edusync:previa-altura',
        altura: document.body.scrollHeight,
    }, '*');
});

/* ── Avisa o pai que está pronto ── */
window.addEventListener('load', () => {
    window.parent.postMessage({ tipo: 'edusync:previa-pronto' }, '*');
});

/* ── Toast de prévia (substitui alert() nos botões de simulação) ── */
function _previewToast(msg) {
    const old = document.getElementById('_preview_toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = '_preview_toast';
    t.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:8px;background:#1e40af;color:#fff;font-size:.82rem;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.25);max-width:320px;text-align:center;pointer-events:none;transition:opacity .3s';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, 3000);
}
