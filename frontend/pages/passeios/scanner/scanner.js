/* ── EduSync Scanner de Embarque ─────────────────────────────────── */
'use strict';

/* Registrar Service Worker para suporte offline */
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/pages/passeios/scanner/sw.js', { scope: '/pages/passeios/scanner/' })
        .then(reg => console.log('[SW] Registrado:', reg.scope))
        .catch(err => console.warn('[SW] Erro:', err));
}

const API = '/api';
const OFFLINE_KEY = 'edusync_scan_offline_queue';

let acaoAtual   = 'embarque'; // embarque | desembarque
let cameraAtiva = false;
let scanStream  = null;
let scanAnimId  = null;
let scanCooldown = false;
let logEntries  = [];

/* ── Inicialização ── */
window.addEventListener('DOMContentLoaded', () => {
    restaurarOfflineQueue();
    verificarConectividade();
    window.addEventListener('online',  () => { verificarConectividade(); sincronizarOffline(); });
    window.addEventListener('offline', () => verificarConectividade());

    /* Auto-foco no input */
    document.getElementById('inputManual').focus();

    /* Enter no input manual */
    document.getElementById('inputManual').addEventListener('keydown', e => {
        if (e.key === 'Enter') processarManual();
    });
});

/* ── Ação: embarque / desembarque ── */
function setAcao(acao) {
    acaoAtual = acao;
    document.getElementById('btnEmbarque').classList.toggle('ativo', acao === 'embarque');
    document.getElementById('btnDesembarque').classList.toggle('ativo', acao === 'desembarque');
    mostrarIdle();
}

/* ── Camera ── */
async function toggleCamera() {
    if (cameraAtiva) {
        pararCamera();
    } else {
        await iniciarCamera();
    }
}

async function iniciarCamera() {
    const wrap = document.getElementById('camWrap');
    const btn  = document.getElementById('btnCamera');
    try {
        scanStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
        });
        const video = document.getElementById('camVideo');
        video.srcObject = scanStream;
        await video.play();
        wrap.classList.add('ativo');
        btn.classList.add('ativo');
        btn.textContent = '⏹ Parar Câmera';
        cameraAtiva = true;
        scanLoop();
    } catch (e) {
        mostrarFeedback('erro', '🚫', 'Câmera indisponível', e.message, '', '');
    }
}

function pararCamera() {
    if (scanStream) {
        scanStream.getTracks().forEach(t => t.stop());
        scanStream = null;
    }
    if (scanAnimId) { cancelAnimationFrame(scanAnimId); scanAnimId = null; }
    const wrap = document.getElementById('camWrap');
    const btn  = document.getElementById('btnCamera');
    wrap.classList.remove('ativo');
    btn.classList.remove('ativo');
    btn.textContent = '📷 Câmera';
    cameraAtiva = false;
}

function scanLoop() {
    const video  = document.getElementById('camVideo');
    const canvas = document.getElementById('camCanvas');

    if (!cameraAtiva) return;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        scanAnimId = requestAnimationFrame(scanLoop);
        return;
    }
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
    });

    if (code && !scanCooldown) {
        processarToken(extrairToken(code.data));
    }

    scanAnimId = requestAnimationFrame(scanLoop);
}

/* O QR aponta para /p/:eventoId/:alunoToken — extraímos o token */
function extrairToken(rawData) {
    try {
        const url = new URL(rawData);
        const parts = url.pathname.split('/').filter(Boolean);
        // parts = ['p', eventoId, alunoToken]
        if (parts[0] === 'p' && parts.length >= 3) return parts[2];
    } catch {}
    /* Se não for URL, assume que é o token diretamente */
    return rawData.trim();
}

/* ── Processar ── */
function processarManual() {
    const val = document.getElementById('inputManual').value.trim();
    if (!val) return;
    document.getElementById('inputManual').value = '';
    processarToken(extrairToken(val));
}

