'use strict';
/* Provas — UI do professor */

const $ = id => document.getElementById(id);

const BADGE_POLL_MS_DEFAULT = 3 * 60 * 1000; /* 3 minutes fallback */
let _badgePollMs = BADGE_POLL_MS_DEFAULT;

let cursos = [];
let cursoAtual = '';
let provas = [];
let provaAberta = null;
let _modoLista = true; /* false = Cards, true = Lista (padrão) */
let _todasProvas = [];  /* cache do modo lista para filtragem client-side */
let _filtroTexto = '';
let _filtroStatus = ''; /* '' = todos, 'rascunho', 'efetivada' */
let _sortColuna = 'data'; /* 'nome' | 'curso' | 'data' | 'variantes' | 'corrigidas' */
let _sortDir = 'desc';    /* 'asc' | 'desc' */
let _colaCarregada = false;
let _colaExpandido = null;
let _colaFlags = {};
let _colaParesMap = {};
let _renderColaTabela = null;
let _divergenciasCarregadas = false;
let _conversaPar = null;
let _conversaFoco = 'A';

/* ── Custom Dropdown Helper ─────────────────────────────────────── */

const _cselMap = new WeakMap();

function prvCreateCustomSelect(selectEl, { compact = false } = {}) {
    if (_cselMap.has(selectEl)) return;

    /* Hide native select — it stays in the DOM so JS can read/write .value */
    selectEl.style.cssText += ';position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden;';

    const wrap = document.createElement('div');
    wrap.className = 'prv-csel' + (compact ? ' prv-csel--compact' : '');

    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'prv-csel-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valSpan = document.createElement('span');
    valSpan.className = 'prv-csel-value';
    const arrow = document.createElement('span');
    arrow.className = 'prv-csel-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▾';
    trigger.appendChild(valSpan);
    trigger.appendChild(arrow);
    wrap.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'prv-csel-panel';
    panel.setAttribute('role', 'listbox');
    panel.hidden = true;
    wrap.appendChild(panel);

    function syncDisplay() {
        const opt = selectEl.options[selectEl.selectedIndex];
        valSpan.textContent = opt ? opt.textContent : '';
    }

    function buildPanel() {
        panel.innerHTML = '';
        Array.from(selectEl.options).forEach((o, i) => {
            const item = document.createElement('div');
            const selected = selectEl.selectedIndex === i;
            item.className = 'prv-csel-option'
                + (o.disabled ? ' prv-csel-option--disabled' : '')
                + (selected   ? ' prv-csel-option--selected'  : '');
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
            item.dataset.idx = i;
            item.textContent = o.textContent;
            if (!o.disabled) {
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
                    selectEl.selectedIndex = i;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    close();
                });
            }
            panel.appendChild(item);
        });
    }

    function focusItem(item) {
        panel.querySelectorAll('.prv-csel-option--focused').forEach(el => el.classList.remove('prv-csel-option--focused'));
        if (item) { item.classList.add('prv-csel-option--focused'); item.scrollIntoView({ block: 'nearest' }); }
    }

    function open() {
        buildPanel();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        wrap.classList.add('prv-csel--open');
        const sel = panel.querySelector('.prv-csel-option--selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function close() {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        wrap.classList.remove('prv-csel--open');
        syncDisplay();
    }

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        wrap.classList.contains('prv-csel--open') ? close() : open();
    });

    trigger.addEventListener('keydown', e => {
        const active = () => [...panel.querySelectorAll('.prv-csel-option:not(.prv-csel-option--disabled)')];
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (wrap.classList.contains('prv-csel--open')) {
                const f = panel.querySelector('.prv-csel-option--focused');
                if (f) f.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                else close();
            } else { open(); }
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!wrap.classList.contains('prv-csel--open')) { open(); return; }
            const items = active();
            const cur = panel.querySelector('.prv-csel-option--focused') || panel.querySelector('.prv-csel-option--selected');
            const idx = items.indexOf(cur);
            const next = e.key === 'ArrowDown'
                ? items[Math.min(idx + 1, items.length - 1)]
                : items[Math.max(idx - 1, 0)];
            if (next) focusItem(next);
        } else if (e.key === 'Escape') {
            e.preventDefault(); close(); trigger.focus();
        }
    });

    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); }, true);

    /* Watch for dynamic option additions and text updates (_aplicarResumo, carregarCursos) */
    const obs = new MutationObserver(() => {
        syncDisplay();
        if (!panel.hidden) buildPanel();
    });
    obs.observe(selectEl, { childList: true, subtree: true, characterData: true });

    /* Sync if native value is changed programmatically (e.g. selectEl.value = 'x') */
    selectEl.addEventListener('change', syncDisplay);

    syncDisplay();
    _cselMap.set(selectEl, { wrap, trigger, panel, obs, syncDisplay });
}

function prvRefreshCustomSelect(selectEl) {
    const entry = _cselMap.get(selectEl);
    if (entry) entry.syncDisplay();
}

/* ── /Custom Dropdown Helper ────────────────────────────────────── */

/* ════════════════════════════════════════════════════════════════════
 *  GRADEPEN — CONEXÃO
 * ═══════════════════════════════════════════════════════════════════ */
let _gpStatusTimer = null;

async function gpCheckStatus() {
    try {
        const r = await fetch('/api/provas/gradepen/status', { credentials: 'same-origin' });
        if (!r.ok) return;
        gpUpdateBanner(await r.json());
    } catch { /* silencioso */ }
}

function gpUpdateBanner(d) {
    const banner   = $('gpConnectBanner');
    const title    = $('gpConnectTitle');
    const desc     = $('gpConnectDesc');
    const btnCon   = $('gpBtnConectar');
    const btnDes   = $('gpBtnDesconectar');
    const spinner  = $('gpConnectSpinner');
    if (!banner) return;
    banner.style.display = '';

    if (d.conectando) {
        banner.dataset.estado = 'conectando';
        title.textContent    = 'GradePen';
        desc.textContent     = 'Conectando… aguarde o login via Google.';
        btnCon.style.display = 'none';
        btnDes.style.display = 'none';
        spinner.style.display = '';
    } else if (d.conectado) {
        banner.dataset.estado = 'conectado';
        const exp = d.expira
            ? new Date(d.expira).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '';
        title.textContent    = 'GradePen: Conectado';
        desc.textContent     = exp ? `Sessão válida até ${exp}` : 'Sessão ativa';
        btnCon.style.display = 'none';
        btnDes.style.display = '';
        spinner.style.display = 'none';
    } else {
        banner.dataset.estado = 'desconectado';
        title.textContent    = 'GradePen: Desconectado';
        desc.textContent     = 'Conecte com sua conta Google para importar gabaritos automaticamente.';
        btnCon.style.display = '';
        btnCon.disabled      = false;
        btnDes.style.display = 'none';
        spinner.style.display = 'none';
    }
}

async function gpConectar() {
    const btnCon  = $('gpBtnConectar');
    const spinner = $('gpConnectSpinner');
    btnCon.disabled      = true;
    btnCon.style.display = 'none';
    spinner.style.display = '';
    gpUpdateBanner({ conectando: true });

    /* Polling de status enquanto o Puppeteer faz o login em background */
    _gpStatusTimer = setInterval(gpCheckStatus, 3000);

    try {
        const r = await fetch('/api/provas/gradepen/connect', {
            method: 'POST',
            credentials: 'same-origin',
        });
        clearInterval(_gpStatusTimer);
        const d = await r.json();
        if (d.ok) {
            gpUpdateBanner({ conectado: true, expira: d.expira });
            await notificar('GradePen conectado!',
                'Gabaritos serão importados automaticamente ao criar uma prova.', { tipo: 'ok' });
        } else {
            gpUpdateBanner({ conectado: false });
            await notificar('Erro ao conectar ao GradePen',
                d.erro || 'Verifique se GOOGLE_EMAIL e GOOGLE_PASSWORD estão configurados e se a conta não tem 2FA.',
                { tipo: 'danger' });
        }
    } catch (e) {
        clearInterval(_gpStatusTimer);
        gpUpdateBanner({ conectado: false });
        await notificar('Erro ao conectar ao GradePen', e.message, { tipo: 'danger' });
    }
}

async function gpDesconectar() {
    const ok = await confirmar(
        'A próxima operação de gabarito vai reconectar automaticamente.',
        { titulo: 'Desconectar GradePen?', confirmLabel: 'Desconectar', cancelLabel: 'Cancelar', tipo: 'danger', icone: '🔌' }
    );
    if (!ok) return;
    await fetch('/api/provas/gradepen/connect', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    gpUpdateBanner({ conectado: false });
}

async function init() {
    /* Initialise custom selects early so observers are in place before data loads */
    prvCreateCustomSelect($('prvTurma'));
    prvCreateCustomSelect($('prvCurso'));
    prvCreateCustomSelect($('prvfFoto'));
    prvCreateCustomSelect($('prvfTipo'));
    prvCreateCustomSelect($('prvfTrimestre'));
    prvCreateCustomSelect($('prvfTurmaCorretoraCurso'));

    /* Verifica status do GradePen e exibe o banner */
    gpCheckStatus();
    /* Atualiza o banner a cada 60s (reflete reconexão automática) */
    setInterval(gpCheckStatus, 60_000);

    try {
        const cfgRes = await fetch('/api/classroom/provas/ui-config', { credentials: 'include' });
        if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            const mins = parseInt(cfg.badgePollMinutos, 10);
            if (Number.isFinite(mins) && mins >= 1 && mins <= 60) {
                _badgePollMs = mins * 60 * 1000;
            }
        }
    } catch (_) { /* keep default */ }
    await carregarCursos();
    if (cursos.length) startBadgePoll(cursos.map(c => c.id), _aplicarResumo, _badgePollMs);
    _prvIniciarNotifPoll();
    /* mostra/esconde % foto conforme modo */
    $('prvfFoto').addEventListener('change', () => {
        $('prvfFotoPctWrap').style.display = $('prvfFoto').value === 'sorteio' ? '' : 'none';
    });

    /* Abre no modo Lista por padrão: exibe todas as provas imediatamente */
    prvSetModo('lista');
}

function prvToggleSegundo(ativo) {
    $('prvfOutraTurmaWrap').style.display  = ativo ? '' : 'none';
    $('prvfSegundoPctWrap').style.display  = ativo ? '' : 'none';
    if (!ativo) $('prvfOutraTurma').checked = false;
}

