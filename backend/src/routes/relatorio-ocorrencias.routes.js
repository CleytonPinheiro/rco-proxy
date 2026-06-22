import { Router }        from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import pkg               from 'pg';
import PDFDocument       from 'pdfkit';

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });

// Dimensões A4 retrato (pontos tipográficos)
const PAGE_W = 595.28;
const PAGE_H = 841.89;

const MESES_PT = [
    'janeiro','fevereiro','março','abril','maio','junho',
    'julho','agosto','setembro','outubro','novembro','dezembro',
];

function dataExtenso(isoStr) {
    if (!isoStr) return { dd: '______', mes: '_______________', ano: '____' };
    const d = new Date(isoStr + (isoStr.includes('T') ? '' : 'T12:00:00'));
    return { dd: String(d.getDate()).padStart(2, '0'), mes: MESES_PT[d.getMonth()], ano: String(d.getFullYear()) };
}

function inferirEnsino(nomeTurma) {
    if (!nomeTurma) return '';
    const n = nomeTurma.trim();
    if (/m[eé]dio/i.test(n))         return 'Médio';
    if (/fund/i.test(n))              return 'Fundamental';
    if (/t[eé]cnico|tec\b/i.test(n)) return 'Médio';
    return '';
}

function parseTurma(nomeTurma) {
    if (!nomeTurma) return { serie: '', periodo: '', ensino: '' };
    const pts = nomeTurma.split(/\s*[-–]\s*/).map(s => s.trim()).filter(Boolean);
    return {
        serie:   pts[0]  || nomeTurma,
        periodo: pts.length > 1 ? pts[pts.length - 1] : '',
        ensino:  inferirEnsino(nomeTurma),
    };
}

// ─── Desenha logo circular ────────────────────────────────────────────────────
function drawLogo(doc, cx, cy, R, logoDataUrl, escolaNome) {
    const lX = cx - R;
    const lY = cy - R;
    const sz = R * 2;

    if (logoDataUrl?.startsWith('data:image')) {
        try {
            // Círculo de fundo branco
            doc.save();
            doc.circle(cx, cy, R).fillAndStroke('#fff', '#dde1e7');
            // Clip circular e insere imagem
            doc.circle(cx, cy, R).clip();
            doc.image(logoDataUrl, lX, lY, { fit: [sz, sz], align: 'center', valign: 'center' });
            doc.restore();
            // Anel externo suave
            doc.circle(cx, cy, R).lineWidth(1).stroke('#dde1e7').lineWidth(1);
            return;
        } catch { /* fallback abaixo */ }
    }

    // Placeholder: círculo com iniciais
    const initials = (escolaNome || 'E')
        .split(/\s+/).filter(w => /^[A-Za-zÀ-ú]/.test(w)).slice(0, 2)
        .map(w => w[0].toUpperCase()).join('');
    doc.circle(cx, cy, R).fillAndStroke('#eef0f5', '#c8cdd6');
    doc.font('Helvetica-Bold').fontSize(R * 0.65).fillColor('#7a8599')
       .text(initials, lX, cy - R * 0.38, { width: sz, align: 'center', lineBreak: false });
    doc.fillColor('#000');
}

