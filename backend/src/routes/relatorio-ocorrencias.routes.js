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

const TURNOS = /^(manh[aã]|tarde|noturno|integral|vespertino|matutino)$/i;

function parseTurma(nomeTurma) {
    if (!nomeTurma) return { serie: '', periodo: '', ensino: '' };
    const pts = nomeTurma.split(/\s*[-–]\s*/).map(s => s.trim()).filter(Boolean);
    if (pts.length === 0) return { serie: nomeTurma, periodo: '', ensino: '' };

    const serie = pts[0];

    /* Remove os segmentos de turno (Manhã/Tarde/…) — pode haver mais de um */
    const semTurno = pts.filter(p => !TURNOS.test(p));
    if (semTurno.length <= 1) {
        return { serie, periodo: semTurno[0] || serie, ensino: inferirEnsino(nomeTurma) };
    }

    /* Formato RCO real: CURSO - ANO - TURNO - SEÇÃO
       ex: "ENS FUND 6/9 ANO-SERIE - 9ºAno - Tarde - C"
       Após remover turno → ["ENS FUND 6/9 ANO-SERIE", "9ºAno", "C"]
       Regra: se o último segmento for uma única letra (A–Z) = seção de turma,
       combina com o segmento anterior (ano) → "9º C". */
    const lastSeg = semTurno[semTurno.length - 1];
    const isSecao = /^[A-Z]$/i.test(lastSeg);
    let periodo;

    if (isSecao && semTurno.length >= 3) {
        // ex: ["CURSO", "9ºAno", "C"] → "9º C"
        const yearSeg = semTurno[semTurno.length - 2];
        const yearNum = yearSeg.match(/^\d+[ºª°]?/)?.[0] ?? yearSeg.split(/\s/)[0];
        periodo = `${yearNum} ${lastSeg.toUpperCase()}`;
    } else {
        /* Sem seção separada: compacta para apenas o ordinal do ano
           ex: "3ª Série" → "3ª"  |  "9ºAno" → "9º"
           Se não houver ordinal identificável, usa o segmento completo. */
        const yearOrd = lastSeg.match(/^\d+[ºª°]?/)?.[0];
        periodo = yearOrd ?? lastSeg;
    }

    return { serie, periodo, ensino: inferirEnsino(nomeTurma) };
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
function drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef, nomeProfLogado }, colX, colW, viaLabel) {
    const FS = 9;       // font size base
    const UL = FS;      // sublinha na baseline do texto (texto senta sobre a linha)

    // Retorna primeiro + último sobrenome
    function primeiroSobrenome(nome) {
        const p = (nome || '').trim().split(/\s+/).filter(Boolean);
        if (p.length <= 2) return (nome || '').trim();
        return `${p[0]} ${p[p.length - 1]}`;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    function label(str, x, y) {
        doc.font('Helvetica').fontSize(FS).fillColor('#000')
           .text(str, x, y, { lineBreak: false });
    }

    function field(x, y, fw, val) {
        const v = (val || '').toUpperCase();
        doc.font('Helvetica-Bold').fontSize(FS).fillColor('#111')
           .text(v, x, y, { lineBreak: false, width: fw, ellipsis: true });
        doc.moveTo(x, y + UL).lineTo(x + fw, y + UL)
           .lineWidth(0.8).stroke('#444').lineWidth(1);
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
    const professor = primeiroSobrenome(ocorrencia.professor_nome || nomeProfLogado || '');
    const disc      = (ocorrencia.disciplina     || '').trim();
    const nomeAluno = (aluno.nome                || '').trim();
    const numCham   = aluno.numchamada ? String(aluno.numchamada) : '';
    const { serie, periodo, ensino } = parseTurma(ocorrencia.nome_turma || aluno.turma || '');
    const { dd, mes, ano }           = dataExtenso(ocorrencia.data);

    // ── Y crescente a partir do topo ──────────────────────────────────────────
    const MT = 12;   // margem topo da página
    const LG = 16;   // espaçamento entre linhas de campos (label height + gap)
    let y = MT;

    // VIA label com destaque + turma à direita
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b')
       .text(viaLabel, colX, y, { width: colW, align: 'center', lineBreak: false });

    // Turma right-aligned na mesma linha do VIA
    const turmaCurta = [serie, periodo].filter(Boolean).join(' — ');
    if (turmaCurta) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#4338ca')
           .text(turmaCurta, colX, y + 0.5, { width: colW - 2, align: 'right', lineBreak: false });
    }
    y += 14;

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

    // Número de ata (direita do título, mesma linha)
    if (ocorrencia.ataNum && ocorrencia.ataTotal) {
        const ataTxt = `Ata Nº ${ocorrencia.ataNum} de ${ocorrencia.ataTotal}`;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#4338ca')
           .text(ataTxt, colX, y + 1.5, { width: colW - 4, align: 'right', lineBreak: false });
    }

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
    const MB      = 12;
    const BOX_Y   = y;
    const BOX_H   = PAGE_H - MB - BOX_Y;
    const BOX_END = BOX_Y + BOX_H;
    const IP      = 6;

    doc.rect(colX, BOX_Y, colW, BOX_H).fill('#fafbfc');
    doc.rect(colX, BOX_Y, colW, BOX_H).lineWidth(0.8).stroke('#b8c0cc').lineWidth(1);
    doc.fillColor('#000');

    // ── Posições do rodapé — bottom-up ───────────────────────────────────────
    // SIG 2 (Pai/Resp, Testemunha): parte diretamente do fundo da caixa
    const ySig2Lab = BOX_END - IP - 12;       // label assinatura 2
    const ySig2Ln  = ySig2Lab - 8;            // linha de assinatura 2
    // SIG 1 (Prof, Aluno)
    const ySig1Lab = ySig2Ln - 44;
    const ySig1Ln  = ySig1Lab - 8;
    // Separador e data
    const ySepIn   = ySig1Ln - 38;
    const yDate    = ySepIn + 4;

    // ── Faixa de frequência (opcional) e campo Obs. — ficam acima do separador ─
    const freqResumo  = ocorrencia.freqResumo  || null;
    const notaResumo  = (ocorrencia.notaResumo && ocorrencia.notaResumo.length > 0)
                        ? ocorrencia.notaResumo : null;
    const FREQ_H      = freqResumo  ? 26 : 0;
    const NOTAS_H     = notaResumo  ? 22 : 0;
    const OBS_H       = 30;   // label "Obs.:" + 2 linhas manuscritas

    // ── Área de texto da descrição ────────────────────────────────────────────
    const yTxtStart = BOX_Y + IP + 2;
    const yTxtEnd   = ySepIn - 4 - OBS_H - 4
                      - (NOTAS_H > 0 ? NOTAS_H + 4 : 0)
                      - (FREQ_H  > 0 ? FREQ_H  + 4 : 0);
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

    // ── Campo Obs.: (acima das notas / frequência, para preenchimento manuscrito) ──
    {
        const yObsLbl = yTxtEnd + 4;
        const yObs2   = yObsLbl + 16;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1a1d23')
           .text('Obs.: ', colX + IP, yObsLbl, { lineBreak: false });
        doc.moveTo(colX + IP + lwObs, yObsLbl)
           .lineTo(colX + colW - IP, yObsLbl)
           .lineWidth(0.6).stroke('#94a3b8').lineWidth(1);
        doc.moveTo(colX + IP, yObs2)
           .lineTo(colX + colW - IP, yObs2)
           .lineWidth(0.6).stroke('#94a3b8').lineWidth(1);
    }

    // ── Faixa de notas (verde, opcional) ─────────────────────────────────────
    if (notaResumo) {
        const yN  = yTxtEnd + OBS_H + 4;
        const nW  = colW - IP * 2;
        const nTY = yN + (NOTAS_H - 8) / 2;

        doc.rect(colX + IP, yN, nW, NOTAS_H).fill('#f0fdf4');
        doc.rect(colX + IP, yN, nW, NOTAS_H).lineWidth(0.5).stroke('#86efac').lineWidth(1);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#15803d')
           .text('NOTA: ', colX + IP + 6, nTY, { lineBreak: false });
        const nLblW = doc.widthOfString('NOTA: ');

        const notasTxt = notaResumo
            .map(n => `${n.nome}: ${n.nota != null ? Number(n.nota).toFixed(1) : '—'}`)
            .join('  ·  ');

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#166534')
           .text(notasTxt, colX + IP + 6 + nLblW, nTY,
                 { width: nW - 12 - nLblW, lineBreak: false, ellipsis: true });
        doc.fillColor('#000');
    }

    // ── Faixa de frequência (azul, opcional) ─────────────────────────────────
    if (freqResumo) {
        const yF  = yTxtEnd + OBS_H + 4 + (NOTAS_H > 0 ? NOTAS_H + 2 : 0);
        const fW  = colW - IP * 2;
        const fTY = yF + (FREQ_H - 8) / 2;

        doc.rect(colX + IP, yF, fW, FREQ_H).fill('#eef3ff');
        doc.rect(colX + IP, yF, fW, FREQ_H).lineWidth(0.5).stroke('#b3c6f0').lineWidth(1);

        // Label "FREQUÊNCIA:"
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#2a45a0')
           .text('FREQUÊNCIA: ', colX + IP + 6, fTY, { lineBreak: false });
        const lblW = doc.widthOfString('FREQUÊNCIA: ');

        let freqTxt;
        let freqColor = '#1a1d23';
        if (freqResumo.semDados) {
            freqTxt = `${freqResumo.nomeDisciplina.toUpperCase()} — sem dados registrados`;
        } else {
            const pct = freqResumo.percentual != null ? `  ·  ${freqResumo.percentual}%` : '';
            freqTxt = `${freqResumo.nomeDisciplina.toUpperCase()}  ·  ${freqResumo.totalAulas} aulas  ·  ${freqResumo.presencas} presenças  ·  ${freqResumo.faltas} faltas${pct}`;
            if (freqResumo.percentual != null)
                freqColor = freqResumo.percentual < 75 ? '#b91c1c' : '#15803d';
        }
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(freqColor)
           .text(freqTxt, colX + IP + 6 + lblW, fTY, { width: fW - 12 - lblW, lineBreak: false, ellipsis: true });
        doc.fillColor('#000');
    }

    // ── Separador interno (desc / rodapé) ─────────────────────────────────────
    doc.moveTo(colX + IP, ySepIn).lineTo(colX + colW - IP, ySepIn)
       .lineWidth(0.6).stroke('#94a3b8').lineWidth(1);

    // ── Data (direita, logo abaixo do separador) ──────────────────────────────
    const dateStr = `${cidadeRef || 'Maringá'}, ${dd} de ${mes} de ${ano}.`;
    doc.font('Helvetica-Bold').fontSize(FS).fillColor('#1a1d23')
       .text(dateStr, colX + IP, yDate, { width: colW - IP * 2, align: 'right', lineBreak: false });

    // ── Assinaturas 2 × 2 (linha acima, label abaixo) ────────────────────────
    const sigColW = (colW - IP * 2) / 2;
    const sigX0   = colX + IP;
    const sigPad  = 6;

    // Fundo sutil para a área de assinaturas
    doc.rect(sigX0, ySig1Ln - 1, colW - IP * 2, (ySig2Lab + 8) - (ySig1Ln - 1))
       .fill('#f1f5f9').fillColor('#000');

    // Divisória vertical central entre colunas de assinaturas
    const midSig = sigX0 + sigColW;
    doc.moveTo(midSig, ySig1Ln - 1).lineTo(midSig, ySig2Lab + 7)
       .lineWidth(0.4).stroke('#cbd5e1').lineWidth(1);

    [
        ['Assinatura do(a) Professor(a)', 0, ySig1Lab, ySig1Ln],
        ['Assinatura do(a) Aluno(a)',     1, ySig1Lab, ySig1Ln],
        ['Ass. Pai/Mãe ou Responsável',   0, ySig2Lab, ySig2Ln],
        ['Ass. de Testemunha',            1, ySig2Lab, ySig2Ln],
    ].forEach(([lbl, col, yLab, yLn]) => {
        const sx = sigX0 + col * sigColW;
        // Linha de assinatura (mais proeminente)
        doc.moveTo(sx + sigPad, yLn).lineTo(sx + sigColW - sigPad, yLn)
           .lineWidth(1.0).stroke('#334155').lineWidth(1);
        // Label abaixo da linha
        doc.font('Helvetica').fontSize(6.5).fillColor('#475569')
           .text(lbl, sx + sigPad, yLab, { width: sigColW - sigPad * 2, lineBreak: false });
    });

    // (Obs. movido para acima da frequência — ver bloco acima)
}

// ─── Duas vias lado a lado em paisagem ───────────────────────────────────────
function drawTermo(doc, { escola, aluno, ocorrencia, cidadeRef, nomeProfLogado }) {
    const OUTER_M = 18;
    const COL_GAP = 14;
    const COL_W   = (PAGE_W - OUTER_M * 2 - COL_GAP) / 2;

    drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef, nomeProfLogado },
                  OUTER_M, COL_W, '1ª VIA — COLÉGIO');

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

    drawTermoCopy(doc, { escola, aluno, ocorrencia, cidadeRef, nomeProfLogado },
                  OUTER_M + COL_W + COL_GAP, COL_W, '2ª VIA — RESPONSÁVEL');
}

