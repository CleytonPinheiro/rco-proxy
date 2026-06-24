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

    // VIA label com destaque
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b')
       .text(viaLabel, colX, y, { width: colW, align: 'center', lineBreak: false });
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
    // OBS
    const yObs2Ln  = BOX_END - IP;            // segunda linha de obs
    const yObs1Ln  = yObs2Ln - 14;            // primeira linha de obs (alinhada ao label)
    // SIG 2 (Pai/Resp, Testemunha): linha ACIMA do label
    const ySig2Lab = yObs1Ln - 12;            // label assinatura 2 (abaixo da linha)
    const ySig2Ln  = ySig2Lab - 8;            // linha de assinatura 2
    // SIG 1 (Prof, Aluno): linha ACIMA do label; espaço generoso para escrita
    const ySig1Lab = ySig2Ln - 44;            // label assinatura 1 (44pt = espaço entre fileiras)
    const ySig1Ln  = ySig1Lab - 8;            // linha de assinatura 1
    // Separador e data
    const ySepIn   = ySig1Ln - 38;            // separador desc/rodapé (38pt acima = espaço escrita sig1)
    const yDate    = ySepIn + 4;              // data logo abaixo do separador

    // ── Faixa de frequência (opcional, acima do separador) ───────────────────
    const freqResumo = ocorrencia.freqResumo || null;
    const FREQ_H     = freqResumo ? 26 : 0;

    // ── Área de texto da descrição ────────────────────────────────────────────
    const yTxtStart = BOX_Y + IP + 2;
    const yTxtEnd   = ySepIn - 4 - (FREQ_H > 0 ? FREQ_H + 4 : 0);
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

    // ── Faixa de frequência ───────────────────────────────────────────────────
    if (freqResumo) {
        const yF  = yTxtEnd + 2;
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

    // ── Obs. ──────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1a1d23')
       .text('Obs.: ', colX + IP, yObs1Ln, { lineBreak: false });
    doc.moveTo(colX + IP + lwObs, yObs1Ln)
       .lineTo(colX + colW - IP, yObs1Ln)
       .lineWidth(0.6).stroke('#94a3b8').lineWidth(1);
    doc.moveTo(colX + IP, yObs2Ln)
       .lineTo(colX + colW - IP, yObs2Ln)
       .lineWidth(0.6).stroke('#94a3b8').lineWidth(1);
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
async function buildFreqMap(supabaseAdmin, rcoApiService, codturma, codMatriz, nomeAluno) {
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
            let alunoFreq = raw.find(a => a.codMatrizAluno == codMatriz);

            // Tenta match por nome se não achou por ID
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

// ─── Busca dados de um aluno ──────────────────────────────────────────────────
async function fetchAlunoData(supabaseAdmin, codMatriz, { de, ate, tipo, professor }, rcoApiService) {
    const [alunoResult, ocorrenciasResult, obsRcoResult] = await Promise.all([
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

    /* Guarda lista COMPLETA (sem filtros) para calcular numeração de atas do ano */
    const ocorrenciasRawTodas = ocorrenciasResult.data || [];
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

    const combinadasBase = [...ocorrencias, ...ocorrenciasRco]
        .sort((a, b) => (a.data || '').localeCompare(b.data || ''));

    // ── Numeração de atas — total do ano (sem filtros) ────────────────────────
    const anoAtual = new Date().getFullYear();
    const todasParaAta = [
        ...ocorrenciasRawTodas.map(o => ({ id: o.id,           data: o.data      || '' })),
        ...(obsRcoResult.data  || []).map(o => ({ id: `rco_${o.id}`, data: o.data_aula || '' })),
    ]
        .filter(o => !o.data || new Date(o.data).getFullYear() === anoAtual)
        .sort((a, b) => a.data.localeCompare(b.data));
    const ataNumMap = new Map(todasParaAta.map((o, idx) => [String(o.id), idx + 1]));
    const ataTotal  = todasParaAta.length;

    // ── Frequência por disciplina (best-effort via RCO API) ───────────────────
    let freqMap = {};
    if (rcoApiService && aluno.codturma) {
        try {
            freqMap = await buildFreqMap(supabaseAdmin, rcoApiService, aluno.codturma, codMatriz, aluno.nome);
        } catch (e) {
            console.warn('[RELATORIO-OCORR] freq:', e.message);
        }
    }

    const combinadas = combinadasBase.map(o => {
        const key = (o.disciplina || '').trim().toUpperCase();
        return {
            ...o,
            freqResumo: key ? (freqMap[key] ?? null) : null,
            ataNum:  ataNumMap.get(String(o.id)) ?? null,
            ataTotal,
        };
    });

    return { aluno, combinadas };
}

// ─── Monta nome do arquivo PDF ────────────────────────────────────────────────
function montarNomeArquivo(turma) {
    // Remove acentos e caracteres especiais
    const slug = (str) =>
        (str || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
            .toUpperCase()
            .replace(/[^A-Z0-9\s-]/g, '')                       // só letras, números, espaço, hífen
            .trim()
            .replace(/\s+/g, '-')                               // espaços → hífen
            .replace(/-{2,}/g, '-');                            // hifens duplos → simples

    // turma: "TEC EM DES DE SISTEMAS - MANHÃ"  →  curso="TEC EM DES DE SISTEMAS", turno="MANHÃ"
    const partes = (turma || '').split(/\s*[-–]\s*/);
    const curso  = slug(partes[0] || 'CURSO');
    const turno  = slug(partes.slice(1).join('-') || 'TURMA');

    const hoje = new Date();
    const dd   = String(hoje.getDate()).padStart(2, '0');
    const mm   = String(hoje.getMonth() + 1).padStart(2, '0');
    const aaaa = hoje.getFullYear();

    return `termos-${curso}-${turno}-${dd}-${mm}-${aaaa}.pdf`;
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

            const nomeArq = montarNomeArquivo(dado.aluno.turma);
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

            const resultados = await Promise.all(ids.map(id => fetchAlunoData(supabaseAdmin, id, filtros, rcoApiService)));
            const registros  = resultados.filter(r => r && r.combinadas.length > 0);
            if (registros.length === 0) return res.status(204).end();

            registros.sort((a, b) => (a.aluno.nome || '').localeCompare(b.aluno.nome || '', 'pt-BR'));

            const nomeProfLogado = req.userSession?.nome || '';
            const { doc, chunks, paginas } = gerarPDF(registros, escola, cidadeRef, nomeProfLogado);
            await new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

            const nomeArqBatch = montarNomeArquivo(registros[0]?.aluno?.turma || '');
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
