const API_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
    carregarDados();

    document.getElementById('btnLogout').addEventListener('click', logout);
    document.getElementById('btnVoltar').addEventListener('click', () => {
        window.location.href = '/';
    });
});

async function verificarAutenticacao() {
    try {
        const response = await fetch(`${API_URL}/api/status`);
        const data = await response.json();

        if (!data.credenciaisConfiguradas) {
            window.location.href = '/';
        }
    } catch (error) {
        window.location.href = '/';
    }
}

async function carregarDados() {
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    const erro = document.getElementById('erro');
    const erroMensagem = document.getElementById('erroMensagem');

    try {
        const response = await fetch(`${API_URL}/api/acessos`);
        const data = await response.json();

        if (data.erro) {
            throw new Error(data.erro);
        }

        loading.style.display = 'none';
        content.style.display = 'block';

        renderizarTurmas(data);
        renderizarDisciplinas(data);
        renderizarLivros(data);
        renderizarDadosCompletos(data);

    } catch (error) {
        loading.style.display = 'none';
        erro.style.display = 'block';
        erroMensagem.textContent = `Erro ao carregar dados: ${error.message}`;
    }
}

function renderizarTurmas(data) {
    const container = document.getElementById('turmas');
    const turmas = extrairTurmas(data);

    if (turmas.length === 0) {
        container.innerHTML = '<div class="empty-message">Nenhuma turma encontrada</div>';
        return;
    }

    container.innerHTML = turmas.map(turma => `
        <div class="card">
            <div class="card-title">${turma.nome || 'Turma'}</div>
            ${turma.serie ? `<div class="card-info"><strong>Série:</strong> ${turma.serie}</div>` : ''}
            ${turma.turno ? `<div class="card-info"><strong>Turno:</strong> ${turma.turno}</div>` : ''}
            ${turma.escola ? `<div class="card-info"><strong>Escola:</strong> ${turma.escola}</div>` : ''}
            ${turma.ano ? `<span class="card-badge">${turma.ano}</span>` : ''}
        </div>
    `).join('');
}

function renderizarDisciplinas(data) {
    const container = document.getElementById('disciplinas');
    const disciplinas = extrairDisciplinas(data);

    if (disciplinas.length === 0) {
        container.innerHTML = '<div class="empty-message">Nenhuma disciplina encontrada</div>';
        return;
    }

    container.innerHTML = disciplinas.map(disc => `
        <div class="card">
            <div class="card-title">${disc.nome || 'Disciplina'}</div>
            ${disc.turma ? `<div class="card-info"><strong>Turma:</strong> ${disc.turma}</div>` : ''}
            ${disc.cargaHoraria ? `<div class="card-info"><strong>Carga Horária:</strong> ${disc.cargaHoraria}h</div>` : ''}
            <span class="card-badge verde">${disc.status || 'Ativa'}</span>
        </div>
    `).join('');
}

function renderizarLivros(data) {
    const container = document.getElementById('livros');
    const livros = extrairLivros(data);

    if (livros.length === 0) {
        container.innerHTML = '<div class="empty-message">Nenhum livro de classe encontrado</div>';
        return;
    }

    container.innerHTML = livros.map(livro => `
        <div class="card">
            <div class="card-title">${livro.nome || 'Livro de Classe'}</div>
            ${livro.turma ? `<div class="card-info"><strong>Turma:</strong> ${livro.turma}</div>` : ''}
            ${livro.disciplina ? `<div class="card-info"><strong>Disciplina:</strong> ${livro.disciplina}</div>` : ''}
            ${livro.periodo ? `<div class="card-info"><strong>Período:</strong> ${livro.periodo}</div>` : ''}
            <span class="card-badge amarelo">${livro.status || 'Em andamento'}</span>
        </div>
    `).join('');
}

function renderizarDadosCompletos(data) {
    const container = document.getElementById('dadosCompletos');
    container.textContent = JSON.stringify(data, null, 2);
}

