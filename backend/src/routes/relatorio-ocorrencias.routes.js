import { Router }        from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import pkg               from 'pg';
import PDFDocument       from 'pdfkit';

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });

// Dimensões A4 paisagem (pontos tipográficos)
const PAGE_W = 841.89;
const PAGE_H = 595.28;

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

// ─── Desenha UMA via do termo (paisagem, coluna) ─────────────────────────────
function drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef }, colX, colW, viaLabel) {
    const FS = 9;       // font size base
    const UL = FS + 2;  // deslocamento da sublinha abaixo do topo do texto (≈ baseline)

    // ── Helpers ──────────────────────────────────────────────────────────────
    // Renderiza label simples em Helvetica normal
    function label(str, x, y) {
        doc.font('Helvetica').fontSize(FS).fillColor('#000')
           .text(str, x, y, { lineBreak: false });
    }

    // Renderiza valor em Helvetica-Bold maiúsculo + sublinha abaixo da baseline
    function field(x, y, fw, val) {
        const v = (val || '').toUpperCase();
        doc.font('Helvetica-Bold').fontSize(FS).fillColor('#111')
           .text(v, x, y, { lineBreak: false, width: fw, ellipsis: true });
        doc.moveTo(x, y + UL).lineTo(x + fw, y + UL)
           .lineWidth(0.8).stroke('#333').lineWidth(1);
        doc.fillColor('#000');
    }

    // ── Mede larguras dos labels (com fonte base definida) ────────────────────
    doc.font('Helvetica').fontSize(FS);
    const lwEu   = doc.widthOfString('Eu, ');
    const lwL2a  = doc.widthOfString('Prof.(a) da disciplina de: ');
    const lwL2b  = doc.widthOfString(' declaro que o(a)');
    const lwL3   = doc.widthOfString('aluno(a): ');
    const lwNnum = doc.widthOfString('  Nº ');
    const lwL4a  = doc.widthOfString('da série: ');
    const lwL4b  = doc.widthOfString(', turma: ');
    const lwL4c  = doc.widthOfString(', do Ensino ');
    const lwObs  = doc.widthOfString('Obs.: ');

    // ── Dados ────────────────────────────────────────────────────────────────
    const professor = (ocorrencia.professor_nome || '').trim();
    const disc      = (ocorrencia.disciplina     || '').trim();
    const nomeAluno = (aluno.nome                || '').trim();
    const numCham   = aluno.numchamada ? String(aluno.numchamada) : '';
    const { serie, periodo, ensino } = parseTurma(ocorrencia.nome_turma || aluno.turma || '');
    const { dd, mes, ano }           = dataExtenso(ocorrencia.data);

    // ── Y crescente a partir do topo ──────────────────────────────────────────
    const MT = 12;   // margem topo da página
    const LG = 16;   // espaçamento entre linhas de campos (label height + gap)
    let y = MT;

    // VIA label
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#666')
       .text(viaLabel, colX, y, { width: colW, align: 'center', lineBreak: false });
    y += 13;

    // ── Cabeçalho ─────────────────────────────────────────────────────────────
    const HDR_H = 46;
    doc.rect(colX, y, colW, HDR_H).fill('#f5f6f8');
    doc.rect(colX, y, colW, HDR_H).lineWidth(1).stroke('#b0b8c4').lineWidth(1);
    doc.fillColor('#000');

    const R   = 17;
    const lCX = colX + 12 + R;
    const lCY = y + HDR_H / 2;
    drawLogo(doc, lCX, lCY, R, escola.logo, escola.nome);

    const divX = colX + 12 + R * 2 + 9;
    doc.moveTo(divX, y + 7).lineTo(divX, y + HDR_H - 7)
       .lineWidth(0.8).stroke('#d0d5de').lineWidth(1);

    const hTX = divX + 9;
    const hTW = colW - (hTX - colX) - 8;
    doc.font('Helvetica').fontSize(6).fillColor('#6b7280')
       .text('ESTADO DO PARANÁ  ·  SECRETARIA DE ESTADO DA EDUCAÇÃO', hTX, y + 9, { width: hTW, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a202c')
       .text((escola.nome || 'Escola').toUpperCase(), hTX, y + 20, { width: hTW, lineBreak: false });
    const ep = [escola.endereco, escola.telefone].filter(Boolean).join('  ·  ');
    if (ep) {
        doc.font('Helvetica').fontSize(6).fillColor('#555')
           .text(ep, hTX, y + 35, { width: hTW, lineBreak: false });
    }
    doc.fillColor('#000');
    y += HDR_H + 10;

    // ── Título ────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
       .text('TERMO DE OCORRÊNCIA EM SALA DE AULA', colX, y, { width: colW, align: 'center', lineBreak: false });
    doc.moveTo(colX + colW * 0.15, y + 13).lineTo(colX + colW * 0.85, y + 13)
       .lineWidth(0.4).stroke('#b0b8c4').lineWidth(1);
    y += LG + 6;

    // ── L1: Eu, [professor], ──────────────────────────────────────────────────
    label('Eu, ', colX, y);
    const fw1 = colW - lwEu - 4;
    field(colX + lwEu, y, fw1, professor);
    label(',', colX + lwEu + fw1 + 1, y);
    y += LG;

    // ── L2: Prof.(a) da disciplina de: [disc] declaro que o(a) ───────────────
    label('Prof.(a) da disciplina de: ', colX, y);
    const fw2 = Math.max(60, colW - lwL2a - lwL2b);
    field(colX + lwL2a, y, fw2, disc);
    label(' declaro que o(a)', colX + lwL2a + fw2, y);
    y += LG;

    // ── L3: aluno(a): [nome] Nº [num] ─────────────────────────────────────────
    label('aluno(a): ', colX, y);
    const numFW  = numCham ? 28 : 0;
    const nameFW = colW - lwL3 - (numCham ? lwNnum + numFW : 0);
    field(colX + lwL3, y, nameFW, nomeAluno);
    if (numCham) {
        label('  Nº ', colX + lwL3 + nameFW, y);
        field(colX + lwL3 + nameFW + lwNnum, y, numFW, numCham);
    }
    y += LG;

    // ── L4: da série: [serie], turma: [periodo], do Ensino [ensino] ──────────
    // Widths calculados com espaço disponível após labels
    const fixedL4 = lwL4a + lwL4b + lwL4c;
    const remL4   = colW - fixedL4;
    const SW = Math.floor(remL4 * 0.44);  // série ≈ 44%
    const PW = Math.floor(remL4 * 0.28);  // turma ≈ 28%
    const EW = remL4 - SW - PW;           // ensino = resto
    {
        let cx = colX;
        label('da série: ', cx, y); cx += lwL4a;
        field(cx, y, SW, serie);    cx += SW;
        label(', turma: ', cx, y);  cx += lwL4b;
        field(cx, y, PW, periodo);  cx += PW;
        label(', do Ensino ', cx, y); cx += lwL4c;
        field(cx, y, EW, ensino);
    }
    y += LG;

    // ── "manifestou..." ───────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text('manifestou o seguinte comportamento em sala de aula:', colX, y, { width: colW, lineBreak: false });
    y += LG - 2;

    // ── CAIXA: descrição + rodapé (data, assinaturas, obs) ────────────────────
    const MB       = 12;                          // margem inferior da página
    const BOX_Y    = y;
    const BOX_H    = PAGE_H - MB - BOX_Y;         // caixa até a margem inferior
    const BOX_END  = BOX_Y + BOX_H;

    // Fundo e borda da caixa
    doc.rect(colX, BOX_Y, colW, BOX_H).fill('#fafbfc');
    doc.rect(colX, BOX_Y, colW, BOX_H).lineWidth(0.8).stroke('#b8c0cc').lineWidth(1);
    doc.fillColor('#000');

    // ── Rodapé: posições de baixo para cima (dentro da caixa) ────────────────
    const IP = 6;   // inner padding

    const yObs2Ln  = BOX_END  - IP;           // obs linha 2
    const yObs1Ln  = yObs2Ln  - 14;           // obs linha 1
    const yObsLab  = yObs1Ln  - 10;           // "Obs.:" label

    const ySig2Ln  = yObsLab  - 10;           // assinatura linha 2
    const ySig2Lab = ySig2Ln  - 10;           // label assinatura 2
    const ySig1Ln  = ySig2Lab - 12;           // assinatura linha 1
    const ySig1Lab = ySig1Ln  - 10;           // label assinatura 1

    const ySepIn   = ySig1Lab - 6;            // separador interno desc/rodapé
    const yDate    = ySepIn   - FS - 4;       // data

    // Área de texto da descrição (de dentro da caixa até a linha separadora)
    const yTxtStart = BOX_Y + IP + 2;
    const yTxtEnd   = yDate  - 4;
    const txtH      = Math.max(20, yTxtEnd - yTxtStart);

    const descricao = (ocorrencia.descricao || '').trim();
    if (descricao) {
        doc.font('Helvetica').fontSize(FS).fillColor('#111')
           .text(descricao, colX + IP + 2, yTxtStart, { width: colW - (IP + 2) * 2, height: txtH, lineGap: 3 });
    } else {
        const nL   = Math.max(3, Math.floor(txtH / 16));
        const step = txtH / (nL + 1);
        for (let i = 1; i <= nL; i++) {
            doc.moveTo(colX + IP, yTxtStart + i * step)
               .lineTo(colX + colW - IP, yTxtStart + i * step)
               .lineWidth(0.4).stroke('#d0d6e0').lineWidth(1);
        }
    }

    // Separador interno (desc / rodapé)
    doc.moveTo(colX + IP, ySepIn).lineTo(colX + colW - IP, ySepIn)
       .lineWidth(0.5).stroke('#c8cfda').lineWidth(1);

    // Data (alinhada à direita)
    const dateStr = `${cidadeRef || 'Maringá'}, ${dd} de ${mes} de ${ano}.`;
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text(dateStr, colX + IP, yDate, { width: colW - IP * 2, align: 'right', lineBreak: false });

    // Assinaturas 2 × 2
    const sigColW = (colW - IP * 2) / 2;
    const sigX0   = colX + IP;
    const sigPad  = 4;

    [
        ['Assinatura do(a) Professor(a)', 0, ySig1Lab, ySig1Ln],
        ['Assinatura do(a) Aluno(a)',     1, ySig1Lab, ySig1Ln],
        ['Ass. do Pai ou Responsável',    0, ySig2Lab, ySig2Ln],
        ['Ass. de Testemunha',            1, ySig2Lab, ySig2Ln],
    ].forEach(([lbl, col, yLab, yLn]) => {
        const sx = sigX0 + col * sigColW;
        doc.font('Helvetica').fontSize(6.5).fillColor('#555')
           .text(lbl, sx + sigPad, yLab, { width: sigColW - sigPad * 2, lineBreak: false });
        doc.moveTo(sx + sigPad, yLn).lineTo(sx + sigColW - sigPad, yLn)
           .lineWidth(0.8).stroke('#555').lineWidth(1);
    });

    // Obs.
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000')
       .text('Obs.: ', colX + IP, yObsLab, { lineBreak: false });
    doc.moveTo(colX + IP + lwObs, yObs1Ln)
       .lineTo(colX + colW - IP, yObs1Ln)
       .lineWidth(0.6).stroke('#aaa').lineWidth(1);
    doc.moveTo(colX + IP, yObs2Ln)
       .lineTo(colX + colW - IP, yObs2Ln)
       .lineWidth(0.6).stroke('#aaa').lineWidth(1);
}

// ─── Duas vias lado a lado em paisagem ───────────────────────────────────────
function drawTermo(doc, { escola, aluno, ocorrencia, cidadeRef }) {
    const OUTER_M = 18;
    const COL_GAP = 14;
    const COL_W   = (PAGE_W - OUTER_M * 2 - COL_GAP) / 2;   // ≈ 395 pt

    // Coluna esquerda: Via Colégio
    drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef },
                  OUTER_M, COL_W, 'VIA COLÉGIO');

    // Separador vertical tracejado com tesoura no centro
    const sepX = OUTER_M + COL_W + COL_GAP / 2;
    doc.save()
       .dash(5, { space: 3 })
       .moveTo(sepX, 6).lineTo(sepX, PAGE_H - 6)
       .lineWidth(0.7).stroke('#aaa')
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
            .eq('cod_matriz_aluno', codMatriz).order('data', { ascending: true }).limit(9999),
        supabaseAdmin.from('rco_observacoes').select('*')
            .eq('cod_matriz_aluno', codMatriz).order('data_aula', { ascending: true }).limit(9999),
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

// ─── Gera PDF paisagem (2 vias por página) ────────────────────────────────────
function gerarPDF(registros, escola, cidadeRef) {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false });

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
