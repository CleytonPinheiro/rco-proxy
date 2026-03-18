// ── Estado global ─────────────────────────────────────────────────────────────
let emprestimos      = [];
let materiais        = [];
let alunos           = [];
let fluxoAtual       = null;   // 'emprestar' | 'devolver'
let alunoFluxo       = null;
let materialFluxo    = null;
let scanStream       = null;
let scanAnimFrame    = null;
let autoRefreshTimer = null;

const AUTO_REFRESH_MS = 30_000;

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    iniciarRelogio();
    carregarDados();
    autoRefreshTimer = setInterval(carregarDados, AUTO_REFRESH_MS);
});

// ── Relógio ───────────────────────────────────────────────────────────────────
function iniciarRelogio() {
    const el = document.getElementById('relogio');
    function tick() {
        const n = new Date();
        el.textContent = n.getHours().toString().padStart(2,'0') + ':' +
                         n.getMinutes().toString().padStart(2,'0') + ':' +
                         n.getSeconds().toString().padStart(2,'0');
    }
    tick();
    setInterval(tick, 1000);
}

// ── Carregar dados ────────────────────────────────────────────────────────────
async function carregarDados() {
    const dot = document.getElementById('autoRefreshDot');
    dot.classList.add('loading');

    try {
        const [empR, matR, aluR] = await Promise.all([
            fetch('/api/emprestimos'),
            fetch('/api/materiais'),
            fetch('/api/alunos'),
        ]);
        emprestimos = await empR.json();
        materiais   = await matR.json();
        alunos      = await aluR.json();

        atualizarStats();
        renderMonitor();
        document.getElementById('ultimaAtualizacao').textContent =
            'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
        console.error('Erro ao carregar dados:', e);
    } finally {
        dot.classList.remove('loading');
    }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function diasAtraso(e) {
    if (!e.data_emprestimo) return 0;
    const d   = new Date(e.data_emprestimo);
    const emp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const hj  = new Date(); const hoje = new Date(hj.getFullYear(), hj.getMonth(), hj.getDate());
    return Math.floor((hoje - emp) / 86_400_000);
}

function atualizarStats() {
    const ativos  = emprestimos.filter(e => e.status === 'ativo');
    const atraso  = ativos.filter(e => diasAtraso(e) > 0);
    const disp    = materiais.filter(m => m.status === 'disponivel');

    document.getElementById('statAtivos').textContent = ativos.length;
    document.getElementById('statAtraso').textContent = atraso.length;
    document.getElementById('statDisp').textContent   = disp.length;
    document.getElementById('statTotal').textContent  = materiais.length;
}

// ── Monitor (painel de ativos) ─────────────────────────────────────────────────
function renderMonitor() {
    const lista  = document.getElementById('listaAtivos');
    const ativos = emprestimos.filter(e => e.status === 'ativo')
                              .sort((a, b) => diasAtraso(b) - diasAtraso(a));

    if (!ativos.length) {
        lista.innerHTML = `<div class="monitor-vazio">
            <span class="monitor-vazio-icon">✅</span>
            Nenhum empréstimo ativo no momento
        </div>`;
        return;
    }

    lista.innerHTML = ativos.map(e => {
        const dias    = diasAtraso(e);
        const critico = dias >= 3;
        const atraso  = dias > 0;
        const cls     = critico ? 'critico' : atraso ? 'atraso' : 'hoje';

        const badge = critico
            ? `<span class="badge-kiosk badge-danger">🚨 ${dias}d</span>`
            : atraso
            ? `<span class="badge-kiosk badge-warn">⚠️ ${dias === 1 ? 'Ontem' : dias+'d'}</span>`
            : `<span class="badge-kiosk badge-ok">Hoje</span>`;

        const hora = formatarHora(e.data_emprestimo);
        const nome  = e.aluno?.nome || '—';
        const mat   = `${e.material?.codigo || ''} — ${e.material?.descricao || ''}`;

        return `<div class="monitor-card ${cls}">
            <div>
                <div class="mc-aluno" title="${nome}">${truncar(nome, 26)}</div>
                <div class="mc-mat">${truncar(mat, 34)}</div>
            </div>
            ${badge}
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                <span class="mc-hora">${hora}</span>
                <button class="btn-dev-mini" onclick="devRapidoMonitor(${e.id})">Devolver</button>
            </div>
        </div>`;
    }).join('');
}

function truncar(str, max) {
    return str.length > max ? str.substring(0, max - 1) + '…' : str;
}

function formatarHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const dd = n => n.toString().padStart(2,'0');
    return `${dd(d.getDate())}/${dd(d.getMonth()+1)} ${dd(d.getHours())}:${dd(d.getMinutes())}`;
}

