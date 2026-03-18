const API_URL = window.location.origin;

let dadosGlobais = null;
let colegioSelecionado = null;

document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    document.getElementById('btnLogout').addEventListener('click', logout);
    document.getElementById('btnVoltar').addEventListener('click', () => {
        window.location.href = '/';
    });
});

// ── Dados de exemplo (fallback) ───────────────────────────────────────────────
const DADOS_EXEMPLO = {
    turmas: [
        { nmTurma: "9º Ano A", serie: "9º Ano", turno: "Manhã", escola: "Colégio Estadual do Paraná", anoLetivo: "2026" },
        { nmTurma: "9º Ano B", serie: "9º Ano", turno: "Manhã", escola: "Colégio Estadual do Paraná", anoLetivo: "2026" },
        { nmTurma: "8º Ano C", serie: "8º Ano", turno: "Tarde",  escola: "Colégio Estadual do Paraná", anoLetivo: "2026" },
        { nmTurma: "7º Ano A", serie: "7º Ano", turno: "Manhã", escola: "Colégio Estadual Paulo Leminski", anoLetivo: "2026" }
    ],
    disciplinas: [
        { nmDisciplina: "Matemática", nmTurma: "9º Ano A", cargaHoraria: 160, status: "Ativa", escola: "Colégio Estadual do Paraná" },
        { nmDisciplina: "Matemática", nmTurma: "9º Ano B", cargaHoraria: 160, status: "Ativa", escola: "Colégio Estadual do Paraná" },
        { nmDisciplina: "Física",     nmTurma: "9º Ano A", cargaHoraria: 80,  status: "Ativa", escola: "Colégio Estadual do Paraná" },
        { nmDisciplina: "Física",     nmTurma: "9º Ano B", cargaHoraria: 80,  status: "Ativa", escola: "Colégio Estadual do Paraná" },
        { nmDisciplina: "Ciências",   nmTurma: "8º Ano C", cargaHoraria: 120, status: "Ativa", escola: "Colégio Estadual do Paraná" },
        { nmDisciplina: "Matemática", nmTurma: "7º Ano A", cargaHoraria: 160, status: "Ativa", escola: "Colégio Estadual Paulo Leminski" }
    ],
    livros: [
        { nmLivro: "Livro de Classe - Matemática", nmTurma: "9º Ano A", nmDisciplina: "Matemática", periodo: "1º Bimestre", statusLivro: "Aberto",      escola: "Colégio Estadual do Paraná" },
        { nmLivro: "Livro de Classe - Matemática", nmTurma: "9º Ano B", nmDisciplina: "Matemática", periodo: "1º Bimestre", statusLivro: "Aberto",      escola: "Colégio Estadual do Paraná" },
        { nmLivro: "Livro de Classe - Física",     nmTurma: "9º Ano A", nmDisciplina: "Física",     periodo: "1º Bimestre", statusLivro: "Aberto",      escola: "Colégio Estadual do Paraná" },
        { nmLivro: "Livro de Classe - Ciências",   nmTurma: "8º Ano C", nmDisciplina: "Ciências",   periodo: "1º Bimestre", statusLivro: "Em andamento", escola: "Colégio Estadual do Paraná" },
        { nmLivro: "Livro de Classe - Matemática", nmTurma: "7º Ano A", nmDisciplina: "Matemática", periodo: "1º Bimestre", statusLivro: "Fechado",     escola: "Colégio Estadual Paulo Leminski" }
    ],
    alunos: [
        { nome: "Ana Clara Silva",        registro: "2026090101", turma: "9º Ano A", dataNascimento: "15/03/2011", status: "Ativo" },
        { nome: "Bruno Oliveira Santos",  registro: "2026090102", turma: "9º Ano A", dataNascimento: "22/07/2011", status: "Ativo" },
        { nome: "Carla Fernanda Costa",   registro: "2026090103", turma: "9º Ano A", dataNascimento: "10/01/2011", status: "Ativo" },
        { nome: "Felipe Rodrigues",       registro: "2026090201", turma: "9º Ano B", dataNascimento: "03/04/2011", status: "Ativo" },
        { nome: "Gabriela Santos",        registro: "2026090202", turma: "9º Ano B", dataNascimento: "27/06/2011", status: "Ativo" },
        { nome: "Larissa Mendes",         registro: "2026080301", turma: "8º Ano C", dataNascimento: "12/05/2012", status: "Ativo" },
        { nome: "Lucas Pereira",          registro: "2026080302", turma: "8º Ano C", dataNascimento: "25/10/2012", status: "Ativo" },
        { nome: "Pedro Henrique Castro",  registro: "2026070101", turma: "7º Ano A", dataNascimento: "16/06/2013", status: "Ativo" },
        { nome: "Rafaela Borges Lima",    registro: "2026070102", turma: "7º Ano A", dataNascimento: "28/01/2013", status: "Ativo" }
    ]
};

