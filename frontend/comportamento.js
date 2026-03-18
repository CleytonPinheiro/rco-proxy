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
    let acessos;
    try {
        const r = await fetch(`${API}/api/acessos`);
        acessos = await r.json();
    } catch (e) {
        document.getElementById('loading').innerHTML = `<p style="color:red">Erro: ${e.message}</p>`;
        return;
    }
    const turmas = extrairTurmas(acessos);
    renderTurmaTabs(turmas);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    if (turmas.length > 0) await selecionarTurma(turmas[0]);
}

function extrairTurmas(acessos) {
    const mapa = {};
    const root = Array.isArray(acessos) ? acessos[0] : acessos;
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

// ── Render grid ────────────────────────────────────────────────────────────────
function renderGrid() {
    const grid = document.getElementById('alunosGrid');
    if (!todosAlunos.length) {
        grid.innerHTML = '<div class="grid-loading">Nenhum aluno encontrado.</div>';
        return;
    }
    grid.innerHTML = todosAlunos.map(a => renderCardAluno(a)).join('');
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
            </div>
        </div>`;
}

// ── Modal: Registrar ocorrência ────────────────────────────────────────────────
function abrirModalOcorrencia(codMatrizAluno) {
    // Popular select de alunos
    const sel = document.getElementById('ocorrAluno');
    sel.innerHTML = todosAlunos.map(a =>
        `<option value="${a.codMatrizAluno}" ${a.codMatrizAluno === codMatrizAluno ? 'selected' : ''}>${a.numChamada || '?'} — ${escHtml(a.nome)}</option>`
    ).join('');

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

    if (!categoriaSelecionada) { alert('Selecione uma categoria.'); return; }
    if (!data) { alert('Informe a data.'); return; }

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

async function excluirOcorrencia(id, codMatrizAluno) {
    if (!confirm('Excluir este registro?')) return;
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

// ── Utilitários ───────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatarData(iso) {
    const [y, m, d] = (iso || '').split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
}

init();