// ─── Monta mapa de frequência por disciplina (via RCO API) ───────────────────
async function buildFreqMap(supabaseAdmin, rcoApiService, codturma, codMatrizes, nomeAluno) {
    const matIds = Array.isArray(codMatrizes) ? codMatrizes : [codMatrizes];
    let classes;
    try {
        const r = await supabaseAdmin
            .from('rco_classes')
            .select('cod_classe, cod_periodo_avaliacao, cod_periodo_letivo, rco_disciplinas(nome_disciplina)')
            .eq('cod_turma', codturma);
        if (r.error) throw r.error;
        classes = r.data || [];
    } catch {
        // sem colunas de período — tenta sem elas
        const r2 = await supabaseAdmin
            .from('rco_classes')
            .select('cod_classe, rco_disciplinas(nome_disciplina)')
            .eq('cod_turma', codturma);
        classes = r2.data || [];
    }

    if (!classes.length) return {};

    let classPeriodMap = {};
    try {
        const { rows } = await pool.query(`SELECT valor FROM edusync_config WHERE chave = 'rco_classes_periodos'`);
        if (rows.length) classPeriodMap = JSON.parse(rows[0].valor);
    } catch {}

    const freqMap = {};
    const normalize = (d) =>
        Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.content) ? d.content : [];

    await Promise.allSettled(classes.map(async (cl) => {
        const codClasse     = cl.cod_classe;
        const nomeDisciplina = cl.rco_disciplinas?.nome_disciplina || '';
        if (!nomeDisciplina) return;

        try {
            const periodoLocal = classPeriodMap[String(codClasse)];
            const codPA = periodoLocal?.codPA ?? cl.cod_periodo_avaliacao ?? process.env.RCO_COD_PERIODO_AVALIACAO ?? 9;
            const codPL = periodoLocal?.codPL ?? cl.cod_periodo_letivo ?? process.env.RCO_COD_PERIODO_LETIVO ?? 261;

            const resp = await rcoApiService.get(
                `/classe/v3/relatorios/frequenciaAulas?codClasse=${codClasse}&codPeriodoAvaliacao=${codPA}&codPeriodoLetivo=${codPL}&page=1&perPage=200`
            );
            if (resp.status !== 200) return;

            const raw = normalize(resp.data);
            // eslint-disable-next-line eqeqeq
            let alunoFreq = raw.find(a => matIds.some(id => a.codMatrizAluno == id));

            // Tenta match por nome se não achou por nenhum dos IDs
            if (!alunoFreq && raw.length > 0 && nomeAluno) {
                const nomeNorm = nomeAluno.trim().toUpperCase();
                alunoFreq = raw.find(a => a.nome?.trim().toUpperCase() === nomeNorm);
            }

            const key = nomeDisciplina.trim().toUpperCase();
            if (!alunoFreq) {
                freqMap[key] = { nomeDisciplina, totalAulas: 0, presencas: 0, faltas: 0, percentual: null, semDados: true };
                return;
            }

            const aulaKeys  = Object.keys(alunoFreq).filter(k => /^\d+$/.test(k));
            const totalAulas = aulaKeys.filter(k => alunoFreq[k] != null).length;
            const presencas  = aulaKeys.filter(k => alunoFreq[k] === 'C').length;
            const faltas     = aulaKeys.filter(k => alunoFreq[k] && alunoFreq[k] !== 'C').length;
            const percentual = totalAulas > 0 ? Math.round((presencas / totalAulas) * 100) : null;
            freqMap[key] = { nomeDisciplina, totalAulas, presencas, faltas, percentual };
        } catch { /* ignora — frequência é best-effort */ }
    }));

    return freqMap;
}

