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

    const PERFIL_MODULOS = {
        admin:      ['*'],
        professor:  ['dashboard','frequencias','atividades','classroom','comportamento','grupos','mapa-sala','pedagogico'],
        pedagogo:   ['dashboard','comportamento','pedagogico','frequencias','comunicados'],
        secretaria: ['dashboard','crachas','emprestimos','materiais','comunicados','circulacao'],
        aux_turno:  ['circulacao','presenca'],
        cozinha:    ['cozinha'],
    };

    const PERFIL_LABEL = {
        admin: 'Administrador', professor: 'Professor', pedagogo: 'Pedagogo',
        secretaria: 'Secretaria', aux_turno: 'Aux. de Turno', cozinha: 'Cozinha',
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

    window.__edusync = { user };

    const paginaAtual = MODULO_URLS[location.pathname] || null;
    if (paginaAtual && !podeAcessar(user.perfil, paginaAtual)) {
        window.location.replace(DASH_PATH);
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
        atualizarBotaoLogout();
        configurarLogout();
        injetarLinkAdmin(user);
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
        document.querySelectorAll('.nav-menu a, .side-panel a').forEach(link => {
            const href   = link.getAttribute('href');
            const modulo = MODULO_URLS[href];
            if (modulo && !podeAcessar(user.perfil, modulo)) {
                link.style.display = 'none';
            }
        });
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
            window.location.replace(LOGIN_PATH);
        }
    }

    /* ══════════════════════════════════════════════════════════════════════
       4. Link Admin no nav
    ══════════════════════════════════════════════════════════════════════ */
    function injetarLinkAdmin(user) {
        if (user.perfilReal !== 'admin' && user.perfil !== 'admin') return;
        if (user.impersonando) return;
        const nav = document.querySelector('.nav-menu');
        if (!nav || nav.querySelector('a[href="/pages/admin/"]')) return;

        const link = document.createElement('a');
        link.href        = '/pages/admin/';
        link.textContent = '⚙ Admin';
        if (location.pathname === '/pages/admin/') link.classList.add('active');
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
                const dispW    = totalW - leftW - actW - dividerW - 60; /* gap + mais btn */

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
                </div>`;
            grupo.appendChild(clone);
        });

        sideNav.insertBefore(grupo, sideNav.firstChild);
        _overflowGroup = grupo;
    }

    function _navIcon(href) {
        const m = {
            '/pages/dashboard/':     '🏠',
            '/pages/frequencias/':   '📋',
            '/pages/comunicados/':   '📢',
            '/pages/crachas/':       '🪪',
            '/pages/emprestimos/':   '📚',
            '/pages/circulacao/':    '🚪',
            '/pages/comportamento/': '⚡',
            '/pages/presenca/':      '✅',
            '/pages/admin/':         '⚙️',
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
