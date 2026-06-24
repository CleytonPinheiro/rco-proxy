// ── Comportamento & Reconhecimento ────────────────────────────────────────────

const API = '';
let turmaAtual       = null;
let todosAlunos      = [];
let ocorrenciasMap   = {};   // codMatrizAluno → [ocorrencias]
let observacoesMap   = {};   // codMatrizAluno → [observacoes RCO]
let alunoFoco        = null;
let tipoSelecionado  = 'positivo';
let categoriaSelecionada = null;

// ── Categorias por tipo ────────────────────────────────────────────────────────
const CATEGORIAS = {
    positivo: [
        { id: 'participacao',  label: '🌟 Participação exemplar',       pontos: 3 },
        { id: 'tarefa',        label: '📚 Tarefa completa e caprichada', pontos: 2 },
        { id: 'ajuda',         label: '🤝 Ajudou um colega',            pontos: 2 },
        { id: 'avaliacao',     label: '🏆 Destaque na avaliação',       pontos: 5 },
        { id: 'comportamento', label: '😊 Comportamento exemplar',      pontos: 2 },
        { id: 'criatividade',  label: '💡 Criatividade / iniciativa',   pontos: 3 },
    ],
    atencao: [
        { id: 'conversa',      label: '💬 Conversa excessiva',          pontos: -1 },
        { id: 'tarefa_inc',    label: '📋 Tarefa incompleta',           pontos: -1 },
        { id: 'atraso',        label: '⏰ Atraso sem justificativa',    pontos: -1 },
        { id: 'distracao',     label: '📱 Uso indevido do celular',     pontos: -1 },
    ],
    grave: [
        { id: 'desrespeito',   label: '🚫 Desrespeito com colega',      pontos: -3 },
        { id: 'desobediencia', label: '❌ Recusa em realizar atividade', pontos: -2 },
        { id: 'agressao',      label: '⚠️ Agressão / briga',           pontos: -5 },
        { id: 'bullying',      label: '😠 Bullying / intimidação',      pontos: -4 },
    ],
};

// ── Sistema de níveis ──────────────────────────────────────────────────────────
function calcularNivel(pontos) {
    if (pontos < 10)  return { num: 0, label: '🌱 Iniciante',   stars: 0 };
    if (pontos < 25)  return { num: 1, label: '📗 Aprendiz',    stars: Math.floor(pontos / 10) };
    if (pontos < 50)  return { num: 2, label: '📘 Dedicado',    stars: Math.floor(pontos / 10) };
    if (pontos < 100) return { num: 3, label: '⭐ Destaque',    stars: Math.floor(pontos / 10) };
    if (pontos < 200) return { num: 4, label: '🌟 Excelência',  stars: Math.floor(pontos / 10) };
    return                     { num: 5, label: '🏆 Mestre',     stars: Math.floor(pontos / 10) };
}

function totalPontos(codMatrizAluno) {
    const ocs = ocorrenciasMap[codMatrizAluno] || [];
    return ocs.reduce((s, o) => s + (o.pontos || 0), 0);
}

function renderEstrelas(stars, max = 10) {
    const mostrar = Math.min(stars, max);
    const cheias  = '⭐'.repeat(mostrar);
    const vazias  = '☆'.repeat(Math.max(0, max - mostrar));
    return cheias + (stars > max ? `+${stars - max}` : vazias);
}

// ── Professor atual ────────────────────────────────────────────────────────────
let professorNome = localStorage.getItem('professorNome') || '';

async function carregarProfessorNome() {
    try {
        const r = await fetch(`${API}/api/me`);
        if (!r.ok) return;
        const me = await r.json();
        // JWT geralmente tem o nome; caso contrário usamos localStorage
        if (me.nome && me.nome !== 'Professor(a)') {
            professorNome = me.nome;
            localStorage.setItem('professorNome', me.nome);
        }
    } catch (_) {}
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        if (!d.credenciaisConfiguradas) { window.location.href = '/'; return false; }
        return true;
    } catch { window.location.href = '/'; return false; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    if (!await checkAuth()) return;
    carregarProfessorNome(); // em background, não bloqueia
    let acessos;
    try {
        const r = await fetch(`${API}/api/acessos`);
        acessos = await r.json();
    } catch (e) {
        document.getElementById('loading').innerHTML = `<p style="color:red">Erro: ${e.message}</p>`;
        return;
    }
    const turmas = extrairTurmas(acessos);
    todasTurmas = turmas;
    renderTurmaTabs(turmas);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    if (turmas.length > 0) await selecionarTurma(turmas[0]);
}