// ── Carregar dados da API ─────────────────────────────────────────────────────
async function carregarDados() {
    const loading  = document.getElementById('loading');
    const content  = document.getElementById('content');

    try {
        const response = await fetch(`${API_URL}/api/acessos`);
        const data = await response.json();

        const vazio = !data || data === "" ||
            (Array.isArray(data) && data.length === 0) ||
            (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);
        dadosGlobais = (vazio || data.erro) ? DADOS_EXEMPLO : normalizarDados(data);

    } catch {
        dadosGlobais = DADOS_EXEMPLO;
    }

    loading.style.display = 'none';
    content.style.display  = 'block';

    const colegios = extrairColegios(dadosGlobais);
    colegioSelecionado = colegios[0] || null;

    configurarSeletorColegio(colegios);
    renderizarTudo();
}

// ── Normalizar dados da API real para o formato esperado ──────────────────────
// Estrutura real do RCO:
// [ estab { nomeCompletoEstab, codEstabelecimento, periodoLetivos: [
//     { descrPeriodoLetivo, livros: [
//         { classe: { codClasse, turma: { codTurma, descrTurma, seriacao },
//                     disciplina: { codDisciplina, nomeDisciplina, corFundo } },
//           calendarioAvaliacaos: [...] }] }] } ]
function normalizarDados(raw) {
    const turmas      = [];
    const disciplinas = [];
    const livros      = [];

    const estabs = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    estabs.forEach(estab => {
        const escola = estab.nomeCompletoEstab || estab.nmEstabelecimento || '';

        (estab.periodoLetivos || []).forEach(periodo => {
            const anoLetivo = periodo.descrPeriodoLetivo || '';

            (periodo.livros || []).forEach(livro => {
                const classe = livro.classe;
                if (!classe) return;

                const turma = classe.turma || {};
                const disc  = classe.disciplina || {};

                const nmTurma = turma.descrTurma || turma.nmTurma || '';
                const nmDisc  = disc.nomeDisciplina || disc.nmDisciplina || '';

                // Turma
                if (nmTurma) {
                    turmas.push({
                        nmTurma,
                        serie:      extrairSerie(nmTurma),
                        turno:      extrairTurno(nmTurma),
                        escola,
                        anoLetivo,
                        codTurma:   turma.codTurma,
                        codClasse:  classe.codClasse,
                    });
                }

                // Disciplina
                if (nmDisc) {
                    disciplinas.push({
                        nmDisciplina: nmDisc,
                        nmTurma,
                        cargaHoraria: '',
                        status:       'Ativa',
                        escola,
                        corFundo:     disc.corFundo || '',
                        codDisciplina: disc.codDisciplina,
                        codClasse:    classe.codClasse,
                    });
                }

                // Livros de classe (calendários/trimestres)
                const calendarios = livro.calendarioAvaliacaos || [];
                if (calendarios.length > 0) {
                    calendarios.forEach(cal => {
                        const periodoAval = cal.periodoAvaliacao || {};
                        livros.push({
                            nmLivro:      `${nmDisc} — ${periodoAval.descrPeriodoAvaliacao || anoLetivo}`,
                            nmTurma,
                            nmDisciplina: nmDisc,
                            periodo:      periodoAval.descrPeriodoAvaliacao || '',
                            statusLivro:  'Em andamento',
                            escola,
                            codCalendario: cal.codCalendarioAvaliacao,
                            dataInicio:   cal.dataInicio,
                            dataFim:      cal.dataFim,
                        });
                    });
                } else {
                    livros.push({
                        nmLivro:      nmDisc || 'Livro de Classe',
                        nmTurma,
                        nmDisciplina: nmDisc,
                        periodo:      anoLetivo,
                        statusLivro:  'Em andamento',
                        escola,
                    });
                }
            });
        });
    });

    return {
        turmas:      deduplicate(turmas,      t => t.codTurma + '|' + t.escola),
        disciplinas: deduplicate(disciplinas, d => d.codDisciplina + '|' + d.codClasse),
        livros:      deduplicate(livros,      l => (l.codCalendario || l.nmLivro) + '|' + l.nmTurma),
        alunos:      []
    };
}

function extrairSerie(descrTurma) {
    const m = descrTurma.match(/(\d+)[aªº]\s*[Ss]érie|\d+[aªº]\s*[Aa]no/);
    return m ? m[0] : '';
}

function extrairTurno(descrTurma) {
    if (/manh[ãa]/i.test(descrTurma)) return 'Manhã';
    if (/tarde/i.test(descrTurma)) return 'Tarde';
    if (/noite/i.test(descrTurma)) return 'Noite';
    if (/integral/i.test(descrTurma)) return 'Integral';
    return '';
}

