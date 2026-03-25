// ── Estado ────────────────────────────────────────────────────────────────────
let ambientes      = [];
let ambienteSel    = null;    // { id, nome, tipo }
let ativos         = [];
let historico      = [];
let scanStream     = null;
let scanAnimFrame  = null;
let cameraAberta   = false;
let autoTimer      = null;
let tempoTimer     = null;

const AUTO_MS = 15_000;

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    iniciarRelogio();
    iniciarTempos();
    carregarAmbientes();
    carregarMonitor();
    autoTimer = setInterval(carregarMonitor, AUTO_MS);

    // Sempre foca o input ao clicar em qualquer lugar
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.kq-amb-btn') &&
            !e.target.closest('.kq-camera-area') &&
            !e.target.closest('.kq-btn-camera') &&
            !e.target.closest('.kq-modal-btn') &&
            !e.target.closest('#btnConfirmar') &&
            !e.target.closest('.kq-btn-exit')) {
            document.getElementById('inputScanHidden')?.focus();
        }
    });

    // Enter no input dispara scan
    document.getElementById('inputScanHidden').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') processarScan();
    });
});

// ── Relógio ───────────────────────────────────────────────────────────────────
function iniciarRelogio() {
    const el = document.getElementById('relogio');
    function tick() {
        const n = new Date();
        el.textContent = [n.getHours(), n.getMinutes(), n.getSeconds()]
            .map(v => v.toString().padStart(2, '0')).join(':');
    }
    tick(); setInterval(tick, 1000);
}

// Atualiza os tempos dos alunos ativos a cada 10s
function iniciarTempos() {
    tempoTimer = setInterval(atualizarTemposAtivos, 10_000);
}

// ── Ambientes ─────────────────────────────────────────────────────────────────
async function carregarAmbientes() {
    try {
        const r = await fetch('/api/circulacao/ambientes');
        if (!r.ok) throw new Error('Erro ao carregar ambientes');
        ambientes = (await r.json()).filter(a => a.ativo !== false);
        renderAmbientes();
    } catch (e) {
        document.getElementById('listaAmbientes').innerHTML =
            `<div class="kq-vazio">Erro ao carregar ambientes</div>`;
    }
}

function renderAmbientes() {
    const el = document.getElementById('listaAmbientes');
    if (!ambientes.length) {
        el.innerHTML = `<div class="kq-vazio">Nenhum ambiente cadastrado</div>`;
        return;
    }

    el.innerHTML = ambientes.map(a => {
        const icone = iconePorTipo(a.tipo);
        const dentro = ativos.filter(r => r.ambiente_id === a.id).length;
        const ativo = ambienteSel?.id === a.id ? 'ativo' : '';
        return `<button class="kq-amb-btn ${ativo}" onclick="selecionarAmbiente(${a.id})" id="ambBtn-${a.id}">
            <span class="kq-amb-icon">${icone}</span>
            <div class="kq-amb-info">
                <div class="kq-amb-nome">${a.nome}</div>
                <div class="kq-amb-tipo">${a.tipo || 'ambiente'}</div>
            </div>
            <span class="kq-amb-dentro" id="ambDentro-${a.id}">${dentro > 0 ? dentro : ''}</span>
        </button>`;
    }).join('');
}

function iconePorTipo(tipo) {
    const mapa = {
        banheiro:   '🚻',
        masculino:  '🚹',
        feminino:   '🚺',
        adaptado:   '♿',
        biblioteca: '📚',
        quadra:     '⚽',
        refeitorio: '🍽️',
        secretaria: '🗂️',
        sala:       '🏫',
    };
    const t = (tipo || '').toLowerCase();
    for (const [k, v] of Object.entries(mapa)) {
        if (t.includes(k)) return v;
    }
    return '🚪';
}

function selecionarAmbiente(id) {
    ambienteSel = ambientes.find(a => a.id === id) || null;
    document.querySelectorAll('.kq-amb-btn').forEach(b => b.classList.remove('ativo'));
    document.getElementById(`ambBtn-${id}`)?.classList.add('ativo');
    document.getElementById('inputScanHidden')?.focus();
}

