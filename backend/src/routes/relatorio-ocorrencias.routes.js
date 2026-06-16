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
    if (!isoStr) return { dd: '______', mes: '_______________', ano: '____' };
    const d = new Date(isoStr + (isoStr.includes('T') ? '' : 'T12:00:00'));
    return {
        dd:  String(d.getDate()).padStart(2, '0'),
        mes: MESES_PT[d.getMonth()],
        ano: String(d.getFullYear()),
    };
}

function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function inferirEnsino(nomeTurma) {
    if (!nomeTurma) return '';
    const n = nomeTurma.trim();
    if (/médio/i.test(n)) return 'Médio';
    if (/fund/i.test(n)) return 'Fundamental';
    return '';
}

function deriveSerieFromTurma(nomeTurma) {
    if (!nomeTurma) return '';
    const parts = nomeTurma.trim().split(/\s+/);
    if (parts.length <= 1) return nomeTurma;
    return parts.slice(0, -1).join(' ');
}

/**
 * Renderiza um único termo de ocorrência (metade de um A4 retrato).
 * A estrutura segue fielmente o modelo físico do colégio.
 */
function renderTermo({ escola, aluno, ocorrencia, cidadeRef }) {
    const logoHtml = escola.logo
        ? `<img src="${esc(escola.logo)}" alt="Logo" />`
        : `<div class="cabecalho-logo-placeholder">LOGO</div>`;

    const { dd, mes, ano } = dataExtenso(ocorrencia.data);
    const cidade = esc(cidadeRef || 'Maringá');

    const turmaDisplay = esc(ocorrencia.nome_turma || aluno.turma || '');
    const serie        = esc(deriveSerieFromTurma(ocorrencia.nome_turma || aluno.turma || ''));
    const ensino       = esc(inferirEnsino(ocorrencia.nome_turma || aluno.turma || ''));
    const professor    = esc(ocorrencia.professor_nome || '');
    const disciplina   = esc(ocorrencia.disciplina     || '');
    const descricao    = ocorrencia.descricao ? esc(ocorrencia.descricao) : '';
    const numchamada   = aluno.numchamada ? `&nbsp;&nbsp;Nº <span class="campo campo-curto">${esc(String(aluno.numchamada))}</span>` : '';

    const enderecoPartes = [escola.endereco, escola.telefone, escola.email].filter(Boolean);
    const enderecoHtml   = enderecoPartes.map(p => esc(p)).join(' &nbsp;–&nbsp; ');

    const descHtml = descricao
        ? `<div class="desc-preenchida">${descricao}</div>`
        : `<div class="desc-linha"></div>
           <div class="desc-linha"></div>
           <div class="desc-linha"></div>
           <div class="desc-linha"></div>
           <div class="desc-linha"></div>`;

    return `<div class="termo-wrapper">

  <!-- Cabeçalho -->
  <div class="cabecalho">
    <div class="cabecalho-logo">${logoHtml}</div>
    <div class="cabecalho-texto">
      <div class="cabecalho-escola">${esc(escola.nome || 'Escola')}</div>
      ${enderecoHtml ? `<div class="cabecalho-endereco">${enderecoHtml}</div>` : ''}
    </div>
  </div>

  <!-- Título -->
  <div class="titulo">Termo de Ocorrência em Sala de Aula</div>

  <!-- Corpo -->
  <div class="corpo">

    <div class="linha-frase">
      <span>Eu,&nbsp;</span>
      <span class="campo campo-largo">${professor}</span>
      <span>,</span>
    </div>

    <div class="linha-frase">
      <span>Professor(a) da disciplina de:&nbsp;</span>
      <span class="campo campo-medio">${disciplina}</span>
      <span>&nbsp;declaro que o(a)</span>
    </div>

    <div class="linha-frase">
      <span>aluno(a):&nbsp;</span>
      <span class="campo campo-largo">${esc(aluno.nome || '')}</span>
      ${numchamada}
    </div>

    <div class="linha-frase">
      <span>da série:&nbsp;</span>
      <span class="campo campo-xm">${serie}</span>
      <span>,&nbsp;turma:&nbsp;</span>
      <span class="campo campo-curto">${turmaDisplay}</span>
      <span>,&nbsp;do Ensino&nbsp;</span>
      <span class="campo campo-resto">${ensino}</span>
    </div>

    <div class="frase-comportamento">
      manifestou o seguinte comportamento em sala de aula:
    </div>

    <div class="desc-area">${descHtml}</div>

    <div class="data-linha">
      ${cidade},&nbsp;<span class="campo campo-curto">${esc(dd)}</span>&nbsp;de&nbsp;<span class="campo campo-xm">${esc(mes)}</span>&nbsp;de&nbsp;20<span class="campo campo-curto">${esc(ano.slice(2))}</span>.
    </div>

    <div class="assinaturas">
      <div class="assinatura-item">
        <span>Assinatura do(a) Professor(a):&nbsp;</span>
        <div class="assinatura-linha-campo"></div>
      </div>
      <div class="assinatura-item">
        <span>Assinatura do(a) Aluno(a):&nbsp;</span>
        <div class="assinatura-linha-campo"></div>
      </div>
      <div class="assinatura-item">
        <span>Assinatura do Pai ou Responsável:&nbsp;</span>
        <div class="assinatura-linha-campo"></div>
      </div>
      <div class="assinatura-item">
        <span>Assinatura de Testemunha:&nbsp;</span>
        <div class="assinatura-linha-campo"></div>
      </div>
    </div>

    <div class="obs-bloco">
      <div class="obs-linha-wrap">
        <span>Obs.:&nbsp;</span>
        <div class="obs-sublinha"></div>
      </div>
      <div class="obs-linha-wrap">
        <div class="obs-sublinha"></div>
      </div>
    </div>

  </div>
</div>`;
}

