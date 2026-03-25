/* ── Circulação ─────────────────────────────────────────────────────── */

const API = '/api';

let ambientes       = [];
let ambienteSel     = null;
let ativosCache     = [];
let historicoCache  = [];
let timerInterval   = null;
let cameraStream    = null;
let cameraLoop      = null;

// ── Init ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    verificarAuth();
    setDataHoje();
    await carregarAmbientes();
    await Promise.all([carregarAtivos(), carregarHistorico()]);
    iniciarTimers();
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

async function verificarAuth() {
    try {
        const r = await fetch(`${API}/alunos`);
        if (r.status === 401) location.href = '/';
    } catch { /* silencioso */ }
    document.getElementById('btnLogout').onclick = async () => {
        await fetch(`${API}/logout`, { method: 'POST' });
        location.href = '/';
    };
}

// ── Ambientes ─────────────────────────────────────────────────────────

async function carregarAmbientes() {
    try {
        const r = await fetch(`${API}/circulacao/ambientes`);
        const data = await r.json();
        ambientes = Array.isArray(data) ? data.filter(a => a.ativo) : [];
        renderSelectAmbiente();
    } catch (e) {
        console.error('Erro ao carregar ambientes', e);
        ambientes = [];
        renderSelectAmbiente();
    }
}

function renderSelectAmbiente() {
    const sel = document.getElementById('selAmbiente');
    if (!ambientes.length) {
        sel.innerHTML = '<option value="">Nenhum ambiente cadastrado</option>';
        ambienteSel = null;
        return;
    }
    const anteriorId = ambienteSel?.id;
    sel.innerHTML = ambientes.map(a =>
        `<option value="${a.id}">${tipoIcon(a.tipo)} ${a.nome}</option>`
    ).join('');
    const mantido = ambientes.find(a => a.id === anteriorId);
    ambienteSel = mantido || ambientes[0];
    sel.value = ambienteSel.id;
}

function trocarAmbiente() {
    const id = parseInt(document.getElementById('selAmbiente').value);
    ambienteSel = ambientes.find(a => a.id === id) || null;
    carregarAtivos();
    carregarHistorico();
    focarInput();
}

function tipoIcon(tipo) {
    const icons = { banheiro: '🚻', laboratorio: '🔬', biblioteca: '📚', sala: '🏫', outro: '📍' };
    return icons[tipo] || '📍';
}

// ── Scan ──────────────────────────────────────────────────────────────

async function processarScan() {
    const input = document.getElementById('inputScan');
    const raw   = input.value.trim();
    input.value = '';
    focarInput();
    if (!raw) return;

    if (!ambienteSel) return mostrarToast('⚠️ Selecione um ambiente primeiro', 'warn');

    // O QR do crachá pode ser "cod:XXXXX" ou apenas o número
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
        await carregarAtivos();
        await carregarHistorico();
    } catch (e) {
        mostrarToast('Erro de conexão', 'error');
    }
}

function extrairCod(raw) {
    // Formato "cod:12345" ou apenas "12345"
    const m = raw.match(/(?:cod:|cod=|id:)?(\d{5,})/i);
    return m ? parseInt(m[1]) : null;
}

async function exibirFeedback(data, cod) {
    const fb    = document.getElementById('feedbackScan');
    const icon  = document.getElementById('feedbackIcon');
    const nome  = document.getElementById('feedbackNome');
    const acao  = document.getElementById('feedbackAcao');

    // Buscar nome do aluno nos ativos ou no histórico
    const nomeAluno = buscarNomeAluno(cod) || `#${cod}`;

    fb.className = `feedback-scan ${data.acao}`;

    if (data.acao === 'entrada') {
        icon.textContent = '✅';
        nome.textContent = nomeAluno;
        acao.textContent = `Entrada registrada às ${formatHora(data.registro.entrada_em)}`;
    } else {
        icon.textContent = '🔴';
        nome.textContent = nomeAluno;
        const dur = data.duracao_min != null ? ` — ${data.duracao_min} min` : '';
        acao.textContent = `Saída registrada às ${formatHora(data.registro.saida_em)}${dur}`;
    }
}

function buscarNomeAluno(cod) {
    const a = ativosCache.find(x => x.cod_matriz_aluno == cod);
    if (a?.alunos?.nome) return a.alunos.nome;
    const h = historicoCache.find(x => x.cod_matriz_aluno == cod);
    if (h?.alunos?.nome) return h.alunos.nome;
    return null;
}