// ─── Desenha UMA via do termo (retrato, coluna) ───────────────────────────────
function drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef }, colX, colW, viaLabel) {
    const FS = 8;       // font size base
    const LH = 13;      // linha padrão (text + gap para sublinha)

    // ── Helpers ──────────────────────────────────────────────────────────────
    function txt(str, x, y, opts) {
        doc.text(str, x, y, { lineBreak: false, ...opts });
    }

    // Campo: valor em negrito+maiúsculo com sublinha
    function field(x, y, fw, val) {
        const v = (val || '').toUpperCase();
        doc.font('Helvetica-Bold').fontSize(FS).fillColor('#111');
        txt(v, x, y + 0.5, { width: fw, ellipsis: true });
        doc.moveTo(x, y + LH - 0.5).lineTo(x + fw, y + LH - 0.5)
           .lineWidth(0.8).stroke('#444').lineWidth(1);
        doc.font('Helvetica').fontSize(FS).fillColor('#000');
    }

    // ── Mede larguras dos labels ──────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS);
    const lwEu   = doc.widthOfString('Eu, ');
    const lwL2a  = doc.widthOfString('Prof.(a) da disciplina de: ');
    const lwL2b  = doc.widthOfString(' declaro que o(a)');
    const lwL3   = doc.widthOfString('aluno(a): ');
    const lwNnum = doc.widthOfString('  Nº ');
    const lwL4a  = doc.widthOfString('da série: ');
    const lwL4b  = doc.widthOfString(', turma: ');
    const lwL4c  = doc.widthOfString(', do Ensino ');

    // ── Dados ────────────────────────────────────────────────────────────────
    const professor = (ocorrencia.professor_nome || '').trim();
    const disc      = (ocorrencia.disciplina     || '').trim();
    const nomeAluno = (aluno.nome                || '').trim();
    const numCham   = aluno.numchamada ? String(aluno.numchamada) : '';
    const { serie, periodo, ensino } = parseTurma(ocorrencia.nome_turma || aluno.turma || '');
    const { dd, mes, ano }           = dataExtenso(ocorrencia.data);

    // ── Y fixo a partir do topo ───────────────────────────────────────────────
    const MT    = 10;
    let   y     = MT;

    // VIA label (ex: "VIA COLÉGIO")
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#666')
       .text(viaLabel, colX, y, { width: colW, align: 'center', lineBreak: false });
    y += 13;

    // ── Cabeçalho ─────────────────────────────────────────────────────────────
    const HDR_H = 40;
    doc.rect(colX, y, colW, HDR_H).fill('#f5f6f8');
    doc.rect(colX, y, colW, HDR_H).lineWidth(1).stroke('#b0b8c4').lineWidth(1);
    doc.fillColor('#000');

    const R   = 14;
    const lCX = colX + 10 + R;
    const lCY = y + HDR_H / 2;
    drawLogo(doc, lCX, lCY, R, escola.logo, escola.nome);

    const divX = colX + 10 + R * 2 + 7;
    doc.moveTo(divX, y + 6).lineTo(divX, y + HDR_H - 6).lineWidth(0.8).stroke('#d0d5de').lineWidth(1);

    const hTX = divX + 7;
    const hTW = colW - (hTX - colX) - 6;
    doc.font('Helvetica').fontSize(5.5).fillColor('#6b7280')
       .text('ESTADO DO PARANÁ  ·  SECRETARIA DE ESTADO DA EDUCAÇÃO', hTX, y + 8, { width: hTW, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a202c')
       .text((escola.nome || 'Escola').toUpperCase(), hTX, y + 18, { width: hTW, lineBreak: false });
    const ep = [escola.endereco, escola.telefone].filter(Boolean).join('  ·  ');
    if (ep) {
        doc.font('Helvetica').fontSize(5.5).fillColor('#555')
           .text(ep, hTX, y + 31, { width: hTW, lineBreak: false });
    }
    doc.fillColor('#000');
    y += HDR_H + 8;

    // ── Título ────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000')
       .text('TERMO DE OCORRÊNCIA EM SALA DE AULA', colX, y, { width: colW, align: 'center', lineBreak: false });
    doc.moveTo(colX + colW * 0.1, y + 11).lineTo(colX + colW * 0.9, y + 11)
       .lineWidth(0.4).stroke('#b0b8c4').lineWidth(1);
    y += 18;

    // ── L1: Eu, [professor], ──────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).fillColor('#000').text('Eu, ', colX, y, { lineBreak: false });
    const fw1 = colW - lwEu - 4;
    field(colX + lwEu, y, fw1, professor);
    doc.font('Helvetica').fontSize(FS).text(',', colX + lwEu + fw1 + 1, y, { lineBreak: false });
    y += LH + 5;

    // ── L2: Prof.(a) da disciplina de: [disc] declaro que o(a) ───────────────
    doc.font('Helvetica').fontSize(FS).text('Prof.(a) da disciplina de: ', colX, y, { lineBreak: false });
    const fw2 = Math.max(36, colW - lwL2a - lwL2b);
    field(colX + lwL2a, y, fw2, disc);
    doc.font('Helvetica').fontSize(FS).text(' declaro que o(a)', colX + lwL2a + fw2, y, { lineBreak: false });
    y += LH + 5;

    // ── L3: aluno(a): [nome] Nº [num] ────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).text('aluno(a): ', colX, y, { lineBreak: false });
    const numFW  = numCham ? 20 : 0;
    const nameFW = colW - lwL3 - (numCham ? lwNnum + numFW : 0);
    field(colX + lwL3, y, nameFW, nomeAluno);
    if (numCham) {
        doc.font('Helvetica').fontSize(FS).text('  Nº ', colX + lwL3 + nameFW, y, { lineBreak: false });
        field(colX + lwL3 + nameFW + lwNnum, y, numFW, numCham);
    }
    y += LH + 5;

    // ── L4: da série: [serie], turma: [periodo], do Ensino [ensino] ──────────
    const SW = Math.min(80, colW * 0.30);
    const PW = Math.min(44, colW * 0.17);
    const EW = Math.min(40, colW * 0.15);
    {
        let cx = colX;
        doc.font('Helvetica').fontSize(FS).text('da série: ', cx, y, { lineBreak: false }); cx += lwL4a;
        doc.font('Helvetica-Bold').fontSize(FS).fillColor('#111');
        txt(serie.toUpperCase(), cx, y + 0.5, { width: SW, ellipsis: true });
        doc.moveTo(cx, y + LH - 0.5).lineTo(cx + SW, y + LH - 0.5).lineWidth(0.8).stroke('#444').lineWidth(1);
        cx += SW;

        doc.font('Helvetica').fontSize(FS).fillColor('#000').text(', turma: ', cx, y, { lineBreak: false }); cx += lwL4b;
        doc.font('Helvetica-Bold').fontSize(FS).fillColor('#111');
        txt(periodo.toUpperCase(), cx, y + 0.5, { width: PW, ellipsis: true });
        doc.moveTo(cx, y + LH - 0.5).lineTo(cx + PW, y + LH - 0.5).lineWidth(0.8).stroke('#444').lineWidth(1);
        cx += PW;

        doc.font('Helvetica').fontSize(FS).fillColor('#000').text(', do Ensino ', cx, y, { lineBreak: false }); cx += lwL4c;
        doc.font('Helvetica-Bold').fontSize(FS).fillColor('#111');
        txt(ensino.toUpperCase(), cx, y + 0.5, { width: EW, ellipsis: true });
        doc.moveTo(cx, y + LH - 0.5).lineTo(cx + EW, y + LH - 0.5).lineWidth(0.8).stroke('#444').lineWidth(1);
    }
    doc.fillColor('#000');
    y += LH + 5;

    // ── "manifestou..." ───────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text('manifestou o seguinte comportamento em sala de aula:', colX, y, { width: colW, lineBreak: false });
    y += LH + 3;
    const yDescStart = y;

    // ── POSIÇÕES FIXAS DO RODAPÉ (de baixo para cima) ─────────────────────────
    const MB        = 10;
    const yPageEnd  = PAGE_H - MB;

    // Obs: 2 linhas
    const yObs2Ln   = yPageEnd;
    const yObs1Ln   = yObs2Ln - 16;
    const yObsLabel = yObs1Ln - 11;

    // Assinaturas: 2 linhas × 2 colunas
    const ySig2Ln   = yObsLabel - 10;
    const ySig2Lab  = ySig2Ln   - 13;
    const ySig1Ln   = ySig2Lab  - 10;
    const ySig1Lab  = ySig1Ln   - 13;

    const ySepLn    = ySig1Lab  - 7;
    const yDate     = ySepLn    - LH - 2;
    const yDescEnd  = yDate     - 5;

    // ── Caixa de descrição (preenche o espaço disponível) ─────────────────────
    const descH = Math.max(40, yDescEnd - yDescStart);
    doc.rect(colX, yDescStart, colW, descH).fill('#fafbfc');
    doc.rect(colX, yDescStart, colW, descH).lineWidth(0.7).stroke('#b8c0cc').lineWidth(1);
    doc.fillColor('#000');

    const descricao = (ocorrencia.descricao || '').trim();
    if (descricao) {
        doc.font('Helvetica').fontSize(8).fillColor('#111')
           .text(descricao, colX + 7, yDescStart + 6, { width: colW - 14, height: descH - 12, lineGap: 3 });
    } else {
        // Linhas guia para preenchimento manual
        const nL   = Math.max(4, Math.floor(descH / 18));
        const step = descH / (nL + 1);
        for (let i = 1; i <= nL; i++) {
            doc.moveTo(colX + 6, yDescStart + i * step)
               .lineTo(colX + colW - 6, yDescStart + i * step)
               .lineWidth(0.5).stroke('#d8dde6').lineWidth(1);
        }
    }

    // ── Data ──────────────────────────────────────────────────────────────────
    const dateStr = `${cidadeRef || 'Maringá'}, ${dd} de ${mes} de ${ano}.`;
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text(dateStr, colX, yDate, { width: colW, align: 'right', lineBreak: false });

    // ── Linha separadora ──────────────────────────────────────────────────────
    doc.moveTo(colX, ySepLn).lineTo(colX + colW, ySepLn)
       .lineWidth(0.5).stroke('#c0c7d2').lineWidth(1);

    // ── Assinaturas (2 linhas × 2 colunas) ───────────────────────────────────
    const sigColW = colW / 2;
    const sigPad  = 4;

    // Linha 1: Professor | Aluno
    [['Assinatura do(a) Professor(a)', ySig1Lab, ySig1Ln],
     ['Assinatura do(a) Aluno(a)',     ySig1Lab, ySig1Ln]].forEach(([label, yLab, yLn], i) => {
        const sx = colX + i * sigColW;
        doc.font('Helvetica').fontSize(6).fillColor('#555')
           .text(label, sx + sigPad, yLab, { width: sigColW - sigPad * 2, lineBreak: false });
        doc.moveTo(sx + sigPad, yLn).lineTo(sx + sigColW - sigPad, yLn)
           .lineWidth(0.8).stroke('#555').lineWidth(1);
    });

    // Linha 2: Pai/Responsável | Testemunha
    [['Ass. do Pai ou Responsável', ySig2Lab, ySig2Ln],
     ['Ass. de Testemunha',         ySig2Lab, ySig2Ln]].forEach(([label, yLab, yLn], i) => {
        const sx = colX + i * sigColW;
        doc.font('Helvetica').fontSize(6).fillColor('#555')
           .text(label, sx + sigPad, yLab, { width: sigColW - sigPad * 2, lineBreak: false });
        doc.moveTo(sx + sigPad, yLn).lineTo(sx + sigColW - sigPad, yLn)
           .lineWidth(0.8).stroke('#555').lineWidth(1);
    });

    // ── Obs. ──────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
       .text('Obs.: ', colX, yObsLabel, { lineBreak: false });
    doc.moveTo(colX + doc.widthOfString('Obs.: '), yObs1Ln)
       .lineTo(colX + colW, yObs1Ln).lineWidth(0.6).stroke('#aaa').lineWidth(1);
    doc.moveTo(colX, yObs2Ln)
       .lineTo(colX + colW, yObs2Ln).lineWidth(0.6).stroke('#aaa').lineWidth(1);
}

// ─── Duas vias lado a lado numa página retrato ────────────────────────────────
function drawTermo(doc, { escola, aluno, ocorrencia, cidadeRef }) {
    const OUTER_M = 18;
    const COL_GAP = 14;
    const COL_W   = (PAGE_W - OUTER_M * 2 - COL_GAP) / 2;   // ≈ 269 pt

    // Coluna esquerda: Via Colégio
    drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef },
                  OUTER_M, COL_W, 'VIA COLÉGIO');

    // Separador vertical tracejado com tesoura
    const sepX = OUTER_M + COL_W + COL_GAP / 2;
    doc.save()
       .dash(5, { space: 3 })
       .moveTo(sepX, 6).lineTo(sepX, PAGE_H - 6)
       .lineWidth(0.6).stroke('#aaa')
       .undash()
       .restore();
    doc.font('Helvetica').fontSize(11).fillColor('#bbb')
       .text('✂', sepX - 6.5, PAGE_H / 2 - 7, { lineBreak: false });

    // Coluna direita: Via Responsável
    drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef },
                  OUTER_M + COL_W + COL_GAP, COL_W, 'VIA RESPONSÁVEL');
}

