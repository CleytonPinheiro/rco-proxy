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
    const d   = new Date(isoStr + (isoStr.includes('T') ? '' : 'T12:00:00'));
    return {
        dd:  String(d.getDate()).padStart(2, '0'),
        mes: MESES_PT[d.getMonth()],
        ano: String(d.getFullYear()),
    };
}

function inferirEnsino(nomeTurma) {
    if (!nomeTurma) return '';
    const n = nomeTurma.trim();
    if (/médio/i.test(n))  return 'Médio';
    if (/fund/i.test(n))   return 'Fundamental';
    return '';
}

// ─── Desenha UM termo de ocorrência dentro do retângulo [x, y, w, h] ──────────
function drawTermo(doc, boxX, boxY, boxW, boxH, { escola, aluno, ocorrencia, cidadeRef }) {
    const px = boxX + 18;   // padding horizontal
    const pw = boxW - 36;   // largura útil
    let   cy = boxY + 10;   // cursor vertical

    // ── Linha pontilhada de corte (se não for o primeiro termo da folha) ──────
    // (chamador decide — não desenhamos aqui)

    // ── Cabeçalho em caixa ────────────────────────────────────────────────────
    const hdrH = 50;
    doc.rect(px, cy, pw, hdrH).stroke('#000');

    // Logo placeholder
    const logoSz = 36;
    const logoX  = px + 6;
    const logoY  = cy + (hdrH - logoSz) / 2;
    if (escola.logo && escola.logo.startsWith('data:image')) {
        try {
            doc.image(escola.logo, logoX, logoY, { width: logoSz, height: logoSz, fit: [logoSz, logoSz] });
        } catch { /* ignora logo inválido */ }
    } else {
        doc.rect(logoX, logoY, logoSz, logoSz).dash(2, { space: 2 }).stroke('#aaa').undash();
    }

    // Nome e endereço da escola (centralizados na área à direita do logo)
    const txtX  = logoX + logoSz + 6;
    const txtW  = pw - logoSz - 18;
    const nomeTy = cy + 10;
    doc.font('Helvetica-Bold').fontSize(9)
       .text(escola.nome || 'Escola', txtX, nomeTy, { width: txtW, align: 'center' });

    const endParts = [escola.endereco, escola.telefone, escola.email].filter(Boolean).join('  |  ');
    if (endParts) {
        doc.font('Helvetica').fontSize(6.5).fillColor('#333')
           .text(endParts, txtX, nomeTy + 13, { width: txtW, align: 'center' });
    }
    doc.fillColor('#000');

    cy += hdrH + 7;

    // ── Título ────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10)
       .text('TERMO DE OCORRÊNCIA EM SALA DE AULA', px, cy, { width: pw, align: 'center' });
    cy += 16;

    // ── Helper: linha subescrita com label + campo preenchido + continuação ───
    const lineH = 13;
    const fieldColor = '#000';

    function fieldLine(parts, y) {
        // parts: [{label, value, fieldWidth, flex}] onde flex=true estica o campo
        let cx = px;
        parts.forEach(p => {
            if (p.label) {
                doc.font('Helvetica').fontSize(8.5).fillColor('#000')
                   .text(p.label, cx, y, { lineBreak: false });
                cx += doc.widthOfString(p.label);
            }
            if (p.value !== undefined) {
                const fw = p.fieldWidth || 80;
                doc.font('Helvetica-Bold').fontSize(8.5).fillColor(fieldColor)
                   .text(p.value || '', cx, y, { width: fw, lineBreak: false });
                doc.moveTo(cx, y + lineH - 1).lineTo(cx + fw, y + lineH - 1).stroke('#333');
                cx += fw + 2;
            }
        });
    }

    // Linha 1: "Eu, _[professor]_,"
    const professor = ocorrencia.professor_nome || '';
    const pfW = Math.min(Math.max(120, doc.widthOfString(professor) + 10), pw - 40);
    fieldLine([{ label: 'Eu, ' }, { value: professor, fieldWidth: pfW }, { label: ',' }], cy);
    cy += lineH + 3;

    // Linha 2: "Professor(a) da disciplina de: _[disc]_ declaro que o(a)"
    const disciplina = ocorrencia.disciplina || '';
    const dscW = Math.min(Math.max(80, doc.widthOfString(disciplina) + 10), pw - 200);
    fieldLine([
        { label: 'Professor(a) da disciplina de: ' },
        { value: disciplina, fieldWidth: dscW },
        { label: '  declaro que o(a)' },
    ], cy);
    cy += lineH + 3;

    // Linha 3: "aluno(a): _[nome]_  Nº _[num]_"
    const nomeAluno = aluno.nome || '';
    const nomeW = Math.min(Math.max(120, doc.widthOfString(nomeAluno) + 10), pw - 100);
    const numParts = [{ label: 'aluno(a): ' }, { value: nomeAluno, fieldWidth: nomeW }];
    if (aluno.numchamada) {
        numParts.push({ label: '   Nº ' });
        numParts.push({ value: String(aluno.numchamada), fieldWidth: 24 });
    }
    fieldLine(numParts, cy);
    cy += lineH + 3;

    // Linha 4: "da série: _[serie]_, turma: _[turma]_, do Ensino _[ensino]_"
    const nomeTurma = ocorrencia.nome_turma || aluno.turma || '';
    const partes    = nomeTurma.trim().split(/\s+/);
    const serie     = partes.length > 1 ? partes.slice(0, -1).join(' ') : nomeTurma;
    const turma     = nomeTurma;
    const ensino    = inferirEnsino(nomeTurma);
    fieldLine([
        { label: 'da série: ' },  { value: serie,  fieldWidth: 55 },
        { label: ', turma: ' },   { value: turma,  fieldWidth: 50 },
        { label: ', do Ensino ' },{ value: ensino, fieldWidth: 60 },
    ], cy);
    cy += lineH + 3;

    // Frase fixa
    doc.font('Helvetica').fontSize(8.5).text('manifestou o seguinte comportamento em sala de aula:', px, cy);
    cy += lineH + 2;

    // ── Área de descrição ─────────────────────────────────────────────────────
    const descricao  = (ocorrencia.descricao || '').trim();
    const descEndY   = boxY + boxH - 90; // reserva espaço para data + assinaturas + obs
    const descH      = Math.max(50, descEndY - cy);

    if (descricao) {
        doc.rect(px, cy, pw, descH).stroke('#555');
        doc.font('Helvetica').fontSize(8).text(descricao, px + 4, cy + 4, {
            width: pw - 8, height: descH - 8, lineGap: 2,
        });
    } else {
        // Linhas em branco
        const nLinhas  = Math.floor(descH / 14);
        const lineStep = descH / Math.max(nLinhas, 1);
        for (let i = 1; i <= nLinhas; i++) {
            doc.moveTo(px, cy + i * lineStep).lineTo(px + pw, cy + i * lineStep).stroke('#bbb');
        }
    }
    cy = descEndY + 3;

    // ── Data ──────────────────────────────────────────────────────────────────
    const { dd, mes, ano } = dataExtenso(ocorrencia.data);
    const cidade = cidadeRef || 'Maringá';
    const dataStr = `${cidade}, ${dd} de ${mes} de ${ano}.`;
    doc.font('Helvetica').fontSize(8.5).text(dataStr, px, cy, { width: pw, align: 'right' });
    cy += lineH + 4;

    // ── Assinaturas ───────────────────────────────────────────────────────────
    const assinaturas = [
        'Assinatura do(a) Professor(a)',
        'Assinatura do(a) Aluno(a)',
        'Assinatura do Pai ou Responsável',
        'Assinatura de Testemunha',
    ];
    doc.moveTo(px, cy).lineTo(px + pw, cy).stroke('#ccc');
    cy += 4;
    assinaturas.forEach(label => {
        doc.font('Helvetica').fontSize(8).text(label + ':', px, cy, { lineBreak: false });
        const lw = doc.widthOfString(label + ': ') + 4;
        doc.moveTo(px + lw, cy + lineH - 1).lineTo(px + pw, cy + lineH - 1).stroke('#333');
        cy += lineH + 2;
    });

    // ── Obs ───────────────────────────────────────────────────────────────────
    cy += 2;
    doc.font('Helvetica-Bold').fontSize(8).text('Obs.:', px, cy, { lineBreak: false });
    const obsLw = doc.widthOfString('Obs.: ') + 2;
    doc.moveTo(px + obsLw, cy + lineH - 1).lineTo(px + pw, cy + lineH - 1).stroke('#aaa');
    cy += lineH + 2;
    doc.moveTo(px, cy + lineH - 1).lineTo(px + pw, cy + lineH - 1).stroke('#aaa');
}