// ─── Cache de notas por turma (5 min) ────────────────────────────────────────
const RCO_AVALI_BASE  = '/classe/v1';
const _notasCache     = new Map();  // codturma(str) → { ts, data: { matId → { DISC → [{nome,nota}] } } }
const NOTAS_CACHE_TTL = 5 * 60 * 1000;

/* Busca grades de TODOS os alunos da turma de uma só vez e armazena no cache.
   Em batch de N alunos, esse fetch ocorre apenas 1×  em vez de N×. */
async function _buildTurmaNotasCache(supabaseAdmin, rcoApiService, codturma) {
    const now = Date.now();
    const hit = _notasCache.get(String(codturma));
    if (hit && now - hit.ts < NOTAS_CACHE_TTL) return hit.data;

    let classes = [];
    try {
        const r = await supabaseAdmin.from('rco_classes')
            .select('cod_classe, rco_disciplinas(nome_disciplina)')
            .eq('cod_turma', codturma);
        if (r.error) console.warn('[NOTAS] rco_classes query error:', r.error.message);
        classes = r.error ? [] : (r.data || []);
    } catch { /* retorna vazio */ }

    let classPeriodMap = {};
    try {
        const { rows } = await pool.query(`SELECT valor FROM edusync_config WHERE chave = 'rco_classes_periodos'`);
        if (rows.length) classPeriodMap = JSON.parse(rows[0].valor);
    } catch {}

    const porAluno = {};   // { matId: { "DISCIPLINA": [{ nome, nota }] } }

    await Promise.allSettled(classes.map(async (cl) => {
        const codClasse      = cl.cod_classe;
        const nomeDisciplina = cl.rco_disciplinas?.nome_disciplina || '';
        if (!nomeDisciplina) return;
        try {
            const periodoLocal = classPeriodMap[String(codClasse)];
            const codPA = periodoLocal?.codPA ?? cl.cod_periodo_avaliacao
                          ?? process.env.RCO_COD_PERIODO_AVALIACAO ?? 9;

            /* Lista de avaliações — fallback de qtdeAvaliacao igual ao boletim */
            let avaliacoes = [];
            for (const qtde of [2, 1, 3, 4]) {
                try {
                    const r = await rcoApiService.get(
                        `${RCO_AVALI_BASE}/avaliacaoParcialClasses?codClasse=${codClasse}` +
                        `&codPeriodoAvaliacao=${codPA}&codRegraCalculo=1&qtdeAvaliacao=${qtde}&page=1&perPage=20`
                    );
                    const d = Array.isArray(r.data) ? r.data
                        : (r.data?.content ?? r.data?.data ?? []);
                    if (r.status === 200 && d.length > 0) { avaliacoes = d; break; }
                } catch { /* tenta próximo qtde */ }
            }
            if (!avaliacoes.length) {
                console.log(`[NOTAS] classe ${codClasse} (${nomeDisciplina}): sem avaliações (codPA=${codPA})`);
                return;
            }

            /* Detalhe de cada avaliação — retorna TODOS os alunos */
            const detalhes = await Promise.allSettled(avaliacoes.map(av =>
                rcoApiService.get(
                    `${RCO_AVALI_BASE}/avaliacaoParcialClasses/${av.codAvaliacaoParcialClasse}?listas=alunos`
                )
            ));
            const discKey = nomeDisciplina.trim().toUpperCase();
            avaliacoes.forEach((av, i) => {
                const det = detalhes[i];
                const nomAv = (av.descrAvaliacaoParcial ?? av.nomeAvaliacao ?? `AV${i + 1}`)
                    .replace(/\n\s*/g, ' ').trim();
                if (det.status !== 'fulfilled' || det.value?.status !== 200) return;

                (det.value.data?.alunos ?? []).forEach(aln => {
                    const matId   = String(aln.codMatrizAluno);
                    const nomeKey = (aln.nome || '').toUpperCase().trim();
                    const entrada = { nome: nomAv, nota: aln.notaDecimal ?? aln.nota ?? null };

                    /* Indexa por codMatrizAluno */
                    if (!porAluno[matId])          porAluno[matId] = {};
                    if (!porAluno[matId][discKey]) porAluno[matId][discKey] = [];
                    porAluno[matId][discKey].push(entrada);

                    /* Indexa também por nome normalizado (fallback para ID-mismatch entre classes) */
                    if (nomeKey) {
                        const nk = `nome:${nomeKey}`;
                        if (!porAluno[nk])          porAluno[nk] = {};
                        if (!porAluno[nk][discKey]) porAluno[nk][discKey] = [];
                        /* Evita duplicar se já indexado por mesmo matId */
                        if (!porAluno[nk][discKey].some(e => e.nome === entrada.nome))
                            porAluno[nk][discKey].push(entrada);
                    }
                });
            });
        } catch { /* best-effort */ }
    }));

    console.log(`[NOTAS] turma ${codturma}: ${Object.keys(porAluno).filter(k=>!k.startsWith('nome:')).length} aluno(s) com notas no cache`);
    _notasCache.set(String(codturma), { ts: now, data: porAluno });
    return porAluno;
}