function prvToggleTurmaCorretora(ativo) {
    $('prvfTurmaCorretoraCfg').style.display = ativo ? '' : 'none';
    if (!ativo) {
        $('prvfTurmaCorretoraCurso').value = '';
        $('prvfTurmaCorretora2a').checked = false;
    } else {
        /* Popula o select com todos os cursos disponíveis, exceto o atual */
        const sel = $('prvfTurmaCorretoraCurso');
        const valorAtual = sel.value;
        sel.innerHTML = '<option value="">Selecione a turma que irá corrigir…</option>' +
            cursos.filter(c => c.id !== cursoAtual)
                  .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nome)}</option>`)
                  .join('');
        if (valorAtual) sel.value = valorAtual;
    }
}

function _aplicarResumo(resumo) {
    const sel = $('prvCurso');
    if (sel) {
        for (const opt of sel.options) {
            if (!opt.value) continue;
            const n = resumo[opt.value] || 0;
            const curso = cursos.find(c => c.id === opt.value);
            if (!curso) continue;
            opt.textContent = _nomeDisciplina(curso.nome) + (n > 0 ? ` ⚠️ ${n} pendente${n > 1 ? 's' : ''}` : '');
        }
    }
    const box = $('prvResumoPendentes');
    if (!box) return;
    const total = Object.values(resumo).reduce((s, n) => s + n, 0);
    const cursosAfetados = Object.values(resumo).filter(n => n > 0).length;
    if (total === 0) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }
    box.innerHTML =
        `<span class="prv-resumo-icone">🔍</span>` +
        `<span class="prv-resumo-texto">${total} par${total !== 1 ? 'es' : ''} pendente${total !== 1 ? 's' : ''} ` +
        `em ${cursosAfetados} curso${cursosAfetados !== 1 ? 's' : ''}</span>` +
        `<span class="prv-resumo-dica">Clique para ir ao seletor de curso</span>`;
    box.style.display = '';
}

function _nomeTurma(nomeCompleto) {
    const sep = nomeCompleto.indexOf(' - ');
    return sep >= 0 ? nomeCompleto.slice(sep + 3) : '';
}

function _nomeDisciplina(nomeCompleto) {
    const sep = nomeCompleto.indexOf(' - ');
    return sep >= 0 ? nomeCompleto.slice(0, sep) : nomeCompleto;
}

async function carregarCursos() {
    const escolaNav = localStorage.getItem('edusync_escola') || '';
    try {
        const rCursos = await fetch('/api/classroom/courses', { credentials: 'include' });
        if (!rCursos.ok) {
            $('prvTurma').innerHTML = '<option>Erro — conecte o Classroom primeiro</option>';
            return;
        }
        const todos = await rCursos.json();
        /* Filtra pelo colégio já selecionado na barra de navegação */
        cursos = escolaNav
            ? todos.filter(c => (c.secao || '').includes(escolaNav) || escolaNav.includes(c.secao || ''))
            : todos;
        /* Extrai turmas únicas do nome do curso (formato "Disciplina - Turma") */
        const turmasSet = new Set(cursos.map(c => _nomeTurma(c.nome)).filter(Boolean));
        const turmas = [...turmasSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const selTurma = $('prvTurma');
        selTurma.innerHTML = '<option value="">Selecione uma turma…</option>' +
            turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        $('prvCurso').innerHTML = '<option value="">Selecione uma turma primeiro…</option>';
        if (cursos.length > 0) {
            const ids = encodeURIComponent(cursos.map(c => c.id).join(','));
            const rResumo = await fetch(`/api/classroom/provas/resumo-investigar?courseIds=${ids}`, { credentials: 'include' });
            if (rResumo.ok) {
                _aplicarResumo((await rResumo.json()).resumo || {});
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function onTurmaChange() {
    const turma = $('prvTurma').value;
    cursoAtual = '';
    $('prvBtnNova').disabled = true;
    $('prvLista').innerHTML = '<div class="prv-empty">Selecione uma disciplina acima para ver as provas.</div>';
    const panel = $('prvFlagsPendentes');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    if (!turma) {
        $('prvCurso').innerHTML = '<option value="">Selecione uma turma primeiro…</option>';
        return;
    }
    const filtrados = cursos.filter(c => _nomeTurma(c.nome) === turma);
    $('prvCurso').innerHTML = '<option value="">Selecione uma disciplina…</option>' +
        filtrados.map(c => `<option value="${c.id}">${escapeHtml(_nomeDisciplina(c.nome))}</option>`).join('');
}

async function onCursoChange() {
    cursoAtual = $('prvCurso').value;
    $('prvBtnNova').disabled = !cursoAtual;
    if (!cursoAtual) {
        $('prvLista').innerHTML = '<div class="prv-empty">Selecione uma disciplina acima para ver as provas.</div>';
        const panel = $('prvFlagsPendentes');
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        return;
    }
    await Promise.all([carregarProvas(), carregarFlagsPendentes()]);
}

function renderBadgesProva(p) {
    return `${p.efetivada
                ? '<span class="prv-badge prv-badge-efetiva">Efetivada</span>'
                : '<span class="prv-badge prv-badge-rascunho">Rascunho</span>'}
            ${p.segundo_corretor_ativo ? '<span class="prv-badge prv-badge-2cor">2º corretor</span>' : ''}
            ${p.turma_corretora_id ? '<span class="prv-badge prv-badge-tcor" title="Uma turma inteira é Corretor 1 desta prova">🏫 turma corretora</span>' : ''}
            ${p.pares_suspeitos > 0 ? `<span class="prv-badge prv-badge-cola" title="Pares com ≥${p.pares_suspeitos_threshold ?? 70}% de similaridade — abra a aba Analise de gabarito para detalhes">⚠️ ${p.pares_suspeitos} par${p.pares_suspeitos > 1 ? 'es' : ''} suspeito${p.pares_suspeitos > 1 ? 's' : ''}</span>` : ''}
            ${p.pares_flagged_investigar > 0 ? `<span class="prv-badge prv-badge-flagged" title="Pares suspeitos ainda em investigação">🔍 ${p.pares_flagged_investigar} pendente${p.pares_flagged_investigar > 1 ? 's' : ''}</span>` : ''}
            ${p.pares_flagged_resolvido > 0 ? `<span class="prv-badge prv-badge-resolvido" title="Pares suspeitos já resolvidos pelo professor">✅ ${p.pares_flagged_resolvido} resolvido${p.pares_flagged_resolvido > 1 ? 's' : ''}</span>` : ''}`;
}

function _atualizarBadgesCard(provaId) {
    const prova = provas.find(p => p.id === provaId);
    if (!prova) return;
    const nInvestigar = Object.values(_colaFlags).filter(f => f.status === 'investigar').length;
    const nResolvido  = Object.values(_colaFlags).filter(f => f.status === 'resolvido').length;
    prova.pares_flagged_investigar = nInvestigar;
    prova.pares_flagged_resolvido  = nResolvido;
    const card = document.querySelector(`.prv-card[data-prova-id="${provaId}"]`);
    if (!card) return;
    const nomeEl = card.querySelector('.prv-card-nome');
    if (!nomeEl) return;
    nomeEl.innerHTML = escapeHtml(prova.nome) + ' ' + renderBadgesProva(prova);
}

async function carregarProvas() {
    $('prvLista').innerHTML = '<div class="prv-empty">Carregando…</div>';
    try {
        const r = await fetch(`/api/classroom/provas?courseId=${encodeURIComponent(cursoAtual)}&includeSuspiciousSummary=1`, { credentials: 'include' });
        const d = await r.json();
        provas = d.provas || [];
        if (provas.length === 0) {
            $('prvLista').innerHTML = '<div class="prv-empty">Nenhuma prova cadastrada neste curso. Clique em "+ Nova prova" para começar.</div>';
            return;
        }
        $('prvLista').innerHTML = provas.map(p => `
            <div class="prv-card" data-prova-id="${p.id}" onclick="abrirDetalhe(${p.id})">
                <div class="prv-card-info">
                    <div class="prv-card-nome">${escapeHtml(p.nome)}
                        ${renderBadgesProva(p)}
                    </div>
                    <div class="prv-card-meta">
                        <span>GradePen #${escapeHtml(p.gradepen_id)}</span>
                        <span>${p.data_aplicacao ? new Date(p.data_aplicacao).toLocaleDateString('pt-BR') : 'Sem data'}</span>
                        <span>${p.variantes_count} variante(s)</span>
                    </div>
                </div>
                <div class="prv-card-stats">
                    <div class="prv-stat">
                        <div class="prv-stat-num">${p.submissoes_count}</div>
                        <div class="prv-stat-lbl">corrigidas</div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        $('prvLista').innerHTML = `<div class="prv-empty">Erro: ${escapeHtml(e.message)}</div>`;
    }
}

/* ── Modo Lista (todas as provas) ───────────────────────────────── */

function prvSetModo(modo) {
    _modoLista = (modo === 'lista');

    /* Atualiza botões do toggle */
    const btnCards = $('prvBtnModoCards');
    const btnLista = $('prvBtnModoLista');
    if (btnCards) btnCards.classList.toggle('prv-modo-ativo', !_modoLista);
    if (btnLista) btnLista.classList.toggle('prv-modo-ativo', _modoLista);

    /* Selects de turma e disciplina ficam sempre visíveis */
    const selTurma = $('prvTurma');
    const selCurso = $('prvCurso');
    if (selTurma?.parentElement) selTurma.parentElement.style.display = '';
    if (selCurso?.parentElement) selCurso.parentElement.style.display = '';

    /* Oculta painel de flags pendentes no modo lista */
    const panel = $('prvFlagsPendentes');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }

    const filtroBar = $('prvFiltroLista');
    if (filtroBar) filtroBar.style.display = _modoLista ? '' : 'none';

    if (_modoLista) {
        /* Reinicia filtros ao entrar no modo lista */
        _filtroTexto = '';
        _filtroStatus = '';
        const inp = $('prvFiltroTexto');
        if (inp) inp.value = '';
        document.querySelectorAll('.prv-filtro-btn').forEach(b => {
            b.classList.toggle('prv-filtro-btn-ativo', b.dataset.status === '');
        });
        carregarTodasProvas();
    } else {
        /* Volta ao modo cards: reusa estado atual dos selects */
        if (cursoAtual) {
            carregarProvas();
        } else {
            $('prvLista').innerHTML = '<div class="prv-empty">Selecione um curso acima para ver as provas.</div>';
        }
    }
}

async function carregarTodasProvas() {
    $('prvLista').innerHTML = '<div class="prv-empty">Carregando…</div>';
    try {
        const r = await fetch('/api/classroom/provas/todas', { credentials: 'include' });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            $('prvLista').innerHTML = `<div class="prv-empty">Erro: ${escapeHtml(d.erro || r.statusText)}</div>`;
            return;
        }
        const d = await r.json();
        _todasProvas = d.provas || [];
        _renderListaFiltrada();
    } catch (e) {
        $('prvLista').innerHTML = `<div class="prv-empty">Erro: ${escapeHtml(e.message)}</div>`;
    }
}

function _sortProvas(lista) {
    const dir = _sortDir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
        let va, vb;
        switch (_sortColuna) {
            case 'nome':
                va = (a.nome || '').toLowerCase();
                vb = (b.nome || '').toLowerCase();
                return dir * va.localeCompare(vb, 'pt-BR');
            case 'curso':
                va = (a.curso_nome || a.curso_id || '').toLowerCase();
                vb = (b.curso_nome || b.curso_id || '').toLowerCase();
                return dir * va.localeCompare(vb, 'pt-BR');
            case 'data':
                va = a.data_aplicacao ? new Date(a.data_aplicacao).getTime() : 0;
                vb = b.data_aplicacao ? new Date(b.data_aplicacao).getTime() : 0;
                return dir * (va - vb);
            case 'variantes':
                return dir * ((a.variantes_count || 0) - (b.variantes_count || 0));
            case 'corrigidas':
                return dir * ((a.submissoes_count || 0) - (b.submissoes_count || 0));
            default:
                return 0;
        }
    });
}

function prvSortLista(coluna) {
    if (_sortColuna === coluna) {
        _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        _sortColuna = coluna;
        _sortDir = coluna === 'data' ? 'desc' : 'asc';
    }
    _renderListaFiltrada();
}

function _renderListaFiltrada() {
    const termo = _filtroTexto.trim().toLowerCase();

    const filtradas = _todasProvas.filter(p => {
        if (_filtroStatus === 'efetivada' && !p.efetivada) return false;
        if (_filtroStatus === 'rascunho' && p.efetivada) return false;
        if (termo) {
            const nome   = (p.nome || '').toLowerCase();
            const curso  = (p.curso_nome || p.curso_id || '').toLowerCase();
            if (!nome.includes(termo) && !curso.includes(termo)) return false;
        }
        return true;
    });

    const contagem = $('prvFiltroContagem');
    if (contagem) {
        const total = _todasProvas.length;
        contagem.textContent = filtradas.length === total
            ? `${total} prova${total !== 1 ? 's' : ''}`
            : `${filtradas.length} de ${total}`;
    }

    if (_todasProvas.length === 0) {
        $('prvLista').innerHTML = '<div class="prv-empty">Nenhuma prova cadastrada ainda.</div>';
        return;
    }

    if (filtradas.length === 0) {
        $('prvLista').innerHTML = '<div class="prv-empty">Nenhuma prova encontrada com esses filtros.</div>';
        return;
    }

    const ordenadas = _sortProvas(filtradas);

    function thClass(col, extra = '') {
        const ativo = _sortColuna === col ? ' prv-lista-th--ativo' : '';
        return `prv-lista-th${extra}${ativo}`;
    }

    function thArrow(col) {
        if (_sortColuna !== col) return '<span class="prv-sort-icon prv-sort-icon--idle">⇅</span>';
        return `<span class="prv-sort-icon">${_sortDir === 'asc' ? '↑' : '↓'}</span>`;
    }

    const linhas = ordenadas.map(p => {
        const data = p.data_aplicacao ? new Date(p.data_aplicacao).toLocaleDateString('pt-BR') : '—';
        return `<tr class="prv-lista-row" onclick="abrirDetalhe(${p.id})" title="Abrir detalhes">
            <td class="prv-lista-td prv-lista-td-nome">
                <span class="prv-lista-nome">${escapeHtml(p.nome)}</span>
                <div class="prv-lista-badges">${renderBadgesProva(p)}</div>
            </td>
            <td class="prv-lista-td prv-lista-td-curso">${escapeHtml(p.curso_nome || p.curso_id)}</td>
            <td class="prv-lista-td prv-lista-td-data">${escapeHtml(data)}</td>
            <td class="prv-lista-td prv-lista-td-num">${p.variantes_count}</td>
            <td class="prv-lista-td prv-lista-td-num">${p.submissoes_count}</td>
        </tr>`;
    }).join('');

    $('prvLista').innerHTML = `
        <table class="prv-lista-tabela">
            <thead>
                <tr>
                    <th class="${thClass('nome')}" onclick="prvSortLista('nome')">Prova ${thArrow('nome')}</th>
                    <th class="${thClass('curso')}" onclick="prvSortLista('curso')">Curso ${thArrow('curso')}</th>
                    <th class="${thClass('data')}" onclick="prvSortLista('data')">Data ${thArrow('data')}</th>
                    <th class="${thClass('variantes', ' prv-lista-th-num')}" onclick="prvSortLista('variantes')">Variantes ${thArrow('variantes')}</th>
                    <th class="${thClass('corrigidas', ' prv-lista-th-num')}" onclick="prvSortLista('corrigidas')">Corrigidas ${thArrow('corrigidas')}</th>
                </tr>
            </thead>
            <tbody>${linhas}</tbody>
        </table>`;
}

function prvFiltrarLista() {
    _filtroTexto = $('prvFiltroTexto')?.value || '';
    _renderListaFiltrada();
}

function prvFiltrarStatus(btn) {
    _filtroStatus = btn.dataset.status;
    document.querySelectorAll('.prv-filtro-btn').forEach(b => {
        b.classList.toggle('prv-filtro-btn-ativo', b === btn);
    });
    _renderListaFiltrada();
}

window.prvSetModo = prvSetModo;
window.prvFiltrarLista = prvFiltrarLista;
window.prvFiltrarStatus = prvFiltrarStatus;
window.prvSortLista = prvSortLista;