function extrairTurmas(acessos) {
    const mapa   = {};
    const estabs = Array.isArray(acessos) ? acessos : [acessos];
    const filtro = localStorage.getItem('edusync_escola');
    const root   = (filtro
        ? estabs.find(e => (e.nomeCompletoEstab || e.nmEstabelecimento || '') === filtro)
        : null) || estabs[0] || {};
    for (const periodo of (root.periodoLetivos || [])) {
        for (const livro of (periodo.livros || [])) {
            const classe = livro.classe; if (!classe) continue;
            const turma  = classe.turma || {};
            const cod    = turma.codTurma;
            if (!cod || mapa[cod]) continue;
            const desc  = turma.descrTurma || '';
            const serie = (desc.match(/(\d+[ªa]?\s*[sS]érie)/i) || ['', desc])[1];
            mapa[cod] = { codTurma: cod, nomeTurma: desc, serie, codClasse: classe.codClasse };
        }
    }
    return Object.values(mapa).sort((a, b) => (parseInt(a.serie) || 99) - (parseInt(b.serie) || 99));
}

function renderTurmaTabs(turmas) {
    const el = document.getElementById('turmaTabs');
    el.innerHTML = turmas.map(t => `
        <button class="turma-tab" data-cod="${t.codTurma}"
            onclick="selecionarTurma(${JSON.stringify(t).split('"').join("'")})"
            title="${t.nomeTurma}">${t.serie || t.nomeTurma}</button>
    `).join('');
}

async function selecionarTurma(turma) {
    turmaAtual = turma;
    document.querySelectorAll('.turma-tab').forEach(b => {
        b.classList.toggle('active', String(b.dataset.cod) === String(turma.codTurma));
    });
    document.getElementById('alunosGrid').innerHTML = '<div class="grid-loading">Carregando alunos e observações do RCO...</div>';
    await Promise.all([
        carregarAlunos(turma),
        carregarOcorrencias(turma.codTurma),
        carregarObservacoes(turma.codClasse),
    ]);
    renderGrid();
}

async function carregarAlunos(turma) {
    try {
        const r = await fetch(`${API}/api/alunos-rco?codClasse=${turma.codClasse}`);
        const d = await r.json();
        todosAlunos = (Array.isArray(d) ? d : (d.alunos || []))
            .sort((a, b) => (a.numChamada || 0) - (b.numChamada || 0));
    } catch { todosAlunos = []; }
}

async function carregarOcorrencias(codTurma) {
    try {
        const r = await fetch(`${API}/api/comportamento?codTurma=${codTurma}`);
        const lista = await r.json();
        ocorrenciasMap = {};
        for (const o of (Array.isArray(lista) ? lista : [])) {
            if (!ocorrenciasMap[o.cod_matriz_aluno]) ocorrenciasMap[o.cod_matriz_aluno] = [];
            ocorrenciasMap[o.cod_matriz_aluno].push(o);
        }
    } catch { ocorrenciasMap = {}; }
}

async function carregarObservacoes(codClasse) {
    try {
        const r = await fetch(`${API}/api/observacoes?codClasse=${codClasse}`);
        const lista = await r.json();
        observacoesMap = {};
        for (const o of (Array.isArray(lista) ? lista : [])) {
            if (!observacoesMap[o.cod_matriz_aluno]) observacoesMap[o.cod_matriz_aluno] = [];
            observacoesMap[o.cod_matriz_aluno].push(o);
        }
    } catch { observacoesMap = {}; }
}

// ── Filtro "apenas com registros" ───────────────────────────────────────────────
let filtroComRegistros = false;
let todasTurmas = [];   // turmas disponíveis (tabs) — usadas também no filtro do painel

function toggleFiltroComRegistros() {
    filtroComRegistros = !filtroComRegistros;
    const btn = document.getElementById('btnFiltroComRegistros');
    if (btn) btn.classList.toggle('ativo', filtroComRegistros);
    renderGrid();
}

