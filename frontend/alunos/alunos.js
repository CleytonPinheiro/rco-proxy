'use strict';

/* ══════════════════════════════════════════════════════
   Portal do Aluno — frontend
   ══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

/* ── Estado global de solicitações ──────────────────────────────── */
let _solicitadasMap  = {};   /* courseworkId → { status, criado_em } */
let _solicitaModal   = null; /* dados da atividade no modal atual */
let _cursoAtualReq   = null; /* { cursoId, cursoNome } da atividade no modal */

/* ── Meu Grupo ──────────────────────────────────────── */
let _mgCursos    = [];    /* [{ id, nome }] cursos disponíveis */
let _mgCursoId   = '';    /* courseId selecionado */
let _mgCursoNome = '';    /* nome da disciplina selecionada */
let _mgGrupo     = null;  /* dados do grupo atual (ou null) */
let _mgLinksExtras = [];  /* links extras dinâmicos no formulário */

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

    if (params.get('tcor_ok') === '1') {
        const tcorMsg = params.get('tcor_msg') || '✅ Correção enviada! Obrigado pela ajuda.';
        setTimeout(() => notificar(tcorMsg), 300);
        history.replaceState({}, '', '/alunos/');
    }

    await verificarStatus();
});

/* Recarrega a lista da turma corretora ao retornar de uma correção
   via navegação do browser (BFCache restore), garantindo que o aluno
   recém-corrigido suma imediatamente sem recarregar a página inteira. */
window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    carregarTurmaCorretora();
});

/* ── Troca de aba (atividades / correções / grupo) ───────────── */
function mudarAba(aba) {
    const tabAtiv  = $('paTabAtividades');
    const tabCor   = $('paTabCorrecoes');
    const tabGrupo = $('paTabGrupo');
    const secAtiv  = $('paSecAtividades');
    const secCor   = $('paSecCorrecoes');
    const secGrupo = $('paSecGrupo');
    if (!tabAtiv || !secAtiv) return;
    const eAtiv  = aba === 'atividades';
    const eCor   = aba === 'correcoes';
    const eGrupo = aba === 'grupo';
    tabAtiv.classList.toggle('pa-nav-tab--active', eAtiv);
    tabCor .classList.toggle('pa-nav-tab--active', eCor);
    if (tabGrupo) tabGrupo.classList.toggle('pa-nav-tab--active', eGrupo);
    tabAtiv.setAttribute('aria-selected', eAtiv);
    tabCor .setAttribute('aria-selected', eCor);
    if (tabGrupo) tabGrupo.setAttribute('aria-selected', eGrupo);
    secAtiv.style.display  = eAtiv  ? '' : 'none';
    secCor .style.display  = eCor   ? '' : 'none';
    if (secGrupo) secGrupo.style.display = eGrupo ? '' : 'none';
    if (eGrupo && _mgCursoId) _mgCarregarDados();
}
window.mudarAba = mudarAba;

/* ── Estado compartilhado para o badge de Correções ──── */
const _correcoesPendentes = { turma: 0, corretor: 0 };
let _turmaAssignmentAtiva = false; /* true quando aluno tem ao menos 1 prova atribuída (mesmo sem papéis pendentes) */
function _atualizarBadgeCorrecoes() {
    const total  = _correcoesPendentes.turma + _correcoesPendentes.corretor;
    /* Aba fica visível sempre que houver atribuição de turma corretora ativa
       OU ao menos uma tarefa de 2º corretor pendente */
    const mostrarAba = total > 0 || _turmaAssignmentAtiva;
    const badge  = $('paNavBadge');
    const tabCor = $('paTabCorrecoes');
    if (badge) {
        if (total > 0) { badge.style.display = ''; badge.textContent = total; }
        else           badge.style.display = 'none';
    }
    if (tabCor) {
        tabCor.classList.toggle('pa-nav-tab--urgente', total > 0);
        const estaVisivel = tabCor.style.display !== 'none';
        if (mostrarAba) {
            tabCor.style.display = '';
        } else {
            /* Se o aluno está na aba Correções e ela vai sumir, volta para Atividades */
            if (estaVisivel && tabCor.getAttribute('aria-selected') === 'true') {
                mudarAba('atividades');
            }
            tabCor.style.display = 'none';
        }
    }
}

/* ── Fila da Turma Corretora ─────────────────────────── */
async function carregarTurmaCorretora() {
    try {
        /* /atribuicoes retorna TODAS as provas atribuídas (inclusive sem submissões) */
        const r = await fetch('/api/alunos-portal/turma-corretora/atribuicoes', { credentials: 'include' });
        if (!r.ok) return;
        const { provas } = await r.json();

        const alert    = $('paCorrecaoAlert');
        const alertTxt = $('paAlertTxt');
        const lista    = $('paTurmaCorretoraLista');
        const sec      = $('paTurmaCorretoraSec');
        if (!lista || !sec) return;

        if (!provas || provas.length === 0) {
            sec.style.display = 'none';
            if (alert) alert.style.display = 'none';
            _correcoesPendentes.turma = 0;
            _turmaAssignmentAtiva = false;
            _atualizarBadgeCorrecoes();
            return;
        }

        /* Separa provas ativas das concluídas (apenas prova efetivada pelo professor) */
        const provasAtivas     = provas.filter(p => !p.efetivada);
        const provasConcluidas = provas.filter(p => p.efetivada);

        /* Aba permanece visível enquanto houver ao menos uma prova (ativa ou concluída) */
        _turmaAssignmentAtiva = true;
        sec.style.display = '';

        const comPendentes = provasAtivas.filter(p => Number(p.pendentes) > 0);

        /* Badge mostra total de folhas pendentes (soma) e não nº de provas */
        _correcoesPendentes.turma = comPendentes.reduce((acc, p) => acc + Number(p.pendentes), 0);
        _atualizarBadgeCorrecoes();
        if (comPendentes.length > 0) {
            if (alert)    alert.style.display = '';
            if (alertTxt) {
                const n = comPendentes.length;
                alertTxt.textContent = n === 1
                    ? '1 prova com folhas aguardando sua correção — clique para abrir a fila.'
                    : `${n} provas com folhas aguardando sua correção — clique para abrir a fila.`;
            }
        } else {
            if (alert)  alert.style.display = 'none';
        }

        /* ── Renderiza cards ativos com select de alunos ── */
        const cardsAtivos = provasAtivas.map(p => {
            const pend = Number(p.pendentes) || 0;
            const badgePend = pend > 0
                ? `<span style="background:#dcfce7;color:#166534;border-radius:20px;padding:2px 10px;font-size:0.78em;font-weight:700">✅ ${pend} folha${pend !== 1 ? 's' : ''} para corrigir</span>`
                : `<span style="background:#f1f5f9;color:#475569;border-radius:20px;padding:2px 10px;font-size:0.78em;font-weight:600">Nenhuma folha pendente no momento</span>`;
            const badge2a = p.turma_corretora_2a_correcao
                ? '<span style="background:#fef9c3;color:#854d0e;border-radius:20px;padding:2px 10px;font-size:0.78em;font-weight:600">2ª conferência ativa</span>'
                : '';
            const borderColor = pend > 0 ? '#86efac' : '#d1d5db';
            return `
            <div class="pa-tcor-card" id="tcorCard_${p.prova_id}" style="border-color:${borderColor}">
                <div style="margin-bottom:12px">
                    <div style="font-size:1rem;font-weight:700;color:var(--pa-text);margin-bottom:2px">
                        ${escapeHtmlGam(p.prova_nome || 'Prova')}
                    </div>
                    ${p.turma_corretora_nome ? `<div style="font-size:0.78em;color:var(--pa-sub);margin-bottom:5px">Turma corretora: <strong>${escapeHtmlGam(p.turma_corretora_nome)}</strong></div>` : ''}
                    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
                        ${badgePend}${badge2a}
                    </div>
                </div>
                <div id="tcorProgresso_${p.prova_id}" style="margin-bottom:6px"></div>
                <label style="font-size:0.85em;color:var(--pa-sub);display:block;margin-bottom:6px">
                    Selecione o aluno cuja folha está em suas mãos:
                </label>
                <div class="tcor-csel tcor-csel--disabled" id="tcorSelect_${p.prova_id}" style="box-shadow:0 0 0 1.5px ${borderColor}">
                    <div class="tcor-csel-trigger"
                         role="combobox"
                         tabindex="0"
                         aria-haspopup="listbox"
                         aria-expanded="false"
                         aria-disabled="true"
                         onclick="tcorToggleSelect(this.closest('.tcor-csel'))">
                        <span class="tcor-csel-value">— Carregando alunos… —</span>
                        <span class="tcor-csel-arrow" aria-hidden="true">▾</span>
                    </div>
                    <div class="tcor-csel-panel" style="display:none"></div>
                </div>
                <div id="tcorAcao_${p.prova_id}" style="margin-top:10px"></div>
                <div id="tcorMsg_${p.prova_id}" style="font-size:0.8em;color:var(--pa-sub);margin-top:4px;min-height:16px"></div>
            </div>`;
        }).join('');

        /* ── Renderiza cards de provas já concluídas ── */
        const cardsConcluidos = provasConcluidas.map(p => `
            <div class="pa-tcor-card pa-tcor-card--concluida">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                    <span style="font-size:1.4rem;line-height:1">✅</span>
                    <div style="font-size:1rem;font-weight:700;color:var(--pa-text)">
                        ${escapeHtmlGam(p.prova_nome || 'Prova')}
                    </div>
                </div>
                ${p.turma_corretora_nome ? `<div style="font-size:0.78em;color:var(--pa-sub);margin-bottom:8px">Turma corretora: <strong>${escapeHtmlGam(p.turma_corretora_nome)}</strong></div>` : ''}
                <div class="pa-tcor-concluida-msg">
                    ✅ Todas as folhas desta prova já foram corrigidas — bom trabalho!
                </div>
            </div>`).join('');

        const separador = provasAtivas.length > 0 && provasConcluidas.length > 0
            ? '<div class="pa-tcor-separador">Provas já concluídas</div>'
            : '';

        lista.innerHTML = cardsAtivos + separador + cardsConcluidos;

        /* Carrega lista de alunos para cada prova ativa (em paralelo) */
        provasAtivas.forEach(p => tcorCarregarListaAlunos(p.prova_id));
    } catch (_) {
        /* silencioso — módulo opcional */
    }
}

