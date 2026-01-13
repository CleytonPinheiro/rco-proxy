const API_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
    carregarStatus();

    document.getElementById('configForm').addEventListener('submit', salvarCredenciais);
    document.getElementById('btnAtualizar').addEventListener('click', carregarStatus);
    document.getElementById('btnAcessos').addEventListener('click', buscarAcessos);
});

async function carregarStatus() {
    const statusDiv = document.getElementById('status');
    statusDiv.innerHTML = '<p>Carregando...</p>';

    try {
        const response = await fetch(`${API_URL}/api/status`);
        const data = await response.json();

        statusDiv.innerHTML = `
            <p>Credenciais: <span class="${data.credenciaisConfiguradas ? 'status-ok' : 'status-erro'}">
                ${data.credenciaisConfiguradas ? 'Configuradas' : 'Não configuradas'}
            </span></p>
            <p>Token em cache: <span class="${data.tokenEmCache ? 'status-ok' : 'status-erro'}">
                ${data.tokenEmCache ? 'Sim' : 'Não'}
            </span></p>
            ${data.tokenExpiracao ? `<p>Expira em: ${new Date(data.tokenExpiracao).toLocaleString('pt-BR')}</p>` : ''}
        `;
    } catch (error) {
        statusDiv.innerHTML = `<p class="status-erro">Erro ao carregar status: ${error.message}</p>`;
    }
}

async function salvarCredenciais(e) {
    e.preventDefault();

    const cpf = document.getElementById('cpf').value;
    const senha = document.getElementById('senha').value;
    const mensagemDiv = document.getElementById('mensagem');
    const btnSalvar = document.getElementById('btnSalvar');

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Conectando...';
    mensagemDiv.className = 'mensagem';
    mensagemDiv.style.display = 'none';

    try {
        const response = await fetch(`${API_URL}/api/configurar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf, senha })
        });

        const data = await response.json();

        if (data.sucesso) {
            mensagemDiv.className = 'mensagem sucesso';
            mensagemDiv.textContent = data.mensagem;
            carregarStatus();
        } else {
            mensagemDiv.className = 'mensagem erro';
            mensagemDiv.textContent = data.erro || 'Erro desconhecido';
        }
    } catch (error) {
        mensagemDiv.className = 'mensagem erro';
        mensagemDiv.textContent = `Erro de conexão: ${error.message}`;
    } finally {
        mensagemDiv.style.display = 'block';
        btnSalvar.disabled = false;
        btnSalvar.textContent = 'Salvar e Conectar';
    }
}

async function buscarAcessos() {
    const acessosDiv = document.getElementById('acessos');
    const btnAcessos = document.getElementById('btnAcessos');

    btnAcessos.disabled = true;
    btnAcessos.textContent = 'Buscando...';
    acessosDiv.textContent = 'Carregando dados...';

    try {
        const response = await fetch(`${API_URL}/api/acessos`);
        const data = await response.json();

        acessosDiv.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
        acessosDiv.textContent = `Erro: ${error.message}`;
    } finally {
        btnAcessos.disabled = false;
        btnAcessos.textContent = 'Buscar Acessos';
    }
}
