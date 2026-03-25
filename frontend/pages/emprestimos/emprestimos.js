let emprestimos = [];
let alunos = [];
let materiais = [];
let alunoSelecionado = null;
let materialSelecionado = null;

// ── QR Scanner state ──────────────────────────────────────────────────────────
let scannerStream    = null;
let scannerTarget    = null; // 'aluno' | 'material'
let scannerAnimFrame = null;
let dqrStream        = null;
let dqrAnimFrame     = null;

document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
});

async function carregarDados() {
    try {
        const [empResp, alunosResp, matResp] = await Promise.all([
            fetch('/api/emprestimos'),
            fetch('/api/alunos'),
            fetch('/api/materiais')
        ]);

        if (!empResp.ok || !alunosResp.ok || !matResp.ok) throw new Error('Erro ao carregar dados');

        emprestimos = await empResp.json();
        alunos      = await alunosResp.json();
        materiais   = await matResp.json();

        renderizarEmprestimosAtivos();
        renderizarHistorico();
    } catch (erro) {
        console.error('Erro:', erro);
        document.getElementById('listaEmprestimosAtivos').innerHTML =
            '<div class="empty-message">Erro ao carregar dados. Execute o SQL no Supabase.</div>';
    }
}

function trocarTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

    if (tab === 'ativos') {
        document.querySelector('.tab:nth-child(1)').classList.add('active');
        document.getElementById('tabAtivos').style.display = 'block';
    } else {
        document.querySelector('.tab:nth-child(2)').classList.add('active');
        document.getElementById('tabHistorico').style.display = 'block';
    }
}