// ── Render grid ────────────────────────────────────────────────────────────────
function renderGrid() {
    const grid = document.getElementById('alunosGrid');
    if (!todosAlunos.length) {
        grid.innerHTML = '<div class="grid-loading">Nenhum aluno encontrado.</div>';
        return;
    }
    const lista = filtroComRegistros
        ? todosAlunos.filter(a =>
            (ocorrenciasMap[a.codMatrizAluno] || []).length > 0 ||
            (observacoesMap[a.codMatrizAluno] || []).length > 0
          )
        : todosAlunos;
    if (!lista.length) {
        grid.innerHTML = '<div class="grid-loading">Nenhum aluno com registros nesta turma.</div>';
        return;
    }
    grid.innerHTML = lista.map(a => renderCardAluno(a)).join('');
}

function renderCardAluno(aluno) {
    const pts    = totalPontos(aluno.codMatrizAluno);
    const nivel  = calcularNivel(pts);
    const ocs    = ocorrenciasMap[aluno.codMatrizAluno] || [];
    const obs    = observacoesMap[aluno.codMatrizAluno] || [];
    const ultima = [...ocs].sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''))[0];
    const maxEstrelas = Math.min(nivel.stars, 10);
    const estrelasHtml = '⭐'.repeat(maxEstrelas) +
        (nivel.stars > 10 ? `<span class="estrelas-label">+${nivel.stars - 10}</span>` : '') +
        (nivel.stars === 0 ? '<span class="estrelas-label">Sem estrelas ainda</span>' : '');

    let ultimaHtml = '<span class="card-ultima">Sem registros ainda</span>';
    if (ultima) {
        const tipoClass = `ultima-${ultima.tipo}`;
        const icone = ultima.tipo === 'positivo' ? '✅' : ultima.tipo === 'atencao' ? '⚠️' : '❌';
        ultimaHtml = `<span class="card-ultima ${tipoClass}">${icone} ${escHtml(ultima.categoria_label || ultima.categoria)}</span>`;
    }

    // Badge de observações RCO
    const obsBadge = obs.length
        ? `<span class="obs-rco-badge" title="${obs.length} observação(ões) registrada(s) no RCO">📝 ${obs.length}</span>`
        : '';

    // Última observação RCO (mais recente)
    const ultimaObs = obs.sort((a, b) => (b.data_aula || '').localeCompare(a.data_aula || ''))[0];
    const obsHtml = ultimaObs
        ? `<span class="card-ultima card-obs-rco" title="${escHtml(ultimaObs.observacao)}">📝 ${escHtml(ultimaObs.observacao.length > 55 ? ultimaObs.observacao.substring(0,52)+'…' : ultimaObs.observacao)}</span>`
        : '';

    return `
        <div class="aluno-comp-card card-nivel-${nivel.num}" onclick="abrirHistorico(${aluno.codMatrizAluno})">
            <div class="card-nivel-header">
                <span class="nivel-badge">${nivel.label}</span>
                <div style="display:flex;align-items:center;gap:5px;">
                    ${obsBadge}
                    <span class="card-chamada">Nº ${aluno.numChamada || '?'}</span>
                </div>
            </div>
            <div class="card-body">
                <div class="card-nome" title="${escHtml(aluno.nome)}">${escHtml(aluno.nome)}</div>
                <div class="card-estrelas">${estrelasHtml}</div>
                <div class="card-pontos">${pts >= 0 ? '+' : ''}${pts} pontos acumulados</div>
                ${ultimaHtml}
                ${obsHtml}
            </div>
            <div class="card-footer">
                <button class="btn-card-registrar" onclick="event.stopPropagation(); abrirModalOcorrencia(${aluno.codMatrizAluno})">
                    + Registrar ocorrência
                </button>
                ${ocs.length > 0 ? `
                <button class="btn-card-termo" onclick="event.stopPropagation(); gerarTermoAluno(${aluno.codMatrizAluno}, this)" title="Gerar Termo de Ocorrência em PDF">
                    📄 Termo PDF
                </button>` : ''}
            </div>
        </div>`;
}

