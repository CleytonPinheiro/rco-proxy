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

    // Inferir nível de ensino a partir do nome da turma
    function inferirEnsino(nomeTurma) {
        if (!nomeTurma) return '____________________';
        const n = nomeTurma.trim();
        if (/médio/i.test(n)) return 'Médio';
        if (/fund/i.test(n)) return 'Fundamental';
        const ano = parseInt(n);
        if (!isNaN(ano) && ano >= 1 && ano <= 9) return 'Fundamental';
        if (!isNaN(ano) && ano >= 10 && ano <= 12) return 'Médio';
        return '____________________';
    }
    const ensino = inferirEnsino(ocorrencia.nome_turma || aluno.turma);

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

    <div class="frase-linha">
      Eu,&nbsp;<span class="campo-inline largo">${esc(ocorrencia.professor_nome || '')}</span>,
      Professor(a) da disciplina de:&nbsp;<span class="campo-inline medio">${esc(disciplina)}</span>&nbsp;declaro que o(a)
    </div>

    <div class="frase-linha">
      aluno(a):&nbsp;<span class="campo-inline largo destaque">${esc(aluno.nome)}</span>${aluno.numchamada ? `&nbsp;&nbsp;Nº:&nbsp;<span class="campo-inline curto">${esc(String(aluno.numchamada))}</span>` : ''}
    </div>

    <div class="frase-linha">
      da série:&nbsp;<span class="campo-inline medio">${esc(serie)}</span>,&nbsp;
      turma:&nbsp;<span class="campo-inline curto">${esc(turmaDisplay)}</span>,&nbsp;
      do Ensino&nbsp;<span class="campo-inline medio">${esc(ensino)}</span>
    </div>

    <div class="frase-comportamento">
      manifestou o seguinte comportamento em sala de aula:
    </div>

    <div class="desc-linhas">
      ${descricao
        ? `<div class="desc-conteudo">${esc(descricao)}</div>`
        : '<div class="desc-linha"></div><div class="desc-linha"></div><div class="desc-linha"></div><div class="desc-linha"></div><div class="desc-linha"></div>'}
    </div>

    <div class="data-tipo-row">
      <span class="tipo-badge ${tipoClass}">${esc(tipoLabel)}</span>
      ${categoria ? `<span class="categoria-texto">${esc(categoria)}</span>` : ''}
      <span class="cidade-data">${esc(cidade)},&nbsp;${esc(dataDaOcorrencia)}.</span>
    </div>

    <div class="assinaturas">
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Assinatura do(a) Professor(a)</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Assinatura do(a) Aluno(a)</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Assinatura do Pai ou Responsável</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-linha"></div>
        <div class="assinatura-label">Assinatura de Testemunha</div>
      </div>
    </div>

    <div class="obs-bloco">
      <span class="obs-label">Obs.:</span>
      <div class="obs-linha"></div>
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
            const [alunoResult, ocorrenciasResult, obsRcoResult, configResult] = await Promise.all([
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

                supabaseAdmin
                    .from('rco_observacoes')
                    .select('*')
                    .eq('cod_matriz_aluno', codMatriz)
                    .order('data_aula', { ascending: true }),

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

            // ── 1. Ocorrências de comportamento (aluno_ocorrencias) ────────────
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

            if (professor) {
                ocorrencias = ocorrencias.filter(o =>
                    o.professor_nome.toLowerCase().includes(professor.toLowerCase())
                );
            }

            // ── 2. Observações do RCO (rco_observacoes) ───────────────────────
            // Incluídas somente quando não há filtro de professor (obs. não têm professor)
            // e o filtro de tipo não exclui 'atencao'
            let ocorrenciasRco = [];
            const incluirRco = !professor && (!tipo || tipo === 'atencao');

            if (incluirRco) {
                let obsRaw = obsRcoResult.data || [];

                if (de) {
                    const dataInicio = new Date(de + 'T00:00:00');
                    obsRaw = obsRaw.filter(o => o.data_aula && new Date(o.data_aula) >= dataInicio);
                }
                if (ate) {
                    const dataFim = new Date(ate + 'T23:59:59');
                    obsRaw = obsRaw.filter(o => o.data_aula && new Date(o.data_aula) <= dataFim);
                }

                if (obsRaw.length > 0) {
                    // Enriquecer com nome da disciplina
                    const codClassesUnicos = [...new Set(obsRaw.map(o => o.cod_classe).filter(Boolean))];
                    const disciplinaMap = {};
                    if (codClassesUnicos.length > 0) {
                        try {
                            const { data: classesDisciplinas } = await supabaseAdmin
                                .from('rco_classes')
                                .select('cod_classe, rco_disciplinas(nome_disciplina)')
                                .in('cod_classe', codClassesUnicos);
                            for (const c of (classesDisciplinas || [])) {
                                disciplinaMap[c.cod_classe] = c.rco_disciplinas?.nome_disciplina || '';
                            }
                        } catch {}
                    }

                    ocorrenciasRco = obsRaw.map(o => ({
                        id:              `rco_${o.id || o.cod_classe}`,
                        tipo:            'atencao',
                        categoria:       'observacao_rco',
                        categoria_label: 'Observação Pedagógica (RCO)',
                        data:            o.data_aula,
                        descricao:       o.observacao || '',
                        professor_nome:  '',
                        nome_turma:      aluno.turma || '',
                        disciplina:      disciplinaMap[o.cod_classe] || '',
                    }));
                }
            }

            // ── 3. Combina e verifica ──────────────────────────────────────────
            const combinadas = [...ocorrencias, ...ocorrenciasRco];

            if (combinadas.length === 0) {
                return res.status(204).json({ mensagem: 'Nenhum registro encontrado para os filtros informados.' });
            }

            // Ordena por professor → disciplina → data
            combinadas.sort((a, b) => {
                const profCmp = (a.professor_nome || '').localeCompare(b.professor_nome || '', 'pt-BR');
                if (profCmp !== 0) return profCmp;
                const discCmp = (a.disciplina || '').localeCompare(b.disciplina || '', 'pt-BR');
                if (discCmp !== 0) return discCmp;
                return (a.data || '').localeCompare(b.data || '');
            });

            // Dois termos por folha A4 paisagem (duplicata: via professor + via responsável)
            const templateHtml = fs.readFileSync(TEMPLATE, 'utf8');
            const blocosHtml = combinadas.map(o => {
                const conteudo = renderOcorrencia({ escola, aluno, ocorrencia: o, cidadeRef });
                return `<div class="termo-page">
  <div class="termo-coluna">${conteudo}</div>
  <div class="termo-separador">
    <div class="termo-sep-linha"></div>
    <span class="termo-sep-icone">✂</span>
    <div class="termo-sep-linha"></div>
  </div>
  <div class="termo-coluna">${conteudo}</div>
</div>`;
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