// ─── Busca dados de um aluno ──────────────────────────────────────────────────
async function fetchAlunoData(supabaseAdmin, codMatriz, { de, ate, tipo, professor }) {
    const [alunoResult, ocorrenciasResult, obsRcoResult] = await Promise.all([
        supabaseAdmin.from('alunos').select('nome, turma, numchamada, codmatrizaluno')
            .eq('codmatrizaluno', codMatriz).limit(1),
        supabaseAdmin.from('aluno_ocorrencias').select('*')
            .eq('cod_matriz_aluno', codMatriz).order('data', { ascending: true }),
        supabaseAdmin.from('rco_observacoes').select('*')
            .eq('cod_matriz_aluno', codMatriz).order('data_aula', { ascending: true }),
    ]);

    if (alunoResult.error) throw new Error(`Supabase: ${alunoResult.error.message}`);
    const aluno = (alunoResult.data || [])[0];
    if (!aluno) return null;

    let ocorrenciasRaw = ocorrenciasResult.data || [];
    if (de)   ocorrenciasRaw = ocorrenciasRaw.filter(o => o.data && new Date(o.data) >= new Date(de  + 'T00:00:00'));
    if (ate)  ocorrenciasRaw = ocorrenciasRaw.filter(o => o.data && new Date(o.data) <= new Date(ate + 'T23:59:59'));
    if (tipo && ['grave','atencao','positivo'].includes(tipo))
        ocorrenciasRaw = ocorrenciasRaw.filter(o => o.tipo === tipo);

    const ids = ocorrenciasRaw.map(o => o.id);
    let metaMap = {};
    if (ids.length > 0) {
        const ph = ids.map((_, i) => `$${i + 1}`).join(',');
        const { rows: metaRows } = await pool.query(
            `SELECT id_ocorrencia, professor_nome, nome_turma, disciplina
             FROM ocorrencia_meta WHERE id_ocorrencia IN (${ph})`, ids
        );
        for (const r of metaRows) metaMap[r.id_ocorrencia] = r;
    }

    let ocorrencias = ocorrenciasRaw.map(o => ({
        ...o,
        professor_nome: metaMap[o.id]?.professor_nome || '',
        nome_turma:     metaMap[o.id]?.nome_turma     || aluno.turma || '',
        disciplina:     metaMap[o.id]?.disciplina     || '',
    }));
    if (professor)
        ocorrencias = ocorrencias.filter(o =>
            o.professor_nome.toLowerCase().includes(professor.toLowerCase()));

    /* Observações RCO */
    let ocorrenciasRco = [];
    const incluirRco = !professor && (!tipo || tipo === 'atencao');
    if (incluirRco) {
        let obsRaw = obsRcoResult.data || [];
        if (de)  obsRaw = obsRaw.filter(o => o.data_aula && new Date(o.data_aula) >= new Date(de  + 'T00:00:00'));
        if (ate) obsRaw = obsRaw.filter(o => o.data_aula && new Date(o.data_aula) <= new Date(ate + 'T23:59:59'));

        if (obsRaw.length > 0) {
            const codClassesUnicos = [...new Set(obsRaw.map(o => o.cod_classe).filter(Boolean))];
            const disciplinaMap = {};
            if (codClassesUnicos.length > 0) {
                try {
                    const { data: cd } = await supabaseAdmin.from('rco_classes')
                        .select('cod_classe, rco_disciplinas(nome_disciplina)')
                        .in('cod_classe', codClassesUnicos);
                    for (const c of (cd || []))
                        disciplinaMap[c.cod_classe] = c.rco_disciplinas?.nome_disciplina || '';
                } catch {}
            }
            ocorrenciasRco = obsRaw.map(o => ({
                id: `rco_${o.id || o.cod_classe}`, tipo: 'atencao',
                data: o.data_aula, descricao: o.observacao || '',
                professor_nome: '', nome_turma: aluno.turma || '',
                disciplina: disciplinaMap[o.cod_classe] || '',
            }));
        }
    }

    const combinadas = [...ocorrencias, ...ocorrenciasRco]
        .sort((a, b) => (a.data || '').localeCompare(b.data || ''));

    return { aluno, combinadas };
}

