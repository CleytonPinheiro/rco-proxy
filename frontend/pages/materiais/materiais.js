const TIPOS_MATERIAL = {
    'tablet': { nome: 'Tablet', icone: '📱' },
    'notebook': { nome: 'Notebook', icone: '💻' },
    'calculadora': { nome: 'Calculadora', icone: '🔢' },
    'kit_laboratorio': { nome: 'Kit Laboratório', icone: '🔬' },
    'esportivo': { nome: 'Material Esportivo', icone: '⚽' },
    'outro': { nome: 'Outro', icone: '📦' }
};

const ESTADOS = {
    'otimo': 'Ótimo',
    'bom': 'Bom',
    'regular': 'Regular',
    'ruim': 'Necessita Reparo'
};

let materiais = [];

document.addEventListener('DOMContentLoaded', () => {
    carregarMateriais();
});

async function carregarMateriais() {
    try {
        const response = await fetch('/api/materiais');
        if (!response.ok) throw new Error('Erro ao carregar');
        materiais = await response.json();
        renderizarMateriais();
        atualizarEstatisticas();
    } catch (erro) {
        console.error('Erro:', erro);
        document.getElementById('listaMateriais').innerHTML = 
            '<div class="empty-message">Erro ao carregar materiais. Execute o SQL no Supabase.</div>';
    }
}

function gerarCodigoBarrasSVG(codigo) {
    const barWidth = 2;
    const height = 40;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="${height + 15}" viewBox="0 0 160 ${height + 15}">`;
    
    let x = 5;
    const chars = codigo.replace(/-/g, '').toUpperCase();
    for (let i = 0; i < chars.length; i++) {
        const charCode = chars.charCodeAt(i);
        const pattern = [];
        for (let j = 0; j < 5; j++) {
            pattern.push((charCode >> j) & 1);
        }
        
        for (let j = 0; j < pattern.length; j++) {
            if (pattern[j] === 1) {
                svg += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="black"/>`;
            }
            x += barWidth;
        }
        x += barWidth;
    }
    
    svg += `<text x="80" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="10">${codigo}</text>`;
    svg += '</svg>';
    
    return svg;
}

function renderizarMateriais() {
    const container = document.getElementById('listaMateriais');
    const busca = document.getElementById('busca').value.toLowerCase();
    const filtroTipo = document.getElementById('filtroTipo').value;
    const filtroStatus = document.getElementById('filtroStatus').value;

    let materiaisFiltrados = materiais.filter(m => {
        const matchBusca = m.codigo.toLowerCase().includes(busca) || 
                          m.descricao.toLowerCase().includes(busca) ||
                          (m.localizacao || '').toLowerCase().includes(busca);
        const matchTipo = !filtroTipo || m.tipo === filtroTipo;
        const matchStatus = !filtroStatus || m.status === filtroStatus;
        return matchBusca && matchTipo && matchStatus;
    });

    if (materiaisFiltrados.length === 0) {
        container.innerHTML = '<div class="empty-message">Nenhum material encontrado</div>';
        return;
    }

    container.innerHTML = materiaisFiltrados.map(m => `
        <div class="material-card">
            <div class="material-acoes">
                <button class="btn-icon editar" onclick="editarMaterial(${m.id})" title="Editar">✏️</button>
                <button class="btn-icon excluir" onclick="excluirMaterial(${m.id})" title="Excluir">🗑️</button>
            </div>
            <div class="material-codigo">
                <span class="tipo-icon">${TIPOS_MATERIAL[m.tipo]?.icone || '📦'}</span>
                ${m.codigo}
            </div>
            <div class="material-descricao">${m.descricao}</div>
            <div class="material-info"><strong>Tipo:</strong> ${TIPOS_MATERIAL[m.tipo]?.nome || m.tipo}</div>
            <div class="material-info"><strong>Local:</strong> ${m.localizacao || 'Não informado'}</div>
            <div class="material-info"><strong>Estado:</strong> ${ESTADOS[m.estado] || m.estado}</div>
            <span class="material-status ${m.status}">${getStatusLabel(m.status)}</span>
            <div class="material-barcode">
                ${gerarCodigoBarrasSVG(m.codigo)}
            </div>
        </div>
    `).join('');
}

function getStatusLabel(status) {
    const labels = {
        'disponivel': 'Disponível',
        'emprestado': 'Emprestado',
        'manutencao': 'Em Manutenção'
    };
    return labels[status] || status;
}

function atualizarEstatisticas() {
    document.getElementById('totalMateriais').textContent = materiais.length;
    document.getElementById('totalDisponiveis').textContent = materiais.filter(m => m.status === 'disponivel').length;
    document.getElementById('totalEmprestados').textContent = materiais.filter(m => m.status === 'emprestado').length;
    document.getElementById('totalManutencao').textContent = materiais.filter(m => m.status === 'manutencao').length;
}

function filtrarMateriais() {
    renderizarMateriais();
}

function abrirModalCadastro() {
    document.getElementById('modalTituloCadastro').textContent = 'Novo Material';
    document.getElementById('formMaterial').reset();
    document.getElementById('materialId').value = '';
    document.getElementById('modalCadastro').style.display = 'flex';
}

function fecharModalCadastro() {
    document.getElementById('modalCadastro').style.display = 'none';
}

async function salvarMaterial(e) {
    e.preventDefault();
    
    const id = document.getElementById('materialId').value;
    const material = {
        codigo: document.getElementById('codigo').value.toUpperCase(),
        tipo: document.getElementById('tipo').value,
        descricao: document.getElementById('descricao').value,
        localizacao: document.getElementById('localizacao').value,
        estado: document.getElementById('estado').value,
        status: document.getElementById('status').value
    };

    try {
        let response;
        if (id) {
            response = await fetch(`/api/materiais/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(material)
            });
        } else {
            response = await fetch('/api/materiais', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(material)
            });
        }
        
        if (!response.ok) {
            const erro = await response.json();
            throw new Error(erro.erro || 'Erro ao salvar');
        }
        
        fecharModalCadastro();
        await carregarMateriais();
        alert(id ? 'Material atualizado!' : 'Material cadastrado!');
    } catch (erro) {
        alert('Erro: ' + erro.message);
    }
}

function editarMaterial(id) {
    const material = materiais.find(m => m.id === id);
    if (!material) return;

    document.getElementById('modalTituloCadastro').textContent = 'Editar Material';
    document.getElementById('materialId').value = material.id;
    document.getElementById('codigo').value = material.codigo;
    document.getElementById('tipo').value = material.tipo;
    document.getElementById('descricao').value = material.descricao;
    document.getElementById('localizacao').value = material.localizacao || '';
    document.getElementById('estado').value = material.estado;
    document.getElementById('status').value = material.status;

    document.getElementById('modalCadastro').style.display = 'flex';
}

async function excluirMaterial(id) {
    const material = materiais.find(m => m.id === id);
    if (!material) return;
    
    if (material.status === 'emprestado') {
        alert('Não é possível excluir um material emprestado.');
        return;
    }
    
    if (!confirm(`Deseja excluir o material ${material.codigo}?`)) return;
    
    try {
        const response = await fetch(`/api/materiais/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Erro ao excluir');
        
        await carregarMateriais();
        alert('Material excluído!');
    } catch (erro) {
        alert('Erro: ' + erro.message);
    }
}