/* Retorna o mapa de notas para UM aluno específico: { "DISCIPLINA": [{nome,nota}] }
   Tenta primeiro pelo codMatrizAluno; se vazio, tenta pelo nome normalizado
   (o RCO atribui IDs diferentes por classe, então o ID pode divergir do sync). */
async function buildNotasMap(supabaseAdmin, rcoApiService, codturma, codMatrizes, nomeAluno) {
    const turmaData = await _buildTurmaNotasCache(supabaseAdmin, rcoApiService, codturma);
    const ids = Array.isArray(codMatrizes) ? codMatrizes : [codMatrizes];

    /* Mescla notas de TODOS os codMatrizAluno do aluno (um por disciplina no RCO) */
    const merged = {};
    for (const id of ids) {
        const porId = turmaData[String(id)];
        if (!porId) continue;
        for (const [disc, notas] of Object.entries(porId)) {
            if (!merged[disc]) merged[disc] = [];
            for (const n of notas) {
                if (!merged[disc].some(e => e.nome === n.nome)) merged[disc].push(n);
            }
        }
    }
    if (Object.keys(merged).length > 0) return merged;

    /* Fallback por nome (IDs podem divergir entre ciclos do RCO) */
    if (nomeAluno) {
        const nk = `nome:${nomeAluno.toUpperCase().trim()}`;
        return turmaData[nk] ?? {};
    }
    return {};
}

