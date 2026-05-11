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
import { auditLogger }      from '../services/AuditLogger.js';
import { getBrowser }       from '../../auth-puppeteer.js';
import { ReputacaoService, EVENTOS, BADGES, RANKS, getRank } from '../services/reputacao.service.js';

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });
const reputacao = new ReputacaoService(pool);

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
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS permitir_outra_turma BOOLEAN NOT NULL DEFAULT false`);
        /* Grupo dedicado da avaliação (criado/reusado quando publica no Classroom).
           Separado do grupo_destino_id (que costuma ser o de "atividades 4 pts"). */
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS grupo_avaliacao_id INTEGER REFERENCES classroom_grupos(id) ON DELETE SET NULL`);
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS pontos_avaliacao   NUMERIC NOT NULL DEFAULT 6.0`);
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_provasub_2cor_unico
                ON classroom_prova_submissoes(submissao_ref_id, aluno_email)
                WHERE eh_segundo_corretor = true
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_prova ON classroom_prova_submissoes(prova_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_email ON classroom_prova_submissoes(aluno_email)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_ref   ON classroom_prova_submissoes(submissao_ref_id)`);
        /* Gamificação: snapshot de variante original + flags de XP creditado + foto conferida + flag voluntária */
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS variante_id_original INTEGER`);
        await pool.query(`UPDATE classroom_prova_submissoes SET variante_id_original = variante_id WHERE variante_id_original IS NULL`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS foto_conferida TEXT`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS xp_creditado_efetiv BOOLEAN NOT NULL DEFAULT false`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS voluntaria BOOLEAN NOT NULL DEFAULT false`);
        await reputacao.migrate();
        console.log('[PROVAS] Tabelas OK (provas + variantes + submissoes + reputação)');
    } catch (e) {
        console.warn('[PROVAS] Erro na migração:', e.message);
    }
}
migrarTabelas();

/* ════════════════════════════════════════════════════════════════════
 *  GRADEPEN SCRAPER (via Puppeteer + login Google)
 *  GradePen exige "Sign in with Google", então usamos um navegador
 *  headless que loga no Google com GOOGLE_EMAIL/GOOGLE_PASSWORD,
 *  autoriza o GradePen e mantém uma página persistente que usamos
 *  pra chamar requests/getAnswers.php via fetch dentro da própria
 *  página (já com PHPSESSID válido).
 * ═══════════════════════════════════════════════════════════════════ */
let _gpPage        = null;              // puppeteer Page autenticada
let _gpPageExp     = 0;                 // timestamp local de expiração (~30 min)
let _gpLoginLock   = null;              // Promise atual de login (mutex)
let _gpMutexChain  = Promise.resolve(); // cadeia de serialização dos fetches
let _gpQueueSize   = 0;                 // nº de fetches na fila/executando

async function gpLogin() {
    if (_gpLoginLock) return _gpLoginLock;

    _gpLoginLock = (async () => {
        const email = process.env.GOOGLE_EMAIL;
        const pwd   = process.env.GOOGLE_PASSWORD;
        if (!email || !pwd) throw new Error('GOOGLE_EMAIL/GOOGLE_PASSWORD não configurados.');

        /* Fecha página antiga se houver */
        if (_gpPage) { try { await _gpPage.close(); } catch {} _gpPage = null; }

        const browser = await getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        try {
            console.log('[PROVAS] Abrindo GradePen para login Google...');
            await page.goto('https://gradepen.com/p/index.php', { waitUntil: 'networkidle2', timeout: 30000 });

            /* Botão "Sign in with Google" — abre OAuth na mesma janela */
            const googleBtn = await page.$('a[href*="google"], button[onclick*="google"], #googleSignInButton, .g-signin2');
            if (googleBtn) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
                    googleBtn.click(),
                ]);
            } else {
                /* fallback: vai direto pro endpoint OAuth do GradePen */
                await page.goto('https://gradepen.com/p/oauth.php?provider=google', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
            }

            /* Tela do Google: digita email */
            await page.waitForSelector('input[type="email"]', { timeout: 20000 });
            await page.type('input[type="email"]', email, { delay: 30 });
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => null),
                page.click('#identifierNext, button[jsname="LgbsSe"]').catch(async () => {
                    await page.keyboard.press('Enter');
                }),
            ]);

            /* Tela da senha */
            await page.waitForSelector('input[type="password"]', { timeout: 20000, visible: true });
            await page.type('input[type="password"]', pwd, { delay: 30 });
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
                page.click('#passwordNext, button[jsname="LgbsSe"]').catch(async () => {
                    await page.keyboard.press('Enter');
                }),
            ]);

            /* Pode haver tela de "continuar" ou consentimento — clica se aparecer */
            await page.waitForTimeout?.(2000).catch(() => new Promise(r => setTimeout(r, 2000)));
            const consent = await page.$('button[jsname="LgbsSe"], #submit_approve_access');
            if (consent) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => null),
                    consent.click(),
                ]);
            }

            /* Garante que voltamos pro GradePen */
            const url = page.url();
            if (!/gradepen\.com/i.test(url)) {
                await page.goto('https://gradepen.com/p/index.php', { waitUntil: 'networkidle2', timeout: 20000 });
            }

            /* Verifica se está logado: faz request de teste no próprio contexto */
            const ok = await page.evaluate(async () => {
                try {
                    const r = await fetch('/p/requests/getAnswers.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                        body: new URLSearchParams({ jobId: '0', index: '0', type: '0' }).toString(),
                    });
                    const j = await r.json().catch(() => ({}));
                    /* Logado: errorCode != 3 (acesso negado por sessão); pode dar erro 'job não existe' (4/5) — qualquer um menos 3 vale */
                    return r.ok && j.errorCode !== 3;
                } catch { return false; }
            });
            if (!ok) throw new Error('Login Google→GradePen não autenticou (verifique se 2FA está desativada).');

            _gpPage    = page;
            _gpPageExp = Date.now() + 25 * 60 * 1000; // 25 min
            console.log('[PROVAS] Login GradePen via Google OK:', email);
        } catch (e) {
            try { await page.close(); } catch {}
            throw e;
        }
    })().finally(() => { _gpLoginLock = null; });

    return _gpLoginLock;
}

