'use strict';
/* Analise de gabarito — Página dedicada */

const $ = id => document.getElementById(id);

let cursos        = [];
let cursoAtual    = '';
let provas        = [];
let provaAtualId  = null;
let _analise      = null;
let _colaFlags    = {};
let _colaExpandido= null;
let _colaParesMap = {};
let _renderTabela = null;

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ── Custom Dropdown Helper ─────────────────────────────────────── */

const _cselMap = new WeakMap();

function acCreateCustomSelect(selectEl) {
    if (_cselMap.has(selectEl)) return;

    selectEl.style.cssText += ';position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden;';

    const wrap = document.createElement('div');
    wrap.className = 'prv-csel';

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

    function syncDisabled() {
        trigger.disabled = selectEl.disabled;
        wrap.classList.toggle('prv-csel--disabled', selectEl.disabled);
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

    const obs = new MutationObserver(() => {
        syncDisplay();
        syncDisabled();
        if (!panel.hidden) buildPanel();
    });
    obs.observe(selectEl, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['disabled'],
    });

    selectEl.addEventListener('change', syncDisplay);

    syncDisplay();
    syncDisabled();
    _cselMap.set(selectEl, { wrap, trigger, panel, obs, syncDisplay, syncDisabled });
}

function acRefreshCustomSelect(selectEl) {
    const entry = _cselMap.get(selectEl);
    if (entry) { entry.syncDisplay(); entry.syncDisabled(); }
}

/* ── /Custom Dropdown Helper ────────────────────────────────────── */

let _notifPollTimer = null;
let _notifPanelAberto = false;

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('click', e => {
    const wrap = $('acNotifWrap');
    if (wrap && !wrap.contains(e.target)) fecharNotifPanel();
});

async function init() {
    acCreateCustomSelect($('acTurma'));
    acCreateCustomSelect($('acDisciplina'));
    acCreateCustomSelect($('acProva'));
    await carregarCursos();
    _iniciarNotifPoll();
    _aplicarUrlParams();
}

/* ── Notificações de cola ─────────────────────────────────────── */

function _iniciarNotifPoll() {
    _buscarNotificacoes();
    _notifPollTimer = setInterval(_buscarNotificacoes, 2 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) _buscarNotificacoes();
    });
}

