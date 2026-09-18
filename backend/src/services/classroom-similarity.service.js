import crypto from 'crypto';
import { google } from 'googleapis';
import { PDFParse } from 'pdf-parse';

export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 250_000;
const GOOGLE_EXPORTS = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
};
const TEXT_MIMES = new Set([
    'text/plain', 'text/csv', 'text/markdown', 'application/json',
    'application/xml', 'text/xml', 'text/html',
]);

export function tokenHasDriveScope(token) {
    return new Set(String(token?.scope || '').split(/\s+/).filter(Boolean)).has(DRIVE_READONLY_SCOPE);
}

export function normalizeSimilarityText(value, baseText = '') {
    const normalize = text => String(text || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/<[^>]+>/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ').trim();
    let text = normalize(value);
    const base = normalize(baseText);
    if (base.length >= 20) {
        text = text.replaceAll(base, ' ');
        const common = new Set(words(base).filter(w => w.length > 4));
        text = words(text).filter(w => !common.has(w)).join(' ');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function words(text) {
    return String(text || '').split(/\s+/).filter(Boolean);
}

function shingles(text, size = 4) {
    const tokens = words(text);
    const result = new Set();
    for (let i = 0; i <= tokens.length - size; i++) result.add(tokens.slice(i, i + size).join(' '));
    return result;
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const item of a) if (b.has(item)) intersection++;
    return intersection / (a.size + b.size - intersection);
}

function matchingPassages(a, b, limit = 5) {
    const aWords = words(a);
    const bSet = shingles(b, 6);
    const found = [];
    for (let i = 0; i <= aWords.length - 6 && found.length < limit; i++) {
        const phrase = aWords.slice(i, i + 6).join(' ');
        if (bSet.has(phrase) && !found.some(x => x.includes(phrase) || phrase.includes(x))) {
            found.push(aWords.slice(i, Math.min(i + 18, aWords.length)).join(' '));
            i += 5;
        }
    }
    return found;
}

export function classifySimilarity(percent, identicalFile = false, exactText = false) {
    if (identicalFile) return 'arquivo_identico';
    if (exactText || percent >= 85) return 'texto_muito_semelhante';
    if (percent >= 55) return 'copia_parcial';
    if (percent >= 35) return 'possivel_parafrase';
    return 'baixo';
}

export function compareSubmissionPair(a, b, baseText = '') {
    const sources = [];
    const textsA = (a.sources || []).filter(s => s.text).map(s => ({ ...s, normalized: normalizeSimilarityText(s.text, baseText) }));
    const textsB = (b.sources || []).filter(s => s.text).map(s => ({ ...s, normalized: normalizeSimilarityText(s.text, baseText) }));
    let best = { score: 0, a: null, b: null, passages: [] };
    for (const sa of textsA) {
        for (const sb of textsB) {
            const exact = sa.normalized.length >= 20 && sa.normalized === sb.normalized;
            const score = exact ? 1 : jaccard(shingles(sa.normalized), shingles(sb.normalized));
            if (score > best.score) best = { score, a: sa, b: sb, exact, passages: matchingPassages(sa.normalized, sb.normalized) };
        }
    }
    if (best.a) sources.push({ origemA: best.a.label, origemB: best.b.label, trechos: best.passages });
    const hashesB = new Map((b.files || []).filter(f => f.hash).map(f => [f.hash, f]));
    const identicalFiles = (a.files || []).filter(f => f.hash && hashesB.has(f.hash)).map(f => ({
        arquivoA: f.name, arquivoB: hashesB.get(f.hash).name, hash: f.hash,
    }));
    const percent = Math.round(best.score * 100);
    const exactText = !!best.exact;
    return {
        percent,
        signal: classifySimilarity(percent, identicalFiles.length > 0, exactText),
        identicalFiles,
        exactText,
        sources,
    };
}

export function compareSubmissions(submissions, baseText = '') {
    const pairs = [];
    for (let i = 0; i < submissions.length; i++) {
        for (let j = i + 1; j < submissions.length; j++) {
            const result = compareSubmissionPair(submissions[i], submissions[j], baseText);
            if (result.percent > 0 || result.identicalFiles.length) {
                pairs.push({ alunoA: submissions[i], alunoB: submissions[j], ...result });
            }
        }
    }
    return pairs.sort((a, b) => Number(!!b.identicalFiles.length) - Number(!!a.identicalFiles.length) || b.percent - a.percent);
}

export function submissionVersion(submission) {
    return crypto.createHash('sha256').update(JSON.stringify({
        id: submission.id, updateTime: submission.updateTime || null, state: submission.state,
        answer: submission.shortAnswerSubmission?.answer || submission.multipleChoiceSubmission?.answer || '',
        files: (submission.assignmentSubmission?.attachments || []).map(a => a.driveFile?.id || a.driveFile?.driveFile?.id || ''),
    })).digest('hex');
}

async function bufferFromDrive(drive, file, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const mime = file.mimeType;
        const response = GOOGLE_EXPORTS[mime]
            ? await drive.files.export({ fileId: file.id, mimeType: GOOGLE_EXPORTS[mime] }, { responseType: 'arraybuffer', signal: controller.signal })
            : await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer', signal: controller.signal });
        const buffer = Buffer.from(response.data);
        if (buffer.length > MAX_FILE_BYTES) throw Object.assign(new Error('Arquivo excede o limite de 10 MB.'), { code: 'ARQUIVO_GRANDE' });
        return buffer;
    } finally {
        clearTimeout(timer);
    }
}

export async function extractDriveFile(auth, fileId, { timeoutMs = 20_000 } = {}) {
    const drive = google.drive({ version: 'v3', auth });
    try {
        const { data: meta } = await drive.files.get({ fileId, fields: 'id,name,mimeType,size,modifiedTime,md5Checksum' });
        if (Number(meta.size || 0) > MAX_FILE_BYTES) throw Object.assign(new Error('Arquivo excede o limite de 10 MB.'), { code: 'ARQUIVO_GRANDE' });
        const buffer = await bufferFromDrive(drive, meta, timeoutMs);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        let text = '';
        const exportedMime = GOOGLE_EXPORTS[meta.mimeType];
        if (exportedMime || TEXT_MIMES.has(meta.mimeType)) {
            text = buffer.toString('utf8').slice(0, MAX_TEXT_CHARS);
        } else if (meta.mimeType === 'application/pdf') {
            const parser = new PDFParse({ data: buffer });
            try { text = String((await parser.getText()).text || '').slice(0, MAX_TEXT_CHARS); }
            finally { await parser.destroy(); }
        } else {
            return { name: meta.name, mimeType: meta.mimeType, hash, status: 'nao_suportado', reason: 'Formato sem extração textual segura.' };
        }
        return { name: meta.name, mimeType: meta.mimeType, hash, text, status: 'processado', modifiedTime: meta.modifiedTime };
    } catch (error) {
        const reason = error.code === 'ARQUIVO_GRANDE' ? error.message
            : error?.response?.status === 403 ? 'Arquivo inacessível para esta conta.'
            : error.name === 'AbortError' ? 'Tempo limite ao ler o arquivo.'
            : 'Não foi possível ler o arquivo.';
        return { name: fileId, mimeType: null, hash: null, text: '', status: 'falha', reason };
    }
}