/* ── Helpers for the custom student select widget ─── */
function tcorCselClose(container) {
    const panel = container.querySelector('.tcor-csel-panel');
    if (panel) panel.style.display = 'none';
    container.classList.remove('tcor-csel--open');
    container.querySelector('.tcor-csel-trigger')?.setAttribute('aria-expanded', 'false');
}

function tcorCselSetPlaceholder(container, text) {
    const valEl = container.querySelector('.tcor-csel-value');
    const panel = container.querySelector('.tcor-csel-panel');
    if (valEl) valEl.textContent = text;
    if (panel) { panel.innerHTML = ''; panel.style.display = 'none'; }
    container.classList.add('tcor-csel--disabled');
    container.classList.remove('tcor-csel--open');
    const trigger = container.querySelector('.tcor-csel-trigger');
    if (trigger) { trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-disabled', 'true'); }
}

function tcorCselSetOptions(container, provaId, alunos) {
    const valEl = container.querySelector('.tcor-csel-value');
    const panel = container.querySelector('.tcor-csel-panel');
    const trigger = container.querySelector('.tcor-csel-trigger');

    /* Mostrar apenas alunos com gabarito físico ainda pendente */
    const pendentes = alunos.filter(a => a.sem_submissao);

    if (pendentes.length === 0) {
        tcorCselSetPlaceholder(container, '— Todos os gabaritos registrados —');
        return;
    }

    if (valEl) valEl.textContent = '— Selecione o aluno —';
    container.classList.remove('tcor-csel--disabled');
    if (trigger) { trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-disabled', 'false'); }
    if (!panel) return;
    panel.setAttribute('role', 'listbox');
    panel.innerHTML = '';
    const ph = document.createElement('div');
    ph.className = 'tcor-csel-item tcor-csel-item--placeholder';
    ph.setAttribute('role', 'option');
    ph.setAttribute('aria-disabled', 'true');
    ph.textContent = '— Selecione o aluno —';
    panel.appendChild(ph);

    let focusedIdx = -1;

    const items = pendentes.map((a, _localIdx) => {
        /* Preservar o índice original no array completo para lookup via window._tcorAlunos */
        const originalIdx = alunos.indexOf(a);
        const num  = a.numchamada != null ? String(a.numchamada).padStart(2, '0') + ' · ' : '';
        const item = document.createElement('div');
        item.className = 'tcor-csel-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.textContent = num + a.nome;
        item.dataset.value = String(originalIdx);
        item.addEventListener('click', () => {
            panel.querySelectorAll('.tcor-csel-item--selected').forEach(el => {
                el.classList.remove('tcor-csel-item--selected');
                el.setAttribute('aria-selected', 'false');
            });
            item.classList.add('tcor-csel-item--selected');
            item.setAttribute('aria-selected', 'true');
            if (valEl) valEl.textContent = item.textContent;
            tcorCselClose(container);
            tcorSelecionarAluno(provaId, { value: String(originalIdx) });
        });
        panel.appendChild(item);
        return item;
    });

    function moveFocus(delta) {
        const selectableItems = items;
        if (!selectableItems.length) return;
        focusedIdx = Math.max(0, Math.min(selectableItems.length - 1, focusedIdx + delta));
        selectableItems.forEach((el, i) => el.classList.toggle('tcor-csel-item--focused', i === focusedIdx));
        selectableItems[focusedIdx]?.scrollIntoView({ block: 'nearest' });
    }

    trigger?.addEventListener('keydown', e => {
        const isOpen = container.classList.contains('tcor-csel--open');
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isOpen) { tcorToggleSelect(container); focusedIdx = -1; moveFocus(1); }
            else if (focusedIdx >= 0) { items[focusedIdx]?.click(); }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) { tcorToggleSelect(container); focusedIdx = -1; moveFocus(1); }
            else moveFocus(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (isOpen) moveFocus(-1);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            tcorCselClose(container);
        }
    });
}

function tcorToggleSelect(container) {
    if (container.classList.contains('tcor-csel--disabled')) return;
    const panel = container.querySelector('.tcor-csel-panel');
    if (!panel || !panel.children.length) return;
    const isOpen = container.classList.contains('tcor-csel--open');
    document.querySelectorAll('.tcor-csel--open').forEach(el => tcorCselClose(el));
    if (!isOpen) {
        panel.style.display = '';
        container.classList.add('tcor-csel--open');
        container.querySelector('.tcor-csel-trigger')?.setAttribute('aria-expanded', 'true');
    }
}
window.tcorToggleSelect = tcorToggleSelect;

document.addEventListener('click', e => {
    if (!e.target.closest('.tcor-csel')) {
        document.querySelectorAll('.tcor-csel--open').forEach(el => tcorCselClose(el));
    }
});