// ─── Busca dados de um aluno ──────────────────────────────────────────────────
async function fetchAlunoData(supabaseAdmin, codMatriz, { de, ate, tipo, professor }, rcoApiService) {
    const [alunoResult, byIdResult, obsRcoResult] = await Promise.all([
        supabaseAdmin.from('alunos').select('nome, turma, numchamada, codmatrizaluno, codturma')
            .eq('codmatrizaluno', codMatriz).limit(1),
        supabaseAdmin.from('aluno_ocorrencias').select('*')
            .eq('cod_matriz_aluno', codMatriz).order('data', { ascending: true }).limit(9999),
        supabaseAdmin.from('rco_observacoes').select('*')
            .eq('cod_matriz_aluno', codMatriz).order('data_aula', { ascending: true }).limit(9999),
    ]);

    if (alunoResult.error) throw new Error(`Supabase: ${alunoResult.error.message}`);
    const aluno = (alunoResult.data || [])[0];
    if (!aluno) return null;

    /* Busca robusta: o RCO atribui codMatrizAluno POR CLASSE — o mesmo aluno
       pode ter IDs diferentes em disciplinas distintas.
       Passo 1 (paralelo):
         a) nome_aluno em aluno_ocorrencias → todos os IDs de ocorrências
         b) nome    em alunos              → todos os codMatrizAluno de disciplinas
       Passo 2 (paralelo):
         a) busca byRealId em aluno_ocorrencias pelos IDs do passo 1a
         b) busca rco_observacoes de TODAS as disciplinas pelos IDs do passo 1b
       Resultado: union deduplicada de byId + byRealId (ocorrências)
                + allObsRco (observações RCO de todas as disciplinas). */
    const byId = byIdResult.data || [];

    const [ocorrIdsRes, matIdsRes] = await Promise.all([
        aluno.nome
            ? supabaseAdmin.from('aluno_ocorrencias').select('cod_matriz_aluno').ilike('nome_aluno', aluno.nome.trim())
            : Promise.resolve({ data: [] }),
        aluno.nome
            ? supabaseAdmin.from('alunos').select('codmatrizaluno').ilike('nome', aluno.nome.trim())
            : Promise.resolve({ data: [] }),
    ]);

    const idsReais    = [...new Set((ocorrIdsRes.data || []).map(r => r.cod_matriz_aluno).filter(v => v != null))];
    const matExtras   = (matIdsRes.data || []).map(r => parseInt(r.codmatrizaluno, 10)).filter(n => !isNaN(n));
    const todosIdsMat = [...new Set([codMatriz, ...matExtras])];

    const [byRealIdRes, obsExpandRes] = await Promise.all([
        idsReais.length > 0
            ? supabaseAdmin.from('aluno_ocorrencias').select('*').in('cod_matriz_aluno', idsReais)
                .order('data', { ascending: true }).limit(9999)
            : Promise.resolve({ data: [] }),
        todosIdsMat.length > 1
            ? supabaseAdmin.from('rco_observacoes').select('*').in('cod_matriz_aluno', todosIdsMat)
                .order('data_aula', { ascending: true }).limit(9999)
            : Promise.resolve(null),
    ]);

    const byRealId  = byRealIdRes.data || [];
    const allObsRco = (obsExpandRes?.data ?? obsRcoResult.data) || [];

    if (byRealId.length !== byId.length || todosIdsMat.length > 1) {
        console.log(`[RELATORIO] "${aluno.nome}": byId=${byId.length} byRealId=${byRealId.length} (ids=${idsReais}) | obsIdsMat=${todosIdsMat} obsTotal=${allObsRco.length}`);
    }

    const seenIds = new Set();
    const ocorrenciasRawTodas = [...byId, ...byRealId]
        .filter(o => { if (seenIds.has(o.id)) return false; seenIds.add(o.id); return true; })
        .sort((a, b) => new Date(a.data) - new Date(b.data));

    /* Guarda lista COMPLETA (sem filtros) para calcular numeração de atas do ano */
    let ocorrenciasRaw = [...ocorrenciasRawTodas];
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
        /* Prefere aluno.turma (Supabase sync, sempre atualizado com seção)
           em vez do nome_turma salvo na ocorrência (pode estar desatualizado) */
        nome_turma:     aluno.turma || metaMap[o.id]?.nome_turma || '',
        disciplina:     metaMap[o.id]?.disciplina     || '',
    }));
    if (professor)
        ocorrencias = ocorrencias.filter(o =>
            o.professor_nome.toLowerCase().includes(professor.toLowerCase()));

    /* Observações RCO */
    let ocorrenciasRco = [];
    const incluirRco = !professor && (!tipo || tipo === 'atencao');
    if (incluirRco) {
        let obsRaw = allObsRco;
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

    const combinadasBase = [...ocorrencias, ...ocorrenciasRco]
        .sort((a, b) => (a.data || '').localeCompare(b.data || ''));

    // ── Numeração de atas — total do ano (sem filtros) ────────────────────────
    const anoAtual = new Date().getFullYear();
    const todasParaAta = [
        ...ocorrenciasRawTodas.map(o => ({ id: o.id,           data: o.data      || '' })),
        ...allObsRco.map(o => ({ id: `rco_${o.id}`, data: o.data_aula || '' })),
    ]
        .filter(o => !o.data || new Date(o.data).getFullYear() === anoAtual)
        .sort((a, b) => a.data.localeCompare(b.data));
    const ataNumMap = new Map(todasParaAta.map((o, idx) => [String(o.id), idx + 1]));
    const ataTotal  = todasParaAta.length;

    // ── Frequência + Notas por disciplina (best-effort via RCO API, em paralelo) ──
    let freqMap = {}, notasMap = {};
    if (rcoApiService && aluno.codturma) {
        const [freqResult, notasResult] = await Promise.allSettled([
            buildFreqMap(supabaseAdmin, rcoApiService, aluno.codturma, todosIdsMat, aluno.nome),
            buildNotasMap(supabaseAdmin, rcoApiService, aluno.codturma, todosIdsMat, aluno.nome),
        ]);
        if (freqResult.status  === 'fulfilled') freqMap  = freqResult.value;
        else console.warn('[RELATORIO-OCORR] freq:',  freqResult.reason?.message);
        if (notasResult.status === 'fulfilled') notasMap = notasResult.value;
        else console.warn('[RELATORIO-OCORR] notas:', notasResult.reason?.message);
    }

    const combinadas = combinadasBase.map(o => {
        const key = (o.disciplina || '').trim().toUpperCase();
        return {
            ...o,
            freqResumo:  key ? (freqMap[key]  ?? null) : null,
            notaResumo:  key ? (notasMap[key] ?? null) : null,
            ataNum:  ataNumMap.get(String(o.id)) ?? null,
            ataTotal,
        };
    });

    return { aluno, combinadas };
}

