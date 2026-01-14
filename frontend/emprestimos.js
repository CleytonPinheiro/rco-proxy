let emprestimos = [];
let alunos = [];
let materiais = [];
let alunoSelecionado = null;
let materialSelecionado = null;

document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
});

async function carregarDados() {
    try {
        const [empResp, alunosResp, matResp] = await Promise.all([
            fetch('/api/emprestimos'),
            fetch('/api/alunos'),
            fetch('/api/materiais')
        ]);
        
        if (!empResp.ok || !alunosResp.ok || !matResp.ok) {
            throw new Error('Erro ao carregar dados');
        }
        
        emprestimos = await empResp.json();
        alunos = await alunosResp.json();
        materiais = await matResp.json();
        
        renderizarEmprestimosAtivos();
        renderizarHistorico();
    } catch (erro) {
        console.error('Erro:', erro);
        document.getElementById('listaEmprestimosAtivos').innerHTML = 
            '<div class="empty-message">Erro ao carregar dados. Execute o SQL no Supabase.</div>';
    }
}

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

function formatarData(dataISO) {
    if (!dataISO) return '';
    const data = new Date(dataISO);
    return `${data.getDate().toString().padStart(2, '0')}/${(data.getMonth()+1).toString().padStart(2, '0')}/${data.getFullYear()} ${data.getHours().toString().padStart(2, '0')}:${data.getMinutes().toString().padStart(2, '0')}`;
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
                <h4>${e.aluno?.nome || 'Aluno'}</h4>
                <p><strong>Registro:</strong> ${e.aluno?.registro || ''}</p>
                <p><strong>Turma:</strong> ${e.aluno?.turma || ''}</p>
            </div>
            <div class="emprestimo-material">
                <h4>${e.material?.codigo || ''} - ${e.material?.descricao || ''}</h4>
                <p><strong>Professor:</strong> ${e.professor || 'Não informado'}</p>
                <div class="emprestimo-aulas">
                    ${[1,2,3,4,5,6].map(a => `
                        <span class="aula-badge ${(e.aulas || []).includes(a) ? 'ativa' : 'inativa'}">${a}</span>
                    `).join('')}
                </div>
            </div>
            <div class="emprestimo-acoes">
                <button class="btn-devolver" onclick="abrirModalDevolucao(${e.id})">Devolver</button>
                <span class="emprestimo-hora">${formatarData(e.data_emprestimo)}</span>
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
                <h4>${e.aluno?.nome || 'Aluno'}</h4>
                <p><strong>Registro:</strong> ${e.aluno?.registro || ''}</p>
                <p><strong>Turma:</strong> ${e.aluno?.turma || ''}</p>
            </div>
            <div class="emprestimo-material">
                <h4>${e.material?.codigo || ''} - ${e.material?.descricao || ''}</h4>
                <p><strong>Professor:</strong> ${e.professor || 'Não informado'}</p>
                <div class="emprestimo-aulas">
                    ${[1,2,3,4,5,6].map(a => `
                        <span class="aula-badge ${(e.aulas || []).includes(a) ? 'ativa' : 'inativa'}">${a}</span>
                    `).join('')}
                </div>
            </div>
            <div class="emprestimo-acoes">
                <span class="emprestimo-hora">
                    <strong>Empréstimo:</strong> ${formatarData(e.data_emprestimo)}<br>
                    <strong>Devolução:</strong> ${formatarData(e.data_devolucao)}
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

async function buscarAluno() {
    const registro = document.getElementById('alunoRegistro').value.trim();
    const infoDiv = document.getElementById('alunoInfo');
    
    if (!registro) {
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Digite o registro do aluno';
        return;
    }
    
    try {
        const response = await fetch(`/api/alunos/${registro}`);
        if (response.ok) {
            const aluno = await response.json();
            alunoSelecionado = aluno;
            infoDiv.className = 'info-preview show sucesso';
            infoDiv.innerHTML = `<strong>${aluno.nome}</strong><br>Turma: ${aluno.turma}`;
        } else {
            alunoSelecionado = null;
            infoDiv.className = 'info-preview show erro';
            infoDiv.innerHTML = 'Aluno não encontrado';
        }
    } catch (erro) {
        alunoSelecionado = null;
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Erro ao buscar aluno';
    }
}

async function buscarMaterial() {
    const codigo = document.getElementById('materialCodigo').value.trim().toUpperCase();
    const infoDiv = document.getElementById('materialInfo');
    
    if (!codigo) {
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Digite o código do material';
        return;
    }
    
    try {
        const response = await fetch(`/api/materiais/${codigo}`);
        if (response.ok) {
            const material = await response.json();
            if (material.status !== 'disponivel') {
                materialSelecionado = null;
                infoDiv.className = 'info-preview show erro';
                infoDiv.innerHTML = `${material.descricao}<br><strong>Status: Material não disponível</strong>`;
                return;
            }
            materialSelecionado = material;
            infoDiv.className = 'info-preview show sucesso';
            infoDiv.innerHTML = `<strong>${material.descricao}</strong><br>Código: ${material.codigo}`;
        } else {
            materialSelecionado = null;
            infoDiv.className = 'info-preview show erro';
            infoDiv.innerHTML = 'Material não encontrado';
        }
    } catch (erro) {
        materialSelecionado = null;
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Erro ao buscar material';
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

async function registrarEmprestimo(e) {
    e.preventDefault();
    
    if (!alunoSelecionado) {
        await buscarAluno();
        if (!alunoSelecionado) {
            alert('Por favor, busque e selecione um aluno válido');
            return;
        }
    }
    
    if (!materialSelecionado) {
        await buscarMaterial();
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
    
    try {
        const response = await fetch('/api/emprestimos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_registro: alunoSelecionado.registro,
                material_codigo: materialSelecionado.codigo,
                professor: document.getElementById('professorResponsavel').value,
                aulas: aulas,
                observacoes: document.getElementById('observacoes').value
            })
        });
        
        if (!response.ok) {
            const erro = await response.json();
            throw new Error(erro.erro || 'Erro ao registrar');
        }
        
        fecharModalEmprestimo();
        await carregarDados();
        alert(`Empréstimo registrado com sucesso!\n\nAluno: ${alunoSelecionado.nome}\nMaterial: ${materialSelecionado.codigo}`);
    } catch (erro) {
        alert('Erro: ' + erro.message);
    }
}

function abrirModalDevolucao(id) {
    const emprestimo = emprestimos.find(e => e.id === id);
    if (!emprestimo) return;
    
    document.getElementById('emprestimoIdDevolucao').value = id;
    document.getElementById('infoDevolucao').innerHTML = `
        <div class="devolucao-info">
            <p><strong>Aluno:</strong> ${emprestimo.aluno?.nome || ''}</p>
            <p><strong>Material:</strong> ${emprestimo.material?.codigo || ''} - ${emprestimo.material?.descricao || ''}</p>
            <p><strong>Emprestado em:</strong> ${formatarData(emprestimo.data_emprestimo)}</p>
        </div>
    `;
    document.getElementById('estadoDevolucao').value = 'otimo';
    document.getElementById('obsDevolucao').value = '';
    document.getElementById('modalDevolucao').style.display = 'flex';
}

function fecharModalDevolucao() {
    document.getElementById('modalDevolucao').style.display = 'none';
}

async function confirmarDevolucao(e) {
    e.preventDefault();
    
    const id = document.getElementById('emprestimoIdDevolucao').value;
    
    try {
        const response = await fetch(`/api/emprestimos/${id}/devolver`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estado_devolucao: document.getElementById('estadoDevolucao').value,
                observacoes_devolucao: document.getElementById('obsDevolucao').value
            })
        });
        
        if (!response.ok) {
            const erro = await response.json();
            throw new Error(erro.erro || 'Erro ao devolver');
        }
        
        fecharModalDevolucao();
        await carregarDados();
        alert('Devolução registrada com sucesso!');
    } catch (erro) {
        alert('Erro: ' + erro.message);
    }
}