function formatarData(dataISO) {
    if (!dataISO) return '';
    const d = new Date(dataISO);
    return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

// Calcula dias de atraso (0 = hoje, 1 = ontem, etc.)
function diasAtraso(emprestimo) {
    if (!emprestimo.data_emprestimo) return 0;
    const empData  = new Date(emprestimo.data_emprestimo);
    const hoje     = new Date();
    const empDia   = new Date(empData.getFullYear(), empData.getMonth(), empData.getDate());
    const hojeDia  = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.floor((hojeDia - empDia) / 86400000);
}

function estaAtrasado(emprestimo) {
    return emprestimo.status === 'ativo' && diasAtraso(emprestimo) > 0;
}

function renderizarEmprestimosAtivos() {
    const container = document.getElementById('listaEmprestimosAtivos');
    const ativos    = emprestimos.filter(e => e.status === 'ativo');

    if (!ativos.length) {
        container.innerHTML = '<div class="empty-message">Nenhum empréstimo ativo no momento</div>';
        renderBannerAtraso([]);
        return;
    }

    // Ordena: atrasados (mais antigos) primeiro, depois os de hoje
    ativos.sort((a, b) => diasAtraso(b) - diasAtraso(a));
    const atrasados = ativos.filter(estaAtrasado);

    renderBannerAtraso(atrasados);

    container.innerHTML = ativos.map(e => {
        const dias      = diasAtraso(e);
        const atrasado  = dias > 0;
        const critico   = dias >= 3;
        const cardClass = atrasado ? (critico ? 'emprestimo-card atrasado critico' : 'emprestimo-card atrasado') : 'emprestimo-card ativo';

        const badgeAtraso = atrasado
            ? `<span class="badge-atraso ${critico ? 'critico' : ''}" title="Em atraso há ${dias} dia(s)">
                   ${critico ? '🚨' : '⚠️'} ${dias === 1 ? 'Ontem' : `${dias} dias`}
               </span>`
            : '';

        return `
        <div class="${cardClass}">
            <div class="emprestimo-aluno">
                <div class="aluno-nome-linha">
                    <h4>${e.aluno?.nome || 'Aluno'}</h4>
                    ${badgeAtraso}
                </div>
                <p><strong>Registro:</strong> ${e.aluno?.registro || ''}</p>
                <p><strong>Turma:</strong> ${e.aluno?.turma || ''}</p>
            </div>
            <div class="emprestimo-material">
                <h4>${e.material?.codigo || ''} — ${e.material?.descricao || ''}</h4>
                <p><strong>Professor:</strong> ${e.professor || 'Não informado'}</p>
                <div class="emprestimo-aulas">
                    ${[1,2,3,4,5,6].map(a => `
                        <span class="aula-badge ${(e.aulas||[]).includes(a) ? 'ativa' : 'inativa'}">${a}</span>
                    `).join('')}
                </div>
            </div>
            <div class="emprestimo-acoes">
                <button class="btn-devolver ${atrasado ? 'btn-devolver-urgente' : ''}"
                        onclick="abrirModalDevolucao(${e.id})">Devolver</button>
                <span class="emprestimo-hora">${formatarData(e.data_emprestimo)}</span>
            </div>
        </div>`;
    }).join('');
}

function renderBannerAtraso(atrasados) {
    const existing = document.getElementById('bannerAtraso');
    if (existing) existing.remove();

    if (!atrasados.length) return;

    const criticos = atrasados.filter(e => diasAtraso(e) >= 3);
    const cor      = criticos.length ? '#dc2626' : '#d97706';
    const icone    = criticos.length ? '🚨' : '⚠️';
    const msg      = atrasados.length === 1
        ? `1 empréstimo não devolvido de dia(s) anterior(es)`
        : `${atrasados.length} empréstimos não devolvidos de dias anteriores`;

    const nomes = atrasados.slice(0, 4).map(e => {
        const nome = (e.aluno?.nome || '').split(' ')[0];
        const dias = diasAtraso(e);
        return `<strong>${nome}</strong> (${dias}d)`;
    }).join(', ') + (atrasados.length > 4 ? ` e mais ${atrasados.length - 4}` : '');

    const banner = document.createElement('div');
    banner.id = 'bannerAtraso';
    banner.className = 'banner-atraso';
    banner.style.borderColor = cor;
    banner.innerHTML = `
        <div class="banner-atraso-icone">${icone}</div>
        <div class="banner-atraso-texto">
            <strong>${msg}</strong>
            <span>${nomes}</span>
        </div>
        <button class="banner-atraso-fechar" onclick="this.parentElement.remove()" title="Fechar aviso">✕</button>`;

    const tabAtivos = document.getElementById('tabAtivos');
    tabAtivos.insertBefore(banner, tabAtivos.firstChild);
}

function renderizarHistorico() {
    const container = document.getElementById('listaHistorico');
    const historico = emprestimos.filter(e => e.status === 'devolvido').reverse();

    if (!historico.length) {
        container.innerHTML = '<div class="empty-message">Nenhum empréstimo no histórico</div>';
        return;
    }

    container.innerHTML = historico.map(e => `
        <div class="emprestimo-card devolvido">
            <div class="emprestimo-aluno">
                <h4>${e.aluno?.nome || 'Aluno'}</h4>
                <p><strong>Registro:</strong> ${e.aluno?.registro || ''}</p>
                <p><strong>Turma:</strong> ${e.aluno?.turma || ''}</p>
            </div>
            <div class="emprestimo-material">
                <h4>${e.material?.codigo || ''} — ${e.material?.descricao || ''}</h4>
                <p><strong>Professor:</strong> ${e.professor || 'Não informado'}</p>
            </div>
            <div class="emprestimo-acoes">
                <span class="emprestimo-hora">
                    <strong>Empréstimo:</strong> ${formatarData(e.data_emprestimo)}<br>
                    <strong>Devolução:</strong> ${formatarData(e.data_devolucao)}
                </span>
            </div>
        </div>`).join('');
}

// ── Modal: Novo Empréstimo ─────────────────────────────────────────────────────
function abrirModalEmprestimo() {
    document.getElementById('formEmprestimo').reset();
    ['alunoInfo','materialInfo'].forEach(id => {
        const el = document.getElementById(id);
        el.className = 'info-preview';
        el.innerHTML = '';
    });
    alunoSelecionado    = null;
    materialSelecionado = null;
    document.getElementById('modalEmprestimo').style.display = 'flex';
}
function fecharModalEmprestimo() {
    document.getElementById('modalEmprestimo').style.display = 'none';
}

async function buscarAluno() {
    const registro = document.getElementById('alunoRegistro').value.trim();
    const infoDiv  = document.getElementById('alunoInfo');

    if (!registro) {
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Digite o registro do aluno';
        return;
    }

    try {
        const r = await fetch(`/api/alunos/${registro}`);
        if (r.ok) {
            const aluno = await r.json();
            alunoSelecionado = aluno;
            infoDiv.className = 'info-preview show sucesso';
            infoDiv.innerHTML = `<strong>${aluno.nome}</strong><br>Turma: ${aluno.turma}`;
        } else {
            alunoSelecionado = null;
            infoDiv.className = 'info-preview show erro';
            infoDiv.innerHTML = 'Aluno não encontrado';
        }
    } catch {
        alunoSelecionado = null;
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Erro ao buscar aluno';
    }
}

async function buscarMaterial() {
    const codigo  = document.getElementById('materialCodigo').value.trim().toUpperCase();
    const infoDiv = document.getElementById('materialInfo');

    if (!codigo) {
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Digite o código do material';
        return;
    }

    try {
        const r = await fetch(`/api/materiais/${codigo}`);
        if (r.ok) {
            const material = await r.json();
            if (material.status !== 'disponivel') {
                materialSelecionado = null;
                infoDiv.className = 'info-preview show erro';
                infoDiv.innerHTML = `${material.descricao}<br><strong>Indisponível</strong>`;
                return;
            }
            materialSelecionado = material;
            infoDiv.className = 'info-preview show sucesso';
            infoDiv.innerHTML = `<strong>${material.descricao}</strong><br>Código: ${material.codigo}`;
        } else {
            materialSelecionado = null;
            infoDiv.className = 'info-preview show erro';
            infoDiv.innerHTML = 'Material não encontrado';
        }
    } catch {
        materialSelecionado = null;
        infoDiv.className = 'info-preview show erro';
        infoDiv.innerHTML = 'Erro ao buscar material';
    }
}

function selecionarTodasAulas() { for (let i = 1; i <= 6; i++) document.getElementById(`aula${i}`).checked = true; }
function limparAulas()          { for (let i = 1; i <= 6; i++) document.getElementById(`aula${i}`).checked = false; }

async function registrarEmprestimo(e) {
    e.preventDefault();

    if (!alunoSelecionado) { await buscarAluno(); }
    if (!alunoSelecionado) { alert('Busque e selecione um aluno válido'); return; }
    if (!materialSelecionado) { await buscarMaterial(); }
    if (!materialSelecionado) { alert('Busque e selecione um material disponível'); return; }

    const aulas = [];
    for (let i = 1; i <= 6; i++) {
        if (document.getElementById(`aula${i}`).checked) aulas.push(i);
    }
    if (!aulas.length) { alert('Selecione pelo menos uma aula'); return; }

    try {
        const r = await fetch('/api/emprestimos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_registro:  alunoSelecionado.registro,
                material_codigo: materialSelecionado.codigo,
                professor:       document.getElementById('professorResponsavel').value,
                aulas,
                observacoes:     document.getElementById('observacoes').value
            })
        });

        if (!r.ok) { const err = await r.json(); throw new Error(err.erro || 'Erro ao registrar'); }

        fecharModalEmprestimo();
        await carregarDados();
        alert(`Empréstimo registrado!\n\n${alunoSelecionado.nome}\n${materialSelecionado.codigo}`);
    } catch (err) { alert('Erro: ' + err.message); }
}

