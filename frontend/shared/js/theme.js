// ── EduGest Theme System ─────────────────────────────────────────────────────
// Aplica o tema ANTES do render para evitar flash.
// Inclua este script como o PRIMEIRO script no <head> (sem defer/async).

(function () {
    const STORAGE_KEY = 'edugest_theme';
    const DARK = 'dark';
    const LIGHT = 'light';

    function temaAtual() {
        return localStorage.getItem(STORAGE_KEY) || LIGHT;
    }

    function aplicarTema(tema) {
        document.documentElement.setAttribute('data-theme', tema);
        localStorage.setItem(STORAGE_KEY, tema);
        atualizarBotoes(tema);
    }

    function atualizarBotoes(tema) {
        document.querySelectorAll('.btn-theme').forEach(btn => {
            btn.textContent = tema === DARK ? '☀️' : '🌙';
            btn.title = tema === DARK ? 'Mudar para tema claro' : 'Mudar para tema escuro';
        });
    }

    // Aplica imediatamente (antes de qualquer render)
    aplicarTema(temaAtual());

    // Toggle público
    window.toggleTheme = function () {
        const novo = temaAtual() === DARK ? LIGHT : DARK;
        // Efeito de rotação
        document.querySelectorAll('.btn-theme').forEach(btn => {
            btn.classList.add('animating');
            setTimeout(() => btn.classList.remove('animating'), 300);
        });
        aplicarTema(novo);
    };

    // Ao carregar o DOM, garante que os botões estejam corretos + scroll-hide header
    document.addEventListener('DOMContentLoaded', () => {
        atualizarBotoes(temaAtual());

        // ── Esconde o header suavemente ao rolar para baixo ───────────────────
        const header = document.querySelector('.header');
        if (header) {
            let lastScroll = 0;
            let ticking = false;
            const LIMIAR = 60; // px mínimos antes de esconder

            window.addEventListener('scroll', () => {
                if (ticking) return;
                ticking = true;
                requestAnimationFrame(() => {
                    const cur = window.scrollY;
                    if (cur > lastScroll && cur > LIMIAR) {
                        header.classList.add('header--hidden');
                    } else {
                        header.classList.remove('header--hidden');
                    }
                    lastScroll = cur <= 0 ? 0 : cur;
                    ticking = false;
                });
            }, { passive: true });
        }
    });
})();

/* ── Side panel compartilhado (usado por todas as páginas) ──────────────── */
window.abrirSidePanel  = function () { document.body.setAttribute('data-side', 'open'); };
window.fecharSidePanel = function () { document.body.removeAttribute('data-side'); };

