/* ── Circulação ─────────────────────────────────────────────────────── */

const API = '/api';

let ambientes      = [];
let ambienteSel    = null;   // ambiente selecionado no scanner
let ativosGlobal   = [];     // todos os ativos (sem filtro)
let historicoGlobal= [];     // histórico do dia (sem filtro)
let cameraStream   = null;
let cameraLoop     = null;

// ── Init ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    verificarAuth();
    setDataHoje();
    await carregarAmbientes();
    await recarregarTudo();
    iniciarAutoRefresh();
    focarInput();
    document.getElementById('inputScan').addEventListener('keydown', e => {
        if (e.key === 'Enter') processarScan();
    });
});

function setDataHoje() {
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const [d, m, y] = hoje.split('/');
    document.getElementById('inputData').value = `${y}-${m}-${d}`;
}

// ── Auth ──────────────────────────────────────────────────────────────

function verificarAuth() {
    fetch(`${API}/alunos`).then(r => { if (r.status === 401) location.href = '/'; }).catch(() => {});
    document.getElementById('btnLogout').onclick = async () => {
        await fetch(`${API}/logout`, { method: 'POST' });
        location.href = '/';
    };
}

// ── Carregar dados ────────────────────────────────────────────────────

async function carregarAmbientes() {
    try {
        const r    = await fetch(`${API}/circulacao/ambientes`);
        const data = await r.json();
        ambientes  = Array.isArray(data) ? data : [];
        renderChipsScanner();
        renderFiltroHistorico();
    } catch {
        ambientes = [];
        renderChipsScanner();
    }
}

async function recarregarTudo() {
    const dia = document.getElementById('inputData').value;
    try {
        const [a, h] = await Promise.all([
            fetch(`${API}/circulacao/ativos`).then(r => r.json()),
            fetch(`${API}/circulacao/historico?data=${dia}`).then(r => r.json())
        ]);
        ativosGlobal    = Array.isArray(a) ? a : [];
        historicoGlobal = Array.isArray(h) ? h : [];
    } catch {
        ativosGlobal    = [];
        historicoGlobal = [];
    }
    renderGridAmbientes();
    renderHistoricoGlobal();
}

// ── Chips do scanner ──────────────────────────────────────────────────

function renderChipsScanner() {
    const cont  = document.getElementById('chipAmbientes');
    const ativos = ambientes.filter(a => a.ativo);
    if (!ativos.length) {
        cont.innerHTML = '<span class="chip-loading">Nenhum ambiente cadastrado. Clique em "Gerenciar Ambientes".</span>';
        return;
    }
    cont.innerHTML = ativos.map(a =>
        `<button class="chip-amb ${ambienteSel?.id === a.id ? 'ativo' : ''}"
            onclick="selecionarAmbiente(${a.id})">${tipoIcon(a.tipo)} ${a.nome}</button>`
    ).join('');
    // Seleciona o primeiro por padrão se nenhum estiver selecionado
    if (!ambienteSel && ativos.length) {
        ambienteSel = ativos[0];
        cont.querySelector('.chip-amb').classList.add('ativo');
    }
}

function selecionarAmbiente(id) {
    ambienteSel = ambientes.find(a => a.id === id) || null;
    renderChipsScanner();
    renderGridAmbientes();
    focarInput();
}

// ── Filtro do histórico ───────────────────────────────────────────────

function renderFiltroHistorico() {
    const sel = document.getElementById('filtroAmbHist');
    const val = sel.value;
    sel.innerHTML = '<option value="">Todos os ambientes</option>' +
        ambientes.map(a => `<option value="${a.id}">${tipoIcon(a.tipo)} ${a.nome}</option>`).join('');
    sel.value = val;
}

// ── Scan ──────────────────────────────────────────────────────────────