function deduplicate(arr, keyFn) {
    const seen = new Set();
    return arr.filter(item => {
        const k = keyFn(item);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// ── Extrair colégios únicos ───────────────────────────────────────────────────
function extrairColegios(dados) {
    const set = new Set();
    [...(dados.turmas || []), ...(dados.disciplinas || []), ...(dados.livros || [])].forEach(item => {
        const e = item.escola || item.nmEstabelecimento || '';
        if (e) set.add(e);
    });
    return [...set];
}

// ── Montar seletor de colégio ─────────────────────────────────────────────────
function configurarSeletorColegio(colegios) {
    const seletor      = document.getElementById('seletorColegio');
    const tabs         = document.getElementById('colegioTabs');
    const ativoHeader  = document.getElementById('colegioAtivo');
    const ativoNome    = document.getElementById('colegioAtivoNome');

    if (colegios.length <= 1) {
        seletor.style.display = 'none';
        if (colegios.length === 1) {
            ativoHeader.style.display = 'block';
            ativoNome.textContent = colegios[0];
        }
        return;
    }

    seletor.style.display = 'flex';
    ativoHeader.style.display = 'none';

    tabs.innerHTML = '';
    colegios.forEach(colegio => {
        const btn = document.createElement('button');
        btn.className = 'colegio-tab' + (colegio === colegioSelecionado ? ' active' : '');
        btn.textContent = colegio;
        btn.addEventListener('click', () => selecionarColegio(colegio));
        tabs.appendChild(btn);
    });
}

function selecionarColegio(colegio) {
    colegioSelecionado = colegio;
    document.querySelectorAll('.colegio-tab').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === colegio);
    });
    renderizarTudo();
}

// ── Renderizar tudo com filtro de colégio ─────────────────────────────────────
function renderizarTudo() {
    const filtrar = arr => {
        if (!colegioSelecionado) return arr;
        return arr.filter(i => (i.escola || '') === colegioSelecionado);
    };

    const turmas      = filtrar(dadosGlobais.turmas      || []);
    const disciplinas = filtrar(dadosGlobais.disciplinas || []);
    const livros      = filtrar(dadosGlobais.livros      || []);

    renderizarTurmas(turmas);
    renderizarDisciplinas(disciplinas);
    renderizarLivros(livros);
}

// ── Cards de turmas ───────────────────────────────────────────────────────────
function renderizarTurmas(turmas) {
    const container = document.getElementById('turmas');
    const counter   = document.getElementById('totalTurmas');
    counter.textContent = turmas.length ? `${turmas.length} encontradas` : '';

    if (!turmas.length) {
        container.innerHTML = '<div class="empty-message">Nenhuma turma encontrada</div>';
        return;
    }

    container.innerHTML = '';
    turmas.forEach(turma => {
        const card = document.createElement('div');
        card.className = 'card card-turma';
        card.addEventListener('click', () => abrirModalAlunos(turma.nmTurma));

        const turnoIcon = turno => {
            if (!turno) return '';
            if (turno.toLowerCase().includes('manhã')) return '🌅';
            if (turno.toLowerCase().includes('tarde')) return '🌤';
            if (turno.toLowerCase().includes('noite')) return '🌙';
            return '📅';
        };

        card.innerHTML = `
            <div class="card-icon turma-icon">T</div>
            <div class="card-title">${turma.nmTurma}</div>
            ${turma.serie  ? `<div class="card-info"><strong>Série:</strong> ${turma.serie}</div>` : ''}
            ${turma.turno  ? `<div class="card-info">${turnoIcon(turma.turno)} ${turma.turno}</div>` : ''}
            ${turma.anoLetivo ? `<span class="card-badge">${turma.anoLetivo}</span>` : ''}
            <div class="card-action-hint">Ver alunos →</div>
        `;
        container.appendChild(card);
    });
}

// ── Cards de disciplinas ──────────────────────────────────────────────────────
function renderizarDisciplinas(disciplinas) {
    const container = document.getElementById('disciplinas');
    const counter   = document.getElementById('totalDisciplinas');
    counter.textContent = disciplinas.length ? `${disciplinas.length} encontradas` : '';

    if (!disciplinas.length) {
        container.innerHTML = '<div class="empty-message">Nenhuma disciplina encontrada</div>';
        return;
    }

    // Agrupar por disciplina (nome), listando as turmas
    const agrupadas = {};
    disciplinas.forEach(d => {
        const nome = d.nmDisciplina || 'Disciplina';
        if (!agrupadas[nome]) agrupadas[nome] = { nome, turmas: [], cargaHoraria: d.cargaHoraria, status: d.status };
        if (d.nmTurma) agrupadas[nome].turmas.push(d.nmTurma);
    });

    container.innerHTML = '';
    Object.values(agrupadas).forEach(disc => {
        const card = document.createElement('div');
        card.className = 'card card-disciplina';

        const turmasHtml = disc.turmas.length
            ? disc.turmas.map(t => `<span class="turma-pill">${t}</span>`).join('')
            : '';

        card.innerHTML = `
            <div class="card-icon disc-icon">${disc.nome.charAt(0)}</div>
            <div class="card-title">${disc.nome}</div>
            ${disc.cargaHoraria ? `<div class="card-info"><strong>Carga Horária:</strong> ${disc.cargaHoraria}h</div>` : ''}
            ${turmasHtml ? `<div class="turmas-pills">${turmasHtml}</div>` : ''}
            <span class="card-badge verde">${disc.status || 'Ativa'}</span>
        `;
        container.appendChild(card);
    });
}