function _prvNomeBase() {
    const turma = $('prvTurma').value;
    const curso = cursos.find(c => c.id === cursoAtual);
    const disciplina = curso ? _nomeDisciplina(curso.nome) : '';
    return turma && disciplina ? `${turma} | ${disciplina}` : '';
}

function prvAtualizarNome() {
    const base = _prvNomeBase();
    if (!base) return;
    const tipo = $('prvfTipo').value;
    const trimestre = $('prvfTrimestre').value;
    $('prvfNome').value = [base, tipo, trimestre].filter(Boolean).join(' - ');
}

function abrirNova() {
    $('prvfTipo').value = '';
    $('prvfTrimestre').value = '';
    prvRefreshCustomSelect($('prvfTipo'));
    prvRefreshCustomSelect($('prvfTrimestre'));
    prvAtualizarNome();
    $('prvfAnsid').value = '';
    $('prvfLinkProva').value = '';
    $('prvfData').value  = new Date().toISOString().slice(0,10);
    $('prvfFoto').value  = 'sorteio';
    prvRefreshCustomSelect($('prvfFoto'));
    $('prvfFotoPct').value = 20;
    $('prvfFotoPctWrap').style.display = '';
    $('prvfSegundo').checked = false;
    $('prvfSegundoPct').value = 15;
    $('prvfOutraTurma').checked = false;
    $('prvfOutraTurmaWrap').style.display = 'none';
    $('prvfSegundoPctWrap').style.display = 'none';
    $('prvfUsarTurmaCorretora').checked = false;
    $('prvfTurmaCorretoraCfg').style.display = 'none';
    $('prvfTurmaCorretoraCurso').value = '';
    $('prvfTurmaCorretora2a').checked = false;
    $('prvNovaErro').style.display = 'none';
    $('prvModalNova').style.display = '';
}
function fecharNova() { $('prvModalNova').style.display = 'none'; }