async function processarScan() {
    const input = document.getElementById('inputScan');
    const raw   = input.value.trim();
    input.value = '';
    focarInput();
    if (!raw) return;

    if (!ambienteSel) return mostrarToast('⚠️ Selecione um ambiente primeiro', 'warn');

    const cod = extrairCod(raw);
    if (!cod) return mostrarToast('QR Code inválido', 'error');

    try {
        const r = await fetch(`${API}/circulacao/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cod_matriz_aluno: cod, ambiente_id: ambienteSel.id })
        });
        const data = await r.json();
        if (!r.ok) return mostrarToast(data.erro || 'Erro ao registrar', 'error');

        exibirFeedback(data, cod);
        await recarregarTudo();
    } catch {
        mostrarToast('Erro de conexão', 'error');
    }
}

function extrairCod(raw) {
    const m = raw.match(/(?:cod:|cod=|id:)?(\d{5,})/i);
    return m ? parseInt(m[1]) : null;
}

function exibirFeedback(data, cod) {
    const fb    = document.getElementById('feedbackScan');
    const icon  = document.getElementById('feedbackIcon');
    const nomeEl  = document.getElementById('feedbackNome');
    const turmaEl = document.getElementById('feedbackTurma');
    const acao  = document.getElementById('feedbackAcao');

    // Prioriza o aluno retornado diretamente pelo endpoint
    const nomeAluno  = data.aluno?.nome  || buscarNomeCache(cod);
    const turmaAluno = data.aluno?.turma || '';

    fb.className = `feedback-scan ${data.acao}`;
    nomeEl.textContent  = nomeAluno;
    turmaEl.textContent = turmaAluno;

    if (data.acao === 'entrada') {
        icon.textContent = '✅';
        acao.textContent = `Entrada — ${formatHora(data.registro.entrada_em)}`;
    } else {
        icon.textContent = '🔴';
        const dur = data.duracao_min != null ? ` — ${data.duracao_min} min` : '';
        acao.textContent = `Saída — ${formatHora(data.registro.saida_em)}${dur}`;
    }
}

// Fallback: tenta achar o nome no cache local (caso o endpoint não retorne)
function buscarNomeCache(cod) {
    const a = ativosGlobal.find(x => x.cod_matriz_aluno == cod);
    if (a?.alunos?.nome) return a.alunos.nome;
    const h = historicoGlobal.find(x => x.cod_matriz_aluno == cod);
    if (h?.alunos?.nome) return h.alunos.nome;
    return `Aluno #${cod}`;
}

// ── Saída manual ──────────────────────────────────────────────────────

async function registrarSaida(id, btn) {
    btn.disabled = true;
    try {
        const r    = await fetch(`${API}/circulacao/saida/${id}`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok) { mostrarToast(data.erro || 'Erro', 'error'); btn.disabled = false; return; }
        const dur = data.duracao_min != null ? ` (${data.duracao_min} min)` : '';
        mostrarToast(`✅ Saída registrada${dur}`);
        await recarregarTudo();
    } catch { btn.disabled = false; }
}

// ── Grid de ambientes ─────────────────────────────────────────────────

function renderGridAmbientes() {
    const grid  = document.getElementById('gridAmbientes');
    const ativos = ambientes.filter(a => a.ativo);

    if (!ativos.length) {
        grid.innerHTML = `
        <div class="grid-vazio">
            <div class="grid-vazio-icon">🚪</div>
            <p>Nenhum ambiente cadastrado ainda.</p>
            <button class="btn-gerenciar" onclick="abrirModalAmbientes()">⚙️ Cadastrar primeiro ambiente</button>
        </div>`;
        return;
    }

    grid.innerHTML = ativos.map(amb => renderCardAmbiente(amb)).join('');
}

function renderCardAmbiente(amb) {
    const dentroAmb = ativosGlobal.filter(r => r.ambiente_id === amb.id);
    const histAmb   = historicoGlobal.filter(r => r.ambiente_id === amb.id);
    const total     = dentroAmb.length;
    const cap       = amb.capacidade_max || 1;
    const pct       = Math.min(total / cap * 100, 100);

    const classeCard  = total >= cap ? 'cheio' : total >= cap * 0.7 ? 'quase' : 'livre';
    const classeBarra = classeCard;
    const statusDot   = classeCard;

    // Dentro agora
    const agora    = Date.now();
    const dentroHTML = dentroAmb.length
        ? dentroAmb.map(reg => {
            const nome   = reg.alunos?.nome  || `Aluno #${reg.cod_matriz_aluno}`;
            const turma  = reg.alunos?.turma || '';
            const ini    = iniciais2(nome);
            const min    = Math.round((agora - new Date(reg.entrada_em)) / 60000);
            const tc     = min >= 15 ? 'danger' : min >= 8 ? 'warn' : '';
            return `<div class="amb-dentro-item">
                <div class="amb-dentro-avatar">${ini}</div>
                <div class="amb-dentro-info">
                    <span class="amb-dentro-nome">${nome}</span>
                    ${turma ? `<span class="amb-dentro-turma">${turma}</span>` : ''}
                </div>
                <span class="amb-dentro-timer ${tc}" data-entrada="${reg.entrada_em}">${formatDuracao(min)}</span>
                <button class="btn-saida-rapida" onclick="registrarSaida(${reg.id}, this)" title="Registrar saída">↩</button>
            </div>`;
        }).join('')
        : '<div class="amb-dentro-vazio">Nenhum aluno dentro</div>';

    // Mini-histórico (excluindo os que ainda estão dentro, mostra os últimos 5 com saída)
    const histComSaida = histAmb.filter(r => r.saida_em).slice(0, 5);
    const histHTML = histComSaida.length
        ? histComSaida.map(reg => {
            const nome   = reg.alunos?.nome  || `Aluno #${reg.cod_matriz_aluno}`;
            const durMin = Math.round((new Date(reg.saida_em) - new Date(reg.entrada_em)) / 60000);
            const bClass = durMin >= 15 ? 'alerta' : 'saiu';
            return `<div class="amb-hist-item">
                <span class="amb-hist-badge ${bClass}"></span>
                <span class="amb-hist-nome">${nome}</span>
                <span class="amb-hist-hora">${formatHora(reg.entrada_em)} · ${formatDuracao(durMin)}</span>
            </div>`;
        }).join('')
        : '<div class="amb-hist-vazio">Sem registros finalizados hoje</div>';

    const isSelAtual = ambienteSel?.id === amb.id;

    return `
    <div class="amb-card ${classeCard}" id="card-amb-${amb.id}">
        <div class="amb-card-header">
            <div class="amb-card-icon ${classeCard}">${tipoIcon(amb.tipo)}</div>
            <div class="amb-card-titulo">
                <div class="amb-card-nome">${amb.nome}</div>
                <div class="amb-card-tipo">${tipoLabel(amb.tipo)}</div>
            </div>
            <div class="amb-status-dot ${statusDot}" title="${statusDot === 'cheio' ? 'Cheio' : statusDot === 'quase' ? 'Quase cheio' : 'Disponível'}"></div>
        </div>

        <div class="amb-ocupacao">
            <div class="ocup-bar-wrap">
                <div class="ocup-bar-bg">
                    <div class="ocup-bar-fill ${classeBarra}" style="width:${pct}%"></div>
                </div>
                <span class="ocup-texto ${classeCard}">${total}/${cap} dentro</span>
            </div>
        </div>

        <div class="amb-dentro-header">
            <span>🟢 Dentro agora (${total})</span>
            <button class="amb-btn-registrar ${isSelAtual ? '' : ''}"
                onclick="selecionarAmbiente(${amb.id}); focarInput()">
                ${isSelAtual ? '✓ Selecionado' : 'Usar scanner aqui'}
            </button>
        </div>
        <div class="amb-dentro-lista">${dentroHTML}</div>

        <div class="amb-hist-header">
            <span>📋 Histórico do dia</span>
            <span class="amb-hist-count">${histAmb.length} total</span>
        </div>
        <div class="amb-hist-lista">${histHTML}</div>
    </div>`;
}

// ── Histórico global ──────────────────────────────────────────────────

function renderHistoricoGlobal() {
    const tbody    = document.getElementById('corpoHistorico');
    const countEl  = document.getElementById('countHistorico');
    const filtroId = parseInt(document.getElementById('filtroAmbHist').value) || null;

    const lista = filtroId
        ? historicoGlobal.filter(r => r.ambiente_id === filtroId)
        : historicoGlobal;

    countEl.textContent = `${lista.length} registro${lista.length !== 1 ? 's' : ''}`;

    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhum registro neste dia</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(reg => {
        const nome   = reg.alunos?.nome || `Aluno #${reg.cod_matriz_aluno}`;
        const turma  = reg.alunos?.turma || '—';
        const ambNome = ambientes.find(a => a.id === reg.ambiente_id)?.nome || `#${reg.ambiente_id}`;
        const entrada = formatHora(reg.entrada_em);
        const saida   = reg.saida_em ? formatHora(reg.saida_em) : '—';
        const durMin  = reg.saida_em
            ? Math.round((new Date(reg.saida_em) - new Date(reg.entrada_em)) / 60000)
            : Math.round((Date.now() - new Date(reg.entrada_em)) / 60000);

        let stCl, stTx;
        if (!reg.saida_em)     { stCl = 'dentro'; stTx = 'Dentro'; }
        else if (durMin >= 15) { stCl = 'alerta'; stTx = 'Demorado'; }
        else                   { stCl = 'saiu';   stTx = 'Saiu'; }

        return `<tr>
            <td>${nome}</td>
            <td>${turma}</td>
            <td>${ambNome}</td>
            <td>${entrada}</td>
            <td>${saida}</td>
            <td>${formatDuracao(durMin)}</td>
            <td><span class="badge-status ${stCl}">${stTx}</span></td>
        </tr>`;
    }).join('');
}

// ── Auto-refresh ──────────────────────────────────────────────────────

function iniciarAutoRefresh() {
    // Atualiza timers a cada 10s
    setInterval(() => {
        document.querySelectorAll('.amb-dentro-timer[data-entrada]').forEach(el => {
            const min = Math.round((Date.now() - new Date(el.dataset.entrada)) / 60000);
            el.textContent = formatDuracao(min);
            el.className = `amb-dentro-timer ${min >= 15 ? 'danger' : min >= 8 ? 'warn' : ''}`;
        });
    }, 10000);
    // Recarrega dados a cada 45s
    setInterval(recarregarTudo, 45000);
}

// ── Modal Ambientes ───────────────────────────────────────────────────

async function abrirModalAmbientes() {
    document.getElementById('modalAmbientes').classList.remove('oculto');
    await renderAmbientesModal();
}
function fecharModalAmbientes() {
    document.getElementById('modalAmbientes').classList.add('oculto');
}
function fecharModalSeOverlay(e) {
    if (e.target === document.getElementById('modalAmbientes')) fecharModalAmbientes();
}

async function renderAmbientesModal() {
    const cont = document.getElementById('listaAmbientesModal');
    try {
        const r    = await fetch(`${API}/circulacao/ambientes`);
        const todos = await r.json();
        if (!Array.isArray(todos) || !todos.length) {
            cont.innerHTML = '<div class="empty-row">Nenhum ambiente cadastrado</div>';
            return;
        }
        cont.innerHTML = todos.map(a => `
        <div class="ambiente-row ${a.ativo ? '' : 'inativo'}">
            <span class="amb-tipo-icon">${tipoIcon(a.tipo)}</span>
            <div class="amb-info">
                <div class="amb-nome">${a.nome}</div>
                <div class="amb-sub">${tipoLabel(a.tipo)} · Capacidade: ${a.capacidade_max}${a.ativo ? '' : ' · Inativo'}</div>
            </div>
            <div class="amb-actions">
                ${a.ativo
                    ? `<button class="btn-amb danger" onclick="desativarAmbiente(${a.id})">Desativar</button>`
                    : `<button class="btn-amb" onclick="reativarAmbiente(${a.id})">Reativar</button>`
                }
            </div>
        </div>`).join('');
    } catch {
        cont.innerHTML = '<div class="empty-row">Erro ao carregar</div>';
    }
}

async function adicionarAmbiente() {
    const nome = document.getElementById('novoNome').value.trim();
    const tipo  = document.getElementById('novoTipo').value;
    const cap   = parseInt(document.getElementById('novoCap').value) || 2;
    if (!nome) return mostrarToast('⚠️ Informe o nome do ambiente', 'warn');

    try {
        const r = await fetch(`${API}/circulacao/ambientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, tipo, capacidade_max: cap })
        });
        if (!r.ok) { const d = await r.json(); return mostrarToast(d.erro, 'error'); }
        document.getElementById('novoNome').value = '';
        mostrarToast('✅ Ambiente adicionado');
        await carregarAmbientes();
        await renderAmbientesModal();
        await recarregarTudo();
    } catch { mostrarToast('Erro ao salvar', 'error'); }
}

async function desativarAmbiente(id) {
    if (!confirm('Desativar este ambiente?')) return;
    await fetch(`${API}/circulacao/ambientes/${id}`, { method: 'DELETE' });
    if (ambienteSel?.id === id) ambienteSel = null;
    await carregarAmbientes();
    await renderAmbientesModal();
    await recarregarTudo();
}

async function reativarAmbiente(id) {
    await fetch(`${API}/circulacao/ambientes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: true })
    });
    await carregarAmbientes();
    await renderAmbientesModal();
    await recarregarTudo();
}