// ── Gerar Termo de Ocorrência PDF ──────────────────────────────────────────────
async function gerarTermoAluno(codMatrizAluno, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
    try {
        const r = await fetch(`${API}/api/relatorio-ocorrencias/${codMatrizAluno}`);
        if (r.status === 204) {
            alert('Nenhuma ocorrência encontrada para este aluno.');
            return;
        }
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.erro || `Erro ${r.status}`);
        }
        const blob    = await r.blob();
        const objUrl  = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        a.href        = objUrl;
        a.download    = `termo-ocorrencia.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
    } catch (e) {
        alert('Erro ao gerar PDF: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📄 Termo PDF'; }
    }
}

// ── Modal: Registrar ocorrência ────────────────────────────────────────────────
function abrirModalOcorrencia(codMatrizAluno) {
    // Popular select de alunos
    const sel = document.getElementById('ocorrAluno');
    sel.innerHTML = todosAlunos.map(a =>
        `<option value="${a.codMatrizAluno}" ${a.codMatrizAluno === codMatrizAluno ? 'selected' : ''}>${a.numChamada || '?'} — ${escHtml(a.nome)}</option>`
    ).join('');
    /* Apply styled dropdown once; MutationObserver keeps it in sync on re-opens */
    createCustomSelect(sel);

    // Data de hoje
    document.getElementById('ocorrData').value = new Date().toISOString().split('T')[0];
    document.getElementById('ocorrDescricao').value = '';
    tipoSelecionado = 'positivo';
    categoriaSelecionada = null;
    atualizarTipoBtns();
    renderCategorias();
    document.getElementById('modalOcorrenciaTitulo').textContent =
        codMatrizAluno ? `Registrar — ${todosAlunos.find(a => a.codMatrizAluno === codMatrizAluno)?.nome || ''}` : 'Registrar Ocorrência';
    document.getElementById('modalOcorrencia').style.display = 'flex';
}

function fecharModalOcorrencia(e) {
    if (e && e.target !== document.getElementById('modalOcorrencia')) return;
    document.getElementById('modalOcorrencia').style.display = 'none';
}

function selecionarTipo(tipo) {
    tipoSelecionado = tipo;
    categoriaSelecionada = null;
    atualizarTipoBtns();
    renderCategorias();
}

function atualizarTipoBtns() {
    document.querySelectorAll('.tipo-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tipo === tipoSelecionado);
    });
}

function renderCategorias() {
    const cats = CATEGORIAS[tipoSelecionado] || [];
    document.getElementById('categoriasGrid').innerHTML = cats.map(c => `
        <button class="cat-btn ${categoriaSelecionada?.id === c.id ? 'selected' : ''}"
                onclick="selecionarCategoria('${c.id}')">
            ${escHtml(c.label)}
        </button>`).join('');
    atualizarPontosPreview();
}

function selecionarCategoria(id) {
    const cats = CATEGORIAS[tipoSelecionado] || [];
    categoriaSelecionada = cats.find(c => c.id === id) || null;
    renderCategorias();
}

function atualizarPontosPreview() {
    const el = document.getElementById('pontosValor');
    if (!categoriaSelecionada) { el.textContent = 'Selecione uma categoria'; el.className = ''; return; }
    const p = categoriaSelecionada.pontos;
    el.textContent = (p > 0 ? '+' : '') + p + ' pontos';
    el.className = tipoSelecionado;
}

async function salvarOcorrencia() {
    const codMatrizAluno = parseInt(document.getElementById('ocorrAluno').value);
    const data           = document.getElementById('ocorrData').value;
    const descricao      = document.getElementById('ocorrDescricao').value.trim();
    const disciplina     = document.getElementById('ocorrDisciplina')?.value.trim() || '';

    if (!categoriaSelecionada) { await notificar('Atenção', 'Selecione uma categoria.', {tipo: 'info'}); return; }
    if (!data) { await notificar('Atenção', 'Informe a data.', {tipo: 'info'}); return; }

    const aluno = todosAlunos.find(a => a.codMatrizAluno === codMatrizAluno);

    await fetch(`${API}/api/comportamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            cod_matriz_aluno: codMatrizAluno,
            cod_turma:        turmaAtual.codTurma,
            nome_aluno:       aluno?.nome || '',
            num_chamada:      aluno?.numChamada || null,
            data,
            tipo:             tipoSelecionado,
            categoria:        categoriaSelecionada.id,
            categoria_label:  categoriaSelecionada.label,
            descricao,
            pontos:           categoriaSelecionada.pontos,
            professor_nome:   professorNome || localStorage.getItem('professorNome') || '',
            nome_turma:       turmaAtual.nomeTurma || '',
            disciplina,
        }),
    });

    document.getElementById('modalOcorrencia').style.display = 'none';
    await carregarOcorrencias(turmaAtual.codTurma);
    renderGrid();

    // Atualiza histórico se estiver aberto para o mesmo aluno
    if (alunoFoco?.codMatrizAluno === codMatrizAluno) {
        renderHistoricoBody(alunoFoco);
    }
}