// ── Cards de livros ───────────────────────────────────────────────────────────
function renderizarLivros(livros) {
    const container = document.getElementById('livros');
    const counter   = document.getElementById('totalLivros');
    counter.textContent = livros.length ? `${livros.length} encontrados` : '';

    if (!livros.length) {
        container.innerHTML = '<div class="empty-message">Nenhum livro de classe encontrado</div>';
        return;
    }

    container.innerHTML = '';
    livros.forEach(livro => {
        const card = document.createElement('div');
        card.className = 'card';

        const statusClass = (livro.statusLivro || '').toLowerCase().includes('aberto') ? 'verde'
            : (livro.statusLivro || '').toLowerCase().includes('fechado') ? 'vermelho'
            : 'amarelo';

        card.innerHTML = `
            <div class="card-icon livro-icon">L</div>
            <div class="card-title">${livro.nmLivro || 'Livro de Classe'}</div>
            ${livro.nmTurma      ? `<div class="card-info"><strong>Turma:</strong> ${livro.nmTurma}</div>` : ''}
            ${livro.nmDisciplina ? `<div class="card-info"><strong>Disciplina:</strong> ${livro.nmDisciplina}</div>` : ''}
            ${livro.periodo      ? `<div class="card-info"><strong>Período:</strong> ${livro.periodo}</div>` : ''}
            <span class="card-badge ${statusClass}">${livro.statusLivro || 'Em andamento'}</span>
        `;
        container.appendChild(card);
    });
}

// ── Modal de alunos ───────────────────────────────────────────────────────────
function abrirModalAlunos(nomeTurma) {
    const alunos = (dadosGlobais.alunos || []).filter(a => a.turma === nomeTurma);

    document.getElementById('modalTitulo').textContent = `Alunos — ${nomeTurma}`;

    const lista = document.getElementById('listaAlunos');

    if (!alunos.length) {
        lista.innerHTML = '<div class="empty-message">Nenhum aluno encontrado nesta turma</div>';
    } else {
        lista.innerHTML = '';
        alunos.forEach(aluno => {
            const div = document.createElement('div');
            div.className = 'aluno-card';
            div.innerHTML = `
                <div class="aluno-info">
                    <div class="aluno-nome">${aluno.nome}</div>
                    <div class="aluno-detalhe"><strong>Registro:</strong> ${aluno.registro}</div>
                    <div class="aluno-detalhe"><strong>Nascimento:</strong> ${aluno.dataNascimento || '—'}</div>
                    <div class="aluno-detalhe"><strong>Status:</strong> <span class="status-ativo">${aluno.status || 'Ativo'}</span></div>
                </div>
                <div class="aluno-codigo-barras">${gerarCodigoBarrasSVG(aluno.registro)}</div>
            `;
            lista.appendChild(div);
        });
    }

    document.getElementById('modalAlunos').style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modalAlunos').style.display = 'none';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

// ── Código de barras SVG ──────────────────────────────────────────────────────
function gerarCodigoBarrasSVG(codigo) {
    const barWidth = 2, height = 50;
    const patterns = [[1,1,1,0,0,1,0],[0,0,1,1,0,1,0],[0,1,0,0,1,1,0],[1,1,0,0,1,0,0],
                      [0,1,1,0,0,1,0],[1,0,1,0,0,1,0],[0,0,0,1,1,1,0],[1,0,0,1,0,1,0],
                      [0,0,1,0,1,1,0],[1,1,0,1,0,0,0]];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${height+20}" viewBox="0 0 200 ${height+20}">`;
    let x = 10;
    for (const ch of String(codigo)) {
        const d = parseInt(ch);
        if (isNaN(d)) continue;
        for (const bit of patterns[d]) {
            if (bit) svg += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="black"/>`;
            x += barWidth;
        }
        x += barWidth;
    }
    svg += `<text x="100" y="${height+15}" text-anchor="middle" font-family="monospace" font-size="12">${codigo}</text></svg>`;
    return svg;
}

function logout() { window.location.href = '/'; }