// ── Ativos ────────────────────────────────────────────────────────────

async function carregarAtivos() {
    if (!ambienteSel) return;
    try {
        const r = await fetch(`${API}/circulacao/ativos?ambiente_id=${ambienteSel.id}`);
        ativosCache = await r.json();
        renderAtivos();
    } catch { /* silencioso */ }
}

function renderAtivos() {
    const lista  = document.getElementById('listaAtivos');
    const count  = document.getElementById('countAtivos');
    const capEl  = document.getElementById('capInfo');

    count.textContent = ativosCache.length;

    if (ambienteSel?.capacidade_max) {
        const pct = Math.round(ativosCache.length / ambienteSel.capacidade_max * 100);
        capEl.textContent = `${ativosCache.length}/${ambienteSel.capacidade_max} (${pct}%)`;
    } else {
        capEl.textContent = '';
    }

    if (!ativosCache.length) {
        lista.innerHTML = '<div class="empty-ativos">Nenhum aluno dentro agora</div>';
        return;
    }

    const agora = Date.now();
    lista.innerHTML = ativosCache.map(reg => {
        const nome   = reg.alunos?.nome   || `#${reg.cod_matriz_aluno}`;
        const turma  = reg.alunos?.descr_turma || '';
        const iniciais = iniciais2(nome);
        const minutos  = Math.round((agora - new Date(reg.entrada_em)) / 60000);
        const alertClass = minutos >= 15 ? 'danger' : minutos >= 8 ? 'warn' : '';
        const cardClass  = minutos >= 8 ? 'alerta' : '';
        const timerTxt   = formatDuracao(minutos);
        return `
        <div class="ativo-card ${cardClass}" id="ativo-${reg.id}">
            <div class="ativo-avatar">${iniciais}</div>
            <div class="ativo-info">
                <div class="ativo-nome">${nome}</div>
                <div class="ativo-turma">${turma}</div>
            </div>
            <div class="ativo-meta">
                <span class="ativo-timer ${alertClass}" data-entrada="${reg.entrada_em}">${timerTxt}</span>
                <button class="btn-saida-manual" onclick="registrarSaidaManual(${reg.id}, this)">↩ Saída</button>
            </div>
        </div>`;
    }).join('');
}

async function registrarSaidaManual(id, btn) {
    btn.disabled = true;
    try {
        const r = await fetch(`${API}/circulacao/saida/${id}`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok) { mostrarToast(data.erro || 'Erro', 'error'); btn.disabled = false; return; }
        const dur = data.duracao_min != null ? ` (${data.duracao_min} min)` : '';
        mostrarToast(`✅ Saída registrada${dur}`);
        await carregarAtivos();
        await carregarHistorico();
    } catch { btn.disabled = false; }
}

// ── Timers ao vivo ────────────────────────────────────────────────────

function iniciarTimers() {
    timerInterval = setInterval(() => {
        document.querySelectorAll('.ativo-timer[data-entrada]').forEach(el => {
            const min = Math.round((Date.now() - new Date(el.dataset.entrada)) / 60000);
            el.textContent = formatDuracao(min);
            el.className = `ativo-timer ${min >= 15 ? 'danger' : min >= 8 ? 'warn' : ''}`;
        });
    }, 10000);

    // Recarregar ativos a cada 60s
    setInterval(async () => {
        await carregarAtivos();
        await carregarHistorico();
    }, 60000);
}

// ── Histórico ─────────────────────────────────────────────────────────

async function carregarHistorico() {
    if (!ambienteSel) return;
    const data = document.getElementById('inputData').value;
    try {
        const r = await fetch(
            `${API}/circulacao/historico?data=${data}&ambiente_id=${ambienteSel.id}`
        );
        historicoCache = await r.json();
        renderHistorico();
    } catch { /* silencioso */ }
}