// ── Modal: Devolução manual ────────────────────────────────────────────────────
function abrirModalDevolucao(id) {
    const e = emprestimos.find(x => x.id === id);
    if (!e) return;
    document.getElementById('emprestimoIdDevolucao').value = id;
    document.getElementById('infoDevolucao').innerHTML = `
        <div class="devolucao-info">
            <p><strong>Aluno:</strong> ${e.aluno?.nome || ''}</p>
            <p><strong>Material:</strong> ${e.material?.codigo || ''} — ${e.material?.descricao || ''}</p>
            <p><strong>Emprestado em:</strong> ${formatarData(e.data_emprestimo)}</p>
        </div>`;
    document.getElementById('estadoDevolucao').value = 'otimo';
    document.getElementById('obsDevolucao').value    = '';
    document.getElementById('modalDevolucao').style.display = 'flex';
}
function fecharModalDevolucao() {
    document.getElementById('modalDevolucao').style.display = 'none';
}

async function confirmarDevolucao(e) {
    e.preventDefault();
    const id = document.getElementById('emprestimoIdDevolucao').value;
    try {
        const r = await fetch(`/api/emprestimos/${id}/devolver`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estado_devolucao:     document.getElementById('estadoDevolucao').value,
                observacoes_devolucao: document.getElementById('obsDevolucao').value
            })
        });
        if (!r.ok) { const err = await r.json(); throw new Error(err.erro || 'Erro'); }
        fecharModalDevolucao();
        await carregarDados();
        alert('Devolução registrada com sucesso!');
    } catch (err) { alert('Erro: ' + err.message); }
}