/* ── Submenu Classroom — flyout à direita no hover (admin only) ─────────── */
document.addEventListener('DOMContentLoaded', function () {
    var perfil = '';
    try {
        var cache = JSON.parse(localStorage.getItem('edusync_nav_cache') || 'null');
        perfil = (cache && cache.perfil) || '';
    } catch (e) {}

    var isAdmin = (perfil === 'admin');

    document.querySelectorAll('.side-nav-group').forEach(function (group) {
        var flyout = group.querySelector('.side-nav-sub-static');
        if (!flyout) return;

        if (!flyout.querySelector('.side-nav-sub-label')) {
            var lbl = document.createElement('div');
            lbl.className   = 'side-nav-sub-label';
            lbl.textContent = 'Classroom';
            flyout.insertBefore(lbl, flyout.firstChild);
        }

        if (!isAdmin) return;

        document.body.appendChild(flyout);

        flyout.querySelectorAll('[data-admin-only]').forEach(function (el) {
            el.removeAttribute('data-perm-hidden');
            el.style.display = '';
        });

        var parentItem = group.querySelector('.side-nav-item');
        if (parentItem && !parentItem.querySelector('.side-nav-chevron-hint')) {
            var hint = document.createElement('span');
            hint.className   = 'side-nav-chevron-hint';
            hint.textContent = '›';
            parentItem.appendChild(hint);
        }

        var hideTimer = null;

        function openFlyout() {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            flyout.classList.add('flyout-open');

            flyout.querySelectorAll('.side-nav-sub-item').forEach(function (item) {
                item.style.display = 'flex';
                item.style.visibility = 'visible';
                item.style.opacity = '1';
                item.style.height = 'auto';
                item.style.overflow = 'visible';
                item.removeAttribute('data-perm-hidden');
            });

            var labelEl = flyout.querySelector('.side-nav-sub-label');
            if (labelEl) {
                labelEl.style.display = 'block';
                labelEl.style.visibility = 'visible';
            }

            flyout.style.height = 'auto';
            flyout.style.overflow = 'visible';

            requestAnimationFrame(function () {
                var rect = group.getBoundingClientRect();
                var fh   = flyout.scrollHeight || 200;
                var fw   = flyout.offsetWidth  || 240;
                var vw   = window.innerWidth;
                var vh   = window.innerHeight;

                var left = rect.right + 4;
                if (left + fw > vw - 4) left = rect.left - fw - 4;
                if (left < 4) left = 4;

                var top = rect.bottom - fh;
                if (top < 8) top = 8;
                if (top + fh > vh - 8) top = vh - fh - 8;
                if (top < 8) top = 8;

                flyout.style.top  = top + 'px';
                flyout.style.left = left + 'px';
            });
        }

        function closeFlyout() {
            flyout.classList.remove('flyout-open');
            hideTimer = null;
        }

        function scheduleClose() {
            hideTimer = setTimeout(closeFlyout, 180);
        }

        function cancelClose() {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        }

        group.addEventListener('mouseenter', openFlyout);
        group.addEventListener('mouseleave', scheduleClose);
        flyout.addEventListener('mouseenter', cancelClose);
        flyout.addEventListener('mouseleave', scheduleClose);

        parentItem.addEventListener('click', function (e) {
            e.preventDefault();
            if (flyout.classList.contains('flyout-open')) {
                closeFlyout();
            } else {
                openFlyout();
            }
        });

        document.addEventListener('click', function (e) {
            if (!flyout.classList.contains('flyout-open')) return;
            if (e.target.closest && (e.target.closest('.side-nav-sub-static') || e.target.closest('.side-nav-group'))) return;
            closeFlyout();
        });
    });
});

/* ── Pré-carrega CSS de nav/perfil e guard de autenticação (exceto páginas públicas) ── */
(function () {
    const paginasPublicas = ['/login', '/termos', '/privacidade'];
    if (paginasPublicas.some(p => location.pathname.startsWith(p)) || location.pathname === '/') return;

    /* ── ANTI-FLASH: oculta todos os itens de nav antes da primeira pintura.
       Este <style> é injetado sincronicamente no <head> enquanto o browser
       ainda está a analisar o HTML, garantindo que se aplica antes de qualquer render.
       Os itens ficam invisíveis (mas mantêm espaço no layout) até que auth.js
       defina data-perms-ready após aplicar as permissões do perfil.          ── */
    const styleAntiFlash = document.createElement('style');
    styleAntiFlash.id = 'anti-flash-nav';
    styleAntiFlash.textContent =
        '.nav-menu:not([data-perms-ready]) a,' +
        '.side-panel:not([data-perms-ready]) a {' +
        '  visibility: hidden !important;' +
        '}';
    document.head.appendChild(styleAntiFlash);

    /* CSS de nav e perfil — carrega junto com o resto para evitar flash */
    const cssLink = document.createElement('link');
    cssLink.rel   = 'stylesheet';
    cssLink.href  = '/shared/css/nav-profile.css';
    document.head.appendChild(cssLink);

    const s  = document.createElement('script');
    s.src    = '/shared/js/auth.js';
    s.async  = false;
    document.head.appendChild(s);
}());
