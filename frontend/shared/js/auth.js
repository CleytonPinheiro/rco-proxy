/**
 * EduSync Auth Guard
 * — Verifica autenticação em todas as páginas (exceto /login/)
 * — Aplica visibilidade do menu com base no perfil
 * — Injeta nome do usuário e botão de logout funcional
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
        if (res.ok) {
            user = await res.json();
        }
    } catch { /* sem conexão */ }

    if (!user) {
        window.location.replace(LOGIN_PATH + '?next=' + encodeURIComponent(location.pathname));
        return;
    }

    /* ── Expor usuário globalmente ── */
    window.__edusync = { user };

    /* ── Verificar acesso à página atual ── */
    const paginaAtual = MODULO_URLS[location.pathname] || null;
    if (paginaAtual && !podeAcessar(user.perfil, paginaAtual)) {
        window.location.replace(DASH_PATH);
        return;
    }

    /* ── Aplicar visibilidade do menu após DOM carregado ── */
    // auth.js é carregado dinamicamente: DOMContentLoaded pode já ter disparado
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

        // Converte MAIÚSCULAS do RCO para título: "CLEYTON" → "Cleyton"
        const toTitleCase = s => s
            .toLowerCase()
            .replace(/(?:^|\s)\S/g, c => c.toUpperCase());

        const primeiroNome = toTitleCase(user.nome?.split(' ')[0] || 'Usuário');
        const nomeCompleto = toTitleCase(user.nome || 'Usuário');

        const badge = document.createElement('span');
        badge.className   = 'user-badge';
        badge.title       = `${nomeCompleto} · Perfil: ${user.perfil}`;
        badge.textContent = `👤 ${primeiroNome}`;
        headerActions.insertBefore(badge, headerActions.firstChild);
    }

    function configurarLogout() {
        document.querySelectorAll('#btnLogout, [data-action="logout"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled    = true;
                btn.textContent = 'Saindo…';
                try {
                    await fetch('/api/auth/logout', {
                        method:      'POST',
                        credentials: 'include',
                    });
                } finally {
                    window.location.replace(LOGIN_PATH);
                }
            });
        });
    }

    function injetarLinkAdmin(user) {
        if (user.perfil !== 'admin') return;
        const nav = document.querySelector('.nav-menu');
        if (!nav) return;

        // Evita duplicar se já existe
        if (nav.querySelector('a[href="/pages/admin/"]')) return;

        const link = document.createElement('a');
        link.href        = '/pages/admin/';
        link.textContent = '⚙ Admin';
        if (location.pathname === '/pages/admin/') link.classList.add('active');
        nav.appendChild(link);
    }
})();