// ── Monitor (ativos + histórico) ──────────────────────────────────────────────
async function carregarMonitor() {
    const dot = document.getElementById('refreshDot');
    dot.classList.add('loading');
    try {
        const [rAtivos, rHist] = await Promise.all([
            fetch('/api/circulacao/quiosque/ativos'),
            fetch('/api/circulacao/quiosque/historico'),
        ]);
        ativos    = rAtivos.ok    ? (await rAtivos.json())  : [];
        historico = rHist.ok ? (await rHist.json()) : [];

        renderAtivos();
        renderHistorico();
        atualizarBadgesAmbientes();

        document.getElementById('kqUltima').textContent =
            'Atualizado às ' + new Date().toLocaleTimeString('pt-BR',
                { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
        console.error('[Quiosque] Erro no monitor:', e);
    } finally {
        dot.classList.remove('loading');
    }
}

function renderAtivos() {
    const el = document.getElementById('kqAtivos');
    document.getElementById('badgeAtivos').textContent = ativos.length;

    if (!ativos.length) {
        el.innerHTML = `<div class="kq-vazio">Nenhum aluno no momento</div>`;
        return;
    }

    el.innerHTML = ativos.map(r => {
        const nome   = r.alunos?.nome  || `Aluno #${r.cod_matriz_aluno}`;
        const turma  = r.alunos?.turma || '';
        const ambNome = r.ambientes?.nome || `Amb. ${r.ambiente_id}`;
        const min    = minutosDesde(r.entrada_em);
        const inicial = iniciais2(nome || '?');
        return `<div class="kq-ativo-card" id="ativo-${r.id}">
            <div class="ka-avatar">${inicial}</div>
            <div class="ka-info">
                <div class="ka-nome">${primeiroNome(nome)}</div>
                <div class="ka-turma">${turma || ambNome}</div>
            </div>
            <div class="ka-tempo" id="tempo-${r.id}">${formatMin(min)}</div>
        </div>`;
    }).join('');
}

function atualizarTemposAtivos() {
    ativos.forEach(r => {
        const el = document.getElementById(`tempo-${r.id}`);
        if (el) el.textContent = formatMin(minutosDesde(r.entrada_em));
    });
}

function renderHistorico() {
    const el = document.getElementById('kqHistorico');
    if (!historico.length) {
        el.innerHTML = `<div class="kq-vazio">Sem registros hoje</div>`;
        return;
    }

    el.innerHTML = historico.map(r => {
        const nome    = r.alunos?.nome    || `Aluno #${r.cod_matriz_aluno}`;
        const turma   = r.alunos?.turma   || '';
        const ambNome = r.ambientes?.nome || `Amb. ${r.ambiente_id}`;
        const hora    = formatarHora(r.entrada_em);
        const temSaida = !!r.saida_em;

        const iconeAcao = temSaida ? '↩' : '→';
        const classeRow = temSaida ? 'saida' : 'entrada';
        const durLabel  = temSaida
            ? formatMin(Math.round((new Date(r.saida_em) - new Date(r.entrada_em)) / 60000))
            : '<span style="color:var(--entrada)">dentro</span>';

        return `<div class="kq-hist-row ${classeRow}">
            <span class="kh-hora">${hora}</span>
            <span class="kh-acao">${iconeAcao}</span>
            <span class="kh-nome">${primeiroNome(nome)}</span>
            <span class="kh-amb">${ambNome}</span>
            <span class="kh-dur">${durLabel}</span>
        </div>`;
    }).join('');
}

function atualizarBadgesAmbientes() {
    ambientes.forEach(a => {
        const el = document.getElementById(`ambDentro-${a.id}`);
        if (el) {
            const n = ativos.filter(r => r.ambiente_id === a.id).length;
            el.textContent = n > 0 ? n : '';
        }
    });
}

// ── Scan ──────────────────────────────────────────────────────────────────────
async function processarScan() {
    const input  = document.getElementById('inputScanHidden');
    const qr_raw = (input.value || '').trim();
    input.value  = '';
    input.focus();

    if (!ambienteSel) {
        document.getElementById('modalAviso').style.display = 'flex';
        return;
    }
    if (!qr_raw) return;

    try {
        const r = await fetch('/api/circulacao/quiosque/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qr_raw, ambiente_id: ambienteSel.id }),
        });

        const data = await r.json();

        if (!r.ok) {
            mostrarFeedback('erro', '❌', 'ERRO', data.erro || 'Falha no registro', '');
            return;
        }

        const nome    = data.aluno?.nome  || `Aluno não identificado`;
        const turma   = data.aluno?.turma || '';
        const ambNome = data.ambiente?.nome || ambienteSel.nome;
        const subTurma = turma ? `${turma} · ` : '';

        if (data.acao === 'entrada') {
            const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            mostrarFeedback('entrada', '✅', 'ENTROU', primeiroNome(nome), `${subTurma}${ambNome} · ${hora}`);
        } else {
            const dur = data.duracao_min !== undefined ? formatMin(data.duracao_min) : '';
            mostrarFeedback('saida', '🔙', 'SAIU', primeiroNome(nome), `${subTurma}${ambNome} · ${dur}`);
        }

        await carregarMonitor();

    } catch (e) {
        mostrarFeedback('erro', '❌', 'ERRO', 'Falha na conexão', e.message);
    }
}

function mostrarFeedback(tipo, icone, acao, nome, sub) {
    const el = document.getElementById('kqFeedback');
    el.style.display = 'flex';
    el.className     = `kq-feedback ${tipo}`;
    document.getElementById('fbIcon').textContent = icone;
    document.getElementById('fbAcao').textContent = acao;
    document.getElementById('fbNome').textContent = nome;
    document.getElementById('fbSub').textContent  = sub;

    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Câmera QR ─────────────────────────────────────────────────────────────────
async function toggleCamera() {
    if (cameraAberta) {
        fecharCamera(); return;
    }
    const area = document.getElementById('cameraArea');
    const btn  = document.getElementById('btnCamera');
    const video = document.getElementById('kqVideo');

    try {
        scanStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
        });
        video.srcObject = scanStream;
        await video.play();
        area.style.display = 'block';
        btn.textContent    = '✕ Fechar câmera';
        btn.classList.add('ativa');
        cameraAberta = true;
        loopCamScan();
    } catch (err) {
        alert('Câmera indisponível: ' + err.message);
    }
}