// ── QR Scanner (câmera) ───────────────────────────────────────────────────────
async function iniciarCamera(videoEl, onDecode) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
        });
        videoEl.srcObject = stream;
        await videoEl.play();
        return stream;
    } catch (err) {
        alert('Não foi possível acessar a câmera: ' + err.message);
        return null;
    }
}

function pararStream(stream, animFrame) {
    if (animFrame) cancelAnimationFrame(animFrame);
    if (stream) stream.getTracks().forEach(t => t.stop());
}

function scanFrameLoop(videoEl, canvasEl, onDecode, getAnimRef, setAnimRef) {
    if (videoEl.readyState !== videoEl.HAVE_ENOUGH_DATA) {
        setAnimRef(requestAnimationFrame(() => scanFrameLoop(videoEl, canvasEl, onDecode, getAnimRef, setAnimRef)));
        return;
    }
    const ctx = canvasEl.getContext('2d');
    canvasEl.width  = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    const imgData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
    if (code && code.data) {
        onDecode(code.data);
        return;
    }
    setAnimRef(requestAnimationFrame(() => scanFrameLoop(videoEl, canvasEl, onDecode, getAnimRef, setAnimRef)));
}

// ── Scanner modal (para Novo Empréstimo) ──────────────────────────────────────
async function abrirScanner(target) {
    scannerTarget = target;
    const titulo = target === 'aluno' ? '📷 Escanear QR do Aluno' : '📷 Escanear QR do Material';
    document.getElementById('qrModalTitle').textContent = titulo;
    document.getElementById('qrStatus').textContent = target === 'aluno'
        ? 'Aponte para o QR Code do crachá do aluno'
        : 'Aponte para o QR Code do material';
    document.getElementById('qrResultado').style.display = 'none';
    document.getElementById('modalQR').style.display = 'flex';

    const video  = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrCanvas');

    scannerStream = await iniciarCamera(video, () => {});
    if (!scannerStream) { fecharScanner(); return; }

    const onDecode = (data) => {
        pararStream(scannerStream, scannerAnimFrame);
        scannerStream = null;
        onQRDetectado(data, target);
    };

    const loop = () => scanFrameLoop(
        video, canvas, onDecode,
        () => scannerAnimFrame,
        (id) => { scannerAnimFrame = id; }
    );
    scannerAnimFrame = requestAnimationFrame(loop);
}

function fecharScanner() {
    pararStream(scannerStream, scannerAnimFrame);
    scannerStream    = null;
    scannerAnimFrame = null;
    document.getElementById('modalQR').style.display = 'none';
}

async function onQRDetectado(data, target) {
    const res = document.getElementById('qrResultado');
    res.style.display = 'block';
    res.textContent   = '✅ QR detectado: ' + data;
    document.getElementById('qrStatus').textContent = 'QR lido com sucesso!';

    // Aguarda 800ms para o usuário ver o feedback e fecha
    setTimeout(async () => {
        document.getElementById('modalQR').style.display = 'none';

        if (target === 'aluno') {
            document.getElementById('alunoRegistro').value = data;
            await buscarAluno();
        } else {
            document.getElementById('materialCodigo').value = data.toUpperCase();
            await buscarMaterial();
        }
    }, 800);
}

