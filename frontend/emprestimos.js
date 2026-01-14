const ALUNOS = [
    { nome: "Ana Clara Silva", registro: "2026090101", turma: "9º Ano A" },
    { nome: "Bruno Oliveira Santos", registro: "2026090102", turma: "9º Ano A" },
    { nome: "Carla Fernanda Costa", registro: "2026090103", turma: "9º Ano A" },
    { nome: "Daniel Almeida Souza", registro: "2026090104", turma: "9º Ano A" },
    { nome: "Eduarda Lima Pereira", registro: "2026090105", turma: "9º Ano A" },
    { nome: "Felipe Rodrigues Martins", registro: "2026090201", turma: "9º Ano B" },
    { nome: "Gabriela Santos Ribeiro", registro: "2026090202", turma: "9º Ano B" },
    { nome: "Henrique Costa Barbosa", registro: "2026090203", turma: "9º Ano B" },
    { nome: "Isabela Ferreira Gomes", registro: "2026090204", turma: "9º Ano B" },
    { nome: "João Pedro Alves", registro: "2026090205", turma: "9º Ano B" },
    { nome: "Larissa Mendes Cardoso", registro: "2026080301", turma: "8º Ano C" },
    { nome: "Lucas Pereira Nunes", registro: "2026080302", turma: "8º Ano C" },
    { nome: "Mariana Souza Dias", registro: "2026080303", turma: "8º Ano C" },
    { nome: "Nicolas Rocha Teixeira", registro: "2026080304", turma: "8º Ano C" },
    { nome: "Olivia Campos Moreira", registro: "2026080305", turma: "8º Ano C" },
    { nome: "Pedro Henrique Castro", registro: "2026070101", turma: "7º Ano A" },
    { nome: "Rafaela Borges Lima", registro: "2026070102", turma: "7º Ano A" },
    { nome: "Samuel Vieira Machado", registro: "2026070103", turma: "7º Ano A" },
    { nome: "Thais Andrade Pinto", registro: "2026070104", turma: "7º Ano A" },
    { nome: "Vinicius Freitas Correia", registro: "2026070105", turma: "7º Ano A" }
];

const MATERIAIS = [
    { id: 1, codigo: 'TAB-001', tipo: 'tablet', descricao: 'Samsung Galaxy Tab A7', status: 'disponivel' },
    { id: 2, codigo: 'TAB-002', tipo: 'tablet', descricao: 'Samsung Galaxy Tab A7', status: 'emprestado' },
    { id: 3, codigo: 'TAB-003', tipo: 'tablet', descricao: 'Samsung Galaxy Tab A7', status: 'disponivel' },
    { id: 4, codigo: 'TAB-004', tipo: 'tablet', descricao: 'Samsung Galaxy Tab S6 Lite', status: 'disponivel' },
    { id: 6, codigo: 'NOT-001', tipo: 'notebook', descricao: 'Dell Inspiron 15', status: 'disponivel' },
    { id: 7, codigo: 'NOT-002', tipo: 'notebook', descricao: 'Dell Inspiron 15', status: 'emprestado' },
    { id: 9, codigo: 'CALC-001', tipo: 'calculadora', descricao: 'Casio FX-82MS', status: 'disponivel' },
    { id: 11, codigo: 'CALC-003', tipo: 'calculadora', descricao: 'Casio FX-991ES Plus', status: 'emprestado' }
];