/* ── Carrega lista de alunos da turma alvo no select ─── */
async function tcorCarregarListaAlunos(provaId) {
    const sel = document.getElementById(`tcorSelect_${provaId}`);
    const msg = document.getElementById(`tcorMsg_${provaId}`);
    if (!sel) return;
    try {
        const r = await fetch(
            `/api/alunos-portal/turma-corretora/lista-turma-alvo?prova_id=${provaId}`,
            { credentials: 'include' }
        );
        const d = await r.json();

        /* Erro explícito do servidor */
        if (!r.ok || d.erro) {
            const textoErro = d.erro || `HTTP ${r.status}`;
            tcorCselSetPlaceholder(sel, '— Erro ao carregar —');
            if (msg) msg.textContent = textoErro;
            return;
        }

        /* Aviso sem alunos (ex.: token expirado) */
        if (d.aviso) {
            tcorCselSetPlaceholder(sel, '— Nenhum aluno disponível —');
            if (msg) msg.textContent = d.aviso;
            return;
        }

        if (!d.alunos) {
            tcorCselSetPlaceholder(sel, '— Erro ao carregar —');
            if (msg) msg.textContent = 'Resposta inesperada do servidor.';
            return;
        }

        window._tcorAlunos    = window._tcorAlunos    || {};
        window._tcorVariantes = window._tcorVariantes || {};
        window._tcorAlunos[provaId]    = d.alunos;
        window._tcorVariantes[provaId] = d.variantes || [];

        /* Progresso: mostra badge "X/Y corrigidos" quando há pelo menos 1 já corrigido */
        const progDiv = document.getElementById(`tcorProgresso_${provaId}`);
        if (progDiv) {
            const jaCorr   = d.ja_corrigidos || 0;
            const totalTur = d.total_turma   || 0;
            if (jaCorr > 0 && totalTur > 0) {
                progDiv.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;background:#eff6ff;border:1px solid #93c5fd;border-radius:20px;padding:3px 10px;font-size:0.8em;font-weight:600;color:#1d4ed8">` +
                    `<span style="font-size:1em">📋</span>${jaCorr}/${totalTur} corrigidos</span>`;
            } else {
                progDiv.innerHTML = '';
            }
        }

        /* ── Pré-atribuições: correção às cegas com botão direto ── */
        const preAtribuidas = d.alunos.filter(a => a.pre_atribuida && a.submissao_ref_id);
        if (preAtribuidas.length > 0) {
            sel.style.display = 'none';
            const labelEl = sel.previousElementSibling;
            if (labelEl && labelEl.tagName === 'LABEL') labelEl.style.display = 'none';
            const acaoDiv = document.getElementById(`tcorAcao_${provaId}`);
            if (acaoDiv) {
                const btns = preAtribuidas.map(a =>
                    `<div style="margin-bottom:8px">
                        <span style="font-size:0.85em;color:var(--pa-sub);display:block;margin-bottom:6px">Folha sorteada para você corrigir:</span>
                        <a href="/alunos/prova/?tcor=${encodeURIComponent(a.submissao_ref_id)}"
                           style="display:inline-block;background:#22c55e;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">
                            ${escapeHtmlGam(a.nome)} → Corrigir
                        </a>
                    </div>`
                ).join('');
                acaoDiv.innerHTML = btns;
            }
            if (msg) msg.textContent = '';
            return;
        }

        if (d.alunos.length === 0) {
            tcorCselSetPlaceholder(sel, '— Nenhum aluno disponível —');
            if (d.todos_corrigidos) {
                sel.style.display = 'none';
                const existing = sel.parentElement && sel.parentElement.querySelector('.tcor-todos-corrigidos');
                if (!existing) {
                    const card = document.createElement('div');
                    card.className = 'tcor-todos-corrigidos';
                    card.style.cssText = 'display:flex;align-items:center;gap:10px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin-top:8px;';
                    card.innerHTML = '<span style="font-size:1.5rem">✅</span><span style="color:#166534;font-weight:600;font-size:14px">Todos os alunos desta turma já foram corrigidos.</span>';
                    sel.parentElement.appendChild(card);
                }
                if (msg) msg.textContent = '';
            } else {
                if (msg) msg.textContent = 'Nenhum aluno encontrado na turma. Verifique se o professor está com o Google Classroom conectado.';
            }
            return;
        }
        /* Remove card "todos corrigidos" caso apareça após recarga */
        const oldCard = sel.parentElement && sel.parentElement.querySelector('.tcor-todos-corrigidos');
        if (oldCard) oldCard.remove();
        sel.style.display = '';
        tcorCselSetOptions(sel, provaId, d.alunos);
        if (msg) msg.textContent = '';
    } catch (err) {
        if (sel) tcorCselSetPlaceholder(sel, '— Erro ao carregar —');
        if (msg) msg.textContent = `Erro de rede: ${err.message}`;
    }
}
window.tcorCarregarListaAlunos = tcorCarregarListaAlunos;

/* ── Reage à seleção do aluno no select ──────────────── */
function tcorSelecionarAluno(provaId, sel) {
    const acao = document.getElementById(`tcorAcao_${provaId}`);
    const msg  = document.getElementById(`tcorMsg_${provaId}`);
    if (!acao) return;
    const idx = sel.value;
    if (idx === '') { acao.innerHTML = ''; return; }
    const a         = (window._tcorAlunos?.[provaId] || [])[parseInt(idx, 10)];
    const variantes = window._tcorVariantes?.[provaId] || [];
    if (!a) { acao.innerHTML = ''; return; }

    if (!a.sem_submissao) {
        /* Aluno com submissão digital — botão direto */
        acao.innerHTML = `
            <a href="/alunos/prova/?tcor=${encodeURIComponent(a.submissao_ref_id)}"
               style="display:inline-block;background:#22c55e;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">
                Corrigir →
            </a>`;
    } else {
        /* Aluno sem submissão digital — seleciona a variante da folha física */
        if (msg) msg.textContent = 'Escolha a variante impressa na folha do aluno:';
        const btns = variantes.map(v =>
            `<button onclick="tcorIniciarCorrecao(${provaId},'${escapeAttr(a.email_real)}','${escapeAttr(a.nome)}','${escapeAttr(v.codigo)}')"
                     style="background:#f59e0b;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
                 Variante ${escapeHtmlGam(v.codigo)} →
             </button>`
        ).join('');
        acao.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">${btns}</div>`;
    }
}
window.tcorSelecionarAluno = tcorSelecionarAluno;

/* ── Cria submissão em branco e redireciona para correção ── */
async function tcorIniciarCorrecao(provaId, alunoEmail, alunoNome, varianteCodigo) {
    const btn = event?.target;
    try {
        if (btn) { btn.disabled = true; btn.textContent = '…'; }
        const r = await fetch('/api/alunos-portal/turma-corretora/iniciar-correcao', {
            method:      'POST',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/json' },
            body:        JSON.stringify({ prova_id: provaId, aluno_email: alunoEmail, aluno_nome: alunoNome, variante_codigo: varianteCodigo }),
        });
        const d = await r.json();
        if (!r.ok) {
            alert(d.erro || 'Erro ao iniciar correção.');
            if (btn) { btn.disabled = false; btn.textContent = `Variante ${varianteCodigo} →`; }
            return;
        }
        window.location.href = `/alunos/prova/?tcor=${encodeURIComponent(d.submissao_ref_id)}`;
    } catch (_) {
        alert('Erro de rede. Tente novamente.');
        if (btn) { btn.disabled = false; btn.textContent = `Variante ${varianteCodigo} →`; }
    }
}
window.tcorIniciarCorrecao = tcorIniciarCorrecao;