function extrairTurmas(data) {
    const turmas = [];
    
    if (Array.isArray(data)) {
        data.forEach(item => {
            if (item.turma || item.nmTurma || item.descTurma) {
                turmas.push({
                    nome: item.nmTurma || item.descTurma || item.turma,
                    serie: item.serie || item.nmSerie,
                    turno: item.turno || item.nmTurno,
                    escola: item.escola || item.nmEstabelecimento,
                    ano: item.anoLetivo || item.ano
                });
            }
        });
    } else if (data && typeof data === 'object') {
        if (data.turmas && Array.isArray(data.turmas)) {
            data.turmas.forEach(t => turmas.push({
                nome: t.nmTurma || t.nome,
                serie: t.serie,
                turno: t.turno,
                escola: t.escola,
                ano: t.anoLetivo
            }));
        }
        
        Object.values(data).forEach(val => {
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (item && (item.turma || item.nmTurma)) {
                        const existe = turmas.some(t => t.nome === (item.nmTurma || item.turma));
                        if (!existe) {
                            turmas.push({
                                nome: item.nmTurma || item.turma,
                                serie: item.serie || item.nmSerie,
                                turno: item.turno,
                                escola: item.nmEstabelecimento,
                                ano: item.anoLetivo
                            });
                        }
                    }
                });
            }
        });
    }

    return turmas;
}

function extrairDisciplinas(data) {
    const disciplinas = [];
    
    if (Array.isArray(data)) {
        data.forEach(item => {
            if (item.disciplina || item.nmDisciplina || item.componente) {
                disciplinas.push({
                    nome: item.nmDisciplina || item.disciplina || item.componente,
                    turma: item.nmTurma || item.turma,
                    cargaHoraria: item.cargaHoraria || item.chTotal,
                    status: item.status || 'Ativa'
                });
            }
        });
    } else if (data && typeof data === 'object') {
        if (data.disciplinas && Array.isArray(data.disciplinas)) {
            data.disciplinas.forEach(d => disciplinas.push({
                nome: d.nmDisciplina || d.nome,
                turma: d.turma,
                cargaHoraria: d.cargaHoraria,
                status: d.status
            }));
        }

        Object.values(data).forEach(val => {
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (item && (item.nmDisciplina || item.disciplina)) {
                        disciplinas.push({
                            nome: item.nmDisciplina || item.disciplina,
                            turma: item.nmTurma,
                            cargaHoraria: item.cargaHoraria,
                            status: 'Ativa'
                        });
                    }
                });
            }
        });
    }

    return disciplinas;
}

function extrairLivros(data) {
    const livros = [];
    
    if (Array.isArray(data)) {
        data.forEach(item => {
            if (item.livro || item.nmLivro || item.livroClasse) {
                livros.push({
                    nome: item.nmLivro || item.livro || item.livroClasse,
                    turma: item.nmTurma || item.turma,
                    disciplina: item.nmDisciplina || item.disciplina,
                    periodo: item.periodo || item.bimestre,
                    status: item.statusLivro || 'Em andamento'
                });
            }
        });
    } else if (data && typeof data === 'object') {
        if (data.livros && Array.isArray(data.livros)) {
            data.livros.forEach(l => livros.push({
                nome: l.nmLivro || l.nome,
                turma: l.turma,
                disciplina: l.disciplina,
                periodo: l.periodo,
                status: l.status
            }));
        }
        
        Object.values(data).forEach(val => {
            if (Array.isArray(val)) {
                val.forEach(item => {
                    if (item && (item.nmLivro || item.livro || item.livroClasse)) {
                        livros.push({
                            nome: item.nmLivro || item.livro || item.livroClasse,
                            turma: item.nmTurma || item.turma,
                            disciplina: item.nmDisciplina || item.disciplina,
                            periodo: item.periodo || item.bimestre,
                            status: item.statusLivro || 'Em andamento'
                        });
                    }
                });
            }
        });
    }

    return livros;
}

function logout() {
    window.location.href = '/';
}