// ── Devolução Rápida por QR ───────────────────────────────────────────────────
async function abrirDevolucaoQR() {
    document.getElementById('dqrResultados').style.display = 'none';
    document.getElementById('dqrScanArea').style.display   = 'block';
    document.getElementById('dqrStatus').textContent = 'Aponte para o QR Code do crachá do aluno';
    document.getElementById('modalDevolucaoQR').style.display = 'flex';

    const video  = document.getElementById('dqrVideo');
    const canvas = document.getElementById('dqrCanvas');

    dqrStream = await iniciarCamera(video, () => {});
    if (!dqrStream) { fecharDevolucaoQR(); return; }

    const onDecode = async (data) => {
        pararStream(dqrStream, dqrAnimFrame);
        dqrStream    = null;
        dqrAnimFrame = null;
        document.getElementById('dqrStatus').textContent = '✅ QR lido — buscando empréstimos...';
        await mostrarEmprestimosAluno(data);
    };

    const loop = () => scanFrameLoop(
        video, canvas, onDecode,
        () => dqrAnimFrame,
        (id) => { dqrAnimFrame = id; }
    );
    dqrAnimFrame = requestAnimationFrame(loop);
}

async function mostrarEmprestimosAluno(registro) {
    // Tenta buscar aluno pelo registro lido no QR
    let aluno = null;
    try {
        const r = await fetch(`/api/alunos/${encodeURIComponent(registro)}`);
        if (r.ok) aluno = await r.json();
    } catch { /* ignora */ }

    // Filtra empréstimos ativos pelo registro
    const ativos = emprestimos.filter(e =>
        e.status === 'ativo' &&
        (e.aluno?.registro === registro || (aluno && e.aluno?.registro === aluno.registro))
    );

    document.getElementById('dqrScanArea').style.display   = 'none';
    document.getElementById('dqrResultados').style.display = 'block';

    const nomeAluno = aluno?.nome || registro;
    document.getElementById('dqrAlunoInfo').innerHTML =
        `👤 <span>${nomeAluno}</span>` + (aluno?.turma ? ` &nbsp;·&nbsp; Turma ${aluno.turma}` : '');

    const lista = document.getElementById('dqrLista');
    if (!ativos.length) {
        lista.innerHTML = '<div class="empty-message" style="background:#f0fdf4;border-radius:10px;padding:18px;text-align:center;">✅ Nenhum empréstimo ativo para este aluno</div>';
        return;
    }

    lista.innerHTML = ativos.map(e => `
        <div class="dqr-emprestimo-card" id="dqr-card-${e.id}">
            <div class="dqr-material">
                <strong>${e.material?.codigo || ''} — ${e.material?.descricao || 'Material'}</strong>
                <span>Emprestado em ${formatarData(e.data_emprestimo)}</span>
            </div>
            <button class="btn-devolver-qr" onclick="devolucaoRapida(${e.id})">Devolver</button>
        </div>`).join('');
}

async function devolucaoRapida(id) {
    if (!confirm('Confirmar devolução em estado "Ótimo"?')) return;
    try {
        const r = await fetch(`/api/emprestimos/${id}/devolver`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado_devolucao: 'otimo', observacoes_devolucao: 'Devolução via QR' })
        });
        if (!r.ok) throw new Error('Erro ao devolver');
        // Remove o card da lista
        const card = document.getElementById(`dqr-card-${id}`);
        if (card) { card.style.opacity = '0.3'; card.innerHTML = '<div style="padding:10px;color:#16a34a;font-weight:600;">✅ Devolvido com sucesso</div>'; }
        await carregarDados();
    } catch (err) { alert('Erro: ' + err.message); }
}

function reiniciarDevolucaoQR() {
    fecharDevolucaoQR();
    setTimeout(abrirDevolucaoQR, 100);
}

function fecharDevolucaoQR() {
    pararStream(dqrStream, dqrAnimFrame);
    dqrStream    = null;
    dqrAnimFrame = null;
    document.getElementById('modalDevolucaoQR').style.display = 'none';
}
