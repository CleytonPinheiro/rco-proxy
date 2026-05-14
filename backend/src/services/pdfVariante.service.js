/**
 * pdfVariante.service.js
 * Extrai do PDF completo apenas as páginas correspondentes à variante do aluno.
 *
 * Prioridade:
 *   1. Mapeamento manual configurado pelo professor (link_prova_paginas JSONB)
 *   2. Auto-detecção por texto ("TIPO X", "VARIANTE X" etc.) via pdf-parse
 *   3. Fallback: PDF completo
 */

import { createRequire } from 'module';
import { PDFDocument } from 'pdf-lib';

const _require = createRequire(import.meta.url);

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

/* ── Extrai texto de cada página via pdf-parse ────────────────── */
async function extractPageTexts(pdfBuffer) {
    const texts = [];
    try {
        const pdfParse = _require('pdf-parse');
        await pdfParse(pdfBuffer, {
            pagerender: (pageData) =>
                pageData.getTextContent().then(c => {
                    const t = c.items.map(i => i.str).join(' ');
                    texts.push(t);
                    return t;
                }),
        });
    } catch (e) {
        console.warn('[PDF-VARIANTE] Extração de texto falhou (usando PDF completo):', e.message);
    }
    return texts;
}

/* ── Detecta índices (0-based) das páginas que contêm a variante ─ */
function detectPages(pageTexts, varianteCodigo) {
    const code = String(varianteCodigo).trim().toUpperCase();
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`\\bTIPO\\s*${escaped}\\b`,      'i'),
        new RegExp(`\\bVARIANTE\\s*${escaped}\\b`,  'i'),
        new RegExp(`\\bFORMA\\s*${escaped}\\b`,      'i'),
        new RegExp(`\\bTYPE\\s*${escaped}\\b`,       'i'),
        new RegExp(`\\bGABARITO\\s*${escaped}\\b`,   'i'),
        new RegExp(`\\bVERSAO\\s*${escaped}\\b`,     'i'),
    ];
    return pageTexts
        .map((t, i) => ({ i, t }))
        .filter(({ t }) => patterns.some(p => p.test(t)))
        .map(({ i }) => i);
}

/* ── Monta um novo PDF com apenas as páginas indicadas ─────────── */
async function buildSubPdf(srcBuf, zeroIndexedPages) {
    const src    = await PDFDocument.load(srcBuf);
    const dst    = await PDFDocument.create();
    const total  = src.getPageCount();
    const valid  = zeroIndexedPages.filter(i => i >= 0 && i < total);
    if (valid.length === 0) return srcBuf; // nenhuma página válida → retorna original
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
        const pdfBuffer = await fetchPdfBuffer(linkProva);
        const pageTexts = await extractPageTexts(pdfBuffer);
        entry = { pdfBuffer, pageTexts, cachedAt: Date.now() };
        _cache.set(cacheKey, entry);
    }

    const { pdfBuffer, pageTexts } = entry;
    if (pageTexts.length > 0) {
        const indices = detectPages(pageTexts, code);
        if (indices.length > 0) return await buildSubPdf(pdfBuffer, indices);
    }

    /* 3. Fallback: PDF completo ────────────────────────────────── */
    return pdfBuffer;
}

/** Invalida o cache de um prova específico (chamar ao atualizar link_prova) */
export function invalidatePdfCache(provaId) {
    for (const key of _cache.keys()) {
        if (key.startsWith(`${provaId}::`)) _cache.delete(key);
    }
}