let emprestimos = [
    {
        id: 1,
        aluno: { nome: "Bruno Oliveira Santos", registro: "2026090102", turma: "9º Ano A" },
        material: { codigo: 'TAB-002', descricao: 'Samsung Galaxy Tab A7' },
        professor: "Prof. Maria Silva",
        aulas: [1, 2, 3],
        dataEmprestimo: "14/01/2026 07:25",
        status: 'ativo',
        observacoes: ""
    },
    {
        id: 2,
        aluno: { nome: "Isabela Ferreira Gomes", registro: "2026090204", turma: "9º Ano B" },
        material: { codigo: 'NOT-002', descricao: 'Dell Inspiron 15' },
        professor: "Prof. Carlos Santos",
        aulas: [4, 5, 6],
        dataEmprestimo: "14/01/2026 10:15",
        status: 'ativo',
        observacoes: "Para trabalho de pesquisa"
    },
    {
        id: 3,
        aluno: { nome: "Lucas Pereira Nunes", registro: "2026080302", turma: "8º Ano C" },
        material: { codigo: 'CALC-003', descricao: 'Casio FX-991ES Plus' },
        professor: "Prof. Ana Paula",
        aulas: [3, 4],
        dataEmprestimo: "14/01/2026 09:25",
        status: 'ativo',
        observacoes: ""
    },
    {
        id: 4,
        aluno: { nome: "Ana Clara Silva", registro: "2026090101", turma: "9º Ano A" },
        material: { codigo: 'TAB-001', descricao: 'Samsung Galaxy Tab A7' },
        professor: "Prof. Roberto Lima",
        aulas: [1, 2],
        dataEmprestimo: "13/01/2026 07:30",
        dataDevolucao: "13/01/2026 09:15",
        status: 'devolvido',
        estadoDevolucao: 'otimo',
        observacoes: ""
    },
    {
        id: 5,
        aluno: { nome: "Pedro Henrique Castro", registro: "2026070101", turma: "7º Ano A" },
        material: { codigo: 'NOT-001', descricao: 'Dell Inspiron 15' },
        professor: "Prof. Fernanda Costa",
        aulas: [1, 2, 3, 4, 5, 6],
        dataEmprestimo: "13/01/2026 07:30",
        dataDevolucao: "13/01/2026 12:50",
        status: 'devolvido',
        estadoDevolucao: 'bom',
        observacoes: "Projeto de programação"
    }
];

let proximoIdEmprestimo = 6;
let alunoSelecionado = null;
let materialSelecionado = null;

document.addEventListener('DOMContentLoaded', () => {
    renderizarEmprestimosAtivos();
    renderizarHistorico();
});

function trocarTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    
    if (tab === 'ativos') {
        document.querySelector('.tab:nth-child(1)').classList.add('active');
        document.getElementById('tabAtivos').style.display = 'block';
    } else {
        document.querySelector('.tab:nth-child(2)').classList.add('active');
        document.getElementById('tabHistorico').style.display = 'block';
    }
}

function renderizarEmprestimosAtivos() {
    const container = document.getElementById('listaEmprestimosAtivos');
    const ativos = emprestimos.filter(e => e.status === 'ativo');
    
    if (ativos.length === 0) {
        container.innerHTML = '<div class="empty-message">Nenhum empréstimo ativo no momento</div>';
        return;
    }
    
    container.innerHTML = ativos.map(e => `
        <div class="emprestimo-card ativo">
            <div class="emprestimo-aluno">
                <h4>${e.aluno.nome}</h4>
                <p><strong>Registro:</strong> ${e.aluno.registro}</p>
                <p><strong>Turma:</strong> ${e.aluno.turma}</p>
            </div>
            <div class="emprestimo-material">
                <h4>${e.material.codigo} - ${e.material.descricao}</h4>
                <p><strong>Professor:</strong> ${e.professor || 'Não informado'}</p>
                <div class="emprestimo-aulas">
                    ${[1,2,3,4,5,6].map(a => `
                        <span class="aula-badge ${e.aulas.includes(a) ? 'ativa' : 'inativa'}">${a}</span>
                    `).join('')}
                </div>
            </div>
            <div class="emprestimo-acoes">
                <button class="btn-devolver" onclick="abrirModalDevolucao(${e.id})">Devolver</button>
                <span class="emprestimo-hora">${e.dataEmprestimo}</span>
            </div>
        </div>
    `).join('');
}

