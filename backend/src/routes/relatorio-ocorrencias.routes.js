import { Router }        from 'express';
import path              from 'path';
import fs                from 'fs';
import { fileURLToPath } from 'url';
import { requireModulo } from '../middleware/auth.middleware.js';
import pkg               from 'pg';
import { getBrowser }    from '../../auth-puppeteer.js';

const { Pool }   = pkg;
const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE   = path.join(__dirname, '../templates/termo-ocorrencia.html');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MESES_PT = [
    'janeiro','fevereiro','março','abril','maio','junho',
    'julho','agosto','setembro','outubro','novembro','dezembro',
];

function dataExtenso(isoStr) {
    const d = new Date(isoStr + (isoStr.includes('T') ? '' : 'T12:00:00'));
    const dd  = String(d.getDate()).padStart(2, '0');
    const mes = MESES_PT[d.getMonth()];
    const ano = d.getFullYear();
    return `${dd} de ${mes} de ${ano}`;
}

function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function deriveSerieFromTurma(nomeTurma) {
    if (!nomeTurma) return '';
    const parts = nomeTurma.trim().split(/\s+/);
    if (parts.length <= 1) return nomeTurma;
    return parts.slice(0, -1).join(' ');
}

function renderOcorrencia({ escola, aluno, ocorrencia, cidadeRef }) {
    const logoHtml = escola.logo
        ? `<img src="${escola.logo}" alt="Logo da escola" />`
        : `<div class="cabecalho-logo-placeholder">LOGO<br>ESCOLA</div>`;

    const tipoLabel = { grave: 'Grave', atencao: 'Atenção', positivo: 'Positivo' }[ocorrencia.tipo] || ocorrencia.tipo;
    const tipoClass = `tipo-${ocorrencia.tipo || 'atencao'}`;

    const dataDaOcorrencia = ocorrencia.data ? dataExtenso(ocorrencia.data) : '___/___/______';
    const serie = deriveSerieFromTurma(ocorrencia.nome_turma || aluno.turma);
    const turmaDisplay = ocorrencia.nome_turma || aluno.turma || '';
    const cidade = cidadeRef || 'Maringá';
    const descricao = ocorrencia.descricao || '';
    const categoria = ocorrencia.categoria_label || ocorrencia.categoria || '';
    const disciplina = ocorrencia.disciplina || '';

    const enderecoHtml = [escola.endereco, escola.telefone, escola.email]
        .filter(Boolean).join(' &nbsp;|&nbsp; ');

    return `
<div class="termo-wrapper">
  <div class="cabecalho">
    <div class="cabecalho-logo">${logoHtml}</div>
    <div class="cabecalho-texto">
      <div class="cabecalho-orgao">Estado do Paraná — Secretaria de Estado da Educação e do Esporte</div>
      <div class="cabecalho-escola">${esc(escola.nome || 'Nome da Escola')}</div>
      ${enderecoHtml ? `<div class="cabecalho-endereco">${enderecoHtml}</div>` : ''}
    </div>
  </div>

  <div class="titulo-bloco">
    <div class="titulo-principal">Termo de Ocorrência em Sala de Aula</div>
  </div>

  <div class="corpo">

    <div class="campo-linha">
      <span class="campo-label">Professor(a):</span>
      <span class="campo-valor">${esc(ocorrencia.professor_nome)}</span>
      ${disciplina ? `<span class="campo-sep">Disciplina:</span><span class="campo-valor" style="max-width:110px">${esc(disciplina)}</span>` : ''}
    </div>

    <div class="campo-linha">
      <span class="campo-label">Turma:</span>
      <span class="campo-valor" style="max-width:110px">${esc(turmaDisplay)}</span>
      <span class="campo-sep">Série:</span>
      <span class="campo-valor" style="max-width:90px">${esc(serie)}</span>
    </div>

    <div class="campo-linha">
      <span class="campo-label">Aluno(a):</span>
      <span class="campo-valor">${esc(aluno.nome)}</span>
      <span class="campo-sep">Nº:</span>
      <span class="campo-valor" style="max-width:40px">${esc(aluno.numchamada || '')}</span>
    </div>

    <div class="campo-linha">
      <span class="campo-label">Tipo de Ocorrência:</span>
      <span class="campo-valor">
        ${esc(categoria)}
        <span class="tipo-badge ${tipoClass}">${esc(tipoLabel)}</span>
      </span>
      <span class="campo-sep">Data:</span>
      <span class="campo-valor" style="max-width:140px">${esc(dataDaOcorrencia)}</span>
    </div>

    <div style="margin-bottom:6px;flex:1;display:flex;flex-direction:column">
      <div class="desc-label">Descrição do fato ocorrido:</div>
      <div class="desc-area">${esc(descricao)}</div>
    </div>

    <div class="cidade-data">${esc(cidade)}, ${dataExtenso(ocorrencia.data || new Date().toISOString())}</div>

    <div class="assinaturas">
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Professor(a)</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Aluno(a)</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Pai / Responsável</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Testemunha</div>
      </div>
    </div>

    <div class="obs-bloco">
      <div class="obs-label">Obs.:</div>
      <div class="obs-linha"></div>
    </div>

  </div>
</div>`;
}