// ── Modal: Histórico do aluno ──────────────────────────────────────────────────
function abrirHistorico(codMatrizAluno) {
    const aluno = todosAlunos.find(a => a.codMatrizAluno === codMatrizAluno);
    if (!aluno) return;
    alunoFoco = aluno;

    const pts   = totalPontos(codMatrizAluno);
    const nivel = calcularNivel(pts);

    document.getElementById('modalHistoricoNome').textContent   = aluno.nome;
    document.getElementById('modalHistoricoResumo').textContent =
        `${nivel.label}  ·  ${nivel.stars} estrela${nivel.stars !== 1 ? 's' : ''}  ·  ${pts >= 0 ? '+' : ''}${pts} pontos`;

    renderHistoricoBody(aluno);
    document.getElementById('modalHistorico').style.display = 'flex';
}

function renderHistoricoBody(aluno) {
    const ocs = [...(ocorrenciasMap[aluno.codMatrizAluno] || [])]
        .sort((a, b) => (b.data || '').localeCompare(a.data || '') || b.criado_em?.localeCompare(a.criado_em));

    const pts      = totalPontos(aluno.codMatrizAluno);
    const nivel    = calcularNivel(pts);
    const positivos = ocs.filter(o => o.tipo === 'positivo').length;
    const negativos = ocs.filter(o => o.tipo !== 'positivo').length;

    const statsHtml = `
        <div class="hist-aluno-stats">
            <div class="hist-stat-box">
                <div class="hist-stat-val">${renderEstrelas(nivel.stars, 5)}</div>
                <div class="hist-stat-lab">${nivel.stars} Estrela${nivel.stars !== 1 ? 's' : ''}</div>
            </div>
            <div class="hist-stat-box">
                <div class="hist-stat-val" style="color:#16a34a">+${pts >= 0 ? pts : 0}</div>
                <div class="hist-stat-lab">Pontos</div>
            </div>
            <div class="hist-stat-box">
                <div class="hist-stat-val" style="color:#16a34a">${positivos}</div>
                <div class="hist-stat-lab">Positivos</div>
            </div>
            <div class="hist-stat-box">
                <div class="hist-stat-val" style="color:#dc2626">${negativos}</div>
                <div class="hist-stat-lab">Ocorrências</div>
            </div>
        </div>`;

    const listaHtml = ocs.length
        ? `<div class="hist-section-title">Histórico completo (${ocs.length})</div>` +
          ocs.map(o => {
              const icone = o.tipo === 'positivo' ? '✅' : o.tipo === 'atencao' ? '⚠️' : '❌';
              const pts_fmt = (o.pontos > 0 ? '+' : '') + o.pontos;
              return `
                <div class="ocorrencia-item ${o.tipo}">
                    <span class="ocorrencia-icon">${icone}</span>
                    <div class="ocorrencia-info">
                        <div class="ocorrencia-cat">${escHtml(o.categoria_label || o.categoria)}</div>
                        <div class="ocorrencia-data">${formatarData(o.data)}</div>
                        ${o.descricao ? `<div class="ocorrencia-desc">${escHtml(o.descricao)}</div>` : ''}
                    </div>
                    <span class="ocorrencia-pts pts-${o.tipo}">${pts_fmt}</span>
                    <button class="btn-del-ocorr" title="Excluir registro"
                            onclick="excluirOcorrencia('${o.id}', ${aluno.codMatrizAluno})">🗑</button>
                </div>`;
          }).join('')
        : '<div class="hist-vazio">Nenhum registro ainda para este aluno.</div>';

    // Observações do RCO (chamada diária)
    const obsRco = (observacoesMap[aluno.codMatrizAluno] || [])
        .sort((a, b) => (b.data_aula || '').localeCompare(a.data_aula || ''));
    const obsRcoHtml = obsRco.length
        ? `<div class="hist-section-title">📝 Observações registradas no RCO (${obsRco.length})</div>` +
          obsRco.map(o => `
            <div class="ocorrencia-item atencao rco-obs-item">
                <span class="ocorrencia-icon">📝</span>
                <div class="ocorrencia-info">
                    <div class="ocorrencia-data">Aula de ${o.data_aula ? formatarData(o.data_aula) : '?'}</div>
                    <div class="ocorrencia-desc">${escHtml(o.observacao)}</div>
                </div>
            </div>`).join('')
        : '';

    document.getElementById('modalHistoricoBody').innerHTML = statsHtml + listaHtml + obsRcoHtml;
}

