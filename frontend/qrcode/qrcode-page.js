'use strict';

/* ══════════════════════════════════════════════════════
   EduSync — Gerador de QR Code (canvas renderer)
   ══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

/* ── Estado global ── */
let _debounceTimer = null;
let _ultimoTexto   = '';
let _ultimoMatrix  = null;   /* { moduleCount, data } */
let _logoDataUrl   = null;   /* imagem carregada pelo usuário */
let _estilo        = 'square';
let _corEscura     = '#000000';
let _corClara      = '#ffffff';

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    atualizarIconeTema();
    const params   = new URLSearchParams(location.search);
    const urlParam = params.get('url') || params.get('link') || '';
    if (urlParam) {
        $('qrInput').value = urlParam;
        $('qrBtnLimpar').style.display = '';
        onInputChange();
    }
    $('qrInput').focus();
    /* Apply themed custom dropdowns to the option selects */
    const selTamanho  = $('qrTamanho');
    const selCorrecao = $('qrCorrecao');
    if (selTamanho)  createCustomSelect(selTamanho,  { compact: true });
    if (selCorrecao) createCustomSelect(selCorrecao, { compact: true });
});

/* ══════════════════════════════════════════════════════
   TEMA
   ══════════════════════════════════════════════════════ */
function temaAtual() { return document.documentElement.getAttribute('data-theme') || 'light'; }

function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    /* Grava em todas as chaves usadas pelo sistema para o tema permanecer
       consistente ao voltar para o app principal (edugest_theme — theme.js)
       ou para o portal do aluno (aluno_tema / edusync_theme).               */
    localStorage.setItem('edugest_theme', tema);
    localStorage.setItem('aluno_tema',    tema);
    localStorage.setItem('edusync_theme', tema);
    atualizarIconeTema(tema);
}

function atualizarIconeTema(tema = temaAtual()) {
    const btn = $('qrTemaBtn');
    if (btn) btn.textContent = tema === 'dark' ? '☀️' : '🌙';
}

window.alternarTema = function () { aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark'); };

/* ══════════════════════════════════════════════════════
   INPUT
   ══════════════════════════════════════════════════════ */
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
    _ultimoTexto  = '';
    _ultimoMatrix = null;
    $('qrInput').focus();
};

/* ══════════════════════════════════════════════════════
   SELETORES DE ESTILO E TEMA
   ══════════════════════════════════════════════════════ */
window.selecionarEstilo = function (btn) {
    document.querySelectorAll('.qr-estilo-btn').forEach(b => b.classList.remove('qr-estilo-btn--ativo'));
    btn.classList.add('qr-estilo-btn--ativo');
    _estilo = btn.dataset.estilo;
    if (_ultimoMatrix) reRender();
};

window.selecionarTema = function (btn) {
    document.querySelectorAll('.qr-tema-preset').forEach(b => b.classList.remove('qr-tema-preset--ativo'));
    btn.classList.add('qr-tema-preset--ativo');
    _corEscura = btn.dataset.dark;
    _corClara  = btn.dataset.light;
    $('qrCor').value          = _corEscura;
    $('qrCorLabel').textContent = _corEscura;
    if (_ultimoMatrix) reRender();
};

window.onCorPersonalizada = function () {
    /* Remove seleção de tema, usa cor livre */
    document.querySelectorAll('.qr-tema-preset').forEach(b => b.classList.remove('qr-tema-preset--ativo'));
    _corEscura = $('qrCor').value;
    _corClara  = '#ffffff';
    $('qrCorLabel').textContent = _corEscura;
    if (_ultimoMatrix) reRender();
};

/* ══════════════════════════════════════════════════════
   LOGO
   ══════════════════════════════════════════════════════ */
window.escolherLogo = function () { $('qrLogoInput').click(); };

window.logoEscolhida = function (input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
        mostrarToast('⚠️ Imagem muito grande. Use até 3 MB.');
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        _logoDataUrl = e.target.result;
        $('qrLogoNome').textContent = file.name;
        $('qrBtnRemoverLogo').style.display  = '';
        $('qrLogoPreviewWrap').style.display = '';
        $('qrLogoPreview').src               = _logoDataUrl;
        if (_ultimoMatrix) reRender();
    };
    reader.readAsDataURL(file);
};

window.removerLogo = function () {
    _logoDataUrl = null;
    $('qrLogoInput').value               = '';
    $('qrLogoNome').textContent          = 'Nenhuma imagem selecionada';
    $('qrBtnRemoverLogo').style.display  = 'none';
    $('qrLogoPreviewWrap').style.display = 'none';
    $('qrLogoPreview').src               = '';
    if (_ultimoMatrix) reRender();
};

/* ══════════════════════════════════════════════════════
   GERAR QR — busca matriz no servidor
   ══════════════════════════════════════════════════════ */
