(async function () {
    // Se já autenticado, redirecionar direto
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
    const chkAceite = document.getElementById('aceiteTermos');

    /* Restaurar aceite prévio para conveniência em logins subsequentes */
    if (localStorage.getItem('edusync_termos_aceitos') === '1') {
        chkAceite.checked = true;
        btnEntrar.disabled = false;
    }

    /* Habilitar/desabilitar botão conforme aceite */
    chkAceite.addEventListener('change', () => {
        btnEntrar.disabled = !chkAceite.checked;
    });

    // Formatação automática do CPF
    document.getElementById('cpf').addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 11);
    });

    /* Destino pós-login: usa ?next= se presente e é uma rota interna */
    function destinoLogin() {
        try {
            const next = new URLSearchParams(location.search).get('next');
            if (next && next.startsWith('/') && !next.startsWith('//')) return next;
        } catch { /* */ }
        return '/pages/dashboard/';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cpf   = document.getElementById('cpf').value.replace(/\D/g, '');
        const senha = document.getElementById('senha').value;

        if (!cpf || !senha) {
            mostrarMsg('Preencha CPF e senha.', 'erro');
            return;
        }

        btnEntrar.disabled     = true;
        btnEntrar.textContent  = 'Autenticando no RCO…';
        msg.style.display      = 'none';

        try {
            const res  = await fetch('/api/auth/login', {
                method:      'POST',
                headers:     { 'Content-Type': 'application/json' },
                credentials: 'include',
                body:        JSON.stringify({ cpf, senha }),
            });
            const data = await res.json();

            if (res.ok && data.sucesso) {
                /* Registra aceite dos termos para conveniência em logins futuros */
                try { localStorage.setItem('edusync_termos_aceitos', '1'); } catch {}

                /* Grava perfil no cache para que auth.js aplique permissões de nav
                   de forma síncrona (sem fetch) na primeira página após o login */
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
                btnEntrar.disabled    = false;
                btnEntrar.textContent = 'Entrar';
            }
        } catch (err) {
            mostrarMsg('Erro de conexão: ' + err.message, 'erro');
            btnEntrar.disabled    = false;
            btnEntrar.textContent = 'Entrar';
        }
    });

    function mostrarMsg(texto, tipo) {
        msg.textContent  = texto;
        msg.className    = `login-msg login-msg--${tipo}`;
        msg.style.display = 'block';
    }
})();
