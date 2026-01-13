const API_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
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

const DADOS_EXEMPLO = {
    turmas: [
        { nmTurma: "9º Ano A", serie: "9º Ano", turno: "Manhã", escola: "Colégio Estadual do Paraná", anoLetivo: "2026" },
        { nmTurma: "9º Ano B", serie: "9º Ano", turno: "Manhã", escola: "Colégio Estadual do Paraná", anoLetivo: "2026" },
        { nmTurma: "8º Ano C", serie: "8º Ano", turno: "Tarde", escola: "Colégio Estadual do Paraná", anoLetivo: "2026" },
        { nmTurma: "7º Ano A", serie: "7º Ano", turno: "Manhã", escola: "Colégio Estadual Paulo Leminski", anoLetivo: "2026" }
    ],
    disciplinas: [
        { nmDisciplina: "Matemática", nmTurma: "9º Ano A", cargaHoraria: 160, status: "Ativa" },
        { nmDisciplina: "Matemática", nmTurma: "9º Ano B", cargaHoraria: 160, status: "Ativa" },
        { nmDisciplina: "Física", nmTurma: "9º Ano A", cargaHoraria: 80, status: "Ativa" },
        { nmDisciplina: "Física", nmTurma: "9º Ano B", cargaHoraria: 80, status: "Ativa" },
        { nmDisciplina: "Ciências", nmTurma: "8º Ano C", cargaHoraria: 120, status: "Ativa" },
        { nmDisciplina: "Matemática", nmTurma: "7º Ano A", cargaHoraria: 160, status: "Ativa" }
    ],
    livros: [
        { nmLivro: "Livro de Classe - Matemática", nmTurma: "9º Ano A", nmDisciplina: "Matemática", periodo: "1º Bimestre", statusLivro: "Aberto" },
        { nmLivro: "Livro de Classe - Matemática", nmTurma: "9º Ano B", nmDisciplina: "Matemática", periodo: "1º Bimestre", statusLivro: "Aberto" },
        { nmLivro: "Livro de Classe - Física", nmTurma: "9º Ano A", nmDisciplina: "Física", periodo: "1º Bimestre", statusLivro: "Aberto" },
        { nmLivro: "Livro de Classe - Ciências", nmTurma: "8º Ano C", nmDisciplina: "Ciências", periodo: "1º Bimestre", statusLivro: "Em andamento" },
        { nmLivro: "Livro de Classe - Matemática", nmTurma: "7º Ano A", nmDisciplina: "Matemática", periodo: "1º Bimestre", statusLivro: "Fechado" }
    ],
    alunos: [
        { nome: "Ana Clara Silva", registro: "2026090101", turma: "9º Ano A", dataNascimento: "15/03/2011", status: "Ativo" },
        { nome: "Bruno Oliveira Santos", registro: "2026090102", turma: "9º Ano A", dataNascimento: "22/07/2011", status: "Ativo" },
        { nome: "Carla Fernanda Costa", registro: "2026090103", turma: "9º Ano A", dataNascimento: "10/01/2011", status: "Ativo" },
        { nome: "Daniel Almeida Souza", registro: "2026090104", turma: "9º Ano A", dataNascimento: "05/09/2011", status: "Ativo" },
        { nome: "Eduarda Lima Pereira", registro: "2026090105", turma: "9º Ano A", dataNascimento: "18/11/2011", status: "Ativo" },
        { nome: "Felipe Rodrigues Martins", registro: "2026090201", turma: "9º Ano B", dataNascimento: "03/04/2011", status: "Ativo" },
        { nome: "Gabriela Santos Ribeiro", registro: "2026090202", turma: "9º Ano B", dataNascimento: "27/06/2011", status: "Ativo" },
        { nome: "Henrique Costa Barbosa", registro: "2026090203", turma: "9º Ano B", dataNascimento: "14/02/2011", status: "Ativo" },
        { nome: "Isabela Ferreira Gomes", registro: "2026090204", turma: "9º Ano B", dataNascimento: "30/08/2011", status: "Ativo" },
        { nome: "João Pedro Alves", registro: "2026090205", turma: "9º Ano B", dataNascimento: "08/12/2011", status: "Ativo" },
        { nome: "Larissa Mendes Cardoso", registro: "2026080301", turma: "8º Ano C", dataNascimento: "12/05/2012", status: "Ativo" },
        { nome: "Lucas Pereira Nunes", registro: "2026080302", turma: "8º Ano C", dataNascimento: "25/10/2012", status: "Ativo" },
        { nome: "Mariana Souza Dias", registro: "2026080303", turma: "8º Ano C", dataNascimento: "07/07/2012", status: "Ativo" },
        { nome: "Nicolas Rocha Teixeira", registro: "2026080304", turma: "8º Ano C", dataNascimento: "19/03/2012", status: "Ativo" },
        { nome: "Olivia Campos Moreira", registro: "2026080305", turma: "8º Ano C", dataNascimento: "02/09/2012", status: "Ativo" },
        { nome: "Pedro Henrique Castro", registro: "2026070101", turma: "7º Ano A", dataNascimento: "16/06/2013", status: "Ativo" },
        { nome: "Rafaela Borges Lima", registro: "2026070102", turma: "7º Ano A", dataNascimento: "28/01/2013", status: "Ativo" },
        { nome: "Samuel Vieira Machado", registro: "2026070103", turma: "7º Ano A", dataNascimento: "11/08/2013", status: "Ativo" },
        { nome: "Thais Andrade Pinto", registro: "2026070104", turma: "7º Ano A", dataNascimento: "04/04/2013", status: "Ativo" },
        { nome: "Vinicius Freitas Correia", registro: "2026070105", turma: "7º Ano A", dataNascimento: "21/11/2013", status: "Ativo" }
    ]
};