/* ── Tarefas de 2ª correção (sortição) ───────────────── */
async function carregarTarefasCorretor() {
    try {
        const r = await fetch('/api/alunos-portal/segundo-corretor/pendentes', { credentials: 'include' });
        if (!r.ok) return;
        const { pendentes } = await r.json();
        const sec        = document.getElementById('paCorretorSection');
        const lista      = document.getElementById('paCorretorLista');
        const corrAlert  = $('paCorretorAlert');
        const corrAlertTxt = $('paCorretorAlertTxt');
        if (!sec || !lista) return;
        if (!pendentes || pendentes.length === 0) {
            sec.style.display = 'none';
            if (corrAlert) corrAlert.style.display = 'none';
            _correcoesPendentes.corretor = 0;
            _atualizarBadgeCorrecoes();
            return;
        }
        sec.style.display = '';
        _correcoesPendentes.corretor = pendentes.length;
        _atualizarBadgeCorrecoes();

        /* Banner de alerta na aba Atividades */
        if (corrAlert) {
            corrAlert.style.display = '';
            if (corrAlertTxt) {
                const n = pendentes.length;
                corrAlertTxt.textContent = n === 1
                    ? 'Você tem 1 correção anônima pendente'
                    : `Você tem ${n} correções anônimas pendentes`;
            }
        }

        lista.innerHTML = pendentes.map(p => {
            const isVoluntario = p.tipo === 'segundo_corretor_voluntario';
            const origemBadge = isVoluntario
                ? `<span class="pa-badge-voluntario">🙋 Voluntário</span>`
                : `<span class="pa-badge-sorteado">🎲 Sorteado</span>`;
            return `
            <div class="pa-card-segundo-corretor" style="padding:14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                            <strong>${(p.prova_nome || 'Prova').replace(/[<>]/g, '')}</strong>
                            ${origemBadge}
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
                            <span class="pa-badge-variante">⚠️ Variante ${p.variante_codigo != null ? p.variante_codigo : '—'}</span>
                            <span class="pa-corretor-meta">${p.qtd_questoes} questões · ${new Date(p.criado_em).toLocaleDateString('pt-BR')}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                            <span class="pa-corretor-step">
                                <span class="pa-corretor-step-num">1</span>
                                📋 Receber gabarito às cegas
                            </span>
                            <span class="pa-corretor-arrow">→</span>
                            <span class="pa-corretor-step">
                                <span class="pa-corretor-step-num">2</span>
                                ✏️ Realizar correção
                            </span>
                        </div>
                    </div>
                    <a class="pa-corretor-btn" href="/alunos/prova/?seg=${p.submissao_ref_id}">Corrigir agora →</a>
                </div>
            </div>`;
        }).join('');
    } catch (_) {
        /* silencioso — módulo opcional */
    }
}

