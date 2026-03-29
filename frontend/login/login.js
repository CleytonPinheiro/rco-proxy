(async function () {
    // Se já autenticado, redirecionar direto
    try {
        const r = await fetch('/api/me', { credentials: 'include' });
        if (r.ok) {
            window.location.replace('/pages/dashboard/');
            return;
        }
    } catch { /* não autenticado, exibir form */ }

    const form    = document.getElementById('loginForm');
    const msg     = document.getElementById('loginMsg');
    const btnEntrar = document.getElementById('btnEntrar');

    // Formatação automática do CPF
    document.getElementById('cpf').addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 11);
    });

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
                mostrarMsg('Login realizado! Redirecionando…', 'ok');
                setTimeout(() => window.location.replace('/pages/dashboard/'), 800);
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