function fecharModalHistorico(e) {
    if (e && e.target !== document.getElementById('modalHistorico')) return;
    document.getElementById('modalHistorico').style.display = 'none';
    alunoFoco = null;
}

function registrarParaAluno() {
    if (!alunoFoco) return;
    document.getElementById('modalHistorico').style.display = 'none';
    abrirModalOcorrencia(alunoFoco.codMatrizAluno);
}

function abrirFichaCompleta() {
    if (!alunoFoco) return;
    window.open(`/pages/ficha-aluno/?codMatrizAluno=${alunoFoco.codMatrizAluno}`, '_blank');
}

async function excluirOcorrencia(id, codMatrizAluno) {
    if (!await confirmar('Excluir registro?', 'Excluir este registro de comportamento?', { confirmLabel: 'Excluir', tipo: 'danger' })) return;
    await fetch(`${API}/api/comportamento/${id}`, { method: 'DELETE' });
    await carregarOcorrencias(turmaAtual.codTurma);
    renderGrid();
    if (alunoFoco?.codMatrizAluno === codMatrizAluno) {
        renderHistoricoBody(alunoFoco);
        const pts   = totalPontos(codMatrizAluno);
        const nivel = calcularNivel(pts);
        document.getElementById('modalHistoricoResumo').textContent =
            `${nivel.label}  ·  ${nivel.stars} estrela${nivel.stars !== 1 ? 's' : ''}  ·  ${pts >= 0 ? '+' : ''}${pts} pontos`;
    }
}

// ── Painel de Registros ────────────────────────────────────────────────────────

let painelDados = [];   // todos os registros carregados da API
let painelTurmas = [];  // lista de turmas distintas para o filtro

async function abrirPainel() {
    document.getElementById('modalPainel').style.display = 'flex';
    document.getElementById('painelLista').innerHTML =
        '<div class="painel-loading"><div class="spinner"></div><span>Carregando registros…</span></div>';
    document.getElementById('painelResumo').textContent = '';

    try {
        const r = await fetch(`${API}/api/comportamento/painel`);
        if (!r.ok) throw new Error(`Erro ${r.status}`);
        painelDados = await r.json();

        // Popula turmas a partir das tabs (sempre disponíveis, mesmo sem registros)
        // Complementa com eventuais turmas extras que apareçam nos dados do painel
        const turmasSeen = {};
        todasTurmas.forEach(t => {
            turmasSeen[String(t.codTurma)] = t.nomeTurma || t.serie || String(t.codTurma);
        });
        painelDados.forEach(o => {
            const key = String(o.cod_turma);
            if (o.cod_turma && !turmasSeen[key]) {
                turmasSeen[key] = o.nome_turma || String(o.cod_turma);
            }
        });
        painelTurmas = Object.entries(turmasSeen).map(([cod, nome]) => ({ cod, nome }));

        const sel = document.getElementById('painelFiltroTurma');
        sel.innerHTML = '<option value="">Todas as turmas</option>' +
            painelTurmas.map(t => `<option value="${t.cod}">${escHtml(t.nome)}</option>`).join('');

        renderPainel(painelDados);
    } catch (e) {
        document.getElementById('painelLista').innerHTML =
            `<div class="painel-vazio">Erro ao carregar: ${escHtml(e.message)}</div>`;
    }
}

function fecharPainel(e) {
    if (e && e.target !== document.getElementById('modalPainel')) return;
    document.getElementById('modalPainel').style.display = 'none';
}

function aplicarFiltrosPainel() {
    const tipo    = document.getElementById('painelFiltroTipo').value;
    const turma   = document.getElementById('painelFiltroTurma').value;
    const de      = document.getElementById('painelFiltroDe').value;
    const ate     = document.getElementById('painelFiltroAte').value;

    const filtrado = painelDados.filter(o => {
        if (tipo  && o.tipo              !== tipo)              return false;
        if (turma && String(o.cod_turma) !== turma)             return false;
        if (de    && (o.data || '') < de)                       return false;
        if (ate   && (o.data || '') > ate)                      return false;
        return true;
    });
    renderPainel(filtrado);
}

