import { Router }        from 'express';
import { requireModulo } from '../middleware/auth.middleware.js';
import pkg               from 'pg';
import PDFDocument       from 'pdfkit';

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });

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
    if (/m[eé]dio/i.test(n))   return 'Médio';
    if (/fund/i.test(n))        return 'Fundamental';
    if (/t[eé]cnico|tec\b/i.test(n)) return 'Médio';
    return '';
}

/* Divide "NOME CURSO - 3ª Série - Manhã" em partes pelo separador " - " */
function parseTurma(nomeTurma) {
    if (!nomeTurma) return { serie: '', periodo: '', ensino: '' };
    const pts = nomeTurma.split(/\s*[-–]\s*/).map(s => s.trim()).filter(Boolean);
    return {
        serie:   pts[0]  || nomeTurma,
        periodo: pts.length > 1 ? pts[pts.length - 1] : '',
        ensino:  inferirEnsino(nomeTurma),
    };
}

// ─── Desenha UM termo dentro do retângulo [boxX, boxY, boxW, boxH] ───────────
function drawTermo(doc, boxX, boxY, boxW, boxH, { escola, aluno, ocorrencia, cidadeRef }) {
    const M  = 18;              // margem horizontal
    const x0 = boxX + M;       // x inicial do conteúdo
    const W  = boxW - M * 2;   // largura útil
    const FS = 8.5;             // font size base
    const LH = 13;              // altura de linha

    // ── Mede labels UMA vez (Helvetica FS) ────────────────────────────────────
    doc.font('Helvetica').fontSize(FS);
    const lwEu   = doc.widthOfString('Eu, ');
    const lwL2a  = doc.widthOfString('Professor(a) da disciplina de: ');
    const lwL2b  = doc.widthOfString('  declaro que o(a)');
    const lwL3   = doc.widthOfString('aluno(a): ');
    const lwNnum = doc.widthOfString('   Nº ');
    const lwL4a  = doc.widthOfString('da série: ');
    const lwL4b  = doc.widthOfString(', turma: ');
    const lwL4c  = doc.widthOfString(', do Ensino ');

    // ── Dados da ocorrência ───────────────────────────────────────────────────
    const professor = (ocorrencia.professor_nome || '').trim();
    const disc      = (ocorrencia.disciplina     || '').trim();
    const nomeAluno = (aluno.nome                || '').trim();
    const numCham   = aluno.numchamada ? String(aluno.numchamada) : '';
    const { serie, periodo, ensino } = parseTurma(ocorrencia.nome_turma || aluno.turma || '');
    const { dd, mes, ano } = dataExtenso(ocorrencia.data);
    const cidade = cidadeRef || 'Maringá';

    // Posições Y fixas (relativas a boxY)
    const HDR_H   = 52;
    const yHdr    = boxY + 10;
    const yTitle  = yHdr + HDR_H + 7;
    const yL1     = yTitle + 14;
    const yL2     = yL1 + LH + 2;
    const yL3     = yL2 + LH + 2;
    const yL4     = yL3 + LH + 2;
    const yManif  = yL4 + LH + 2;
    const yDesc   = yManif + LH + 3;
    const BOTTOM  = 96;   // altura reservada: data + sep + 4 assinaturas + obs
    const yDescFim = boxY + boxH - BOTTOM;
    const descH   = Math.max(35, yDescFim - yDesc);
    const yDate   = yDescFim + 4;
    const ySep    = yDate + LH + 4;
    let   ySig    = ySep + 4;

    // ── Helper: texto simples ─────────────────────────────────────────────────
    function txt(str, x, y, opts) {
        doc.text(str, x, y, { lineBreak: false, ...opts });
    }

    // ── Helper: campo com sublinhado ──────────────────────────────────────────
    function field(x, y, fw, val, bold = false) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS);
        txt(val || '', x, y, { width: fw, ellipsis: true, lineBreak: false });
        doc.moveTo(x, y + LH).lineTo(x + fw, y + LH).stroke('#444');
        doc.font('Helvetica').fontSize(FS).fillColor('#000');
    }

    // ── CABEÇALHO ─────────────────────────────────────────────────────────────
    doc.lineWidth(1.5).rect(x0, yHdr, W, HDR_H).stroke('#000').lineWidth(1);

    const LSZ = 36;
    const lX  = x0 + 6;
    const lY  = yHdr + (HDR_H - LSZ) / 2;
    if (escola.logo?.startsWith('data:image')) {
        try { doc.image(escola.logo, lX, lY, { fit: [LSZ, LSZ] }); } catch {}
    } else {
        doc.rect(lX, lY, LSZ, LSZ).dash(2, { space: 2 }).stroke('#bbb').undash();
    }
    const hTX = lX + LSZ + 8;
    const hTW = W - LSZ - 20;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
       .text(escola.nome || 'Escola', hTX, yHdr + 10, { width: hTW, align: 'center', lineBreak: false });
    const ep = [escola.endereco, escola.telefone, escola.email].filter(Boolean).join('  –  ');
    if (ep) {
        doc.font('Helvetica').fontSize(6.5).fillColor('#555')
           .text(ep, hTX, yHdr + 27, { width: hTW, align: 'center', lineBreak: false });
    }
    doc.fillColor('#000');

    // ── TÍTULO ────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10)
       .text('TERMO DE OCORRÊNCIA EM SALA DE AULA', x0, yTitle, { width: W, align: 'center', lineBreak: false });

    // ── LINHA 1: Eu, [professor], ─────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).fillColor('#000').text('Eu, ', x0, yL1, { lineBreak: false });
    const fw1 = W - lwEu - 6;
    field(x0 + lwEu, yL1, fw1, professor, true);
    doc.font('Helvetica').fontSize(FS).text(',', x0 + lwEu + fw1 + 2, yL1, { lineBreak: false });

    // ── LINHA 2: Professor(a)... [disc] declaro que o(a) ─────────────────────
    doc.font('Helvetica').fontSize(FS).text('Professor(a) da disciplina de: ', x0, yL2, { lineBreak: false });
    const fw2 = Math.max(60, W - lwL2a - lwL2b);
    field(x0 + lwL2a, yL2, fw2, disc, true);
    doc.font('Helvetica').fontSize(FS).text('  declaro que o(a)', x0 + lwL2a + fw2, yL2, { lineBreak: false });

    // ── LINHA 3: aluno(a): [nome] Nº [num] ───────────────────────────────────
    doc.font('Helvetica').fontSize(FS).text('aluno(a): ', x0, yL3, { lineBreak: false });
    const numFW  = numCham ? 28 : 0;
    const nameFW = W - lwL3 - (numCham ? lwNnum + numFW : 0);
    field(x0 + lwL3, yL3, nameFW, nomeAluno, true);
    if (numCham) {
        doc.font('Helvetica').fontSize(FS).text('   Nº ', x0 + lwL3 + nameFW, yL3, { lineBreak: false });
        field(x0 + lwL3 + nameFW + lwNnum, yL3, numFW, numCham, false);
    }

    // ── LINHA 4: da série: [serie], turma: [periodo], do Ensino [ensino] ──────
    // Larguras fixas — usa ellipsis para textos longos
    const SW = 100, PW = 60, EW = 55;   // série, período/turma, ensino
    {
        let cx = x0;
        doc.font('Helvetica').fontSize(FS).text('da série: ', cx, yL4, { lineBreak: false }); cx += lwL4a;
        field(cx, yL4, SW, serie, false); cx += SW;
        doc.font('Helvetica').fontSize(FS).text(', turma: ', cx, yL4, { lineBreak: false }); cx += lwL4b;
        field(cx, yL4, PW, periodo, false); cx += PW;
        doc.font('Helvetica').fontSize(FS).text(', do Ensino ', cx, yL4, { lineBreak: false }); cx += lwL4c;
        field(cx, yL4, EW, ensino, false);
    }

    // ── "manifestou..." ───────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text('manifestou o seguinte comportamento em sala de aula:', x0, yManif, { lineBreak: false });

    // ── ÁREA DE DESCRIÇÃO ─────────────────────────────────────────────────────
    const descricao = (ocorrencia.descricao || '').trim();
    if (descricao) {
        doc.lineWidth(0.7).rect(x0, yDesc, W, descH).stroke('#555').lineWidth(1);
        doc.font('Helvetica').fontSize(8).fillColor('#000')
           .text(descricao, x0 + 4, yDesc + 4, { width: W - 8, height: descH - 8, lineGap: 1 });
    } else {
        const nL   = Math.max(3, Math.floor(descH / 14));
        const step = descH / nL;
        for (let i = 1; i <= nL; i++) {
            doc.moveTo(x0, yDesc + i * step).lineTo(x0 + W, yDesc + i * step).stroke('#ccc');
        }
    }

    // ── DATA ──────────────────────────────────────────────────────────────────
    const dateStr = `${cidade}, ${dd} de ${mes} de ${ano}.`;
    doc.font('Helvetica').fontSize(FS).fillColor('#000')
       .text(dateStr, x0, yDate, { width: W, align: 'right', lineBreak: false });

    // ── ASSINATURAS ───────────────────────────────────────────────────────────
    doc.moveTo(x0, ySep).lineTo(x0 + W, ySep).stroke('#ccc');
    const sigs = [
        'Assinatura do(a) Professor(a)',
        'Assinatura do(a) Aluno(a)',
        'Assinatura do Pai ou Responsável',
        'Assinatura de Testemunha',
    ];
    for (const sig of sigs) {
        doc.font('Helvetica').fontSize(8).fillColor('#000');
        const sw = doc.widthOfString(sig + ': ');
        txt(sig + ': ', x0, ySig);
        doc.moveTo(x0 + sw, ySig + 11).lineTo(x0 + W, ySig + 11).stroke('#444');
        ySig += 12;
    }

    // ── OBS ───────────────────────────────────────────────────────────────────
    ySig += 2;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
    const obsW = doc.widthOfString('Obs.: ');
    txt('Obs.: ', x0, ySig);
    doc.moveTo(x0 + obsW, ySig + 11).lineTo(x0 + W, ySig + 11).stroke('#bbb');
    ySig += 13;
    doc.moveTo(x0, ySig + 11).lineTo(x0 + W, ySig + 11).stroke('#bbb');
}

