'use strict';

/* ══════════════════════════════════════════════════════
   EduSync — Gerador de QR Code (API-based)
   ══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

let _debounceTimer = null;
let _ultimoTexto   = '';
let _ultimoDataUrl = '';   /* última imagem recebida do servidor */

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    atualizarIconeTema();

    /* URL via query string: /qrcode/?url=https://... */
    const params   = new URLSearchParams(location.search);
    const urlParam = params.get('url') || params.get('link') || '';
    if (urlParam) {
        $('qrInput').value = urlParam;
        $('qrBtnLimpar').style.display = '';
        onInputChange();
    }

    $('qrInput').focus();
});

/* ── Tema ── */
const TEMA_KEY_ALUNO = 'aluno_tema';
const TEMA_KEY_APP   = 'edusync_theme';

function temaAtual() {
    return document.documentElement.getAttribute('data-theme') || 'light';
}

function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem(TEMA_KEY_ALUNO, tema);
    localStorage.setItem(TEMA_KEY_APP, tema);
    atualizarIconeTema(tema);
}

function atualizarIconeTema(tema = temaAtual()) {
    const btn = $('qrTemaBtn');
    if (btn) btn.textContent = tema === 'dark' ? '☀️' : '🌙';
}

window.alternarTema = function () {
    aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark');
};

/* ── Input ── */
window.onInputChange = function () {
    const val = $('qrInput').value.trim();
    $('qrBtnLimpar').style.display = val ? '' : 'none';
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => gerarQR(), 400);
};

window.limpar = function () {
    $('qrInput').value = '';
    $('qrBtnLimpar').style.display = 'none';
    $('qrVazio').style.display     = '';
    $('qrResultado').style.display = 'none';
    $('qrActions').style.display   = 'none';
    _ultimoTexto   = '';
    _ultimoDataUrl = '';
    $('qrInput').focus();
};

window.atualizarTituloPrevia = function () { /* atualizado apenas na impressão */ };

/* ── Gerar QR via API ── */
window.gerarQR = async function () {
    clearTimeout(_debounceTimer);

    const texto = $('qrInput').value.trim();
    if (!texto) {
        $('qrVazio').style.display     = '';
        $('qrResultado').style.display = 'none';
        $('qrActions').style.display   = 'none';
        return;
    }

    const tamanho = parseInt($('qrTamanho').value) || 256;
    const nivel   = $('qrCorrecao').value || 'M';
    const cor     = ($('qrCor').value || '#000000').replace('#', '');

    /* Atualiza label da cor */
    $('qrCorLabel').textContent = '#' + cor;

    /* Feedback visual: desativa botão durante geração */
    const btnGerar = $('qrBtnGerar');
    if (btnGerar) { btnGerar.disabled = true; btnGerar.style.opacity = '0.7'; }

    try {
        const params = new URLSearchParams({ text: texto, size: tamanho, level: nivel, color: cor });
        const resp   = await fetch(`/api/qrcode/generate?${params}`);

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const { dataUrl } = await resp.json();
        _ultimoTexto   = texto;
        _ultimoDataUrl = dataUrl;

        /* Exibe a imagem */
        const img = $('qrImg');
        img.src   = dataUrl;
        img.style.width  = tamanho + 'px';
        img.style.height = tamanho + 'px';

        /* Preview URL */
        $('qrUrlPreview').textContent =
            texto.length > 80 ? texto.slice(0, 77) + '…' : texto;

        /* Mostra área de resultado */
        $('qrVazio').style.display     = 'none';
        $('qrResultado').style.display = '';
        $('qrActions').style.display   = '';

        /* Imagem de alta resolução para impressão */
        await carregarQRImpressao(texto, nivel);

    } catch (e) {
        console.error('[QRCode]', e);
        mostrarToast('⚠️ Não foi possível gerar o QR Code. Tente novamente.');
    } finally {
        if (btnGerar) { btnGerar.disabled = false; btnGerar.style.opacity = ''; }
    }
};

/* ── Imagem de impressão (512 px, preto) ── */
async function carregarQRImpressao(texto, nivel) {
    try {
        const params  = new URLSearchParams({ text: texto, size: 512, level: nivel, color: '000000' });
        const resp    = await fetch(`/api/qrcode/generate?${params}`);
        if (!resp.ok) return;
        const { dataUrl } = await resp.json();

        const printImg = $('qrPrintImg');
        if (printImg) printImg.src = dataUrl;

        const printUrl = $('qrPrintUrl');
        if (printUrl) printUrl.textContent = texto;

        const printData = $('qrPrintData');
        if (printData) {
            printData.textContent = new Date().toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        }

        const titulo     = $('qrTitulo').value.trim();
        const printTitulo = $('qrPrintTitulo');
        if (printTitulo) printTitulo.textContent = titulo;
    } catch (_) { /* silencioso — impressão não essencial */ }
}

/* ── Imprimir ── */
window.imprimir = async function () {
    if (!_ultimoTexto) return;
    const nivel = $('qrCorrecao').value || 'M';
    await carregarQRImpressao(_ultimoTexto, nivel);
    window.print();
};

/* ── Baixar PNG ── */
window.baixarPNG = function () {
    if (!_ultimoDataUrl) return;
    const link    = document.createElement('a');
    link.download = 'qrcode-edusync.png';
    link.href     = _ultimoDataUrl;
    link.click();
    mostrarToast('✅ QR Code baixado!');
};

/* ── Copiar link ── */
window.copiarLink = async function () {
    const texto = $('qrInput').value.trim();
    if (!texto) return;
    try {
        await navigator.clipboard.writeText(texto);
        mostrarToast('✅ Link copiado para a área de transferência!');
    } catch (_) {
        mostrarToast('⚠️ Não foi possível copiar. Tente manualmente.');
    }
};

/* ── Toast ── */
let _toastTimer = null;

function mostrarToast(msg, duracao = 3500) {
    const el = $('qrToast');
    el.textContent = msg;
    el.classList.add('qr-toast--visivel');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('qr-toast--visivel'), duracao);
}

/* ── Atalhos de teclado ── */
document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.activeElement === $('qrInput')) {
        clearTimeout(_debounceTimer);
        gerarQR();
    }
    if (e.key === 'p' && (e.ctrlKey || e.metaKey) && _ultimoTexto) {
        e.preventDefault();
        imprimir();
    }
});