// ─── Trimestre a partir do mês ────────────────────────────────────────────────
// 1º TRIM: fev–abr  |  2º TRIM: mai–ago  |  3º TRIM: set–dez
// Jan é recesso/férias; cai no 1º por padrão.
function getTrimestre(date = new Date()) {
    const m = date.getMonth() + 1; // 1-12
    if (m <= 4)  return '1TRIM';
    if (m <= 8)  return '2TRIM';
    return '3TRIM';
}

// ─── Monta nome do arquivo PDF ────────────────────────────────────────────────
// Formato: termos-[PERIODO]-[DISCIPLINA]-[TRIMESTRE]-DD-MM-AAAA.pdf
// Exemplos:
//   turma "NEM EPT - 3ª Série - Manhã - C", disc "PROGRAMACAO BACK-END"
//   → termos-3C-PROGRAMACAO-BACK-END-2TRIM-07-07-2026.pdf
//   batch sem disciplina:
//   → termos-3C-2TRIM-07-07-2026.pdf
function montarNomeArquivo(turma, disciplina = '', trimestre = '') {
    const slug = (str) =>
        (str || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
            .toUpperCase()
            .replace(/[^A-Z0-9\s-]/g, '')                       // só letras, números, espaço, hífen
            .trim()
            .replace(/\s+/g, '-')                               // espaços → hífen
            .replace(/-{2,}/g, '-');                            // hifens duplos → simples

    // Usa parseTurma para extrair período compacto: "3ª C" → slug "3-C" → "3C"
    const { periodo } = parseTurma(turma);
    const periodoSlug = slug(periodo).replace(/-/g, '');        // "3C", "9C", "8A", "1A"

    const hoje = new Date();
    const dd   = String(hoje.getDate()).padStart(2, '0');
    const mm   = String(hoje.getMonth() + 1).padStart(2, '0');
    const aaaa = hoje.getFullYear();

    const discParte = disciplina  ? `-${slug(disciplina)}`  : '';
    const trimParte = trimestre   ? `-${trimestre}`         : '';
    return `termos-${periodoSlug || 'TURMA'}${discParte}${trimParte}-${dd}-${mm}-${aaaa}.pdf`;
}

// ─── Gera PDF paisagem (2 vias por página) ────────────────────────────────────
function gerarPDF(registros, escola, cidadeRef, nomeProfLogado = '') {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false });

    const chunks = [];
    doc.on('data', c => chunks.push(c));

    /* Achata registros → páginas e ordena globalmente por nome do aluno,
       depois por data da ocorrência — garante alfabético mesmo com
       múltiplas disciplinas por aluno ou múltiplos alunos no lote. */
    const paginas = [];
    for (const { aluno, combinadas } of registros) {
        for (const ocorrencia of combinadas) {
            paginas.push({ aluno, ocorrencia });
        }
    }
    paginas.sort((a, b) => {
        const nA = (a.aluno.nome || '').toUpperCase();
        const nB = (b.aluno.nome || '').toUpperCase();
        const cmp = nA.localeCompare(nB, 'pt-BR', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        // Mesmo aluno → ordena por data da ocorrência
        return (a.ocorrencia.data || '').localeCompare(b.ocorrencia.data || '');
    });

    for (const { aluno, ocorrencia } of paginas) {
        doc.addPage();
        drawTermo(doc, { escola, aluno, ocorrencia, cidadeRef, nomeProfLogado });
    }

    doc.end();
    return { doc, chunks, paginas };
}