function renderizarHistorico() {
    const container = document.getElementById('listaHistorico');
    const historico = emprestimos.filter(e => e.status === 'devolvido').reverse();
    
    if (historico.length === 0) {
        container.innerHTML = '<div class="empty-message">Nenhum empréstimo no histórico</div>';
        return;
    }
    
    container.innerHTML = historico.map(e => `
        <div class="emprestimo-card devolvido">
            <div class="emprestimo-aluno">
                <h4>${e.aluno.nome}</h4>
                <p><strong>Registro:</strong> ${e.aluno.registro}</p>
                <p><strong>Turma:</strong> ${e.aluno.turma}</p>
            </div>
            <div class="emprestimo-material">
                <h4>${e.material.codigo} - ${e.material.descricao}</h4>
                <p><strong>Professor:</strong> ${e.professor || 'Não informado'}</p>
                <div class="emprestimo-aulas">
                    ${[1,2,3,4,5,6].map(a => `
                        <span class="aula-badge ${e.aulas.includes(a) ? 'ativa' : 'inativa'}">${a}</span>
                    `).join('')}
                </div>
            </div>
            <div class="emprestimo-acoes">
                <span class="emprestimo-hora">
                    <strong>Empréstimo:</strong> ${e.dataEmprestimo}<br>
                    <strong>Devolução:</strong> ${e.dataDevolucao}
                </span>
            </div>
        </div>
    `).join('');
}

function abrirModalEmprestimo() {
    document.getElementById('formEmprestimo').reset();
    document.getElementById('alunoInfo').className = 'info-preview';
    document.getElementById('alunoInfo').innerHTML = '';
    document.getElementById('materialInfo').className = 'info-preview';
    document.getElementById('materialInfo').innerHTML = '';
    alunoSelecionado = null;
    materialSelecionado = null;
    document.getElementById('modalEmprestimo').style.display = 'flex';
}

function fecharModalEmprestimo() {
    document.getElementById('modalEmprestimo').style.display = 'none';
}

function buscarAluno() {
    const registro = document.getElementById('alunoRegistro').value.trim();
    const infoDiv = document.getElementById('alunoInfo');
    
    if (!registro) {
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Digite o registro do aluno';
        return;
    }
    
    const aluno = ALUNOS.find(a => a.registro === registro);
    
    if (aluno) {
        alunoSelecionado = aluno;
        infoDiv.className = 'info-preview show sucesso';
        infoDiv.innerHTML = `
            <strong>${aluno.nome}</strong><br>
            Turma: ${aluno.turma}
        `;
    } else {
        alunoSelecionado = null;
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Aluno não encontrado';
    }
}

function buscarMaterial() {
    const codigo = document.getElementById('materialCodigo').value.trim().toUpperCase();
    const infoDiv = document.getElementById('materialInfo');
    
    if (!codigo) {
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Digite o código do material';
        return;
    }
    
    const material = MATERIAIS.find(m => m.codigo === codigo);
    
    if (material) {
        if (material.status !== 'disponivel') {
            materialSelecionado = null;
            infoDiv.className = 'info-preview show erro';
            infoDiv.innerHTML = `${material.descricao}<br><strong>Status: Material não disponível</strong>`;
            return;
        }
        materialSelecionado = material;
        infoDiv.className = 'info-preview show sucesso';
        infoDiv.innerHTML = `
            <strong>${material.descricao}</strong><br>
            Código: ${material.codigo}
        `;
    } else {
        materialSelecionado = null;
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Material não encontrado';
    }
}

function selecionarTodasAulas() {
    for (let i = 1; i <= 6; i++) {
        document.getElementById(`aula${i}`).checked = true;
    }
}

function limparAulas() {
    for (let i = 1; i <= 6; i++) {
        document.getElementById(`aula${i}`).checked = false;
    }
}