async function processarToken(token) {
    if (!token) return;
    if (scanCooldown) return;
    scanCooldown = true;
    setTimeout(() => { scanCooldown = false; }, 2000);

    if (!navigator.onLine) {
        /* Fila offline */
        salvarOffline(token, acaoAtual);
        mostrarFeedback('offline', '📵', 'Sem conexão', 'Scan salvo — será sincronizado quando houver internet', '', '');
        adicionarLog('offline', token.slice(0, 16) + '…', 'offline');
        return;
    }

    try {
        const r = await fetch(`${API}/passeios/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, acao: acaoAtual }),
        });
        const d = await r.json();

        if (r.ok) {
            const repetido = d.repetido;
            const tipo     = repetido ? 'repetido' : 'ok';
            const icon     = acaoAtual === 'embarque' ? (repetido ? '🔄' : '✅') : '🏠';
            const status   = repetido
                ? 'Já registrado anteriormente'
                : (acaoAtual === 'embarque' ? 'Embarcou!' : 'Retornou!');
            mostrarFeedback(tipo, icon, d.aluno, d.turma, d.onibus || '', status);
            adicionarLog(tipo, `${d.aluno} — ${d.onibus || 'sem ônibus'}`, acaoAtual);
            tocarBeep(tipo === 'ok');
        } else {
            mostrarFeedback('erro', '❌', 'Erro', d.erro || 'Aluno não encontrado', '', '');
            adicionarLog('erro', d.erro || 'Erro', acaoAtual);
            tocarBeep(false);
        }
    } catch (e) {
        /* Falha de rede — salvar offline */
        salvarOffline(token, acaoAtual);
        mostrarFeedback('offline', '📵', 'Sem conexão', 'Scan salvo para sync posterior', '', '');
        adicionarLog('offline', 'scan offline', acaoAtual);
    }
}

/* ── Feedback visual ── */
function mostrarFeedback(tipo, icon, nome, turma, onibus, status) {
    const panel = document.getElementById('feedbackPanel');
    const idle  = document.getElementById('feedbackIdle');
    panel.className = `sc-feedback ${tipo}`;
    panel.classList.remove('oculto');
    idle.style.display = 'none';
    document.getElementById('feedbackIcon').textContent   = icon;
    document.getElementById('feedbackNome').textContent   = nome;
    document.getElementById('feedbackTurma').textContent  = turma;
    document.getElementById('feedbackOnibus').textContent = onibus ? `🚌 ${onibus}` : '';
    document.getElementById('feedbackEvento').textContent = '';
    document.getElementById('feedbackStatus').textContent = status;
    setTimeout(mostrarIdle, 4000);
}

function mostrarIdle() {
    document.getElementById('feedbackPanel').classList.add('oculto');
    document.getElementById('feedbackIdle').style.display = '';
}

/* ── Log ── */
function adicionarLog(tipo, msg, acao) {
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logEntries.unshift({ tipo, msg, acao, hora });
    renderizarLog();
}

function renderizarLog() {
    const el = document.getElementById('scanLog');
    const ct = document.getElementById('logCount');
    ct.textContent = logEntries.length;
    el.innerHTML   = logEntries.map(e => `
        <div class="sc-log-item ${e.tipo}">
            <span>${e.tipo === 'ok' ? '✅' : e.tipo === 'repetido' ? '🔄' : e.tipo === 'offline' ? '📵' : '❌'}</span>
            <span>${esc(e.msg)}</span>
            <span class="sc-log-hora">${e.hora}</span>
        </div>
    `).join('');
}

function limparLog() {
    logEntries = [];
    renderizarLog();
}

/* ── Offline queue ── */
function salvarOffline(token, acao) {
    const queue = lerOfflineQueue();
    queue.push({ token, acao, ts: Date.now() });
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(queue));
    atualizarOfflineBar();
}

function lerOfflineQueue() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch { return []; }
}

function restaurarOfflineQueue() { atualizarOfflineBar(); }

function atualizarOfflineBar() {
    const queue = lerOfflineQueue();
    const bar   = document.getElementById('offlineBar');
    const ct    = document.getElementById('offlineCount');
    ct.textContent = queue.length;
    bar.classList.toggle('oculto', queue.length === 0);
}

async function sincronizarOffline() {
    const queue = lerOfflineQueue();
    if (!queue.length) return;
    if (!navigator.onLine) return;

    const falhas = [];
    for (const item of queue) {
        try {
            const r = await fetch(`${API}/passeios/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: item.token, acao: item.acao }),
            });
            if (!r.ok) { falhas.push(item); }
        } catch { falhas.push(item); }
    }

    localStorage.setItem(OFFLINE_KEY, JSON.stringify(falhas));
    atualizarOfflineBar();
    if (falhas.length < queue.length) {
        adicionarLog('ok', `${queue.length - falhas.length} scan(s) sincronizado(s)`, 'sync');
    }
}

function verificarConectividade() {
    atualizarOfflineBar();
}

/* ── Beep ── */
function tocarBeep(sucesso) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = sucesso ? 880 : 220;
        osc.type = 'sine';
        gain.gain.setValueAtTime(.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (sucesso ? .25 : .5));
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + (sucesso ? .25 : .5));
    } catch {}
}

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
