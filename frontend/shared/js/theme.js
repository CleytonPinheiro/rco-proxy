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

/* ── Submenu Classroom — flyout à direita no click (admin only) ─────────── */
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

        if (!isAdmin) { flyout.remove(); return; }

        if (!flyout.querySelector('.side-nav-sub-label')) {
            var lbl = document.createElement('div');
            lbl.className   = 'side-nav-sub-label';
            lbl.textContent = 'Classroom';
            flyout.insertBefore(lbl, flyout.firstChild);
        }

        document.body.appendChild(flyout);
        flyout.style.display = 'block';

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

        var flyoutOpen = false;

        function positionFlyout() {
            var rect = group.getBoundingClientRect();
            var panel = group.closest('.side-panel');
            var panelRight = panel ? panel.getBoundingClientRect().right : rect.right;
            var fw = flyout.offsetWidth  || 240;
            var fh = flyout.offsetHeight || 200;
            var vw = window.innerWidth;
            var vh = window.innerHeight;

            var left = panelRight + 4;
            if (left + fw > vw - 4) left = vw - fw - 4;
            if (left < 4) left = 4;

            var top = rect.top;
            if (top + fh > vh - 8) top = vh - fh - 8;
            if (top < 8) top = 8;

            flyout.style.top  = top + 'px';
            flyout.style.left = left + 'px';
        }

        function toggleFlyout(e) {
            if (e) e.preventDefault();
            flyoutOpen = !flyoutOpen;
            if (flyoutOpen) {
                positionFlyout();
                flyout.classList.add('flyout-open');
            } else {
                flyout.classList.remove('flyout-open');
            }
        }

        function closeFlyout() {
            flyoutOpen = false;
            flyout.classList.remove('flyout-open');
        }

        parentItem.addEventListener('click', toggleFlyout);

        document.addEventListener('click', function (e) {
            if (!flyoutOpen) return;
            if (e.target.closest && (e.target.closest('.side-nav-sub-static') || e.target === parentItem || parentItem.contains(e.target))) return;
            closeFlyout();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeFlyout();
        });

        flyout.querySelectorAll('a').forEach(function (a) {
            a.addEventListener('click', function () {
                setTimeout(closeFlyout, 100);
            });
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