function registrarEmprestimo(e) {
    e.preventDefault();
    
    if (!alunoSelecionado) {
        buscarAluno();
        if (!alunoSelecionado) {
            alert('Por favor, busque e selecione um aluno válido');
            return;
        }
    }
    
    if (!materialSelecionado) {
        buscarMaterial();
        if (!materialSelecionado) {
            alert('Por favor, busque e selecione um material disponível');
            return;
        }
    }
    
    const aulas = [];
    for (let i = 1; i <= 6; i++) {
        if (document.getElementById(`aula${i}`).checked) {
            aulas.push(i);
        }
    }
    
    if (aulas.length === 0) {
        alert('Por favor, selecione pelo menos uma aula');
        return;
    }
    
    const agora = new Date();
    const dataFormatada = `${agora.getDate().toString().padStart(2, '0')}/${(agora.getMonth()+1).toString().padStart(2, '0')}/${agora.getFullYear()} ${agora.getHours().toString().padStart(2, '0')}:${agora.getMinutes().toString().padStart(2, '0')}`;
    
    const emprestimo = {
        id: proximoIdEmprestimo++,
        aluno: { ...alunoSelecionado },
        material: { codigo: materialSelecionado.codigo, descricao: materialSelecionado.descricao },
        professor: document.getElementById('professorResponsavel').value,
        aulas: aulas,
        dataEmprestimo: dataFormatada,
        status: 'ativo',
        observacoes: document.getElementById('observacoes').value
    };
    
    emprestimos.push(emprestimo);
    
    const matIndex = MATERIAIS.findIndex(m => m.codigo === materialSelecionado.codigo);
    if (matIndex !== -1) {
        MATERIAIS[matIndex].status = 'emprestado';
    }
    
    fecharModalEmprestimo();
    renderizarEmprestimosAtivos();
    
    alert(`Empréstimo registrado com sucesso!\n\nAluno: ${emprestimo.aluno.nome}\nMaterial: ${emprestimo.material.codigo}`);
}

function abrirModalDevolucao(id) {
    const emprestimo = emprestimos.find(e => e.id === id);
    if (!emprestimo) return;
    
    document.getElementById('emprestimoIdDevolucao').value = id;
    document.getElementById('infoDevolucao').innerHTML = `
        <div class="devolucao-info">
            <p><strong>Aluno:</strong> ${emprestimo.aluno.nome}</p>
            <p><strong>Material:</strong> ${emprestimo.material.codigo} - ${emprestimo.material.descricao}</p>
            <p><strong>Emprestado em:</strong> ${emprestimo.dataEmprestimo}</p>
        </div>
    `;
    document.getElementById('estadoDevolucao').value = 'otimo';
    document.getElementById('obsDevolucao').value = '';
    document.getElementById('modalDevolucao').style.display = 'flex';
}

function fecharModalDevolucao() {
    document.getElementById('modalDevolucao').style.display = 'none';
}

function confirmarDevolucao(e) {
    e.preventDefault();
    
    const id = parseInt(document.getElementById('emprestimoIdDevolucao').value);
    const emprestimo = emprestimos.find(e => e.id === id);
    if (!emprestimo) return;
    
    const agora = new Date();
    const dataFormatada = `${agora.getDate().toString().padStart(2, '0')}/${(agora.getMonth()+1).toString().padStart(2, '0')}/${agora.getFullYear()} ${agora.getHours().toString().padStart(2, '0')}:${agora.getMinutes().toString().padStart(2, '0')}`;
    
    emprestimo.status = 'devolvido';
    emprestimo.dataDevolucao = dataFormatada;
    emprestimo.estadoDevolucao = document.getElementById('estadoDevolucao').value;
    emprestimo.observacoesDevolucao = document.getElementById('obsDevolucao').value;
    
    const matIndex = MATERIAIS.findIndex(m => m.codigo === emprestimo.material.codigo);
    if (matIndex !== -1) {
        MATERIAIS[matIndex].status = 'disponivel';
    }
    
    fecharModalDevolucao();
    renderizarEmprestimosAtivos();
    renderizarHistorico();
    
    alert('Devolução registrada com sucesso!');
}
