'use strict';

/* ══════════════════════════════════════════════════════
   EduSync — Gerador de QR Code
   ══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

let _debounceTimer = null;
let _ultimoTexto   = '';

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    atualizarIconeTema();

    /* URL via query string: /qrcode/?url=https://... */
    const params = new URLSearchParams(location.search);
    const urlParam = params.get('url') || params.get('link') || '';
    if (urlParam) {
        $('qrInput').value = urlParam;
        onInputChange();
    }

    /* Foca no input */
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
    _debounceTimer = setTimeout(() => gerarQR(), 300);
};

window.limpar = function () {
    $('qrInput').value = '';
    $('qrBtnLimpar').style.display = 'none';
    $('qrVazio').style.display    = '';
    $('qrResultado').style.display = 'none';
    $('qrActions').style.display   = 'none';
    _ultimoTexto = '';
    $('qrInput').focus();
};

window.atualizarTituloPrevia = function () {
    /* Não precisa regenerar o QR, só atualiza a URL de preview */
};

/* ── Gerar QR ── */
window.gerarQR = async function () {
    clearTimeout(_debounceTimer);   /* cancela debounce pendente se vier do botão */
    const texto = $('qrInput').value.trim();
    if (!texto) {
        $('qrVazio').style.display    = '';
        $('qrResultado').style.display = 'none';
        $('qrActions').style.display   = 'none';
        return;
    }

    _ultimoTexto = texto;

    const tamanho  = parseInt($('qrTamanho').value) || 256;
    const nivel    = $('qrCorrecao').value || 'M';
    const cor      = $('qrCor').value || '#000000';

    /* Atualiza label da cor */
    $('qrCorLabel').textContent = cor;

    const canvas = $('qrCanvas');

    try {
        await QRCode.toCanvas(canvas, texto, {
            width:           tamanho,
            errorCorrectionLevel: nivel,
            margin:          2,
            color: {
                dark:  cor,
                light: '#ffffff',
            },
        });

        /* Atualiza URL de preview */
        const url = $('qrUrlPreview');
        url.textContent = texto.length > 80 ? texto.slice(0, 77) + '…' : texto;

        /* Mostra resultado */
        $('qrVazio').style.display    = 'none';
        $('qrResultado').style.display = '';
        $('qrActions').style.display   = '';

        /* Gera também o canvas de impressão (512px fixo, preto) */
        await gerarQRImpressao(texto, nivel);

    } catch (e) {
        mostrarToast('⚠️ Não foi possível gerar o QR Code. Verifique o link.');
    }
};

/* ── Canvas de impressão (maior, sempre preto) ── */
async function gerarQRImpressao(texto, nivel) {
    const canvas = $('qrPrintCanvas');
    await QRCode.toCanvas(canvas, texto, {
        width:           512,
        errorCorrectionLevel: nivel || 'M',
        margin:          2,
        color: { dark: '#000000', light: '#ffffff' },
    });

    /* URL e data */
    const printUrl = $('qrPrintUrl');
    if (printUrl) printUrl.textContent = texto;
    const printData = $('qrPrintData');
    if (printData) {
        printData.textContent = new Date().toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }

    /* Título de impressão */
    const titulo = $('qrTitulo').value.trim();
    const printTitulo = $('qrPrintTitulo');
    if (printTitulo) printTitulo.textContent = titulo;
}

/* ── Imprimir ── */
window.imprimir = async function () {
    if (!_ultimoTexto) return;

    /* Garante que o canvas de impressão está atualizado */
    const nivel = $('qrCorrecao').value || 'M';
    await gerarQRImpressao(_ultimoTexto, nivel);

    /* Atualiza título de impressão */
    const titulo = $('qrTitulo').value.trim();
    const printTitulo = $('qrPrintTitulo');
    if (printTitulo) printTitulo.textContent = titulo;

    window.print();
};

/* ── Baixar PNG ── */
window.baixarPNG = function () {
    if (!_ultimoTexto) return;
    const canvas = $('qrCanvas');
    const link   = document.createElement('a');
    link.download = 'qrcode-edusync.png';
    link.href     = canvas.toDataURL('image/png');
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

function mostrarToast(msg, duracao = 3000) {
    const el = $('qrToast');
    el.textContent = msg;
    el.classList.add('qr-toast--visivel');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('qr-toast--visivel'), duracao);
}

/* ── Atalho de teclado: Enter no input gera o QR imediatamente ── */
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