// Devolução direta do monitor (sem QR)
async function devRapidoMonitor(id) {
    const e = emprestimos.find(x => x.id === id);
    const nome = e?.aluno?.nome?.split(' ')[0] || 'aluno';
    const mat  = e?.material?.codigo || '';
    if (!confirm(`Confirmar devolução de ${mat} — ${nome}?`)) return;
    await executarDevolucao(id, 'otimo', 'Devolução via quiosque');
}

// ── FLUXO PRINCIPAL ───────────────────────────────────────────────────────────
async function iniciarFluxo(tipo) {
    fluxoAtual    = tipo;
    alunoFluxo    = null;
    materialFluxo = null;

    document.getElementById('scanTitulo').textContent = '📷 Escanear crachá do aluno';
    document.getElementById('scanInstrucao').textContent = 'Aponte para o QR Code do crachá';
    mostrarModal('modalScan');
    await iniciarCamera();
}

function cancelarFluxo() {
    pararCamera();
    esconderTodosModais();
    fluxoAtual = alunoFluxo = materialFluxo = null;
}

// ── Câmera / QR ───────────────────────────────────────────────────────────────
async function iniciarCamera() {
    const video = document.getElementById('qrVideo');
    try {
        scanStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
        });
        video.srcObject = scanStream;
        await video.play();
        loopScan();
    } catch (err) {
        alert('Câmera indisponível: ' + err.message);
        cancelarFluxo();
    }
}

function pararCamera() {
    if (scanAnimFrame) { cancelAnimationFrame(scanAnimFrame); scanAnimFrame = null; }
    if (scanStream)    { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}

function loopScan() {
    const video  = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrCanvas');
    if (!video || video.readyState < video.HAVE_ENOUGH_DATA) {
        scanAnimFrame = requestAnimationFrame(loopScan);
        return;
    }
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });

    if (code?.data) {
        pararCamera();
        onQRLido(code.data);
        return;
    }
    scanAnimFrame = requestAnimationFrame(loopScan);
}

async function onQRLido(registro) {
    // Buscar aluno pelo valor do QR
    let aluno = null;
    try {
        const r = await fetch(`/api/alunos/${encodeURIComponent(registro)}`);
        if (r.ok) aluno = await r.json();
    } catch { /* tenta fallback */ }

    if (!aluno) {
        // Tenta buscar por codMatrizAluno ou nome parcial na lista já carregada
        aluno = alunos.find(a => String(a.registro) === String(registro) ||
                                  String(a.codMatrizAluno) === String(registro));
    }

    if (!aluno) {
        mostrarFeedback('❌', 'Aluno não encontrado', `Código lido: ${registro}`, 2500);
        setTimeout(() => { mostrarModal('modalScan'); iniciarCamera(); }, 2800);
        return;
    }

    alunoFluxo = aluno;
    esconderTodosModais();

    if (fluxoAtual === 'emprestar') abrirModalEmprestar();
    else                             abrirModalDevolver();
}

// ── Modal Emprestar ───────────────────────────────────────────────────────────
function abrirModalEmprestar() {
    // Info do aluno
    document.getElementById('infoAlunoEmp').innerHTML = `
        <div class="info-aluno-avatar">👤</div>
        <div>
            <div class="info-aluno-nome">${alunoFluxo.nome}</div>
            <div class="info-aluno-turma">Turma ${alunoFluxo.turma || '—'} · Nº ${alunoFluxo.numChamada || '?'}</div>
        </div>`;

    // Reset período
    document.querySelectorAll('.periodo-btn').forEach(b => b.classList.remove('ativo'));
    materialFluxo = null;

    // Materiais disponíveis
    const disp = materiais.filter(m => m.status === 'disponivel');
    const grid  = document.getElementById('listaMateriaisDisp');
    if (!disp.length) {
        grid.innerHTML = '<div class="mat-vazio">Nenhum material disponível no momento</div>';
    } else {
        grid.innerHTML = disp.map(m => `
            <button class="mat-btn" data-codigo="${m.codigo}" onclick="selecionarMaterial(this, '${m.codigo}')">
                <div class="mat-btn-cod">${m.codigo}</div>
                <div class="mat-btn-desc">${m.descricao || ''}</div>
            </button>`).join('');
    }

    document.getElementById('btnConfirmarEmp').disabled = true;
    mostrarModal('modalEmprestar');
}

function selecionarMaterial(btn, codigo) {
    document.querySelectorAll('.mat-btn').forEach(b => b.classList.remove('selecionado'));
    btn.classList.add('selecionado');
    materialFluxo = materiais.find(m => m.codigo === codigo) || null;
    validarFormEmprestar();
}

function toggleAula(btn) {
    btn.classList.toggle('ativo');
    validarFormEmprestar();
}

function validarFormEmprestar() {
    const aulasOk = document.querySelectorAll('.periodo-btn.ativo').length > 0;
    document.getElementById('btnConfirmarEmp').disabled = !(materialFluxo && aulasOk);
}

