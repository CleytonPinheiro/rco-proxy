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

// ─── Desenha UM termo por página (paisagem) ───────────────────────────────────
function drawTermo(doc, { escola, aluno, ocorrencia, cidadeRef }) {
    const M  = 28;              // margem horizontal
    const MT = 18;              // margem vertical topo
    const x0 = M;
    const W  = PAGE_W - M * 2; // ≈ 785 pt
    const FS = 9;               // font size base (paisagem tem espaço)
    const LH = 14;              // altura de linha

    // ── Mede labels com fonte definida ──────────────────────────────────────
    doc.font('Helvetica').fontSize(FS);
    const lwEu   = doc.widthOfString('Eu, ');
    const lwL2a  = doc.widthOfString('Professor(a) da disciplina de: ');
    const lwL2b  = doc.widthOfString('  declaro que o(a)');
    const lwL3   = doc.widthOfString('aluno(a): ');
    const lwNnum = doc.widthOfString('   Nº ');
    const lwL4a  = doc.widthOfString('da série: ');
    const lwL4b  = doc.widthOfString(', turma: ');
    const lwL4c  = doc.widthOfString(', do Ensino ');

    // ── Dados ────────────────────────────────────────────────────────────────
    const professor = (ocorrencia.professor_nome || '').trim();
    const disc      = (ocorrencia.disciplina     || '').trim();
    const nomeAluno = (aluno.nome                || '').trim();
    const numCham   = aluno.numchamada ? String(aluno.numchamada) : '';
    const { serie, periodo, ensino } = parseTurma(ocorrencia.nome_turma || aluno.turma || '');
    const { dd, mes, ano } = dataExtenso(ocorrencia.data);

    // ── Posições Y fixas ────────────────────────────────────────────────────
    const HDR_H   = 64;
    const yHdr    = MT;
    const yTitle  = yHdr + HDR_H + 8;
    const yL1     = yTitle + 15;
    const yL2     = yL1 + LH + 3;
    const yL3     = yL2 + LH + 3;
    const yL4     = yL3 + LH + 3;
    const yManif  = yL4 + LH + 3;
    const yDesc   = yManif + LH + 4;
    const BOTTOM  = 105;
    const yDescFim = PAGE_H - BOTTOM;
    const descH   = Math.max(40, yDescFim - yDesc);
    const yDate   = yDescFim + 5;
    const ySep    = yDate + LH + 5;
    let   ySig    = ySep + 4;

    // ── Helpers ──────────────────────────────────────────────────────────────
    function txt(str, x, y, opts) {
        doc.text(str, x, y, { lineBreak: false, ...opts });
    }

    function field(x, y, fw, val, bold = false) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS);
        txt(val || '', x, y, { width: fw, ellipsis: true, lineBreak: false });
        doc.moveTo(x, y + LH + 1).lineTo(x + fw, y + LH + 1).stroke('#555');
        doc.font('Helvetica').fontSize(FS).fillColor('#000');
    }

    // ── CABEÇALHO ────────────────────────────────────────────────────────────
    // Caixa externa com sombra suave (bordas)
    doc.lineWidth(1.2).rect(x0, yHdr, W, HDR_H).stroke('#b0b8c4').lineWidth(1);

    // Fundo cinza-claro levíssimo
    doc.rect(x0, yHdr, W, HDR_H).fill('#f8f9fb');
    doc.rect(x0, yHdr, W, HDR_H).stroke('#b0b8c4');
    doc.fillColor('#000');

    // Logo circular
    const LSZ = 48;
    const R   = LSZ / 2;
    const lCX = x0 + 14 + R;
    const lCY = yHdr + HDR_H / 2;
    drawLogo(doc, lCX, lCY, R, escola.logo, escola.nome);

    // Divisória vertical após logo
    const divX = x0 + 14 + LSZ + 12;
    doc.moveTo(divX, yHdr + 8).lineTo(divX, yHdr + HDR_H - 8).stroke('#d0d5de');

    // Textos da escola
    const hTX = divX + 14;
    const hTW = W - (hTX - x0) - 10;

    // Linha 1: estado/secretaria (pequena, discreta)
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280')
       .text('ESTADO DO PARANÁ  ·  SECRETARIA DE ESTADO DA EDUCAÇÃO', hTX, yHdr + 10, {
           width: hTW, align: 'left', lineBreak: false,
       });

    // Linha 2: nome da escola (destaque)
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a202c')
       .text(escola.nome || 'Escola', hTX, yHdr + 21, { width: hTW, align: 'left', lineBreak: false });

    // Linha 3: endereço e contatos
    const ep = [escola.endereco, escola.telefone, escola.email].filter(Boolean).join('   ·   ');
    if (ep) {
        doc.font('Helvetica').fontSize(7.5).fillColor('#4b5563')
           .text(ep, hTX, yHdr + 37, { width: hTW, align: 'left', lineBreak: false });
    }
    doc.fillColor('#000');

    // ── TÍTULO ───────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(11)
       .text('TERMO DE OCORRÊNCIA EM SALA DE AULA', x0, yTitle, { width: W, align: 'center', lineBreak: false });
    // Linha decorativa sob o título
    doc.moveTo(x0 + W * 0.2, yTitle + 14).lineTo(x0 + W * 0.8, yTitle + 14)
       .lineWidth(0.5).stroke('#c0c7d2').lineWidth(1);

    // ── LINHA 1: Eu, [professor], ────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).fillColor('#000').text('Eu, ', x0, yL1, { lineBreak: false });
    const fw1 = W - lwEu - 6;
    field(x0 + lwEu, yL1, fw1, professor, true);
    doc.font('Helvetica').fontSize(FS).text(',', x0 + lwEu + fw1 + 2, yL1, { lineBreak: false });

    // ── LINHA 2: Professor(a) da disciplina de: [disc] declaro que o(a) ──────
    doc.font('Helvetica').fontSize(FS).text('Professor(a) da disciplina de: ', x0, yL2, { lineBreak: false });
    const fw2 = Math.max(80, W - lwL2a - lwL2b);
    field(x0 + lwL2a, yL2, fw2, disc, true);
    doc.font('Helvetica').fontSize(FS).text('  declaro que o(a)', x0 + lwL2a + fw2, yL2, { lineBreak: false });

    // ── LINHA 3: aluno(a): [nome] Nº [num] ───────────────────────────────────
    doc.font('Helvetica').fontSize(FS).text('aluno(a): ', x0, yL3, { lineBreak: false });
    const numFW  = numCham ? 30 : 0;
    const nameFW = W - lwL3 - (numCham ? lwNnum + numFW : 0);
    field(x0 + lwL3, yL3, nameFW, nomeAluno, true);
    if (numCham) {
        doc.font('Helvetica').fontSize(FS).text('   Nº ', x0 + lwL3 + nameFW, yL3, { lineBreak: false });
        field(x0 + lwL3 + nameFW + lwNnum, yL3, numFW, numCham, false);
    }

    // ── LINHA 4: da série: [serie], turma: [periodo], do Ensino [ensino] ──────
    // Em paisagem temos ~785pt, campos bem mais largos
    const SW = 160, PW = 90, EW = 70;
    {
        let cx = x0;
        doc.font('Helvetica').fontSize(FS).text('da série: ', cx, yL4, { lineBreak: false }); cx += lwL4a;
        doc.font('Helvetica-Bold').fontSize(FS);
        txt(serie, cx, yL4, { width: SW, ellipsis: true, lineBreak: false });
        doc.moveTo(cx, yL4 + LH + 1).lineTo(cx + SW, yL4 + LH + 1).stroke('#555');
        cx += SW;

        doc.font('Helvetica').fontSize(FS).text(', turma: ', cx, yL4, { lineBreak: false }); cx += lwL4b;
        doc.font('Helvetica-Bold').fontSize(FS);
        txt(periodo, cx, yL4, { width: PW, ellipsis: true, lineBreak: false });
        doc.moveTo(cx, yL4 + LH + 1).lineTo(cx + PW, yL4 + LH + 1).stroke('#555');
        cx += PW;

        doc.font('Helvetica').fontSize(FS).text(', do Ensino ', cx, yL4, { lineBreak: false }); cx += lwL4c;
        doc.font('Helvetica-Bold').fontSize(FS);
        txt(ensino, cx, yL4, { width: EW, ellipsis: true, lineBreak: false });
        doc.moveTo(cx, yL4 + LH + 1).lineTo(cx + EW, yL4 + LH + 1).stroke('#555');
    }
    doc.fillColor('#000');

    // ── "manifestou..." ───────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text('manifestou o seguinte comportamento em sala de aula:', x0, yManif, { lineBreak: false });

    // ── ÁREA DE DESCRIÇÃO ─────────────────────────────────────────────────────
    const descricao = (ocorrencia.descricao || '').trim();
    // Caixa com fundo levíssimo
    doc.rect(x0, yDesc, W, descH).fill('#fafbfc');
    doc.rect(x0, yDesc, W, descH).lineWidth(0.8).stroke('#b8c0cc').lineWidth(1);
    doc.fillColor('#000');

    if (descricao) {
        doc.font('Helvetica').fontSize(9).fillColor('#111')
           .text(descricao, x0 + 8, yDesc + 7, { width: W - 16, height: descH - 14, lineGap: 2 });
    } else {
        const nL   = Math.max(4, Math.floor(descH / 16));
        const step = descH / nL;
        for (let i = 1; i < nL; i++) {
            doc.moveTo(x0 + 8, yDesc + i * step)
               .lineTo(x0 + W - 8, yDesc + i * step)
               .stroke('#dce1e9');
        }
    }

    // ── DATA ──────────────────────────────────────────────────────────────────
    const dateStr = `${cidadeRef || 'Maringá'}, ${dd} de ${mes} de ${ano}.`;
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text(dateStr, x0, yDate, { width: W, align: 'right', lineBreak: false });

    // ── ASSINATURAS (4 colunas horizontais em paisagem) ───────────────────────
    doc.moveTo(x0, ySep).lineTo(x0 + W, ySep).lineWidth(0.6).stroke('#c0c7d2').lineWidth(1);
    ySig = ySep + 8;

    const sigs = [
        'Assinatura do(a) Professor(a)',
        'Assinatura do(a) Aluno(a)',
        'Assinatura do Pai ou Responsável',
        'Assinatura de Testemunha',
    ];

    // Distribui as 4 assinaturas em linha horizontal
    const colW   = W / 4;
    const sigLH  = 12;
    sigs.forEach((sig, i) => {
        const cx = x0 + i * colW;
        doc.font('Helvetica').fontSize(7.5).fillColor('#555')
           .text(sig, cx + 4, ySig, { lineBreak: false });
        doc.moveTo(cx + 4, ySig + sigLH + 2)
           .lineTo(cx + colW - 8, ySig + sigLH + 2)
           .stroke('#444');
    });

    // Obs na linha abaixo, largura total
    const yObs = ySig + sigLH + 10;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
    const obsW = doc.widthOfString('Obs.: ');
    doc.text('Obs.: ', x0, yObs, { lineBreak: false });
    doc.moveTo(x0 + obsW, yObs + 11).lineTo(x0 + W, yObs + 11).stroke('#bbb');
    const yObs2 = yObs + 14;
    doc.moveTo(x0, yObs2 + 11).lineTo(x0 + W, yObs2 + 11).stroke('#bbb');
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

// ─── Gera PDF paisagem (1 termo = 1 página) ───────────────────────────────────
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