async function gpFetchAnswers(jobId, index, retried = false) {
    if (!_gpPage || Date.now() > _gpPageExp) await gpLogin();

    // Serialização por cadeia de promises: cada chamada encadeia na cauda atual,
    // garantindo que apenas UMA execute page.evaluate() por vez mesmo com N waiters.
    // (Solução robusta vs. mutex simples, que permite que N waiters acordem juntos.)
    _gpQueueSize++;
    if (_gpQueueSize > 1) {
        console.log(`[PROVAS] GradePen: ${_gpQueueSize} operações em fila (serializando)`);
    }

    let releaseMutex;
    const waitForPrev = _gpMutexChain;
    _gpMutexChain = new Promise(r => { releaseMutex = r; });

    let j;
    let fetchError = null;
    try {
        await waitForPrev;  // aguarda todos os fetches anteriores terminarem

        j = await _gpPage.evaluate(async (jId, idx) => {
            const r = await fetch('/p/requests/getAnswers.php', {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                body:    new URLSearchParams({ jobId: String(jId), index: String(idx), type: '0' }).toString(),
            });
            const txt = await r.text();
            try { return JSON.parse(txt); } catch { return { __raw: txt.slice(0, 200), __status: r.status }; }
        }, jobId, index);
    } catch (e) {
        fetchError = e;
    } finally {
        _gpQueueSize--;
        releaseMutex();  // libera o próximo waiter na cadeia
    }

    if (fetchError) {
        if (retried) throw fetchError;
        const oldPage = _gpPage;
        _gpPage = null;
        try { await oldPage.close(); } catch {}
        return gpFetchAnswers(jobId, index, true);
    }

    if (j && j.__raw !== undefined) {
        throw new Error('GradePen retornou resposta inválida (status ' + j.__status + ').');
    }
    if (!j || j.success === false) {
        if (!retried && (j.errorCode === 1 || j.errorCode === 2 || j.errorCode === 3)) {
            const oldPage = _gpPage;
            _gpPage = null;
            try { await oldPage.close(); } catch {}
            return gpFetchAnswers(jobId, index, true);
        }
        throw new Error('GradePen recusou: ' + ((j && j.message) || 'erro ' + (j && j.errorCode)));
    }
    return j;
}

/** Retorna estatísticas do scraper GradePen para observabilidade */
export function getGradePenStats() {
    return {
        pageAtiva:        !!_gpPage && Date.now() < _gpPageExp,
        pageExpira:       _gpPageExp ? new Date(_gpPageExp).toISOString() : null,
        fetchNaFila:      _gpQueueSize,
        loginEmAndamento: !!_gpLoginLock,
        ultimoPing:       _gpLastPingTs  ? new Date(_gpLastPingTs).toISOString()  : null,
        ultimoPingOk:     _gpLastPingOk,
    };
}

/* ════════════════════════════════════════════════════════════════════
 *  HEALTH-PING PROATIVO DA SESSÃO GRADEPEN
 *
 *  Roda a cada GP_PING_INTERVAL_MS (padrão 20 min).
 *  Faz um fetch leve de getAnswers.php com jobId=0 dentro do contexto
 *  da página já autenticada.  errorCode !== 3 → sessão válida.
 *  Se falhar ou retornar errorCode=3, invalida _gpPage imediatamente
 *  para que a próxima requisição real dispare um re-login.
 * ═══════════════════════════════════════════════════════════════════ */
const GP_PING_INTERVAL_MS = 20 * 60 * 1000; // 20 minutos

let _gpLastPingTs  = 0;     // timestamp do último ping executado
let _gpLastPingOk  = null;  // true / false / null (nunca pingado)

async function gpHealthPing() {
    /* Não pinga se não há sessão ativa ou se um login já está em curso */
    if (!_gpPage || _gpLoginLock) {
        console.log('[PROVAS][ping] GradePen: sem sessão ativa — ping ignorado.');
        return;
    }

    /* Sessão expirou pela validade local — não é necessário pingar; invalida diretamente */
    if (Date.now() > _gpPageExp) {
        console.log('[PROVAS][ping] GradePen: sessão local expirada — invalidando sem ping.');
        const old = _gpPage;
        _gpPage = null;
        _gpLastPingOk = false;
        _gpLastPingTs = Date.now();
        try { await old.close(); } catch {}
        return;
    }

    /*
     * Serializa o ping através da mesma cadeia de promises que gpFetchAnswers() usa.
     * Isso garante que o ping nunca fecha _gpPage enquanto um evaluate() está em curso,
     * eliminando a condição de corrida: o ping espera a fila esvaziar, depois roda,
     * depois libera para o próximo fetch.
     */
    let releasePingMutex;
    const waitForPrev = _gpMutexChain;
    _gpMutexChain = new Promise(r => { releasePingMutex = r; });

    let ok = false;
    try {
        await waitForPrev; // aguarda todos os fetches anteriores terminarem

        /* Reavalia: pode ter sido invalidado enquanto aguardávamos na fila */
        if (!_gpPage || _gpLoginLock) {
            console.log('[PROVAS][ping] GradePen: sessão desapareceu enquanto aguardava — ping ignorado.');
            return;
        }

        _gpLastPingTs = Date.now();

        ok = await _gpPage.evaluate(async () => {
            try {
                const r = await fetch('/p/requests/getAnswers.php', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                    body:    new URLSearchParams({ jobId: '0', index: '0', type: '0' }).toString(),
                });
                const j = await r.json().catch(() => ({}));
                /* errorCode 3 = sessão negada; 4/5 = job inexistente (ok para nós) */
                return r.ok && j.errorCode !== 3;
            } catch { return false; }
        });
    } catch (e) {
        console.error('[PROVAS][ping] GradePen: erro durante ping —', e.message);
        ok = false;
    } finally {
        releasePingMutex(); // libera o próximo waiter na cadeia
    }

    _gpLastPingOk = ok;

    if (ok) {
        console.log('[PROVAS][ping] GradePen: sessão OK —', new Date().toISOString());
    } else {
        console.warn('[PROVAS][ping] GradePen: sessão INVÁLIDA — invalidando _gpPage para forçar re-login na próxima requisição.');
        const old = _gpPage;
        _gpPage = null;
        try { await old.close(); } catch {}
    }
}

