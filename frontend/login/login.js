(async function () {
    // ── Se já autenticado, redirecionar direto ──────────────────────────────
    try {
        const r = await fetch('/api/me', { credentials: 'include' });
        if (r.ok) {
            window.location.replace('/pages/dashboard/');
            return;
        }
    } catch { /* não autenticado, exibir form */ }

    const form      = document.getElementById('loginForm');
    const msg       = document.getElementById('loginMsg');
    const btnEntrar = document.getElementById('btnEntrar');
    const btnTexto  = document.getElementById('btnTexto');
    const btnSpin   = document.getElementById('btnSpinner');
    const chkAceite = document.getElementById('aceiteTermos');

    // ── Restaurar aceite prévio ─────────────────────────────────────────────
    if (localStorage.getItem('edusync_termos_aceitos') === '1') {
        chkAceite.checked  = true;
        btnEntrar.disabled = false;
    }

    chkAceite.addEventListener('change', () => {
        btnEntrar.disabled = !chkAceite.checked;
    });

    // ── Formatação de CPF (000.000.000-00) ──────────────────────────────────
    const inputCpf = document.getElementById('cpf');
    inputCpf.addEventListener('input', function () {
        let v = this.value.replace(/\D/g, '').slice(0, 11);
        if (v.length > 9)      v = v.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
        else if (v.length > 6) v = v.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
        else if (v.length > 3) v = v.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
        this.value = v;
    });

    // ── Mostrar/ocultar senha ───────────────────────────────────────────────
    const inputSenha  = document.getElementById('senha');
    const btnToggle   = document.getElementById('btnToggleSenha');
    const eyeOpen     = document.getElementById('eyeOpen');
    const eyeClosed   = document.getElementById('eyeClosed');

    btnToggle.addEventListener('click', () => {
        const visivel = inputSenha.type === 'text';
        inputSenha.type   = visivel ? 'password' : 'text';
        eyeOpen.style.display   = visivel ? ''     : 'none';
        eyeClosed.style.display = visivel ? 'none' : '';
    });

    // ── Destino pós-login ───────────────────────────────────────────────────
    function destinoLogin() {
        try {
            const next = new URLSearchParams(location.search).get('next');
            if (next && next.startsWith('/') && !next.startsWith('//')) return next;
        } catch { /* */ }
        return '/pages/dashboard/';
    }

    // ── Submit ──────────────────────────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cpf   = inputCpf.value.replace(/\D/g, '');
        const senha = inputSenha.value;

        if (!cpf || !senha) {
            mostrarMsg('Preencha CPF e senha.', 'erro');
            return;
        }
        if (cpf.length !== 11) {
            mostrarMsg('CPF inválido. Digite os 11 dígitos.', 'erro');
            return;
        }

        setCarregando(true);

        try {
            const res  = await fetch('/api/auth/login', {
                method:      'POST',
                headers:     { 'Content-Type': 'application/json' },
                credentials: 'include',
                body:        JSON.stringify({ cpf, senha }),
            });
            const data = await res.json();

            if (res.ok && data.sucesso) {
                try { localStorage.setItem('edusync_termos_aceitos', '1'); } catch {}

                if (data.usuario) {
                    try {
                        localStorage.setItem('edusync_nav_cache', JSON.stringify({
                            perfil:             data.usuario.perfil,
                            impersonando:       data.usuario.impersonando       || false,
                            impersonandoPerfil: data.usuario.impersonandoPerfil || null,
                        }));
                    } catch {}
                }
                mostrarMsg('Login realizado! Redirecionando…', 'ok');
                setTimeout(() => window.location.replace(destinoLogin()), 800);
            } else {
                mostrarMsg(data.erro || 'Erro ao autenticar.', 'erro');
                setCarregando(false);
            }
        } catch (err) {
            mostrarMsg('Erro de conexão: ' + err.message, 'erro');
            setCarregando(false);
        }
    });

    function setCarregando(sim) {
        btnEntrar.disabled       = sim;
        btnTexto.style.display   = sim ? 'none' : '';
        btnSpin.style.display    = sim ? ''     : 'none';
        msg.style.display        = 'none';
    }

    function mostrarMsg(texto, tipo) {
        msg.textContent   = texto;
        msg.className     = `login-msg login-msg--${tipo}`;
        msg.style.display = 'block';
    }

    // ── Banner de Cookies ───────────────────────────────────────────────────
    const banner = document.getElementById('cookieBanner');
    const btnOk  = document.getElementById('btnCookieAceitar');

    if (!localStorage.getItem('edusync_cookie_aceito')) {
        setTimeout(() => { banner.style.display = ''; }, 800);
    }

    btnOk.addEventListener('click', () => {
        localStorage.setItem('edusync_cookie_aceito', '1');
        banner.style.animation = 'slideDown .25s ease forwards';
        setTimeout(() => { banner.style.display = 'none'; }, 260);
    });
})();