// ─── Gera PDF retrato (2 vias por página) ─────────────────────────────────────
function gerarPDF(registros, escola, cidadeRef) {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 0, autoFirstPage: false });

    const chunks = [];
    doc.on('data', c => chunks.push(c));

    for (const { aluno, combinadas } of registros) {
        for (const ocorrencia of combinadas) {
            doc.addPage();
            drawTermo(doc, { escola, aluno, ocorrencia, cidadeRef });
        }
    }

    doc.end();
    return { doc, chunks };
}

// ─── Router ──────────────────────────────────────────────────────────────────
export function createRelatorioOcorrenciasRouter({ supabaseAdmin } = {}) {
    const router = Router();

    /* ── Lista de professores ── */
    router.get('/relatorio-ocorrencias/:codMatrizAluno/professores', requireModulo('ficha-aluno'), async (req, res) => {
        const codMatriz = parseInt(req.params.codMatrizAluno, 10);
        if (isNaN(codMatriz)) return res.status(400).json({ erro: 'codMatrizAluno inválido.' });
        try {
            const { data: ocorrencias } = await supabaseAdmin
                .from('aluno_ocorrencias').select('id').eq('cod_matriz_aluno', codMatriz);
            if (!ocorrencias?.length) return res.json([]);
            const ids = ocorrencias.map(o => o.id);
            const ph  = ids.map((_, i) => `$${i + 1}`).join(',');
            const { rows } = await pool.query(
                `SELECT DISTINCT professor_nome FROM ocorrencia_meta
                 WHERE id_ocorrencia IN (${ph}) AND professor_nome <> '' ORDER BY professor_nome`, ids
            );
            res.json(rows.map(r => r.professor_nome));
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* ── Termo de um único aluno ── */
    router.get('/relatorio-ocorrencias/:codMatrizAluno', requireModulo('ficha-aluno'), async (req, res) => {
        const codMatriz = parseInt(req.params.codMatrizAluno, 10);
        if (isNaN(codMatriz)) return res.status(400).json({ erro: 'codMatrizAluno inválido.' });
        try {
            const configResult = await pool.query(
                `SELECT chave, valor FROM edusync_config WHERE chave = ANY($1)`,
                [['escola_nome_oficial','escola_endereco','escola_telefone','escola_email','escola_logo_base64','escola_cidade_ref']]
            );
            const cfgMap = {};
            for (const r of (configResult.rows || [])) cfgMap[r.chave] = r.valor;
            const escola = {
                nome: cfgMap['escola_nome_oficial'] || 'Escola', endereco: cfgMap['escola_endereco'] || '',
                telefone: cfgMap['escola_telefone'] || '', email: cfgMap['escola_email'] || '',
                logo: cfgMap['escola_logo_base64'] || '',
            };
            const cidadeRef = cfgMap['escola_cidade_ref'] || 'Maringá';

            const dado = await fetchAlunoData(supabaseAdmin, codMatriz, req.query);
            if (!dado) return res.status(404).json({ erro: 'Aluno não encontrado.' });
            if (dado.combinadas.length === 0) return res.status(204).end();

            const { doc, chunks } = gerarPDF([dado], escola, cidadeRef);
            await new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

            const nomeArq = `termos-${(dado.aluno.nome || 'aluno').replace(/\s+/g, '-').toLowerCase()}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArq}"`);
            res.setHeader('Cache-Control', 'no-store');
            res.send(Buffer.concat(chunks));
        } catch (e) {
            console.error('[RELATORIO-OCORRENCIAS]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Termos em lote (múltiplos alunos) ── */
    router.post('/relatorio-ocorrencias/batch', requireModulo('ficha-aluno'), async (req, res) => {
        const { codMatrizes, de, ate, tipo, professor } = req.body || {};
        if (!Array.isArray(codMatrizes) || codMatrizes.length === 0)
            return res.status(400).json({ erro: 'Informe ao menos um codMatrizAluno em "codMatrizes".' });

        const ids = codMatrizes.map(Number).filter(n => !isNaN(n));
        if (ids.length === 0) return res.status(400).json({ erro: 'Nenhum ID válido.' });

        try {
            const configResult = await pool.query(
                `SELECT chave, valor FROM edusync_config WHERE chave = ANY($1)`,
                [['escola_nome_oficial','escola_endereco','escola_telefone','escola_email','escola_logo_base64','escola_cidade_ref']]
            );
            const cfgMap = {};
            for (const r of (configResult.rows || [])) cfgMap[r.chave] = r.valor;
            const escola = {
                nome: cfgMap['escola_nome_oficial'] || 'Escola', endereco: cfgMap['escola_endereco'] || '',
                telefone: cfgMap['escola_telefone'] || '', email: cfgMap['escola_email'] || '',
                logo: cfgMap['escola_logo_base64'] || '',
            };
            const cidadeRef = cfgMap['escola_cidade_ref'] || 'Maringá';
            const filtros = { de, ate, tipo, professor };

            const resultados = await Promise.all(ids.map(id => fetchAlunoData(supabaseAdmin, id, filtros)));
            const registros  = resultados.filter(r => r && r.combinadas.length > 0);
            if (registros.length === 0) return res.status(204).end();

            registros.sort((a, b) => (a.aluno.nome || '').localeCompare(b.aluno.nome || '', 'pt-BR'));

            const { doc, chunks } = gerarPDF(registros, escola, cidadeRef);
            await new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="termos-ocorrencia.pdf"');
            res.setHeader('Cache-Control', 'no-store');
            res.send(Buffer.concat(chunks));
        } catch (e) {
            console.error('[RELATORIO-OCORRENCIAS-BATCH]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