function fecharCamera() {
    if (scanAnimFrame) { cancelAnimationFrame(scanAnimFrame); scanAnimFrame = null; }
    if (scanStream)    { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    cameraAberta = false;
    document.getElementById('cameraArea').style.display = 'none';
    const btn = document.getElementById('btnCamera');
    btn.textContent = '📷 Câmera QR';
    btn.classList.remove('ativa');
}

function loopCamScan() {
    const video  = document.getElementById('kqVideo');
    const canvas = document.getElementById('kqCanvas');
    if (!video || video.readyState < video.HAVE_ENOUGH_DATA) {
        scanAnimFrame = requestAnimationFrame(loopCamScan);
        return;
    }
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });

    if (code?.data) {
        fecharCamera();
        document.getElementById('inputScanHidden').value = code.data;
        processarScan();
        return;
    }
    scanAnimFrame = requestAnimationFrame(loopCamScan);
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function primeiroNome(nome) {
    if (!nome) return '—';
    const partes = nome.trim().split(' ');
    return partes.length >= 2
        ? `${partes[0]} ${partes[partes.length - 1]}`
        : partes[0];
}

function minutosDesde(iso) {
    if (!iso) return 0;
    return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function formatMin(min) {
    if (min < 1)  return '< 1 min';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatarHora(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('pt-BR',
        { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function iniciais2(nome) {
    const p = String(nome).trim().split(/\s+/);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
