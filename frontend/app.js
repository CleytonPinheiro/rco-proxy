const API_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
        carregarStatus();

        document.getElementById('configForm').addEventListener('submit', salvarCredenciais);
        document.getElementById('btnAtualizar').addEventListener('click', carregarStatus);
        document.getElementById('btnAcessos').addEventListener('click', buscarAcessos);
});

async function carregarStatus() {
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = 'Carregando...';

        try {
                const response = await fetch(`${API_URL}/api/status`);
                const data = await response.json();

                statusDiv.textContent = '';

                const p1 = document.createElement('p');
                p1.textContent = 'Credenciais: ';
                const span1 = document.createElement('span');
                span1.className = data.credenciaisConfiguradas ? 'status-ok' : 'status-erro';
                span1.textContent = data.credenciaisConfiguradas ? 'Configuradas' : 'Não configuradas';
                p1.appendChild(span1);
                statusDiv.appendChild(p1);

                const p2 = document.createElement('p');
                p2.textContent = 'Token em cache: ';
                const span2 = document.createElement('span');
                span2.className = data.tokenEmCache ? 'status-ok' : 'status-erro';
                span2.textContent = data.tokenEmCache ? 'Sim' : 'Não';
                p2.appendChild(span2);
                statusDiv.appendChild(p2);

                if (data.tokenExpiracao) {
                        const p3 = document.createElement('p');
                        p3.textContent = 'Expira em: ' + new Date(data.tokenExpiracao).toLocaleString('pt-BR');
                        statusDiv.appendChild(p3);
                }
        } catch (error) {
                statusDiv.textContent = '';
                const errorP = document.createElement('p');
                errorP.className = 'status-erro';
                errorP.textContent = 'Erro ao carregar status: ' + error.message;
                statusDiv.appendChild(errorP);
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
                        mensagemDiv.textContent = 'Login realizado com sucesso! Redirecionando...';
                        mensagemDiv.style.display = 'block';
                        
                        setTimeout(() => {
                                window.location.href = '/dashboard.html';
                        }, 1000);
                        return;
                } else {
                        mensagemDiv.className = 'mensagem erro';
                        mensagemDiv.textContent = data.erro || 'Erro desconhecido';
                }
        } catch (error) {
                mensagemDiv.className = 'mensagem erro';
                mensagemDiv.textContent = `Erro de conexão: ${error.message}`;
        }
        
        mensagemDiv.style.display = 'block';
        btnSalvar.disabled = false;
        btnSalvar.textContent = 'Salvar e Conectar';
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