// ─── Registra atas impressas no banco local ───────────────────────────────────
async function registrarImpressoes(paginas, cpf = '', nome = '') {
    if (!paginas || paginas.length === 0) return;
    const vals = [];
    const flat = [];
    let p = 1;
    for (const { aluno, ocorrencia } of paginas) {
        const codMatriz = aluno?.codmatrizaluno;
        const ocorrId   = String(ocorrencia?.id ?? '');
        if (!codMatriz || !ocorrId) continue;
        vals.push(`($${p++},$${p++},$${p++},$${p++},NOW(),$${p++},$${p++})`);
        flat.push(codMatriz, ocorrId, ocorrencia.ataNum ?? null, ocorrencia.ataTotal ?? null, cpf, nome);
    }
    if (vals.length === 0) return;
    await pool.query(
        `INSERT INTO ata_impressa
             (cod_matriz_aluno, ocorrencia_id, ata_num, ata_total, impressa_em, impressa_por_cpf, impressa_por_nome)
         VALUES ${vals.join(',')}
         ON CONFLICT (cod_matriz_aluno, ocorrencia_id) DO UPDATE SET
             impressa_em       = EXCLUDED.impressa_em,
             impressa_por_cpf  = EXCLUDED.impressa_por_cpf,
             impressa_por_nome = EXCLUDED.impressa_por_nome,
             ata_num           = EXCLUDED.ata_num,
             ata_total         = EXCLUDED.ata_total`,
        flat
    ).catch(e => console.warn('[ATA-IMPRESSA] Erro ao registrar:', e.message));
}

