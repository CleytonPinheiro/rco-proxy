/**
 * Módulo de Provas (correção tipo GradePen no portal do aluno)
 *
 * Fluxo:
 * 1. Professor cadastra a prova informando o ansid da GradePen
 * 2. Sistema busca o gabarito na GradePen (login com GRADEPEN_EMAIL/PASSWORD)
 *    OU o professor cadastra manualmente
 * 3. Aluno acessa /alunos/prova/?ansid=2997247.0, faz login @escola
 * 4. Marca o que respondeu na folha — confirma — vê o gabarito + nota
 * 5. Nota fica como rascunho até o professor "efetivar"
 * 6. Opcional: sorteia 2º corretor cego para checagem
 */

import { Router }  from 'express';
import pkg        from 'pg';
import crypto     from 'crypto';
import { auditLogger } from '../services/AuditLogger.js';

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });

/* ════════════════════════════════════════════════════════════════════
 *  MIGRAÇÃO DE TABELAS
 * ═══════════════════════════════════════════════════════════════════ */
async function migrarTabelas() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_provas (
                id                       SERIAL PRIMARY KEY,
                curso_id                 TEXT        NOT NULL,
                gradepen_id              TEXT        NOT NULL,
                nome                     TEXT        NOT NULL,
                grupo_destino_id         INTEGER     REFERENCES classroom_grupos(id) ON DELETE SET NULL,
                data_aplicacao           DATE,
                foto_modo                TEXT        NOT NULL DEFAULT 'sorteio',
                foto_sorteio_pct         INTEGER     NOT NULL DEFAULT 20,
                segundo_corretor_ativo   BOOLEAN     NOT NULL DEFAULT false,
                segundo_corretor_pct     INTEGER     NOT NULL DEFAULT 15,
                efetivada                BOOLEAN     NOT NULL DEFAULT false,
                criada_em                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                criada_por_cpf           TEXT,
                criada_por_nome          TEXT,
                UNIQUE(curso_id, gradepen_id)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_prova_variantes (
                id            SERIAL PRIMARY KEY,
                prova_id      INTEGER NOT NULL REFERENCES classroom_provas(id) ON DELETE CASCADE,
                codigo        TEXT    NOT NULL,
                gabarito_json JSONB   NOT NULL DEFAULT '[]'::jsonb,
                UNIQUE(prova_id, codigo)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_prova_submissoes (
                id                  SERIAL PRIMARY KEY,
                prova_id            INTEGER NOT NULL REFERENCES classroom_provas(id) ON DELETE CASCADE,
                variante_id         INTEGER NOT NULL REFERENCES classroom_prova_variantes(id) ON DELETE CASCADE,
                aluno_email         TEXT    NOT NULL,
                aluno_nome          TEXT,
                aluno_userid        TEXT,
                marcacoes_json      JSONB   NOT NULL DEFAULT '{}'::jsonb,
                nota                NUMERIC,
                total_max           NUMERIC,
                ip                  TEXT,
                user_agent          TEXT,
                foto_url            TEXT,
                foto_obrigatoria    BOOLEAN NOT NULL DEFAULT false,
                eh_segundo_corretor BOOLEAN NOT NULL DEFAULT false,
                submissao_ref_id    INTEGER REFERENCES classroom_prova_submissoes(id) ON DELETE CASCADE,
                criada_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_provasub_aluno_unica
                ON classroom_prova_submissoes(prova_id, aluno_email)
                WHERE eh_segundo_corretor = false
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_prova ON classroom_prova_submissoes(prova_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_email ON classroom_prova_submissoes(aluno_email)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_ref   ON classroom_prova_submissoes(submissao_ref_id)`);
        console.log('[PROVAS] Tabelas OK (provas + variantes + submissoes)');
    } catch (e) {
        console.warn('[PROVAS] Erro na migração:', e.message);
    }
}
migrarTabelas();

/* ════════════════════════════════════════════════════════════════════
 *  GRADEPEN SCRAPER
 *  Faz login com GRADEPEN_EMAIL/GRADEPEN_PASSWORD, mantém cookie em
 *  memória e busca gabarito via requests/getAnswers.php
 * ═══════════════════════════════════════════════════════════════════ */
let _gpCookieJar = null;     // string Cookie ex.: "PHPSESSID=xxx; ..."
let _gpCookieExp = 0;        // timestamp expiração local (1h)

function parseSetCookies(setCookieHeaders) {
    if (!setCookieHeaders) return [];
    const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    return arr.map(c => c.split(';')[0]).filter(Boolean);
}

async function gpLogin() {
    const email = process.env.GRADEPEN_EMAIL;
    const pwd   = process.env.GRADEPEN_PASSWORD;
    if (!email || !pwd) throw new Error('GRADEPEN_EMAIL/GRADEPEN_PASSWORD não configurados.');

    /* 1. Pega cookie inicial (PHPSESSID) na home */
    const r1 = await fetch('https://gradepen.com/p/index.php', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const initialCookies = parseSetCookies(r1.headers.getSetCookie?.() || r1.headers.raw?.()['set-cookie']);
    const cookieHeader = initialCookies.join('; ');

    /* 2. POST login */
    const body = new URLSearchParams({ email, pwd, remember: 'false', time: String(Date.now()) });
    const r2 = await fetch('https://gradepen.com/p/requests/login.php', {
        method:  'POST',
        headers: {
            'User-Agent':       'Mozilla/5.0',
            'Content-Type':     'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer':          'https://gradepen.com/p/index.php',
            'Cookie':           cookieHeader,
        },
        body,
    });
    const loginCookies = parseSetCookies(r2.headers.getSetCookie?.() || r2.headers.raw?.()['set-cookie']);
    const j = await r2.json();
    if (!j.success) throw new Error('Login GradePen falhou: ' + (j.message || 'sem detalhe'));

    /* Combina cookies, prefere os do login (PHPSESSID novo) */
    const merged = {};
    [...initialCookies, ...loginCookies].forEach(c => {
        const [k, v] = c.split('=');
        merged[k] = v;
    });
    _gpCookieJar = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ');
    _gpCookieExp = Date.now() + 30 * 60 * 1000; // 30 min
    console.log('[PROVAS] Login GradePen OK:', email);
}

async function gpFetchAnswers(jobId, index) {
    if (!_gpCookieJar || Date.now() > _gpCookieExp) await gpLogin();
    const r = await fetch('https://gradepen.com/p/requests/getAnswers.php', {
        method:  'POST',
        headers: {
            'User-Agent':       'Mozilla/5.0',
            'Content-Type':     'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer':          'https://gradepen.com/p/gabaritos.php',
            'Cookie':           _gpCookieJar,
        },
        body: new URLSearchParams({ jobId: String(jobId), index: String(index), type: '0' }),
    });
    const j = await r.json();
    if (!j.success) {
        /* sessão pode ter expirado — tenta uma vez mais */
        if (j.errorCode === 1 || j.errorCode === 2) {
            _gpCookieJar = null;
            return gpFetchAnswers(jobId, index);
        }
        throw new Error('GradePen recusou: ' + (j.message || 'erro ' + j.errorCode));
    }
    return j;
}

/**
 * Converte resposta GradePen para nosso formato.
 * GradePen retorna questions[].answer (índice 0..N) + .nItems + .value
 * Tipo X (multipla escolha): question.answer = índice da correta
 */
function normalizarGabarito(gpData) {
    const questions = gpData.questions || [];
    const LETRAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    return questions.map((q, idx) => {
        const tipo  = q.type === 1 ? 'vf' : (q.type === 0 ? 'discursiva' : 'multipla');
        const valor = parseFloat(q.value) || 0;
        let correta = null;

        if (tipo === 'multipla') {
            const ans = parseInt(q.answer, 10);
            if (!isNaN(ans) && ans >= 0) correta = LETRAS[ans] || String(ans);
        } else if (tipo === 'vf') {
            correta = (q.answers || '').toString().split(',').map(x => String(x).trim() === '1' ? 'V' : 'F');
        }

        return {
            questao:    idx + 1,
            tipo,                // 'multipla' | 'vf' | 'discursiva'
            n_alternativas: parseInt(q.nItems, 10) || 5,
            correta,             // letra para multipla; array V/F para vf; null para discursiva
            valor,
        };
    });
}

/**
 * Busca gabarito de uma variante. Retorna { gabarito, total }
 */
async function scrapeVariante(jobId, index) {
    const data = await gpFetchAnswers(jobId, index);
    const gabarito = normalizarGabarito(data);
    const total = gabarito.reduce((s, q) => s + (q.valor || 0), 0);
    return { gabarito, total };
}

/**
 * Detecta variantes existentes (.0, .1, .2, ...).
 * Para por uma falha após pelo menos uma variante encontrada.
 */
async function scrapeProva(gradepenId) {
    const variantes = [];
    for (let idx = 0; idx < 10; idx++) {
        try {
            const { gabarito, total } = await scrapeVariante(gradepenId, idx);
            if (!gabarito || gabarito.length === 0) break;
            variantes.push({ codigo: String(idx), gabarito, total });
        } catch (e) {
            if (variantes.length === 0 && idx === 0) throw e;
            break;
        }
    }
    if (variantes.length === 0) throw new Error('Nenhuma variante encontrada para ansid=' + gradepenId);
    return variantes;
}

/* ════════════════════════════════════════════════════════════════════
 *  CÁLCULO DE NOTA
 * ═══════════════════════════════════════════════════════════════════ */
function calcularNota(gabarito, marcacoes) {
    /* marcacoes: { "1": "a", "2": "c", ... } ou para vf: { "1": ["V","F","V","V"] } */
    let nota = 0;
    let total = 0;
    const detalhes = [];
    for (const q of gabarito) {
        total += q.valor || 0;
        const marc = marcacoes[String(q.questao)];
        let acerto = false;

        if (q.tipo === 'multipla') {
            acerto = marc != null && String(marc).toLowerCase() === String(q.correta || '').toLowerCase();
        } else if (q.tipo === 'vf') {
            if (Array.isArray(marc) && Array.isArray(q.correta) && marc.length === q.correta.length) {
                acerto = marc.every((v, i) => String(v).toUpperCase() === String(q.correta[i]).toUpperCase());
            }
        } else {
            acerto = false;     // discursiva não auto corrige
        }

        if (acerto) nota += q.valor || 0;
        detalhes.push({ questao: q.questao, marcado: marc ?? null, correta: q.correta, acerto, valor: q.valor });
    }
    return { nota: +nota.toFixed(2), total: +total.toFixed(2), detalhes };
}

/* ════════════════════════════════════════════════════════════════════
 *  HELPERS DE SESSÃO
 * ═══════════════════════════════════════════════════════════════════ */
async function getAlunoSession(req) {
    const sid = req.cookies?.aluno_sid;
    if (!sid) return null;
    try {
        const { rows } = await pool.query(
            `SELECT * FROM aluno_portal_sessions WHERE id = $1 AND expires_at > NOW()`,
            [sid]
        );
        return rows[0] || null;
    } catch (_) { return null; }
}

function decideFotoObrigatoria(prova) {
    if (prova.foto_modo === 'sempre') return true;
    if (prova.foto_modo === 'nunca')  return false;
    /* sorteio: percentual */
    return Math.random() * 100 < (prova.foto_sorteio_pct || 20);
}

function logProvas(req, acao, detalhes) {
    auditLogger.registrar({
        usuarioId:   req.userSession?.id,
        usuarioNome: req.userSession?.nome || req.userSession?.cpf || 'Sistema',
        acao,
        modulo:      'provas',
        detalhes,
        ip:          req.ip,
    }).catch(() => {});
}

async function podeAcessarCurso(email, cursoId, teacherAuth) {
    /* Verifica se o aluno (por email) está matriculado no curso Classroom */
    if (!teacherAuth) return false;
    try {
        const { google } = await import('googleapis');
        const classroom = google.classroom({ version: 'v1', auth: teacherAuth });
        let pageToken;
        do {
            const r = await classroom.courses.students.list({ courseId: cursoId, pageSize: 100, pageToken });
            const found = (r.data.students || []).some(s => (s.profile?.emailAddress || '').toLowerCase() === email.toLowerCase());
            if (found) return true;
            pageToken = r.data.nextPageToken;
        } while (pageToken);
        return false;
    } catch (_) { return false; }
}

/* ════════════════════════════════════════════════════════════════════
 *  ROUTER PROFESSOR (autenticado por requireAuth global)
 * ═══════════════════════════════════════════════════════════════════ */
export function createProvasRouter() {
    const router = Router();

    /* Lista provas de um curso */
    router.get('/classroom/provas', async (req, res) => {
        const cursoId = req.query.courseId;
        if (!cursoId) return res.status(400).json({ erro: 'courseId é obrigatório.' });
        try {
            const { rows } = await pool.query(
                `SELECT p.*,
                        g.nome AS grupo_destino_nome,
                        (SELECT COUNT(*) FROM classroom_prova_submissoes s
                          WHERE s.prova_id = p.id AND s.eh_segundo_corretor = false) AS submissoes_count,
                        (SELECT COUNT(*) FROM classroom_prova_variantes v
                          WHERE v.prova_id = p.id) AS variantes_count
                   FROM classroom_provas p
                   LEFT JOIN classroom_grupos g ON g.id = p.grupo_destino_id
                  WHERE p.curso_id = $1
                  ORDER BY p.data_aplicacao DESC NULLS LAST, p.criada_em DESC`,
                [cursoId]
            );
            res.json({ provas: rows });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Detalhe de uma prova (variantes + submissões) */
    router.get('/classroom/provas/:id', async (req, res) => {
        try {
            const { rows: [prova] } = await pool.query(
                `SELECT p.*, g.nome AS grupo_destino_nome
                   FROM classroom_provas p
                   LEFT JOIN classroom_grupos g ON g.id = p.grupo_destino_id
                  WHERE p.id = $1`,
                [req.params.id]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            const { rows: variantes } = await pool.query(
                `SELECT id, codigo, gabarito_json FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                [prova.id]
            );

            const { rows: submissoes } = await pool.query(
                `SELECT s.*, v.codigo AS variante_codigo
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                  WHERE s.prova_id = $1
                  ORDER BY s.eh_segundo_corretor, s.criada_em DESC`,
                [prova.id]
            );

            res.json({ prova, variantes, submissoes });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Cria prova: scraping ou gabarito manual */
    router.post('/classroom/provas', async (req, res) => {
        const {
            courseId, nome, gradepenId, grupoDestinoId, dataAplicacao,
            fotoModo = 'sorteio', fotoSorteioPct = 20,
            segundoCorretorAtivo = false, segundoCorretorPct = 15,
            variantesManuais,    // opcional: [{codigo, gabarito: [{questao, tipo, correta, valor, n_alternativas}]}]
        } = req.body || {};

        if (!courseId || !nome || !gradepenId) {
            return res.status(400).json({ erro: 'courseId, nome e gradepenId são obrigatórios.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: [prova] } = await client.query(
                `INSERT INTO classroom_provas
                   (curso_id, gradepen_id, nome, grupo_destino_id, data_aplicacao,
                    foto_modo, foto_sorteio_pct, segundo_corretor_ativo, segundo_corretor_pct,
                    criada_por_cpf, criada_por_nome)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING *`,
                [courseId, String(gradepenId), nome, grupoDestinoId || null, dataAplicacao || null,
                 fotoModo, fotoSorteioPct, !!segundoCorretorAtivo, segundoCorretorPct,
                 req.userSession?.cpf || null, req.userSession?.nome || null]
            );

            let variantes;
            let warning = null;
            if (Array.isArray(variantesManuais) && variantesManuais.length > 0) {
                variantes = variantesManuais.map(v => ({
                    codigo: String(v.codigo),
                    gabarito: v.gabarito || [],
                }));
            } else {
                try {
                    variantes = await scrapeProva(gradepenId);
                } catch (e) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({
                        erro: 'Não foi possível ler a GradePen. Você pode cadastrar o gabarito manualmente.',
                        detalhe: e.message,
                        prova: null,
                        precisaGabaritoManual: true,
                    });
                }
            }

            for (const v of variantes) {
                await client.query(
                    `INSERT INTO classroom_prova_variantes (prova_id, codigo, gabarito_json)
                     VALUES ($1,$2,$3)`,
                    [prova.id, v.codigo, JSON.stringify(v.gabarito)]
                );
            }
            await client.query('COMMIT');
            logProvas(req, 'PROVA_CREATE', { provaId: prova.id, gradepenId, nome });
            res.json({ prova, variantes_count: variantes.length, warning });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            if (e.code === '23505') return res.status(409).json({ erro: 'Já existe uma prova com esse ansid neste curso.' });
            res.status(500).json({ erro: e.message });
        } finally {
            client.release();
        }
    });

    /* Atualiza configurações da prova */
    router.put('/classroom/provas/:id', async (req, res) => {
        const fields = ['nome', 'grupo_destino_id', 'data_aplicacao', 'foto_modo',
                        'foto_sorteio_pct', 'segundo_corretor_ativo', 'segundo_corretor_pct'];
        const map = {
            nome: 'nome', grupoDestinoId: 'grupo_destino_id', dataAplicacao: 'data_aplicacao',
            fotoModo: 'foto_modo', fotoSorteioPct: 'foto_sorteio_pct',
            segundoCorretorAtivo: 'segundo_corretor_ativo', segundoCorretorPct: 'segundo_corretor_pct',
        };
        const sets = [], vals = [];
        let i = 1;
        for (const [k, col] of Object.entries(map)) {
            if (req.body[k] !== undefined) {
                sets.push(`${col} = $${i++}`);
                vals.push(req.body[k]);
            }
        }
        if (sets.length === 0) return res.json({ ok: true });
        vals.push(req.params.id);
        try {
            await pool.query(`UPDATE classroom_provas SET ${sets.join(', ')} WHERE id = $${i}`, vals);
            logProvas(req, 'PROVA_UPDATE', { provaId: req.params.id, campos: Object.keys(req.body) });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Re-baixa gabarito da GradePen */
    router.post('/classroom/provas/:id/regabaritar', async (req, res) => {
        try {
            const { rows: [prova] } = await pool.query(`SELECT * FROM classroom_provas WHERE id = $1`, [req.params.id]);
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });
            const variantes = await scrapeProva(prova.gradepen_id);
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(`DELETE FROM classroom_prova_variantes WHERE prova_id = $1`, [prova.id]);
                for (const v of variantes) {
                    await client.query(
                        `INSERT INTO classroom_prova_variantes (prova_id, codigo, gabarito_json)
                         VALUES ($1,$2,$3)`,
                        [prova.id, v.codigo, JSON.stringify(v.gabarito)]
                    );
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally { client.release(); }
            logProvas(req, 'PROVA_REGAB', { provaId: prova.id });
            res.json({ ok: true, variantes_count: variantes.length });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Efetiva: marca provas como definitivas */
    router.post('/classroom/provas/:id/efetivar', async (req, res) => {
        try {
            await pool.query(`UPDATE classroom_provas SET efetivada = true WHERE id = $1`, [req.params.id]);
            logProvas(req, 'PROVA_EFETIVAR', { provaId: req.params.id });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    router.post('/classroom/provas/:id/reabrir', async (req, res) => {
        try {
            await pool.query(`UPDATE classroom_provas SET efetivada = false WHERE id = $1`, [req.params.id]);
            logProvas(req, 'PROVA_REABRIR', { provaId: req.params.id });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Sorteia 2º corretor para uma submissão específica */
    router.post('/classroom/provas/:id/sortear-segundo', async (req, res) => {
        const { submissaoId } = req.body || {};
        if (!submissaoId) return res.status(400).json({ erro: 'submissaoId obrigatório.' });
        try {
            const { rows: [sub] } = await pool.query(
                `SELECT s.*, p.curso_id FROM classroom_prova_submissoes s
                  JOIN classroom_provas p ON p.id = s.prova_id
                 WHERE s.id = $1 AND s.prova_id = $2`,
                [submissaoId, req.params.id]
            );
            if (!sub) return res.status(404).json({ erro: 'Submissão não encontrada nesta prova.' });

            /* Candidatos: quem submeteu nesta prova com OUTRA variante e não é o próprio aluno */
            const { rows: candidatos } = await pool.query(
                `SELECT s.aluno_email, s.aluno_nome FROM classroom_prova_submissoes s
                  WHERE s.prova_id = $1
                    AND s.aluno_email <> $2
                    AND s.eh_segundo_corretor = false
                    AND s.variante_id <> $3
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = s.id
                           AND c.eh_segundo_corretor = true
                    )`,
                [sub.prova_id, sub.aluno_email, sub.variante_id]
            );
            if (candidatos.length === 0) {
                return res.status(409).json({ erro: 'Sem candidatos disponíveis (todos da mesma variante ou já corrigindo).' });
            }
            const escolhido = candidatos[Math.floor(Math.random() * candidatos.length)];

            /* Cria notificação no portal aluno */
            await pool.query(
                `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
                 VALUES ($1,'segundo_corretor',$2,$3,$4,$5)`,
                [escolhido.aluno_email, String(sub.id),
                 'Você foi sorteado para uma 2ª correção',
                 'Ajude na verificação de uma prova (anônima). Acesse "Minhas tarefas de correção" no portal.',
                 JSON.stringify({ submissaoRefId: sub.id, provaId: sub.prova_id })]
            );
            logProvas(req, 'PROVA_SORTEIO_2COR', { submissaoId: sub.id, sorteado: escolhido.aluno_email });
            res.json({ ok: true, sorteado: escolhido.aluno_email });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    router.delete('/classroom/provas/:id', async (req, res) => {
        try {
            await pool.query(`DELETE FROM classroom_provas WHERE id = $1`, [req.params.id]);
            logProvas(req, 'PROVA_DELETE', { provaId: req.params.id });
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Detalhe de uma submissão (com gabarito da variante) */
    router.get('/classroom/provas/submissoes/:subId', async (req, res) => {
        try {
            const { rows: [sub] } = await pool.query(
                `SELECT s.*, v.codigo AS variante_codigo, v.gabarito_json,
                        p.nome AS prova_nome, p.curso_id, p.efetivada
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                   JOIN classroom_provas p          ON p.id = s.prova_id
                  WHERE s.id = $1`,
                [req.params.subId]
            );
            if (!sub) return res.status(404).json({ erro: 'Submissão não encontrada.' });

            /* Se há 2ª correção registrada, devolve junto */
            const { rows: segundas } = await pool.query(
                `SELECT * FROM classroom_prova_submissoes WHERE submissao_ref_id = $1 AND eh_segundo_corretor = true`,
                [sub.id]
            );
            res.json({ submissao: sub, segundas_correcoes: segundas });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}

/* ════════════════════════════════════════════════════════════════════
 *  ROUTER PÚBLICO (alunos — exigem cookie aluno_sid)
 * ═══════════════════════════════════════════════════════════════════ */
export function createProvasPublicRouter() {
    const router = Router();

    /**
     * GET /api/alunos-portal/prova/:ansid
     * ansid pode vir como "2997247" ou "2997247.0"
     * Retorna: { prova, variantes (sem gabarito), variantePreSelecionada, jaSubmeti }
     */
    router.get('/alunos-portal/prova/:ansid', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const raw = String(req.params.ansid || '');
        const [jobId, varCodigo] = raw.split('.');
        if (!jobId) return res.status(400).json({ erro: 'ansid inválido.' });

        try {
            const { rows: provas } = await pool.query(
                `SELECT p.*, g.nome AS grupo_destino_nome
                   FROM classroom_provas p
                   LEFT JOIN classroom_grupos g ON g.id = p.grupo_destino_id
                  WHERE p.gradepen_id = $1
                  ORDER BY p.criada_em DESC`,
                [String(jobId)]
            );
            if (provas.length === 0) {
                return res.status(404).json({ erro: 'Esta prova ainda não foi liberada pelo professor.' });
            }
            /* Se houver mais de uma prova com mesmo gradepen_id (raro: cursos diferentes),
               escolhe a mais recente — depois podemos refinar com cursoId */
            const prova = provas[0];

            const { rows: variantes } = await pool.query(
                `SELECT id, codigo, jsonb_array_length(gabarito_json) AS qtd_questoes
                   FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                [prova.id]
            );

            const { rows: subs } = await pool.query(
                `SELECT id, nota, total_max, criada_em, foto_obrigatoria, foto_url
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false`,
                [prova.id, aluno.email]
            );

            res.json({
                prova: {
                    id: prova.id,
                    nome: prova.nome,
                    gradepen_id: prova.gradepen_id,
                    data_aplicacao: prova.data_aplicacao,
                    grupo_destino_nome: prova.grupo_destino_nome,
                    efetivada: prova.efetivada,
                    foto_modo: prova.foto_modo,
                },
                variantes,
                varianteSugerida: varCodigo || null,
                jaSubmeti: subs[0] || null,
            });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * POST /api/alunos-portal/prova/:provaId/submeter
     * Body: { varianteCodigo, marcacoes: { "1":"a", "2":"c", ... } }
     * Calcula nota, grava, retorna gabarito + nota + se foto será exigida
     */
    router.post('/alunos-portal/prova/:provaId/submeter', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const { varianteCodigo, marcacoes, fotoBase64 } = req.body || {};
        if (varianteCodigo == null || !marcacoes) {
            return res.status(400).json({ erro: 'varianteCodigo e marcacoes são obrigatórios.' });
        }

        try {
            const { rows: [prova] } = await pool.query(
                `SELECT * FROM classroom_provas WHERE id = $1`, [req.params.provaId]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            const { rows: [variante] } = await pool.query(
                `SELECT * FROM classroom_prova_variantes WHERE prova_id = $1 AND codigo = $2`,
                [prova.id, String(varianteCodigo)]
            );
            if (!variante) return res.status(404).json({ erro: 'Variante não encontrada.' });

            /* Já submeteu? */
            const { rows: existente } = await pool.query(
                `SELECT id FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false`,
                [prova.id, aluno.email]
            );
            if (existente.length > 0) {
                return res.status(409).json({ erro: 'Você já enviou a correção desta prova.' });
            }

            const gabarito = variante.gabarito_json;
            const { nota, total, detalhes } = calcularNota(gabarito, marcacoes);
            const fotoObrig = decideFotoObrigatoria(prova);

            /* Se foto obrigatória mas não veio → grava como pendente, mas pede foto na resposta */
            let fotoUrlSalva = null;
            if (fotoBase64) {
                /* Limita tamanho (~ 800 KB) */
                const buf = Buffer.from(String(fotoBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
                if (buf.length > 1.5 * 1024 * 1024) {
                    return res.status(413).json({ erro: 'Foto muito grande (máx 1.5 MB).' });
                }
                /* Salva inline no DB como data URL para simplicidade — depois podemos mover p/ storage */
                fotoUrlSalva = `data:image/jpeg;base64,${buf.toString('base64')}`;
            }

            const { rows: [sub] } = await pool.query(
                `INSERT INTO classroom_prova_submissoes
                   (prova_id, variante_id, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent,
                    foto_url, foto_obrigatoria)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING id, criada_em`,
                [prova.id, variante.id, aluno.email, aluno.nome,
                 JSON.stringify(marcacoes), nota, total,
                 req.ip, req.get('user-agent') || '',
                 fotoUrlSalva, fotoObrig]
            );

            res.json({
                submissaoId: sub.id,
                nota, total, detalhes,
                gabarito,
                fotoObrigatoria: fotoObrig,
                fotoEntregue: !!fotoUrlSalva,
                criada_em: sub.criada_em,
            });
        } catch (e) {
            console.error('[PROVAS] Erro ao submeter:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * POST /api/alunos-portal/prova/submissao/:subId/foto
     * Anexa foto depois (caso o aluno tenha sido sorteado e não enviou na hora)
     */
    router.post('/alunos-portal/prova/submissao/:subId/foto', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        const { fotoBase64 } = req.body || {};
        if (!fotoBase64) return res.status(400).json({ erro: 'foto obrigatória.' });
        try {
            const { rows: [sub] } = await pool.query(
                `SELECT * FROM classroom_prova_submissoes WHERE id = $1 AND aluno_email = $2`,
                [req.params.subId, aluno.email]
            );
            if (!sub) return res.status(404).json({ erro: 'Submissão não encontrada.' });
            const buf = Buffer.from(String(fotoBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
            if (buf.length > 1.5 * 1024 * 1024) return res.status(413).json({ erro: 'Foto muito grande.' });
            const url = `data:image/jpeg;base64,${buf.toString('base64')}`;
            await pool.query(`UPDATE classroom_prova_submissoes SET foto_url = $1 WHERE id = $2`, [url, sub.id]);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Resultado próprio (revisita) */
    router.get('/alunos-portal/prova/submissao/:subId', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const { rows: [sub] } = await pool.query(
                `SELECT s.*, v.gabarito_json, v.codigo AS variante_codigo, p.nome AS prova_nome
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                   JOIN classroom_provas p          ON p.id = s.prova_id
                  WHERE s.id = $1 AND s.aluno_email = $2`,
                [req.params.subId, aluno.email]
            );
            if (!sub) return res.status(404).json({ erro: 'Submissão não encontrada.' });
            const { detalhes, total } = calcularNota(sub.gabarito_json, sub.marcacoes_json);
            res.json({ submissao: sub, detalhes, total, gabarito: sub.gabarito_json });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Lista pendências de 2ª correção para este aluno */
    router.get('/alunos-portal/segundo-corretor/pendentes', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const { rows } = await pool.query(
                `SELECT n.id AS notif_id, n.criado_em, n.dados,
                        s.id AS submissao_ref_id, s.foto_url,
                        p.id AS prova_id, p.nome AS prova_nome,
                        v.id AS variante_id, v.codigo AS variante_codigo,
                        jsonb_array_length(v.gabarito_json) AS qtd_questoes
                   FROM notificacoes_aluno n
                   JOIN classroom_prova_submissoes s ON s.id = (n.dados->>'submissaoRefId')::int
                   JOIN classroom_provas p           ON p.id = s.prova_id
                   JOIN classroom_prova_variantes v  ON v.id = s.variante_id
                  WHERE n.aluno_email = $1
                    AND n.tipo = 'segundo_corretor'
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = s.id
                           AND c.aluno_email = $1
                           AND c.eh_segundo_corretor = true
                    )
                  ORDER BY n.criado_em DESC`,
                [aluno.email]
            );
            res.json({ pendentes: rows });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Submete a 2ª correção (cega — sem ver nome nem nota da original) */
    router.post('/alunos-portal/segundo-corretor/:subRefId/submeter', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        const { marcacoes } = req.body || {};
        if (!marcacoes) return res.status(400).json({ erro: 'marcacoes obrigatório.' });

        try {
            const { rows: [ref] } = await pool.query(
                `SELECT s.*, v.gabarito_json, v.id AS variante_id_real
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                  WHERE s.id = $1`,
                [req.params.subRefId]
            );
            if (!ref) return res.status(404).json({ erro: 'Submissão de referência não encontrada.' });
            if (ref.aluno_email.toLowerCase() === aluno.email.toLowerCase()) {
                return res.status(403).json({ erro: 'Você não pode corrigir sua própria prova.' });
            }
            /* Exige que exista uma notificação de sorteio para este aluno+submissão */
            const { rows: notif } = await pool.query(
                `SELECT id FROM notificacoes_aluno
                  WHERE aluno_email = $1 AND tipo = 'segundo_corretor'
                    AND (dados->>'submissaoRefId')::int = $2 LIMIT 1`,
                [aluno.email, ref.id]
            );
            if (notif.length === 0) {
                return res.status(403).json({ erro: 'Você não foi sorteado para esta correção.' });
            }
            /* Já corrigiu? */
            const { rows: existe } = await pool.query(
                `SELECT id FROM classroom_prova_submissoes
                  WHERE submissao_ref_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = true`,
                [ref.id, aluno.email]
            );
            if (existe.length > 0) return res.status(409).json({ erro: 'Você já submeteu esta correção.' });

            const { nota, total } = calcularNota(ref.gabarito_json, marcacoes);
            await pool.query(
                `INSERT INTO classroom_prova_submissoes
                   (prova_id, variante_id, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent,
                    eh_segundo_corretor, submissao_ref_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
                [ref.prova_id, ref.variante_id_real, aluno.email, aluno.nome,
                 JSON.stringify(marcacoes), nota, total,
                 req.ip, req.get('user-agent') || '', ref.id]
            );

            /* Marca a notificação como lida */
            await pool.query(
                `UPDATE notificacoes_aluno SET lida = true
                  WHERE aluno_email = $1 AND tipo = 'segundo_corretor'
                    AND (dados->>'submissaoRefId')::int = $2`,
                [aluno.email, ref.id]
            );

            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    return router;
}
