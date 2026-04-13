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
/*
 * NOTA: position:fixed dentro de um elemento com transform (side-panel usa
 * translateX para o slide) fica preso ao pai transformado, não ao viewport.
 * Solução: mover o flyout para document.body em tempo de execução.
 */
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

        /* Injeta rótulo no topo do flyout (só uma vez) */
        if (!flyout.querySelector('.side-nav-sub-label')) {
            var lbl = document.createElement('div');
            lbl.className   = 'side-nav-sub-label';
            lbl.textContent = 'Classroom';
            flyout.insertBefore(lbl, flyout.firstChild);
        }

        if (!isAdmin) return;

        /*
         * Move o flyout para <body> — escapa do transform do .side-panel.
         * position:fixed passa a ser relativo ao viewport, como esperado.
         */
        document.body.appendChild(flyout);
        flyout.style.display = 'block';

        /* Exibe links admin-only dentro do flyout (ex: Log Portal Aluno) */
        flyout.querySelectorAll('[data-admin-only]').forEach(function (el) {
            el.style.display = '';
        });

        /* Injeta indicador › no item pai */
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
            /* getBoundingClientRect() retorna coordenadas de viewport —
               funciona corretamente mesmo com o transform do painel */
            var rect    = group.getBoundingClientRect();
            var fw      = 230;
            var gap     = 10;
            var left    = rect.right + gap;
            if (left + fw > window.innerWidth) left = rect.left - fw - gap;
            flyout.style.top  = Math.max(8, rect.top) + 'px';
            flyout.style.left = left + 'px';
            flyout.classList.add('flyout-open');
        }

        function closeFlyout() {
            flyout.classList.remove('flyout-open');
            hideTimer = null;
        }

        function scheduleClose() {
            hideTimer = setTimeout(closeFlyout, 140);
        }

        function cancelClose() {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        }

        group.addEventListener('mouseenter', openFlyout);
        group.addEventListener('mouseleave', scheduleClose);
        flyout.addEventListener('mouseenter', cancelClose);
        flyout.addEventListener('mouseleave', scheduleClose);

        /* Fecha ao fechar o painel lateral */
        document.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.side-close-btn')) closeFlyout();
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