async function _buscarNotificacoes() {
    try {
        const r = await fetch('/api/classroom/provas/notificacoes-cola', { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        _atualizarBadge(d.totalNaoLidas || 0);
        _renderNotifLista(d.notificacoes || []);
    } catch (_) {}
}

function _atualizarBadge(total) {
    const badge = $('acNotifBadge');
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function _renderNotifLista(notifs) {
    const lista = $('acNotifLista');
    if (!lista) return;
    if (!notifs.length) {
        lista.innerHTML = '<div class="ac-notif-vazia">Nenhum alerta pendente.</div>';
        _bindNotifClicks(lista);
        return;
    }
    lista.innerHTML = notifs.map(n => {
        const data  = n.criado_em ? new Date(n.criado_em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
        const safeA = escapeHtml(n.aluno_a);
        const safeB = escapeHtml(n.aluno_b);
        /* Use data-* attributes — no inline string interpolation of user values */
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
    _bindNotifClicks(lista);
}

function _bindNotifClicks(lista) {
    lista.querySelectorAll('.ac-notif-item[data-notif-id]').forEach(el => {
        el.addEventListener('click', () => {
            const notifId = parseInt(el.dataset.notifId, 10);
            const provaId = parseInt(el.dataset.provaId, 10);
            const alunoA  = el.dataset.alunoA || null;
            const alunoB  = el.dataset.alunoB || null;
            abrirNotif(notifId, provaId, alunoA, alunoB);
        });
    });
}

function toggleNotifPanel() {
    if (_notifPanelAberto) fecharNotifPanel();
    else abrirNotifPanel();
}

function abrirNotifPanel() {
    const panel = $('acNotifPanel');
    if (panel) panel.style.display = '';
    _notifPanelAberto = true;
}

function fecharNotifPanel() {
    const panel = $('acNotifPanel');
    if (panel) panel.style.display = 'none';
    _notifPanelAberto = false;
}

async function abrirNotif(notifId, provaId, alunoA, alunoB) {
    fecharNotifPanel();
    await _marcarLida(notifId);
    await _navegarParaProva(provaId, alunoA, alunoB);
}

async function _navegarParaProva(provaId, alunoA, alunoB) {
    await _selecionarProvaPorId(provaId);
    if (alunoA && alunoB) _expandirPar(alunoA, alunoB);
}

function _expandirPar(alunoA, alunoB) {
    /* parKey in _colaParesMap may be in either order — try both */
    const candidatos = [`${alunoA}|${alunoB}`, `${alunoB}|${alunoA}`];
    let key = null;
    for (const k of candidatos) {
        if (_colaParesMap[k]) { key = k; break; }
    }
    if (!key) return;
    _colaExpandido = key;
    if (_renderTabela) _renderTabela();
    /* Scroll the expanded row into view */
    setTimeout(() => {
        const row = document.querySelector(`.ac-row[data-par="${CSS.escape(key)}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

async function _marcarLida(notifId) {
    try {
        await fetch(`/api/classroom/provas/notificacoes-cola/${notifId}/lida`, {
            method: 'POST', credentials: 'include',
        });
        await _buscarNotificacoes();
    } catch (_) {}
}

async function marcarTodasLidas() {
    try {
        await fetch('/api/classroom/provas/notificacoes-cola/lida-todas', {
            method: 'POST', credentials: 'include',
        });
        await _buscarNotificacoes();
        fecharNotifPanel();
    } catch (_) {}
}

/* ── URL params ────────────────────────────────────────────────── */

async function _aplicarUrlParams() {
    const params   = new URLSearchParams(location.search);
    const courseId = params.get('courseId');
    const provaId  = params.get('provaId');

    if (courseId) {
        /* Find the curso in the loaded list */
        const curso = cursos.find(c => c.id === courseId);
        if (curso) {
            const turma = _nomeTurma(curso.nome);
            const selTurma = $('acTurma');
            if (selTurma && selTurma.querySelector(`option[value="${CSS.escape(turma)}"]`)) {
                selTurma.value = turma;
                acRefreshCustomSelect(selTurma);
                await onTurmaChange();
                const selDisc = $('acDisciplina');
                if (selDisc && selDisc.querySelector(`option[value="${CSS.escape(courseId)}"]`)) {
                    selDisc.value = courseId;
                    acRefreshCustomSelect(selDisc);
                    await onCursoChange();
                }
            }
        }
    }

    if (provaId) {
        const alunoA = params.get('alunoA') || null;
        const alunoB = params.get('alunoB') || null;
        await _selecionarProvaPorId(parseInt(provaId, 10));
        if (alunoA && alunoB) _expandirPar(alunoA, alunoB);
    }
}

async function _selecionarProvaPorId(provaId) {
    if (!provaId) return;
    try {
        for (const curso of cursos) {
            const r = await fetch(`/api/classroom/provas?courseId=${encodeURIComponent(curso.id)}`, { credentials: 'include' });
            if (!r.ok) continue;
            const d = await r.json();
            const lista = Array.isArray(d.provas) ? d.provas : (Array.isArray(d) ? d : []);
            const found = lista.find(p => p.id === provaId);
            if (found) {
                /* Select turma first, then disciplina */
                const turma = _nomeTurma(curso.nome);
                const selTurma = $('acTurma');
                if (selTurma && selTurma.querySelector(`option[value="${CSS.escape(turma)}"]`)) {
                    selTurma.value = turma;
                    acRefreshCustomSelect(selTurma);
                    await onTurmaChange();
                }
                const selDisc = $('acDisciplina');
                if (selDisc && selDisc.querySelector(`option[value="${CSS.escape(curso.id)}"]`)) {
                    selDisc.value = curso.id;
                    acRefreshCustomSelect(selDisc);
                    await onCursoChange();
                }
                $('acProva').value = provaId;
                acRefreshCustomSelect($('acProva'));
                await onProvaChange();
                return;
            }
        }
    } catch (_) {}
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
        const r = await fetch('/api/classroom/courses', { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao carregar cursos.');
        const todos = Array.isArray(d.courses) ? d.courses : (Array.isArray(d) ? d : []);
        cursos = escolaNav
            ? todos.filter(c => (c.secao || '').includes(escolaNav) || escolaNav.includes(c.secao || ''))
            : todos;
        const turmasSet = new Set(cursos.map(c => _nomeTurma(c.nome)).filter(Boolean));
        const turmas = [...turmasSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const selTurma = $('acTurma');
        selTurma.innerHTML = '<option value="">Selecione uma turma…</option>' +
            turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        $('acDisciplina').innerHTML = '<option value="">Selecione uma turma primeiro…</option>';
        $('acDisciplina').disabled = true;
    } catch (e) {
        console.error('Erro ao carregar cursos:', e);
    }
}

async function onTurmaChange() {
    const turma = $('acTurma').value;
    const selDisc = $('acDisciplina');
    const provasSel = $('acProva');

    cursoAtual = '';
    provaAtualId = null;
    _analise = null;
    $('acPanel').style.display = 'none';
    $('acEmpty').style.display = '';
    provasSel.innerHTML = '<option value="">Selecione uma prova…</option>';
    provasSel.disabled = true;

    if (!turma) {
        selDisc.innerHTML = '<option value="">Selecione uma turma primeiro…</option>';
        selDisc.disabled = true;
        acRefreshCustomSelect($('acDisciplina'));
        acRefreshCustomSelect($('acProva'));
        return;
    }

    const filtrados = cursos.filter(c => _nomeTurma(c.nome) === turma);
    selDisc.innerHTML = '<option value="">Selecione uma disciplina…</option>' +
        filtrados.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(_nomeDisciplina(c.nome))}</option>`).join('');
    selDisc.disabled = false;
    acRefreshCustomSelect($('acDisciplina'));
    acRefreshCustomSelect($('acProva'));
}

async function onCursoChange() {
    cursoAtual = $('acDisciplina').value;
    const provasSel = $('acProva');
    provasSel.innerHTML = '<option value="">Carregando…</option>';
    provasSel.disabled = true;
    $('acPanel').style.display = 'none';
    $('acEmpty').style.display = '';
    provaAtualId = null;
    _analise = null;

    if (!cursoAtual) {
        provasSel.innerHTML = '<option value="">Selecione uma prova…</option>';
        acRefreshCustomSelect($('acProva'));
        return;
    }

    try {
        const r = await fetch(`/api/classroom/provas?courseId=${encodeURIComponent(cursoAtual)}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro.');
        provas = Array.isArray(d.provas) ? d.provas : (Array.isArray(d) ? d : []);
        provasSel.innerHTML = '<option value="">Selecione uma prova…</option>' +
            provas.map(p => {
                const badge = p.pares_suspeitos > 0 ? ` ⚠️ ${p.pares_suspeitos}` : '';
                return `<option value="${p.id}">${escapeHtml(p.nome)}${badge}</option>`;
            }).join('');
        provasSel.disabled = false;
    } catch (e) {
        provasSel.innerHTML = '<option value="">Erro ao carregar provas</option>';
        provasSel.disabled = false;
    }
    acRefreshCustomSelect($('acProva'));
}

async function onProvaChange() {
    const id = parseInt($('acProva').value, 10);
    if (!id) {
        $('acPanel').style.display = 'none';
        $('acEmpty').style.display = '';
        return;
    }
    provaAtualId  = id;
    _colaExpandido = null;
    _colaFlags    = {};
    _colaParesMap = {};

    $('acPanel').innerHTML = '<div class="ac-loading">Carregando análise…</div>';
    $('acPanel').style.display = '';
    $('acEmpty').style.display = 'none';

    try {
        const r = await fetch(`/api/classroom/provas/${id}/analise-cola`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro na análise.');
        _analise = d;

        for (const par of (d.pares || [])) {
            if (par.flag) {
                const [ea, eb] = [par.alunoA, par.alunoB].sort();
                _colaFlags[`${ea}|${eb}`] = par.flag;
            }
        }

        renderAnalise(d);
    } catch (e) {
        $('acPanel').innerHTML = `<div class="ac-empty" style="color:#dc2626">Erro: ${escapeHtml(e.message)}</div>`;
    }
}

function renderAnalise({ pares, suspeitosEntreVariantes, temDiscursiva }) {
    _colaParesMap = {};
    const cont = $('acPanel');
    const temVariantes = suspeitosEntreVariantes && suspeitosEntreVariantes.length > 0;

    if (!pares || pares.length === 0) {
        if (!temVariantes) {
            cont.innerHTML = `<div class="ac-empty">Sem dados suficientes para análise.<br><small>São necessárias ao menos 2 submissões na mesma variante.</small></div>`;
            return;
        }
        /* Apenas cross-variant: mostrar somente essa seção */
        cont.innerHTML = `
            <div class="ac-empty" style="margin-bottom:14px">
                Nenhum par suspeito dentro da mesma variante,
                mas foram detectados suspeitos entre variantes diferentes.
            </div>
            ${_htmlEntreVariantes(suspeitosEntreVariantes)}
            ${temDiscursiva ? '<p class="ac-rodape">* Questões discursivas foram excluídas (apenas múltipla escolha e V/F são analisadas).</p>' : ''}
        `;
        return;
    }

    const storageKey = `acColaThreshold_${provaAtualId}`;
    const savedThreshold = parseInt(localStorage.getItem(storageKey) || '70', 10);
    const flagCount = Object.keys(_colaFlags).length;

    const nCriticos   = pares.filter(p => p.similaridade >= 85).length;
    const nAlertas    = pares.filter(p => p.similaridade >= 70 && p.similaridade < 85).length;
    const nInvestigar = Object.values(_colaFlags).filter(f => f.status === 'investigar').length;
    const nResolvido  = Object.values(_colaFlags).filter(f => f.status === 'resolvido').length;

    cont.innerHTML = `
        <div class="ac-stats">
            <div class="ac-stat">
                <div class="ac-stat-num" style="color:#dc2626">${nCriticos}</div>
                <div class="ac-stat-lbl">Alto risco (≥85%)</div>
            </div>
            <div class="ac-stat">
                <div class="ac-stat-num" style="color:#f59e0b">${nAlertas}</div>
                <div class="ac-stat-lbl">Suspeitos (70–84%)</div>
            </div>
            <div class="ac-stat">
                <div class="ac-stat-num" style="color:#1e40af">${nInvestigar}</div>
                <div class="ac-stat-lbl">Investigando</div>
            </div>
            <div class="ac-stat">
                <div class="ac-stat-num" style="color:#166534">${nResolvido}</div>
                <div class="ac-stat-lbl">Resolvidos</div>
            </div>
            <div class="ac-stat">
                <div class="ac-stat-num">${pares[0]?.total ?? '—'}</div>
                <div class="ac-stat-lbl">Questões</div>
            </div>
        </div>

        <div class="ac-controles">
            <label>Similaridade mínima:
                <input type="range" id="acThreshold" min="0" max="100" value="${savedThreshold}">
                <span id="acThresholdVal">${savedThreshold}</span>%
            </label>
            <span class="ac-legenda">
                <span class="ac-badge ac-badge-alerta">≥70%</span> suspeito
                <span class="ac-badge ac-badge-critico" style="margin-left:6px">≥85%</span> alto risco
            </span>
            <div class="ac-controles-right">
                ${flagCount > 0 ? `<button class="ac-btn" id="acExportCsvBtn" onclick="exportarCsv()">⬇️ Flags CSV (${flagCount})</button>` : ''}
                <button class="ac-btn" id="acExportPdfBtn" onclick="exportarPdf()">📄 Exportar PDF</button>
            </div>
        </div>

        <div id="acTabelaWrap" class="ac-tabela-wrap"></div>

        ${temVariantes ? _htmlEntreVariantes(suspeitosEntreVariantes) : ''}

        ${temDiscursiva ? '<p class="ac-rodape">* Questões discursivas foram excluídas (apenas múltipla escolha e V/F são analisadas).</p>' : ''}
    `;

    const slider  = document.getElementById('acThreshold');
    const valSpan = document.getElementById('acThresholdVal');

    function render() {
        const threshold = parseInt(slider.value, 10);
        valSpan.textContent = threshold;
        localStorage.setItem(storageKey, threshold);
        _renderTabelaInterna(pares, threshold);
    }

    _renderTabela = render;
    slider.addEventListener('input', render);
    render();
}

function _renderTabelaInterna(pares, threshold) {
    const wrap = document.getElementById('acTabelaWrap');
    if (!wrap) return;

    const filtrados = pares.filter(p => p.similaridade >= threshold);

    if (filtrados.length === 0) {
        wrap.innerHTML = '<div class="ac-empty" style="padding:24px">Nenhum par acima do threshold atual.</div>';
        _colaExpandido = null;
        return;
    }

    let rows = '';
    for (const par of filtrados) {
        const nivel   = par.similaridade >= 85 ? 'critico' : (par.similaridade >= 70 ? 'alerta' : '');
        const parKey  = `${par.alunoA}|${par.alunoB}`;
        const [ea, eb]= [par.alunoA, par.alunoB].sort();
        const flag    = _colaFlags[`${ea}|${eb}`] || null;
        const expandido = _colaExpandido === parKey;

        const flagBadge = flag
            ? (flag.status === 'resolvido'
                ? '<span class="ac-badge ac-badge-resolvido">✅ Resolvido</span>'
                : '<span class="ac-badge ac-badge-investigar">🔍 Investigar</span>')
            : '';

        _colaParesMap[parKey] = par;

        const score = par.scorePonderado ?? par.similaridade;
        const scoreNivel = score >= 80 ? 'alto' : (score >= 60 ? 'medio' : 'baixo');

        const safeAEsc = escapeHtml(par.alunoA);
        const safeBEsc = escapeHtml(par.alunoB);
        const safeNomA = escapeHtml(par.nomeA);
        const safeNomB = escapeHtml(par.nomeB);

        rows += `
            <tr class="ac-row ${nivel ? 'ac-row-' + nivel : ''} ${flag ? 'ac-row-flagged' : ''}" data-par="${escapeHtml(parKey)}" style="cursor:pointer">
                <td>
                    <strong>${safeNomA}</strong>
                    <br><small style="color:var(--text-muted,#888)">${safeAEsc}</small>
                    <button class="ac-hist-btn" title="Ver histórico de cola"
                        onclick="event.stopPropagation();verHistoricoAluno('${safeAEsc}','${safeNomA}')">🕐</button>
                </td>
                <td>
                    <strong>${safeNomB}</strong>
                    <br><small style="color:var(--text-muted,#888)">${safeBEsc}</small>
                    <button class="ac-hist-btn" title="Ver histórico de cola"
                        onclick="event.stopPropagation();verHistoricoAluno('${safeBEsc}','${safeNomB}')">🕐</button>
                </td>
                <td style="text-align:center">.${escapeHtml(par.varianteCodigo)}</td>
                <td style="text-align:center">
                    <span class="ac-badge ${nivel === 'critico' ? 'ac-badge-critico' : nivel === 'alerta' ? 'ac-badge-alerta' : ''}">${par.similaridade}%</span>
                </td>
                <td>
                    <div class="ac-score-bar-wrap" title="Score ponderado por dificuldade. Coincidências em questões fáceis (alta taxa de acerto) têm mais peso.">
                        <div class="ac-score-bar-bg">
                            <div class="ac-score-bar-fill ${scoreNivel}" style="width:${score}%"></div>
                        </div>
                        <span class="ac-score-num ${scoreNivel}">${score}%</span>
                    </div>
                </td>
                <td style="text-align:center">${par.identicasErradas}</td>
                <td style="text-align:center">${par.total}</td>
                <td style="text-align:center">${flagBadge}</td>
            </tr>
        `;
        if (expandido) {
            rows += `<tr class="ac-detalhe-row"><td colspan="8">${_renderDetalhePar(par, flag)}</td></tr>`;
        }
    }

    wrap.innerHTML = `
        <table class="ac-tabela">
            <thead><tr>
                <th>Aluno A</th>
                <th>Aluno B</th>
                <th style="text-align:center">Variante</th>
                <th style="text-align:center">Similaridade</th>
                <th style="text-align:center">Score Ponderado ⓘ</th>
                <th style="text-align:center">Erros coincidentes</th>
                <th style="text-align:center">Total Q</th>
                <th style="text-align:center">Status</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    wrap.querySelectorAll('.ac-row').forEach(tr => {
        tr.addEventListener('click', () => {
            const key = tr.dataset.par;
            _colaExpandido = _colaExpandido === key ? null : key;
            if (_renderTabela) _renderTabela();
        });
    });
}

function _renderDetalhePar(par, flag) {
    const safeA = escapeHtml(par.alunoA);
    const safeB = escapeHtml(par.alunoB);
    const keyPart = par.alunoA.replace(/[^a-zA-Z0-9]/g, '-');
    const notaId  = `acFlagNota-${keyPart}`;
    const gridId  = `acGridWrap-${keyPart}`;
    const tableId = `acTableWrap-${keyPart}`;
    const togId   = `acGridToggle-${keyPart}`;

    const currentStatus = flag ? flag.status : '';
    const currentNota   = flag ? (flag.nota_professor || '') : '';
    const btnInvCls = currentStatus === 'investigar' ? 'ac-flag-btn-ativo' : '';
    const btnResCls = currentStatus === 'resolvido'  ? 'ac-flag-btn-ativo' : '';

    const gridHtml = _renderGrid(par.detalhes);

    let tableRows = '';
    for (const q of par.detalhes) {
        const fmtR = v => {
            if (v === null) return '<em style="color:#aaa">—</em>';
            if (Array.isArray(v)) return escapeHtml(v.join(', '));
            return escapeHtml(String(v).toUpperCase());
        };
        const cls = q.amboserram ? 'ac-q-erro' : (q.igual ? 'ac-q-igual' : '');
        const acertoBar = q.acertoRate != null
            ? `<div style="display:inline-block;width:32px;height:5px;background:#e5e7eb;border-radius:99px;vertical-align:middle;margin-left:4px"><div style="width:${q.acertoRate}%;height:100%;background:${q.acertoRate>70?'#22c55e':q.acertoRate>40?'#f59e0b':'#dc2626'};border-radius:99px"></div></div>`
            : '';
        tableRows += `<tr class="${cls}">
            <td>${q.questao}</td>
            <td>${fmtR(q.respA)}</td>
            <td>${fmtR(q.respB)}</td>
            <td style="color:#166534;font-weight:600">${q.correta !== null ? escapeHtml(String(q.correta).toUpperCase()) : '—'}</td>
            <td>${q.amboserram ? '<span class="ac-badge ac-badge-critico">erro coincidente</span>' : (q.igual ? '<span class="ac-badge ac-badge-alerta">idêntica</span>' : '')}</td>
            <td>${q.acertoRate != null ? q.acertoRate+'%'+acertoBar : '—'}</td>
        </tr>`;
    }

    return `
        <div class="ac-detalhe">
            <div class="ac-detalhe-title">Detalhamento questão a questão — ${escapeHtml(par.nomeA)} × ${escapeHtml(par.nomeB)}</div>

            <button class="ac-grid-toggle" id="${togId}"
                onclick="toggleGridAc('${togId}','${gridId}','${tableId}')">
                📋 Ver como tabela
            </button>

            <div id="${gridId}">${gridHtml}</div>
            <div id="${tableId}" style="display:none">
                <table class="ac-subtabela">
                    <thead><tr>
                        <th>Q</th><th>Aluno A</th><th>Aluno B</th>
                        <th>Gabarito</th><th>Status</th><th>% Acerto turma</th>
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>

            <div class="ac-flag-wrap">
                <div class="ac-flag-title">Decisão do professor</div>
                <div class="ac-flag-btns">
                    <button class="ac-btn ac-flag-btn ${btnInvCls}"
                        onclick="salvarFlag('${safeA}','${safeB}','investigar')">🔍 Investigar</button>
                    <button class="ac-btn ac-flag-btn ${btnResCls}"
                        onclick="salvarFlag('${safeA}','${safeB}','resolvido')">✅ Resolvido</button>
                </div>
                <div class="ac-flag-nota-wrap">
                    <textarea id="${notaId}" class="ac-flag-nota" rows="2"
                        placeholder="Anotação opcional (ex: conversa agendada, coincidência confirmada…)">${escapeHtml(currentNota)}</textarea>
                    <button class="ac-btn" onclick="salvarFlagNota('${safeA}','${safeB}','${notaId}')">Salvar nota</button>
                </div>
            </div>
        </div>
    `;
}

function _renderGrid(detalhes) {
    const cells = detalhes.map(q => {
        const cls = q.amboserram ? 'ac-cell-erro' : (q.igual ? 'ac-cell-correto' : 'ac-cell-diferente');
        const tip = q.amboserram
            ? `Q${q.questao}: Erro coincidente (ambos: ${String(q.respA||'').toUpperCase()}, gabarito: ${String(q.correta||'').toUpperCase()})`
            : q.igual
                ? `Q${q.questao}: Resposta idêntica e correta (${String(q.respA||'').toUpperCase()})`
                : `Q${q.questao}: Respostas diferentes (A:${String(q.respA||'—').toUpperCase()} / B:${String(q.respB||'—').toUpperCase()})`;
        return `<div class="ac-grid-cell ${cls}" title="${escapeHtml(tip)}">${q.questao}</div>`;
    }).join('');

    return `
        <div class="ac-grid-legenda">
            <span class="ac-grid-leg-item"><span class="ac-grid-leg-dot correto"></span>Acerto idêntico</span>
            <span class="ac-grid-leg-item"><span class="ac-grid-leg-dot erro"></span>Erro coincidente</span>
            <span class="ac-grid-leg-item"><span class="ac-grid-leg-dot diferente"></span>Diferente</span>
        </div>
        <div class="ac-grid">${cells}</div>
    `;
}

function toggleGridAc(togId, gridId, tableId) {
    const grid  = document.getElementById(gridId);
    const table = document.getElementById(tableId);
    const btn   = document.getElementById(togId);
    if (!grid || !table) return;
    const showGrid = grid.style.display === 'none';
    grid.style.display  = showGrid ? '' : 'none';
    table.style.display = showGrid ? 'none' : '';
    if (btn) btn.textContent = showGrid ? '📋 Ver como tabela' : '🎨 Ver como grade visual';
}

function _htmlEntreVariantes(suspeitos) {
    let rows = '';
    for (const s of suspeitos) {
        rows += `<tr>
            <td><strong>${escapeHtml(s.nomeA)}</strong><br><small>${escapeHtml(s.alunoA)}</small></td>
            <td style="text-align:center">.${escapeHtml(String(s.varianteA))}</td>
            <td><strong>${escapeHtml(s.nomeB)}</strong><br><small>${escapeHtml(s.alunoB)}</small></td>
            <td style="text-align:center">.${escapeHtml(String(s.varianteB))}</td>
            <td style="text-align:center">${s.posIguais} / ${s.totalComuns}</td>
            <td style="text-align:center">
                <span class="ac-badge ${s.posSimil >= 70 ? 'ac-badge-alerta' : ''}">${s.posSimil}%</span>
            </td>
        </tr>`;
    }
    return `
        <div class="ac-variantes-section" id="acVariantesSection">
            <div class="ac-variantes-header" onclick="toggleVariantesAc()" id="acVariantesHeader">
                ⚡ Suspeitos entre variantes diferentes
                <span class="ac-badge ac-badge-alerta" style="margin-left:4px">${suspeitos.length}</span>
                <span class="ac-variantes-arrow" id="acVariantesArrow">▼</span>
            </div>
            <div id="acVariantesBody" style="display:none" class="ac-variantes-body">
                <p style="font-size:13px;color:var(--text-muted,#666);margin:0 0 12px">
                    Estes alunos usaram <strong>variantes diferentes</strong> mas responderam as mesmas posições de forma suspeita.
                </p>
                <div style="overflow-x:auto">
                    <table class="ac-tabela">
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
            </div>
        </div>
    `;
}

function toggleVariantesAc() {
    const body   = document.getElementById('acVariantesBody');
    const arrow  = document.getElementById('acVariantesArrow');
    const header = document.getElementById('acVariantesHeader');
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    if (arrow) arrow.textContent = open ? '▲' : '▼';
    if (header) header.classList.toggle('aberta', open);
}

async function verHistoricoAluno(email, nome) {
    $('acHistTitulo').textContent = `Histórico de Cola — ${nome}`;
    $('acHistCorpo').innerHTML = '<div class="ac-loading">Carregando…</div>';
    $('acHistModal').style.display = 'block';
    try {
        const r = await fetch(`/api/classroom/provas/cola-historico/${encodeURIComponent(email)}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro.');
        const historico = Array.isArray(d.historico) ? d.historico : [];
        if (historico.length === 0) {
            $('acHistCorpo').innerHTML = '<p style="color:var(--text-muted,#888);text-align:center;padding:20px 0">Nenhuma ocorrência registrada em outras provas.</p>';
            return;
        }
        $('acHistCorpo').innerHTML = historico.map(h => `
            <div class="ac-hist-item">
                <div class="ac-hist-item-nome">📝 ${escapeHtml(h.provaNome || 'Prova #' + h.provaId)}</div>
                <div class="ac-hist-item-meta">
                    Com: <strong>${escapeHtml(h.outroAluno || h.emailOutro || '—')}</strong>
                    ${h.status ? ` &nbsp;·&nbsp; <span class="ac-badge ${h.status === 'resolvido' ? 'ac-badge-resolvido' : 'ac-badge-investigar'}">${h.status}</span>` : ''}
                    ${h.data ? ` &nbsp;·&nbsp; ${escapeHtml(new Date(h.data).toLocaleDateString('pt-BR'))}` : ''}
                </div>
            </div>
        `).join('');
    } catch (e) {
        $('acHistCorpo').innerHTML = `<p style="color:#dc2626">Erro: ${escapeHtml(e.message)}</p>`;
    }
}

function fecharHistoricoModal() {
    $('acHistModal').style.display = 'none';
}

async function exportarPdf() {
    if (!provaAtualId) return;
    const btn = document.getElementById('acExportPdfBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando PDF…'; }
    try {
        const r = await fetch(`/api/classroom/provas/${provaAtualId}/cola-pdf`, { credentials: 'include' });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.erro || 'Erro ao gerar PDF.');
        }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analise-gabarito-prova-${provaAtualId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        if (typeof notificar === 'function') await notificar('Erro ao gerar PDF', e.message, { tipo: 'danger' });
        else alert('Erro: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📄 Exportar PDF'; }
    }
}

async function exportarCsv() {
    if (!provaAtualId) return;
    const btn = document.getElementById('acExportCsvBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Exportando…'; }
    try {
        const r = await fetch(`/api/classroom/provas/${provaAtualId}/cola-flags/export`, { credentials: 'include' });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.erro || 'Erro ao exportar.');
        }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flags-cola-prova-${provaAtualId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        if (typeof notificar === 'function') await notificar('Erro ao exportar', e.message, { tipo: 'danger' });
        else alert('Erro: ' + e.message);
    } finally {
        const fc = Object.keys(_colaFlags).length;
        if (btn) { btn.disabled = false; btn.textContent = `⬇️ Flags CSV (${fc})`; }
    }
}

async function salvarFlag(alunoA, alunoB, status) {
    if (!provaAtualId) return;
    const notaId = `acFlagNota-${alunoA.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const notaEl = document.getElementById(notaId);
    const notaProfessor = notaEl ? notaEl.value.trim() : '';
    try {
        const r = await fetch(`/api/classroom/provas/${provaAtualId}/cola-flags`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alunoA, alunoB, status, notaProfessor }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        const [ea, eb] = [alunoA, alunoB].sort();
        _colaFlags[`${ea}|${eb}`] = { status, nota_professor: notaProfessor };
        if (_renderTabela) _renderTabela();
    } catch (e) {
        if (typeof notificar === 'function') await notificar('Erro ao salvar decisão', e.message, { tipo: 'danger' });
    }
}

async function salvarFlagNota(alunoA, alunoB, notaId) {
    if (!provaAtualId) return;
    const [ea, eb] = [alunoA, alunoB].sort();
    const existing  = _colaFlags[`${ea}|${eb}`];
    const status    = existing ? existing.status : 'investigar';
    const notaEl    = document.getElementById(notaId);
    const notaProfessor = notaEl ? notaEl.value.trim() : '';
    try {
        const r = await fetch(`/api/classroom/provas/${provaAtualId}/cola-flags`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alunoA, alunoB, status, notaProfessor }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        _colaFlags[`${ea}|${eb}`] = { status, nota_professor: notaProfessor };
        if (_renderTabela) _renderTabela();
        if (typeof toast === 'function') toast('Nota salva.', 'info');
    } catch (e) {
        if (typeof notificar === 'function') await notificar('Erro ao salvar nota', e.message, { tipo: 'danger' });
    }
}