export function createRelatorioOcorrenciasRouter({ supabaseAdmin } = {}) {
    const router = Router();

    /* ── Lista de professores distintos de um aluno (para o filtro) ── */
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

    /* ── Gera PDF de termos (2 por folha A4 retrato, empilhados) ── */
    router.get('/relatorio-ocorrencias/:codMatrizAluno', requireModulo('ficha-aluno'), async (req, res) => {
        const codMatriz = parseInt(req.params.codMatrizAluno, 10);
        if (isNaN(codMatriz)) {
            return res.status(400).json({ erro: 'codMatrizAluno inválido.' });
        }

        const { de, ate, tipo, professor } = req.query;

        try {
            /* ── Busca dados em paralelo ── */
            const [alunoResult, ocorrenciasResult, obsRcoResult, configResult] = await Promise.all([
                supabaseAdmin
                    .from('alunos')
                    .select('nome, turma, numchamada, codmatrizaluno')
                    .eq('codmatrizaluno', codMatriz)
                    .limit(1),

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
                    `SELECT chave, valor FROM edusync_config WHERE chave = ANY($1)`,
                    [['escola_nome_oficial','escola_endereco','escola_telefone','escola_email','escola_logo_base64','escola_cidade_ref']]
                ),
            ]);

            if (alunoResult.error) throw new Error(`Supabase alunos: ${alunoResult.error.message}`);

            const aluno = (alunoResult.data || [])[0];
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

            /* ── 1. Ocorrências de comportamento ── */
            let ocorrenciasRaw = ocorrenciasResult.data || [];

            if (de)   ocorrenciasRaw = ocorrenciasRaw.filter(o => o.data && new Date(o.data) >= new Date(de + 'T00:00:00'));
            if (ate)  ocorrenciasRaw = ocorrenciasRaw.filter(o => o.data && new Date(o.data) <= new Date(ate + 'T23:59:59'));
            if (tipo && ['grave','atencao','positivo'].includes(tipo)) {
                ocorrenciasRaw = ocorrenciasRaw.filter(o => o.tipo === tipo);
            }

            /* Metadados (professor, turma, disciplina) */
            const ids = ocorrenciasRaw.map(o => o.id);
            let metaMap = {};
            if (ids.length > 0) {
                const ph = ids.map((_, i) => `$${i + 1}`).join(',');
                const { rows: metaRows } = await pool.query(
                    `SELECT id_ocorrencia, professor_nome, nome_turma, disciplina
                     FROM ocorrencia_meta WHERE id_ocorrencia IN (${ph})`,
                    ids
                );
                for (const row of metaRows) metaMap[row.id_ocorrencia] = row;
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

            /* ── 2. Observações do RCO ── */
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
                            const { data: cd } = await supabaseAdmin
                                .from('rco_classes')
                                .select('cod_classe, rco_disciplinas(nome_disciplina)')
                                .in('cod_classe', codClassesUnicos);
                            for (const c of (cd || [])) {
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

            /* ── 3. Combina, ordena, verifica ── */
            const combinadas = [...ocorrencias, ...ocorrenciasRco];
            if (combinadas.length === 0) {
                return res.status(204).end();
            }

            /* Ordena por data */
            combinadas.sort((a, b) => {
                const dA = a.data || '';
                const dB = b.data || '';
                if (dA !== dB) return dA.localeCompare(dB);
                return (a.professor_nome || '').localeCompare(b.professor_nome || '', 'pt-BR');
            });

            /* ── 4. Monta HTML ── */
            const templateHtml = fs.readFileSync(TEMPLATE, 'utf8');

            /*
             * Agrupa 2 termos por folha A4 (empilhados verticalmente).
             * Cada "folha" tem: termo1 / separador / termo2.
             * Se o total for ímpar, a última folha tem só 1 termo.
             */
            const folhasHtml = [];
            for (let i = 0; i < combinadas.length; i += 2) {
                const t1 = renderTermo({ escola, aluno, ocorrencia: combinadas[i],     cidadeRef });
                const t2 = i + 1 < combinadas.length
                    ? renderTermo({ escola, aluno, ocorrencia: combinadas[i + 1], cidadeRef })
                    : '';
                const sepHtml = t2
                    ? `<div class="separador"><div class="separador-linha"></div><span class="separador-icone">✂</span><div class="separador-linha"></div></div>`
                    : '';

                folhasHtml.push(`<div class="folha">${t1}${sepHtml}${t2}</div>`);
            }

            const html = templateHtml.replace('{{FOLHAS}}', folhasHtml.join('\n'));

            /* ── 5. Puppeteer PDF ── */
            let browser;
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    browser = await getBrowser();
                    break;
                } catch (browserErr) {
                    if (attempt === 2) {
                        console.error('[RELATORIO-OCORRENCIAS] Browser indisponível:', browserErr.message);
                        return res.status(503).json({
                            erro: 'Servidor de renderização temporariamente ocupado. Tente novamente em instantes.',
                        });
                    }
                    await new Promise(r => setTimeout(r, 3000));
                }
            }

            let context = null;
            let pdfBuffer;
            try {
                context = await browser.createBrowserContext();
                const page = await context.newPage();
                try {
                    await page.setContent(html, { waitUntil: 'domcontentloaded' });
                    pdfBuffer = await page.pdf({
                        format:          'A4',
                        landscape:       false,
                        printBackground: true,
                        margin: { top: '0', bottom: '0', left: '0', right: '0' },
                    });
                } finally {
                    await page.close().catch(() => {});
                }
            } finally {
                await context?.close().catch(() => {});
            }

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