async function buscarPainel() {
    const btn   = document.querySelector('.painel-btn-buscar');
    const tipo  = document.getElementById('painelFiltroTipo').value;
    const turma = document.getElementById('painelFiltroTurma').value;
    const de    = document.getElementById('painelFiltroDe').value;
    const ate   = document.getElementById('painelFiltroAte').value;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }
    document.getElementById('painelLista').innerHTML =
        '<div class="painel-loading"><div class="spinner"></div><span>Buscando registros…</span></div>';

    try {
        /* Monta query params: envia apenas os filtros realmente preenchidos.
           Datas omitidas = sem restrição de período. */
        const params = new URLSearchParams();
        if (tipo)  params.set('tipo',     tipo);
        if (turma) params.set('codTurma', turma);
        if (de)    params.set('de',       de);
        if (ate)   params.set('ate',      ate);

        const url = `${API}/api/comportamento/painel${params.toString() ? '?' + params : ''}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Erro ${r.status}`);
        painelDados = await r.json();

        /* Filtragem client-side adicional (caso params não cubram tudo) */
        renderPainel(painelDados);
    } catch (e) {
        document.getElementById('painelLista').innerHTML =
            `<div class="painel-vazio">Erro ao buscar: ${escHtml(e.message)}</div>`;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔍 Buscar'; }
    }
}

function limparFiltrosPainel() {
    document.getElementById('painelFiltroTipo').value  = '';
    document.getElementById('painelFiltroTurma').value = '';
    document.getElementById('painelFiltroDe').value    = '';
    document.getElementById('painelFiltroAte').value   = '';
    renderPainel(painelDados);
}

function renderPainel(lista) {
    const resumo = document.getElementById('painelResumo');
    const div    = document.getElementById('painelLista');

    const total    = lista.length;
    const graves   = lista.filter(o => o.tipo === 'grave').length;
    const atencao  = lista.filter(o => o.tipo === 'atencao').length;
    const positivos = lista.filter(o => o.tipo === 'positivo').length;

    resumo.textContent = total
        ? `${total} registro${total !== 1 ? 's' : ''} — ✅ ${positivos}  ⚠️ ${atencao}  ❌ ${graves}`
        : '';

    if (!total) {
        div.innerHTML = '<div class="painel-vazio">Nenhum registro encontrado para os filtros selecionados.</div>';
        return;
    }

    div.innerHTML = lista.map(o => {
        const icone     = o.tipo === 'positivo' ? '✅' : o.tipo === 'atencao' ? '⚠️' : '❌';
        const tipoLabel = o.tipo === 'positivo' ? 'Positivo' : o.tipo === 'atencao' ? 'Atenção' : 'Grave';
        const pts       = o.pontos != null ? (o.pontos > 0 ? `+${o.pontos}` : String(o.pontos)) : '';
        const metaStr   = [o.professor_nome, o.disciplina].filter(Boolean).join(' · ');
        const turmaStr  = o.nome_turma || '';

        return `
        <div class="painel-item painel-item-${o.tipo}"
             onclick="window.open('/pages/ficha-aluno/?codMatrizAluno=${o.cod_matriz_aluno}','_blank')"
             title="Abrir ficha de ${escHtml(o.nome_aluno || '')}">
            <div class="painel-item-tipo">
                <span class="painel-icone">${icone}</span>
                ${pts ? `<span class="painel-pts pts-${o.tipo}">${pts}</span>` : ''}
            </div>
            <div class="painel-item-info">
                <div class="painel-item-aluno">${escHtml(o.nome_aluno || '—')}</div>
                <div class="painel-item-meta">
                    <span class="painel-tag painel-tag-turma">${escHtml(turmaStr)}</span>
                    <span class="painel-tag painel-tag-cat">${escHtml(o.categoria_label || o.categoria || '')}</span>
                    ${metaStr ? `<span class="painel-tag painel-tag-prof">${escHtml(metaStr)}</span>` : ''}
                </div>
                ${o.descricao ? `<div class="painel-item-desc">${escHtml(o.descricao)}</div>` : ''}
            </div>
            <div class="painel-item-data">${formatarData(o.data)}</div>
        </div>`;
    }).join('');
}