/* ── Reputação / gamificação ─────────────────────────── */
async function carregarReputacao() {
    try {
        const r = await fetch('/api/alunos-portal/reputacao', { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        const sec = document.getElementById('paReputacaoSection');
        if (!sec) return;
        const card = (rep, titulo) => {
            const ra = rep.rank || { emoji: '🌱', nome: '—' };
            const px = rep.proximoRank;
            const prog = px ? Math.min(100, Math.round(((rep.xp_total - ra.min) / (px.min - ra.min)) * 100)) : 100;
            const badges = (rep.badges_json || []).map(b => `<span title="${escapeAttr(b.nome)}" style="font-size:1.4em">${b.emoji}</span>`).join(' ');
            const streakLine = rep.streak_atual > 0 ? `🔥 Streak ${rep.streak_atual}` : '';
            return `
                <div style="flex:1;min-width:240px;border:1px solid #ddd;border-radius:10px;padding:12px;background:#fff">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
                        <strong style="font-size:0.85em;color:#666;text-transform:uppercase;letter-spacing:.5px">${titulo}</strong>
                        <span style="font-size:0.8em;color:#999">${rep.acoes_total} ${rep.acoes_total === 1 ? 'ação' : 'ações'}</span>
                    </div>
                    <div style="font-size:1.2em;font-weight:600;margin-bottom:4px">${ra.emoji} ${ra.nome}</div>
                    <div style="font-size:0.9em;color:#444;margin-bottom:8px">${rep.xp_total} XP ${streakLine ? '· ' + streakLine : ''}</div>
                    <div style="background:#eee;border-radius:6px;overflow:hidden;height:6px;margin-bottom:6px">
                        <div style="background:#4285f4;height:100%;width:${prog}%"></div>
                    </div>
                    <div style="font-size:0.75em;color:#888">${px ? `${rep.faltaProximo} XP para ${px.emoji} ${px.nome}` : '🏆 Rank máximo atingido'}</div>
                    ${badges ? `<div style="margin-top:8px;border-top:1px solid #eee;padding-top:6px">${badges}</div>` : ''}
                </div>`;
        };
        sec.style.display = '';
        sec.innerHTML = `
            <div style="border:1px solid #e3e3e3;border-radius:10px;padding:12px;background:#fafafa">
                <div style="margin-bottom:8px;font-weight:600;color:#333">🎮 Sua reputação</div>
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                    ${card(d.aluno, '📝 Aluno')}
                    ${card(d.corretor, '🔍 Corretor')}
                </div>
            </div>`;
    } catch (_) { /* opcional */ }
}

async function carregarVoluntariar() {
    try {
        const r = await fetch('/api/alunos-portal/voluntariar/disponiveis', { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        const sec = document.getElementById('paVoluntariarSection');
        if (!sec) return;
        if (!d.provas || d.provas.length === 0 || d.podePegar === 0) {
            sec.style.display = 'none';
            return;
        }
        sec.style.display = '';
        sec.innerHTML = `
            <div style="border:1px dashed #4285f4;border-radius:10px;padding:12px;background:#f0f7ff">
                <div style="font-weight:600;margin-bottom:6px">🎯 Quer corrigir mais provas? <span style="font-weight:400;color:#666">(XP em dobro!)</span></div>
                <div style="font-size:0.85em;color:#555;margin-bottom:10px">Você pode pegar até <strong>${d.podePegar}</strong> tarefa(s) extra agora. Limite: 3 voluntárias por dia.</div>
                ${d.provas.map(p => `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #d8e6f7">
                        <div>
                            <strong>${escapeHtmlGam(p.nome)}</strong>
                            <div style="font-size:0.8em;color:#666">${p.qtd_submetidas} submissão(ões) disponíveis · você já fez ${p.minhas_correcoes}/2 nessa prova</div>
                        </div>
                        <button class="pa-btn pa-btn-primary" onclick="voluntariar(${p.id}, this)" style="background:#4285f4;color:#fff;padding:6px 12px;border:none;border-radius:6px;cursor:pointer">+ Pegar uma</button>
                    </div>
                `).join('')}
            </div>`;
    } catch (_) { /* opcional */ }
}

async function voluntariar(provaId, btn) {
    btn.disabled = true;
    btn.textContent = '...';
    try {
        const r = await fetch(`/api/alunos-portal/voluntariar/${provaId}`, { method: 'POST', credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro');
        notificar('🎉 Tarefa voluntária adicionada! Veja em "Tarefas de correção pendentes".');
        await carregarTarefasCorretor();
        await carregarVoluntariar();
    } catch (e) {
        notificar('Erro: ' + e.message, 'erro');
        btn.disabled = false;
        btn.textContent = '+ Pegar uma';
    }
}

function escapeHtmlGam(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtmlGam(s); }

window.voluntariar = voluntariar;

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
            carregarTurmaCorretora();
            carregarReputacao();
            carregarVoluntariar();
            carregarProjetosAluno();
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
    $('paNavMenu').style.display        = 'none';
    $('paUserArea').style.display       = 'none';
    $('paThemeBtnPre').style.display    = 'flex';
    $('paTourBtn').style.display        = 'none';
    $('paTourOverlay').style.display    = 'none';
}

function mostrarTelaLogado(aluno) {
    $('paTelalogin').style.display      = 'none';
    $('paTelaAtividades').style.display = '';
    $('paNavMenu').style.display        = '';
    $('paUserArea').style.display       = 'flex';
    $('paThemeBtnPre').style.display    = 'none';
    $('paTourBtn').style.display         = 'flex';
    $('paConquistasBtn').style.display   = 'flex';
    const tabGrupoEl = $('paTabGrupo');
    if (tabGrupoEl) tabGrupoEl.style.display = '';

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
        /* Popula o seletor de cursos do Meu Grupo */
        _mgCursos = (data.cursos || []).map(c => ({ id: c.cursoId, nome: c.nome }));
        mgPopularCursoSelect();
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

/* ── Faixa de status proporcional (sugestão C) ───────── */
function renderStatusBar(curso) {
    const vencidas  = (curso.atividades || []).filter(a =>  a.vencida).length;
    const noPrazo   = (curso.atividades || []).filter(a => !a.vencida).length;
    const aguardando = (curso.aguardando || []).length;
    const zeradas   = (curso.zeradas    || []).length;
    const total     = vencidas + noPrazo + aguardando + zeradas;
    if (!total) return null;

    const pct = n => `${((n / total) * 100).toFixed(2)}%`;
    const segs = [
        { count: vencidas,   cls: 'pa-sb-vencida',   label: `${vencidas} vencida${vencidas !== 1 ? 's' : ''}` },
        { count: noPrazo,    cls: 'pa-sb-noprazo',   label: `${noPrazo} no prazo` },
        { count: aguardando, cls: 'pa-sb-aguardando', label: `${aguardando} aguardando correção` },
        { count: zeradas,    cls: 'pa-sb-zerada',     label: `${zeradas} zerada${zeradas !== 1 ? 's' : ''}` },
    ].filter(s => s.count > 0);

    const bar = document.createElement('div');
    bar.className = 'pa-status-bar';
    bar.setAttribute('aria-label', segs.map(s => s.label).join(' · '));

    segs.forEach(({ count, cls, label }) => {
        const seg = document.createElement('div');
        seg.className = `pa-sb-seg ${cls}`;
        seg.style.width = pct(count);
        seg.title = label;
        bar.appendChild(seg);
    });

    return bar;
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

    const statusBar = renderStatusBar(curso);
    if (statusBar) card.appendChild(statusBar);

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
    reabertura_aprovada:        '✅',
    reabertura_negada:          '❌',
    prazo_proximo:              '⏰',
    prazo_dias:                 '📅',
    verificacao_professor:      '📋',
    turma_corretora_disponivel: '✏️',
    turma_corretora_atribuida:  '🏫',
    convite_grupo:              '👥',
};
const NOTIF_COR = {
    reabertura_aprovada:        'verde',
    reabertura_negada:          'vermelho',
    prazo_proximo:              'laranja',
    prazo_dias:                 'amarelo',
    verificacao_professor:      'azul',
    turma_corretora_disponivel: 'verde',
    turma_corretora_atribuida:  'azul',
    convite_grupo:              'azul',
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

    /* Botões de convite de grupo (visíveis somente para convite_grupo) */
    const isConvite = _notifAtual.tipo === 'convite_grupo';
    const conviteBtns = $('paNotifConviteBtns');
    const btnOk = $('paNotifBtnOk');
    if (conviteBtns) conviteBtns.style.display = isConvite ? 'flex' : 'none';
    if (btnOk) btnOk.style.display = isConvite ? 'none' : '';

    /* Botão de ação extra (ex: abrir atividade reaberta / ir para correções) */
    const link = _notifAtual.dados?.link;
    btnAcao.onclick = null;
    if (isConvite) {
        btnAcao.style.display = 'none';
    } else if (link && _notifAtual.tipo === 'reabertura_aprovada') {
        btnAcao.href          = link;
        btnAcao.textContent   = 'Ver atividade →';
        btnAcao.style.display = '';
    } else if (_notifAtual.tipo === 'turma_corretora_disponivel' ||
               _notifAtual.tipo === 'turma_corretora_atribuida') {
        btnAcao.href    = '#';
        btnAcao.onclick = (e) => {
            e.preventDefault();
            const provaId = _notifAtual.dados?.provaId;
            confirmarNotif();
            /* Abre aba de correções */
            mudarAba('correcoes');
            setTimeout(() => {
                /* Tenta rolar ao card ativo; se ainda não há folhas, ao card de aguardando */
                const card = provaId
                    ? (document.getElementById(`tcorCard_${provaId}`) ||
                       document.getElementById(`tcorCardAg_${provaId}`))
                    : null;
                const alvo = card || document.getElementById('paTurmaCorretoraSec');
                if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 200);
        };
        btnAcao.textContent   = 'Abrir fila de correções →';
        btnAcao.style.display = '';
    } else if (!isConvite) {
        btnAcao.style.display = 'none';
    }

    /* Badge de privacidade para orientações de verificação */
    const privBadgeId = 'paNotifPrivadaBadge';
    let privBadge = document.getElementById(privBadgeId);
    if (_notifAtual.tipo === 'verificacao_professor') {
        if (!privBadge) {
            privBadge = document.createElement('div');
            privBadge.id        = privBadgeId;
            privBadge.className = 'pa-notif-privada-badge';
            privBadge.textContent = '🔒 Somente você pode ver esta mensagem';
            msg.parentNode.insertBefore(privBadge, msg.nextSibling);
        }
        privBadge.style.display = '';
    } else if (privBadge) {
        privBadge.style.display = 'none';
    }

    /* Contador de fila */
    const total = _notifQueue.length + 1; /* atual + restantes */
    const restam = _notifQueue.length;
    contador.textContent = restam > 0 ? `1 de ${total} avisos` : '';
    contador.style.display = restam > 0 ? '' : 'none';

    /* Bloqueia página */
    modal.style.display = 'flex';
}

/* Responde a um convite de grupo diretamente da notificação */
async function responderConviteGrupo(acao) {
    const notif = _notifAtual;
    if (!notif) return;
    const grupoId = notif.dados?.grupoId;
    if (!grupoId) { confirmarNotif(); return; }

    /* Desabilita os botões durante a requisição */
    const btns = document.querySelectorAll('.pa-notif-convite-btn');
    btns.forEach(b => { b.disabled = true; });

    try {
        const r = await fetch(`/api/alunos-portal/grupos-portal/${grupoId}/responder-convite`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao, notifId: notif.id }),
        });
        const d = await r.json();
        if (!r.ok) {
            btns.forEach(b => { b.disabled = false; });
            alert(d.erro || 'Erro ao responder convite.');
            return;
        }
        /* Fecha o modal e avança a fila */
        _notifAtual = null;
        if (_notifQueue.length > 0) mostrarProximaNotif();
        else $('paNotifModal').style.display = 'none';

        /* Se o aluno aceitou e a aba Meu Grupo está aberta, recarrega */
        if (acao === 'aceitar') {
            const courseId = notif.dados?.courseId;
            if (courseId && !_mgCursoId) {
                /* Pré-seleciona o curso se nenhum estiver selecionado */
                _mgCursoId   = courseId;
                _mgCursoNome = notif.dados?.courseNome || courseId;
                const sel = $('mgCursoSelect');
                if (sel) sel.value = courseId;
            }
            if (_mgCursoId === courseId || !courseId) _mgCarregarDados();
        }
    } catch (_) {
        btns.forEach(b => { b.disabled = false; });
    }
}
window.responderConviteGrupo = responderConviteGrupo;

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

/* ── Projetos do Grupo ───────────────────────────────── */
const PA_TIPO_ICON = { github:'🐙', replit:'🔷', supabase:'⚡', vercel:'▲', netlify:'🌿', deploy:'🚀', outro:'🔗' };
const PA_STATUS_LABEL = { pendente:'⏳ Aguardando aprovação', aprovado:'✅ Aprovado', rejeitado:'❌ Rejeitado' };
const PA_STATUS_COLOR = { pendente:'#92400e', aprovado:'#065f46', rejeitado:'#991b1b' };

async function carregarProjetosAluno() {
    const sec = $('paProjetosSection');
    if (!sec) return;
    try {
        const r = await fetch('/api/alunos-portal/projetos/minhas-sugestoes', { credentials: 'include' });
        if (!r.ok) return;
        const sugestoes = await r.json();
        sec.style.display = '';
        const lista = $('paProjetosLista');
        if (!lista) return;

        /* Atualiza o <select> da aba de anexo de imagem */
        const sel = $('paAnexarSelect');
        if (sel) {
            const prev = sel.value;
            sel.innerHTML = '<option value="">— Selecione um projeto —</option>' +
                sugestoes.map(s => `<option value="${escapeAttr(String(s.id))}">${escapeHtmlPA(s.nome)}</option>`).join('');
            if (prev) sel.value = prev;
        }

        if (!sugestoes.length) {
            lista.innerHTML = '<p style="font-size:13px;color:#9ca3af;font-style:italic;margin:4px 0">Você ainda não submeteu nenhum projeto.</p>';
            return;
        }
        lista.innerHTML = sugestoes.map(s => {
            const icon  = PA_TIPO_ICON[s.tipo]  || '🔗';
            const label = PA_STATUS_LABEL[s.status] || s.status;
            const color = PA_STATUS_COLOR[s.status] || '#374151';
            const thumb = s.foto_url
                ? `<div style="margin-top:8px">
                       <img src="${escapeAttr(s.foto_url)}" alt="imagem do projeto"
                            style="max-width:160px;max-height:110px;border-radius:8px;border:1px solid #e5e7eb;object-fit:cover;cursor:pointer"
                            onclick="window.open(this.src,'_blank')">
                   </div>`
                : '';
            return `
                <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fff;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
                    <div style="flex:1;min-width:180px">
                        <div style="font-weight:600;font-size:14px;margin-bottom:2px">${icon} ${escapeHtmlPA(s.nome)}</div>
                        <div style="font-size:12px;color:#4338ca;word-break:break-all;margin-bottom:4px">
                            <a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" style="color:#4338ca">${escapeHtmlPA(s.url)}</a>
                        </div>
                        <div style="font-size:11px;color:#6b7280">
                            Enviado em ${new Date(s.criado_em).toLocaleDateString('pt-BR')}
                        </div>
                        ${thumb}
                    </div>
                    <span style="font-size:12px;font-weight:700;color:${color};white-space:nowrap;padding-top:2px">${label}</span>
                </div>`;
        }).join('');
    } catch (_) { /* silencioso */ }
}

/* ── Alternância de abas na seção de projetos ─── */
function paProjetosAba(aba) {
    const formLink   = $('paProjetosFormLink');
    const formImagem = $('paProjetosFormImagem');
    const tabLink    = $('paProjetosTabLink');
    const tabImagem  = $('paProjetosTabImagem');
    if (!formLink || !formImagem) return;
    const isImagem = aba === 'imagem';
    formLink.style.display   = isImagem ? 'none' : '';
    formImagem.style.display = isImagem ? '' : 'none';
    if (tabLink) {
        tabLink.style.borderBottomColor = isImagem ? 'transparent' : '#f59e0b';
        tabLink.style.color             = isImagem ? '#6b7280' : '#b45309';
    }
    if (tabImagem) {
        tabImagem.style.borderBottomColor = isImagem ? '#0ea5e9' : 'transparent';
        tabImagem.style.color             = isImagem ? '#0369a1' : '#6b7280';
    }
}

/* ── Pré-visualização local antes do upload ─── */
function paPreviewImagem(input) {
    const prev    = $('paAnexarPreview');
    const prevImg = $('paAnexarPreviewImg');
    const nome    = $('paAnexarNomeArquivo');
    if (!input.files?.length) { if (prev) prev.style.display = 'none'; return; }
    const file = input.files[0];
    if (nome) nome.textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
        if (prevImg) prevImg.src = e.target.result;
        if (prev)    prev.style.display = '';
    };
    reader.readAsDataURL(file);
}

/* ── Upload da imagem vinculada ao projeto ─── */
async function paUploadImagemProjeto() {
    const sel  = $('paAnexarSelect');
    const file = $('paAnexarFile');
    const msg  = $('paAnexarMsg');
    const projetoId = sel?.value;
    if (!projetoId) {
        if (msg) { msg.textContent = 'Selecione um projeto antes de anexar.'; msg.style.color = '#dc2626'; }
        return;
    }
    if (!file?.files?.length) {
        if (msg) { msg.textContent = 'Escolha uma imagem antes de enviar.'; msg.style.color = '#dc2626'; }
        return;
    }
    if (msg) { msg.textContent = 'Enviando…'; msg.style.color = '#6b7280'; }
    try {
        const form = new FormData();
        form.append('imagem', file.files[0]);
        const r = await fetch(`/api/alunos-portal/projetos/${encodeURIComponent(projetoId)}/imagem`, {
            method: 'POST',
            credentials: 'include',
            body: form,
        });
        const d = await r.json();
        if (!r.ok) {
            if (msg) { msg.textContent = d.erro || 'Erro ao enviar.'; msg.style.color = '#dc2626'; }
            return;
        }
        if (msg) { msg.textContent = '✅ Imagem anexada com sucesso!'; msg.style.color = '#065f46'; }
        file.value = '';
        const prev = $('paAnexarPreview');
        if (prev) prev.style.display = 'none';
        await carregarProjetosAluno();
        setTimeout(() => { if (msg) msg.textContent = ''; }, 5000);
    } catch (_) {
        if (msg) { msg.textContent = 'Erro de rede. Tente novamente.'; msg.style.color = '#dc2626'; }
    }
}

async function submeterProjetoAluno() {
    const urlEl  = $('paProjetoUrl');
    const nomeEl = $('paProjetoNome');
    const msg    = $('paProjetoMsg');
    const url    = urlEl?.value?.trim();
    const nome   = nomeEl?.value?.trim();
    if (!url || !nome) {
        if (msg) { msg.textContent = 'Informe a URL e o nome do projeto.'; msg.style.color = '#dc2626'; }
        return;
    }
    if (msg) { msg.textContent = 'Enviando…'; msg.style.color = '#6b7280'; }
    try {
        const r = await fetch('/api/alunos-portal/projetos/sugerir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ url, nome }),
        });
        const d = await r.json();
        if (!r.ok) {
            if (msg) { msg.textContent = d.erro || 'Erro ao enviar.'; msg.style.color = '#dc2626'; }
            return;
        }
        if (urlEl)  urlEl.value  = '';
        if (nomeEl) nomeEl.value = '';
        if (msg) { msg.textContent = '✅ Enviado! O professor será notificado.'; msg.style.color = '#065f46'; }
        await carregarProjetosAluno();
        setTimeout(() => { if (msg) msg.textContent = ''; }, 5000);
    } catch (_) {
        if (msg) { msg.textContent = 'Erro de rede. Tente novamente.'; msg.style.color = '#dc2626'; }
    }
}

function escapeHtmlPA(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.submeterProjetoAluno   = submeterProjetoAluno;
window.paProjetosAba          = paProjetosAba;
window.paPreviewImagem        = paPreviewImagem;
window.paUploadImagemProjeto  = paUploadImagemProjeto;

/* ════════════════════════════════════════════════════════════
   MEU GRUPO — Portal do Aluno
   ════════════════════════════════════════════════════════════ */

const _mgEsc = s => escapeHtmlPA(s);

/* Popula o select de disciplinas com os cursos carregados */
function mgPopularCursoSelect() {
    const sel = $('mgCursoSelect');
    if (!sel) return;
    const valorAtual = sel.value;
    sel.innerHTML = '<option value="">— Selecione a disciplina —</option>' +
        _mgCursos.map(c => `<option value="${_mgEsc(c.id)}"${c.id === valorAtual ? ' selected' : ''}>${_mgEsc(c.nome)}</option>`).join('');
    if (!valorAtual && _mgCursos.length === 1) {
        sel.value = _mgCursos[0].id;
        _mgCursoId   = _mgCursos[0].id;
        _mgCursoNome = _mgCursos[0].nome;
    }
}
window.mgPopularCursoSelect = mgPopularCursoSelect;

/* Chamado quando o aluno muda a disciplina no select */
function mgSelecionarCurso() {
    const sel = $('mgCursoSelect');
    if (!sel) return;
    _mgCursoId   = sel.value;
    _mgCursoNome = sel.options[sel.selectedIndex]?.text || '';
    _mgGrupo     = null;
    if (!_mgCursoId) {
        $('mgConteudo').innerHTML = `<div class="mg-placeholder"><span class="mg-placeholder-icon">🎓</span><p>Selecione uma disciplina acima para ver ou criar seu grupo.</p></div>`;
        return;
    }
    _mgCarregarDados();
}
window.mgSelecionarCurso = mgSelecionarCurso;

/* Carrega o grupo atual (ou estado sem grupo) para o courseId selecionado */
async function _mgCarregarDados() {
    const div = $('mgConteudo');
    if (!div || !_mgCursoId) return;
    div.innerHTML = '<div class="mg-loading">⏳ Carregando...</div>';
    try {
        const r = await fetch(`/api/alunos-portal/grupos-portal/meu?courseId=${encodeURIComponent(_mgCursoId)}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
        _mgGrupo = d.grupo || null;
        _mgRenderConteudo();
    } catch (e) {
        div.innerHTML = `<div class="mg-msg mg-msg--erro">Erro ao carregar grupo: ${_mgEsc(e.message)}</div>`;
    }
}

/* Renderiza o conteúdo da aba com base no estado atual */
function _mgRenderConteudo() {
    const div = $('mgConteudo');
    if (!div) return;
    if (_mgGrupo) {
        div.innerHTML = _mgHtmlGrupoAtual(_mgGrupo);
    } else {
        _mgCarregarSemGrupo(div);
    }
}

/* HTML do grupo atual (o aluno já está em um grupo) */
function _mgHtmlGrupoAtual(g) {
    const lock = g.bloqueado
        ? `<span class="mg-badge-lock">🔒 Bloqueado pelo professor</span>`
        : '';
    const membrosHtml = (g.membros || []).map(m => {
        const isPendente = m.status === 'pendente';
        const euBadge = (m.email === _mgSessaoEmail()) ? ' mg-membro--eu' : '';
        const pendBadge = isPendente ? ' mg-membro--pendente' : '';
        const label   = (m.email === _mgSessaoEmail()) ? ' (você)' : '';
        const pendTag = isPendente ? ' <span class="mg-membro-pend-tag">⏳ pendente</span>' : '';
        return `<div class="mg-membro${euBadge}${pendBadge}"><span class="mg-membro-avatar">${isPendente ? '⏳' : '👤'}</span>${_mgEsc(m.nome || m.email)}${label}${pendTag}</div>`;
    }).join('');

    const btnSair = !g.bloqueado
        ? `<button class="mg-btn-sair" onclick="mgSair()">Sair do Grupo</button>`
        : `<span style="font-size:0.8rem;color:var(--pa-sub)">Grupo bloqueado — peça ao professor para sair.</span>`;

    /* Links de todos os membros */
    const todosLinksHtml = _mgHtmlTodosLinks(g.links || [], g.membros || []);

    /* Meus links atuais */
    const meu = g.meuLink || {};
    const extras = Array.isArray(meu.links_extras) ? meu.links_extras : [];

    return `
    <div class="mg-grupo-card${g.bloqueado ? ' mg-grupo-card--locked' : ''}">
        <div class="mg-grupo-header">
            <div>
                <div class="mg-grupo-nome">👥 ${_mgEsc(g.nome)}</div>
                <div class="mg-grupo-meta">${_mgEsc(_mgCursoNome)} · ${(g.membros || []).length} integrante(s)</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${lock}${btnSair}</div>
        </div>
        <div class="mg-membros-titulo">Integrantes</div>
        <div class="mg-membros">${membrosHtml || '<span class="mg-sem-links">Nenhum integrante ainda.</span>'}</div>
    </div>

    <div class="mg-links-section">
        <div class="mg-links-titulo">🔗 Meus Links de Projeto</div>
        <div class="mg-links-desc">Submeta os links individuais do seu projeto. Cada integrante envia os próprios links.</div>
        <div id="mgLinksMsg"></div>

        <div class="mg-link-row">
            <span class="mg-link-icon">⚙️</span>
            <span class="mg-link-label">Back-end</span>
            <input id="mgLinkBackend" class="mg-link-input" type="url" placeholder="https://github.com/..." value="${_mgEsc(meu.link_backend || '')}">
        </div>
        <div class="mg-link-row">
            <span class="mg-link-icon">🗄️</span>
            <span class="mg-link-label">Banco de dados</span>
            <input id="mgLinkBanco" class="mg-link-input" type="url" placeholder="https://supabase.io/..." value="${_mgEsc(meu.link_banco || '')}">
        </div>
        <div class="mg-link-row">
            <span class="mg-link-icon">🖥️</span>
            <span class="mg-link-label">Front-end</span>
            <input id="mgLinkFrontend" class="mg-link-input" type="url" placeholder="https://vercel.app/..." value="${_mgEsc(meu.link_frontend || '')}">
        </div>

        <div class="mg-extras-titulo">Links adicionais (opcional)</div>
        <div id="mgLinksExtrasDiv">
            ${extras.map((ex, i) => _mgHtmlExtraRow(ex.nome || '', ex.url || '', i)).join('')}
        </div>
        <button class="mg-btn-add-link" onclick="mgAdicionarLinkExtra()">＋ Adicionar outro link</button>
        <br>
        <button class="mg-btn-salvar" onclick="mgSalvarLinks(${g.id})">💾 Salvar meus links</button>
    </div>

    ${todosLinksHtml}`;
}

/* Linha de link extra dinâmico */
function _mgHtmlExtraRow(nome, url, idx) {
    return `<div class="mg-link-row" id="mgExtraRow_${idx}">
        <span class="mg-link-icon">🔗</span>
        <input class="mg-link-input" type="text" placeholder="Nome (ex: Deploy)" style="max-width:130px"
               id="mgExtraNome_${idx}" value="${_mgEsc(nome)}">
        <input class="mg-link-input" type="url" placeholder="URL" id="mgExtraUrl_${idx}" value="${_mgEsc(url)}">
        <button class="mg-link-remove" onclick="mgRemoverLinkExtra(${idx})" title="Remover">✕</button>
    </div>`;
}

/* HTML de todos os links enviados pelos membros */
function _mgHtmlTodosLinks(links, membros) {
    if (!membros.length) return '';
    const linksMap = Object.fromEntries((links || []).map(l => [l.aluno_email, l]));
    const rows = membros.map(m => {
        const l = linksMap[m.email];
        const extras = Array.isArray(l?.links_extras) ? l.links_extras : [];
        const linkItems = [
            l?.link_backend  ? `<div class="mg-link-item"><span class="mg-link-item-tag mg-link-item-tag--backend">Back-end</span><a href="${_mgEsc(l.link_backend)}" target="_blank" rel="noopener">${_mgEsc(l.link_backend)}</a></div>` : '',
            l?.link_banco    ? `<div class="mg-link-item"><span class="mg-link-item-tag mg-link-item-tag--banco">Banco</span><a href="${_mgEsc(l.link_banco)}" target="_blank" rel="noopener">${_mgEsc(l.link_banco)}</a></div>` : '',
            l?.link_frontend ? `<div class="mg-link-item"><span class="mg-link-item-tag mg-link-item-tag--frontend">Front-end</span><a href="${_mgEsc(l.link_frontend)}" target="_blank" rel="noopener">${_mgEsc(l.link_frontend)}</a></div>` : '',
            ...extras.filter(e => e.url).map(e => `<div class="mg-link-item"><span class="mg-link-item-tag mg-link-item-tag--extra">${_mgEsc(e.nome || 'Extra')}</span><a href="${_mgEsc(e.url)}" target="_blank" rel="noopener">${_mgEsc(e.url)}</a></div>`),
        ].filter(Boolean);
        const euLabel = (m.email === _mgSessaoEmail()) ? ' <span style="font-size:.72rem;background:var(--pa-badge-bg);color:var(--pa-badge-color);padding:1px 6px;border-radius:10px;font-weight:600">você</span>' : '';
        return `<div class="mg-membro-links">
            <div class="mg-membro-links-nome">👤 ${_mgEsc(m.nome || m.email)}${euLabel}</div>
            ${linkItems.length ? linkItems.join('') : '<div class="mg-sem-links">Nenhum link enviado ainda.</div>'}
        </div>`;
    }).join('');
    return `<div class="mg-todos-links"><div class="mg-todos-titulo">📋 Links de todos os integrantes</div>${rows}</div>`;
}

/* Estado sem grupo: mostra lista de grupos + opção de criar */
async function _mgCarregarSemGrupo(div) {
    div.innerHTML = `
        <div class="mg-criar-section">
            <div class="mg-criar-topo">
                <div>
                    <div class="mg-criar-titulo">➕ Criar novo grupo</div>
                    <div style="font-size:0.8rem;color:var(--pa-sub);margin-top:3px">Você ainda não faz parte de nenhum grupo nesta disciplina.</div>
                </div>
                <button class="mg-btn-criar" onclick="mgToggleCriarForm()">Criar Grupo</button>
            </div>
            <div id="mgCriarForm" class="mg-criar-form">
                <div id="mgCriarMsg"></div>
                <label class="mg-form-label">Nome do grupo *</label>
                <input id="mgNomeGrupo" class="mg-form-input" type="text" placeholder="Ex: Grupo Alpha" maxlength="80">
                <label class="mg-form-label">Escolher integrantes da turma</label>
                <div id="mgColegasArea" class="mg-colegas-loading">Carregando colegas…</div>
                <div class="mg-form-actions">
                    <button class="mg-btn-criar" onclick="mgCriar()">✓ Criar e entrar</button>
                    <button class="mg-btn-cancelar" onclick="mgToggleCriarForm()">Cancelar</button>
                    <span id="mgCriarStatus" class="mg-msg-criar"></span>
                </div>
            </div>
        </div>`;
}

/* Toggle do formulário de criação + carrega colegas na abertura */
async function mgToggleCriarForm() {
    const form = $('mgCriarForm');
    if (!form) return;
    const abrir = form.style.display !== 'block';
    form.style.display = abrir ? 'block' : 'none';
    if (!abrir) return;
    /* Carrega colegas */
    const area = $('mgColegasArea');
    if (!area) return;
    area.innerHTML = '<div class="mg-colegas-loading">Carregando colegas…</div>';
    try {
        const r = await fetch(`/api/alunos-portal/grupos-portal/colegas?courseId=${encodeURIComponent(_mgCursoId)}`, { credentials: 'include' });
        const colegas = r.ok ? await r.json() : [];
        if (!colegas.length) {
            area.innerHTML = '<div class="mg-colegas-vazio">Nenhum colega encontrado na turma. O professor precisa estar conectado ao Classroom.</div>';
            return;
        }
        /* Exibe apenas quem ainda não está em nenhum grupo */
        const disponiveis = colegas.filter(c => !c.membro);
        if (!disponiveis.length) {
            area.innerHTML = '<div class="mg-colegas-vazio">Todos os colegas desta turma já estão em grupos.</div>';
            return;
        }
        area.innerHTML = `<div class="mg-colegas-grid">
            ${disponiveis.map(c => `<label class="mg-colega-item" title="${_mgEsc(c.email)}">
                    <input type="checkbox" class="mg-colega-check" value="${_mgEsc(c.email)}"
                           data-nome="${_mgEsc(c.nome)}">
                    ${_mgEsc(c.nome || c.email)}
                </label>`).join('')}
        </div>`;
    } catch (_) {
        area.innerHTML = '<div class="mg-colegas-vazio">Erro ao carregar colegas. Tente novamente.</div>';
    }
}
window.mgToggleCriarForm = mgToggleCriarForm;

/* Cria um novo grupo com os integrantes selecionados */
async function mgCriar() {
    const nomeEl  = $('mgNomeGrupo');
    const status  = $('mgCriarStatus');
    const nome    = nomeEl?.value?.trim();
    if (!nome) { if (status) { status.textContent = 'Informe o nome do grupo.'; status.style.color = 'var(--pa-danger)'; } return; }
    const checks = document.querySelectorAll('.mg-colega-check:checked');
    const membroEmails = Array.from(checks).map(c => c.value);
    if (status) { status.textContent = 'Criando…'; status.style.color = 'var(--pa-sub)'; }
    try {
        const r = await fetch('/api/alunos-portal/grupos-portal', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: _mgCursoId, courseName: _mgCursoNome, nomeGrupo: nome, membroEmails }),
        });
        const d = await r.json();
        if (!r.ok) { if (status) { status.textContent = d.erro || 'Erro ao criar.'; status.style.color = 'var(--pa-danger)'; } return; }
        await _mgCarregarDados();
    } catch (_) {
        if (status) { status.textContent = 'Erro de rede. Tente novamente.'; status.style.color = 'var(--pa-danger)'; }
    }
}
window.mgCriar = mgCriar;

/* Entra em um grupo existente */
async function mgEntrar(grupoId) {
    const btn = event?.target;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
        const r = await fetch(`/api/alunos-portal/grupos-portal/${grupoId}/entrar`, {
            method: 'POST', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) { alert(d.erro || 'Erro ao entrar no grupo.'); if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; } return; }
        await _mgCarregarDados();
    } catch (_) { alert('Erro de rede. Tente novamente.'); if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; } }
}
window.mgEntrar = mgEntrar;

/* Sai do grupo atual */
async function mgSair() {
    if (!_mgGrupo) return;
    if (!confirm(`Sair do grupo "${_mgGrupo.nome}"?\nIsso não pode ser desfeito se o grupo for excluído.`)) return;
    try {
        const r = await fetch(`/api/alunos-portal/grupos-portal/${_mgGrupo.id}/sair`, {
            method: 'DELETE', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) { alert(d.erro || 'Erro ao sair do grupo.'); return; }
        _mgGrupo = null;
        await _mgCarregarDados();
    } catch (_) { alert('Erro de rede. Tente novamente.'); }
}
window.mgSair = mgSair;

/* Salva os links do aluno para o grupo */
async function mgSalvarLinks(grupoId) {
    const msg  = $('mgLinksMsg');
    const extras = _mgColetarExtras();
    const body = {
        linkBackend:  $('mgLinkBackend')?.value?.trim() || null,
        linkBanco:    $('mgLinkBanco')?.value?.trim()   || null,
        linkFrontend: $('mgLinkFrontend')?.value?.trim() || null,
        linksExtras:  extras,
    };
    if (msg) { msg.innerHTML = '<div class="mg-msg mg-msg--info">Salvando…</div>'; }
    try {
        const r = await fetch(`/api/alunos-portal/grupos-portal/${grupoId}/links`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) { if (msg) msg.innerHTML = `<div class="mg-msg mg-msg--erro">${_mgEsc(d.erro || 'Erro ao salvar.')}</div>`; return; }
        if (msg) { msg.innerHTML = '<div class="mg-msg mg-msg--ok">✅ Links salvos com sucesso!</div>'; }
        setTimeout(() => { if (msg) msg.innerHTML = ''; }, 4000);
        /* Recarrega para atualizar os links de todos */
        await _mgCarregarDados();
    } catch (_) {
        if (msg) msg.innerHTML = '<div class="mg-msg mg-msg--erro">Erro de rede. Tente novamente.</div>';
    }
}
window.mgSalvarLinks = mgSalvarLinks;

/* Adiciona uma linha de link extra no formulário */
let _mgNextExtraIdx = 100;
function mgAdicionarLinkExtra() {
    const div = $('mgLinksExtrasDiv');
    if (!div) return;
    const idx = _mgNextExtraIdx++;
    const row = document.createElement('div');
    row.innerHTML = _mgHtmlExtraRow('', '', idx);
    div.appendChild(row.firstElementChild);
}
window.mgAdicionarLinkExtra = mgAdicionarLinkExtra;

/* Remove uma linha de link extra */
function mgRemoverLinkExtra(idx) {
    const row = $(`mgExtraRow_${idx}`);
    if (row) row.remove();
}
window.mgRemoverLinkExtra = mgRemoverLinkExtra;

/* Coleta todos os links extras do formulário */
function _mgColetarExtras() {
    const rows = document.querySelectorAll('[id^="mgExtraRow_"]');
    const extras = [];
    rows.forEach(row => {
        const id  = row.id.replace('mgExtraRow_', '');
        const nomeEl = $(`mgExtraNome_${id}`);
        const urlEl  = $(`mgExtraUrl_${id}`);
        const url = urlEl?.value?.trim();
        if (url) extras.push({ nome: nomeEl?.value?.trim() || 'Extra', url });
    });
    return extras;
}

/* Retorna o email da sessão atual (cacheado no DOM) */
function _mgSessaoEmail() {
    return $('paDropEmail')?.textContent?.trim() || '';
}

window.mgPopularCursoSelect = mgPopularCursoSelect;
window.mgSelecionarCurso    = mgSelecionarCurso;