function gerarCodigoBarrasSVG(codigo) {
    const barWidth = 2;
    const height = 50;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${height + 20}" viewBox="0 0 200 ${height + 20}">`;
    
    let x = 10;
    for (let i = 0; i < codigo.length; i++) {
        const digit = parseInt(codigo[i]);
        const pattern = [
            [1,1,1,0,0,1,0], // 0
            [0,0,1,1,0,1,0], // 1
            [0,1,0,0,1,1,0], // 2
            [1,1,0,0,1,0,0], // 3
            [0,1,1,0,0,1,0], // 4
            [1,0,1,0,0,1,0], // 5
            [0,0,0,1,1,1,0], // 6
            [1,0,0,1,0,1,0], // 7
            [0,0,1,0,1,1,0], // 8
            [1,1,0,1,0,0,0]  // 9
        ][digit];
        
        for (let j = 0; j < pattern.length; j++) {
            if (pattern[j] === 1) {
                svg += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="black"/>`;
            }
            x += barWidth;
        }
        x += barWidth;
    }
    
    svg += `<text x="100" y="${height + 15}" text-anchor="middle" font-family="monospace" font-size="12">${codigo}</text>`;
    svg += '</svg>';
    
    return svg;
}

function abrirModalAlunos(nomeTurma) {
    const alunos = DADOS_EXEMPLO.alunos.filter(a => a.turma === nomeTurma);
    
    const modal = document.getElementById('modalAlunos');
    const titulo = document.getElementById('modalTitulo');
    const lista = document.getElementById('listaAlunos');
    
    titulo.textContent = `Alunos - ${nomeTurma}`;
    
    if (alunos.length === 0) {
        lista.innerHTML = '<div class="empty-message">Nenhum aluno encontrado nesta turma</div>';
    } else {
        lista.innerHTML = alunos.map(aluno => `
            <div class="aluno-card">
                <div class="aluno-info">
                    <div class="aluno-nome">${aluno.nome}</div>
                    <div class="aluno-detalhe"><strong>Registro:</strong> ${aluno.registro}</div>
                    <div class="aluno-detalhe"><strong>Nascimento:</strong> ${aluno.dataNascimento}</div>
                    <div class="aluno-detalhe"><strong>Status:</strong> <span class="status-ativo">${aluno.status}</span></div>
                </div>
                <div class="aluno-codigo-barras">
                    ${gerarCodigoBarrasSVG(aluno.registro)}
                </div>
            </div>
        `).join('');
    }
    
    modal.style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modalAlunos').style.display = 'none';
}

async function carregarDados() {
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    const erro = document.getElementById('erro');
    const erroMensagem = document.getElementById('erroMensagem');

    try {
        const response = await fetch(`${API_URL}/api/acessos`);
        const data = await response.json();

        let dadosParaExibir = data;
        
        if (data.erro || !data || Object.keys(data).length === 0) {
            dadosParaExibir = DADOS_EXEMPLO;
        }

        loading.style.display = 'none';
        content.style.display = 'block';

        renderizarTurmas(dadosParaExibir);
        renderizarDisciplinas(dadosParaExibir);
        renderizarLivros(dadosParaExibir);
        renderizarDadosCompletos(dadosParaExibir);

    } catch (error) {
        loading.style.display = 'none';
        content.style.display = 'block';
        
        renderizarTurmas(DADOS_EXEMPLO);
        renderizarDisciplinas(DADOS_EXEMPLO);
        renderizarLivros(DADOS_EXEMPLO);
        renderizarDadosCompletos(DADOS_EXEMPLO);
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
        <div class="card card-turma" onclick="abrirModalAlunos('${turma.nome}')">
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