// ─── Busca dados de um aluno para o PDF ──────────────────────────────────────
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

// ─── Gera PDF com pdfkit ─────────────────────────────────────────────────────
function gerarPDF(registros, escola, cidadeRef) {
    /* registros: [{ aluno, combinadas }] */
    const doc  = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const pageW = 595.28;
    const pageH = 841.89;
    const halfH = pageH / 2;

    const chunks = [];
    doc.on('data', c => chunks.push(c));

    for (const { aluno, combinadas } of registros) {
        for (let i = 0; i < combinadas.length; i += 2) {
            doc.addPage();

            drawTermo(doc, 0, 0, pageW, halfH, { escola, aluno, ocorrencia: combinadas[i], cidadeRef });

            /* Linha de corte */
            doc.dash(4, { space: 3 })
               .moveTo(12, halfH).lineTo(pageW - 12, halfH).stroke('#bbb').undash();
            doc.font('Helvetica').fontSize(9).fillColor('#bbb')
               .text('✂', pageW / 2 - 5, halfH - 7, { lineBreak: false });
            doc.fillColor('#000');

            if (i + 1 < combinadas.length) {
                drawTermo(doc, 0, halfH, pageW, halfH, { escola, aluno, ocorrencia: combinadas[i + 1], cidadeRef });
            }
        }
    }

    doc.end();
    return { doc, chunks };
}

// ─── Router ──────────────────────────────────────────────────────────────────
export function createRelatorioOcorrenciasRouter({ supabaseAdmin } = {}) {
    const router = Router();

    /* ── Lista de professores (filtro no front) ── */
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
            const [configResult] = await Promise.all([
                pool.query(`SELECT chave, valor FROM edusync_config WHERE chave = ANY($1)`,
                    [['escola_nome_oficial','escola_endereco','escola_telefone','escola_email','escola_logo_base64','escola_cidade_ref']])
            ]);
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
            const configResult = await pool.query(`SELECT chave, valor FROM edusync_config WHERE chave = ANY($1)`,
                [['escola_nome_oficial','escola_endereco','escola_telefone','escola_email','escola_logo_base64','escola_cidade_ref']]);
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

            /* Ordena por nome do aluno para o PDF ser previsível */
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
