'use strict';
/* ── Shared Custom Select Helper ──────────────────────────────────────────────
   Replaces a native <select> with a themed, keyboard-accessible dropdown that
   respects light/dark themes and matches the EduSync design system.

   Usage:
     createCustomSelect(selectElement [, { compact: false }])
     refreshCustomSelect(selectElement)   // force sync after programmatic .value change

   The native <select> stays in the DOM (hidden) so all existing .value reads,
   form submissions and onchange= callbacks continue to work unchanged.
   ──────────────────────────────────────────────────────────────────────────── */

const _cselMap = new WeakMap();

function createCustomSelect(selectEl, { compact = false } = {}) {
    if (_cselMap.has(selectEl)) return;

    selectEl.style.cssText += ';position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden;';

    const wrap = document.createElement('div');
    wrap.className = 'csel' + (compact ? ' csel--compact' : '');

    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'csel-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valSpan = document.createElement('span');
    valSpan.className = 'csel-value';
    const arrow = document.createElement('span');
    arrow.className = 'csel-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▾';
    trigger.appendChild(valSpan);
    trigger.appendChild(arrow);
    wrap.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'csel-panel';
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
            item.className = 'csel-option'
                + (o.disabled ? ' csel-option--disabled' : '')
                + (selected   ? ' csel-option--selected'  : '');
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
        panel.querySelectorAll('.csel-option--focused').forEach(el => el.classList.remove('csel-option--focused'));
        if (item) { item.classList.add('csel-option--focused'); item.scrollIntoView({ block: 'nearest' }); }
    }

    function open() {
        buildPanel();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        wrap.classList.add('csel--open');
        const sel = panel.querySelector('.csel-option--selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function close() {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        wrap.classList.remove('csel--open');
        syncDisplay();
    }

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        wrap.classList.contains('csel--open') ? close() : open();
    });

    trigger.addEventListener('keydown', e => {
        const active = () => [...panel.querySelectorAll('.csel-option:not(.csel-option--disabled)')];
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (wrap.classList.contains('csel--open')) {
                const f = panel.querySelector('.csel-option--focused');
                if (f) f.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                else close();
            } else { open(); }
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!wrap.classList.contains('csel--open')) { open(); return; }
            const items = active();
            const cur = panel.querySelector('.csel-option--focused') || panel.querySelector('.csel-option--selected');
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
        if (!panel.hidden) buildPanel();
    });
    obs.observe(selectEl, { childList: true, subtree: true, characterData: true });

    selectEl.addEventListener('change', syncDisplay);

    syncDisplay();
    _cselMap.set(selectEl, { wrap, trigger, panel, obs, syncDisplay });
}

function refreshCustomSelect(selectEl) {
    const entry = _cselMap.get(selectEl);
    if (entry) entry.syncDisplay();
}

window.createCustomSelect  = createCustomSelect;
window.refreshCustomSelect = refreshCustomSelect;
