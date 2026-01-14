const TIPOS_MATERIAL = {
    'tablet': { nome: 'Tablet', icone: '📱' },
    'notebook': { nome: 'Notebook', icone: '💻' },
    'calculadora': { nome: 'Calculadora', icone: '🔢' },
    'kit-lab': { nome: 'Kit Laboratório', icone: '🔬' },
    'esportivo': { nome: 'Material Esportivo', icone: '⚽' },
    'outro': { nome: 'Outro', icone: '📦' }
};

const ESTADOS = {
    'otimo': 'Ótimo',
    'bom': 'Bom',
    'regular': 'Regular',
    'ruim': 'Necessita Reparo'
};

let materiais = [
    { id: 1, codigo: 'TAB-001', tipo: 'tablet', descricao: 'Samsung Galaxy Tab A7', localizacao: 'Sala 12, Armário 1', estado: 'otimo', status: 'disponivel' },
    { id: 2, codigo: 'TAB-002', tipo: 'tablet', descricao: 'Samsung Galaxy Tab A7', localizacao: 'Sala 12, Armário 1', estado: 'bom', status: 'emprestado' },
    { id: 3, codigo: 'TAB-003', tipo: 'tablet', descricao: 'Samsung Galaxy Tab A7', localizacao: 'Sala 12, Armário 1', estado: 'otimo', status: 'disponivel' },
    { id: 4, codigo: 'TAB-004', tipo: 'tablet', descricao: 'Samsung Galaxy Tab S6 Lite', localizacao: 'Sala 12, Armário 2', estado: 'otimo', status: 'disponivel' },
    { id: 5, codigo: 'TAB-005', tipo: 'tablet', descricao: 'Samsung Galaxy Tab S6 Lite', localizacao: 'Sala 12, Armário 2', estado: 'regular', status: 'manutencao' },
    { id: 6, codigo: 'NOT-001', tipo: 'notebook', descricao: 'Dell Inspiron 15', localizacao: 'Laboratório Info', estado: 'bom', status: 'disponivel' },
    { id: 7, codigo: 'NOT-002', tipo: 'notebook', descricao: 'Dell Inspiron 15', localizacao: 'Laboratório Info', estado: 'bom', status: 'emprestado' },
    { id: 8, codigo: 'NOT-003', tipo: 'notebook', descricao: 'Lenovo IdeaPad 3', localizacao: 'Laboratório Info', estado: 'otimo', status: 'disponivel' },
    { id: 9, codigo: 'CALC-001', tipo: 'calculadora', descricao: 'Casio FX-82MS', localizacao: 'Sala Matemática', estado: 'otimo', status: 'disponivel' },
    { id: 10, codigo: 'CALC-002', tipo: 'calculadora', descricao: 'Casio FX-82MS', localizacao: 'Sala Matemática', estado: 'bom', status: 'disponivel' },
    { id: 11, codigo: 'CALC-003', tipo: 'calculadora', descricao: 'Casio FX-991ES Plus', localizacao: 'Sala Matemática', estado: 'otimo', status: 'emprestado' },
    { id: 12, codigo: 'LAB-001', tipo: 'kit-lab', descricao: 'Kit Microscópio Óptico', localizacao: 'Lab. Ciências', estado: 'bom', status: 'disponivel' },
    { id: 13, codigo: 'LAB-002', tipo: 'kit-lab', descricao: 'Kit Química Básica', localizacao: 'Lab. Ciências', estado: 'otimo', status: 'disponivel' },
    { id: 14, codigo: 'LAB-003', tipo: 'kit-lab', descricao: 'Kit Eletricidade', localizacao: 'Lab. Física', estado: 'regular', status: 'manutencao' },
    { id: 15, codigo: 'ESP-001', tipo: 'esportivo', descricao: 'Kit Voleibol (rede + bola)', localizacao: 'Depósito Ed. Física', estado: 'bom', status: 'disponivel' },
    { id: 16, codigo: 'ESP-002', tipo: 'esportivo', descricao: 'Kit Basquete (5 bolas)', localizacao: 'Depósito Ed. Física', estado: 'otimo', status: 'emprestado' },
    { id: 17, codigo: 'ESP-003', tipo: 'esportivo', descricao: 'Kit Futebol (10 bolas)', localizacao: 'Depósito Ed. Física', estado: 'bom', status: 'disponivel' }
];

let proximoId = 18;

document.addEventListener('DOMContentLoaded', () => {
    renderizarMateriais();
    atualizarEstatisticas();
});

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
                          m.localizacao.toLowerCase().includes(busca);
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

function salvarMaterial(e) {
    e.preventDefault();
    
    const id = document.getElementById('materialId').value;
    const material = {
        codigo: document.getElementById('codigo').value,
        tipo: document.getElementById('tipo').value,
        descricao: document.getElementById('descricao').value,
        localizacao: document.getElementById('localizacao').value,
        estado: document.getElementById('estado').value,
        status: document.getElementById('status').value
    };

    if (id) {
        const index = materiais.findIndex(m => m.id === parseInt(id));
        if (index !== -1) {
            materiais[index] = { ...materiais[index], ...material };
        }
    } else {
        material.id = proximoId++;
        materiais.push(material);
    }

    fecharModalCadastro();
    renderizarMateriais();
    atualizarEstatisticas();
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

function excluirMaterial(id) {
    if (confirm('Tem certeza que deseja excluir este material?')) {
        materiais = materiais.filter(m => m.id !== id);
        renderizarMateriais();
        atualizarEstatisticas();
    }
}

if (typeof window !== 'undefined') {
    window.materiais = materiais;
}
