// ── Sync Status Footer — Shared Module ────────────────────────────────────────
// Provides a persistent footer chip showing how long ago data was synced and a
// "Refresh now" button that calls POST /api/sync/force.
//
// Requirements for the host page:
//   HTML  — a <footer class="status-footer"> containing:
//              <button class="footer-btn footer-sync-btn" id="footerSyncBtn"
//                      onclick="forcarSyncFooter()" title="Atualizar dados do RCO agora">
//                <span class="footer-sync-icon" id="footerSyncIcon">🕒</span>
//                <span id="footerSyncText">Verificando...</span>
//              </button>
//   CSS   — frontend/shared/css/layout.css (includes .footer-sync-btn styles)
//   JS    — call initSyncStatus() after the page loads

(function () {
    const _API = window.location.origin;

    let _idadeMin = null;
    let _ttlMin   = null;
    let _fresco   = null;
    let _proxMin  = null;
    let _ticker   = null;

    function _fmt(min) {
        if (min === null || min === undefined) return 'nunca sincronizado';
        if (min < 1)  return 'agora mesmo';
        if (min < 60) return `há ${min} min`;
        const h = Math.floor(min / 60), m = min % 60;
        return m > 0 ? `há ${h}h ${m}min` : `há ${h}h`;
    }

    function _atualizarTexto() {
        const btn  = document.getElementById('footerSyncBtn');
        const text = document.getElementById('footerSyncText');
        if (!btn || !text) return;

        if (_idadeMin === null) {
            text.textContent = 'Toque para atualizar';
            btn.classList.remove('fresh', 'stale', 'synced');
            btn.title = 'Atualizar dados do RCO agora';
            return;
        }

        text.textContent = _fmt(_idadeMin);
        btn.classList.remove('fresh', 'stale', 'synced');

        const fresco = _fresco !== null
            ? _fresco
            : (_ttlMin !== null ? _idadeMin < _ttlMin : _idadeMin < 240);
        btn.classList.add(fresco ? 'fresh' : 'stale');

        if (!fresco) {
            btn.title = 'Cache expirado — clique para atualizar agora';
        } else if (_proxMin !== null && _proxMin > 0) {
            btn.title = `Dados atuais · próxima atualização automática em ~${_proxMin} min`;
        } else {
            btn.title = 'Dados atuais · clique para forçar atualização';
        }
    }

    function _iniciarTicker() {
        if (_ticker) clearInterval(_ticker);
        _ticker = setInterval(() => {
            if (_idadeMin !== null) {
                _idadeMin++;
                if (_proxMin !== null && _proxMin > 0) _proxMin--;
                if (_fresco && _ttlMin !== null && _idadeMin >= _ttlMin) {
                    _fresco  = false;
                    _proxMin = 0;
                }
            }
            _atualizarTexto();
        }, 60_000);
    }

    async function carregarSyncStatus() {
        const icon = document.getElementById('footerSyncIcon');
        if (icon) icon.textContent = '🕒';
        try {
            const r = await fetch(`${_API}/api/sync/cache`);
            if (!r.ok) throw new Error('status ' + r.status);
            const d = await r.json();
            _idadeMin = d.idadeMin  ?? null;
            _ttlMin   = d.ttlMin    ?? null;
            _fresco   = d.fresco    ?? null;
            _proxMin  = d.proxSyncMin ?? null;
        } catch {
            _idadeMin = null;
            _ttlMin   = null;
            _fresco   = null;
            _proxMin  = null;
        }
        _atualizarTexto();
        _iniciarTicker();
    }

    async function forcarSyncFooter() {
        const btn  = document.getElementById('footerSyncBtn');
        const icon = document.getElementById('footerSyncIcon');
        const text = document.getElementById('footerSyncText');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        btn.classList.remove('fresh', 'stale', 'synced');
        btn.classList.add('spinning');
        if (icon) icon.textContent = '🔄';
        if (text) text.textContent = 'Atualizando...';

        try {
            const r = await fetch(`${_API}/api/sync/force`, { method: 'POST' });
            if (!r.ok) throw new Error('status ' + r.status);
            _idadeMin = 0;
            _fresco   = true;
            btn.classList.remove('spinning');
            btn.classList.add('synced');
            if (icon) icon.textContent = '✓';
            if (text) text.textContent = 'agora mesmo';

            _iniciarTicker();

            setTimeout(() => {
                btn.disabled = false;
                btn.classList.remove('synced');
                btn.classList.add('fresh');
                if (icon) icon.textContent = '🕒';
                _atualizarTexto();
            }, 4000);
        } catch {
            btn.classList.remove('spinning');
            if (icon) icon.textContent = '❌';
            if (text) text.textContent = 'Erro ao atualizar';
            setTimeout(() => {
                btn.disabled = false;
                if (icon) icon.textContent = '🕒';
                _atualizarTexto();
            }, 3000);
        }
    }

    function initSyncStatus() {
        carregarSyncStatus();
    }

    window.carregarSyncStatus  = carregarSyncStatus;
    window.forcarSyncFooter    = forcarSyncFooter;
    window.initSyncStatus      = initSyncStatus;
})();
