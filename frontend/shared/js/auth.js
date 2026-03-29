/**
 * EduSync Auth Guard
 * — Verifica autenticação em todas as páginas (exceto /login/)
 * — Aplica visibilidade do menu com base no perfil efetivo
 * — Injeta nome do usuário e botão de logout funcional
 * — Exibe banner laranja em modo impersonação com botão de saída
 * — Expõe window.__edusync.user para uso nas páginas
 */
(async function () {
    'use strict';

    const LOGIN_PATH = '/login/';
    const DASH_PATH  = '/pages/dashboard/';

    /* ── Mapa de href → módulo ── */
    const MODULO_URLS = {
        '/pages/dashboard/':     'dashboard',
        '/pages/frequencias/':   'frequencias',
        '/pages/comunicados/':   'comunicados',
        '/pages/crachas/':       'crachas',
        '/pages/circulacao/':    'circulacao',
        '/pages/comportamento/': 'comportamento',
        '/pages/presenca/':      'presenca',
        '/pages/atividades/':    'atividades',
        '/pages/classroom/':     'classroom',
        '/pages/grupos/':        'grupos',
        '/pages/mapa-sala/':     'mapa-sala',
        '/pages/pedagogico/':    'pedagogico',
        '/pages/materiais/':     'materiais',
        '/pages/emprestimos/':   'emprestimos',
        '/pages/cozinha/':       'cozinha',
        '/pages/admin/':         'admin',
    };

    /* ── Permissões por perfil ── */
    const PERFIL_MODULOS = {
        admin:      ['*'],
        professor:  ['dashboard','frequencias','atividades','classroom','comportamento','grupos','mapa-sala','pedagogico'],
        pedagogo:   ['dashboard','comportamento','pedagogico','frequencias','comunicados'],
        secretaria: ['dashboard','crachas','emprestimos','materiais','comunicados','circulacao'],
        aux_turno:  ['circulacao','presenca'],
        cozinha:    ['cozinha'],
    };

    function podeAcessar(perfil, modulo) {
        const lista = PERFIL_MODULOS[perfil] || [];
        return lista.includes('*') || lista.includes(modulo);
    }

    /* ── Verificar autenticação ── */
    let user = null;
    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (res.ok) user = await res.json();
    } catch { /* sem conexão */ }

    if (!user) {
        window.location.replace(LOGIN_PATH + '?next=' + encodeURIComponent(location.pathname));
        return;
    }

    /* ── Expor usuário globalmente ── */
    window.__edusync = { user };

    /* ── Verificar acesso à página atual (usa perfil efetivo) ── */
    const paginaAtual = MODULO_URLS[location.pathname] || null;
    if (paginaAtual && !podeAcessar(user.perfil, paginaAtual)) {
        window.location.replace(DASH_PATH);
        return;
    }

    function onDomReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    onDomReady(() => {
        aplicarPermissoesNav(user);
        injetarUsuarioHeader(user);
        configurarLogout();
        injetarLinkAdmin(user);
        if (user.impersonando) injetarBannerImpersonacao(user);
    });

    function aplicarPermissoesNav(user) {
        document.querySelectorAll('.nav-menu a, .side-panel a').forEach(link => {
            const href   = link.getAttribute('href');
            const modulo = MODULO_URLS[href];
            if (modulo && !podeAcessar(user.perfil, modulo)) {
                link.style.display = 'none';
            }
        });
    }

    function injetarUsuarioHeader(user) {
        const headerActions = document.querySelector('.header-actions');
        if (!headerActions) return;

        const toTitleCase = s => s
            .toLowerCase()
            .replace(/(?:^|\s)\S/g, c => c.toUpperCase());

        const primeiroNome = toTitleCase(user.nome?.split(' ')[0] || 'Usuário');
        const nomeCompleto = toTitleCase(user.nome || 'Usuário');

        const badge = document.createElement('span');
        badge.className   = 'user-badge';
        badge.title       = `${nomeCompleto} · Perfil: ${user.impersonando ? user.impersonandoPerfil : user.perfil}`;
        badge.textContent = user.impersonando
            ? `👁 Visualizando como ${user.impersonandoNome}`
            : `👤 ${primeiroNome}`;
        if (user.impersonando) badge.style.cssText = 'background:#92400e;color:#fef3c7;border-color:#b45309';
        headerActions.insertBefore(badge, headerActions.firstChild);
    }

    function configurarLogout() {
        document.querySelectorAll('#btnLogout, [data-action="logout"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled    = true;
                btn.textContent = 'Saindo…';
                try {
                    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                } finally {
                    window.location.replace(LOGIN_PATH);
                }
            });
        });
    }

    function injetarLinkAdmin(user) {
        // Mostra link Admin apenas se o perfil REAL for admin
        if (user.perfilReal !== 'admin' && user.perfil !== 'admin') return;
        if (user.impersonando) return; // oculta durante impersonação
        const nav = document.querySelector('.nav-menu');
        if (!nav) return;
        if (nav.querySelector('a[href="/pages/admin/"]')) return;

        const link = document.createElement('a');
        link.href        = '/pages/admin/';
        link.textContent = '⚙ Admin';
        if (location.pathname === '/pages/admin/') link.classList.add('active');
        nav.appendChild(link);
    }

    /* ── Banner de impersonação ── */
    function injetarBannerImpersonacao(user) {
        const banner = document.createElement('div');
        banner.id = 'impersonacao-banner';
        banner.innerHTML = `
            <span>👁 Você está visualizando o sistema como <strong>${user.impersonandoNome}</strong></span>
            <button id="btnSairImpersonacao">✕ Sair da visualização</button>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #impersonacao-banner {
                position: fixed;
                bottom: 0; left: 0; right: 0;
                z-index: 9999;
                background: #92400e;
                color: #fef3c7;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
                padding: 10px 20px;
                font-size: .875rem;
                font-family: 'Segoe UI', Arial, sans-serif;
                box-shadow: 0 -2px 8px rgba(0,0,0,.25);
            }
            #impersonacao-banner strong { color: #fde68a; }
            #btnSairImpersonacao {
                background: #fef3c7;
                color: #92400e;
                border: none;
                border-radius: 6px;
                padding: 5px 14px;
                font-size: .8rem;
                font-weight: 700;
                cursor: pointer;
                transition: background .15s;
            }
            #btnSairImpersonacao:hover { background: #fde68a; }
            body { padding-bottom: 48px !important; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(banner);

        document.getElementById('btnSairImpersonacao').addEventListener('click', async () => {
            try {
                await fetch('/api/admin/impersonar/sair', { method: 'POST', credentials: 'include' });
                window.location.replace('/pages/admin/');
            } catch {
                window.location.reload();
            }
        });
    }
})();