// ── Ranking ────────────────────────────────────────────────────────────────────
function abrirRanking() {
    const posicoes = todosAlunos
        .map(a => {
            const pts   = totalPontos(a.codMatrizAluno);
            const nivel = calcularNivel(pts);
            return { ...a, pts, nivel };
        })
        .sort((a, b) => b.pts - a.pts);

    const medalhas = ['🥇', '🥈', '🥉'];
    const html = posicoes.length
        ? posicoes.map((a, i) => `
            <div class="ranking-item">
                <div class="ranking-pos ${i < 3 ? `pos-${i+1}` : ''}">${medalhas[i] || (i + 1)}</div>
                <div>
                    <div class="ranking-nome">${escHtml(a.nome)}</div>
                    <div class="ranking-nivel">${a.nivel.label}</div>
                </div>
                <div class="ranking-estrelas">${'⭐'.repeat(Math.min(a.nivel.stars, 5))}</div>
                <div class="ranking-pts">${a.pts >= 0 ? '+' : ''}${a.pts} pts</div>
            </div>`).join('')
        : '<p style="text-align:center;color:#9ca3af;">Sem dados para ranquear.</p>';

    document.getElementById('rankingBody').innerHTML = html;
    document.getElementById('modalRanking').style.display = 'flex';
}

function fecharRanking(e) {
    if (e && e.target !== document.getElementById('modalRanking')) return;
    document.getElementById('modalRanking').style.display = 'none';
}

// ── Normalizar ocorrências ────────────────────────────────────────────────────
async function normalizarOcorrencias() {
    if (!turmaAtual) return;
    const btn = document.getElementById('btnNormalizar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Normalizando…'; }

    // Modal de progresso
    let modal = document.getElementById('modalNormalizar');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalNormalizar';
        modal.className = 'modal-normalizar-overlay';
        modal.innerHTML = `
            <div class="modal-normalizar-box">
                <h3>🔧 Normalizando Ocorrências</h3>
                <p id="normalizarStatus">Processando registros da disciplina…</p>
                <div class="normalizar-spinner"></div>
                <div id="normalizarResultado" style="display:none;"></div>
                <button id="normalizarFechar" class="btn-normalizar-fechar" style="display:none;" onclick="document.getElementById('modalNormalizar').style.display='none'">Fechar</button>
            </div>`;
        document.body.appendChild(modal);
    }
    const statusEl    = modal.querySelector('#normalizarStatus');
    const spinner     = modal.querySelector('.normalizar-spinner');
    const resultadoEl = modal.querySelector('#normalizarResultado');
    const fecharBtn   = modal.querySelector('#normalizarFechar');

    statusEl.textContent = 'Processando registros da disciplina…';
    spinner.style.display = 'block';
    resultadoEl.style.display = 'none';
    fecharBtn.style.display = 'none';
    modal.style.display = 'flex';

    try {
        const r = await fetch(`${API}/api/comportamento/normalizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codturma: turmaAtual.codTurma }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || `Erro ${r.status}`);

        spinner.style.display = 'none';
        statusEl.textContent = 'Concluído!';

        const linhas = [];
        if (d.atualizados > 0) {
            linhas.push(`<div class="norm-linha norm-ok">✅ ${d.atualizados} registro${d.atualizados !== 1 ? 's' : ''} corrigido${d.atualizados !== 1 ? 's' : ''}</div>`);
        } else {
            linhas.push(`<div class="norm-linha norm-ok">✅ Nenhuma inconsistência encontrada — registros já estão corretos</div>`);
        }
        if (d.naoIdentificados > 0) {
            linhas.push(`<div class="norm-linha norm-warn">⚠️ ${d.naoIdentificados} registro${d.naoIdentificados !== 1 ? 's' : ''} sem aluno identificado (sem nome e sem correspondência no RCO)</div>`);
        }
        linhas.push(`<div class="norm-linha norm-info">📊 Total na turma: ${d.total} ocorrência${d.total !== 1 ? 's' : ''}</div>`);
        resultadoEl.innerHTML = linhas.join('');
        resultadoEl.style.display = 'block';
        fecharBtn.style.display = 'inline-block';

        // Recarrega os dados após normalização
        if (d.atualizados > 0) {
            await carregarOcorrencias(turmaAtual.codTurma);
            renderGrid();
        }
    } catch (e) {
        spinner.style.display = 'none';
        statusEl.textContent = 'Erro ao normalizar';
        resultadoEl.innerHTML = `<div class="norm-linha norm-erro">❌ ${escHtml(e.message)}</div>`;
        resultadoEl.style.display = 'block';
        fecharBtn.style.display = 'inline-block';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔧 Normalizar'; }
    }
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatarData(iso) {
    const [y, m, d] = (iso || '').split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
}

init();
initSyncStatus();