// ── Câmera QR (leitura ao vivo com jsQR) ──────────────────────────────

async function abrirCamera() {
    const wrap  = document.getElementById('camWrap');
    const video = document.getElementById('camVideo');

    if (!wrap.classList.contains('oculto')) {
        fecharCamera();
        return;
    }

    wrap.classList.remove('oculto');

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = cameraStream;
        await video.play();
        loopQR();
    } catch (err) {
        mostrarToast('⚠️ Câmera não disponível: ' + err.message, 'warn');
        wrap.classList.add('oculto');
    }
}

function fecharCamera() {
    if (cameraLoop) { cancelAnimationFrame(cameraLoop); cameraLoop = null; }
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    document.getElementById('camWrap').classList.add('oculto');
    focarInput();
}

function loopQR() {
    const video  = document.getElementById('camVideo');
    const canvas = document.getElementById('camCanvas');

    if (!video || video.readyState < video.HAVE_ENOUGH_DATA) {
        cameraLoop = requestAnimationFrame(loopQR);
        return;
    }

    const ctx = canvas.getContext('2d');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code    = jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: 'dontInvert'
    });

    if (code?.data) {
        fecharCamera();
        document.getElementById('inputScan').value = code.data;
        processarScan();
        return;
    }

    cameraLoop = requestAnimationFrame(loopQR);
}

// ── Utilitários ───────────────────────────────────────────────────────

function focarInput() {
    setTimeout(() => document.getElementById('inputScan')?.focus(), 80);
}
function tipoIcon(tipo) {
    return { banheiro: '🚻', laboratorio: '🔬', biblioteca: '📚', sala: '🏫', outro: '📍' }[tipo] || '📍';
}
function tipoLabel(tipo) {
    return { banheiro: 'Banheiro', laboratorio: 'Laboratório', biblioteca: 'Biblioteca', sala: 'Sala especial', outro: 'Outro' }[tipo] || 'Outro';
}
function formatHora(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}
function formatDuracao(min) {
    if (min == null || isNaN(min)) return '—';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
}
function iniciais2(nome) {
    const p = nome.trim().split(/\s+/);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function mostrarToast(msg, tipo) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${tipo || ''}`;
    setTimeout(() => t.classList.remove('show'), 3000);
}