// ─── Router ──────────────────────────────────────────────────────────────────
export function createRelatorioOcorrenciasRouter({ supabaseAdmin, rcoApiService } = {}) {
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

            const dado = await fetchAlunoData(supabaseAdmin, codMatriz, req.query, rcoApiService);
            if (!dado) return res.status(404).json({ erro: 'Aluno não encontrado.' });
            if (dado.combinadas.length === 0) return res.status(204).end();

            const nomeProfLogado = req.userSession?.nome || '';
            const { doc, chunks, paginas } = gerarPDF([dado], escola, cidadeRef, nomeProfLogado);
            await new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

            /* Disciplina predominante (a que mais aparece nas ocorrências) */
            const discCounts = {};
            for (const o of dado.combinadas) {
                const d = (o.disciplina || '').trim();
                if (d) discCounts[d] = (discCounts[d] || 0) + 1;
            }
            const discPrincipal = Object.entries(discCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
            const nomeArq = montarNomeArquivo(dado.aluno.turma, discPrincipal, getTrimestre());
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArq}"`);
            res.setHeader('Cache-Control', 'no-store');
            res.send(Buffer.concat(chunks));

            registrarImpressoes(paginas, req.userSession?.cpf || '', req.userSession?.nome || '');
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

            /* Processa em lotes de 5 para não sobrecarregar o pool Supabase.
               Com 29+ alunos em parallel puro (~200 queries simultâneas) as
               queries de expansão de nome falham silenciosamente (data:null),
               fazendo a maioria retornar combinadas=[]. */
            const LOTE = 5;
            const resultados = [];
            for (let i = 0; i < ids.length; i += LOTE) {
                const loteIds = ids.slice(i, i + LOTE);
                const loteRes = await Promise.all(
                    loteIds.map(id => fetchAlunoData(supabaseAdmin, id, filtros, rcoApiService))
                );
                resultados.push(...loteRes);
            }

            /* Inclui apenas alunos com ocorrências ou observações registradas */
            const todos     = resultados.filter(r => r != null);
            const registros = todos.filter(r => r.combinadas && r.combinadas.length > 0);
            console.log(`[BATCH] ${ids.length} solicitados → ${todos.length} encontrados → ${registros.length} com registros → ${todos.length - registros.length} sem registros (omitidos)`);
            if (registros.length === 0) return res.status(204).end();

            /* Ordena alfabeticamente por nome */
            const registrosNorm = [...registros].sort(
                (a, b) => (a.aluno.nome || '').localeCompare(b.aluno.nome || '', 'pt-BR')
            );

            const nomeProfLogado = req.userSession?.nome || '';
            const { doc, chunks, paginas } = gerarPDF(registrosNorm, escola, cidadeRef, nomeProfLogado);
            await new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

            const nomeArqBatch = montarNomeArquivo(registrosNorm[0]?.aluno?.turma || '', '', getTrimestre());
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArqBatch}"`);
            res.setHeader('Cache-Control', 'no-store');
            res.send(Buffer.concat(chunks));

            registrarImpressoes(paginas, req.userSession?.cpf || '', req.userSession?.nome || '');
        } catch (e) {
            console.error('[RELATORIO-OCORRENCIAS-BATCH]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