export function createRelatorioOcorrenciasRouter({ supabaseAdmin } = {}) {
    const router = Router();

    // ── Lista de professores distintos de um aluno (para o filtro no frontend) ──
    router.get('/relatorio-ocorrencias/:codMatrizAluno/professores', requireModulo('ficha-aluno'), async (req, res) => {
        const codMatriz = parseInt(req.params.codMatrizAluno, 10);
        if (isNaN(codMatriz)) return res.status(400).json({ erro: 'codMatrizAluno inválido.' });

        try {
            const { data: ocorrencias } = await supabaseAdmin
                .from('aluno_ocorrencias')
                .select('id')
                .eq('cod_matriz_aluno', codMatriz);

            if (!ocorrencias || ocorrencias.length === 0) return res.json([]);

            const ids = ocorrencias.map(o => o.id);
            const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
            const { rows } = await pool.query(
                `SELECT DISTINCT professor_nome
                 FROM ocorrencia_meta
                 WHERE id_ocorrencia IN (${placeholders})
                   AND professor_nome <> ''
                 ORDER BY professor_nome`,
                ids
            );
            res.json(rows.map(r => r.professor_nome));
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    // ── Gera PDF de termos de ocorrência ──────────────────────────────────────
    router.get('/relatorio-ocorrencias/:codMatrizAluno', requireModulo('ficha-aluno'), async (req, res) => {
        const codMatriz = parseInt(req.params.codMatrizAluno, 10);
        if (isNaN(codMatriz)) {
            return res.status(400).json({ erro: 'codMatrizAluno inválido.' });
        }

        const { de, ate, tipo, professor } = req.query;

        try {
            const [alunoResult, ocorrenciasResult, configResult] = await Promise.all([
                supabaseAdmin
                    .from('alunos')
                    .select('nome, turma, numchamada, codmatrizaluno')
                    .eq('codmatrizaluno', codMatriz)
                    .maybeSingle(),

                supabaseAdmin
                    .from('aluno_ocorrencias')
                    .select('*')
                    .eq('cod_matriz_aluno', codMatriz)
                    .order('data', { ascending: true }),

                pool.query(
                    `SELECT chave, valor FROM edusync_config
                     WHERE chave = ANY($1)`,
                    [['escola_nome_oficial','escola_endereco','escola_telefone','escola_email','escola_logo_base64','escola_cidade_ref']]
                ),
            ]);

            const aluno = alunoResult.data;
            if (!aluno) {
                return res.status(404).json({ erro: 'Aluno não encontrado.' });
            }

            let ocorrenciasRaw = ocorrenciasResult.data || [];

            if (de) {
                const dataInicio = new Date(de + 'T00:00:00');
                ocorrenciasRaw = ocorrenciasRaw.filter(o => o.data && new Date(o.data) >= dataInicio);
            }
            if (ate) {
                const dataFim = new Date(ate + 'T23:59:59');
                ocorrenciasRaw = ocorrenciasRaw.filter(o => o.data && new Date(o.data) <= dataFim);
            }
            if (tipo && ['grave','atencao','positivo'].includes(tipo)) {
                ocorrenciasRaw = ocorrenciasRaw.filter(o => o.tipo === tipo);
            }

            if (ocorrenciasRaw.length === 0) {
                return res.status(204).json({ mensagem: 'Nenhuma ocorrência encontrada para os filtros informados.' });
            }

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

            // Busca metadados (professor, turma, disciplina)
            const ids = ocorrenciasRaw.map(o => o.id);
            let metaMap = {};
            if (ids.length > 0) {
                const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
                const metaResult = await pool.query(
                    `SELECT id_ocorrencia, professor_nome, nome_turma, disciplina
                     FROM ocorrencia_meta WHERE id_ocorrencia IN (${placeholders})`,
                    ids
                );
                for (const row of metaResult.rows) metaMap[row.id_ocorrencia] = row;
            }

            let ocorrencias = ocorrenciasRaw.map(o => ({
                ...o,
                professor_nome: metaMap[o.id]?.professor_nome || '',
                nome_turma:     metaMap[o.id]?.nome_turma     || aluno.turma || '',
                disciplina:     metaMap[o.id]?.disciplina     || '',
            }));

            // Filtro por professor (aplicado após enriquecer com metadados)
            if (professor) {
                ocorrencias = ocorrencias.filter(o =>
                    o.professor_nome.toLowerCase().includes(professor.toLowerCase())
                );
            }

            if (ocorrencias.length === 0) {
                return res.status(204).json({ mensagem: 'Nenhuma ocorrência encontrada para os filtros informados.' });
            }

            // Ordena por professor → disciplina → data
            ocorrencias.sort((a, b) => {
                const profCmp = (a.professor_nome || '').localeCompare(b.professor_nome || '', 'pt-BR');
                if (profCmp !== 0) return profCmp;
                const discCmp = (a.disciplina || '').localeCompare(b.disciplina || '', 'pt-BR');
                if (discCmp !== 0) return discCmp;
                return (a.data || '').localeCompare(b.data || '');
            });

            // Agrupa em pares de 2 para o layout landscape (2 termos por folha)
            const templateHtml = fs.readFileSync(TEMPLATE, 'utf8');
            const pares = [];
            for (let i = 0; i < ocorrencias.length; i += 2) {
                pares.push(ocorrencias.slice(i, i + 2));
            }
            const blocosHtml = pares.map(par => {
                const termos = par.map(o =>
                    renderOcorrencia({ escola, aluno, ocorrencia: o, cidadeRef })
                ).join('\n');
                const padding = par.length < 2 ? '<div class="termo-vazio"></div>' : '';
                return `<div class="page-pair">${termos}${padding}</div>`;
            }).join('\n');

            const html = templateHtml.replace('{{OCORRENCIAS}}', blocosHtml);

            let browser;
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    browser = await getBrowser();
                    break;
                } catch (browserErr) {
                    if (attempt === 2) {
                        console.error('[RELATORIO-OCORRENCIAS] Browser indisponível após 2 tentativas:', browserErr.message);
                        return res.status(503).json({
                            erro: 'Serviço temporariamente indisponível. O navegador ainda está iniciando — tente novamente em alguns segundos.',
                        });
                    }
                    console.warn('[RELATORIO-OCORRENCIAS] Browser não pronto, tentando novamente em 3 s...', browserErr.message);
                    await new Promise(r => setTimeout(r, 3000));
                }
            }

            const context = await browser.createBrowserContext();
            let pdfBuffer;
            try {
                const page = await context.newPage();
                try {
                    await page.setContent(html, { waitUntil: 'domcontentloaded' });
                    pdfBuffer = await page.pdf({
                        format:          'A4',
                        landscape:       true,
                        printBackground: true,
                        margin: { top: '0', bottom: '0', left: '0', right: '0' },
                    });
                } finally {
                    try { await page.close(); } catch {}
                }
            } finally {
                try { await context.close(); } catch {}
            }

            const nomeArquivo = `termos-${(aluno.nome || 'aluno').replace(/\s+/g, '-').toLowerCase()}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
            res.setHeader('Cache-Control', 'no-store');
            res.send(pdfBuffer);

        } catch (e) {
            console.error('[RELATORIO-OCORRENCIAS]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