window.gerarQR = async function () {
    clearTimeout(_debounceTimer);

    const texto = $('qrInput').value.trim();
    if (!texto) {
        $('qrVazio').style.display     = '';
        $('qrResultado').style.display = 'none';
        $('qrActions').style.display   = 'none';
        return;
    }

    /* Se logo presente, force qualidade H para maior resiliência */
    let nivel = $('qrCorrecao').value || 'M';
    if (_logoDataUrl && nivel === 'L') nivel = 'M';

    const btnGerar = $('qrBtnGerar');
    if (btnGerar) { btnGerar.disabled = true; btnGerar.style.opacity = '0.7'; }

    try {
        const params = new URLSearchParams({ text: texto, level: nivel });
        const resp   = await fetch(`/api/qrcode/matrix?${params}`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${resp.status}`);
        }
        const matrix = await resp.json();
        _ultimoTexto  = texto;
        _ultimoMatrix = matrix;

        await renderizarQR(matrix, 'qrCanvas', parseInt($('qrTamanho').value) || 256);

        $('qrUrlPreview').textContent =
            texto.length > 80 ? texto.slice(0, 77) + '…' : texto;

        $('qrVazio').style.display     = 'none';
        $('qrResultado').style.display = '';
        $('qrActions').style.display   = '';

    } catch (e) {
        console.error('[QRCode]', e);
        mostrarToast('⚠️ Não foi possível gerar o QR Code. Tente novamente.');
    } finally {
        if (btnGerar) { btnGerar.disabled = false; btnGerar.style.opacity = ''; }
    }
};

/* Re-renderiza no canvas sem buscar nova matriz (só mudou estilo/cores/logo/tamanho) */
window.reRender = async function () {
    if (!_ultimoMatrix) return;
    await renderizarQR(_ultimoMatrix, 'qrCanvas', parseInt($('qrTamanho').value) || 256);
};

/* ══════════════════════════════════════════════════════
   RENDERIZADOR CANVAS
   ══════════════════════════════════════════════════════ */
async function renderizarQR(matrix, canvasId, canvasSize) {
    const { moduleCount, data } = matrix;
    const canvas = $(canvasId);
    canvas.width  = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');

    /* Fundo */
    ctx.fillStyle = _corClara;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    /* Módulos */
    ctx.fillStyle = _corEscura;
    const margem = 2.2;            /* margem em módulos */
    const total  = moduleCount + margem * 2;
    const cell   = canvasSize / total;

    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            if (!data[row * moduleCount + col]) continue;
            const x = (col + margem) * cell;
            const y = (row + margem) * cell;
            desenharPonto(ctx, x, y, cell, _estilo);
        }
    }

    /* Logo no centro */
    if (_logoDataUrl) {
        await desenharLogo(ctx, canvasSize);
    }
}

/* ── Formas dos pontos ── */
function desenharPonto(ctx, x, y, cell, estilo) {
    const pad = cell * 0.07;
    const s   = cell - pad * 2;
    const cx  = x + cell / 2;
    const cy  = y + cell / 2;
    const r   = s / 2;

    switch (estilo) {
        case 'circle':
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'rounded':
            drawRoundRect(ctx, x + pad, y + pad, s, s, s * 0.33);
            break;
        case 'diamond':
            ctx.beginPath();
            ctx.moveTo(cx,             y + pad);
            ctx.lineTo(x + cell - pad, cy);
            ctx.lineTo(cx,             y + cell - pad);
            ctx.lineTo(x + pad,        cy);
            ctx.closePath();
            ctx.fill();
            break;
        case 'star':
            desenharEstrela(ctx, cx, cy, r * 0.9, 5);
            break;
        case 'cross': {
            const arm = s * 0.33;
            const hl  = (s - arm) / 2;
            ctx.fillRect(x + pad,      y + pad + hl, s,   arm);
            ctx.fillRect(x + pad + hl, y + pad,      arm, s  );
            break;
        }
        case 'hexagon':
            desenharHexagono(ctx, cx, cy, r * 0.95);
            break;
        case 'leaf': {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 0.52, r * 0.95, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            break;
        }
        case 'triangle':
            ctx.beginPath();
            ctx.moveTo(cx,             y + pad);
            ctx.lineTo(x + cell - pad, y + cell - pad);
            ctx.lineTo(x + pad,        y + cell - pad);
            ctx.closePath();
            ctx.fill();
            break;
        case 'heart':
            desenharCoracao(ctx, cx, cy, r * 0.88);
            break;
        case 'pixel': {
            const ps = s * 0.7;
            const po = (s - ps) / 2;
            ctx.fillRect(x + pad + po, y + pad + po, ps, ps);
            break;
        }
        default: /* square */
            ctx.fillRect(x + pad, y + pad, s, s);
    }
}

function drawRoundRect(ctx, x, y, w, h, rx) {
    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + w - rx, y);
    ctx.arcTo(x + w, y,     x + w, y + rx,     rx);
    ctx.lineTo(x + w, y + h - rx);
    ctx.arcTo(x + w, y + h, x + w - rx, y + h, rx);
    ctx.lineTo(x + rx, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - rx, rx);
    ctx.lineTo(x,     y + rx);
    ctx.arcTo(x,     y,     x + rx, y,          rx);
    ctx.closePath();
    ctx.fill();
}

function desenharEstrela(ctx, cx, cy, r, pontas) {
    const ri = r * 0.42;
    ctx.beginPath();
    for (let i = 0; i < pontas * 2; i++) {
        const ang  = (i * Math.PI / pontas) - Math.PI / 2;
        const dist = i % 2 === 0 ? r : ri;
        const px   = cx + Math.cos(ang) * dist;
        const py   = cy + Math.sin(ang) * dist;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
}

function desenharHexagono(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI / 3) - Math.PI / 6;
        const px  = cx + Math.cos(ang) * r;
        const py  = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
}

function desenharCoracao(ctx, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy + r * 0.12);
    ctx.scale(r, r);
    ctx.beginPath();
    ctx.moveTo(0, -0.45);
    ctx.bezierCurveTo( 0.02, -0.9,  1,   -0.9,  1,   -0.35);
    ctx.bezierCurveTo( 1,     0.1,  0.5,  0.52,  0,    0.92);
    ctx.bezierCurveTo(-0.5,   0.52, -1,   0.1,  -1,   -0.35);
    ctx.bezierCurveTo(-1,    -0.9, -0.02, -0.9,  0,   -0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/* ── Logo centralizada ── */
async function desenharLogo(ctx, size) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const logoSz  = size * 0.22;
            const pad     = logoSz * 0.2;
            const boxSz   = logoSz + pad * 2;
            const bx      = (size - boxSz) / 2;
            const by      = (size - boxSz) / 2;
            const rx      = boxSz * 0.15;

            /* Sombra suave atrás da caixa */
            ctx.save();
            ctx.shadowColor   = 'rgba(0,0,0,.18)';
            ctx.shadowBlur    = boxSz * 0.12;
            ctx.fillStyle     = _corClara;
            drawRoundRect(ctx, bx, by, boxSz, boxSz, rx);
            ctx.restore();

            /* Borda da caixa */
            ctx.save();
            ctx.strokeStyle = 'rgba(0,0,0,.08)';
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            ctx.moveTo(bx + rx, by);
            ctx.lineTo(bx + boxSz - rx, by);
            ctx.arcTo(bx + boxSz, by,     bx + boxSz, by + rx,       rx);
            ctx.lineTo(bx + boxSz, by + boxSz - rx);
            ctx.arcTo(bx + boxSz, by + boxSz, bx + boxSz - rx, by + boxSz, rx);
            ctx.lineTo(bx + rx, by + boxSz);
            ctx.arcTo(bx,       by + boxSz, bx, by + boxSz - rx,     rx);
            ctx.lineTo(bx,       by + rx);
            ctx.arcTo(bx,       by,     bx + rx, by,                 rx);
            ctx.closePath();
            ctx.stroke();
            ctx.restore();

            /* Imagem */
            ctx.drawImage(img, bx + pad, by + pad, logoSz, logoSz);
            resolve();
        };
        img.onerror = resolve;
        img.src     = _logoDataUrl;
    });
}

/* ══════════════════════════════════════════════════════
   IMPRIMIR
   ══════════════════════════════════════════════════════ */
window.imprimir = async function () {
    if (!_ultimoMatrix) return;

    const printCanvas = $('qrPrintCanvas');
    await renderizarQR(_ultimoMatrix, 'qrPrintCanvas', 512);
    printCanvas.style.width  = '512px';
    printCanvas.style.height = '512px';

    const titulo = $('qrTitulo').value.trim();
    $('qrPrintTitulo').textContent = titulo;
    $('qrPrintUrl').textContent    = _ultimoTexto;
    $('qrPrintData').textContent   = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    window.print();
};

/* ══════════════════════════════════════════════════════
   BAIXAR PNG
   ══════════════════════════════════════════════════════ */
window.baixarPNG = function () {
    if (!_ultimoMatrix) return;
    const canvas = $('qrCanvas');
    const link   = document.createElement('a');
    link.download = 'qrcode-edusync.png';
    link.href     = canvas.toDataURL('image/png');
    link.click();
    mostrarToast('✅ QR Code baixado!');
};

/* ══════════════════════════════════════════════════════
   COPIAR LINK
   ══════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════ */
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