async function salvarNova() {
    const segundoPct = parseInt($('prvfSegundoPct').value, 10) || 15;
    if ($('prvfSegundo').checked && (segundoPct < 1 || segundoPct > 100)) {
        return mostraErro('O percentual do 2º corretor deve ser entre 1 e 100.');
    }
    const linkProvaRaw = $('prvfLinkProva').value.trim();
    const usarTurmaCorretora = $('prvfUsarTurmaCorretora').checked;
    const body = {
        courseId:                cursoAtual,
        nome:                    $('prvfNome').value.trim(),
        gradepenId:              $('prvfAnsid').value.trim().split('.')[0],
        dataAplicacao:           $('prvfData').value || null,
        fotoModo:                $('prvfFoto').value,
        fotoSorteioPct:          parseInt($('prvfFotoPct').value, 10) || 20,
        segundoCorretorAtivo:    $('prvfSegundo').checked,
        segundoCorretorPct:      segundoPct,
        permitirOutraTurma:      $('prvfOutraTurma').checked,
        turmaCorretoraId:        usarTurmaCorretora ? ($('prvfTurmaCorretoraCurso').value || null) : null,
        turmaCorretora2aCorrecao: usarTurmaCorretora && $('prvfTurmaCorretora2a').checked,
        linkProva:               linkProvaRaw || null,
    };
    if (usarTurmaCorretora && !body.turmaCorretoraId) {
        return mostraErro('Selecione a turma corretora ou desmarque a opção "Usar turma corretora".');
    }
    if (!body.nome || !body.gradepenId) {
        return mostraErro('Preencha nome e ID GradePen.');
    }
    /* Fechar qualquer painel de custom select aberto para evitar interceptação de clique */
    document.querySelectorAll('.prv-csel--open').forEach(wrap => {
        wrap.classList.remove('prv-csel--open');
        const panel = wrap.querySelector('.prv-csel-panel');
        if (panel) panel.hidden = true;
        const trigger = wrap.querySelector('.prv-csel-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
    const btn = $('prvBtnSalvarNova');
    btn.disabled = true;
    btn.textContent = 'Aguardando…';
    $('prvNovaLoading').style.display = '';
    try {
        const r = await fetch('/api/classroom/provas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) {
            let msg;
            if (d.gabaritoNaoPublicado) {
                msg = 'O gabarito desta prova ainda não foi publicado na GradePen. Publique o gabarito lá e tente novamente.';
            } else if (d.varianteNaoEncontrada) {
                msg = d.gpMensagem || 'Nenhuma variante encontrada. Confira o ID GradePen: no link https://gradepen.com/.../?ansid=XXXX.0, o ID é o número antes do ponto (ex: XXXX).';
            } else if (d.gpMensagem) {
                msg = d.gpMensagem;
            } else if (d.precisaGabaritoManual) {
                msg = `Não consegui ler a GradePen (${d.detalhe || 'erro'}).\n\nVerifique se o ID está correto e se as credenciais GRADEPEN_EMAIL/GRADEPEN_PASSWORD foram configuradas no servidor.`;
            } else {
                msg = d.erro || 'Erro ao cadastrar.';
            }
            return mostraErro(msg);
        }
        fecharNova();
        await carregarProvas();
        await notificar('Prova cadastrada', `${d.variantes_count} variante(s) importada(s) da GradePen. Clique no card da prova para ver as variantes e alternativas corretas.`, {tipo: 'ok'});
    } catch (e) {
        mostraErro(e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Cadastrar e importar gabarito';
        $('prvNovaLoading').style.display = 'none';
    }
}

function mostraErro(msg) {
    const box = $('prvNovaErro');
    box.textContent = msg;
    box.style.display = '';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function abrirDetalhe(id) {
    try {
        const r = await fetch(`/api/classroom/provas/${id}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        provaAberta = d;
        renderDetalhe(d);
        $('prvModalDet').style.display = '';
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

function renderDetalhe(d) {
    const p = d.prova;
    $('prvDetNome').textContent = p.nome;
    $('prvDetMeta').innerHTML = `
        <span>📋 GradePen #${escapeHtml(p.gradepen_id)}</span>
        <span>📅 ${p.data_aplicacao ? new Date(p.data_aplicacao).toLocaleDateString('pt-BR') : 'Sem data'}</span>
        <span>📊 ${d.variantes.length} variantes • ${d.submissoes.filter(s=>!s.eh_segundo_corretor && !s.eh_turma_corretora).length} alunos corrigiram</span>
        <span>📷 Foto: ${p.foto_modo}${p.foto_modo === 'sorteio' ? ` (${p.foto_sorteio_pct}%)` : ''}</span>
        <span>👁 2º corretor: ${p.segundo_corretor_ativo
            ? `ativo · ${p.segundo_corretor_pct === 100 ? '100% automático' : (p.segundo_corretor_pct || 15) + '% automático'}${p.permitir_outra_turma ? ' · cross-turma ON' : ''}${p.segundo_corretor_liberacao ? ` · ${new Date(p.segundo_corretor_liberacao) > new Date() ? '⏳ sorteio em ' + new Date(p.segundo_corretor_liberacao).toLocaleString('pt-BR') : '✅ sorteio liberado'}` : ''}`
            : 'desativado'}</span>
        ${p.turma_corretora_id ? (() => {
            const tcSubs  = d.submissoes.filter(s => s.eh_turma_corretora);
            const total   = d.submissoes.filter(s => !s.eh_segundo_corretor && !s.eh_turma_corretora).length;
            const tcNome  = (cursos.find(c => c.id === p.turma_corretora_id) || {}).nome || p.turma_corretora_id;
            const tcLibStr = p.turma_corretora_liberacao
                ? (new Date(p.turma_corretora_liberacao) > new Date()
                    ? ` · ⏳ portal em ${new Date(p.turma_corretora_liberacao).toLocaleString('pt-BR')}`
                    : ' · ✅ portal liberado')
                : '';
            const tc2aNome = p.turma_corretora_2a_id
                ? ((cursos.find(c => c.id === p.turma_corretora_2a_id) || {}).nome || p.turma_corretora_2a_id)
                : '';
            return `<span>🏫 Turma corretora: <strong>${escapeHtml(tcNome)}</strong> · ${tcSubs.length}/${total} folhas corrigidas${p.turma_corretora_2a_correcao ? ' · aluno confere depois' : ''}${tc2aNome ? ` · 2º sorteio de ${escapeHtml(tc2aNome)}` : ''}${tcLibStr}</span>`;
        })() : ''}
    `;
    $('prvDetCola').innerHTML = '<div class="prv-empty">Clique em <strong>🔍 Analise de gabarito</strong> para carregar.</div>';
    $('prvDetDivergencias').innerHTML = '<div class="prv-empty">Carregando divergências…</div>';
    _colaCarregada = false;
    _colaExpandido = null;
    _colaFlags = {};
    _renderColaTabela = null;
    _divergenciasCarregadas = false;

    /* Oculta aba Divergências — só será exibida se houver dados reais */
    const tabDiv = $('prvTabBtn_divergencias');
    if (tabDiv) tabDiv.style.display = 'none';

    /* Busca divergências em background se 2º corretor estiver ativo;
       mostra a aba apenas quando confirmar que há pelo menos 1 resultado */
    if (p.segundo_corretor_ativo) {
        fetch(`/api/classroom/provas/${p.id}/divergencias`, { credentials: 'include' })
            .then(r => r.json())
            .then(d => {
                if (!provaAberta || provaAberta.prova.id !== p.id) return; /* modal fechado/trocado */
                const divs = d.divergencias || [];
                if (divs.length > 0) {
                    if (tabDiv) tabDiv.style.display = '';
                    renderDivergencias(divs);
                    _divergenciasCarregadas = true;
                }
            })
            .catch(() => { /* silencia — aba simplesmente permanece oculta */ });
    }

    prvAtivarAba('gabarito');

    /* ── Configuração de Turma Corretora (editável) + Gabarito ── */
    {
        const currentTcId  = p.turma_corretora_id || '';
        const current2a    = !!p.turma_corretora_2a_correcao;
        const outrosCursos = cursos.filter(c => c.id !== p.curso_id);
        const optsTC = outrosCursos
            .map(c => `<option value="${escapeHtml(c.id)}" ${c.id === currentTcId ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`)
            .join('');
        const tcNome  = currentTcId ? ((cursos.find(c => c.id === currentTcId) || {}).nome || currentTcId) : 'nenhuma';
        const tcSubs  = d.submissoes.filter(s => s.eh_turma_corretora).length;
        const tcTotal = d.submissoes.filter(s => !s.eh_segundo_corretor && !s.eh_turma_corretora).length;
        const tcLib  = p.turma_corretora_liberacao
            ? new Date(p.turma_corretora_liberacao).toISOString().slice(0,16) : '';
        const gabCfg = `<details style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;padding:10px">
            <summary style="cursor:pointer;font-weight:600">🏫 Turma corretora${currentTcId ? ` — ${escapeHtml(tcNome)} (${tcSubs}/${tcTotal} corrigidas)${tcLib && new Date(p.turma_corretora_liberacao) > new Date() ? ' · ⏳ agendado' : ''}` : ' — nenhuma configurada'}</summary>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
                <label>Turma que irá corrigir as folhas
                    <select id="prvTcorCurso" class="form-select" style="margin-top:4px">
                        <option value="">Sem turma corretora</option>
                        ${optsTC}
                    </select>
                </label>
                <label style="display:flex;align-items:center;gap:6px">
                    <input id="prvTcor2a" type="checkbox" ${current2a ? 'checked' : ''}>
                    Aluno original faz 2ª conferência depois da turma corretora
                </label>
                <label style="display:flex;flex-direction:column;gap:4px">
                    <span>Liberar no portal em (opcional — deixe vazio para liberar imediatamente)</span>
                    <input id="prvTcorLiberacao" type="datetime-local" value="${escapeHtml(tcLib)}"
                           style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em;max-width:230px">
                    ${tcLib && new Date(p.turma_corretora_liberacao) > new Date()
                        ? `<small style="color:#d97706;font-weight:600">⏳ Agendado para ${new Date(p.turma_corretora_liberacao).toLocaleString('pt-BR')}</small>`
                        : (tcLib ? `<small style="color:#16a34a;font-weight:600">✅ Já liberado</small>` : '')}
                </label>
                <div style="display:flex;gap:8px">
                    <button class="prv-btn prv-btn-primary" onclick="salvarTurmaCorretora()">Salvar</button>
                    ${currentTcId ? `<button class="prv-btn" onclick="salvarTurmaCorretora(true)">Remover turma corretora</button>` : ''}
                </div>
                <small style="color:#888">Alterações são aplicadas imediatamente. Os alunos da turma corretora encontram as folhas para corrigir diretamente no <strong>Portal do Aluno → aba "✏️ Correções"</strong> — não é necessário publicar atividade no Classroom para eles.</small>
                ${currentTcId ? `<div style="margin-top:10px;border-top:1px solid #e5e7eb;padding-top:10px">
                    <p style="margin:0 0 6px;font-size:0.88em;color:#374151"><strong>📋 Atribuir folha manualmente</strong> — para alunos que entregaram em papel mas não submeteram pelo portal.</p>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
                        <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:160px">
                            <label style="font-size:0.8em;color:#6b7280">Nome do aluno</label>
                            <input id="prvTcorAtNome" class="form-input" placeholder="Ex: João da Silva" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px">
                            <label style="font-size:0.8em;color:#6b7280">E-mail do aluno</label>
                            <input id="prvTcorAtEmail" class="form-input" type="email" placeholder="aluno@escola.pr.gov.br" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em">
                        </div>
                        <div style="display:flex;flex-direction:column;gap:3px;min-width:110px">
                            <label style="font-size:0.8em;color:#6b7280">Variante</label>
                            <select id="prvTcorAtVariante" class="form-select" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em">
                                ${d.variantes.map(v => `<option value="${escapeHtml(v.codigo)}">.${escapeHtml(v.codigo)}</option>`).join('')}
                            </select>
                        </div>
                        <button class="prv-btn prv-btn-primary" onclick="atribuirFolhaTcor()" style="white-space:nowrap">➕ Atribuir folha</button>
                    </div>
                </div>` : ''}
            </div>
        </details>`;

        /* ── 2º Corretor às cegas (editável) ── */
        const scAtivo  = !!p.segundo_corretor_ativo;
        const scPct    = p.segundo_corretor_pct || 15;
        const scOutra  = !!p.permitir_outra_turma;
        const sc2aId   = p.turma_corretora_2a_id || '';
        const scLib    = p.segundo_corretor_liberacao
            ? new Date(p.segundo_corretor_liberacao).toISOString().slice(0,16) : '';
        const scLabel  = scAtivo
            ? `ativo — ${scPct}% automático${scOutra ? ' · cross-turma ON' : ''}${scLib ? ' · agendado' : ''}`
            : 'desativado';
        /* Options for turma selector (excluding own class) */
        const outrosCursos2a = cursos.filter(c => c.id !== p.curso_id);
        const opts2a = outrosCursos2a
            .map(c => `<option value="${escapeHtml(c.id)}" ${c.id === sc2aId ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`)
            .join('');
        const gabSegundoCorretor = `<details style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;padding:10px">
            <summary style="cursor:pointer;font-weight:600">👁 2º Corretor às cegas — ${escapeHtml(scLabel)}</summary>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
                <label style="display:flex;align-items:center;gap:6px">
                    <input id="prvSc2Ativo" type="checkbox" ${scAtivo ? 'checked' : ''}
                           onchange="document.getElementById('prvSc2PctWrap').style.display=this.checked?'flex':'none'">
                    Ativar 2º corretor às cegas
                </label>
                <div id="prvSc2PctWrap" style="display:${scAtivo ? 'flex' : 'none'};flex-direction:column;gap:4px">
                    <label>Percentual de submissões sorteadas para 2ª correção (1–100)
                        <input id="prvSc2Pct" type="number" min="1" max="100" value="${scPct}"
                               class="form-input" style="margin-top:4px;width:90px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px">
                    </label>
                </div>
                <label style="display:flex;align-items:center;gap:6px">
                    <input id="prvSc2OutraTurma" type="checkbox" ${scOutra ? 'checked' : ''}
                           onchange="document.getElementById('prvSc2TurmaWrap').style.display=this.checked?'':'none'">
                    Permitir alunos de outra turma como 2º corretor
                </label>
                <div id="prvSc2TurmaWrap" style="display:${scOutra ? '' : 'none'};flex-direction:column;gap:4px">
                    <label>Turma específica para o sorteio (opcional — deixe em branco para qualquer turma do professor)
                        <select id="prvSc2TurmaSel" class="form-select" style="margin-top:4px">
                            <option value="">Qualquer turma do professor</option>
                            ${opts2a}
                        </select>
                    </label>
                </div>
                <label style="display:flex;flex-direction:column;gap:4px">
                    <span>Liberar sorteio em (opcional — deixe vazio para liberar imediatamente)</span>
                    <input id="prvSc2Liberacao" type="datetime-local" value="${escapeHtml(scLib)}"
                           style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:0.9em;max-width:230px">
                    ${scLib && new Date(p.segundo_corretor_liberacao) > new Date()
                        ? `<small style="color:#d97706;font-weight:600">⏳ Agendado para ${new Date(p.segundo_corretor_liberacao).toLocaleString('pt-BR')}</small>`
                        : (scLib ? `<small style="color:#16a34a;font-weight:600">✅ Já liberado</small>` : '')}
                </label>
                <div id="prvSc2Erro" style="color:#dc2626;font-size:0.85em;display:none"></div>
                <div>
                    <button class="prv-btn prv-btn-primary" onclick="salvarSegundoCorretor()">Salvar</button>
                </div>
                <small style="color:#888">O percentual define quantas submissões serão sorteadas aleatoriamente para receber uma 2ª correção anônima.</small>
            </div>
        </details>`;

        /* Mapeamento manual de páginas por variante */
        const gabMapPaginas = `<details style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;padding:10px"${p.link_prova_paginas ? ' open' : ''}>
            <summary style="cursor:pointer;font-weight:600">📄 Mapeamento de páginas por variante${p.link_prova_paginas ? ' — configurado' : ' — automático'}</summary>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
                <p style="margin:0;font-size:0.84em;color:#4b5563;line-height:1.5">
                    Quando o PDF do campo "Link da prova" contém todas as variantes num único arquivo, informe aqui quais páginas pertencem a cada variante.
                    O aluno corretor verá <strong>somente</strong> as páginas da variante que está em mãos.<br>
                    <strong>Uma linha por variante.</strong> Formato: <code>0: 1-2</code> ou <code>A: 3, 4</code> (números de página começando em 1).
                    Deixe vazio para que o sistema tente detectar automaticamente pelo texto do PDF ("TIPO 0", "VARIANTE A" etc.).
                </p>
                <textarea id="prvPaginasMapEditor" rows="5"
                          style="width:100%;font-family:monospace;font-size:13px;border:1px solid #d1d5db;border-radius:6px;padding:6px 10px;resize:vertical;box-sizing:border-box"
                          placeholder="0: 1-2&#10;1: 3-4&#10;2: 5-6">${escapeHtml(paginasMapToText(p.link_prova_paginas))}</textarea>
                <div style="display:flex;gap:8px">
                    <button class="prv-btn prv-btn-primary" onclick="salvarMapeamentoPaginas()">Salvar mapeamento</button>
                    ${p.link_prova_paginas ? `<button class="prv-btn" onclick="salvarMapeamentoPaginas(true)">Limpar (usar auto-detecção)</button>` : ''}
                </div>
                <small style="color:#888">Salvar invalida o cache de PDF imediatamente — o aluno verá as páginas corretas na próxima abertura.</small>
            </div>
        </details>`;

        /* Gabarito por variante */
        let gabStr = `<h3>Gabarito por variante</h3>`;
        for (const v of d.variantes) {
            const linhas = (v.gabarito_json || []).map(q =>
                `<tr><td>${q.questao}</td><td><strong>${(q.correta || '?').toString().toUpperCase()}</strong></td><td>${(q.valor||0).toFixed(2)}</td></tr>`
            ).join('');
            gabStr += `<details><summary>Variante .${escapeHtml(v.codigo)} — ${v.gabarito_json.length} questões</summary>
                <table class="prv-tabela"><thead><tr><th>Q</th><th>Correta</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table>
            </details>`;
        }
        /* Render everything together so prepend never gets wiped */
        $('prvDetGabarito').innerHTML = gabCfg + gabSegundoCorretor + gabMapPaginas + gabStr;
        if ($('prvSc2TurmaSel'))      prvCreateCustomSelect($('prvSc2TurmaSel'));
        if ($('prvTcorCurso'))        prvCreateCustomSelect($('prvTcorCurso'));
        if ($('prvTcorAtVariante'))   prvCreateCustomSelect($('prvTcorAtVariante'));
    }

    /* Submissões (exclui explicitamente correções da turma corretora das linhas "principais") */
    const principais = d.submissoes.filter(s => !s.eh_segundo_corretor && !s.eh_turma_corretora);
    const segundas   = d.submissoes.filter(s =>  s.eh_segundo_corretor && !s.eh_turma_corretora);
    let sub = `<h3>Submissões dos alunos</h3>`;
    if (!p.efetivada) {
        sub += `<div class="prv-info-box">⚠️ <strong>As notas estão como rascunho.</strong> Quando estiver pronto, clique em <strong>"Efetivar notas"</strong> abaixo. Depois lance as notas no Classroom (ou use o botão <strong>📢 Publicar no Classroom</strong> que cria a atividade no grupo dedicado da avaliação).</div>`;
    }
    if (principais.length === 0) {
        sub += '<div class="prv-empty">Nenhum aluno corrigiu ainda.</div>';
    } else {
        const optsVar = d.variantes.map(v => `<option value="${v.id}">.${escapeHtml(v.codigo)}</option>`).join('');
        sub += `<table class="prv-tabela"><thead><tr>
            <th>Aluno</th><th>Variante</th><th>Quando</th><th>Flags</th><th class="prv-nota">Nota</th><th>Ações</th>
        </tr></thead><tbody>`;
        for (const s of principais) {
            const seg = segundas.find(x => x.submissao_ref_id === s.id);
            const flags = [];
            if (s.foto_obrigatoria && !s.foto_url) flags.push('<span class="prv-flag prv-flag-foto">SEM FOTO</span>');
            if (s.foto_url) {
                if (s.foto_conferida === 'ok') flags.push('<span class="prv-flag prv-flag-foto" style="background:#dcfce7;color:#166534">📷 ✅ confere</span>');
                else if (s.foto_conferida === 'divergente') flags.push('<span class="prv-flag prv-flag-foto" style="background:#fee2e2;color:#991b1b">📷 ⚠️ não confere</span>');
                else flags.push(`<button class="prv-link-acao prv-act-foto" data-sub="${s.id}" title="Conferir se a foto bate com as marcações enviadas">📷 conferir</button>`);
            }
            if (seg) {
                const div = Math.abs((seg.nota || 0) - (s.nota || 0));
                if (div > 0.01) flags.push(`<span class="prv-flag prv-flag-2cor">DIVERG ${div.toFixed(1)}</span>`);
                else flags.push('<span class="prv-flag prv-flag-2cor">2º ✓</span>');
            } else if (s.segundo_corretor_pendente_email) {
                flags.push(`<span class="prv-flag prv-flag-2cor-pend" title="Corretor designado: ${escapeHtml(s.segundo_corretor_pendente_email)}">⏳ 2º aguardando</span>`);
            }
            const selVar = `<select id="prvVar_${s.id}" class="prv-sel-variante" title="Trocar variante recalcula a nota">
                ${d.variantes.map(v => `<option value="${v.id}" ${v.id===s.variante_id?'selected':''}>.${escapeHtml(v.codigo)}</option>`).join('')}
            </select>
            <button class="prv-link-acao prv-act-trocar" data-sub="${s.id}" title="Recalcula a nota com o gabarito da variante escolhida">↻</button>`;
            const acoes = [];
            if (p.segundo_corretor_ativo) {
                if (seg) {
                    acoes.push('<small>2ª ok</small>');
                } else if (s.segundo_corretor_pendente_email) {
                    acoes.push(`<button class="prv-link-acao prv-act-sortear" data-sub="${s.id}" title="Corretor já sorteado (${escapeHtml(s.segundo_corretor_pendente_email)}). Clique para re-sortear outro.">Re-sortear</button>`);
                } else {
                    acoes.push(`<button class="prv-link-acao prv-act-sortear" data-sub="${s.id}">Sortear 2º</button>`);
                }
            }
            acoes.push(`<button class="prv-link-acao prv-link-danger prv-act-apagar" data-sub="${s.id}" data-aluno="${escapeHtml(s.aluno_nome || s.aluno_email)}" title="Apaga a submissão deste aluno para ele refazer">🗑</button>`);
            sub += `<tr>
                <td>${escapeHtml(s.aluno_nome || s.aluno_email)}<br><small style="color:#888">${escapeHtml(s.aluno_email)}</small></td>
                <td>${selVar}</td>
                <td>${new Date(s.criada_em).toLocaleString('pt-BR')}</td>
                <td>${flags.join(' ') || '—'}</td>
                <td class="prv-nota">${s.nota} / ${s.total_max}</td>
                <td>${acoes.join(' ')}</td>
            </tr>`;
        }
        sub += `</tbody></table>`;
    }
    $('prvDetSubmissoes').innerHTML = sub;
    /* Wrap variant selects with custom dropdown */
    $('prvDetSubmissoes').querySelectorAll('.prv-sel-variante').forEach(sel =>
        prvCreateCustomSelect(sel, { compact: true }));
    $('prvDetSubmissoes').querySelectorAll('.prv-act-trocar').forEach(b =>
        b.addEventListener('click', () => trocarVariante(parseInt(b.dataset.sub, 10))));
    $('prvDetSubmissoes').querySelectorAll('.prv-act-sortear').forEach(b =>
        b.addEventListener('click', () => sortear(parseInt(b.dataset.sub, 10))));
    $('prvDetSubmissoes').querySelectorAll('.prv-act-apagar').forEach(b =>
        b.addEventListener('click', () => apagarSubmissao(parseInt(b.dataset.sub, 10), b.dataset.aluno)));
    $('prvDetSubmissoes').querySelectorAll('.prv-act-foto').forEach(b =>
        b.addEventListener('click', () => conferirFoto(parseInt(b.dataset.sub, 10))));

    $('prvBtnEfetivar').textContent = p.efetivada ? 'Reabrir como rascunho' : 'Efetivar notas';
}

/* Converte o JSON de mapeamento (armazenado no banco) para texto legível pelo professor */
function paginasMapToText(json) {
    if (!json) return '';
    try {
        const map = typeof json === 'string' ? JSON.parse(json) : json;
        return Object.entries(map)
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('\n');
    } catch { return ''; }
}

/* Converte o texto livre do professor para JSON { "0": [1,2], "1": [3,4] } */
function parsePaginasMap(text) {
    if (!text || !text.trim()) return null;
    const map = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*([^:\n]+?)\s*:\s*(.+)$/);
        if (!m) continue;
        const code  = m[1].trim();
        const pages = [];
        for (const part of m[2].split(',')) {
            const range = part.trim().split('-').map(s => parseInt(s.trim(), 10));
            if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
                for (let p = range[0]; p <= range[1]; p++) pages.push(p);
            } else if (!isNaN(range[0])) {
                pages.push(range[0]);
            }
        }
        if (code && pages.length > 0) map[code] = pages;
    }
    return Object.keys(map).length > 0 ? map : null;
}

async function salvarTurmaCorretora(remover = false) {
    if (!provaAberta) return;
    const turmaCorretoraId         = remover ? null : ($('prvTcorCurso')?.value || null);
    const turmaCorretora2aCorrecao = !remover && !!$('prvTcor2a')?.checked;
    const liberacaoRaw             = remover ? '' : ($('prvTcorLiberacao')?.value || '');
    if (!remover && !turmaCorretoraId) {
        toast('Selecione a turma corretora ou clique em "Remover".', 'warn');
        return;
    }
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                turmaCorretoraId: turmaCorretoraId || '',
                turmaCorretora2aCorrecao,
                turmaCorretoraLiberacao: liberacaoRaw || '',
            }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao salvar.');
        toast(remover ? 'Turma corretora removida.' : 'Turma corretora salva!', 'ok');
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function salvarSegundoCorretor() {
    if (!provaAberta) return;
    const ativo         = !!$('prvSc2Ativo')?.checked;
    const pctRaw        = parseInt($('prvSc2Pct')?.value, 10);
    const outra         = !!$('prvSc2OutraTurma')?.checked;
    const turma2aId     = outra ? ($('prvSc2TurmaSel')?.value || '') : '';
    const liberacaoRaw  = $('prvSc2Liberacao')?.value || '';
    const erroEl        = $('prvSc2Erro');
    if (erroEl) erroEl.style.display = 'none';
    if (ativo && (!Number.isInteger(pctRaw) || pctRaw < 1 || pctRaw > 100)) {
        if (erroEl) { erroEl.textContent = 'O percentual deve ser entre 1 e 100.'; erroEl.style.display = ''; }
        return;
    }
    const pct = ativo ? pctRaw : (provaAberta.prova.segundo_corretor_pct || 15);
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                segundoCorretorAtivo:    ativo,
                segundoCorretorPct:      pct,
                permitirOutraTurma:      outra,
                turmaCorretora2aId:      turma2aId || '',
                segundoCorretorLiberacao: liberacaoRaw || '',
            }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao salvar.');
        toast('2º corretor salvo!', 'ok');
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function salvarMapeamentoPaginas(limpar = false) {
    if (!provaAberta) return;
    const mapa = limpar ? null : parsePaginasMap($('prvPaginasMapEditor')?.value || '');
    if (!limpar && !mapa) {
        toast('Informe ao menos uma linha no formato "variante: páginas" antes de salvar.', 'warn');
        return;
    }
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ linkProvaPaginas: mapa }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao salvar.');
        toast(limpar ? 'Mapeamento removido — será usado auto-detecção.' : 'Mapeamento de páginas salvo!', 'ok');
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function atribuirFolhaTcor() {
    if (!provaAberta) return;
    const nome      = ($('prvTcorAtNome')?.value || '').trim();
    const email     = ($('prvTcorAtEmail')?.value || '').trim();
    const variante  = ($('prvTcorAtVariante')?.value || '').trim();
    if (!nome || !email || !variante) {
        toast('Preencha nome, e-mail e variante do aluno.', 'warn');
        return;
    }
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/turma-corretora/atribuir-folha`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ alunoNome: nome, alunoEmail: email, varianteCodigo: variante }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao atribuir folha.');
        toast(`Folha de ${nome} atribuída! A turma corretora já pode encontrá-la.`, 'ok');
        if ($('prvTcorAtNome'))    $('prvTcorAtNome').value  = '';
        if ($('prvTcorAtEmail'))   $('prvTcorAtEmail').value = '';
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro ao atribuir folha', e.message, { tipo: 'danger' }); }
}

async function sortear(submissaoId) {
    const provaId = provaAberta.prova.id;

    /* Busca a lista de candidatos elegíveis */
    let candidatos;
    try {
        const r = await fetch(
            `/api/classroom/provas/${provaId}/candidatos-segundo?submissaoId=${encodeURIComponent(submissaoId)}`,
            { credentials: 'include' }
        );
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao buscar candidatos.');
        candidatos = d.candidatos || [];
    } catch (e) {
        await notificar('Erro', e.message, { tipo: 'danger' });
        return;
    }

    /* Exibe modal de seleção */
    await new Promise(resolve => {
        const MODAL_ID = 'prvSortearCandidatosModal';
        let existing = document.getElementById(MODAL_ID);
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'prv-modal';
        modal.style.cssText = 'display:flex;z-index:1100';
        modal.onclick = e => { if (e.target === modal) { modal.remove(); resolve(); } };

        const listaHTML = candidatos.length === 0
            ? `<p style="color:var(--text-muted);text-align:center;padding:24px 0">Nenhum candidato elegível no momento.</p>`
            : candidatos.map((c, i) => `
                <button class="prv-sortear-candidato-item" data-email="${escapeHtml(c.aluno_email)}"
                    style="display:flex;flex-direction:column;width:100%;text-align:left;padding:10px 14px;
                           border:1px solid var(--border);border-radius:8px;margin-bottom:8px;
                           background:var(--bg-card);cursor:pointer;transition:background .15s">
                    <span style="font-weight:600;font-size:14px;color:var(--text-primary)">${i + 1}. ${c.aluno_nome ? escapeHtml(c.aluno_nome) : escapeHtml(c.aluno_email)}</span>
                    ${c.aluno_nome ? `<span style="font-size:12px;color:var(--text-muted)">${escapeHtml(c.aluno_email)}</span>` : ''}
                </button>`).join('');

        modal.innerHTML = `
            <div class="prv-modal-card" style="max-width:480px;width:94%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;padding:0">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px 14px;flex-shrink:0;border-bottom:1px solid var(--border)">
                    <h3 style="margin:0;font-size:17px;color:var(--text-primary)">Escolher 2º Corretor</h3>
                    <button class="prv-btn-icon" id="${MODAL_ID}Fechar">✕</button>
                </div>
                <div style="flex:1;overflow-y:auto;min-height:0;padding:16px 22px">
                    <p style="margin:0 0 14px;font-size:13px;color:var(--text-muted)">
                        Clique em um aluno para atribuí-lo, ou sorteie aleatoriamente entre os elegíveis.
                    </p>
                    <div id="${MODAL_ID}Lista">${listaHTML}</div>
                </div>
                <div style="padding:14px 22px;border-top:1px solid var(--border);flex-shrink:0;display:flex;gap:10px;justify-content:flex-end;background:var(--bg-card)">
                    <button class="prv-btn prv-btn-sec" id="${MODAL_ID}Cancelar">Cancelar</button>
                    <button class="prv-btn" id="${MODAL_ID}Aleatorio" ${candidatos.length === 0 ? 'disabled' : ''}>🎲 Sortear aleatoriamente</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        const fechar = () => { modal.remove(); resolve(); };

        document.getElementById(`${MODAL_ID}Fechar`).onclick    = fechar;
        document.getElementById(`${MODAL_ID}Cancelar`).onclick  = fechar;

        const executarSorteio = async (emailEscolhido) => {
            modal.remove();
            try {
                const body = { submissaoId };
                if (emailEscolhido) body.emailEscolhido = emailEscolhido;
                const r = await fetch(`/api/classroom/provas/${provaId}/sortear-segundo`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(body),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.erro);
                const msg = emailEscolhido
                    ? `✅ Corretor atribuído: ${d.sorteado}`
                    : `🎲 Corretor sorteado: ${d.sorteado}`;
                toast(msg, 'ok');
                await abrirDetalhe(provaId);
            } catch (e) {
                await notificar('Erro', e.message, { tipo: 'danger' });
            }
            resolve();
        };

        document.getElementById(`${MODAL_ID}Aleatorio`).onclick = () => executarSorteio(null);

        document.getElementById(`${MODAL_ID}Lista`).querySelectorAll('.prv-sortear-candidato-item').forEach(btn => {
            btn.onmouseenter = () => { btn.style.background = 'var(--hover-bg)'; };
            btn.onmouseleave = () => { btn.style.background = 'var(--bg-card)'; };
            btn.onclick = () => executarSorteio(btn.dataset.email);
        });
    });
}

async function regabaritar() {
    if (!await confirmar('Re-baixar gabarito?', 'Re-baixar o gabarito da GradePen? As notas calculadas serão refeitas se você efetivar de novo.')) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/regabaritar`, {
            method: 'POST', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await notificar('Gabarito atualizado', d.variantes_count + ' variantes.', {tipo: 'ok', icone: '📋'});
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function toggleEfetivar() {
    const acao = provaAberta.prova.efetivada ? 'reabrir' : 'efetivar';
    if (!await confirmar(`${acao === 'efetivar' ? 'Efetivar prova?' : 'Reabrir como rascunho?'}`, `${acao === 'efetivar' ? 'Efetivar' : 'Reabrir como rascunho'} esta prova?`)) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/${acao}`, {
            method: 'POST', credentials: 'include',
        });
        if (!r.ok) throw new Error('Falhou');
        await abrirDetalhe(provaAberta.prova.id);
        await carregarProvas();
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function excluirProva() {
    if (!await confirmar('Excluir prova?', 'EXCLUIR esta prova? Todas as correções dos alunos serão apagadas. Não dá pra desfazer.', { confirmLabel: 'Excluir', tipo: 'danger' })) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}`, {
            method: 'DELETE', credentials: 'include',
        });
        if (!r.ok) throw new Error('Falhou');
        fecharDet();
        await carregarProvas();
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function trocarVariante(submissaoId) {
    const sel = $(`prvVar_${submissaoId}`);
    if (!sel) return;
    const varianteId = sel.value;
    if (!await confirmar('Trocar variante?', 'Trocar a variante desta submissão? A nota será recalculada com o novo gabarito. Se houver 2ª correção, ela será apagada (vai precisar ser sorteada de novo).')) return;
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}/variante`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ varianteId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        if (d.semMudanca) { toast('Já era essa variante. Nada mudou.', 'info'); return; }
        let msg = `Variante trocada. Nova nota: ${d.nota} / ${d.total_max}.`;
        if (d.segundasRemovidas) msg += ` ${d.segundasRemovidas} 2ª(s) correção(ões) foram apagadas.`;
        toast(msg, 'ok');
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function apagarSubmissao(submissaoId, nomeAluno) {
    if (!await confirmar('Apagar submissão?', `Apagar a submissão de "${nomeAluno}"?\n\nIsso libera o aluno pra refazer a prova do zero (e remove qualquer 2ª correção vinculada).`, { confirmLabel: 'Apagar', tipo: 'danger' })) return;
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}`, {
            method: 'DELETE', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function publicarNoClassroom() {
    if (!provaAberta) return;
    const sugestao = provaAberta.prova.pontos_avaliacao || 6;
    const txt = await solicitarTexto(
        'Publicar no Classroom',
        'Quantos pontos vale esta avaliação?\n(será o valor do grupo de notas dedicado)',
        sugestao,
        { confirmLabel: 'Publicar', icone: '📢', placeholder: 'Ex: 6', inputMode: 'decimal' }
    );
    if (txt === null) return;
    const pontos = parseFloat(String(txt).replace(/,/g, '.'));
    if (!isFinite(pontos) || pontos <= 0) {
        await confirmar('Valor inválido', 'Informe um número válido maior que zero.', { confirmLabel: 'OK', cancelLabel: '', icone: '⚠️' });
        return;
    }
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/publicar-classroom`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pontosMeta: pontos }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        const dt = d.dueDate ? `${String(d.dueDate.day).padStart(2,'0')}/${String(d.dueDate.month).padStart(2,'0')}/${d.dueDate.year}` : '—';
        if (await confirmar('Atividade publicada!', `Atividade publicada no Classroom!\n\n📅 Prazo: ${dt} 23:59\n💯 Vale: ${d.maxPoints} pts (Trim. ${d.trimestre}/${d.ano})\n✅ Grupo dedicado da avaliação criado/atualizado.\n\nAbrir a atividade no Classroom agora?`, { confirmLabel: 'Abrir no Classroom', cancelLabel: 'Fechar', icone: '✅' })) {
            if (d.alternateLink) window.open(d.alternateLink, '_blank');
        }
    } catch (e) { await notificar('Erro ao publicar', e.message, {tipo: 'danger'}); }
}

function prvAtivarAba(aba) {
    const abas = ['gabarito', 'submissoes', 'divergencias', 'cola'];
    abas.forEach(a => {
        const secEl = $('prvDetSec_' + a);
        const btnEl = $('prvTabBtn_' + a);
        if (secEl) secEl.style.display = a === aba ? '' : 'none';
        if (btnEl) btnEl.classList.toggle('prv-tab-ativa', a === aba);
    });
    if (aba === 'cola'         && !_colaCarregada)         carregarColAnalise();
    if (aba === 'divergencias' && !_divergenciasCarregadas) carregarDivergencias();
}

async function carregarDivergencias() {
    if (!provaAberta) return;
    const cont = $('prvDetDivergencias');
    cont.innerHTML = '<div class="prv-empty">Carregando divergências…</div>';
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/divergencias`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        _divergenciasCarregadas = true;
        renderDivergencias(d.divergencias || []);
    } catch (e) {
        cont.innerHTML = `<div class="prv-empty" style="color:#dc2626">Erro: ${escapeHtml(e.message)}</div>`;
    }
}

function renderDivergencias(divergencias) {
    const cont = $('prvDetDivergencias');
    if (divergencias.length === 0) {
        cont.innerHTML = '<div class="prv-empty">Nenhuma 2ª correção concluída ainda.<br><small>Esta seção será preenchida à medida que os alunos sorteados enviarem suas correções.</small></div>';
        return;
    }

    const nivelCor = {
        perfeita:  { bg: '#dcfce7', cor: '#166534', label: '⭐ Perfeita'  },
        precisa:   { bg: '#d1fae5', cor: '#065f46', label: '🎯 Precisa'   },
        ok:        { bg: '#fef9c3', cor: '#854d0e', label: '👍 Ok'        },
        longe:     { bg: '#ffedd5', cor: '#9a3412', label: '🤔 Longe'     },
        desviante: { bg: '#fee2e2', cor: '#991b1b', label: '❌ Desviante' },
    };

    const linhas = divergencias.map(d => {
        const nc = nivelCor[d.nivel] || nivelCor.ok;
        const suspeitoBadge = d.suspeito
            ? `<span class="prv-flag prv-flag-2cor" style="background:#fef3c7;color:#92400e" title="${escapeHtml(d.risco_cola_nivel || 'Flag de cola registrada')}">⚠️${d.risco_cola_nivel ? ' ' + escapeHtml(d.risco_cola_nivel) : ''}</span>`
            : '';
        const autoridadeBadge = (d.corretor_acerto_pct != null && d.corretor_acerto_pct > 50)
            ? `<span class="prv-flag" style="background:#eff6ff;color:#1d4ed8" title="Corretor acertou ${d.corretor_acerto_pct}% das questões no gabarito — divergência confirmada com autoridade">🎓 Confirmado com autoridade (${d.corretor_acerto_pct}%)</span>`
            : '';
        return `<tr>
            <td>${escapeHtml(d.aluno_email)}${suspeitoBadge ? '<br>' + suspeitoBadge : ''}</td>
            <td style="text-align:center">${d.nota_1}</td>
            <td style="text-align:center">${d.nota_2}</td>
            <td style="text-align:center">${d.divergencia}</td>
            <td style="text-align:center">
                <span class="prv-flag" style="background:${nc.bg};color:${nc.cor}">${nc.label}</span>
                ${autoridadeBadge}
            </td>
        </tr>`;
    }).join('');

    cont.innerHTML = `
        <h3>Divergências parciais <small style="font-weight:normal;color:#666">(${divergencias.length} par${divergencias.length !== 1 ? 'es' : ''})</small></h3>
        <p style="color:#666;font-size:.85em;margin-bottom:8px">Mostra os pares 1ª correção / 2ª correção já submetidos. Emails mascarados para preservar o anonimato. XP definitivo é calculado apenas na efetivação.</p>
        <table class="prv-tabela">
            <thead><tr>
                <th>Aluno (mascarado)</th>
                <th style="text-align:center">Nota 1ª</th>
                <th style="text-align:center">Nota 2ª</th>
                <th style="text-align:center">Diferença</th>
                <th style="text-align:center">Nível / Autoridade</th>
            </tr></thead>
            <tbody>${linhas}</tbody>
        </table>
    `;
}

async function carregarColAnalise() {
    if (!provaAberta) return;
    const cont = $('prvDetCola');
    cont.innerHTML = '<div class="prv-empty">Carregando análise…</div>';
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/analise-cola`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        /* Constrói mapa de flags a partir dos dados já embutidos em cada par */
        _colaFlags = {};
        for (const par of (d.pares || [])) {
            if (par.flag) {
                const [ea, eb] = [par.alunoA, par.alunoB].sort();
                _colaFlags[`${ea}|${eb}`] = par.flag;
            }
        }
        _colaCarregada = true;
        const provaId = provaAberta.prova.id;
        const prova = provas.find(p => p.id === provaId);
        if (prova) {
            prova.pares_suspeitos = (d.pares || []).filter(p => p.similaridade >= 70).length;
        }
        _atualizarBadgesCard(provaId);
        renderColAnalise(d);
    } catch (e) {
        $('prvDetCola').innerHTML = `<div class="prv-empty" style="color:#dc2626">Erro: ${escapeHtml(e.message)}</div>`;
    }
}

function renderColAnalise({ pares, suspeitosEntreVariantes, temDiscursiva }) {
    _colaParesMap = {};
    const cont = $('prvDetCola');
    const temVariantes = suspeitosEntreVariantes && suspeitosEntreVariantes.length > 0;

    if (!pares || pares.length === 0) {
        if (!temVariantes) {
            cont.innerHTML = `<div class="prv-empty">Sem dados suficientes para análise.<br><small>São necessárias ao menos 2 submissões na mesma variante.</small></div>`;
            return;
        }
        /* Apenas cross-variant: mostrar somente essa seção */
        cont.innerHTML = `
            <div class="prv-empty" style="margin-bottom:14px">
                Nenhum par suspeito dentro da mesma variante,
                mas foram detectados suspeitos entre variantes diferentes.
            </div>
            <div class="prv-cola-variantes-section" id="prvColaVariantesSection">
                <div class="prv-cola-variantes-header" onclick="toggleVariantesProvas()" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-secondary,#fff);border:1px solid var(--border,#ddd);border-radius:8px;font-weight:600;font-size:13px">
                    ⚡ Suspeitos entre variantes diferentes
                    <span class="prv-cola-badge prv-cola-alerta">${suspeitosEntreVariantes.length}</span>
                    <span id="prvColaVariantesArrow" style="margin-left:auto;color:var(--text-muted,#888)">▼</span>
                </div>
                <div id="prvColaVariantesBody" style="display:none;margin-top:8px">
                    ${renderEntreVariantesProvas(suspeitosEntreVariantes)}
                </div>
            </div>
        `;
        return;
    }

    const flagCount = Object.keys(_colaFlags).length;
    const thresholdElemId = 'prvColaThreshold';
    const provaIdAtual = provaAberta && provaAberta.prova && provaAberta.prova.id;
    const thresholdStorageKey = provaIdAtual ? `prvColaThreshold_${provaIdAtual}` : 'prvColaThreshold';
    const savedThreshold = parseInt(localStorage.getItem(thresholdStorageKey) || '70', 10);

    const html = `
        <div class="prv-cola-controles">
            <label>Similaridade mínima:
                <input type="range" id="${thresholdElemId}" min="0" max="100" value="${savedThreshold}" style="vertical-align:middle;width:120px">
                <span id="prvColaThresholdVal">${savedThreshold}</span>%
            </label>
            <span class="prv-cola-legenda">
                <span class="prv-cola-badge prv-cola-alerta">≥70%</span> suspeito &nbsp;
                <span class="prv-cola-badge prv-cola-critico">≥85%</span> alto risco
            </span>
            <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                ${flagCount > 0 ? `<button class="prv-btn prv-cola-export-btn" id="prvColaExportBtn" onclick="exportarFlags(${provaIdAtual})">⬇️ Flags CSV (${flagCount})</button>` : ''}
                <button class="prv-btn" id="prvColaPdfBtn" onclick="exportarColaPdf(${provaIdAtual})">📄 PDF</button>
            </div>
        </div>
        <div id="prvColaTabelaWrap"></div>
        ${temVariantes ? `
        <div class="prv-cola-variantes-section" id="prvColaVariantesSection" style="margin-top:14px">
            <div class="prv-cola-variantes-header" onclick="toggleVariantesProvas()" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-secondary,#fff);border:1px solid var(--border,#ddd);border-radius:8px;font-weight:600;font-size:13px">
                ⚡ Suspeitos entre variantes diferentes
                <span class="prv-cola-badge prv-cola-alerta">${suspeitosEntreVariantes.length}</span>
                <span id="prvColaVariantesArrow" style="margin-left:auto;color:var(--text-muted,#888)">▼</span>
            </div>
            <div id="prvColaVariantesBody" style="display:none;margin-top:8px">
                ${renderEntreVariantesProvas(suspeitosEntreVariantes)}
            </div>
        </div>` : ''}
        ${temDiscursiva ? '<p class="prv-cola-rodape">* Questões discursivas foram excluídas da comparação (apenas múltipla escolha e V/F são analisadas).</p>' : ''}
    `;
    cont.innerHTML = html;

    const slider = document.getElementById(thresholdElemId);
    const valSpan = document.getElementById('prvColaThresholdVal');
    const wrap    = document.getElementById('prvColaTabelaWrap');

    function renderTabela() {
        const threshold = parseInt(slider.value, 10);
        valSpan.textContent = threshold;
        const filtrados = pares.filter(p => p.similaridade >= threshold);

        const provaId = provaAberta && provaAberta.prova && provaAberta.prova.id;
        if (provaId) {
            const prova = provas.find(p => p.id === provaId);
            if (prova) {
                prova.pares_suspeitos = filtrados.length;
                prova.pares_suspeitos_threshold = threshold;
                _atualizarBadgesCard(provaId);
            }
        }

        if (filtrados.length === 0) {
            wrap.innerHTML = '<div class="prv-empty">Nenhum par acima do threshold atual.</div>';
            _colaExpandido = null;
            return;
        }

        let rows = '';
        for (const par of filtrados) {
            const nivel = par.similaridade >= 85 ? 'critico' : (par.similaridade >= 70 ? 'alerta' : '');
            const parKey = `${par.alunoA}|${par.alunoB}`;
            const [ea, eb] = [par.alunoA, par.alunoB].sort();
            const flag = _colaFlags[`${ea}|${eb}`] || null;
            const expandido = _colaExpandido === parKey;
            const flagBadge = flag
                ? (flag.status === 'resolvido'
                    ? '<span class="prv-cola-badge prv-cola-flag-resolvido">✅ Resolvido</span>'
                    : '<span class="prv-cola-badge prv-cola-flag-investigar">🔍 Investigar</span>')
                : '';
            _colaParesMap[parKey] = par;
            const parKeyJson = JSON.stringify(parKey);
            const score = par.scorePonderado ?? par.similaridade;
            const scoreNivel = score >= 80 ? 'alto' : (score >= 60 ? 'medio' : 'baixo');
            const safeA = escapeHtml(par.alunoA);
            const safeB = escapeHtml(par.alunoB);
            rows += `
                <tr class="prv-cola-row ${nivel ? 'prv-cola-row-' + nivel : ''} ${flag ? 'prv-cola-row-flagged' : ''}" data-par="${escapeHtml(parKey)}" style="cursor:pointer">
                    <td>
                        <strong>${escapeHtml(par.nomeA)}</strong><br><small>${safeA}</small>
                        <button class="prv-cola-hist-btn" title="Histórico de cola" onclick="event.stopPropagation();verHistoricoAlunoProvas('${safeA}','${escapeHtml(par.nomeA)}')">🕐</button>
                    </td>
                    <td>
                        <strong>${escapeHtml(par.nomeB)}</strong><br><small>${safeB}</small>
                        <button class="prv-cola-hist-btn" title="Histórico de cola" onclick="event.stopPropagation();verHistoricoAlunoProvas('${safeB}','${escapeHtml(par.nomeB)}')">🕐</button>
                    </td>
                    <td style="text-align:center">.${escapeHtml(par.varianteCodigo)}</td>
                    <td style="text-align:center">
                        <span class="prv-cola-badge ${nivel === 'critico' ? 'prv-cola-critico' : nivel === 'alerta' ? 'prv-cola-alerta' : ''}">${par.similaridade}%</span>
                    </td>
                    <td style="min-width:100px">
                        <div class="prv-cola-score-bar-wrap" title="Score ponderado: coincidências em questões fáceis (alta taxa de acerto na turma) têm mais peso.">
                            <div class="prv-cola-score-bar-bg"><div class="prv-cola-score-bar-fill ${scoreNivel}" style="width:${score}%"></div></div>
                            <span class="prv-cola-score-num ${scoreNivel}">${score}%</span>
                        </div>
                    </td>
                    <td style="text-align:center">${par.identicasErradas}</td>
                    <td style="text-align:center">${par.total}</td>
                    <td style="text-align:center">${flagBadge}</td>
                    <td style="text-align:center">
                        <button class="prv-btn prv-cola-conversa-btn"
                            onclick="event.stopPropagation(); abrirConversaPedagogica(${parKeyJson})"
                            title="Abrir Conversa Pedagógica">💬 Conversa</button>
                    </td>
                </tr>
            `;
            if (expandido) {
                rows += `<tr class="prv-cola-detalhe-row"><td colspan="9">${renderDetalhePar(par, flag)}</td></tr>`;
            }
        }

        wrap.innerHTML = `
            <table class="prv-tabela prv-cola-tabela">
                <thead><tr>
                    <th>Aluno A</th><th>Aluno B</th>
                    <th style="text-align:center">Variante</th>
                    <th style="text-align:center">Similaridade</th>
                    <th style="text-align:center">Score Ponderado</th>
                    <th style="text-align:center">Erros coincidentes</th>
                    <th style="text-align:center">Total questões</th>
                    <th style="text-align:center">Status</th>
                    <th style="text-align:center">Conversa</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        wrap.querySelectorAll('.prv-cola-row').forEach(tr => {
            tr.addEventListener('click', () => {
                const key = tr.dataset.par;
                _colaExpandido = _colaExpandido === key ? null : key;
                renderTabela();
            });
        });
    }

    _renderColaTabela = renderTabela;
    slider.addEventListener('input', () => {
        localStorage.setItem(thresholdStorageKey, slider.value);
        renderTabela();
    });
    renderTabela();
}

function renderDetalhePar(par, flag) {
    const safeA = escapeHtml(par.alunoA);
    const safeB = escapeHtml(par.alunoB);
    const keyPart = par.alunoA.replace(/[^a-zA-Z0-9]/g, '-');
    const notaId  = `prvFlagNota-${keyPart}-${par.alunoB.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const gridId  = `prvColaGrid-${keyPart}`;
    const tableId = `prvColaTable-${keyPart}`;
    const togId   = `prvColaToggle-${keyPart}`;
    const currentStatus = flag ? flag.status : '';
    const currentNota   = flag ? (flag.nota_professor || '') : '';
    const btnInvCls = currentStatus === 'investigar' ? 'prv-cola-flag-btn-ativo' : '';
    const btnResCls = currentStatus === 'resolvido'  ? 'prv-cola-flag-btn-ativo' : '';
    const provaId   = provaAberta && provaAberta.prova && provaAberta.prova.id;

    const gridHtml = renderGridCola(par.detalhes);

    let tableRows = '';
    for (const q of par.detalhes) {
        const fmtResp = v => {
            if (v === null) return '<em style="color:#aaa">—</em>';
            if (Array.isArray(v)) return escapeHtml(v.join(', '));
            return escapeHtml(String(v).toUpperCase());
        };
        const fmtGab = v => {
            if (v === null) return '—';
            if (Array.isArray(v)) return escapeHtml(v.join(', '));
            return escapeHtml(String(v).toUpperCase());
        };
        const cls = q.amboserram ? 'prv-cola-q-erro' : (q.igual ? 'prv-cola-q-igual' : '');
        const acertoBar = q.acertoRate != null
            ? `<div style="display:inline-block;width:30px;height:5px;background:#e5e7eb;border-radius:99px;vertical-align:middle;margin-left:3px"><div style="width:${q.acertoRate}%;height:100%;background:${q.acertoRate>70?'#22c55e':q.acertoRate>40?'#f59e0b':'#dc2626'};border-radius:99px"></div></div>`
            : '';
        tableRows += `<tr class="${cls}">
            <td style="text-align:center;font-weight:600">${q.questao}</td>
            <td style="text-align:center">${fmtResp(q.respA)}</td>
            <td style="text-align:center">${fmtResp(q.respB)}</td>
            <td style="text-align:center;color:#166534;font-weight:600">${fmtGab(q.correta)}</td>
            <td style="text-align:center">${q.amboserram ? '<span class="prv-cola-badge prv-cola-critico">erro coincidente</span>' : (q.igual ? '<span class="prv-cola-badge prv-cola-alerta">idêntica</span>' : '')}</td>
            <td style="text-align:center;font-size:12px">${q.acertoRate != null ? q.acertoRate+'%'+acertoBar : '—'}</td>
        </tr>`;
    }

    const flagHtml = `
        <div class="prv-cola-flag-wrap">
            <div class="prv-cola-flag-title">Decisão do professor</div>
            <div class="prv-cola-flag-btns">
                <button class="prv-btn prv-cola-flag-btn ${btnInvCls}"
                    onclick="salvarFlag(${provaId}, '${safeA}', '${safeB}', 'investigar')">🔍 Investigar</button>
                <button class="prv-btn prv-cola-flag-btn ${btnResCls}"
                    onclick="salvarFlag(${provaId}, '${safeA}', '${safeB}', 'resolvido')">✅ Resolvido</button>
            </div>
            <div class="prv-cola-flag-nota-wrap">
                <textarea id="${notaId}" class="prv-cola-flag-nota" rows="2"
                    placeholder="Anotação opcional (ex: conversa agendada, coincidência confirmada…)">${escapeHtml(currentNota)}</textarea>
                <button class="prv-btn" onclick="salvarFlagNota(${provaId}, '${safeA}', '${safeB}', '${notaId}')">Salvar nota</button>
            </div>
        </div>
    `;

    return `
        <div class="prv-cola-detalhe">
            <strong>Detalhamento questão a questão — ${escapeHtml(par.nomeA)} × ${escapeHtml(par.nomeB)}</strong>
            <div style="margin-top:10px">
                <button class="prv-cola-grid-toggle" id="${togId}"
                    onclick="toggleGridCola('${togId}','${gridId}','${tableId}')">
                    📋 Ver como tabela
                </button>
                <div id="${gridId}">${gridHtml}</div>
                <div id="${tableId}" style="display:none">
                    <table class="prv-tabela" style="margin-top:6px;font-size:13px">
                        <thead><tr>
                            <th style="text-align:center">Q</th>
                            <th style="text-align:center">Aluno A</th>
                            <th style="text-align:center">Aluno B</th>
                            <th style="text-align:center">Gabarito</th>
                            <th style="text-align:center">Status</th>
                            <th style="text-align:center">% Acerto turma</th>
                        </tr></thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            </div>
            ${flagHtml}
        </div>
    `;
}

function renderGridCola(detalhes) {
    const cells = detalhes.map(q => {
        const cls = q.amboserram ? 'prv-cola-cell-erro' : (q.igual ? 'prv-cola-cell-correto' : 'prv-cola-cell-diferente');
        const tip = q.amboserram
            ? `Q${q.questao}: Erro coincidente (ambos: ${String(q.respA||'').toUpperCase()}, gabarito: ${String(q.correta||'').toUpperCase()})`
            : q.igual
                ? `Q${q.questao}: Resposta idêntica e correta (${String(q.respA||'').toUpperCase()})`
                : `Q${q.questao}: Respostas diferentes (A:${String(q.respA||'—').toUpperCase()} / B:${String(q.respB||'—').toUpperCase()})`;
        return `<div class="prv-cola-grid-cell ${cls}" title="${escapeHtml(tip)}">${q.questao}</div>`;
    }).join('');
    return `
        <div class="prv-cola-grid-legenda">
            <span class="prv-cola-grid-leg-item"><span class="prv-cola-grid-leg-dot correto"></span>Acerto idêntico</span>
            <span class="prv-cola-grid-leg-item"><span class="prv-cola-grid-leg-dot erro"></span>Erro coincidente</span>
            <span class="prv-cola-grid-leg-item"><span class="prv-cola-grid-leg-dot diferente"></span>Diferente</span>
        </div>
        <div class="prv-cola-grid">${cells}</div>
    `;
}

function toggleGridCola(togId, gridId, tableId) {
    const grid  = document.getElementById(gridId);
    const table = document.getElementById(tableId);
    const btn   = document.getElementById(togId);
    if (!grid || !table) return;
    const showGrid = grid.style.display === 'none';
    grid.style.display  = showGrid ? '' : 'none';
    table.style.display = showGrid ? 'none' : '';
    if (btn) btn.textContent = showGrid ? '📋 Ver como tabela' : '🎨 Ver como grade visual';
}

function renderEntreVariantesProvas(suspeitos) {
    if (!suspeitos || suspeitos.length === 0) return '';
    let rows = '';
    for (const s of suspeitos) {
        rows += `<tr>
            <td><strong>${escapeHtml(s.nomeA)}</strong><br><small>${escapeHtml(s.alunoA)}</small></td>
            <td style="text-align:center">.${escapeHtml(String(s.varianteA))}</td>
            <td><strong>${escapeHtml(s.nomeB)}</strong><br><small>${escapeHtml(s.alunoB)}</small></td>
            <td style="text-align:center">.${escapeHtml(String(s.varianteB))}</td>
            <td style="text-align:center">${s.posIguais} / ${s.totalComuns}</td>
            <td style="text-align:center"><span class="prv-cola-badge ${s.posSimil >= 70 ? 'prv-cola-alerta' : ''}">${s.posSimil}%</span></td>
        </tr>`;
    }
    return `
        <p style="font-size:13px;color:var(--text-muted,#666);margin:0 0 10px">
            Estes alunos usaram <strong>variantes diferentes</strong> mas responderam as mesmas posições de forma suspeita.
        </p>
        <div style="overflow-x:auto">
        <table class="prv-tabela" style="font-size:13px">
            <thead><tr>
                <th>Aluno A</th>
                <th style="text-align:center">Variante A</th>
                <th>Aluno B</th>
                <th style="text-align:center">Variante B</th>
                <th style="text-align:center">Posições iguais</th>
                <th style="text-align:center">Similaridade posicional</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        </div>
    `;
}

function toggleVariantesProvas() {
    const body  = document.getElementById('prvColaVariantesBody');
    const arrow = document.getElementById('prvColaVariantesArrow');
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    if (arrow) arrow.textContent = open ? '▲' : '▼';
}

async function exportarColaPdf(provaId) {
    const btn = document.getElementById('prvColaPdfBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
    try {
        const r = await fetch(`/api/classroom/provas/${provaId}/cola-pdf`, { credentials: 'include' });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.erro || 'Erro ao gerar PDF.');
        }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analise-cola-prova-${provaId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        await notificar('Erro ao gerar PDF', e.message, { tipo: 'danger' });
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📄 PDF'; }
    }
}

async function verHistoricoAlunoProvas(email, nome) {
    let modal = document.getElementById('prvColaHistModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'prvColaHistModal';
        modal.className = 'prv-modal';
        modal.style.display = 'flex';
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        modal.innerHTML = `
            <div class="prv-modal-card" style="max-width:560px;width:94%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;padding:0">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 14px;flex-shrink:0;border-bottom:1px solid var(--border,#eee)">
                    <h3 id="prvColaHistTitulo" style="margin:0;font-size:18px">Histórico</h3>
                    <button class="prv-btn-icon" onclick="document.getElementById('prvColaHistModal').remove()">✕</button>
                </div>
                <div id="prvColaHistCorpo" style="flex:1;overflow-y:auto;min-height:0;padding:16px 24px"></div>
            </div>
        `;
        document.body.appendChild(modal);
    } else {
        modal.style.display = 'flex';
    }
    document.getElementById('prvColaHistTitulo').textContent = `Histórico de Cola — ${nome}`;
    document.getElementById('prvColaHistCorpo').innerHTML = '<div class="prv-empty" style="padding:20px">Carregando…</div>';
    try {
        const r = await fetch(`/api/classroom/provas/cola-historico/${encodeURIComponent(email)}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro.');
        const historico = Array.isArray(d.historico) ? d.historico : [];
        if (historico.length === 0) {
            document.getElementById('prvColaHistCorpo').innerHTML = '<p style="color:var(--text-muted,#888);text-align:center;padding:20px 0">Nenhuma ocorrência registrada em outras provas.</p>';
            return;
        }
        document.getElementById('prvColaHistCorpo').innerHTML = historico.map(h => `
            <div style="padding:10px 12px;border:1px solid var(--border,#eee);border-radius:8px;margin-bottom:8px;font-size:13px">
                <div style="font-weight:600;margin-bottom:4px">📝 ${escapeHtml(h.provaNome || 'Prova #' + h.provaId)}</div>
                <div style="color:var(--text-muted,#666);font-size:12px">
                    Com: <strong>${escapeHtml(h.outroAluno || h.emailOutro || '—')}</strong>
                    ${h.status ? ` &nbsp;·&nbsp; <span class="prv-badge ${h.status === 'resolvido' ? 'prv-badge-efetiva' : 'prv-badge-cola'}">${h.status}</span>` : ''}
                </div>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('prvColaHistCorpo').innerHTML = `<p style="color:#dc2626">Erro: ${escapeHtml(e.message)}</p>`;
    }
}

async function exportarFlags(provaId) {
    const btn = $('prvColaExportBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Exportando…'; }
    try {
        const r = await fetch(`/api/classroom/provas/${provaId}/cola-flags/export`, { credentials: 'include' });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.erro || 'Erro ao exportar.');
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flags-cola-prova-${provaId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        await notificar('Erro ao exportar flags', e.message, { tipo: 'danger' });
    } finally {
        if (btn) {
            btn.disabled = false;
            const flagCount = Object.keys(_colaFlags).length;
            btn.textContent = `⬇️ Exportar flags (${flagCount})`;
        }
    }
}

async function salvarFlag(provaId, alunoA, alunoB, status) {
    const notaIdSafe = `prvFlagNota-${alunoA.replace(/[^a-zA-Z0-9]/g, '-')}-${alunoB.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const notaEl = document.getElementById(notaIdSafe);
    const notaProfessor = notaEl ? notaEl.value.trim() : '';
    try {
        const r = await fetch(`/api/classroom/provas/${provaId}/cola-flags`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alunoA, alunoB, status, notaProfessor }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        /* Atualiza mapa local */
        const [ea, eb] = [alunoA, alunoB].sort();
        _colaFlags[`${ea}|${eb}`] = { status, nota_professor: notaProfessor };
        if (_renderColaTabela) _renderColaTabela();
        _atualizarBadgesCard(provaId);
        carregarFlagsPendentes();
        atualizarResumoCurso();
    } catch (e) {
        await notificar('Erro ao salvar decisão', e.message, { tipo: 'danger' });
    }
}

async function salvarFlagNota(provaId, alunoA, alunoB, notaId) {
    const [ea, eb] = [alunoA, alunoB].sort();
    const existing = _colaFlags[`${ea}|${eb}`];
    const status = existing ? existing.status : 'investigar';
    const notaEl = document.getElementById(notaId);
    const notaProfessor = notaEl ? notaEl.value.trim() : '';
    try {
        const r = await fetch(`/api/classroom/provas/${provaId}/cola-flags`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alunoA, alunoB, status, notaProfessor }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        const isNew = !existing;
        _colaFlags[`${ea}|${eb}`] = { status, nota_professor: notaProfessor };
        if (_renderColaTabela) _renderColaTabela();
        _atualizarBadgesCard(provaId);
        if (isNew) {
            toast("Decisão registrada como 'Investigar'", 'info');
        }
    } catch (e) {
        await notificar('Erro ao salvar nota', e.message, { tipo: 'danger' });
    }
}

function abrirConversaPedagogica(parKey) {
    const par = _colaParesMap[parKey];
    if (!par) return;
    _conversaPar = par;
    _conversaFoco = 'A';
    _renderConversaCorpo();
    const modal = document.getElementById('prvConversaModal');
    const subtitulo = document.getElementById('prvConversaSubtitulo');
    const provaNome = provaAberta && provaAberta.prova ? provaAberta.prova.nome : '';
    if (subtitulo && provaNome) subtitulo.textContent = `Vamos conversar sobre suas respostas em "${provaNome}".`;
    modal.style.display = 'flex';
}

function fecharConversaPedagogica() {
    document.getElementById('prvConversaModal').style.display = 'none';
    _conversaPar = null;
}

function switchFocoConversa(foco) {
    _conversaFoco = foco;
    _renderConversaCorpo();
}

function _renderConversaCorpo() {
    const par = _conversaPar;
    if (!par) return;
    const focoA = _conversaFoco === 'A';
    const focoNome = focoA ? par.nomeA : par.nomeB;

    const fmtResp = v => {
        if (v === null) return '<em style="color:#aaa">—</em>';
        if (Array.isArray(v)) return escapeHtml(v.join(', '));
        return escapeHtml(String(v).toUpperCase());
    };
    const fmtGab = v => {
        if (v === null) return '—';
        if (Array.isArray(v)) return escapeHtml(v.join(', '));
        return escapeHtml(String(v).toUpperCase());
    };

    let rows = '';
    for (const q of (par.detalhes || [])) {
        const resp = focoA ? q.respA : q.respB;
        const coincidenteErro = q.amboserram;
        const coincidenteAcerto = q.igual && !q.amboserram;
        let badge = '';
        let rowCls = '';
        if (coincidenteErro) {
            badge = '<span class="prv-cola-badge prv-cola-critico prv-conversa-badge-erro">⚠️ erro coincidente com outro aluno</span>';
            rowCls = 'prv-conversa-q-erro';
        } else if (coincidenteAcerto) {
            badge = '<span class="prv-cola-badge prv-cola-alerta prv-conversa-badge-igual">resposta igual à de outro aluno</span>';
        }
        rows += `<tr class="${rowCls}">
            <td class="prv-conversa-q-num">${q.questao}</td>
            <td class="prv-conversa-q-resp">${fmtResp(resp)}</td>
            <td class="prv-conversa-q-gab">${fmtGab(q.correta)}</td>
            <td>${badge}</td>
        </tr>`;
    }

    const btnA = `<button class="prv-btn prv-conversa-foco-btn ${focoA ? 'prv-conversa-foco-ativo' : ''}" onclick="switchFocoConversa('A')">Aluno A</button>`;
    const btnB = `<button class="prv-btn prv-conversa-foco-btn ${!focoA ? 'prv-conversa-foco-ativo' : ''}" onclick="switchFocoConversa('B')">Aluno B</button>`;

    const errosCoincidentes = (par.detalhes || []).filter(q => q.amboserram).length;

    document.getElementById('prvConversaCorpo').innerHTML = `
        <div class="prv-conversa-switcher no-print">
            <span class="prv-conversa-switcher-label">Aluno em foco:</span>
            ${btnA}
            ${btnB}
        </div>
        <div class="prv-conversa-aluno-info">
            <span class="prv-conversa-aluno-nome">${escapeHtml(focoNome)}</span>
            <span class="prv-conversa-aluno-meta">Variante .${escapeHtml(par.varianteCodigo)} &nbsp;·&nbsp; ${par.total} questões &nbsp;·&nbsp; ${errosCoincidentes} erro${errosCoincidentes !== 1 ? 's' : ''} coincidente${errosCoincidentes !== 1 ? 's' : ''} com outro aluno</span>
        </div>
        <table class="prv-tabela prv-conversa-tabela">
            <thead><tr>
                <th style="text-align:center;width:48px">Q</th>
                <th style="text-align:center">Sua resposta</th>
                <th style="text-align:center">Gabarito</th>
                <th>Observação</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p class="prv-conversa-rodape no-print">As identidades dos outros alunos não são exibidas nesta visualização.</p>
    `;
}

async function irParaCola(provaId) {
    await abrirDetalhe(provaId);
    prvAtivarAba('cola');
}

async function carregarFlagsPendentes() {
    if (!cursoAtual) return;
    const panel = $('prvFlagsPendentes');
    if (!panel) return;
    try {
        const r = await fetch(`/api/classroom/provas/pendentes-investigar?courseId=${encodeURIComponent(cursoAtual)}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        const lista = d.pendentes || [];
        if (lista.length === 0) {
            panel.style.display = 'none';
            panel.innerHTML = '';
            return;
        }
        const linhas = lista.map(f => {
            const dt = f.data_aplicacao ? new Date(f.data_aplicacao).toLocaleDateString('pt-BR') : '';
            const flagDt = new Date(f.registrado_em).toLocaleDateString('pt-BR');
            const nota = f.nota_professor ? `<span class="prv-pendente-nota" title="${escapeHtml(f.nota_professor)}">📝</span>` : '';
            return `<tr>
                <td>
                    <span class="prv-pendente-prova-nome">${escapeHtml(f.prova_nome)}</span>
                    ${dt ? `<span class="prv-pendente-prova-data">${dt}</span>` : ''}
                </td>
                <td>${escapeHtml(f.aluno_a)}</td>
                <td>${escapeHtml(f.aluno_b)}</td>
                <td style="text-align:center">${flagDt}${nota}</td>
                <td style="text-align:center">
                    <button class="prv-btn prv-pendente-link" onclick="irParaCola(${f.prova_id})">
                        Ver análise →
                    </button>
                </td>
            </tr>`;
        }).join('');

        panel.innerHTML = `
            <div class="prv-pendentes-header">
                <span class="prv-pendentes-titulo">🔍 ${lista.length} par${lista.length !== 1 ? 'es' : ''} pendente${lista.length !== 1 ? 's' : ''} de investigação</span>
                <small class="prv-pendentes-sub">Pares marcados como "Investigar" neste curso — clique em "Ver análise" para abrir a prova correspondente.</small>
            </div>
            <table class="prv-tabela prv-pendentes-tabela">
                <thead><tr>
                    <th>Prova</th>
                    <th>Aluno A</th>
                    <th>Aluno B</th>
                    <th style="text-align:center">Flagado em</th>
                    <th style="text-align:center">Ação</th>
                </tr></thead>
                <tbody>${linhas}</tbody>
            </table>
        `;
        panel.style.display = '';
    } catch (e) {
        panel.style.display = 'none';
    }
}

function fecharDet() { $('prvModalDet').style.display = 'none'; provaAberta = null; }

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

window.gpConectar      = gpConectar;
window.gpDesconectar   = gpDesconectar;
window.onTurmaChange   = onTurmaChange;
window.onCursoChange   = onCursoChange;
window.prvAtualizarNome = prvAtualizarNome;
window.abrirNova       = abrirNova;
window.fecharNova      = fecharNova;
window.salvarNova      = salvarNova;
window.abrirDetalhe    = abrirDetalhe;
window.sortear                = sortear;
window.regabaritar            = regabaritar;
window.salvarTurmaCorretora   = salvarTurmaCorretora;
window.salvarSegundoCorretor  = salvarSegundoCorretor;
window.salvarMapeamentoPaginas = salvarMapeamentoPaginas;
window.toggleEfetivar  = toggleEfetivar;
window.excluirProva    = excluirProva;
async function conferirFoto(submissaoId) {
    const ok = await confirmar('Conferir foto?', 'A foto da folha BATE com as marcações que o aluno enviou?\n\nConfirmar = ✅ Confere (aluno ganha XP)\nCancelar = ❌ Não confere (aluno perde XP, será sinalizado)', { confirmLabel: '✅ Confere', cancelLabel: '❌ Não confere' });
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}/conferir-foto`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}
window.conferirFoto    = conferirFoto;
window.trocarVariante  = trocarVariante;
window.apagarSubmissao = apagarSubmissao;
window.publicarNoClassroom = publicarNoClassroom;
window.exportarFlags   = exportarFlags;
window.salvarFlag      = salvarFlag;
window.salvarFlagNota  = salvarFlagNota;
window.fecharDet              = fecharDet;
window.prvAtivarAba           = prvAtivarAba;
window.irParaCola             = irParaCola;
window.prvToggleSegundo       = prvToggleSegundo;
window.abrirConversaPedagogica = abrirConversaPedagogica;
window.fecharConversaPedagogica = fecharConversaPedagogica;
window.switchFocoConversa     = switchFocoConversa;

/* ── Cola alert bell (Provas page) ────────────────────────────── */

let _prvNotifPollTimer   = null;
let _prvNotifPanelAberto = false;

function _prvIniciarNotifPoll() {
    _prvBuscarNotificacoes();
    _prvNotifPollTimer = setInterval(_prvBuscarNotificacoes, _badgePollMs);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) _prvBuscarNotificacoes();
    });
    document.addEventListener('click', e => {
        const wrap = $('prvNotifWrap');
        if (wrap && !wrap.contains(e.target)) _prvFecharNotifPanel();
    });
}

async function _prvBuscarNotificacoes() {
    try {
        const r = await fetch('/api/classroom/provas/notificacoes-cola', { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        _prvAtualizarBadge(d.totalNaoLidas || 0);
        _prvRenderNotifLista(d.notificacoes || []);
    } catch (_) {}
}

function _prvAtualizarBadge(total) {
    const badge = $('prvNotifBadge');
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function _prvRenderNotifLista(notifs) {
    const lista = $('prvNotifLista');
    if (!lista) return;
    if (!notifs.length) {
        lista.innerHTML = '<div class="ac-notif-vazia">Nenhum alerta pendente.</div>';
        return;
    }
    lista.innerHTML = notifs.map(n => {
        const data   = n.criado_em ? new Date(n.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const safeA  = escapeHtml(n.aluno_a);
        const safeB  = escapeHtml(n.aluno_b);
        return `
        <div class="ac-notif-item"
             data-notif-id="${n.id}"
             data-prova-id="${n.prova_id}"
             data-aluno-a="${safeA}"
             data-aluno-b="${safeB}">
            <div class="ac-notif-item-titulo">⚠️ Par suspeito — ${n.similaridade}% de similaridade</div>
            <div class="ac-notif-item-detalhe">
                <strong>${escapeHtml(n.prova_nome || 'Prova #' + n.prova_id)}</strong><br>
                ${safeA} ↔ ${safeB}
            </div>
            <div class="ac-notif-item-data">${data}</div>
        </div>`;
    }).join('');

    lista.querySelectorAll('.ac-notif-item[data-notif-id]').forEach(el => {
        el.addEventListener('click', () => {
            const notifId = parseInt(el.dataset.notifId, 10);
            const provaId = parseInt(el.dataset.provaId, 10);
            const alunoA  = el.dataset.alunoA || null;
            const alunoB  = el.dataset.alunoB || null;
            _prvAbrirNotif(notifId, provaId, alunoA, alunoB);
        });
    });
}

async function _prvAbrirNotif(notifId, provaId, alunoA, alunoB) {
    _prvFecharNotifPanel();
    try {
        await fetch(`/api/classroom/provas/notificacoes-cola/${notifId}/lida`, {
            method: 'POST', credentials: 'include',
        });
    } catch (_) {}
    const params = new URLSearchParams({ provaId });
    if (alunoA) params.set('alunoA', alunoA);
    if (alunoB) params.set('alunoB', alunoB);
    location.href = `/pages/analise-cola/?${params.toString()}`;
}

function prvToggleNotifPanel() {
    if (_prvNotifPanelAberto) _prvFecharNotifPanel();
    else _prvAbrirNotifPanel();
}

function _prvAbrirNotifPanel() {
    const panel = $('prvNotifPanel');
    if (panel) panel.style.display = '';
    _prvNotifPanelAberto = true;
}

function _prvFecharNotifPanel() {
    const panel = $('prvNotifPanel');
    if (panel) panel.style.display = 'none';
    _prvNotifPanelAberto = false;
}

async function prvMarcarTodasLidas() {
    try {
        await fetch('/api/classroom/provas/notificacoes-cola/lida-todas', {
            method: 'POST', credentials: 'include',
        });
        await _prvBuscarNotificacoes();
        _prvFecharNotifPanel();
    } catch (_) {}
}

window.prvToggleNotifPanel = prvToggleNotifPanel;
window.prvMarcarTodasLidas = prvMarcarTodasLidas;

init();