/* Inicia o ping periódico assim que o módulo é carregado */
setInterval(() => {
    gpHealthPing().catch(e => console.error('[PROVAS][ping] GradePen: falha inesperada no health-ping —', e.message));
}, GP_PING_INTERVAL_MS);

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
export function createProvasRouter({ getClassroomAuth } = {}) {
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

            /* Calcula pares suspeitos (≥70% de similaridade) para cada prova.
             * Apenas quando o cliente envia includeSuspiciousSummary=1 para evitar
             * overhead desnecessário em integrações que não precisam do dado. */
            const provaIds = rows.map(p => p.id);
            let suspeitos = {};
            const querySummary = req.query.includeSuspiciousSummary === '1';

            if (querySummary && provaIds.length > 0) {
                const { rows: subs } = await pool.query(
                    `SELECT s.prova_id, s.variante_id, v.gabarito_json,
                            s.aluno_email, s.marcacoes_json
                       FROM classroom_prova_submissoes s
                       JOIN classroom_prova_variantes v ON v.id = s.variante_id
                      WHERE s.prova_id = ANY($1) AND s.eh_segundo_corretor = false`,
                    [provaIds]
                );

                /* Agrupa por prova → variante */
                const byProvaVariante = {};
                for (const s of subs) {
                    const key = `${s.prova_id}:${s.variante_id}`;
                    if (!byProvaVariante[key]) {
                        byProvaVariante[key] = { provaId: s.prova_id, gabarito: s.gabarito_json, alunos: [] };
                    }
                    byProvaVariante[key].alunos.push({ email: s.aluno_email, marcacoes: s.marcacoes_json || {} });
                }

                /* Conta pares suspeitos por prova */
                for (const { provaId, gabarito, alunos } of Object.values(byProvaVariante)) {
                    if (alunos.length < 2 || !gabarito) continue;

                    const questoesComp = gabarito.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
                    if (questoesComp.length === 0) continue;

                    for (let i = 0; i < alunos.length; i++) {
                        for (let j = i + 1; j < alunos.length; j++) {
                            const marcA = alunos[i].marcacoes;
                            const marcB = alunos[j].marcacoes;
                            let identicas = 0;

                            for (const q of questoesComp) {
                                const qStr = String(q.questao);
                                const respA = marcA[qStr] ?? null;
                                const respB = marcB[qStr] ?? null;
                                if (respA === null || respB === null) continue;
                                const normA = Array.isArray(respA) ? respA.map(x => String(x).toUpperCase()).join(',') : String(respA).toLowerCase();
                                const normB = Array.isArray(respB) ? respB.map(x => String(x).toUpperCase()).join(',') : String(respB).toLowerCase();
                                if (normA === normB) identicas++;
                            }

                            const similaridade = Math.round((identicas / questoesComp.length) * 100);
                            if (similaridade >= 70) {
                                suspeitos[provaId] = (suspeitos[provaId] || 0) + 1;
                            }
                        }
                    }
                }
            }

            const provas = rows.map(p => ({ ...p, pares_suspeitos: suspeitos[p.id] || 0 }));
            res.json({ provas });
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
            permitirOutraTurma = false,
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
                    permitir_outra_turma, criada_por_cpf, criada_por_nome)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 RETURNING *`,
                [courseId, String(gradepenId), nome, grupoDestinoId || null, dataAplicacao || null,
                 fotoModo, fotoSorteioPct, !!segundoCorretorAtivo, segundoCorretorPct,
                 !!permitirOutraTurma, req.userSession?.cpf || null, req.userSession?.nome || null]
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
                        'foto_sorteio_pct', 'segundo_corretor_ativo', 'segundo_corretor_pct',
                        'permitir_outra_turma'];
        const map = {
            nome: 'nome', grupoDestinoId: 'grupo_destino_id', dataAplicacao: 'data_aplicacao',
            fotoModo: 'foto_modo', fotoSorteioPct: 'foto_sorteio_pct',
            segundoCorretorAtivo: 'segundo_corretor_ativo', segundoCorretorPct: 'segundo_corretor_pct',
            permitirOutraTurma: 'permitir_outra_turma',
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

    /* Efetiva: marca provas como definitivas + distribui XP (precisão 2cor + variante correta aluno) */
    router.post('/classroom/provas/:id/efetivar', async (req, res) => {
        try {
            await pool.query(`UPDATE classroom_provas SET efetivada = true WHERE id = $1`, [req.params.id]);

            /* Carrega submissões principais (1º corretor) ainda sem XP de efetivação creditado */
            const { rows: principais } = await pool.query(
                `SELECT id, aluno_email, aluno_nome, nota, variante_id, variante_id_original
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_segundo_corretor = false AND xp_creditado_efetiv = false`,
                [req.params.id]
            );

            const xpStats = { aluno: 0, corretor: 0, contagem: { perfeita: 0, precisa: 0, ok: 0, longe: 0, desviante: 0 } };

            for (const p of principais) {
                /* Aluno: variante correta de primeira (não foi trocada pelo prof) */
                if (p.variante_id_original && p.variante_id === p.variante_id_original) {
                    try {
                        const r = await reputacao.creditar({
                            alunoEmail: p.aluno_email, alunoNome: p.aluno_nome,
                            evento: 'VARIANTE_CORRETA', submissaoId: p.id,
                        });
                        if (r.creditado) xpStats.aluno += r.xp;
                    } catch (e) { console.warn('[REPUTACAO] variante correta:', e.message); }
                }

                /* Corretor: pega 2ª(s) correção(ões) dessa submissão e calcula divergência */
                const { rows: secundas } = await pool.query(
                    `SELECT id, aluno_email, aluno_nome, nota
                       FROM classroom_prova_submissoes
                      WHERE submissao_ref_id = $1 AND eh_segundo_corretor = true`,
                    [p.id]
                );
                for (const sc of secundas) {
                    const div = Math.abs(Number(sc.nota || 0) - Number(p.nota || 0));
                    let evento;
                    if      (div <= 0.3) { evento = 'CORRECAO_PERFEITA'; xpStats.contagem.perfeita++; }
                    else if (div <= 0.7) { evento = 'CORRECAO_PRECISA';  xpStats.contagem.precisa++; }
                    else if (div <= 1.5) { evento = 'CORRECAO_OK';       xpStats.contagem.ok++; }
                    else if (div <= 3.0) { evento = 'CORRECAO_LONGE';    xpStats.contagem.longe++; }
                    else                 { evento = 'CORRECAO_DESVIANTE'; xpStats.contagem.desviante++; }
                    try {
                        const r = await reputacao.creditar({
                            alunoEmail: sc.aluno_email, alunoNome: sc.aluno_nome,
                            evento, submissaoId: sc.id,
                            detalhes: { divergencia: Number(div.toFixed(2)), notaOficial: Number(p.nota), notaCorretor: Number(sc.nota) },
                        });
                        if (r.creditado) xpStats.corretor += r.xp;
                    } catch (e) { console.warn('[REPUTACAO] precisão 2cor:', e.message); }
                }

                await pool.query(`UPDATE classroom_prova_submissoes SET xp_creditado_efetiv = true WHERE id = $1`, [p.id]);
            }

            logProvas(req, 'PROVA_EFETIVAR', { provaId: req.params.id, xpStats });
            res.json({ ok: true, xpStats });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Professor confere foto: ok / divergente — apenas dono da prova ou admin */
    router.post('/classroom/provas/submissoes/:subId/conferir-foto', async (req, res) => {
        const { ok } = req.body || {};
        if (typeof ok !== 'boolean') return res.status(400).json({ erro: 'body.ok deve ser boolean.' });
        const cpfSessao = req.userSession?.cpf;
        const perfil    = req.userSession?.perfil;
        try {
            const { rows: [sub] } = await pool.query(
                `SELECT s.id, s.aluno_email, s.aluno_nome, s.foto_conferida, p.criada_por_cpf
                   FROM classroom_prova_submissoes s
                   JOIN classroom_provas p ON p.id = s.prova_id
                  WHERE s.id = $1`,
                [req.params.subId]
            );
            if (!sub) return res.status(404).json({ erro: 'Submissão não encontrada.' });
            /* Estrito: apenas admin OU dono da prova com CPF na sessão e CPF não-nulo na prova */
            if (perfil !== 'admin') {
                if (!cpfSessao || !sub.criada_por_cpf || sub.criada_por_cpf !== cpfSessao) {
                    return res.status(403).json({ erro: 'Apenas o professor dono da prova pode conferir a foto.' });
                }
            }
            const novoStatus = ok ? 'ok' : 'divergente';
            if (sub.foto_conferida === novoStatus) {
                return res.json({ ok: true, jaConferida: true });
            }
            await pool.query(`UPDATE classroom_prova_submissoes SET foto_conferida = $1 WHERE id = $2`, [novoStatus, sub.id]);
            const evento = ok ? 'FOTO_OK' : 'FOTO_DIVERGENTE';
            const r = await reputacao.creditar({
                alunoEmail: sub.aluno_email, alunoNome: sub.aluno_nome,
                evento, submissaoId: sub.id,
            });
            logProvas(req, 'PROVA_CONFERIR_FOTO', { submissaoId: sub.id, status: novoStatus, xp: r.xp });
            res.json({ ok: true, status: novoStatus, xpCreditado: r.creditado, xp: r.xp, badgesGanhas: r.badgesGanhas });
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

            /* Carrega config de cross-turma da prova */
            const { rows: [provaCfg] } = await pool.query(
                `SELECT permitir_outra_turma, criada_por_cpf FROM classroom_provas WHERE id = $1`,
                [sub.prova_id]
            );

            /* Candidatos:
             *  - sempre: alunos da MESMA prova com OUTRA variante (≠ do aluno auditado)
             *  - se permitir_outra_turma: também alunos que submeteram QUALQUER outra prova
             *    do MESMO professor (filtra por criada_por_cpf). Variante não importa pois
             *    o gabarito que o corretor vê vem da prova original.
             */
            let candidatos;
            if (provaCfg?.permitir_outra_turma && provaCfg?.criada_por_cpf) {
                ({ rows: candidatos } = await pool.query(
                    `SELECT DISTINCT ON (s.aluno_email) s.aluno_email, s.aluno_nome
                       FROM classroom_prova_submissoes s
                       JOIN classroom_provas p ON p.id = s.prova_id
                      WHERE s.aluno_email <> $1
                        AND s.eh_segundo_corretor = false
                        AND p.criada_por_cpf = $2
                        AND (s.prova_id <> $3 OR s.variante_id <> $4)
                        AND NOT EXISTS (
                            SELECT 1 FROM classroom_prova_submissoes c
                             WHERE c.submissao_ref_id = $5
                               AND c.eh_segundo_corretor = true
                               AND c.aluno_email = s.aluno_email
                        )`,
                    [sub.aluno_email, provaCfg.criada_por_cpf, sub.prova_id, sub.variante_id, sub.id]
                ));
            } else {
                ({ rows: candidatos } = await pool.query(
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
                ));
            }
            if (candidatos.length === 0) {
                return res.status(409).json({ erro: 'Sem candidatos disponíveis (mesma variante, sem outras turmas elegíveis ou já corrigindo).' });
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

    /* Trocar a variante de uma submissão (caso o aluno tenha marcado errado).
       Recalcula a nota usando o gabarito da nova variante. NÃO mexe nas marcações. */
    router.put('/classroom/provas/submissoes/:subId/variante', async (req, res) => {
        const { varianteId } = req.body || {};
        if (!varianteId) return res.status(400).json({ erro: 'varianteId obrigatório.' });
        const cpfSessao = req.userSession?.cpf;
        const perfil    = req.userSession?.perfil;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: [sub] } = await client.query(
                `SELECT s.*, p.criada_por_cpf
                   FROM classroom_prova_submissoes s
                   JOIN classroom_provas p ON p.id = s.prova_id
                  WHERE s.id = $1
                  FOR UPDATE`,
                [req.params.subId]
            );
            if (!sub) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Submissão não encontrada.' }); }
            /* Apenas o professor dono da prova ou um admin pode mexer */
            if (perfil !== 'admin' && sub.criada_por_cpf && cpfSessao && sub.criada_por_cpf !== cpfSessao) {
                await client.query('ROLLBACK');
                return res.status(403).json({ erro: 'Sem permissão pra alterar submissões de prova de outro professor.' });
            }
            if (sub.eh_segundo_corretor) {
                await client.query('ROLLBACK');
                return res.status(400).json({ erro: 'Não dá pra trocar variante de uma 2ª correção (apague-a e re-sorteie).' });
            }
            const { rows: [variante] } = await client.query(
                `SELECT * FROM classroom_prova_variantes WHERE id = $1 AND prova_id = $2`,
                [varianteId, sub.prova_id]
            );
            if (!variante) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Variante inválida pra esta prova.' }); }
            if (variante.id === sub.variante_id) {
                await client.query('ROLLBACK');
                return res.json({ ok: true, semMudanca: true, nota: sub.nota, total_max: sub.total_max });
            }
            const { nota, total } = calcularNota(variante.gabarito_json, sub.marcacoes_json || {});
            await client.query(
                `UPDATE classroom_prova_submissoes
                    SET variante_id = $1, nota = $2, total_max = $3
                  WHERE id = $4`,
                [variante.id, nota, total, sub.id]
            );
            /* Se houver 2ª correção atrelada, ela ficou inválida (gabarito mudou) — apaga. */
            const { rowCount: removidas } = await client.query(
                `DELETE FROM classroom_prova_submissoes
                  WHERE submissao_ref_id = $1 AND eh_segundo_corretor = true`,
                [sub.id]
            );
            await client.query('COMMIT');
            logProvas(req, 'PROVA_TROCAR_VARIANTE', {
                submissaoId: sub.id, de: sub.variante_id, para: variante.id,
                novaNota: nota, segundasRemovidas: removidas
            });
            res.json({ ok: true, nota, total_max: total, segundasRemovidas: removidas });
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            res.status(500).json({ erro: e.message });
        } finally {
            client.release();
        }
    });

    /* Publica/atualiza um Material no Classroom com o link da prova (auto-preenche ansid). */
    router.post('/classroom/provas/:id/publicar-classroom', async (req, res) => {
        if (!getClassroomAuth) return res.status(500).json({ erro: 'Integração Classroom não inicializada.' });
        try {
            const { rows: [prova] } = await pool.query(
                `SELECT * FROM classroom_provas WHERE id = $1`, [req.params.id]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            const auth = await getClassroomAuth(req);
            if (!auth) return res.status(401).json({ erro: 'Conecte-se ao Google Classroom primeiro.' });

            /* Usa o host do request (reflete o domínio real: prod, custom domain, ou dev).
               Cai no REPLIT_DEV_DOMAIN só se por algum motivo o header não vier. */
            const host    = req.get('host') || process.env.REPLIT_DEV_DOMAIN;
            const proto   = (req.protocol === 'https' || (host && !host.includes('localhost'))) ? 'https' : 'http';
            const baseUrl = `${proto}://${host}`;
            const linkProva = `${baseUrl}/alunos/prova/?ansid=${encodeURIComponent(prova.gradepen_id)}`;

            const { google } = await import('googleapis');
            const classroom  = google.classroom({ version: 'v1', auth });

            /* Calcula dueDate: usa data_aplicacao se houver, senão +7 dias.
               Vence sempre 23:59 do fuso UTC-3 (Brasília) → 02:59 UTC do dia seguinte. */
            const dueRaw = prova.data_aplicacao ? new Date(prova.data_aplicacao) : new Date(Date.now() + 7*86400_000);
            const dueDate = {
                year:  dueRaw.getUTCFullYear(),
                month: dueRaw.getUTCMonth() + 1,
                day:   dueRaw.getUTCDate(),
            };
            const dueTime = { hours: 23, minutes: 59 };

            /* Permite override pontual de pontos via body (default = pontos_avaliacao da prova) */
            const maxPoints = Number(req.body?.pontosMeta) || Number(prova.pontos_avaliacao) || 6.0;

            /* Cria (ou reusa) um grupo dedicado APENAS para essa avaliação.
               Separado do grupo_destino_id (que normalmente é o de "atividades 4 pts").
               Trimestre/ano deduzidos da data_aplicacao (ou data atual). */
            let grupoAvaliacaoId = prova.grupo_avaliacao_id;
            const refDate   = prova.data_aplicacao ? new Date(prova.data_aplicacao) : new Date();
            const ano       = refDate.getUTCFullYear();
            const mes       = refDate.getUTCMonth() + 1;
            const trimestre = mes <= 4 ? 1 : (mes <= 8 ? 2 : 3);

            if (!grupoAvaliacaoId) {
                const { rows: [novoGrupo] } = await pool.query(
                    `INSERT INTO classroom_grupos (curso_id, nome, pontos_meta, cor, trimestre, ano)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     RETURNING id`,
                    [prova.curso_id, `Avaliação — ${prova.nome}`, maxPoints, '#E91E63', trimestre, ano]
                );
                grupoAvaliacaoId = novoGrupo.id;
                await pool.query(
                    `UPDATE classroom_provas SET grupo_avaliacao_id = $1, pontos_avaliacao = $2 WHERE id = $3`,
                    [grupoAvaliacaoId, maxPoints, prova.id]
                );
            } else {
                /* Atualiza pontos_meta do grupo se mudou */
                await pool.query(
                    `UPDATE classroom_grupos SET pontos_meta = $1 WHERE id = $2`,
                    [maxPoints, grupoAvaliacaoId]
                );
                await pool.query(
                    `UPDATE classroom_provas SET pontos_avaliacao = $1 WHERE id = $2`,
                    [maxPoints, prova.id]
                );
            }

            const courseWork = {
                title:       `📝 ${prova.nome}`,
                description: `Prova de papel + correção online no EduSync.\n\nDepois de fazer a prova, abra o link abaixo no celular ou computador, faça login com seu e-mail @escola e marque exatamente o que respondeu na folha. A variante (.0 / .1 / etc) está no canto da folha — escolha a mesma!\n\n${linkProva}`,
                materials:   [{ link: { url: linkProva, title: 'Abrir folha de correção EduSync' } }],
                workType:    'ASSIGNMENT',
                state:       'PUBLISHED',
                maxPoints,
                dueDate,
                dueTime,
            };

            const r = await classroom.courses.courseWork.create({
                courseId: prova.curso_id,
                requestBody: courseWork,
            });

            /* Vincula a atividade ao grupo dedicado da avaliação */
            await pool.query(
                `INSERT INTO classroom_grupo_atividades (grupo_id, atividade_id, atividade_titulo, pontos_max)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (grupo_id, atividade_id) DO NOTHING`,
                [grupoAvaliacaoId, r.data.id, courseWork.title, maxPoints]
            );

            logProvas(req, 'PROVA_PUBLICAR_CLASSROOM', {
                provaId: prova.id, atividadeId: r.data.id, link: linkProva,
                grupoAvaliacaoId, maxPoints, trimestre, ano,
            });
            res.json({
                ok: true,
                atividadeId:    r.data.id,
                link:           linkProva,
                alternateLink:  r.data.alternateLink,
                grupoAvaliacaoId,
                maxPoints,
                dueDate,
                trimestre,
                ano,
            });
        } catch (e) {
            console.error('[PROVAS] Erro ao publicar no Classroom:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* Análise de cola: comparação pairwise de marcações dentro da mesma variante */
    router.get('/classroom/provas/:id/analise-cola', async (req, res) => {
        try {
            const provaId = req.params.id;

            /* Carrega variantes com gabarito */
            const { rows: variantes } = await pool.query(
                `SELECT id, codigo, gabarito_json FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                [provaId]
            );
            if (variantes.length === 0) return res.status(404).json({ erro: 'Prova não encontrada.' });

            /* Carrega submissões primárias (não 2º corretores) */
            const { rows: submissoes } = await pool.query(
                `SELECT id, variante_id, aluno_email, aluno_nome, marcacoes_json
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_segundo_corretor = false
                  ORDER BY variante_id, aluno_email`,
                [provaId]
            );

            /* Monta mapa variante_id → gabarito_json */
            const gabMap = {};
            for (const v of variantes) gabMap[v.id] = { codigo: v.codigo, gabarito: v.gabarito_json };

            /* Agrupa submissões por variante */
            const porVariante = {};
            for (const s of submissoes) {
                if (!porVariante[s.variante_id]) porVariante[s.variante_id] = [];
                porVariante[s.variante_id].push(s);
            }

            const pares = [];

            for (const [varId, subs] of Object.entries(porVariante)) {
                if (subs.length < 2) continue;
                const { codigo, gabarito } = gabMap[varId] || {};
                if (!gabarito) continue;

                /* Filtra apenas questões comparáveis (multipla e vf) */
                const questoesComp = gabarito.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
                if (questoesComp.length === 0) continue;

                /* Comparação pairwise */
                for (let i = 0; i < subs.length; i++) {
                    for (let j = i + 1; j < subs.length; j++) {
                        const a = subs[i];
                        const b = subs[j];
                        const marcA = a.marcacoes_json || {};
                        const marcB = b.marcacoes_json || {};

                        let identicas = 0;
                        let identicasErradas = 0;
                        const detalhes = [];

                        for (const q of questoesComp) {
                            const qStr = String(q.questao);
                            const respA = marcA[qStr] ?? null;
                            const respB = marcB[qStr] ?? null;

                            /* Normaliza para comparação */
                            const normA = Array.isArray(respA) ? respA.map(x => String(x).toUpperCase()).join(',') : String(respA ?? '').toLowerCase();
                            const normB = Array.isArray(respB) ? respB.map(x => String(x).toUpperCase()).join(',') : String(respB ?? '').toLowerCase();

                            const igual = respA !== null && respB !== null && normA === normB;

                            /* Verifica se a resposta é correta */
                            let corrA = false;
                            let corrB = false;
                            if (q.tipo === 'multipla') {
                                const correta = String(q.correta || '').toLowerCase();
                                corrA = String(respA ?? '').toLowerCase() === correta;
                                corrB = String(respB ?? '').toLowerCase() === correta;
                            } else if (q.tipo === 'vf') {
                                if (Array.isArray(q.correta)) {
                                    corrA = Array.isArray(respA) && respA.length === q.correta.length &&
                                            respA.every((v, k) => String(v).toUpperCase() === String(q.correta[k]).toUpperCase());
                                    corrB = Array.isArray(respB) && respB.length === q.correta.length &&
                                            respB.every((v, k) => String(v).toUpperCase() === String(q.correta[k]).toUpperCase());
                                }
                            }

                            const amboserram = igual && !corrA && !corrB;
                            if (igual) identicas++;
                            if (amboserram) identicasErradas++;

                            detalhes.push({
                                questao:         q.questao,
                                tipo:            q.tipo,
                                correta:         q.correta,
                                respA,
                                respB,
                                igual,
                                amboserram,
                            });
                        }

                        const total = questoesComp.length;
                        const similaridade = total > 0 ? Math.round((identicas / total) * 100) : 0;

                        pares.push({
                            alunoA:           a.aluno_email,
                            nomeA:            a.aluno_nome || a.aluno_email,
                            alunoB:           b.aluno_email,
                            nomeB:            b.aluno_nome || b.aluno_email,
                            varianteCodigo:   codigo,
                            total,
                            identicas,
                            identicasErradas,
                            similaridade,
                            detalhes,
                        });
                    }
                }
            }

            /* Ordena por suspeita decrescente */
            pares.sort((a, b) => {
                if (b.identicasErradas !== a.identicasErradas) return b.identicasErradas - a.identicasErradas;
                return b.similaridade - a.similaridade;
            });

            /* Informa se há questões discursivas na prova (para nota de rodapé) */
            const temDiscursiva = variantes.some(v =>
                (v.gabarito_json || []).some(q => q.tipo === 'discursiva')
            );

            res.json({ pares, temDiscursiva });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Apagar a submissão de um aluno (libera ele para refazer do zero) */
    router.delete('/classroom/provas/submissoes/:subId', async (req, res) => {
        const cpfSessao = req.userSession?.cpf;
        const perfil    = req.userSession?.perfil;
        try {
            const { rows: [sub] } = await pool.query(
                `SELECT s.id, s.prova_id, s.aluno_email, s.eh_segundo_corretor, p.criada_por_cpf
                   FROM classroom_prova_submissoes s
                   JOIN classroom_provas p ON p.id = s.prova_id
                  WHERE s.id = $1`,
                [req.params.subId]
            );
            if (!sub) return res.status(404).json({ erro: 'Submissão não encontrada.' });
            if (perfil !== 'admin' && sub.criada_por_cpf && cpfSessao && sub.criada_por_cpf !== cpfSessao) {
                return res.status(403).json({ erro: 'Sem permissão pra apagar submissões de prova de outro professor.' });
            }
            /* CASCADE de submissao_ref_id apaga as 2ªs correções vinculadas automaticamente */
            await pool.query(`DELETE FROM classroom_prova_submissoes WHERE id = $1`, [sub.id]);
            logProvas(req, 'PROVA_APAGAR_SUBMISSAO', {
                submissaoId: sub.id, provaId: sub.prova_id, aluno: sub.aluno_email,
                era2Corretor: sub.eh_segundo_corretor
            });
            res.json({ ok: true });
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
                   (prova_id, variante_id, variante_id_original, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent,
                    foto_url, foto_obrigatoria)
                 VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING id, criada_em`,
                [prova.id, variante.id, aluno.email, aluno.nome,
                 JSON.stringify(marcacoes), nota, total,
                 req.ip, req.get('user-agent') || '',
                 fotoUrlSalva, fotoObrig]
            );

            /* ── Gamificação: XP imediato do 1º corretor ── */
            const xpEventos = [];
            try {
                const provaCriadaEm = prova.criada_em ? new Date(prova.criada_em) : null;
                const horasDesdeCriacao = provaCriadaEm ? (Date.now() - provaCriadaEm.getTime()) / 3600000 : 999;
                if (horasDesdeCriacao <= 24) {
                    const r1 = await reputacao.creditar({ alunoEmail: aluno.email, alunoNome: aluno.nome, evento: 'SUBMISSAO_RAPIDA', submissaoId: sub.id });
                    if (r1.creditado) xpEventos.push(r1);
                } else {
                    const r2 = await reputacao.creditar({ alunoEmail: aluno.email, alunoNome: aluno.nome, evento: 'SUBMISSAO_NO_PRAZO', submissaoId: sub.id });
                    if (r2.creditado) xpEventos.push(r2);
                }
            } catch (e) { console.warn('[REPUTACAO] aluno submissão:', e.message); }

            res.json({
                xpGanho: xpEventos.reduce((acc, e) => acc + (e.xp || 0), 0),
                xpDetalhes: xpEventos.map(e => ({ evento: e.evento, xp: e.xp, rotulo: EVENTOS[e.evento]?.rotulo })),
                badgesGanhas: xpEventos.flatMap(e => e.badgesGanhas || []),
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
                    AND n.tipo IN ('segundo_corretor','segundo_corretor_voluntario')
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
                  WHERE aluno_email = $1
                    AND tipo IN ('segundo_corretor','segundo_corretor_voluntario')
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
            /* Detecta se é correção voluntária (notif tipo 'segundo_corretor_voluntario') */
            const { rows: [notifTipo] } = await pool.query(
                `SELECT tipo FROM notificacoes_aluno
                  WHERE aluno_email = $1 AND (dados->>'submissaoRefId')::int = $2
                  ORDER BY criado_em DESC LIMIT 1`,
                [aluno.email, ref.id]
            );
            const ehVoluntaria = notifTipo?.tipo === 'segundo_corretor_voluntario';

            const { rows: [novaSub] } = await pool.query(
                `INSERT INTO classroom_prova_submissoes
                   (prova_id, variante_id, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent,
                    eh_segundo_corretor, submissao_ref_id, voluntaria)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11) RETURNING id`,
                [ref.prova_id, ref.variante_id_real, aluno.email, aluno.nome,
                 JSON.stringify(marcacoes), nota, total,
                 req.ip, req.get('user-agent') || '', ref.id, ehVoluntaria]
            );

            /* XP imediato base do corretor (precisão vem na efetivação) */
            const xpEventos = [];
            try {
                const r1 = await reputacao.creditar({ alunoEmail: aluno.email, alunoNome: aluno.nome, evento: 'CORRECAO_ENVIADA', submissaoId: novaSub.id });
                if (r1.creditado) xpEventos.push(r1);
                if (ehVoluntaria) {
                    const r2 = await reputacao.creditar({ alunoEmail: aluno.email, alunoNome: aluno.nome, evento: 'CORRECAO_VOLUNTARIA', submissaoId: novaSub.id });
                    if (r2.creditado) xpEventos.push(r2);
                }
            } catch (e) { console.warn('[REPUTACAO] 2cor enviada:', e.message); }

            /* Marca a notificação como lida (cobre ambos os tipos) */
            await pool.query(
                `UPDATE notificacoes_aluno SET lida = true
                  WHERE aluno_email = $1 AND tipo IN ('segundo_corretor','segundo_corretor_voluntario')
                    AND (dados->>'submissaoRefId')::int = $2`,
                [aluno.email, ref.id]
            );

            res.json({
                ok: true,
                xpGanho: xpEventos.reduce((a, e) => a + (e.xp || 0), 0),
                xpDetalhes: xpEventos.map(e => ({ evento: e.evento, xp: e.xp, rotulo: EVENTOS[e.evento]?.rotulo })),
                badgesGanhas: xpEventos.flatMap(e => e.badgesGanhas || []),
                aviso: 'XP de precisão será creditado quando o professor efetivar a prova.',
            });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ════════════════════════════════════════════════════════════════
     *  GAMIFICAÇÃO — endpoints públicos do portal aluno
     * ════════════════════════════════════════════════════════════════ */

    /* Resumo de reputação do aluno logado */
    router.get('/alunos-portal/reputacao', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const resumo = await reputacao.getResumo(aluno.email);
            res.json(resumo);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* Lista provas em que o aluno pode se voluntariar como 2º corretor.
     * Regras:
     *  - prova com segundo_corretor_ativo=true e não efetivada
     *  - aluno não submeteu a prova
     *  - aluno não atingiu 2 correções nessa prova
     *  - aluno não atingiu 3 tarefas pendentes (sortição+voluntárias)
     *  - existe ao menos 1 submissão alvo elegível
     */
    router.get('/alunos-portal/voluntariar/disponiveis', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            /* Quantas pendências o aluno já tem? */
            const { rows: [{ pend }] } = await pool.query(
                `SELECT COUNT(*)::int AS pend FROM notificacoes_aluno n
                  WHERE n.aluno_email = $1
                    AND n.tipo IN ('segundo_corretor','segundo_corretor_voluntario')
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = (n.dados->>'submissaoRefId')::int
                           AND c.aluno_email = $1
                           AND c.eh_segundo_corretor = true
                    )`,
                [aluno.email]
            );
            const limitePend = 3;
            const podePegar = Math.max(0, limitePend - pend);
            if (podePegar === 0) return res.json({ podePegar: 0, pend, provas: [] });

            const { rows: provas } = await pool.query(
                `SELECT p.id, p.nome, p.curso_id, p.criada_em,
                        (SELECT COUNT(*) FROM classroom_prova_submissoes s
                          WHERE s.prova_id = p.id AND s.eh_segundo_corretor = false) AS qtd_submetidas,
                        (SELECT COUNT(*) FROM classroom_prova_submissoes s
                          WHERE s.prova_id = p.id AND s.aluno_email = $1
                            AND s.eh_segundo_corretor = true) AS minhas_correcoes
                   FROM classroom_provas p
                  WHERE p.segundo_corretor_ativo = true
                    AND p.efetivada = false
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes s
                         WHERE s.prova_id = p.id AND s.aluno_email = $1 AND s.eh_segundo_corretor = false
                    )
                    AND EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes s
                         WHERE s.prova_id = p.id AND s.eh_segundo_corretor = false
                           AND s.aluno_email <> $1
                           AND (
                               SELECT COUNT(*) FROM classroom_prova_submissoes c
                                WHERE c.submissao_ref_id = s.id AND c.eh_segundo_corretor = true
                           ) < 2
                           AND NOT EXISTS (
                               SELECT 1 FROM classroom_prova_submissoes c
                                WHERE c.submissao_ref_id = s.id AND c.eh_segundo_corretor = true
                                  AND c.aluno_email = $1
                           )
                    )
                  ORDER BY p.criada_em DESC LIMIT 10`,
                [aluno.email]
            );
            const elegiveis = provas.filter(p => Number(p.minhas_correcoes) < 2);
            res.json({ podePegar, pend, provas: elegiveis });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* Pega uma correção voluntária: sorteia uma submissão alvo elegível e cria notif */
    router.post('/alunos-portal/voluntariar/:provaId', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            /* Limite de 3 voluntárias/dia */
            const { rows: [{ hoje }] } = await client.query(
                `SELECT COUNT(*)::int AS hoje FROM notificacoes_aluno
                  WHERE aluno_email = $1 AND tipo = 'segundo_corretor_voluntario'
                    AND criado_em > NOW() - INTERVAL '24 hours'`,
                [aluno.email]
            );
            if (hoje >= 3) { await client.query('ROLLBACK'); return res.status(429).json({ erro: 'Limite de 3 correções voluntárias por dia atingido.' }); }

            /* (a) Aluno NÃO submeteu essa prova */
            const { rows: [{ subm }] } = await client.query(
                `SELECT COUNT(*)::int AS subm FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false`,
                [req.params.provaId, aluno.email]
            );
            if (subm > 0) { await client.query('ROLLBACK'); return res.status(409).json({ erro: 'Você já fez essa prova; não pode corrigi-la.' }); }

            /* (b) <2 correções nessa prova */
            const { rows: [{ jaFez }] } = await client.query(
                `SELECT COUNT(*)::int AS "jaFez" FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = true`,
                [req.params.provaId, aluno.email]
            );
            if (jaFez >= 2) { await client.query('ROLLBACK'); return res.status(409).json({ erro: 'Você já corrigiu o limite de 2 provas neste exame.' }); }

            /* (c) <3 pendências totais */
            const { rows: [{ pend }] } = await client.query(
                `SELECT COUNT(*)::int AS pend FROM notificacoes_aluno n
                  WHERE n.aluno_email = $1
                    AND n.tipo IN ('segundo_corretor','segundo_corretor_voluntario')
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = (n.dados->>'submissaoRefId')::int
                           AND c.aluno_email = $1 AND c.eh_segundo_corretor = true
                    )`,
                [aluno.email]
            );
            if (pend >= 3) { await client.query('ROLLBACK'); return res.status(429).json({ erro: 'Você já tem 3 correções pendentes; conclua-as antes.' }); }

            /* Confirma elegibilidade e bloqueia a submissão alvo (FOR UPDATE SKIP LOCKED para evitar corrida) */
            const { rows: alvos } = await client.query(
                `SELECT s.id, s.variante_id, s.aluno_email
                   FROM classroom_prova_submissoes s
                   JOIN classroom_provas p ON p.id = s.prova_id
                  WHERE p.id = $1 AND p.segundo_corretor_ativo = true AND p.efetivada = false
                    AND s.eh_segundo_corretor = false
                    AND s.aluno_email <> $2
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = s.id AND c.aluno_email = $2 AND c.eh_segundo_corretor = true
                    )
                    AND (
                        SELECT COUNT(*) FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = s.id AND c.eh_segundo_corretor = true
                    ) < 2
                  ORDER BY (
                        SELECT COUNT(*) FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = s.id AND c.eh_segundo_corretor = true
                  ) ASC, RANDOM()
                  LIMIT 1
                  FOR UPDATE OF s SKIP LOCKED`,
                [req.params.provaId, aluno.email]
            );
            if (alvos.length === 0) { await client.query('ROLLBACK'); return res.status(409).json({ erro: 'Sem submissões disponíveis para corrigir nessa prova.' }); }
            const alvo = alvos[0];

            await client.query(
                `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
                 VALUES ($1,'segundo_corretor_voluntario',$2,$3,$4,$5)`,
                [aluno.email, String(alvo.id),
                 '🤝 Correção voluntária aceita!',
                 'Você se voluntariou para uma 2ª correção. Acesse pela sua lista de tarefas. (XP em dobro!)',
                 JSON.stringify({ submissaoRefId: alvo.id, provaId: Number(req.params.provaId), voluntaria: true })]
            );
            await client.query('COMMIT');
            res.json({ ok: true, submissaoRefId: alvo.id });
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            res.status(500).json({ erro: e.message });
        } finally {
            client.release();
        }
    });

    return router;
}