// ─── Router ────────────────────────────────────────────────────────────────────
export function createRelatorioOcorrenciasRouter({ supabaseAdmin } = {}) {
    const router = Router();

    /* ── Lista de professores distintos (filtro no front) ── */
    router.get('/relatorio-ocorrencias/:codMatrizAluno/professores', requireModulo('ficha-aluno'), async (req, res) => {
        const codMatriz = parseInt(req.params.codMatrizAluno, 10);
        if (isNaN(codMatriz)) return res.status(400).json({ erro: 'codMatrizAluno inválido.' });
        try {
            const { data: ocorrencias } = await supabaseAdmin
                .from('aluno_ocorrencias').select('id').eq('cod_matriz_aluno', codMatriz);
            if (!ocorrencias || ocorrencias.length === 0) return res.json([]);
            const ids  = ocorrencias.map(o => o.id);
            const ph   = ids.map((_, i) => `$${i + 1}`).join(',');
            const { rows } = await pool.query(
                `SELECT DISTINCT professor_nome FROM ocorrencia_meta
                 WHERE id_ocorrencia IN (${ph}) AND professor_nome <> '' ORDER BY professor_nome`, ids
            );
            res.json(rows.map(r => r.professor_nome));
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* ── Gera PDF de termos (pdfkit, sem Puppeteer) ── */
    router.get('/relatorio-ocorrencias/:codMatrizAluno', requireModulo('ficha-aluno'), async (req, res) => {
        const codMatriz = parseInt(req.params.codMatrizAluno, 10);
        if (isNaN(codMatriz)) return res.status(400).json({ erro: 'codMatrizAluno inválido.' });

        const { de, ate, tipo, professor } = req.query;

        try {
            const [alunoResult, ocorrenciasResult, obsRcoResult, configResult] = await Promise.all([
                supabaseAdmin.from('alunos')
                    .select('nome, turma, numchamada, codmatrizaluno')
                    .eq('codmatrizaluno', codMatriz).limit(1),

                supabaseAdmin.from('aluno_ocorrencias').select('*')
                    .eq('cod_matriz_aluno', codMatriz).order('data', { ascending: true }),

                supabaseAdmin.from('rco_observacoes').select('*')
                    .eq('cod_matriz_aluno', codMatriz).order('data_aula', { ascending: true }),

                pool.query(
                    `SELECT chave, valor FROM edusync_config WHERE chave = ANY($1)`,
                    [['escola_nome_oficial','escola_endereco','escola_telefone','escola_email','escola_logo_base64','escola_cidade_ref']]
                ),
            ]);

            if (alunoResult.error) throw new Error(`Supabase alunos: ${alunoResult.error.message}`);
            const aluno = (alunoResult.data || [])[0];
            if (!aluno) return res.status(404).json({ erro: 'Aluno não encontrado.' });

            const cfgMap = {};
            for (const r of (configResult.rows || [])) cfgMap[r.chave] = r.valor;
            const escola = {
                nome:     cfgMap['escola_nome_oficial'] || 'Escola',
                endereco: cfgMap['escola_endereco']     || '',
                telefone: cfgMap['escola_telefone']     || '',
                email:    cfgMap['escola_email']        || '',
                logo:     cfgMap['escola_logo_base64']  || '',
            };
            const cidadeRef = cfgMap['escola_cidade_ref'] || 'Maringá';

            /* ── Ocorrências de comportamento ── */
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
                for (const row of metaRows) metaMap[row.id_ocorrencia] = row;
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

            /* ── Observações RCO ── */
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

            const combinadas = [...ocorrencias, ...ocorrenciasRco];
            if (combinadas.length === 0) return res.status(204).end();

            combinadas.sort((a, b) => (a.data || '').localeCompare(b.data || ''));

            /* ── Gera PDF com pdfkit ── */
            const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));

            const pageW = 595.28;
            const pageH = 841.89;
            const halfH = pageH / 2;

            for (let i = 0; i < combinadas.length; i += 2) {
                doc.addPage();

                // Termo superior
                drawTermo(doc, 0, 0, pageW, halfH, {
                    escola, aluno, ocorrencia: combinadas[i], cidadeRef,
                });

                // Linha de corte separadora
                doc.dash(4, { space: 3 })
                   .moveTo(10, halfH).lineTo(pageW - 10, halfH)
                   .stroke('#bbb').undash();
                doc.font('Helvetica').fontSize(9).fillColor('#bbb')
                   .text('✂', pageW / 2 - 5, halfH - 6, { lineBreak: false });
                doc.fillColor('#000');

                // Termo inferior (se existir)
                if (i + 1 < combinadas.length) {
                    drawTermo(doc, 0, halfH, pageW, halfH, {
                        escola, aluno, ocorrencia: combinadas[i + 1], cidadeRef,
                    });
                }
            }

            doc.end();

            await new Promise((resolve, reject) => {
                doc.on('end', resolve);
                doc.on('error', reject);
            });

            const pdfBuffer = Buffer.concat(chunks);
            const nomeArquivo = `termos-${(aluno.nome || 'aluno').replace(/\s+/g, '-').toLowerCase()}.pdf`;

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
            res.setHeader('Cache-Control', 'no-store');
            res.send(pdfBuffer);

        } catch (e) {
            console.error('[RELATORIO-OCORRENCIAS] Erro:', e.message, e.stack?.split('\n')[1] || '');
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