function renderHistorico() {
    const tbody   = document.getElementById('corpoHistorico');
    const countEl = document.getElementById('countHistorico');
    countEl.textContent = `${historicoCache.length} registro${historicoCache.length !== 1 ? 's' : ''}`;

    if (!historicoCache.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhum registro neste dia</td></tr>';
        return;
    }

    tbody.innerHTML = historicoCache.map(reg => {
        const nome   = reg.alunos?.nome   || `#${reg.cod_matriz_aluno}`;
        const turma  = reg.alunos?.descr_turma || '—';
        const entrada = formatHora(reg.entrada_em);
        const saida   = reg.saida_em ? formatHora(reg.saida_em) : '—';
        let durMin = null;
        if (reg.saida_em) {
            durMin = Math.round((new Date(reg.saida_em) - new Date(reg.entrada_em)) / 60000);
        } else {
            durMin = Math.round((Date.now() - new Date(reg.entrada_em)) / 60000);
        }
        const durTxt  = formatDuracao(durMin);

        let statusClass, statusTxt;
        if (!reg.saida_em) {
            statusClass = 'dentro'; statusTxt = 'Dentro';
        } else if (durMin >= 15) {
            statusClass = 'alerta'; statusTxt = 'Demorado';
        } else {
            statusClass = 'saiu'; statusTxt = 'Saiu';
        }

        return `<tr>
            <td>${nome}</td>
            <td>${turma}</td>
            <td>${entrada}</td>
            <td>${saida}</td>
            <td>${durTxt}</td>
            <td><span class="badge-status ${statusClass}">${statusTxt}</span></td>
        </tr>`;
    }).join('');
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
        const r = await fetch(`${API}/circulacao/ambientes`);
        const todos = await r.json();
        if (!todos.length) {
            cont.innerHTML = '<div class="empty-row">Nenhum ambiente cadastrado</div>';
            return;
        }
        cont.innerHTML = todos.map(a => `
        <div class="ambiente-row ${a.ativo ? '' : 'inativo'}" id="ambrow-${a.id}">
            <span class="amb-tipo-icon">${tipoIcon(a.tipo)}</span>
            <div class="amb-info">
                <div class="amb-nome">${a.nome}</div>
                <div class="amb-sub">${tipoLabel(a.tipo)} · Capacidade: ${a.capacidade_max} ${a.ativo ? '' : '· Inativo'}</div>
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
    } catch { mostrarToast('Erro ao salvar', 'error'); }
}

async function desativarAmbiente(id) {
    if (!confirm('Desativar este ambiente?')) return;
    await fetch(`${API}/circulacao/ambientes/${id}`, {
        method: 'DELETE'
    });
    await carregarAmbientes();
    await renderAmbientesModal();
}

async function reativarAmbiente(id) {
    await fetch(`${API}/circulacao/ambientes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: true })
    });
    await carregarAmbientes();
    await renderAmbientesModal();
}

function tipoLabel(tipo) {
    const labels = { banheiro: 'Banheiro', laboratorio: 'Laboratório', biblioteca: 'Biblioteca', sala: 'Sala especial', outro: 'Outro' };
    return labels[tipo] || 'Outro';
}

// ── Câmera QR ─────────────────────────────────────────────────────────

async function abrirCamera() {
    const wrap  = document.getElementById('camWrap');
    const video = document.getElementById('camVideo');
    wrap.classList.remove('oculto');
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = cameraStream;
        await video.play();
        iniciarLoopQR();
    } catch {
        mostrarToast('⚠️ Câmera não disponível', 'warn');
        wrap.classList.add('oculto');
    }
}

function fecharCamera() {
    clearInterval(cameraLoop);
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    document.getElementById('camWrap').classList.add('oculto');
}

function iniciarLoopQR() {
    const video  = document.getElementById('camVideo');
    const canvas = document.getElementById('camCanvas');
    const ctx    = canvas.getContext('2d');
    cameraLoop = setInterval(() => {
        if (video.readyState < 2) return;
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        // BarcodeDetector API (Chrome/Edge modernos)
        if ('BarcodeDetector' in window) {
            const bd = new BarcodeDetector({ formats: ['qr_code'] });
            bd.detect(canvas).then(codes => {
                if (codes.length) {
                    const raw = codes[0].rawValue;
                    document.getElementById('inputScan').value = raw;
                    fecharCamera();
                    processarScan();
                }
            }).catch(() => {});
        }
    }, 500);
}

// ── Utilitários ───────────────────────────────────────────────────────

function focarInput() {
    setTimeout(() => document.getElementById('inputScan')?.focus(), 100);
}

function formatHora(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatDuracao(min) {
    if (min == null || isNaN(min)) return '—';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
}

function iniciais2(nome) {
    const partes = nome.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function mostrarToast(msg, tipo) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${tipo || ''}`;
    setTimeout(() => t.classList.remove('show'), 3000);
}