async function confirmarEmprestimo() {
    const aulas = [...document.querySelectorAll('.periodo-btn.ativo')].map(b => parseInt(b.dataset.aula));

    document.getElementById('btnConfirmarEmp').disabled = true;
    document.getElementById('btnConfirmarEmp').textContent = 'Registrando...';

    try {
        const r = await fetch('/api/emprestimos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_registro:  alunoFluxo.registro,
                material_codigo: materialFluxo.codigo,
                professor:       'Quiosque',
                aulas,
                observacoes:     '',
            })
        });

        if (!r.ok) { const err = await r.json(); throw new Error(err.erro || 'Erro'); }

        esconderTodosModais();
        mostrarFeedback('✅', 'Empréstimo registrado!',
            `${materialFluxo.codigo} emprestado para ${alunoFluxo.nome.split(' ')[0]}`, 2500);
        await carregarDados();
    } catch (err) {
        document.getElementById('btnConfirmarEmp').disabled = false;
        document.getElementById('btnConfirmarEmp').textContent = '✅ Confirmar Empréstimo';
        alert('Erro: ' + err.message);
    }
}

// ── Modal Devolver ─────────────────────────────────────────────────────────────
function abrirModalDevolver() {
    document.getElementById('infoAlunoDev').innerHTML = `
        <div class="info-aluno-avatar">👤</div>
        <div>
            <div class="info-aluno-nome">${alunoFluxo.nome}</div>
            <div class="info-aluno-turma">Turma ${alunoFluxo.turma || '—'} · Nº ${alunoFluxo.numChamada || '?'}</div>
        </div>`;

    const ativos = emprestimos.filter(e =>
        e.status === 'ativo' &&
        (e.aluno?.registro === alunoFluxo.registro ||
         String(e.aluno?.codMatrizAluno) === String(alunoFluxo.codMatrizAluno))
    );

    const div = document.getElementById('listaEmpAlunoDiv');
    if (!ativos.length) {
        div.innerHTML = '<div class="dev-vazio">✅ Este aluno não tem empréstimos ativos</div>';
    } else {
        div.innerHTML = ativos.map(e => `
            <div class="dev-card" id="dcard-${e.id}">
                <div class="dev-card-info">
                    <div class="dev-card-cod">${e.material?.codigo || ''}</div>
                    <div class="dev-card-desc">${e.material?.descricao || ''}</div>
                    <div class="dev-card-hora">Emprestado em ${formatarHora(e.data_emprestimo)}</div>
                </div>
                <button class="btn-dev-ok" onclick="devolverItem(${e.id})">Devolver</button>
            </div>`).join('');
    }

    mostrarModal('modalDevolver');
}

async function devolverItem(id) {
    const btn = document.querySelector(`#dcard-${id} .btn-dev-ok`);
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    await executarDevolucao(id, 'otimo', 'Devolução via quiosque');

    const card = document.getElementById(`dcard-${id}`);
    if (card) {
        card.style.opacity = '0.4';
        card.innerHTML = '<div style="padding:12px;color:#34d399;font-weight:600;width:100%">✅ Devolvido</div>';
    }

    await carregarDados();

    // Se não houver mais ativos deste aluno, fecha após 1.5s
    const restam = emprestimos.filter(e =>
        e.status === 'ativo' &&
        e.aluno?.registro === alunoFluxo?.registro
    );
    if (!restam.length) {
        setTimeout(() => {
            esconderTodosModais();
            mostrarFeedback('✅', 'Devolução concluída!', `Todos os materiais devolvidos`, 2200);
        }, 1000);
    }
}

async function executarDevolucao(id, estado, obs) {
    await fetch(`/api/emprestimos/${id}/devolver`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_devolucao: estado, observacoes_devolucao: obs })
    });
    await carregarDados();
}

// ── Feedback modal (auto-fecha) ───────────────────────────────────────────────
function mostrarFeedback(icone, msg, sub, duracaoMs) {
    document.getElementById('feedbackIcone').textContent = icone;
    document.getElementById('feedbackMsg').textContent   = msg;
    document.getElementById('feedbackSub').textContent   = sub;
    mostrarModal('modalFeedback');
    setTimeout(esconderTodosModais, duracaoMs);
}

// ── Helpers de modal ──────────────────────────────────────────────────────────
function mostrarModal(id) {
    document.querySelectorAll('.kiosk-modal').forEach(m => m.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
}

function esconderTodosModais() {
    document.querySelectorAll('.kiosk-modal').forEach(m => m.style.display = 'none');
    fluxoAtual = null;
    alunoFluxo = null;
    materialFluxo = null;
}

// ── Tela cheia ────────────────────────────────────────────────────────────────
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}
