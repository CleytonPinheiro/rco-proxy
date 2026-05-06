/**
 * EduSync Auth Guard + Nav Adaptativo + Painel de Perfil
 *
 * — Verifica autenticação (exceto /login/)
 * — Aplica permissões de menu pelo perfil efetivo
 * — Nav adaptativo: itens no topo; overflow → side panel
 * — Botão de logout com ícone
 * — Painel de perfil (canto inferior): avatar, nome, tema, logout
 * — Banner de impersonação
 * — Expõe window.__edusync.user
 */
(async function () {
    'use strict';

    const LOGIN_PATH = '/login/';
    const DASH_PATH  = '/pages/dashboard/';

    /* ── Mapeamento URL → módulo (ordem importa: define prioridade de redirecionamento) ── */
    const MODULO_URLS = {
        '/pages/dashboard/':              'dashboard',
        '/pages/frequencias/':            'frequencias',
        '/pages/comunicados/':            'comunicados',
        '/pages/crachas/':                'crachas',
        '/pages/circulacao/':             'circulacao',
        '/pages/comportamento/':          'comportamento',
        '/pages/presenca/':               'presenca',
        '/pages/atividades/':             'atividades',
        '/pages/classroom/':              'classroom',
        '/pages/grupos/':                 'grupos',
        '/pages/mapa-sala/':              'mapa-sala',
        '/pages/pedagogico/':             'pedagogico',
        '/pages/retorno-pedagogico/':     'retorno-pedagogico',
        '/pages/provas/':                 'provas',
        '/pages/materiais/':              'materiais',
        '/pages/emprestimos/':            'emprestimos',
        '/pages/cozinha/':                'cozinha',
        '/pages/admin/':                  'admin',
        '/pages/portal-aluno/':           'portal-aluno',
        '/pages/planos/':                 'planos',
        '/pages/suporte/':               'suporte',
    };

    /* ── Permissões por perfil — espelho exato de backend/src/config/permissions.js ── */
    const PERFIL_MODULOS = {
        admin:      ['*'],
        professor:  ['dashboard','frequencias','atividades','classroom','comportamento','grupos','mapa-sala','pedagogico','retorno-pedagogico','provas','suporte'],
        pedagogo:   ['dashboard','comportamento','pedagogico','retorno-pedagogico','frequencias','comunicados','mapa-sala','suporte'],
        secretaria: ['dashboard','crachas','emprestimos','materiais','comunicados','circulacao','suporte'],
        aux_turno:  ['circulacao','presenca','suporte'],
        cozinha:    ['cozinha','suporte'],
    };

    const PERFIL_LABEL = {
        admin:      'Administrador',
        professor:  'Professor',
        pedagogo:   'Pedagogo',
        secretaria: 'Secretaria',
        aux_turno:  'Aux. de Turno',
        cozinha:    'Cozinha',
    };

    function podeAcessar(perfil, modulo) {
        const lista = PERFIL_MODULOS[perfil] || [];
        return lista.includes('*') || lista.includes(modulo);
    }

    /** Retorna a primeira URL acessível para o perfil (evita loop de redirecionamento) */
    function primeiraUrlPermitida(perfil) {
        for (const [url, modulo] of Object.entries(MODULO_URLS)) {
            if (podeAcessar(perfil, modulo)) return url;
        }
        return LOGIN_PATH;
    }

    /* ── Cache de perfil no localStorage (evita flash de menus proibidos) ── */
    const NAV_CACHE_KEY = 'edusync_nav_cache';

    function salvarCacheNav(u) {
        try {
            localStorage.setItem(NAV_CACHE_KEY, JSON.stringify({
                perfil:             u.perfil,
                impersonando:       u.impersonando       || false,
                impersonandoPerfil: u.impersonandoPerfil || null,
            }));
        } catch {}
    }

    function limparCacheNav() {
        try { localStorage.removeItem(NAV_CACHE_KEY); } catch {}
    }

    /* Revela os menus após aplicar permissões (remove o anti-flash do theme.js) */
    function marcarNavPronto() {
        document.querySelector('.nav-menu')  ?.setAttribute('data-perms-ready', 'true');
        document.querySelector('.side-panel')?.setAttribute('data-perms-ready', 'true');
    }

    /* Mensagem de bloqueio mostrada quando o usuário clica em um menu desabilitado */
    function mostrarToastBloqueio(perfilLabel, modulo) {
        let toast = document.querySelector('.perm-block-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'perm-block-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = `🔒 "${modulo}" está em implementação para o perfil ${perfilLabel}.`;
        toast.classList.add('show');
        clearTimeout(toast._tid);
        toast._tid = setTimeout(() => toast.classList.remove('show'), 2800);
    }

    /* Marca um link como bloqueado (visível, porém desabilitado) e instala o handler */
    function marcarBloqueado(link, perfil) {
        link.setAttribute('data-perm-blocked', 'true');
        link.setAttribute('aria-disabled', 'true');
        const nome = (link.querySelector('.side-nav-nome')?.textContent || link.textContent || '').trim();
        const perfilLabel = PERFIL_LABEL[perfil] || perfil;
        link.setAttribute('title', `Acesso restrito — em implementação para o perfil ${perfilLabel}.`);
        if (!link._permHandler) {
            link._permHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                mostrarToastBloqueio(perfilLabel, nome);
            };
            link.addEventListener('click', link._permHandler, true);
        }
        /* Garante visibilidade caso uma camada anterior tenha escondido */
        link.style.display = '';
        link.removeAttribute('data-perm-hidden');
    }

    /* Aplica permissões imediatamente da cache — sem esperar o fetch.
       Com o <style> anti-flash do theme.js, os menus ficam invisíveis até aqui.
       Após este IIFE, os itens permitidos ficam totalmente visíveis e os bloqueados
       aparecem desabilitados (pointer-events: not-allowed + cadeado).
       Se não há cache (primeiro login), menus ficam invisíveis até o fetch. */
    (function aplicarCacheImediato() {
        try {
            const cached = JSON.parse(localStorage.getItem(NAV_CACHE_KEY) || 'null');
            if (!cached) return; // sem cache: permanece invisível até fetch + aplicarPermissoesNav

            const p = cached.impersonando ? cached.impersonandoPerfil : cached.perfil;
            document.querySelectorAll('.nav-menu a, .side-panel a').forEach(link => {
                if (link.classList.contains('side-nav-child-item')) return;
                const modulo = MODULO_URLS[link.getAttribute('href')];
                if (!modulo) return;
                if (!podeAcessar(p, modulo)) {
                    marcarBloqueado(link, p);
                }
            });

            /* Revela menus apenas dentro do try — só depois de aplicar permissões com sucesso */
            marcarNavPronto();
        } catch {
            /* Erro de localStorage ou parse: mantém invisível, fetch assumirá o controle */
        }
    })();

    /* ── Verificar autenticação (confirma sessão no servidor) ── */
    let user = null;
    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (res.ok) user = await res.json();
    } catch { /* sem conexão */ }

    if (!user) {
        limparCacheNav();
        window.location.replace(LOGIN_PATH + '?next=' + encodeURIComponent(location.pathname));
        return;
    }

    /* Atualiza cache com dados frescos do servidor */
    salvarCacheNav(user);

    window.__edusync = { user };

    /* Perfil efetivo: ao impersonar, usa o perfil do alvo */
    const perfilEfetivo = user.impersonando ? user.impersonandoPerfil : user.perfil;

    /* Bloqueia acesso a páginas não permitidas e redireciona para a primeira URL acessível */
    const paginaAtual = MODULO_URLS[location.pathname] || null;
    if (paginaAtual && !podeAcessar(perfilEfetivo, paginaAtual)) {
        window.location.replace(primeiraUrlPermitida(perfilEfetivo));
        return;
    }

    /* ── Helpers ── */
    function toTitleCase(s) {
        return (s || '').toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
    }
    function iniciais(nome) {
        const partes = (nome || 'U').trim().toUpperCase().split(/\s+/);
        if (partes.length === 1) return partes[0][0] || 'U';
        return (partes[0][0] + partes[partes.length - 1][0]);
    }

    /* ── Avatar (localStorage) ── */
    const AVATAR_KEY = `edusync_avatar_${user.userId}`;
    function getAvatar() { return localStorage.getItem(AVATAR_KEY) || null; }
    function setAvatar(b64) {
        localStorage.setItem(AVATAR_KEY, b64);
        sincronizarAvatares(b64);
    }

    /* ── DOM ready ── */
    function onDomReady(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    onDomReady(() => {
        /* Injeta CSS antes de qualquer coisa para evitar flash do btn-theme */
        const _css = document.createElement('link');
        _css.rel   = 'stylesheet';
        _css.href  = '/shared/css/nav-profile.css';
        document.head.appendChild(_css);

        document.body.classList.add('auth-ready');
        aplicarPermissoesNav(user);
        injetarAvatarHeader(user);
        injetarBadgeEscola();
        atualizarBotaoLogout();
        configurarLogout();
        injetarLinkRetorno(user);
        injetarLinkAdmin(user);
        injetarLinkPlanos(user);
        if (user.impersonando) {
            document.body.setAttribute('data-impersonando', '1');
            injetarBannerImpersonacao(user);
        }
        injetarPerfilPanel(user);
        iniciarNavAdaptativo();
    });

    /* ══════════════════════════════════════════════════════════════════════
       1. Permissões de navegação
    ══════════════════════════════════════════════════════════════════════ */
    function aplicarPermissoesNav(user) {
        const perfilEfetivo = user.impersonando ? user.impersonandoPerfil : user.perfil;

        document.querySelectorAll('.nav-menu a, .side-panel a').forEach(link => {
            if (link.classList.contains('side-nav-child-item')) return;
            const href   = link.getAttribute('href');
            const modulo = MODULO_URLS[href];

            if (!modulo) return; // link sem mapeamento: deixa visível

            if (!podeAcessar(perfilEfetivo, modulo)) {
                marcarBloqueado(link, perfilEfetivo);
            } else {
                /* Item liberado: limpa qualquer marcação anterior */
                link.removeAttribute('data-perm-blocked');
                link.removeAttribute('aria-disabled');
                link.removeAttribute('data-perm-hidden');
                link.style.display = '';
                if (link._permHandler) {
                    link.removeEventListener('click', link._permHandler, true);
                    link._permHandler = null;
                }
            }
        });

        /* Revela os menus (caso o cache estivesse vazio e o anti-flash ainda ativo) */
        marcarNavPronto();
    }

    /* ══════════════════════════════════════════════════════════════════════
       2. Avatar no header (substitui o user-badge de texto)
    ══════════════════════════════════════════════════════════════════════ */
    function injetarAvatarHeader(user) {
        const headerActions = document.querySelector('.header-actions');
        if (!headerActions) return;

        const perfilEfetivo = user.impersonando ? user.impersonandoPerfil : user.perfil;
        const perfilLabel   = PERFIL_LABEL[perfilEfetivo] || perfilEfetivo;

        const btn = document.createElement('button');
        btn.className = 'nav-avatar-btn' + (user.impersonando ? ' impersonando' : '');
        btn.title     = `${toTitleCase(user.nome)} · ${perfilLabel}`;
        btn.onclick   = () => togglePerfilPanel();

        /* Círculo com iniciais ou foto */
        const circle = document.createElement('span');
        circle.className = 'nav-avatar-circle';
        const av = getAvatar();
        if (av) {
            const img = document.createElement('img');
            img.src = av; img.alt = 'Avatar';
            circle.appendChild(img);
        } else {
            circle.textContent = user.impersonando ? '👁' : iniciais(user.nome);
        }

        /* Rótulo do perfil abaixo do círculo */
        const label = document.createElement('span');
        label.className   = 'nav-avatar-label';
        label.textContent = perfilLabel;

        btn.appendChild(circle);
        btn.appendChild(label);
        headerActions.insertBefore(btn, headerActions.firstChild);
    }

    /* ══════════════════════════════════════════════════════════════════════
       2b. Badge do colégio selecionado no header (exceto no dashboard)
    ══════════════════════════════════════════════════════════════════════ */
    function injetarBadgeEscola() {
        const escola = localStorage.getItem('edusync_escola');
        if (!escola) return;
        /* No dashboard o seletor de colégio já está visível na página */
        if (location.pathname.startsWith('/pages/dashboard/')) return;
        const headerActions = document.querySelector('.header-actions');
        if (!headerActions) return;
        if (headerActions.querySelector('.escola-badge-nav')) return; // evita duplicata
        const badge = document.createElement('span');
        badge.className = 'escola-badge-nav';
        badge.title = escola;
        const max = 28;
        const nome = escola.length > max ? escola.slice(0, max) + '…' : escola;
        badge.textContent = '🏫 ' + nome;
        headerActions.insertBefore(badge, headerActions.firstChild);
    }

    /* ══════════════════════════════════════════════════════════════════════
       3. Logout no header — ícone + texto
    ══════════════════════════════════════════════════════════════════════ */
    function atualizarBotaoLogout() {
        const btn = document.querySelector('#btnLogout, .btn-logout');
        if (!btn) return;
        btn.innerHTML = '<span style="font-size:15px;line-height:1">🚪</span> Sair';
        btn.title = 'Encerrar sessão';
    }

    function configurarLogout() {
        document.querySelectorAll('#btnLogout, [data-action="logout"]').forEach(btn => {
            btn.addEventListener('click', () => fazerLogout(btn));
        });
    }

    async function fazerLogout(btn) {
        if (btn) { btn.disabled = true; btn.innerHTML = '<span>🚪</span> Saindo…'; }
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } finally {
            limparCacheNav();
            localStorage.removeItem('edusync_escola');
            localStorage.removeItem('edusync_escola_codturmas');
            window.location.replace(LOGIN_PATH);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
       4a. Link Retorno Pedagógico no nav (professor e pedagogo)
    ══════════════════════════════════════════════════════════════════════ */
    function injetarLinkRetorno(user) {
        const perfilEfetivo = user.impersonando ? user.impersonandoPerfil : user.perfil;
        if (!podeAcessar(perfilEfetivo, 'retorno-pedagogico')) return;
        const nav = document.querySelector('.nav-menu');
        if (!nav || nav.querySelector('a[href="/pages/retorno-pedagogico/"]')) return;

        const link = document.createElement('a');
        link.href        = '/pages/retorno-pedagogico/';
        link.textContent = 'Retorno Pedagógico';
        if (location.pathname.startsWith('/pages/retorno-pedagogico/')) link.classList.add('active');
        // Insere logo após o link do Painel Pedagógico se existir, senão appenda
        const pedLink = nav.querySelector('a[href="/pages/pedagogico/"]');
        if (pedLink && pedLink.nextSibling) {
            nav.insertBefore(link, pedLink.nextSibling);
        } else {
            nav.appendChild(link);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
       4b. Link Admin no nav
    ══════════════════════════════════════════════════════════════════════ */
    function injetarLinkAdmin(user) {
        if (user.perfilReal !== 'admin' && user.perfil !== 'admin') return;
        if (user.impersonando) return;
        const nav = document.querySelector('.nav-menu');
        if (!nav || nav.querySelector('a[href="/pages/admin/"]')) return;

        const link = document.createElement('a');
        link.href        = '/pages/admin/';
        link.textContent = 'Admin';
        if (location.pathname === '/pages/admin/') link.classList.add('active');
        nav.appendChild(link);
    }

    function injetarLinkPlanos(user) {
        if (user.perfilReal !== 'admin' && user.perfil !== 'admin') return;
        if (user.impersonando) return;
        const nav = document.querySelector('.nav-menu');
        if (!nav || nav.querySelector('a[href="/pages/planos/"]')) return;

        const link = document.createElement('a');
        link.href        = '/pages/planos/';
        link.textContent = 'Planos';
        if (location.pathname === '/pages/planos/') link.classList.add('active');
        nav.appendChild(link);
    }

    /* ══════════════════════════════════════════════════════════════════════
       5. Nav Adaptativo — ResizeObserver
    ══════════════════════════════════════════════════════════════════════ */
    function iniciarNavAdaptativo() {
        const nav           = document.querySelector('.nav-menu');
        const headerContent = document.querySelector('.header-content');
        const headerLeft    = document.querySelector('.header-left');
        const headerActions = document.querySelector('.header-actions');
        if (!nav || !headerContent) return;

        /* Botão "Mais ▾" */
        const btnMais = document.createElement('a');
        btnMais.className   = 'nav-mais-btn';
        btnMais.textContent = 'Mais ▾';
        btnMais.href        = '#';
        btnMais.addEventListener('click', e => { e.preventDefault(); window.abrirSidePanel?.(); });
        nav.parentNode.insertBefore(btnMais, nav.nextSibling);

        let rafId = null;
        const recalcular = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const itens = Array.from(nav.querySelectorAll('a:not(.nav-mais-btn)'))
                    .filter(a => !a.getAttribute('data-perm-hidden'));
                /* Itens bloqueados continuam visíveis no header (não vão para overflow
                   nem ficam escondidos), mas mantêm o estilo desabilitado.            */

                /* Torna todos visíveis para medir */
                itens.forEach(a => {
                    a.style.visibility = 'hidden';
                    a.style.display    = '';
                    a.removeAttribute('data-nav-hidden');
                });
                btnMais.style.display = 'none';

                const leftW    = headerLeft?.offsetWidth    || 0;
                const actW     = headerActions?.offsetWidth || 0;
                const dividerW = 1;
                const totalW   = headerContent.clientWidth;
                /* Reserva: gap entre seções + largura do botão "Mais ▾" + folga anti-piscar */
                const dispW    = totalW - leftW - actW - dividerW - 96;

                let acumulado   = 0;
                let overflowIdx = -1;

                for (let i = 0; i < itens.length; i++) {
                    acumulado += itens[i].offsetWidth + 6;
                    if (acumulado > dispW && overflowIdx === -1) overflowIdx = i;
                }

                const overflow = overflowIdx !== -1 && overflowIdx < itens.length;
                btnMais.style.display = overflow ? '' : 'none';

                itens.forEach((a, i) => {
                    a.style.visibility = '';
                    if (overflow && i >= overflowIdx) {
                        a.style.display = 'none';
                        a.setAttribute('data-nav-hidden', 'true');
                    }
                });

                /* Injeta itens escondidos no topo do side panel */
                injetarOverflowNoSidePanel(itens.filter(a => a.getAttribute('data-nav-hidden') === 'true'));
            });
        };

        if (window.ResizeObserver) {
            new ResizeObserver(recalcular).observe(headerContent);
        } else {
            window.addEventListener('resize', recalcular);
        }
        recalcular();
    }

    /* Injeta os itens em overflow no topo do side panel como grupo extra */
    let _overflowGroup = null;
    function injetarOverflowNoSidePanel(itensOcultos) {
        const sideNav = document.querySelector('.side-panel-nav');
        if (!sideNav) return;

        /* Remove grupo anterior */
        if (_overflowGroup) { _overflowGroup.remove(); _overflowGroup = null; }
        if (!itensOcultos.length) return;

        const grupo = document.createElement('div');
        grupo.className = 'side-overflow-group';

        const label = document.createElement('div');
        label.className   = 'side-panel-section-label';
        label.textContent = 'Navegação';
        grupo.appendChild(label);

        itensOcultos.forEach(a => {
            const clone = document.createElement('a');
            clone.href      = a.href;
            clone.className = 'side-nav-item' + (a.classList.contains('active') ? ' active' : '');
            clone.innerHTML = `
                <span class="side-nav-icon" style="font-size:18px">${_navIcon(a.getAttribute('href'))}</span>
                <div class="side-nav-info">
                    <span class="side-nav-nome">${a.textContent.trim()}</span>
                    <span class="side-nav-desc"></span>
                </div>`;
            /* Propaga estado bloqueado: clone também precisa exibir cadeado, tooltip
               e interceptar o clique mostrando o toast. */
            if (a.getAttribute('data-perm-blocked') === 'true') {
                const modulo = MODULO_URLS[a.getAttribute('href')];
                const cachedPerfil = (() => {
                    try {
                        const c = JSON.parse(localStorage.getItem(NAV_CACHE_KEY) || 'null');
                        return c?.impersonando ? c.impersonandoPerfil : c?.perfil;
                    } catch { return null; }
                })();
                marcarBloqueado(clone, cachedPerfil || 'usuário');
            }
            grupo.appendChild(clone);
        });

        sideNav.insertBefore(grupo, sideNav.firstChild);
        _overflowGroup = grupo;
    }

    function _navIcon(href) {
        const m = {
            '/pages/dashboard/':              '🏠',
            '/pages/frequencias/':            '📋',
            '/pages/comunicados/':            '📢',
            '/pages/crachas/':                '🪪',
            '/pages/emprestimos/':            '📚',
            '/pages/circulacao/':             '🚪',
            '/pages/comportamento/':          '⚡',
            '/pages/presenca/':               '✅',
            '/pages/pedagogico/':             '🎓',
            '/pages/retorno-pedagogico/':     '💬',
            '/pages/provas/':                 '📝',
            '/pages/admin/':                  '⚙️',
            '/pages/planos/':                 '💎',
            '/pages/suporte/':               '🎫',
        };
        return m[href] || '🔗';
    }

    /* ══════════════════════════════════════════════════════════════════════
       6. Painel de Perfil (dropdown do avatar no header)
    ══════════════════════════════════════════════════════════════════════ */
    let _perfilPanelOpen = false;

    function injetarPerfilPanel(user) {
        /* Overlay */
        const overlay = document.createElement('div');
        overlay.className = 'perfil-panel-overlay';
        overlay.id        = 'perfilOverlay';
        overlay.addEventListener('click', fecharPerfilPanel);

        /* Painel */
        const panel = document.createElement('div');
        panel.className = 'perfil-panel';
        panel.id        = 'perfilPanel';
        panel.addEventListener('click', e => e.stopPropagation());

        const nomeFormatado    = toTitleCase(user.nome);
        const perfilEfetivo    = user.impersonando ? user.impersonandoPerfil : user.perfil;
        const perfilLabel      = PERFIL_LABEL[perfilEfetivo] || perfilEfetivo;
        const avatarSrc        = getAvatar();
        const avatarHtml       = avatarSrc
            ? `<img src="${avatarSrc}" alt="Avatar">`
            : `<span>${iniciais(user.nome)}</span>`;

        panel.innerHTML = `
            <div class="perfil-panel-header" id="perfilHeader">
                <div class="perfil-panel-avatar-wrap">
                    <div class="perfil-panel-avatar" id="perfilAvatar" title="Alterar foto">
                        ${avatarHtml}
                    </div>
                    <div class="perfil-avatar-edit-badge" id="perfilAvatarBadge" title="Alterar foto">✎</div>
                </div>
                <div class="perfil-panel-info" id="perfilInfoArea">
                    <div class="perfil-panel-nome" id="perfilNomeDisplay">${nomeFormatado}</div>
                    <div class="perfil-panel-perfil">${perfilLabel}</div>
                </div>
            </div>
            <div class="perfil-panel-body">
                <button class="perfil-panel-item" id="perfilEditarNomeBtn" type="button">
                    <span class="perfil-panel-item-icon">✏️</span>
                    <div>
                        <div class="perfil-panel-item-text">Editar nome</div>
                        <div class="perfil-panel-item-sub">${nomeFormatado}</div>
                    </div>
                </button>

                <div class="perfil-panel-divider"></div>

                <button class="perfil-tema-toggle" id="perfilTemaBtn" type="button">
                    <div class="perfil-tema-left">
                        <span class="perfil-panel-item-icon" id="perfilTemaIcon">🌙</span>
                        <div>
                            <div class="perfil-panel-item-text" id="perfilTemaLabel">Tema escuro</div>
                            <div class="perfil-panel-item-sub" id="perfilTemaSub">Claro atualmente</div>
                        </div>
                    </div>
                    <div class="perfil-tema-switch" id="perfilTemaSwitch"></div>
                </button>

                <div class="perfil-panel-divider"></div>
            </div>
            <button class="perfil-logout-btn" id="perfilLogoutBtn" type="button">
                <span class="perfil-logout-icon">🚪</span>
                <div>
                    <div style="font-size:14px;font-weight:700">Sair da conta</div>
                    <div style="font-size:11px;opacity:.75;margin-top:1px">Encerrar sessão</div>
                </div>
            </button>
            <input type="file" id="perfilAvatarInput" accept="image/*">
        `;

        /* Adiciona ao body — o painel vai flutuar perto do header */
        document.body.appendChild(overlay);
        document.body.appendChild(panel);

        /* Tema: estado inicial */
        _atualizarTemaUI();

        /* Listeners */
        document.getElementById('perfilTemaBtn').addEventListener('click', () => {
            window.toggleTheme?.();
            _atualizarTemaUI();
        });

        document.getElementById('perfilLogoutBtn').addEventListener('click', () => {
            fecharPerfilPanel();
            fazerLogout(null);
        });

        /* Avatar: clique na foto ou no badge */
        ['perfilAvatar','perfilAvatarBadge'].forEach(id => {
            document.getElementById(id).addEventListener('click', () => {
                document.getElementById('perfilAvatarInput').click();
            });
        });

        document.getElementById('perfilAvatarInput').addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                redimensionarAvatar(ev.target.result, 200, b64 => {
                    setAvatar(b64);
                    sincronizarAvatares(b64);
                });
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        });

        /* Editar nome */
        document.getElementById('perfilEditarNomeBtn').addEventListener('click', () => {
            abrirEdicaoNome(user);
        });
    }

    function _atualizarTemaUI() {
        const DARK_KEY = 'edugest_theme';
        const isDark   = localStorage.getItem(DARK_KEY) === 'dark';
        const sw       = document.getElementById('perfilTemaSwitch');
        const lbl      = document.getElementById('perfilTemaLabel');
        const sub      = document.getElementById('perfilTemaSub');
        const ico      = document.getElementById('perfilTemaIcon');
        if (!sw) return;
        sw.classList.toggle('dark-on', isDark);
        if (lbl) lbl.textContent = isDark ? 'Tema escuro' : 'Tema claro';
        if (sub) sub.textContent = isDark ? 'Escuro ativado' : 'Claro ativado';
        if (ico) ico.textContent = isDark ? '🌙' : '☀️';
    }

    function togglePerfilPanel() {
        _perfilPanelOpen ? fecharPerfilPanel() : abrirPerfilPanel();
    }

    function abrirPerfilPanel() {
        _perfilPanelOpen = true;
        const panel  = document.getElementById('perfilPanel');
        const avatarBtn = document.querySelector('.nav-avatar-btn');

        /* Posiciona o painel logo abaixo do botão de avatar */
        if (panel && avatarBtn) {
            const rect   = avatarBtn.getBoundingClientRect();
            const panelW = 300;
            const viewW  = window.innerWidth;
            const gap    = 10;

            /*
             * Alinha a seta (::before right:14px, largura:13px → centro a 20.5px da borda direita
             * do painel) com o centro do botão de avatar.
             *
             * Arrow center from viewport right = rightPos + 20.5
             * Avatar center from viewport right = viewW - rect.right + rect.width/2
             * → rightPos = (viewW - rect.right + rect.width/2) - 20.5
             *            ≈ viewW - rect.right - 3  (para avatar 34px)
             */
            let rightPos = viewW - rect.right + (rect.width / 2) - 20;
            rightPos = Math.max(8, Math.min(rightPos, viewW - panelW - 8));

            panel.style.right = `${rightPos}px`;
            panel.style.top   = `${rect.bottom + gap}px`;
        }

        panel?.classList.add('open');
        document.getElementById('perfilOverlay')?.classList.add('open');
        avatarBtn?.classList.add('open');
        _atualizarTemaUI();
    }

    function fecharPerfilPanel() {
        _perfilPanelOpen = false;
        document.getElementById('perfilPanel')?.classList.remove('open');
        document.getElementById('perfilOverlay')?.classList.remove('open');
        document.querySelector('.nav-avatar-btn')?.classList.remove('open');
    }

    /* ── Redimensionar avatar via canvas ── */
    function redimensionarAvatar(src, tamanho, callback) {
        const img = new Image();
        img.onload = () => {
            const canvas    = document.createElement('canvas');
            canvas.width    = tamanho;
            canvas.height   = tamanho;
            const ctx       = canvas.getContext('2d');
            const lado      = Math.min(img.width, img.height);
            const ox        = (img.width  - lado) / 2;
            const oy        = (img.height - lado) / 2;
            ctx.drawImage(img, ox, oy, lado, lado, 0, 0, tamanho, tamanho);
            callback(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = src;
    }

    /* ── Sincroniza avatares no DOM ── */
    function sincronizarAvatares(b64) {
        document.querySelectorAll('.nav-avatar-circle, .perfil-panel-avatar').forEach(el => {
            el.innerHTML = `<img src="${b64}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        });
    }

    /* ── Editar nome inline no painel ── */
    function abrirEdicaoNome(user) {
        const header = document.getElementById('perfilHeader');
        if (!header) return;
        const nomeAtual = toTitleCase(user.nome);

        header.innerHTML = `
            <div class="perfil-panel-avatar-wrap">
                <div class="perfil-panel-avatar">${getAvatar() ? `<img src="${getAvatar()}" alt="Avatar">` : iniciais(user.nome)}</div>
            </div>
            <div class="perfil-panel-info" style="flex:1">
                <input class="perfil-nome-input" id="perfilNomeInputField"
                       value="${nomeAtual}" placeholder="Seu nome" maxlength="80">
                <div class="perfil-nome-save-row">
                    <button class="perfil-nome-save-btn" id="perfilNomeSalvar">Salvar</button>
                    <button class="perfil-nome-cancel-btn" id="perfilNomeCancelar">Cancelar</button>
                </div>
            </div>
        `;

        document.getElementById('perfilNomeInputField').focus();

        document.getElementById('perfilNomeSalvar').addEventListener('click', async () => {
            const novo = document.getElementById('perfilNomeInputField').value.trim();
            if (!novo) return;
            const btn = document.getElementById('perfilNomeSalvar');
            btn.textContent = '…'; btn.disabled = true;

            try {
                const res = await fetch('/api/auth/perfil', {
                    method:      'PUT',
                    credentials: 'include',
                    headers:     { 'Content-Type': 'application/json' },
                    body:        JSON.stringify({ nome: novo }),
                });
                if (res.ok) {
                    user.nome = novo;
                    window.__edusync.user.nome = novo;
                    localStorage.setItem(`edusync_nome_${user.userId}`, novo);
                }
            } catch (_) { /* silencioso */ }

            fecharEdicaoNome(user);
        });

        document.getElementById('perfilNomeCancelar').addEventListener('click', () => fecharEdicaoNome(user));
    }

    function fecharEdicaoNome(user) {
        const header = document.getElementById('perfilHeader');
        if (!header) return;
        const nomeFormatado = toTitleCase(user.nome);
        const perfilEfetivo = user.impersonando ? user.impersonandoPerfil : user.perfil;
        const perfilLabel   = PERFIL_LABEL[perfilEfetivo] || perfilEfetivo;
        const avatarSrc     = getAvatar();

        header.innerHTML = `
            <div class="perfil-panel-avatar-wrap">
                <div class="perfil-panel-avatar" id="perfilAvatar" title="Alterar foto">
                    ${avatarSrc ? `<img src="${avatarSrc}" alt="Avatar">` : `<span>${iniciais(user.nome)}</span>`}
                </div>
                <div class="perfil-avatar-edit-badge" id="perfilAvatarBadge" title="Alterar foto">✎</div>
            </div>
            <div class="perfil-panel-info" id="perfilInfoArea">
                <div class="perfil-panel-nome" id="perfilNomeDisplay">${nomeFormatado}</div>
                <div class="perfil-panel-perfil">${perfilLabel}</div>
            </div>
        `;

        /* Re-bind avatar clicks */
        ['perfilAvatar','perfilAvatarBadge'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => {
                document.getElementById('perfilAvatarInput')?.click();
            });
        });

        /* Atualiza sub-label do botão editar */
        const sub = document.querySelector('#perfilEditarNomeBtn .perfil-panel-item-sub');
        if (sub) sub.textContent = nomeFormatado;
    }

    /* ══════════════════════════════════════════════════════════════════════
       7. Banner de impersonação
    ══════════════════════════════════════════════════════════════════════ */
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
