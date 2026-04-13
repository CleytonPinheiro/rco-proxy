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

/* ── (Submenu Classroom removido — itens agora são links diretos no sidebar) ── */

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
