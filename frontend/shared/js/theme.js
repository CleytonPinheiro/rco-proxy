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

/* ── Submenu Classroom — flyout lateral criado via JS ──────────────────── */
document.addEventListener('DOMContentLoaded', function () {
    var group = document.getElementById('classroomNavGroup');
    if (!group) return;

    var parentLink = document.getElementById('classroomParentLink');
    if (!parentLink) return;

    var arrow = document.createElement('span');
    arrow.className = 'side-nav-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>';
    parentLink.appendChild(arrow);

    var flyout = document.createElement('div');
    flyout.className = 'classroom-flyout';
    flyout.innerHTML =
        '<div class="classroom-flyout-label">Classroom</div>' +
        '<a href="/pages/portal-aluno/" class="classroom-flyout-item">' +
            '<span>👤</span> Portal do Aluno</a>' +
        '<a href="/pages/solicitacoes/" class="classroom-flyout-item" id="sideNavSolicita">' +
            '<span>↩</span> Solicitações' +
            '<span class="side-nav-solicita-badge" id="sideNavSolitaBadge" style="display:none">0</span></a>' +
        '<a href="/pages/portal-log/" class="classroom-flyout-item" id="sideNavPortalLog">' +
            '<span>🎓</span> Log Portal Aluno</a>';
    document.body.appendChild(flyout);

    var isOpen = false;
    var hideTimer = null;

    function positionFlyout() {
        var sidePanel = document.getElementById('sidePanel');
        var spRect = sidePanel ? sidePanel.getBoundingClientRect() : { right: 300, left: 0 };
        var rect = group.getBoundingClientRect();
        var fh   = flyout.offsetHeight || 180;
        var fw   = flyout.offsetWidth  || 220;
        var vw   = window.innerWidth;
        var vh   = window.innerHeight;

        var left = spRect.right + 6;
        if (left + fw > vw - 8) left = spRect.left - fw - 6;
        if (left < 4) left = 4;

        var top = rect.top;
        if (top + fh > vh - 8) top = vh - fh - 8;
        if (top < 8) top = 8;

        flyout.style.top  = top + 'px';
        flyout.style.left = left + 'px';
    }

    function openFlyout() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (isOpen) return;
        isOpen = true;
        flyout.classList.add('flyout-visible');
        positionFlyout();
    }

    function closeFlyout() {
        isOpen = false;
        flyout.classList.remove('flyout-visible');
        hideTimer = null;
    }

    function scheduleClose() {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(closeFlyout, 200);
    }

    function cancelClose() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    parentLink.addEventListener('click', function (e) {
        e.preventDefault();
        if (isOpen) { closeFlyout(); } else { openFlyout(); }
    });

    group.addEventListener('mouseenter', openFlyout);
    group.addEventListener('mouseleave', scheduleClose);
    flyout.addEventListener('mouseenter', cancelClose);
    flyout.addEventListener('mouseleave', scheduleClose);

    document.addEventListener('click', function (e) {
        if (!isOpen) return;
        if (e.target.closest && (e.target.closest('.classroom-flyout') || e.target.closest('#classroomNavGroup'))) return;
        closeFlyout();
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
