/**
 * pdfVariante.service.js
 * Extrai do PDF completo apenas as páginas correspondentes à variante do aluno.
 *
 * Prioridade:
 *   1. Mapeamento manual configurado pelo professor (link_prova_paginas JSONB)
 *   2. Auto-detecção por link de anotação no rodapé (ansid=XXXXX.N)  ← via pdf-lib annotations
 *   3. Auto-detecção por texto visível ("TIPO X", "VARIANTE X" etc.) ← via PDFParse.getText()
 *   4. Fallback: PDF completo
 */

import { createRequire } from 'module';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from 'pdf-lib';

const _require = createRequire(import.meta.url);

const DEBUG = process.env.DEBUG_PDF_VARIANTE === 'true';
function dbg(...args) { if (DEBUG) console.log('[PDF-VARIANTE][DEBUG]', ...args); }

/* ── Cache em memória (30 min TTL) ──────────────────────────── */
const _cache   = new Map();
const CACHE_MS = 30 * 60 * 1000;

/* ── Normaliza URLs do Google Drive para download direto ──────── */
function normalizeUrl(url) {
    const gm = url.match(/\/file\/d\/([^/?#]+)/);
    if (gm) return `https://drive.google.com/uc?export=download&id=${gm[1]}`;
    return url;
}

/* ── Faz download do PDF como Buffer ──────────────────────────── */
async function fetchPdfBuffer(url) {
    const clean = normalizeUrl(url);
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
        const res = await fetch(clean, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar PDF (${clean})`);
        return Buffer.from(await res.arrayBuffer());
    } finally {
        clearTimeout(timer);
    }
}

/* ── Extrai texto visível de cada página via PDFParse.getText() ───
 *
 * Substitui a abordagem anterior de pagerender callback do pdf-parse, que
 * populava um array via .push() em callbacks assíncronos sem garantia de
 * ordenação, causando array vazio ou mal-alinhado para PDFs como GradePen.
 *
 * PDFParse.getText() retorna { pages: [{num (1-indexed), text}], total }
 * onde cada página já está associada ao seu índice correto, sem callbacks.
 *
 * Retorna: array de strings indexado por 0-based page index.
 */
async function extractPageTexts(pdfBuffer) {
    const texts = [];
    try {
        const { PDFParse } = _require('pdf-parse');
        const parser = new PDFParse({ verbosity: 0, data: pdfBuffer });
        const result = await parser.getText();

        if (Array.isArray(result?.pages) && result.pages.length > 0) {
            const maxNum = result.pages.reduce((m, p) => Math.max(m, p.num ?? 0), 0);
            for (let i = 0; i < maxNum; i++) texts.push('');
            for (const { num, text } of result.pages) {
                if (typeof num === 'number' && num >= 1) texts[num - 1] = text ?? '';
            }
        }
        dbg(`extractPageTexts → ${texts.length} página(s), método: PDFParse.getText()`);
    } catch (e) {
        console.warn('[PDF-VARIANTE] Extração de texto falhou:', e.message);
    }
    return texts;
}

/* ── Extrai URLs de anotações de link de cada página via pdf-lib ─
 *
 * Muitos PDFs (ex: GradePen) têm hiperlinks no rodapé com URLs do tipo
 * "https://...?ansid=12345.2", onde o número após o ponto é o tipo/variante.
 * Esse texto NÃO aparece no conteúdo visível extraído pelo pdf-parse,
 * pois está armazenado como anotação (annotation) do tipo Link.
 * Esta função lê essas anotações diretamente da estrutura interna do PDF.
 *
 * Retorna: array de strings, uma por página, com todas as URIs concatenadas.
 */
async function extractPageAnnotationTexts(pdfBuffer) {
    const pageTexts = [];
    try {
        const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
        const count  = pdfDoc.getPageCount();

        for (let i = 0; i < count; i++) {
            const page      = pdfDoc.getPage(i);
            const annotRefs = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
            const uris      = [];

            if (annotRefs) {
                for (let j = 0; j < annotRefs.size(); j++) {
                    try {
                        const annot  = annotRefs.lookup(j, PDFDict);
                        const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
                        if (!action) continue;

                        const uriObj = action.lookupMaybe(PDFName.of('URI'));
                        if (!uriObj) continue;

                        let uri = '';
                        if (uriObj instanceof PDFHexString) uri = uriObj.decodeText();
                        else if (uriObj instanceof PDFString)    uri = uriObj.decodeText();
                        else                                     uri = String(uriObj);

                        if (uri) uris.push(uri);
                    } catch (_) { /* ignora anotação inválida */ }
                }
            }

            pageTexts.push(uris.join(' '));
        }
        dbg(`extractPageAnnotationTexts → ${pageTexts.length} página(s), ` +
            `${pageTexts.filter(t => t).length} com anotações`);
    } catch (e) {
        console.warn('[PDF-VARIANTE] Extração de anotações falhou:', e.message);
    }
    return pageTexts;
}

/* ── Detecta índices (0-based) das páginas que contêm a variante ─
 *
 * Aceita tanto texto visível quanto URLs de anotações.
 * Para URLs do tipo ansid=XXXXX.N detecta via captura do número após o ponto,
 * comparando-o ao varianteCodigo com três tentativas de indexação:
 *   - Direta:  N == code
 *   - +1:      N == parseInt(code)+1  (DB 0-based, PDF 1-based)
 *   - -1:      N == parseInt(code)-1  (DB 1-based, PDF 0-based)
 */
function detectPages(pageTexts, annotTexts, varianteCodigo) {
    const code    = String(varianteCodigo).trim().toUpperCase();
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    /* Padrões para texto visível */
    const textPatterns = [
        new RegExp(`\\bTIPO\\s*${escaped}\\b`,     'i'),
        new RegExp(`\\bVARIANTE\\s*${escaped}\\b`, 'i'),
        new RegExp(`\\bFORMA\\s*${escaped}\\b`,    'i'),
        new RegExp(`\\bTYPE\\s*${escaped}\\b`,     'i'),
        new RegExp(`\\bGABARITO\\s*${escaped}\\b`, 'i'),
        new RegExp(`\\bVERSAO\\s*${escaped}\\b`,   'i'),
        new RegExp(`ansid=\\d+\\.\\s*${escaped}(?:[^0-9]|$)`, 'i'),
    ];

    /* Padrão para URLs de anotação: captura o número após o ponto no ansid */
    const ansidAnnotRe = /ansid=\d+\.(\d+)/i;

    const matched = new Set();
    const reasons = {};

    const codeNum     = parseInt(code, 10);
    const offsetPlus  = isNaN(codeNum) ? null : String(codeNum + 1);
    const offsetMinus = isNaN(codeNum) ? null : (codeNum > 0 ? String(codeNum - 1) : null);

    const total = Math.max(pageTexts.length, annotTexts.length);
    for (let i = 0; i < total; i++) {
        const txt   = pageTexts[i]  || '';
        const annot = annotTexts[i] || '';

        dbg(`  pg${i + 1}: txt="${txt.slice(0, 80)}" annot="${annot.slice(0, 120)}"`);

        /* 1. Texto visível */
        if (txt && textPatterns.some(p => p.test(txt))) {
            matched.add(i);
            reasons[i] = 'texto-visível';
            continue;
        }

        /* 2. URL de anotação */
        if (annot) {
            /* 2a. Padrões de texto também cobrem ansid no texto de anotação */
            if (textPatterns.some(p => p.test(annot))) {
                matched.add(i);
                reasons[i] = 'annot-padrão-texto';
                continue;
            }

            /* 2b. Correspondência numérica via captura do grupo ansid */
            const m = annot.match(ansidAnnotRe);
            if (m) {
                const n = m[1];
                if (n === code) {
                    matched.add(i); reasons[i] = 'annot-direto';
                } else if (offsetPlus  !== null && n === offsetPlus) {
                    matched.add(i); reasons[i] = 'annot-offset+1';
                } else if (offsetMinus !== null && n === offsetMinus) {
                    matched.add(i); reasons[i] = 'annot-offset-1';
                }
                if (matched.has(i)) continue;
            }
        }
    }

    const result = [...matched].sort((a, b) => a - b);
    if (DEBUG) {
        if (result.length) {
            result.forEach(i => dbg(`  → pg${i + 1} matched via ${reasons[i]}`));
        } else {
            dbg('  → nenhuma página correspondeu ao varianteCodigo');
        }
    }
    return result;
}

/* ── Monta um novo PDF com apenas as páginas indicadas ─────────── */
async function buildSubPdf(srcBuf, zeroIndexedPages) {
    const src    = await PDFDocument.load(srcBuf);
    const dst    = await PDFDocument.create();
    const total  = src.getPageCount();
    const valid  = zeroIndexedPages.filter(i => i >= 0 && i < total);
    if (valid.length === 0) return srcBuf;
    const copied = await dst.copyPages(src, valid);
    copied.forEach(p => dst.addPage(p));
    return Buffer.from(await dst.save());
}

/**
 * Retorna um Buffer PDF contendo apenas as páginas da variante.
 *
 * @param {string}        linkProva      URL do PDF completo
 * @param {string|number} varianteCodigo Código da variante (ex: "0", "A")
 * @param {number}        provaId        Usado como chave de cache
 * @param {object|null}   manualPageMap  { "0": [1,2], "1": [3,4] } (1-indexed)
 */
export async function getPdfForVariante(linkProva, varianteCodigo, provaId, manualPageMap = null) {
    const code = String(varianteCodigo).trim();

    /* 1. Mapeamento manual tem prioridade ──────────────────────── */
    if (manualPageMap) {
        let map = manualPageMap;
        if (typeof map === 'string') {
            try { map = JSON.parse(map); } catch { map = null; }
        }
        if (map) {
            const pages = map[code] ?? map[code.toUpperCase()] ?? map[code.toLowerCase()];
            if (Array.isArray(pages) && pages.length > 0) {
                const buf     = await fetchPdfBuffer(linkProva);
                const indices = pages.map(p => Number(p) - 1);
                return await buildSubPdf(buf, indices);
            }
        }
    }

    /* 2. Cache + auto-detecção ─────────────────────────────────── */
    const cacheKey = `${provaId}::${linkProva}`;
    let entry = _cache.get(cacheKey);
    if (!entry || Date.now() - entry.cachedAt > CACHE_MS) {
        const pdfBuffer    = await fetchPdfBuffer(linkProva);
        const pageTexts    = await extractPageTexts(pdfBuffer);
        const annotTexts   = await extractPageAnnotationTexts(pdfBuffer);
        dbg(`cache miss prova=${provaId}: ${pageTexts.length} págs texto, ${annotTexts.length} págs annot`);
        entry = { pdfBuffer, pageTexts, annotTexts, cachedAt: Date.now() };
        _cache.set(cacheKey, entry);
    } else {
        dbg(`cache hit prova=${provaId}`);
    }

    const { pdfBuffer, pageTexts, annotTexts } = entry;
    dbg(`detectPages prova=${provaId} variante=${code}: ${pageTexts.length} págs-texto, ${annotTexts.length} págs-annot`);
    const indices = detectPages(pageTexts, annotTexts, code);

    if (indices.length > 0) {
        console.log(`[PDF-VARIANTE] prova=${provaId} variante=${code} → páginas [${indices.map(i => i + 1).join(',')}]`);
        return await buildSubPdf(pdfBuffer, indices);
    }

    /* 3. Fallback: PDF completo ────────────────────────────────── */
    console.warn(
        `[PDF-VARIANTE] prova=${provaId} variante=${code} → nenhuma página detectada` +
        ` (texto:${pageTexts.length}págs annot:${annotTexts.length}págs), retornando PDF completo`
    );
    return pdfBuffer;
}

/** Invalida o cache de um prova específico (chamar ao atualizar link_prova) */
export function invalidatePdfCache(provaId) {
    for (const key of _cache.keys()) {
        if (key.startsWith(`${provaId}::`)) _cache.delete(key);
    }
}
