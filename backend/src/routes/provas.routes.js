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
import fs         from 'fs';
import { auditLogger }      from '../services/AuditLogger.js';
import { getBrowser }       from '../../auth-puppeteer.js';
import { ReputacaoService, EVENTOS, BADGES, RANKS, getRank } from '../services/reputacao.service.js';
import { checarColaPosSubmissao } from '../services/colaCheck.js';
import { recordGpError } from '../services/gpErrorAlertJob.js';
import { requireModulo } from '../middleware/auth.middleware.js';

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
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS link_prova TEXT`);
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS link_prova_paginas JSONB`);
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_provasub_2cor_unico
                ON classroom_prova_submissoes(submissao_ref_id, aluno_email)
                WHERE eh_segundo_corretor = true
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_prova ON classroom_prova_submissoes(prova_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_email ON classroom_prova_submissoes(aluno_email)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_provasub_ref   ON classroom_prova_submissoes(submissao_ref_id)`);
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS turma_corretora_id TEXT`);
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS turma_corretora_2a_correcao BOOLEAN NOT NULL DEFAULT false`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS eh_turma_corretora BOOLEAN NOT NULL DEFAULT false`);
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS turma_corretora_2a_id TEXT`);
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS turma_corretora_liberacao TIMESTAMPTZ`);
        await pool.query(`ALTER TABLE classroom_provas ADD COLUMN IF NOT EXISTS segundo_corretor_liberacao TIMESTAMPTZ`);
        /* Índice único para garantir que cada corrector seja pré-atribuído apenas uma vez por submissão.
           Cobre tanto pré-atribuições (nota IS NULL) quanto correções concluídas (nota IS NOT NULL). */
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_provasub_tcor_unico
                ON classroom_prova_submissoes(submissao_ref_id, aluno_email)
                WHERE eh_turma_corretora = true
        `);
        /* Gamificação: snapshot de variante original + flags de XP creditado + foto conferida + flag voluntária */
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS variante_id_original INTEGER`);
        await pool.query(`UPDATE classroom_prova_submissoes SET variante_id_original = variante_id WHERE variante_id_original IS NULL`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS foto_conferida TEXT`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS xp_creditado_efetiv BOOLEAN NOT NULL DEFAULT false`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS voluntaria BOOLEAN NOT NULL DEFAULT false`);
        await pool.query(`ALTER TABLE classroom_prova_submissoes ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'aluno'`);
        await reputacao.migrate();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_prova_cola_flags (
                id             SERIAL PRIMARY KEY,
                prova_id       INTEGER NOT NULL REFERENCES classroom_provas(id) ON DELETE CASCADE,
                aluno_a        TEXT    NOT NULL,
                aluno_b        TEXT    NOT NULL,
                status         TEXT    NOT NULL DEFAULT 'investigar'
                                       CHECK (status IN ('investigar', 'resolvido')),
                nota_professor TEXT,
                registrado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(prova_id, aluno_a, aluno_b)
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notificacoes_professor (
                id             SERIAL PRIMARY KEY,
                cpf_professor  TEXT        NOT NULL,
                prova_id       INTEGER     NOT NULL REFERENCES classroom_provas(id) ON DELETE CASCADE,
                aluno_a        TEXT        NOT NULL,
                aluno_b        TEXT        NOT NULL,
                similaridade   INTEGER     NOT NULL,
                prova_nome     TEXT,
                lida           BOOLEAN     NOT NULL DEFAULT false,
                criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(prova_id, aluno_a, aluno_b)
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_notif_prof_cpf_lida
                ON notificacoes_professor(cpf_professor, lida, criado_em DESC)
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classroom_prova_mapa_questoes (
                id             SERIAL PRIMARY KEY,
                prova_id       INTEGER NOT NULL REFERENCES classroom_provas(id) ON DELETE CASCADE,
                questao_fisica INTEGER NOT NULL,
                variante_id    INTEGER NOT NULL REFERENCES classroom_prova_variantes(id) ON DELETE CASCADE,
                posicao        INTEGER NOT NULL,
                UNIQUE(prova_id, questao_fisica, variante_id),
                UNIQUE(prova_id, variante_id, posicao)
            )
        `);
        await pool.query(`
            ALTER TABLE classroom_prova_mapa_questoes
                ADD COLUMN IF NOT EXISTS alternativas_json JSONB DEFAULT NULL
        `);
        /* Cache de cursos do aluno — criado aqui também para garantir disponibilidade */
        await pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_cursos_cache (
                aluno_email   TEXT        NOT NULL,
                curso_id      TEXT        NOT NULL,
                atualizado_em TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (aluno_email, curso_id)
            )
        `);
        console.log('[PROVAS] Tabelas OK (provas + variantes + submissoes + reputação + cola-flags + notif-professor + mapa-questoes)');
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

        /* ── Anti-detecção de automação ──────────────────────────────────────── */
        /* Esconde as marcas de Puppeteer/headless que o Google usa para CAPTCHA */
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver',  { get: () => undefined });
            Object.defineProperty(navigator, 'plugins',    { get: () => Object.assign([], { length: 5 }) });
            Object.defineProperty(navigator, 'languages',  { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
            window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
            const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
            if (origQuery) {
                navigator.permissions.query = params =>
                    params.name === 'notifications'
                        ? Promise.resolve({ state: Notification.permission })
                        : origQuery(params);
            }
        });

        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        const delay = ms => new Promise(r => setTimeout(r, ms));

        /* Helper: conduz o login Google dentro de uma página (main ou popup) */
        /* Detecta qual tela do Google está ativa */
        async function detectGoogleScreen(p, timeout = 8000) {
            const s = await Promise.race([
                p.waitForSelector('input[type="password"]',                  { timeout, visible: true }).then(() => 'password').catch(() => null),
                p.waitForSelector('[data-authuser], [data-identifier]',      { timeout }).then(() => 'chooser').catch(() => null),
                p.waitForSelector('#profileIdentifier, .ByO6e, .nJjxad',    { timeout }).then(() => 'chooser').catch(() => null),
                p.waitForSelector('input[type="email"]',                     { timeout }).then(() => 'email').catch(() => null),
                p.waitForSelector('[data-challengetype], #challenge, #view_container form:not(:has(input[type="email"]))', { timeout }).then(() => 'challenge').catch(() => null),
            ]).catch(() => null);
            /* Desempate: se detectou email mas há account-chooser no DOM */
            if (s === 'email') {
                const hasChooser = await p.$('[data-authuser], [data-identifier], .ByO6e').catch(() => null);
                if (hasChooser) return 'chooser';
            }
            return s || 'unknown';
        }

        /* Lida com a tela de escolha de conta (account chooser) */
        async function handleChooser(p) {
            console.log('[PROVAS] Account chooser detectado, procurando conta:', email);
            await p.screenshot({ path: '/tmp/gp-chooser.png' }).catch(() => null);

            /* Tenta clicar na conta específica */
            const accountBtn = await p.$(`[data-email="${email}"], [data-identifier="${email}"]`).catch(() => null);
            if (accountBtn) {
                console.log('[PROVAS] Clicando na conta encontrada no chooser');
                await Promise.all([
                    p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
                    accountBtn.click(),
                ]);
                await delay(1200);
                return;
            }
            /* Tenta "Usar outra conta" */
            const otherBtn = await p.$('[data-identifier=""], #identifierLink, [jsname="E6Lnze"], .BHzsHc button').catch(() => null);
            if (otherBtn) {
                console.log('[PROVAS] Clicando em "Usar outra conta"');
                await Promise.all([
                    p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
                    otherBtn.click(),
                ]);
                await delay(1200);
                return;
            }
            /* Fallback: procura qualquer botão de conta pelo texto */
            const allBtns = await p.$$('li[data-authuser], li[data-identifier], .C6LFNc, .OVnw0d, .GE6Bmd').catch(() => []);
            if (allBtns.length > 0) {
                console.log('[PROVAS] Clicando na primeira conta disponível no chooser');
                await Promise.all([
                    p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
                    allBtns[0].click(),
                ]);
                await delay(1200);
            } else {
                console.log('[PROVAS] Chooser detectado mas nenhuma conta encontrada, tentando continuar');
            }
        }

        async function handleGoogleLogin(p) {
            /* ── Tela inicial ─────────────────────────────────────────────────── */
            let screen = await detectGoogleScreen(p, 10000);
            console.log('[PROVAS] Tela Google detectada:', screen, '— URL:', p.url().substring(0, 90));
            await p.screenshot({ path: '/tmp/gp-screen-inicial.png' }).catch(() => null);

            /* ── Chooser na tela inicial ──────────────────────────────────────── */
            if (screen === 'chooser') {
                await handleChooser(p);
                screen = await detectGoogleScreen(p, 8000);
                console.log('[PROVAS] Tela após chooser:', screen, '— URL:', p.url().substring(0, 90));
                await p.screenshot({ path: '/tmp/gp-screen-pos-chooser.png' }).catch(() => null);
            }

            /* ── Campo de email ───────────────────────────────────────────────── */
            if (screen === 'email') {
                const emailInput = await p.waitForSelector('input[type="email"]', { timeout: 15000, visible: true });
                await emailInput.click({ clickCount: 3 }); /* seleciona tudo antes de digitar */
                await emailInput.type(email, { delay: 40 });
                console.log('[PROVAS] Email digitado, clicando Next...');
                await Promise.all([
                    p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => null),
                    p.click('#identifierNext, button[jsname="LgbsSe"], [jsname="LgbsSe"]')
                        .catch(() => p.keyboard.press('Enter')),
                ]);
                await delay(1500);

                screen = await detectGoogleScreen(p, 12000);
                console.log('[PROVAS] Tela após email Next:', screen, '— URL:', p.url().substring(0, 90));
                await p.screenshot({ path: '/tmp/gp-screen-pos-email.png' }).catch(() => null);

                /* Às vezes aparece chooser DEPOIS do email (conta já autenticada antes) */
                if (screen === 'chooser') {
                    await handleChooser(p);
                    screen = await detectGoogleScreen(p, 8000);
                    console.log('[PROVAS] Tela após chooser pós-email:', screen, '— URL:', p.url().substring(0, 90));
                    await p.screenshot({ path: '/tmp/gp-screen-pos-chooser2.png' }).catch(() => null);
                }
            }

            /* ── Campo de senha ───────────────────────────────────────────────── */
            if (screen !== 'password') {
                /* Última tentativa: aguarda mais tempo */
                console.log('[PROVAS] Aguardando campo de senha (tela atual:', screen, ')...');
                await p.screenshot({ path: '/tmp/gp-screen-esperando-senha.png' }).catch(() => null);
                await p.waitForSelector('input[type="password"]', { timeout: 30000, visible: true });
            }

            const pwdInput = await p.$('input[type="password"]');
            await pwdInput.click({ clickCount: 3 });
            await pwdInput.type(pwd, { delay: 40 });
            console.log('[PROVAS] Senha digitada, clicando Next...');
            await Promise.all([
                p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
                p.click('#passwordNext, button[jsname="LgbsSe"], [jsname="LgbsSe"]')
                    .catch(() => p.keyboard.press('Enter')),
            ]);
            await delay(1500);
            console.log('[PROVAS] Senha enviada, URL:', p.url().substring(0, 90));
            await p.screenshot({ path: '/tmp/gp-screen-pos-senha.png' }).catch(() => null);

            /* ── Consentimento OAuth ──────────────────────────────────────────── */
            const consent = await p.$('#submit_approve_access, [data-primary-action-label]').catch(() => null);
            if (consent) {
                console.log('[PROVAS] Tela de consentimento OAuth detectada, aprovando...');
                await Promise.all([
                    p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
                    consent.click(),
                ]);
                await delay(1000);
            }
        }

        const GP_COOKIE_PATH = '/tmp/gp-session-cookies.json';

        try {
            console.log('[PROVAS] Iniciando login GradePen...');

            /* ── 1. Restaura cookies de sessão salvos (evita Google OAuth) ──────── */
            if (fs.existsSync(GP_COOKIE_PATH)) {
                try {
                    const saved = JSON.parse(fs.readFileSync(GP_COOKIE_PATH, 'utf8'));
                    if (Array.isArray(saved) && saved.length > 0) {
                        await page.setCookie(...saved);
                        console.log('[PROVAS] Cookies GradePen restaurados:', saved.length, 'cookies');
                    }
                } catch (e) { console.log('[PROVAS] Falha ao restaurar cookies:', e.message); }
            }

            /* ── 2. Carrega o GradePen ───────────────────────────────────────── */
            await page.goto('https://gradepen.com/p/index.php',
                { waitUntil: 'networkidle2', timeout: 40000 }).catch(() => null);

            /* ── 2b. Verifica se a sessão salva ainda é válida ────────────────── */
            const sessionOk = await page.evaluate(async () => {
                try {
                    const r = await fetch('/p/requests/getAnswers.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                        body: new URLSearchParams({ jobId: '0', index: '0', type: '0' }).toString(),
                    });
                    const j = await r.json().catch(() => ({}));
                    return r.ok && j.errorCode !== 3;
                } catch { return false; }
            }).catch(() => false);

            if (sessionOk) {
                console.log('[PROVAS] Sessão GradePen restaurada via cookies — sem necessidade de Google OAuth');
                _gpPage    = page;
                _gpPageExp = Date.now() + 25 * 60 * 1000;
                return;
            }
            console.log('[PROVAS] Sessão inválida ou sem cookies — iniciando OAuth Google...');

            /* ── 3. Diagnóstico: dump de todos os elementos com "google" ──────── */
            const googleEls = await page.evaluate(() => {
                const out = [];
                document.querySelectorAll('*').forEach(el => {
                    const tag  = el.tagName;
                    const id   = el.id   || '';
                    const cls  = el.className && typeof el.className === 'string' ? el.className : '';
                    const href = el.href  || el.getAttribute('href')    || '';
                    const onclick = el.getAttribute('onclick') || '';
                    const txt  = (el.textContent || '').trim().substring(0, 60);
                    if (/google/i.test(id + cls + href + onclick + txt)) {
                        out.push({ tag, id, cls: cls.substring(0,80), href: href.substring(0,100), onclick: onclick.substring(0,80), txt: txt.substring(0,60) });
                    }
                });
                return out.slice(0, 30);
            }).catch(() => []);
            console.log('[PROVAS] Elementos "google" na página:', JSON.stringify(googleEls));

            /* ── 3. Localiza o botão Google via ID exato (#triggerGoogle) ──────── */
            /* Diagnóstico revelou: id="triggerGoogle" class="sign-in-social"      */
            /* Evita a[href*="google"] que bate no link da Play Store antes        */
            const googleBtn = await page.$(
                '#triggerGoogle, [id="triggerGoogle"], ' +
                'a.sign-in-social, button.sign-in-social, ' +
                '#googleSignInButton, .g-signin2, button[data-provider="google"]'
            ).catch(() => null);

            if (!googleBtn) {
                throw new Error(
                    'Botão "Sign in with Google" (#triggerGoogle) não encontrado no GradePen. ' +
                    'Verifique se GOOGLE_EMAIL/GOOGLE_PASSWORD estão configurados e se a conta não tem 2FA.'
                );
            }
            console.log('[PROVAS] Botão Google localizado:', await page.evaluate(el => `${el.tagName}#${el.id}.${el.className}`, googleBtn).catch(() => '?'));

            /* ── 4. Configura interceptador de popup ANTES de clicar ─────────── */
            /* Filtra apenas popups do Google (ignora Play Store, etc.)           */
            const browser = page.browser();
            let popupPage = null;
            const popupPromise = new Promise(resolve => {
                const handler = async target => {
                    /* Filtra imediatamente pela URL de criação do target (antes de navegar) */
                    const initialUrl = target.url();
                    console.log('[PROVAS] Nova aba/popup detectada (URL inicial):', initialUrl.substring(0, 100));

                    /* Descarta Play Store e links externos irrelevantes imediatamente */
                    if (/play\.google\.com/i.test(initialUrl)) {
                        const p = await target.page().catch(() => null);
                        if (p) await p.close().catch(() => null);
                        console.log('[PROVAS] Popup Play Store descartado.');
                        return;
                    }

                    const p = await target.page().catch(() => null);
                    if (!p) return;

                    /* Aplica anti-detecção no popup também */
                    await p.evaluateOnNewDocument(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
                    }).catch(() => null);

                    /* Aguarda a URL navegar para accounts.google.com (até 15s) */
                    /* O popup pode passar por gradepen.com/oauth → accounts.google.com */
                    try {
                        await p.waitForFunction(
                            () => /accounts\.google\.com|google\.com\/o\/oauth2/i.test(location.href),
                            { timeout: 15000 },
                        );
                        const finalUrl = p.url();
                        console.log('[PROVAS] Popup Google confirmado:', finalUrl.substring(0, 90));
                        browser.off('targetcreated', handler);
                        popupPage = p;
                        resolve(p);
                    } catch {
                        /* Não chegou ao Google — pode ser outra aba irrelevante */
                        console.log('[PROVAS] Popup não chegou ao Google, URL atual:', p.url().substring(0, 80));
                    }
                };
                browser.on('targetcreated', handler);
                /* Remove listener após 25s para não vazar */
                setTimeout(() => browser.off('targetcreated', handler), 25000);
            });

            console.log('[PROVAS] Clicando no botão Google (via JS para ignorar visibilidade)...');
            /* #triggerGoogle fica dentro do modal Bootstrap oculto — usa evaluate para    */
            /* contornar a checagem de visibilidade do Puppeteer e disparar o evento click */
            await page.evaluate(el => el.click(), googleBtn);

            /* ── 4. Aguarda popup (até 12 s) ou fallback para mesma aba ──────── */
            const popup = await Promise.race([
                popupPromise,
                new Promise(r => setTimeout(() => r(null), 12000)),
            ]);

            if (popup) {
                /* ── 4a. Login no POPUP ──────────────────────────────────────── */
                console.log('[PROVAS] Popup detectado:', popup.url().substring(0, 90));
                /* Aguarda navegação inicial do popup para accounts.google.com */
                await popup.waitForFunction(
                    () => location.hostname.includes('accounts.google.com') ||
                          !!document.querySelector('input[type="email"]') ||
                          !!document.querySelector('[data-authuser]'),
                    { timeout: 30000 },
                ).catch(() => null);

                await handleGoogleLogin(popup);

                /* Aguarda o popup fechar (OAuth completo) */
                console.log('[PROVAS] Aguardando popup fechar...');
                await Promise.race([
                    new Promise(resolve => popup.once('close', resolve)),
                    new Promise(resolve => setTimeout(resolve, 35000)),
                ]);
                console.log('[PROVAS] Popup fechado — verificando sessão GradePen...');
                await delay(2000);

            } else {
                /* ── 4b. Fallback: Google abriu na mesma aba ─────────────────── */
                console.log('[PROVAS] Nenhum popup detectado — tentando na aba principal...');
                await page.waitForFunction(
                    () => location.hostname.includes('accounts.google.com') ||
                          !!document.querySelector('input[type="email"]'),
                    { timeout: 20000 },
                ).catch(() => null);
                await handleGoogleLogin(page);
                /* Garante retorno ao GradePen se necessário */
                if (!/gradepen\.com/i.test(page.url())) {
                    await page.goto('https://gradepen.com/p/index.php',
                        { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => null);
                }
            }

            /* ── 5. Verifica sessão no GradePen ──────────────────────────────── */
            if (!/gradepen\.com/i.test(page.url())) {
                await page.goto('https://gradepen.com/p/index.php',
                    { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => null);
            }

            const ok = await page.evaluate(async () => {
                try {
                    const r = await fetch('/p/requests/getAnswers.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                        body: new URLSearchParams({ jobId: '0', index: '0', type: '0' }).toString(),
                    });
                    const j = await r.json().catch(() => ({}));
                    return r.ok && j.errorCode !== 3;
                } catch { return false; }
            }).catch(() => false);

            if (!ok) throw new Error(
                'Login Google→GradePen não autenticou. Verifique se a conta ' +
                `${email} não tem 2FA e se as credenciais estão corretas.`
            );

            /* Salva cookies do GradePen para reutilizar na próxima sessão */
            try {
                const cookies = await page.cookies('https://gradepen.com');
                if (cookies.length > 0) {
                    fs.writeFileSync(GP_COOKIE_PATH, JSON.stringify(cookies));
                    console.log('[PROVAS] Cookies GradePen salvos:', cookies.length, 'cookies');
                }
            } catch (e) { console.log('[PROVAS] Falha ao salvar cookies:', e.message); }

            _gpPage    = page;
            _gpPageExp = Date.now() + 25 * 60 * 1000;
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
        const isTimeout = /timed out|protocolTimeout/i.test(fetchError.message);
        if (isTimeout) {
            fetchError.gpMensagem = 'O GradePen demorou demais para responder. Tente novamente em instantes.';
            fetchError.gpTimeout = true;
            throw fetchError;
        }
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
        /* "Job not found" means the ansid itself doesn't exist — wrong ID entered by the teacher */
        const _isVarianteNaoEncontrada = (j) => {
            if (!j) return false;
            const msg = (j.message || '').toLowerCase();
            return msg.includes('job') && (msg.includes('não encontrado') || msg.includes('nao encontrado') || msg.includes('not found'));
        };
        if (_isVarianteNaoEncontrada(j)) {
            const err = new Error('Nenhuma variante encontrada para ansid=' + jobId);
            err.varianteNaoEncontrada = true;
            err.gpMensagem = `Nenhuma variante encontrada. Confira o ID GradePen: no link https://gradepen.com/.../?ansid=${jobId}.0, o ID é o número antes do ponto (ex: ${jobId}).`;
            throw err;
        }

        /* "Gabarito not published" means the job exists but the teacher hasn't published the answer key yet */
        const _isGabaritoNaoPublicado = (j) => {
            if (!j) return false;
            if (j.errorCode === 4 || j.errorCode === 5) return true;
            const msg = (j.message || '').toLowerCase();
            return msg.includes('gabarito') && (msg.includes('não encontrado') || msg.includes('nao encontrado') || msg.includes('não publicado') || msg.includes('nao publicado') || msg.includes('not found'));
        };
        if (_isGabaritoNaoPublicado(j)) {
            const err = new Error('GradePen recusou: ' + (j.message || 'gabarito não encontrado (errorCode ' + j.errorCode + ')'));
            err.gabaritoNaoPublicado = true;
            throw err;
        }

        /* Mapeamento de errorCodes conhecidos → mensagem amigável em português */
        const GP_MENSAGENS = {
            6:  'O ID GradePen informado tem formato inválido. Verifique o ansid da prova e tente novamente.',
            7:  'Acesso negado pela GradePen. Confirme se sua conta tem permissão para acessar esta prova.',
            8:  'Cota de requisições da GradePen excedida. Aguarde alguns minutos e tente novamente.',
            9:  'A GradePen retornou um erro interno. Tente novamente mais tarde.',
            10: 'Prova não encontrada na GradePen. Verifique se o ID está correto.',
            11: 'Prova bloqueada na GradePen. Entre em contato com o suporte da GradePen.',
            12: 'Licença GradePen expirada ou insuficiente para acessar esta prova.',
        };

        /* Detecção adicional por texto da mensagem para códigos desconhecidos */
        const _gpMsgFromText = (rawMsg) => {
            const m = (rawMsg || '').toLowerCase();
            if (m.includes('invalid') && (m.includes('job') || m.includes('id') || m.includes('format')))
                return 'O ID GradePen informado tem formato inválido. Verifique o ansid da prova e tente novamente.';
            if (m.includes('quota') || m.includes('rate limit') || m.includes('too many'))
                return 'Cota de requisições da GradePen excedida. Aguarde alguns minutos e tente novamente.';
            if (m.includes('acesso negado') || m.includes('access denied') || m.includes('forbidden') || m.includes('permission'))
                return 'Acesso negado pela GradePen. Confirme se sua conta tem permissão para acessar esta prova.';
            if (m.includes('licen') || m.includes('license') || m.includes('subscription'))
                return 'Licença GradePen expirada ou insuficiente para acessar esta prova.';
            return null;
        };

        const code = j && j.errorCode;
        const rawMessage = (j && j.message) || '';
        const mensagemAmigavel = GP_MENSAGENS[code] || _gpMsgFromText(rawMessage)
            || ('GradePen recusou: ' + (rawMessage || 'erro ' + code));

        const err = new Error(mensagemAmigavel);
        err.gpErrorCode = code;
        err.gpMensagem  = mensagemAmigavel;
        throw err;
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
    if (variantes.length === 0) {
        const err = new Error('Nenhuma variante encontrada para ansid=' + gradepenId);
        err.varianteNaoEncontrada = true;
        err.gpMensagem = `Nenhuma variante encontrada. Confira o ID GradePen: no link https://gradepen.com/.../?ansid=${gradepenId}.0, o ID é o número antes do ponto (ex: ${gradepenId}).`;
        throw err;
    }
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
        usuarioId:   req.userSession?.userId ?? null,
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

    /* ── GradePen: status e conexão manual ───────────────────────────── */
    router.get('/provas/gradepen/status', async (req, res) => {
        if (!req.userSession) return res.status(401).json({ erro: 'Não autenticado.' });
        const s = getGradePenStats();
        res.json({
            conectado:  s.pageAtiva,
            expira:     s.pageExpira,
            conectando: s.loginEmAndamento,
            pingOk:     s.ultimoPingOk,
        });
    });

    router.post('/provas/gradepen/connect', async (req, res) => {
        if (!req.userSession) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            await gpLogin();
            const s = getGradePenStats();
            res.json({ ok: true, expira: s.pageExpira });
        } catch (e) {
            res.status(500).json({ ok: false, erro: e.message });
        }
    });

    router.delete('/provas/gradepen/connect', async (req, res) => {
        if (!req.userSession) return res.status(401).json({ erro: 'Não autenticado.' });
        /* Invalida a sessão GradePen e remove cookies salvos */
        _gpPage    = null;
        _gpPageExp = 0;
        try { fs.unlinkSync('/tmp/gp-session-cookies.json'); } catch {}
        res.json({ ok: true });
    });

    /* Lista todas as provas do professor autenticado (sem filtro de curso) */
    router.get('/classroom/provas/todas', async (req, res) => {
        if (!getClassroomAuth) return res.status(500).json({ erro: 'Integração Classroom não inicializada.' });
        const cpf = req.userSession?.cpf;
        if (!cpf) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            /* Busca nomes dos cursos via Classroom API */
            const cursoNomes = {};
            try {
                const auth = await getClassroomAuth(req);
                const { google } = await import('googleapis');
                const classroom = google.classroom({ version: 'v1', auth });
                let pageToken;
                do {
                    const resp = await classroom.courses.list({
                        teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken,
                    });
                    for (const c of (resp.data.courses || [])) cursoNomes[c.id] = c.name;
                    pageToken = resp.data.nextPageToken;
                } while (pageToken);
            } catch (_) { /* sem Classroom conectado — nomes ficam em branco */ }

            const cursoIds = Object.keys(cursoNomes);
            const { rows } = await pool.query(
                `SELECT p.*,
                        g.nome AS grupo_destino_nome,
                        (SELECT COUNT(*) FROM classroom_prova_submissoes s
                          WHERE s.prova_id = p.id AND s.eh_segundo_corretor = false) AS submissoes_count,
                        (SELECT COUNT(*) FROM classroom_prova_variantes v
                          WHERE v.prova_id = p.id) AS variantes_count,
                        (SELECT COUNT(*) FROM classroom_prova_cola_flags f
                          WHERE f.prova_id = p.id AND f.status = 'investigar') AS pares_flagged_investigar,
                        (SELECT COUNT(*) FROM classroom_prova_cola_flags f
                          WHERE f.prova_id = p.id AND f.status = 'resolvido') AS pares_flagged_resolvido
                   FROM classroom_provas p
                   LEFT JOIN classroom_grupos g ON g.id = p.grupo_destino_id
                  WHERE p.criada_por_cpf = $1
                     OR (p.criada_por_cpf IS NULL AND p.curso_id = ANY($2::text[]))
                  ORDER BY p.data_aplicacao DESC NULLS LAST, p.criada_em DESC`,
                [cpf, cursoIds]
            );

            const provas = rows.map(p => ({
                ...p,
                pares_suspeitos: 0,
                curso_nome: cursoNomes[p.curso_id] || p.curso_id,
            }));
            res.json({ provas });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

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
                          WHERE v.prova_id = p.id) AS variantes_count,
                        (SELECT COUNT(*) FROM classroom_prova_cola_flags f
                          WHERE f.prova_id = p.id AND f.status = 'investigar') AS pares_flagged_investigar,
                        (SELECT COUNT(*) FROM classroom_prova_cola_flags f
                          WHERE f.prova_id = p.id AND f.status = 'resolvido') AS pares_flagged_resolvido
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

    /* Configurações de UI do módulo Provas (badge poll interval, etc.) */
    router.get('/classroom/provas/ui-config', async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT valor FROM edusync_config WHERE chave = 'badge_poll_minutos'`
            );
            const raw = rows.length ? parseInt(rows[0].valor, 10) : NaN;
            const badgePollMinutos = Number.isFinite(raw) && raw >= 1 && raw <= 60 ? raw : 3;
            res.json({ badgePollMinutos });
        } catch (e) {
            res.json({ badgePollMinutos: 3 });
        }
    });

    /* ── Notificações de cola para o professor ────────────────────── */

    /* Lista notificações não-lidas (e opcionalmente todas) */
    router.get('/classroom/provas/notificacoes-cola', async (req, res) => {
        const cpf = req.userSession?.cpf;
        if (!cpf) return res.status(401).json({ erro: 'Não autenticado.' });
        const soNaoLidas = req.query.naoLidas !== '0';
        try {
            const { rows } = await pool.query(
                `SELECT id, prova_id, aluno_a, aluno_b, similaridade, prova_nome, lida, criado_em
                   FROM notificacoes_professor
                  WHERE cpf_professor = $1
                    ${soNaoLidas ? 'AND lida = false' : ''}
                  ORDER BY criado_em DESC
                  LIMIT 50`,
                [cpf]
            );
            const { rows: [{ total }] } = await pool.query(
                `SELECT COUNT(*)::int AS total FROM notificacoes_professor WHERE cpf_professor = $1 AND lida = false`,
                [cpf]
            );
            res.json({ notificacoes: rows, totalNaoLidas: total });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Marca uma notificação como lida */
    router.post('/classroom/provas/notificacoes-cola/:id/lida', async (req, res) => {
        const cpf = req.userSession?.cpf;
        if (!cpf) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            await pool.query(
                `UPDATE notificacoes_professor SET lida = true WHERE id = $1 AND cpf_professor = $2`,
                [req.params.id, cpf]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Marca todas as notificações como lidas */
    router.post('/classroom/provas/notificacoes-cola/lida-todas', async (req, res) => {
        const cpf = req.userSession?.cpf;
        if (!cpf) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            await pool.query(
                `UPDATE notificacoes_professor SET lida = true WHERE cpf_professor = $1 AND lida = false`,
                [cpf]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── /Notificações de cola ─────────────────────────────────────── */

    /* Contagem de flags 'investigar' agrupada por curso, restrita aos cursos do professor */
    router.get('/classroom/provas/resumo-investigar', async (req, res) => {
        const raw = (req.query.courseIds || '').trim();
        if (!raw) return res.json({ resumo: {} });
        const courseIds = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (courseIds.length === 0) return res.json({ resumo: {} });
        try {
            const { rows } = await pool.query(
                `SELECT p.curso_id, COUNT(*)::int AS pendentes
                   FROM classroom_prova_cola_flags f
                   JOIN classroom_provas p ON p.id = f.prova_id
                  WHERE f.status = 'investigar'
                    AND p.curso_id = ANY($1)
                  GROUP BY p.curso_id`,
                [courseIds]
            );
            const resumo = {};
            for (const r of rows) resumo[r.curso_id] = r.pendentes;
            res.json({ resumo });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Contagem de flags 'investigar' para TODOS os cursos do professor logado — sem precisar informar courseIds */
    router.get('/classroom/provas/resumo-cola-geral', async (req, res) => {
        const cpf = req.userSession?.cpf;
        if (!cpf) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const { rows } = await pool.query(
                `SELECT p.curso_id, COUNT(*)::int AS pendentes
                   FROM classroom_prova_cola_flags f
                   JOIN classroom_provas p ON p.id = f.prova_id
                  WHERE f.status = 'investigar'
                    AND p.criada_por_cpf = $1
                  GROUP BY p.curso_id`,
                [cpf]
            );
            const resumo = {};
            for (const r of rows) resumo[r.curso_id] = r.pendentes;
            res.json({ resumo });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Todas as flags 'investigar' de um curso (visão consolidada) */
    router.get('/classroom/provas/pendentes-investigar', async (req, res) => {
        const courseId = req.query.courseId;
        if (!courseId) return res.status(400).json({ erro: 'courseId é obrigatório.' });
        try {
            const { rows } = await pool.query(
                `SELECT f.id, f.prova_id, f.aluno_a, f.aluno_b, f.nota_professor, f.registrado_em,
                        p.nome AS prova_nome, p.data_aplicacao
                   FROM classroom_prova_cola_flags f
                   JOIN classroom_provas p ON p.id = f.prova_id
                  WHERE f.status = 'investigar'
                    AND p.curso_id = $1
                  ORDER BY f.registrado_em DESC`,
                [courseId]
            );
            res.json({ pendentes: rows });
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

            const { rows: submissoesRaw } = await pool.query(
                `SELECT s.*, v.codigo AS variante_codigo,
                        pend.aluno_email AS segundo_corretor_pendente_email
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                   LEFT JOIN LATERAL (
                       SELECT aluno_email
                         FROM notificacoes_aluno
                        WHERE tipo IN ('segundo_corretor', 'segundo_corretor_voluntario')
                          AND referencia = s.id::text
                          AND lida = false
                        ORDER BY criado_em DESC
                        LIMIT 1
                   ) pend ON true
                  WHERE s.prova_id = $1
                  ORDER BY s.eh_segundo_corretor, s.criada_em DESC`,
                [prova.id]
            );

            /* ── Enriquece submissões com numchamada via Supabase (best-effort) ── */
            let submissoes = submissoesRaw;
            try {
                const { supabaseAdmin } = await import('../config/supabase.js');
                const { data: alunosDB } = await supabaseAdmin
                    .from('alunos')
                    .select('nome, numchamada')
                    .not('numchamada', 'is', null);

                if (alunosDB?.length) {
                    const norm = n => (n || '').toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
                    const numChamadaMap = {};
                    alunosDB.forEach(a => { numChamadaMap[norm(a.nome)] = a.numchamada; });

                    submissoes = submissoesRaw.map(s => {
                        if (!s.aluno_nome) return { ...s, numchamada: null };
                        const nNorm = norm(s.aluno_nome);
                        if (numChamadaMap[nNorm] != null) return { ...s, numchamada: numChamadaMap[nNorm] };
                        const tokens = nNorm.split(' ').filter(t => t.length > 2);
                        const matched = Object.entries(numChamadaMap).find(([k]) =>
                            tokens.length > 0 && tokens.every(t => k.includes(t))
                        );
                        return { ...s, numchamada: matched ? matched[1] : null };
                    });
                }
            } catch (supErr) {
                console.warn('[PROVAS-DETALHE] Supabase numchamada erro:', supErr.message);
            }

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
            turmaCorretoraId = null, turmaCorretora2aCorrecao = false,
            linkProva,           // opcional: URL da prova para os alunos lerem as questões
            variantesManuais,    // opcional: [{codigo, gabarito: [{questao, tipo, correta, valor, n_alternativas}]}]
        } = req.body || {};

        if (!courseId || !nome || !gradepenId) {
            return res.status(400).json({ erro: 'courseId, nome e gradepenId são obrigatórios.' });
        }
        const pct = Number(segundoCorretorPct);
        if (segundoCorretorAtivo && (isNaN(pct) || pct < 1 || pct > 100)) {
            return res.status(400).json({ erro: 'segundoCorretorPct deve ser entre 1 e 100.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const linkProvaVal = (linkProva && typeof linkProva === 'string' && linkProva.trim()) ? linkProva.trim() : null;
            const turmaCorretoraIdVal = (turmaCorretoraId && typeof turmaCorretoraId === 'string' && turmaCorretoraId.trim()) ? turmaCorretoraId.trim() : null;
            const { rows: [prova] } = await client.query(
                `INSERT INTO classroom_provas
                   (curso_id, gradepen_id, nome, grupo_destino_id, data_aplicacao,
                    foto_modo, foto_sorteio_pct, segundo_corretor_ativo, segundo_corretor_pct,
                    permitir_outra_turma, link_prova, turma_corretora_id, turma_corretora_2a_correcao,
                    criada_por_cpf, criada_por_nome)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                 RETURNING *`,
                [courseId, String(gradepenId), nome, grupoDestinoId || null, dataAplicacao || null,
                 fotoModo, fotoSorteioPct, !!segundoCorretorAtivo, segundoCorretorPct,
                 !!permitirOutraTurma, linkProvaVal, turmaCorretoraIdVal, !!turmaCorretora2aCorrecao,
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
                    logProvas(req, 'GP_FETCH_ERROR', {
                        gpErrorCode: e.gpErrorCode != null ? e.gpErrorCode : null,
                        gpMensagem: e.gpMensagem || e.message || null,
                        gradepenId,
                    });
                    recordGpError(e.gpErrorCode != null ? e.gpErrorCode : null, {
                        gpMensagem: e.gpMensagem || e.message || null,
                        gradepenId,
                    }).catch(() => {});
                    return res.status(422).json({
                        erro: 'Não foi possível ler a GradePen. Você pode cadastrar o gabarito manualmente.',
                        detalhe: e.message,
                        gpMensagem: e.gpMensagem || null,
                        gpErrorCode: e.gpErrorCode != null ? e.gpErrorCode : null,
                        prova: null,
                        precisaGabaritoManual: true,
                        gabaritoNaoPublicado: e.gabaritoNaoPublicado === true,
                        varianteNaoEncontrada: e.varianteNaoEncontrada === true,
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
                        'permitir_outra_turma', 'turma_corretora_id', 'turma_corretora_2a_correcao',
                        'turma_corretora_2a_id', 'turma_corretora_liberacao', 'segundo_corretor_liberacao'];
        const map = {
            nome: 'nome', grupoDestinoId: 'grupo_destino_id', dataAplicacao: 'data_aplicacao',
            fotoModo: 'foto_modo', fotoSorteioPct: 'foto_sorteio_pct',
            segundoCorretorAtivo: 'segundo_corretor_ativo', segundoCorretorPct: 'segundo_corretor_pct',
            permitirOutraTurma: 'permitir_outra_turma',
            turmaCorretoraId: 'turma_corretora_id', turmaCorretora2aCorrecao: 'turma_corretora_2a_correcao',
            turmaCorretora2aId: 'turma_corretora_2a_id',
            turmaCorretoraLiberacao: 'turma_corretora_liberacao',
            segundoCorretorLiberacao: 'segundo_corretor_liberacao',
            linkProvaPaginas: 'link_prova_paginas',
        };
        const sets = [], vals = [];
        let i = 1;
        for (const [k, col] of Object.entries(map)) {
            if (req.body[k] !== undefined) {
                sets.push(`${col} = $${i++}`);
                /* Coerce empty string to null for nullable TEXT/TIMESTAMPTZ columns */
                let val = req.body[k];
                if (['turma_corretora_id', 'turma_corretora_2a_id', 'turma_corretora_liberacao', 'segundo_corretor_liberacao'].includes(col)
                    && (val === '' || val === null)) val = null;
                vals.push(val);
            }
        }
        if (sets.length === 0) return res.json({ ok: true });
        vals.push(req.params.id);
        try {
            await pool.query(`UPDATE classroom_provas SET ${sets.join(', ')} WHERE id = $${i}`, vals);
            logProvas(req, 'PROVA_UPDATE', { provaId: req.params.id, campos: Object.keys(req.body) });
            res.json({ ok: true });

            const provaId = req.params.id;

            /* Invalida cache de PDF quando o mapeamento de páginas muda */
            if (req.body.linkProvaPaginas !== undefined) {
                setImmediate(async () => {
                    try {
                        const { invalidatePdfCache } = await import('../services/pdfVariante.service.js');
                        invalidatePdfCache(provaId);
                    } catch (e) {
                        console.warn(`[PDF-CACHE] prova ${provaId}:`, e.message);
                    }
                });
            }

            /* Notifica turma corretora quando professor atribui (fire-and-forget) */
            const novoTcId = req.body.turmaCorretoraId;
            if (novoTcId && String(novoTcId).trim()) {
                setImmediate(async () => {
                    try {
                        await notificarAtribuicaoTurmaCorretora(pool, provaId, String(novoTcId).trim());
                    } catch (e) {
                        console.warn(`[NOTIF-TC-ATRIB] prova ${provaId}:`, e.message);
                    }
                });
            }
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Re-baixa gabarito da GradePen */
    router.post('/classroom/provas/:id/regabaritar', async (req, res) => {
        try {
            const { rows: [prova] } = await pool.query(`SELECT * FROM classroom_provas WHERE id = $1`, [req.params.id]);
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });
            let variantes;
            try {
                variantes = await scrapeProva(prova.gradepen_id);
            } catch (e) {
                logProvas(req, 'GP_FETCH_ERROR', {
                    gpErrorCode: e.gpErrorCode != null ? e.gpErrorCode : null,
                    gpMensagem: e.gpMensagem || e.message || null,
                    gradepenId: prova.gradepen_id,
                });
                recordGpError(e.gpErrorCode != null ? e.gpErrorCode : null, {
                    gpMensagem: e.gpMensagem || e.message || null,
                    gradepenId: prova.gradepen_id,
                }).catch(() => {});
                throw e;
            }
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

    /* Lista candidatos elegíveis para 2º corretor sem sortear */
    router.get('/classroom/provas/:id/candidatos-segundo', async (req, res) => {
        const { submissaoId } = req.query;
        if (!submissaoId) return res.status(400).json({ erro: 'submissaoId obrigatório.' });
        try {
            const { candidatos } = await obterCandidatosSegundoCorretor(pool, { submissaoId, provaId: req.params.id });
            res.json({ candidatos });
        } catch (e) {
            if (e.message.includes('não encontrada nesta prova')) return res.status(404).json({ erro: e.message });
            res.status(500).json({ erro: e.message });
        }
    });

    /* Sorteia (ou atribui) 2º corretor para uma submissão específica */
    router.post('/classroom/provas/:id/sortear-segundo', async (req, res) => {
        const { submissaoId, emailEscolhido } = req.body || {};
        if (!submissaoId) return res.status(400).json({ erro: 'submissaoId obrigatório.' });
        try {
            const result = await sortearSegundoCorretor(pool, { submissaoId, provaId: req.params.id, emailEscolhido: emailEscolhido || null });
            logProvas(req, 'PROVA_SORTEIO_2COR', { submissaoId, sorteado: result.sorteado, manual: !!emailEscolhido });
            res.json({ ok: true, sorteado: result.sorteado });
        } catch (e) {
            if (e.message.includes('não encontrada nesta prova'))  return res.status(404).json({ erro: e.message });
            if (e.message.includes('Sem candidatos') ||
                e.message.includes('Nenhum membro elegível'))      return res.status(409).json({ erro: e.message });
            if (e.message.includes('não é elegível'))              return res.status(400).json({ erro: e.message });
            res.status(500).json({ erro: e.message });
        }
    });

    /* Divergências parciais (antes de efetivar): submissões com 2ª correção concluída */
    router.get('/classroom/provas/:id/divergencias', async (req, res) => {
        const cpfSessao = req.userSession?.cpf;
        const perfil    = req.userSession?.perfil;
        try {
            const { rows: [prova] } = await pool.query(
                `SELECT id, criada_por_cpf, segundo_corretor_ativo FROM classroom_provas WHERE id = $1`,
                [req.params.id]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });
            if (perfil !== 'admin') {
                if (!cpfSessao || !prova.criada_por_cpf || prova.criada_por_cpf !== cpfSessao) {
                    return res.status(403).json({ erro: 'Apenas o professor dono da prova pode ver as divergências.' });
                }
            }

            const { rows } = await pool.query(
                `SELECT
                    p.id                AS submissao_id,
                    p.aluno_email,
                    p.nota              AS nota_1,
                    sc.nota             AS nota_2,
                    sc.id               AS segunda_id,
                    sc.marcacoes_json   AS corretor_marcacoes,
                    v.gabarito_json     AS gabarito
                   FROM classroom_prova_submissoes p
                   JOIN classroom_prova_submissoes sc
                     ON sc.submissao_ref_id = p.id AND sc.eh_segundo_corretor = true
                   JOIN classroom_prova_variantes v ON v.id = p.variante_id
                  WHERE p.prova_id = $1
                    AND p.eh_segundo_corretor = false
                  ORDER BY ABS(sc.nota - p.nota) DESC`,
                [req.params.id]
            );

            function maskEmail(email) {
                const [local = '', domain = ''] = String(email).split('@');
                const vis = Math.min(2, local.length);
                return local.slice(0, vis) + '**@' + domain;
            }
            function nivelDiv(div) {
                if (div <= 0.3) return 'perfeita';
                if (div <= 0.7) return 'precisa';
                if (div <= 1.5) return 'ok';
                if (div <= 3.0) return 'longe';
                return 'desviante';
            }

            /* Tenta enriquecer com flags de cola/suspeita (risco_cola_nivel da Task #112 se existir) */
            let flagsMap = {};
            try {
                /* Tenta ler risco_cola_nivel; se a coluna não existir no schema, cai no catch */
                const emails = rows.map(r => r.aluno_email);
                if (emails.length > 0) {
                    let flagRows;
                    try {
                        ({ rows: flagRows } = await pool.query(
                            `SELECT aluno_a, aluno_b, status, risco_cola_nivel
                               FROM classroom_prova_cola_flags
                              WHERE prova_id = $1`,
                            [req.params.id]
                        ));
                    } catch (_colErr) {
                        /* risco_cola_nivel column doesn't exist yet (Task #112 not done) */
                        ({ rows: flagRows } = await pool.query(
                            `SELECT aluno_a, aluno_b, status, NULL::text AS risco_cola_nivel
                               FROM classroom_prova_cola_flags
                              WHERE prova_id = $1`,
                            [req.params.id]
                        ));
                    }
                    for (const f of flagRows) {
                        /* Mark both sides of each flagged pair */
                        for (const email of [f.aluno_a, f.aluno_b]) {
                            if (!flagsMap[email] || f.risco_cola_nivel) {
                                flagsMap[email] = {
                                    suspeito:        true,
                                    status_flag:     f.status,
                                    risco_cola_nivel: f.risco_cola_nivel || null,
                                };
                            }
                        }
                    }
                }
            } catch (e) {
                /* Enriquecimento é opcional — não quebra a resposta */
                console.warn('[PROVAS] divergencias flag lookup falhou:', e.message);
            }

            function computeCorretorAcerto(gabarito, marcacoes) {
                if (!Array.isArray(gabarito) || !gabarito.length || !marcacoes) return null;
                let acertos = 0;
                let total = 0;
                for (const q of gabarito) {
                    if (!q.correta || q.tipo === 'discursiva') continue;
                    const marc = marcacoes[String(q.questao)];
                    total++;
                    if (q.tipo === 'vf') {
                        if (Array.isArray(marc) && Array.isArray(q.correta) && marc.length === q.correta.length) {
                            if (marc.every((v, i) => String(v).toUpperCase() === String(q.correta[i]).toUpperCase())) acertos++;
                        }
                    } else {
                        if (marc != null && String(marc).toLowerCase() === String(q.correta).toLowerCase()) acertos++;
                    }
                }
                if (total === 0) return null;
                return Math.round((acertos / total) * 100);
            }

            const divergencias = rows.map(r => {
                const nota1 = Number(r.nota_1 || 0);
                const nota2 = Number(r.nota_2 || 0);
                const div   = Math.abs(nota1 - nota2);
                const flagInfo = flagsMap[r.aluno_email] || null;
                const corretorAcertoPct = computeCorretorAcerto(r.gabarito, r.corretor_marcacoes);
                return {
                    submissao_id:       r.submissao_id,
                    aluno_email:        maskEmail(r.aluno_email),
                    nota_1:             nota1,
                    nota_2:             nota2,
                    divergencia:        Math.round(div * 100) / 100,
                    nivel:              nivelDiv(div),
                    suspeito:           flagInfo?.suspeito || false,
                    risco_cola_nivel:   flagInfo?.risco_cola_nivel || null,
                    corretor_acerto_pct: corretorAcertoPct,
                };
            });

            res.json({ divergencias });
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

    /* Histórico de cola por aluno */
    router.get('/classroom/provas/cola-historico/:email', async (req, res) => {
        try {
            const email = req.params.email;
            /* Join with submissões twice to retrieve the name of each participant */
            const { rows } = await pool.query(
                `SELECT f.prova_id, f.aluno_a, f.aluno_b, f.status,
                        f.nota_professor, f.registrado_em,
                        p.nome AS prova_nome,
                        sa.aluno_nome AS nome_a,
                        sb.aluno_nome AS nome_b
                   FROM classroom_prova_cola_flags f
                   JOIN classroom_provas p ON p.id = f.prova_id
                   LEFT JOIN LATERAL (
                       SELECT aluno_nome FROM classroom_prova_submissoes
                        WHERE prova_id = f.prova_id AND aluno_email = f.aluno_a
                          AND eh_segundo_corretor = false LIMIT 1
                   ) sa ON true
                   LEFT JOIN LATERAL (
                       SELECT aluno_nome FROM classroom_prova_submissoes
                        WHERE prova_id = f.prova_id AND aluno_email = f.aluno_b
                          AND eh_segundo_corretor = false LIMIT 1
                   ) sb ON true
                  WHERE f.aluno_a = $1 OR f.aluno_b = $1
                  ORDER BY f.registrado_em DESC`,
                [email]
            );
            /* Normalise to camelCase and resolve "outroAluno" based on which side matches */
            const historico = rows.map(r => {
                const isA = r.aluno_a === email;
                return {
                    provaId:       r.prova_id,
                    provaNome:     r.prova_nome,
                    emailOutro:    isA ? r.aluno_b : r.aluno_a,
                    outroAluno:    isA ? (r.nome_b || r.aluno_b) : (r.nome_a || r.aluno_a),
                    status:        r.status,
                    notaProfessor: r.nota_professor,
                    data:          r.registrado_em,
                };
            });
            res.json({ historico });
        } catch (e) {
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
                `SELECT id, variante_id, aluno_email, aluno_nome, marcacoes_json,
                        COALESCE(origem, 'aluno') AS origem
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

            /* ── Calcula taxa de acerto por questão, por variante (para score ponderado) ── */
            const acertoRateMap = {}; /* varId → { questaoNum → passRate 0..1 } */
            for (const [varId, subs] of Object.entries(porVariante)) {
                const { gabarito } = gabMap[varId] || {};
                if (!gabarito || subs.length === 0) continue;
                const rateMap = {};
                const questoesComp = gabarito.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
                for (const q of questoesComp) {
                    let acertos = 0;
                    const qStr = String(q.questao);
                    for (const s of subs) {
                        const marc = (s.marcacoes_json || {})[qStr] ?? null;
                        let corr = false;
                        if (q.tipo === 'multipla') {
                            corr = marc !== null && String(marc).toLowerCase() === String(q.correta || '').toLowerCase();
                        } else if (q.tipo === 'vf' && Array.isArray(q.correta)) {
                            corr = Array.isArray(marc) && marc.length === q.correta.length &&
                                   marc.every((x, i) => String(x).toUpperCase() === String(q.correta[i]).toUpperCase());
                        }
                        if (corr) acertos++;
                    }
                    rateMap[qStr] = subs.length > 0 ? acertos / subs.length : 0;
                }
                acertoRateMap[varId] = rateMap;
            }

            const LETRAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

            const pares = [];

            for (const [varId, subs] of Object.entries(porVariante)) {
                if (subs.length < 2) continue;
                const { codigo, gabarito } = gabMap[varId] || {};
                if (!gabarito) continue;

                /* Filtra apenas questões comparáveis (multipla e vf) */
                const questoesComp = gabarito.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
                if (questoesComp.length === 0) continue;

                const rateMap = acertoRateMap[varId] || {};

                /* Comparação pairwise */
                for (let i = 0; i < subs.length; i++) {
                    for (let j = i + 1; j < subs.length; j++) {
                        const a = subs[i];
                        const b = subs[j];
                        const marcA = a.marcacoes_json || {};
                        const marcB = b.marcacoes_json || {};

                        let identicas = 0;
                        let identicasErradas = 0;
                        let somaPesos = 0;
                        let somaIdenticasPonderada = 0;
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

                            /* Score ponderado: peso = taxa de acerto (questão fácil = peso maior) */
                            const peso = rateMap[qStr] ?? 0.5;
                            somaPesos += peso;
                            if (igual) somaIdenticasPonderada += peso;

                            detalhes.push({
                                questao:   q.questao,
                                tipo:      q.tipo,
                                correta:   q.correta,
                                respA,
                                respB,
                                igual,
                                amboserram,
                                acertoRate: Math.round((rateMap[qStr] ?? 0.5) * 100),
                            });
                        }

                        const total = questoesComp.length;
                        const similaridade = total > 0 ? Math.round((identicas / total) * 100) : 0;
                        const scorePonderado = somaPesos > 0 ? Math.round((somaIdenticasPonderada / somaPesos) * 100) : 0;

                        pares.push({
                            alunoA:           a.aluno_email,
                            nomeA:            a.aluno_nome || a.aluno_email,
                            origemA:          a.origem || 'aluno',
                            subIdA:           a.id,
                            alunoB:           b.aluno_email,
                            nomeB:            b.aluno_nome || b.aluno_email,
                            origemB:          b.origem || 'aluno',
                            subIdB:           b.id,
                            varianteCodigo:   codigo,
                            total,
                            identicas,
                            identicasErradas,
                            similaridade,
                            scorePonderado,
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

            /* ── Análise entre variantes (comparação por posição física) ── */
            const suspeitosEntreVariantes = [];
            const varIds = Object.keys(porVariante);

            if (varIds.length >= 2) {
                /* Para cada par de variantes distintas */
                for (let vi = 0; vi < varIds.length; vi++) {
                    for (let vj = vi + 1; vj < varIds.length; vj++) {
                        const subsA = porVariante[varIds[vi]];
                        const subsB = porVariante[varIds[vj]];
                        const gabA = (gabMap[varIds[vi]] || {}).gabarito || [];
                        const gabB = (gabMap[varIds[vj]] || {}).gabarito || [];
                        const codA = (gabMap[varIds[vi]] || {}).codigo;
                        const codB = (gabMap[varIds[vj]] || {}).codigo;

                        /* Encontra questões múltipla-escolha presentes em ambas variantes (pelo número) */
                        const questNums = new Set(gabA.filter(q => q.tipo === 'multipla').map(q => String(q.questao)));
                        const questNumsB = new Set(gabB.filter(q => q.tipo === 'multipla').map(q => String(q.questao)));
                        const questComuns = [...questNums].filter(qn => questNumsB.has(qn));
                        if (questComuns.length < 5) continue; /* poucas questões em comum → não analisa */

                        /* Monta mapa questao → posição-índice para cada variante */
                        const posA = {}; /* questao → índice da resposta correta em variante A (só gabarito) */
                        const posB = {};
                        for (const q of gabA) if (q.tipo === 'multipla') posA[String(q.questao)] = q;
                        for (const q of gabB) if (q.tipo === 'multipla') posB[String(q.questao)] = q;

                        /* Compara todos os pares A×B */
                        for (const sa of subsA) {
                            for (const sb of subsB) {
                                let posIguais = 0;
                                for (const qn of questComuns) {
                                    const respA = (sa.marcacoes_json || {})[qn] ?? null;
                                    const respB = (sb.marcacoes_json || {})[qn] ?? null;
                                    if (respA === null || respB === null) continue;
                                    const idxA = LETRAS.indexOf(String(respA).toLowerCase());
                                    const idxB = LETRAS.indexOf(String(respB).toLowerCase());
                                    if (idxA >= 0 && idxB >= 0 && idxA === idxB) posIguais++;
                                }
                                const totalComuns = questComuns.length;
                                const posSimil = totalComuns > 0 ? Math.round((posIguais / totalComuns) * 100) : 0;
                                if (posSimil >= 70) {
                                    suspeitosEntreVariantes.push({
                                        alunoA:        sa.aluno_email,
                                        nomeA:         sa.aluno_nome || sa.aluno_email,
                                        varianteA:     codA,
                                        alunoB:        sb.aluno_email,
                                        nomeB:         sb.aluno_nome || sb.aluno_email,
                                        varianteB:     codB,
                                        posSimil,
                                        totalComuns,
                                        posIguais,
                                    });
                                }
                            }
                        }
                    }
                }
                suspeitosEntreVariantes.sort((a, b) => b.posSimil - a.posSimil);
            }

            /* Informa se há questões discursivas na prova (para nota de rodapé) */
            const temDiscursiva = variantes.some(v =>
                (v.gabarito_json || []).some(q => q.tipo === 'discursiva')
            );

            /* Carrega flags de cola existentes para esta prova */
            const { rows: flagRows } = await pool.query(
                `SELECT aluno_a, aluno_b, status, nota_professor FROM classroom_prova_cola_flags WHERE prova_id = $1`,
                [provaId]
            );
            const flagMap = {};
            for (const f of flagRows) flagMap[`${f.aluno_a}|${f.aluno_b}`] = f;

            /* Anexa flag a cada par (normaliza a ordem para coincidir com o mapa) */
            for (const par of pares) {
                const [ea, eb] = [par.alunoA, par.alunoB].sort();
                par.flag = flagMap[`${ea}|${eb}`] || null;
            }

            /* Expõe variantes (com gabarito) para o modal de registro manual no frontend */
            const variantesPublic = variantes.map(v => ({
                id:       v.id,
                codigo:   v.codigo,
                gabarito: v.gabarito_json,
            }));

            res.json({ pares, suspeitosEntreVariantes, temDiscursiva, variantes: variantesPublic });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Registrar respostas manualmente (professor insere gabarito físico de aluno) ── */
    router.post('/classroom/provas/:provaId/submissoes/manual', requireModulo('confrontar-gabarito'), async (req, res) => {
        const session = req.userSession;
        if (!session) return res.status(401).json({ erro: 'Não autenticado.' });

        const { alunoNome, alunoEmail, varianteId, marcacoes } = req.body || {};
        if (!alunoNome || !alunoEmail || !varianteId || !marcacoes || typeof marcacoes !== 'object') {
            return res.status(400).json({ erro: 'alunoNome, alunoEmail, varianteId e marcacoes são obrigatórios.' });
        }

        try {
            const provaId = parseInt(req.params.provaId, 10);

            const { rows: [prova] } = await pool.query(
                `SELECT id, criada_por_cpf FROM classroom_provas WHERE id = $1`, [provaId]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            const cpf = session.cpf || session.rco_cpf;
            if (session.perfil !== 'admin' && prova.criada_por_cpf !== cpf) {
                return res.status(403).json({ erro: 'Acesso negado. Esta prova não é sua.' });
            }

            const { rows: [variante] } = await pool.query(
                `SELECT id, gabarito_json FROM classroom_prova_variantes WHERE id = $1 AND prova_id = $2`,
                [parseInt(varianteId, 10), provaId]
            );
            if (!variante) return res.status(404).json({ erro: 'Variante não encontrada.' });

            const emailNorm = String(alunoEmail).toLowerCase().trim();

            const { rows: existente } = await pool.query(
                `SELECT id FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false`,
                [provaId, emailNorm]
            );
            if (existente.length > 0) {
                return res.status(409).json({ erro: `${emailNorm} já possui uma submissão para esta prova. Exclua-a primeiro se quiser substituir.` });
            }

            const { nota, total } = calcularNota(variante.gabarito_json, marcacoes);

            const { rows: [sub] } = await pool.query(
                `INSERT INTO classroom_prova_submissoes
                   (prova_id, variante_id, variante_id_original, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent, origem)
                 VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,'professor')
                 RETURNING id, criada_em`,
                [provaId, variante.id, emailNorm, String(alunoNome).trim(),
                 JSON.stringify(marcacoes), nota, total,
                 'manual:' + (cpf || 'professor'), 'manual-professor']
            );

            if (!alunoNome || !String(alunoNome).trim()) {
                console.warn(`[SUBMISSAO][SEM_NOME] submissao_id=${sub.id} prova_id=${provaId} aluno_email=${emailNorm} origem=professor`);
            }

            res.json({ submissaoId: sub.id, nota, total, criada_em: sub.criada_em });

            setImmediate(() => {
                checarColaPosSubmissao(pool, {
                    provaId,
                    varianteId:    variante.id,
                    alunoEmail:    emailNorm,
                    marcacoesJson: marcacoes,
                });
            });
        } catch (e) {
            if (e.code === '23505') {
                return res.status(409).json({ erro: 'Você já enviou a correção desta prova.' });
            }
            console.error('[PROVAS] Erro ao registrar submissão manual:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Atribuir folha para turma corretora (professor cria submissão-gatilho sem marcações) ── */
    router.post('/classroom/provas/:provaId/turma-corretora/atribuir-folha', async (req, res) => {
        const session = req.userSession;
        if (!session) return res.status(401).json({ erro: 'Não autenticado.' });

        const { alunoNome, alunoEmail, varianteCodigo } = req.body || {};
        if (!alunoNome || !alunoEmail || !varianteCodigo) {
            return res.status(400).json({ erro: 'alunoNome, alunoEmail e varianteCodigo são obrigatórios.' });
        }

        try {
            const provaId = parseInt(req.params.provaId, 10);
            const { rows: [prova] } = await pool.query(
                `SELECT id, criada_por_cpf, turma_corretora_id FROM classroom_provas WHERE id = $1`, [provaId]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            const cpf = session.cpf || session.rco_cpf;
            if (session.perfil !== 'admin' && prova.criada_por_cpf !== cpf) {
                return res.status(403).json({ erro: 'Acesso negado. Esta prova não é sua.' });
            }
            if (!prova.turma_corretora_id) {
                return res.status(400).json({ erro: 'Esta prova não tem turma corretora configurada.' });
            }

            const emailNorm = String(alunoEmail).toLowerCase().trim();

            const { rows: [variante] } = await pool.query(
                `SELECT id, gabarito_json FROM classroom_prova_variantes WHERE prova_id = $1 AND codigo = $2`,
                [provaId, String(varianteCodigo)]
            );
            if (!variante) return res.status(404).json({ erro: `Variante "${varianteCodigo}" não encontrada.` });

            const { rows: existente } = await pool.query(
                `SELECT id FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false AND eh_turma_corretora = false`,
                [provaId, emailNorm]
            );
            if (existente.length > 0) {
                return res.status(409).json({ erro: `${emailNorm} já possui uma submissão para esta prova.` });
            }

            /* Calcula total_max a partir do gabarito (marcações em branco → nota 0) */
            const { total } = calcularNota(variante.gabarito_json, {});

            const { rows: [sub] } = await pool.query(
                `INSERT INTO classroom_prova_submissoes
                   (prova_id, variante_id, variante_id_original, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent, origem)
                 VALUES ($1,$2,$2,$3,$4,$5,0,$6,$7,$8,'professor-tcor')
                 RETURNING id, criada_em`,
                [provaId, variante.id, emailNorm, String(alunoNome).trim(),
                 JSON.stringify({}), total,
                 'manual:' + (cpf || 'professor'), 'manual-professor']
            );

            res.json({ submissaoId: sub.id, criada_em: sub.criada_em });

            /* Notifica turma corretora sobre a nova folha disponível */
            setImmediate(async () => {
                try {
                    await notificarTurmaCorretora(pool, prova, emailNorm);
                } catch (e) {
                    console.warn(`[NOTIF-TC] Falhou ao notificar após atribuição manual (prova ${provaId}): ${e.message}`);
                }
            });
        } catch (e) {
            if (e.code === '23505') {
                return res.status(409).json({ erro: 'Você já enviou a correção desta prova.' });
            }
            console.error('[PROVAS] Erro ao atribuir folha para turma corretora:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Mapeamento de questões físicas — GET ── */
    router.get('/classroom/provas/:id/mapa-questoes', async (req, res) => {
        if (!req.userSession) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const { rows } = await pool.query(
                `SELECT qf.questao_fisica, qf.variante_id, qf.posicao,
                        qf.alternativas_json, v.codigo AS variante_codigo
                   FROM classroom_prova_mapa_questoes qf
                   JOIN classroom_prova_variantes v ON v.id = qf.variante_id
                  WHERE qf.prova_id = $1
                  ORDER BY qf.questao_fisica, v.codigo`,
                [req.params.id]
            );
            res.json({ mapa: rows });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Mapeamento de questões físicas — SAVE ── */
    router.put('/classroom/provas/:id/mapa-questoes', async (req, res) => {
        if (!req.userSession) return res.status(401).json({ erro: 'Não autenticado.' });
        const { mapa } = req.body || {};
        if (!Array.isArray(mapa)) return res.status(400).json({ erro: 'mapa deve ser um array.' });

        const provaId = parseInt(req.params.id, 10);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM classroom_prova_mapa_questoes WHERE prova_id = $1', [provaId]);
            for (const item of mapa) {
                const { questao_fisica, variante_id, posicao, alternativas_json } = item;
                if (!questao_fisica || !variante_id || !posicao) continue;
                await client.query(
                    `INSERT INTO classroom_prova_mapa_questoes
                        (prova_id, questao_fisica, variante_id, posicao, alternativas_json)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (prova_id, questao_fisica, variante_id)
                     DO UPDATE SET posicao = $4, alternativas_json = $5`,
                    [provaId, questao_fisica, variante_id, posicao,
                     alternativas_json ? JSON.stringify(alternativas_json) : null]
                );
            }
            await client.query('COMMIT');
            logProvas(req, 'MAPA_QUESTOES_SALVO', { provaId, total: mapa.length });
            res.json({ ok: true, salvo: mapa.length });
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ erro: e.message });
        } finally {
            client.release();
        }
    });

    /* ── Mapeamento de questões físicas — SUGERIR via taxa de acerto ── */
    router.get('/classroom/provas/:id/mapa-questoes/sugerir', async (req, res) => {
        if (!req.userSession) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const provaId = parseInt(req.params.id, 10);
            const { rows: variantes } = await pool.query(
                `SELECT id, codigo, gabarito_json FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                [provaId]
            );
            if (variantes.length < 2) return res.status(400).json({ erro: 'São necessárias ao menos 2 variantes.' });

            const { rows: submissoes } = await pool.query(
                `SELECT variante_id, marcacoes_json FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_segundo_corretor = false`,
                [provaId]
            );
            const subsByVar = {};
            for (const s of submissoes) {
                if (!subsByVar[s.variante_id]) subsByVar[s.variante_id] = [];
                subsByVar[s.variante_id].push(s.marcacoes_json || {});
            }

            /* Calcula taxa de acerto por variante/posição */
            const passRates = {};
            let minSubs = Infinity;
            for (const v of variantes) {
                const subs = subsByVar[v.id] || [];
                if (subs.length === 0) { passRates[v.id] = null; continue; }
                minSubs = Math.min(minSubs, subs.length);
                const gab = (v.gabarito_json || []).filter(q => q.tipo !== 'discursiva');
                const rates = {};
                for (const q of gab) {
                    const qStr = String(q.questao);
                    let acertos = 0;
                    for (const marc of subs) {
                        const resp = marc[qStr];
                        let certo = false;
                        if (q.tipo === 'multipla') certo = resp !== undefined && String(resp).toLowerCase() === String(q.correta || '').toLowerCase();
                        else if (q.tipo === 'vf' && Array.isArray(q.correta)) certo = Array.isArray(resp) && resp.length === q.correta.length && resp.every((x, i) => String(x).toUpperCase() === String(q.correta[i]).toUpperCase());
                        if (certo) acertos++;
                    }
                    rates[q.questao] = subs.length > 0 ? acertos / subs.length : 0;
                }
                passRates[v.id] = rates;
            }

            const variantesComSubs = variantes.filter(v => passRates[v.id] !== null).length;
            if (variantesComSubs < 2) return res.status(400).json({ erro: 'Pelo menos 2 variantes precisam ter submissões para sugerir o mapeamento.' });
            if (minSubs !== Infinity && minSubs < 5) return res.status(400).json({ erro: `São necessárias ao menos 5 submissões por variante. Menor quantidade atual: ${minSubs}.` });

            /* Usa a primeira variante com submissões como canônica */
            const varBase = variantes.find(v => passRates[v.id] !== null);
            const gabBase = (varBase.gabarito_json || []).filter(q => q.tipo !== 'discursiva');
            if (gabBase.length === 0) return res.status(400).json({ erro: 'Sem questões objetivas para mapear.' });

            const mapa = [];
            const ratesBase = passRates[varBase.id];

            /* Variante canônica: questão física = posição (identidade) */
            for (const q of gabBase) mapa.push({ questao_fisica: q.questao, variante_id: varBase.id, posicao: q.questao });

            /* Outras variantes: nearest-neighbour por taxa de acerto */
            for (const v of variantes) {
                if (v.id === varBase.id || !passRates[v.id]) continue;
                const gabV = (v.gabarito_json || []).filter(q => q.tipo !== 'discursiva');
                const ratesV = passRates[v.id];
                const used = new Set();
                const sortedBase = [...gabBase].sort((a, b) => (ratesBase[a.questao] || 0) - (ratesBase[b.questao] || 0));
                for (const baseQ of sortedBase) {
                    let best = null, bestDiff = Infinity;
                    for (const vQ of gabV) {
                        if (!used.has(vQ.questao)) {
                            const diff = Math.abs((ratesBase[baseQ.questao] || 0) - (ratesV[vQ.questao] || 0));
                            if (diff < bestDiff) { bestDiff = diff; best = vQ; }
                        }
                    }
                    if (best) { mapa.push({ questao_fisica: baseQ.questao, variante_id: v.id, posicao: best.questao }); used.add(best.questao); }
                }
            }

            const aviso = variantesComSubs < variantes.length
                ? `${variantes.length - variantesComSubs} variante(s) sem submissões não foram mapeadas.`
                : null;
            res.json({ mapa, aviso, minSubs: minSubs === Infinity ? 0 : minSubs });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Confrontar dois gabaritos em memória (sem gravação) ── */
    router.post('/classroom/provas/:provaId/confrontar-dois', async (req, res) => {
        const session = req.userSession;
        if (!session) return res.status(401).json({ erro: 'Não autenticado.' });

        const { varianteAId, marcacoesA, varianteBId, marcacoesB } = req.body || {};
        if (!varianteAId || !marcacoesA || !varianteBId || !marcacoesB) {
            return res.status(400).json({ erro: 'varianteAId, marcacoesA, varianteBId e marcacoesB são obrigatórios.' });
        }

        try {
            const provaId = parseInt(req.params.provaId, 10);
            const aId = parseInt(varianteAId, 10);
            const bId = parseInt(varianteBId, 10);

            const { rows: variantes } = await pool.query(
                `SELECT id, codigo, gabarito_json FROM classroom_prova_variantes WHERE id = ANY($1) AND prova_id = $2`,
                [[aId, bId], provaId]
            );
            const varMap = Object.fromEntries(variantes.map(v => [v.id, v]));
            const varA = varMap[aId], varB = varMap[bId];
            if (!varA) return res.status(404).json({ erro: 'Variante A não encontrada.' });
            if (!varB) return res.status(404).json({ erro: 'Variante B não encontrada.' });

            const gabA = varA.gabarito_json || [];
            const gabB = varB.gabarito_json || [];
            const mesmaVariante = aId === bId;

            /* Carrega mapeamento de questões físicas + alternativas, se existir */
            const { rows: mapaRows } = await pool.query(
                `SELECT questao_fisica, variante_id, posicao, alternativas_json
                   FROM classroom_prova_mapa_questoes
                  WHERE prova_id = $1 AND variante_id = ANY($2)
                  ORDER BY questao_fisica`,
                [provaId, [aId, bId]]
            );

            /* fisicaToPos[varId][qf] = posicao
             * altMap[varId][qf]      = {letra_impressa: letra_canonica} | null */
            const fisicaToPos = {}, altMap = {};
            let altMapaDisponivel = false;
            for (const row of mapaRows) {
                if (!fisicaToPos[row.variante_id]) fisicaToPos[row.variante_id] = {};
                fisicaToPos[row.variante_id][row.questao_fisica] = row.posicao;
                if (row.alternativas_json) {
                    if (!altMap[row.variante_id]) altMap[row.variante_id] = {};
                    altMap[row.variante_id][row.questao_fisica] = row.alternativas_json;
                    altMapaDisponivel = true;
                }
            }
            const mapaCobertaA = fisicaToPos[aId] && Object.keys(fisicaToPos[aId]).length > 0;
            const mapaCobertaB = fisicaToPos[bId] && Object.keys(fisicaToPos[bId]).length > 0;
            const mapaUsado    = !mesmaVariante && mapaCobertaA && mapaCobertaB;
            const altMapaUsado = mapaUsado && altMapaDisponivel;

            /* Traduz letra impressa → letra canônica usando altMap */
            const _traduzirAlt = (letra, varId, qf) => {
                if (!letra || mesmaVariante) return letra;
                const trad = altMap[varId]?.[qf];
                return (trad && trad[letra]) ? trad[letra] : letra;
            };

            const gabAMap = Object.fromEntries((gabA).map(q => [q.questao, q]));
            const gabBMap = Object.fromEntries((gabB).map(q => [q.questao, q]));

            const questoes = [];
            let identicas = 0, identicasErradas = 0, total = 0;

            /* Helper: avalia uma resposta */
            const _norm = (resp) => Array.isArray(resp)
                ? resp.map(x => String(x).toUpperCase()).join(',')
                : String(resp ?? '').toLowerCase();
            const _errou = (resp, q) => {
                if (resp === null) return null;
                if (q.tipo === 'multipla') return String(resp).toLowerCase() !== String(q.correta || '').toLowerCase();
                if (q.tipo === 'vf' && Array.isArray(q.correta)) {
                    const arr = Array.isArray(resp) ? resp : String(resp).split(',');
                    return arr.length !== q.correta.length ||
                           arr.some((v, k) => String(v).toUpperCase() !== String(q.correta[k]).toUpperCase());
                }
                return false;
            };

            if (mapaUsado) {
                /* Comparação por questão física */
                const questoesFisicas = [...new Set(mapaRows.map(r => r.questao_fisica))].sort((a, b) => a - b);
                for (const qf of questoesFisicas) {
                    const posA = fisicaToPos[aId]?.[qf];
                    const posB = fisicaToPos[bId]?.[qf];
                    if (!posA || !posB) continue;
                    const qA = gabAMap[posA], qB = gabBMap[posB];
                    if (!qA || !qB || qA.tipo === 'discursiva' || qB.tipo === 'discursiva') continue;
                    total++;

                    const respA = marcacoesA[String(posA)] ?? null;
                    const respB = marcacoesB[String(posB)] ?? null;
                    const normA = _norm(respA), normB = _norm(respB);
                    /* Traduz letras impressas para canônicas antes de comparar */
                    const canonA = _traduzirAlt(normA, aId, qf);
                    const canonB = _traduzirAlt(normB, bId, qf);
                    const identica = respA !== null && respB !== null && canonA === canonB;
                    const erradaA = _errou(respA, qA), erradaB = _errou(respB, qB);

                    if (identica) identicas++;
                    if (identica && erradaA && erradaB) identicasErradas++;
                    questoes.push({
                        questaoFisica: qf, posA, posB,
                        respA: normA || null, respB: normB || null,
                        canonA: canonA || null, canonB: canonB || null,
                        corretaA: Array.isArray(qA.correta) ? qA.correta.join(',') : (qA.correta || null),
                        corretaB: Array.isArray(qB.correta) ? qB.correta.join(',') : (qB.correta || null),
                        identica, erradaA, erradaB, erradasAmbos: !!(identica && erradaA && erradaB),
                    });
                }
            } else {
                /* Comparação posicional (fallback ou mesma variante) */
                for (let i = 0; i < Math.min(gabA.length, gabB.length); i++) {
                    const qA = gabA[i], qB = gabB[i];
                    if (qA.tipo === 'discursiva' || qB.tipo === 'discursiva') continue;
                    total++;

                    const respA = marcacoesA[String(qA.questao)] ?? null;
                    const respB = marcacoesB[String(qB.questao)] ?? null;
                    const normA = _norm(respA), normB = _norm(respB);
                    const identica = respA !== null && respB !== null && normA === normB;
                    const erradaA = _errou(respA, qA), erradaB = _errou(respB, qB);

                    if (identica) identicas++;
                    if (identica && erradaA && erradaB) identicasErradas++;
                    questoes.push({
                        questaoFisica: null, posA: qA.questao, posB: qB.questao,
                        respA: normA || null, respB: normB || null,
                        corretaA: Array.isArray(qA.correta) ? qA.correta.join(',') : (qA.correta || null),
                        corretaB: Array.isArray(qB.correta) ? qB.correta.join(',') : (qB.correta || null),
                        identica, erradaA, erradaB, erradasAmbos: !!(identica && erradaA && erradaB),
                    });
                }
            }

            const similaridade = total > 0 ? Math.round((identicas / total) * 100) : 0;

            res.json({
                varianteACodigo: varA.codigo,
                varianteBCodigo: varB.codigo,
                mesmaVariante, mapaUsado, altMapaUsado, total, identicas, identicasErradas, similaridade, questoes,
            });
        } catch (e) {
            console.error('[PROVAS] Erro ao confrontar dois gabaritos:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Confrontar gabarito (comparação em memória, sem gravação) ── */
    router.post('/classroom/provas/:provaId/comparar-respostas', async (req, res) => {
        const session = req.userSession;
        if (!session) return res.status(401).json({ erro: 'Não autenticado.' });

        const { varianteAlunosId, varianteGabaritoIds } = req.body || {};

        if (!varianteAlunosId || !Array.isArray(varianteGabaritoIds)) {
            return res.status(400).json({ erro: 'varianteAlunosId e varianteGabaritoIds (array) são obrigatórios.' });
        }
        if (varianteGabaritoIds.length < 1 || varianteGabaritoIds.length > 3) {
            return res.status(400).json({ erro: 'varianteGabaritoIds deve conter de 1 a 3 itens.' });
        }
        const alunosIdInt = parseInt(varianteAlunosId, 10);
        const gabIds = varianteGabaritoIds.map(id => parseInt(id, 10));
        if (gabIds.some(id => id === alunosIdInt)) {
            return res.status(400).json({ erro: 'Nenhum gabarito pode ser igual à variante dos alunos.' });
        }
        if (new Set(gabIds).size !== gabIds.length) {
            return res.status(400).json({ erro: 'Os gabaritos selecionados devem ser distintos.' });
        }

        try {
            const provaId = parseInt(req.params.provaId, 10);

            const { rows: [prova] } = await pool.query(
                `SELECT id, criada_por_cpf FROM classroom_provas WHERE id = $1`, [provaId]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            const cpf = session.cpf || session.rco_cpf;
            if (session.perfil !== 'admin' && prova.criada_por_cpf !== cpf) {
                return res.status(403).json({ erro: 'Acesso negado.' });
            }

            const { rows: [varianteAlunos] } = await pool.query(
                `SELECT id, gabarito_json FROM classroom_prova_variantes WHERE id = $1 AND prova_id = $2`,
                [alunosIdInt, provaId]
            );
            if (!varianteAlunos) return res.status(404).json({ erro: 'Variante dos alunos não encontrada.' });

            const gabaritoAlunos = {};
            for (const q of (varianteAlunos.gabarito_json || [])) {
                if (q.tipo !== 'multipla' && q.tipo !== 'vf') continue;
                gabaritoAlunos[String(q.questao)] = q;
            }

            const variantesGabarito = [];
            for (const gabId of gabIds) {
                const { rows: [vg] } = await pool.query(
                    `SELECT id, codigo, gabarito_json FROM classroom_prova_variantes WHERE id = $1 AND prova_id = $2`,
                    [gabId, provaId]
                );
                if (!vg) return res.status(404).json({ erro: `Variante de gabarito ${gabId} não encontrada.` });
                variantesGabarito.push(vg);
            }

            const { rows: submissoes } = await pool.query(
                `SELECT aluno_email, aluno_nome, marcacoes_json, COALESCE(origem, 'aluno') AS origem
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND variante_id = $2 AND eh_segundo_corretor = false
                  ORDER BY aluno_nome`,
                [provaId, varianteAlunos.id]
            );

            if (submissoes.length === 0) {
                return res.json({ similares: [], gabaritosCodigos: variantesGabarito.map(v => v.codigo), totalComparados: 0 });
            }

            function compararComGabarito(sub, varianteGabarito) {
                const marcacoes = {};
                const gabaritoQuestoes = varianteGabarito.gabarito_json || [];
                for (const q of gabaritoQuestoes) {
                    if (q.tipo !== 'multipla' && q.tipo !== 'vf') continue;
                    const qStr = String(q.questao);
                    if (q.tipo === 'multipla') {
                        if (q.correta != null) marcacoes[qStr] = q.correta;
                    } else if (q.tipo === 'vf' && Array.isArray(q.correta)) {
                        marcacoes[qStr] = q.correta;
                    }
                }
                const questoesComp = gabaritoQuestoes.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
                const total = questoesComp.length;
                const marcB = sub.marcacoes_json || {};
                let identicas = 0;
                let identicasErradas = 0;
                const detalhes = [];

                for (const q of questoesComp) {
                    const qStr = String(q.questao);
                    const respA = marcacoes[qStr] ?? null;
                    const respB = marcB[qStr] ?? null;

                    const normA = Array.isArray(respA)
                        ? respA.map(x => String(x).toUpperCase()).join(',')
                        : String(respA ?? '').toLowerCase();
                    const normB = Array.isArray(respB)
                        ? respB.map(x => String(x).toUpperCase()).join(',')
                        : String(respB ?? '').toLowerCase();

                    const igual = respA !== null && respB !== null && normA === normB;
                    if (!igual) continue;

                    identicas++;

                    const qAlunos = gabaritoAlunos[qStr];
                    let corretaParaAlunos = false;
                    if (qAlunos) {
                        if (qAlunos.tipo === 'multipla') {
                            corretaParaAlunos = String(respB ?? '').toLowerCase() === String(qAlunos.correta || '').toLowerCase();
                        } else if (qAlunos.tipo === 'vf' && Array.isArray(qAlunos.correta)) {
                            corretaParaAlunos = Array.isArray(respB) && respB.length === qAlunos.correta.length &&
                                    respB.every((v, k) => String(v).toUpperCase() === String(qAlunos.correta[k]).toUpperCase());
                        }
                    }
                    if (!corretaParaAlunos) identicasErradas++;

                    const respALabel = Array.isArray(respA) ? respA.join(',') : String(respA ?? '');
                    const respBLabel = Array.isArray(respB) ? respB.join(',') : String(respB ?? '');
                    detalhes.push({
                        questao: q.questao,
                        respAluno: respBLabel.toUpperCase(),
                        respGabarito: respALabel.toUpperCase(),
                        errada: !corretaParaAlunos,
                    });
                }

                const similaridade = total > 0 ? Math.round((identicas / total) * 100) : 0;
                return { varianteCodigo: varianteGabarito.codigo, similaridade, identicas, identicasErradas, total, detalhes };
            }

            const similares = submissoes.map(sub => {
                const porGabarito = variantesGabarito.map(vg => compararComGabarito(sub, vg));
                return {
                    alunoNome: sub.aluno_nome || sub.aluno_email,
                    origem: sub.origem,
                    porGabarito,
                };
            });

            similares.sort((a, b) => {
                const worstA = Math.max(...a.porGabarito.map(g => g.identicasErradas));
                const worstB = Math.max(...b.porGabarito.map(g => g.identicasErradas));
                if (worstB !== worstA) return worstB - worstA;
                const simA = Math.max(...a.porGabarito.map(g => g.similaridade));
                const simB = Math.max(...b.porGabarito.map(g => g.similaridade));
                return simB - simA;
            });

            res.json({ similares, gabaritosCodigos: variantesGabarito.map(v => v.codigo), totalComparados: submissoes.length });
        } catch (e) {
            console.error('[PROVAS] Erro ao comparar respostas:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ── Excluir submissão registrada manualmente ── */
    router.delete('/classroom/provas/:provaId/submissoes/:subId/manual', async (req, res) => {
        const session = req.session?.usuario;
        if (!session) return res.status(401).json({ erro: 'Não autenticado.' });

        try {
            const provaId = parseInt(req.params.provaId, 10);
            const subId   = parseInt(req.params.subId,   10);

            const { rows: [prova] } = await pool.query(
                `SELECT id, criada_por_cpf FROM classroom_provas WHERE id = $1`, [provaId]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            const cpf = session.cpf || session.rco_cpf;
            if (session.perfil !== 'admin' && prova.criada_por_cpf !== cpf) {
                return res.status(403).json({ erro: 'Acesso negado.' });
            }

            const { rows: [sub] } = await pool.query(
                `SELECT id, origem FROM classroom_prova_submissoes
                  WHERE id = $1 AND prova_id = $2 AND eh_segundo_corretor = false`,
                [subId, provaId]
            );
            if (!sub) return res.status(404).json({ erro: 'Submissão não encontrada.' });
            if (sub.origem !== 'professor') {
                return res.status(403).json({ erro: 'Só é possível excluir submissões inseridas manualmente pelo professor.' });
            }

            await pool.query(`DELETE FROM classroom_prova_submissoes WHERE id = $1`, [subId]);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Gera PDF formal da análise de cola */
    router.get('/classroom/provas/:id/cola-pdf', async (req, res) => {
        try {
            const provaId = req.params.id;
            const PDFDocument = (await import('pdfkit')).default;

            /* Carrega dados da prova — sem JOIN falso; curso_id é o ID do Google Classroom */
            const { rows: [prova] } = await pool.query(
                `SELECT * FROM classroom_provas WHERE id = $1`,
                [provaId]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            /* Carrega variantes e submissões */
            const { rows: variantes } = await pool.query(
                `SELECT id, codigo, gabarito_json FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                [provaId]
            );
            const { rows: submissoes } = await pool.query(
                `SELECT id, variante_id, aluno_email, aluno_nome, marcacoes_json
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_segundo_corretor = false
                  ORDER BY variante_id, aluno_email`,
                [provaId]
            );
            const { rows: flagRows } = await pool.query(
                `SELECT aluno_a, aluno_b, status, nota_professor FROM classroom_prova_cola_flags WHERE prova_id = $1 ORDER BY registrado_em`,
                [provaId]
            );

            /* Recomputa análise simplificada para o PDF */
            const gabMap = {};
            for (const v of variantes) gabMap[v.id] = { codigo: v.codigo, gabarito: v.gabarito_json };
            const porVariante = {};
            for (const s of submissoes) {
                if (!porVariante[s.variante_id]) porVariante[s.variante_id] = [];
                porVariante[s.variante_id].push(s);
            }
            const flagMap = {};
            for (const f of flagRows) flagMap[`${f.aluno_a}|${f.aluno_b}`] = f;

            /* Calcula pares suspeitos (≥70%) para o PDF */
            const paresParaPdf = [];
            for (const [varId, subs] of Object.entries(porVariante)) {
                if (subs.length < 2) continue;
                const { codigo, gabarito } = gabMap[varId] || {};
                if (!gabarito) continue;
                const questoesComp = gabarito.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
                if (questoesComp.length === 0) continue;

                /* Pass rates */
                const rateMap = {};
                for (const q of questoesComp) {
                    let ac = 0;
                    const qStr = String(q.questao);
                    for (const s of subs) {
                        const marc = (s.marcacoes_json || {})[qStr] ?? null;
                        let corr = false;
                        if (q.tipo === 'multipla') corr = marc !== null && String(marc).toLowerCase() === String(q.correta || '').toLowerCase();
                        else if (q.tipo === 'vf' && Array.isArray(q.correta)) corr = Array.isArray(marc) && marc.every((x, i) => String(x).toUpperCase() === String(q.correta[i]).toUpperCase());
                        if (corr) ac++;
                    }
                    rateMap[qStr] = subs.length ? ac / subs.length : 0;
                }

                for (let i = 0; i < subs.length; i++) {
                    for (let j = i + 1; j < subs.length; j++) {
                        const a = subs[i]; const b = subs[j];
                        const marcA = a.marcacoes_json || {}; const marcB = b.marcacoes_json || {};
                        let identicas = 0, identicasErradas = 0, somaPesos = 0, somaIgualPond = 0;
                        const questoesCoincidentes = []; /* erros coincidentes */
                        const questoesIdenticas    = []; /* respostas idênticas e corretas */
                        for (const q of questoesComp) {
                            const qStr = String(q.questao);
                            const respA = marcA[qStr] ?? null; const respB = marcB[qStr] ?? null;
                            const normA = Array.isArray(respA) ? respA.map(x=>String(x).toUpperCase()).join(',') : String(respA??'').toLowerCase();
                            const normB = Array.isArray(respB) ? respB.map(x=>String(x).toUpperCase()).join(',') : String(respB??'').toLowerCase();
                            const igual = respA !== null && respB !== null && normA === normB;
                            let corrA=false, corrB=false;
                            if (q.tipo==='multipla') { const co=String(q.correta||'').toLowerCase(); corrA=String(respA??'').toLowerCase()===co; corrB=String(respB??'').toLowerCase()===co; }
                            else if (q.tipo==='vf'&&Array.isArray(q.correta)) { corrA=Array.isArray(respA)&&respA.every((v,k)=>String(v).toUpperCase()===String(q.correta[k]).toUpperCase()); corrB=Array.isArray(respB)&&respB.every((v,k)=>String(v).toUpperCase()===String(q.correta[k]).toUpperCase()); }
                            if (igual) identicas++;
                            if (igual&&!corrA&&!corrB) {
                                identicasErradas++;
                                const respStr = Array.isArray(respA) ? respA.join(',') : String(respA??'').toUpperCase();
                                const corrStr = Array.isArray(q.correta) ? q.correta.join(',') : String(q.correta??'').toUpperCase();
                                questoesCoincidentes.push(`Q${qStr} (resp: ${respStr}, gab: ${corrStr})`);
                            } else if (igual && corrA) {
                                const respStr = Array.isArray(respA) ? respA.join(',') : String(respA??'').toUpperCase();
                                questoesIdenticas.push(`Q${qStr} (${respStr})`);
                            }
                            const peso=rateMap[qStr]??0.5; somaPesos+=peso; if(igual) somaIgualPond+=peso;
                        }
                        const total = questoesComp.length;
                        const simil = total>0 ? Math.round((identicas/total)*100) : 0;
                        const scorePond = somaPesos>0 ? Math.round((somaIgualPond/somaPesos)*100) : 0;
                        if (simil < 70) continue;
                        const [ea, eb] = [a.aluno_email, b.aluno_email].sort();
                        const flag = flagMap[`${ea}|${eb}`] || null;
                        paresParaPdf.push({
                            nomeA: a.aluno_nome||a.aluno_email, emailA: a.aluno_email,
                            nomeB: b.aluno_nome||b.aluno_email, emailB: b.aluno_email,
                            varianteCodigo: codigo, similaridade: simil, scorePonderado: scorePond,
                            identicasErradas, total, flag,
                            questoesCoincidentes, questoesIdenticas,
                        });
                    }
                }
            }
            paresParaPdf.sort((a,b) => {
                if (b.identicasErradas !== a.identicasErradas) return b.identicasErradas - a.identicasErradas;
                return b.similaridade - a.similaridade;
            });

            /* Monta o PDF */
            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            const dataProva = prova.data_aplicacao ? new Date(prova.data_aplicacao).toLocaleDateString('pt-BR') : '—';
            const nomeSanitized = prova.nome.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            res.setHeader('Content-Disposition', `attachment; filename="analise-gabarito-${nomeSanitized}-${provaId}.pdf"`);
            doc.pipe(res);

            const AZUL = '#1e40af';
            const VERMELHO = '#991b1b';
            const CINZA = '#6b7280';
            const PAGE_W = doc.page.width - 80; /* margem 40 de cada lado */

            /* Cabeçalho */
            doc.fontSize(18).fillColor(AZUL).font('Helvetica-Bold').text('Analise de gabarito — Relatório Formal', 40, 40);
            doc.fontSize(11).fillColor('#111').font('Helvetica').moveDown(0.3);
            doc.text(`Prova: ${prova.nome}`);
            if (prova.curso_id) doc.text(`Turma (Google Classroom ID): ${prova.curso_id}`);
            doc.text(`Data de aplicação: ${dataProva}`);
            if (prova.gradepen_id) doc.text(`GradePen ID: ${prova.gradepen_id}`);
            doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
            doc.moveDown(0.5);
            doc.moveTo(40, doc.y).lineTo(40 + PAGE_W, doc.y).strokeColor('#d1d5db').lineWidth(1).stroke();
            doc.moveDown(0.5);

            /* Resumo */
            doc.fontSize(13).fillColor(AZUL).font('Helvetica-Bold').text('Resumo');
            doc.fontSize(11).fillColor('#111').font('Helvetica');
            doc.text(`Total de pares suspeitos (≥70% de similaridade): ${paresParaPdf.length}`);
            const criticos = paresParaPdf.filter(p => p.similaridade >= 85).length;
            doc.text(`Pares de alto risco (≥85%): ${criticos}`);
            const flagsInvestigar = flagRows.filter(f => f.status === 'investigar').length;
            const flagsResolvido  = flagRows.filter(f => f.status === 'resolvido').length;
            doc.text(`Flagados para investigação: ${flagsInvestigar} | Resolvidos: ${flagsResolvido}`);
            doc.moveDown(0.8);

            /* Lista de pares */
            doc.fontSize(13).fillColor(AZUL).font('Helvetica-Bold').text('Pares Suspeitos (ordenados por risco)');
            doc.moveDown(0.4);

            if (paresParaPdf.length === 0) {
                doc.fontSize(11).fillColor(CINZA).font('Helvetica').text('Nenhum par com ≥70% de similaridade encontrado.');
            }

            for (let idx = 0; idx < paresParaPdf.length; idx++) {
                const par = paresParaPdf[idx];
                const nivel = par.similaridade >= 85 ? 'ALTO RISCO' : 'SUSPEITO';
                const nivelCor = par.similaridade >= 85 ? VERMELHO : '#92400e';

                /* Adiciona nova página se próximo do fim */
                if (doc.y > doc.page.height - 200) doc.addPage();

                doc.fontSize(12).fillColor(nivelCor).font('Helvetica-Bold')
                   .text(`${idx + 1}. ${nivel} — Variante .${par.varianteCodigo}`, 40, doc.y);
                doc.fontSize(10).fillColor('#111').font('Helvetica');
                doc.text(`   Aluno A: ${par.nomeA} (${par.emailA})`);
                doc.text(`   Aluno B: ${par.nomeB} (${par.emailB})`);
                doc.text(`   Similaridade bruta: ${par.similaridade}%  |  Score ponderado: ${par.scorePonderado}%  |  Erros coincidentes: ${par.identicasErradas} de ${par.total}`);

                /* Questões com erros coincidentes (destaque em vermelho) */
                if (par.questoesCoincidentes && par.questoesCoincidentes.length > 0) {
                    doc.moveDown(0.2);
                    doc.fillColor(VERMELHO).font('Helvetica-Bold')
                       .text(`   ⚑ Erros coincidentes (ambos erraram igual):`, { continued: false });
                    doc.font('Helvetica').fillColor(VERMELHO)
                       .text(`      ${par.questoesCoincidentes.join('  ·  ')}`);
                }

                /* Questões com acertos idênticos */
                if (par.questoesIdenticas && par.questoesIdenticas.length > 0) {
                    doc.moveDown(0.1);
                    doc.fillColor('#92400e').font('Helvetica')
                       .text(`   Acertos idênticos: ${par.questoesIdenticas.join('  ·  ')}`);
                }

                if (par.flag) {
                    doc.moveDown(0.2);
                    const statusLabel = par.flag.status === 'resolvido' ? '✔ Resolvido' : '⚑ Em investigação';
                    doc.fillColor(par.flag.status === 'resolvido' ? '#166534' : '#c2410c')
                       .font('Helvetica-Bold').text(`   Status: ${statusLabel}`);
                    if (par.flag.nota_professor) {
                        doc.fillColor(CINZA).font('Helvetica').text(`   Anotação: ${par.flag.nota_professor}`);
                    }
                }

                doc.fillColor('#111').font('Helvetica').moveDown(0.3);
                doc.moveTo(40, doc.y).lineTo(40 + PAGE_W, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
                doc.moveDown(0.4);
            }

            /* Rodapé */
            if (doc.y > doc.page.height - 60) doc.addPage();
            doc.moveDown(1);
            doc.fontSize(9).fillColor(CINZA).font('Helvetica')
               .text(`Este relatório foi gerado automaticamente pelo EduSync. Data: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 40, doc.y, { width: PAGE_W, align: 'center' });

            doc.end();
        } catch (e) {
            console.error('[PROVAS] Erro ao gerar PDF de cola:', e.message);
            if (!res.headersSent) res.status(500).json({ erro: e.message });
        }
    });

    /* Criar / atualizar flag de suspeita de cola num par de alunos */
    async function upsertColaFlag(req, res) {
        try {
            const provaId = req.params.id;
            let { alunoA, alunoB, status, notaProfessor } = req.body;
            if (!alunoA || !alunoB) return res.status(400).json({ erro: 'alunoA e alunoB são obrigatórios.' });
            const VALID = ['investigar', 'resolvido'];
            if (!VALID.includes(status)) return res.status(400).json({ erro: 'Status inválido. Use "investigar" ou "resolvido".' });
            /* Normaliza ordem do par para garantir chave única */
            if (alunoA > alunoB) { const tmp = alunoA; alunoA = alunoB; alunoB = tmp; }
            await pool.query(`
                INSERT INTO classroom_prova_cola_flags (prova_id, aluno_a, aluno_b, status, nota_professor, atualizado_em)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (prova_id, aluno_a, aluno_b)
                DO UPDATE SET status = $4, nota_professor = $5, atualizado_em = NOW()
            `, [provaId, alunoA, alunoB, status, notaProfessor || null]);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    }
    router.post('/classroom/provas/:id/cola-flags', upsertColaFlag);
    router.patch('/classroom/provas/:id/cola-flags', upsertColaFlag);

    /* Exportar pares flagados como CSV */
    router.get('/classroom/provas/:id/cola-flags/export', async (req, res) => {
        try {
            const provaId = req.params.id;

            /* Carrega flags existentes (apenas investigar / resolvido) */
            const { rows: flagRows } = await pool.query(
                `SELECT aluno_a, aluno_b, status, nota_professor, registrado_em
                   FROM classroom_prova_cola_flags
                  WHERE prova_id = $1
                  ORDER BY registrado_em`,
                [provaId]
            );
            if (flagRows.length === 0) {
                return res.status(404).json({ erro: 'Nenhum par flagado nesta prova.' });
            }

            /* Monta conjunto de pares flagados para look-up rápido */
            const flagMap = {};
            for (const f of flagRows) flagMap[`${f.aluno_a}|${f.aluno_b}`] = f;

            /* Recomputa análise para obter variante/similaridade/erros */
            const { rows: variantes } = await pool.query(
                `SELECT id, codigo, gabarito_json FROM classroom_prova_variantes WHERE prova_id = $1`,
                [provaId]
            );
            const { rows: submissoes } = await pool.query(
                `SELECT variante_id, aluno_email, aluno_nome, marcacoes_json
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_segundo_corretor = false`,
                [provaId]
            );

            const gabMap = {};
            for (const v of variantes) gabMap[v.id] = { codigo: v.codigo, gabarito: v.gabarito_json };

            const porVariante = {};
            for (const s of submissoes) {
                if (!porVariante[s.variante_id]) porVariante[s.variante_id] = [];
                porVariante[s.variante_id].push(s);
            }

            /* Mapa par → dados de análise */
            const analiseMap = {};
            for (const [varId, subs] of Object.entries(porVariante)) {
                if (subs.length < 2) continue;
                const { codigo, gabarito } = gabMap[varId] || {};
                if (!gabarito) continue;
                const questoesComp = gabarito.filter(q => q.tipo === 'multipla' || q.tipo === 'vf');
                if (questoesComp.length === 0) continue;

                for (let i = 0; i < subs.length; i++) {
                    for (let j = i + 1; j < subs.length; j++) {
                        const a = subs[i];
                        const b = subs[j];
                        const [ea, eb] = [a.aluno_email, b.aluno_email].sort();
                        const pairKey = `${ea}|${eb}`;
                        if (!flagMap[pairKey]) continue; /* só nos interessa pares flagados */

                        const marcA = a.aluno_email <= b.aluno_email ? (a.marcacoes_json || {}) : (b.marcacoes_json || {});
                        const marcB = a.aluno_email <= b.aluno_email ? (b.marcacoes_json || {}) : (a.marcacoes_json || {});
                        const nomeA = a.aluno_email <= b.aluno_email ? (a.aluno_nome || a.aluno_email) : (b.aluno_nome || b.aluno_email);
                        const nomeB = a.aluno_email <= b.aluno_email ? (b.aluno_nome || b.aluno_email) : (a.aluno_nome || a.aluno_email);

                        let identicas = 0;
                        let identicasErradas = 0;
                        for (const q of questoesComp) {
                            const qStr = String(q.questao);
                            const respA = marcA[qStr] ?? null;
                            const respB = marcB[qStr] ?? null;
                            const normA = Array.isArray(respA) ? respA.map(x => String(x).toUpperCase()).join(',') : String(respA ?? '').toLowerCase();
                            const normB = Array.isArray(respB) ? respB.map(x => String(x).toUpperCase()).join(',') : String(respB ?? '').toLowerCase();
                            const igual = respA !== null && respB !== null && normA === normB;
                            let corrA = false, corrB = false;
                            if (q.tipo === 'multipla') {
                                const correta = String(q.correta || '').toLowerCase();
                                corrA = String(respA ?? '').toLowerCase() === correta;
                                corrB = String(respB ?? '').toLowerCase() === correta;
                            } else if (q.tipo === 'vf' && Array.isArray(q.correta)) {
                                corrA = Array.isArray(respA) && respA.every((v, k) => String(v).toUpperCase() === String(q.correta[k]).toUpperCase());
                                corrB = Array.isArray(respB) && respB.every((v, k) => String(v).toUpperCase() === String(q.correta[k]).toUpperCase());
                            }
                            if (igual) identicas++;
                            if (igual && !corrA && !corrB) identicasErradas++;
                        }
                        const total = questoesComp.length;
                        analiseMap[pairKey] = {
                            nomeA,
                            nomeB,
                            varianteCodigo: codigo,
                            similaridade: total > 0 ? Math.round((identicas / total) * 100) : 0,
                            identicasErradas,
                        };
                    }
                }
            }

            /* Monta CSV */
            const esc = v => {
                const s = String(v ?? '');
                return s.includes(',') || s.includes('"') || s.includes('\n')
                    ? `"${s.replace(/"/g, '""')}"` : s;
            };
            const fmt = d => d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';

            const header = 'Aluno A (nome),Aluno A (email),Aluno B (nome),Aluno B (email),Variante,Similaridade (%),Erros coincidentes,Status,Nota do professor,Data de registro';
            const linhas = flagRows.map(f => {
                const info = analiseMap[`${f.aluno_a}|${f.aluno_b}`] || {};
                return [
                    esc(info.nomeA ?? f.aluno_a),
                    esc(f.aluno_a),
                    esc(info.nomeB ?? f.aluno_b),
                    esc(f.aluno_b),
                    esc(info.varianteCodigo ?? ''),
                    esc(info.similaridade ?? ''),
                    esc(info.identicasErradas ?? ''),
                    esc(f.status),
                    esc(f.nota_professor ?? ''),
                    esc(fmt(f.registrado_em)),
                ].join(',');
            });

            const csv = [header, ...linhas].join('\r\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="flags-cola-prova-${provaId}.csv"`);
            res.send('\uFEFF' + csv); /* BOM para Excel abrir como UTF-8 */
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

/* Helper interno: retorna { sub, candidatos } sem sortear nem inserir nada.
 * Compartilhado entre o endpoint de candidatos e o de sorteio.
 */
async function obterCandidatosSegundoCorretor(pool, { submissaoId, provaId }) {
    const { rows: [sub] } = await pool.query(
        `SELECT s.*, p.curso_id FROM classroom_prova_submissoes s
          JOIN classroom_provas p ON p.id = s.prova_id
         WHERE s.id = $1 AND s.prova_id = $2`,
        [submissaoId, provaId]
    );
    if (!sub) throw new Error('Submissão não encontrada nesta prova.');

    const { rows: [provaCfg] } = await pool.query(
        `SELECT permitir_outra_turma, criada_por_cpf, turma_corretora_2a_id FROM classroom_provas WHERE id = $1`,
        [sub.prova_id]
    );

    let candidatos;
    if (provaCfg?.permitir_outra_turma && provaCfg?.criada_por_cpf) {
        if (provaCfg.turma_corretora_2a_id) {
            const turmaCorretora2aId = String(provaCfg.turma_corretora_2a_id);
            const turmaDaProva      = String(sub.curso_id);
            const turmasDiferentes  = turmaCorretora2aId !== turmaDaProva;

            if (turmasDiferentes) {
                /* Turma corretora é diferente da turma da prova:
                   buscar todos os membros via Classroom API pois candidatos válidos
                   podem ainda não ter submetido nenhum gabarito. */
                let membros = [];
                try {
                    const { rows: tkRows } = await pool.query(
                        `SELECT tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
                    );
                    if (tkRows[0]) {
                        const { google } = await import('googleapis');
                        const auth = new google.auth.OAuth2(
                            process.env.GOOGLE_CLIENT_ID,
                            process.env.GOOGLE_CLIENT_SECRET,
                            process.env.GOOGLE_REDIRECT_URI || 'https://placeholder/callback'
                        );
                        auth.setCredentials(tkRows[0].tokens);
                        const classroom = google.classroom({ version: 'v1', auth });
                        let pageToken;
                        do {
                            const r = await classroom.courses.students.list({
                                courseId: turmaCorretora2aId,
                                pageSize: 100,
                                pageToken,
                            });
                            (r.data.students || []).forEach(s => {
                                const email = s.profile?.emailAddress;
                                const nome  = s.profile?.name?.fullName || null;
                                if (email) membros.push({ aluno_email: email.toLowerCase(), aluno_nome: nome });
                            });
                            pageToken = r.data.nextPageToken;
                        } while (pageToken);
                    }
                } catch (apiErr) {
                    console.warn('[SORTEAR-2C] API indisponível, usando cache:', apiErr.message);
                    const { rows: cached } = await pool.query(
                        `SELECT DISTINCT aluno_email, NULL::text AS aluno_nome
                           FROM aluno_cursos_cache WHERE curso_id = $1`,
                        [turmaCorretora2aId]
                    );
                    membros = cached;
                }

                /* Emails já atribuídos como 2º corretor nesta submissão específica */
                const { rows: jaAtribuidos } = await pool.query(
                    `SELECT LOWER(aluno_email) AS aluno_email
                       FROM classroom_prova_submissoes
                      WHERE submissao_ref_id = $1 AND eh_segundo_corretor = true`,
                    [sub.id]
                );
                const jaAtribuidosSet = new Set(jaAtribuidos.map(r => r.aluno_email));

                const emailDono = sub.aluno_email?.toLowerCase();

                /* Filtrar: excluir dono da submissão e já atribuídos. */
                candidatos = membros.filter(m => {
                    const email = (m.aluno_email || '').toLowerCase();
                    return email && email !== emailDono && !jaAtribuidosSet.has(email);
                });

                return { sub, candidatos };
            }

            /* Mesma turma: restringir pool à turma específica via submissões existentes */
            ({ rows: candidatos } = await pool.query(
                `SELECT DISTINCT ON (s.aluno_email) s.aluno_email, s.aluno_nome
                   FROM classroom_prova_submissoes s
                   JOIN classroom_provas p ON p.id = s.prova_id
                  WHERE s.aluno_email <> $1
                    AND s.eh_segundo_corretor = false
                    AND p.criada_por_cpf = $2
                    AND p.curso_id = $3
                    AND (s.prova_id <> $4 OR s.variante_id <> $5)
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = $6
                           AND c.eh_segundo_corretor = true
                           AND c.aluno_email = s.aluno_email
                    )`,
                [sub.aluno_email, provaCfg.criada_por_cpf, provaCfg.turma_corretora_2a_id, sub.prova_id, sub.variante_id, sub.id]
            ));
        } else {
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
        }
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

    return { sub, candidatos };
}

/* Helper reutilizável: sorteia (ou atribui) um 2º corretor para uma submissão.
 * Pode ser chamado pela rota manual e pelo gatilho automático pós-submissão.
 * Lança Error se não houver candidatos ou submissão inválida.
 * emailEscolhido (opcional): se fornecido, usa esse email em vez de sortear aleatoriamente,
 * após validar que ele está na lista de candidatos elegíveis.
 */
async function sortearSegundoCorretor(pool, { submissaoId, provaId, emailEscolhido }) {
    const { sub, candidatos } = await obterCandidatosSegundoCorretor(pool, { submissaoId, provaId });

    if (candidatos.length === 0) {
        throw new Error('Sem candidatos disponíveis (mesma variante, sem outras turmas elegíveis ou já corrigindo).');
    }

    let escolhido;
    if (emailEscolhido) {
        const emailNorm = emailEscolhido.toLowerCase().trim();
        escolhido = candidatos.find(c => (c.aluno_email || '').toLowerCase() === emailNorm);
        if (!escolhido) throw new Error('Candidato selecionado não é elegível para esta correção.');
    } else {
        escolhido = candidatos[Math.floor(Math.random() * candidatos.length)];
    }

    await pool.query(
        `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
         VALUES ($1,'segundo_corretor',$2,$3,$4,$5)`,
        [escolhido.aluno_email, String(sub.id),
         'Você foi sorteado para uma 2ª correção',
         'Ajude na verificação de uma prova (anônima). Acesse "Minhas tarefas de correção" no portal.',
         JSON.stringify({ submissaoRefId: sub.id, provaId: sub.prova_id })]
    );

    return { sorteado: escolhido.aluno_email };
}

/**
 * sortearAlunoTurmaCorretora
 * ──────────────────────────
 * Sorteia UM membro da turma corretora para corrigir uma submissão específica,
 * cria o registro de pré-atribuição em classroom_prova_submissoes e notifica
 * o sorteado. Retorna o e-mail do sorteado ou null se nenhum elegível disponível.
 *
 * Balanceamento de carga: conta quantas pré-atribuições de eh_turma_corretora=true
 * cada membro já tem para esta prova. Sorteia aleatoriamente entre os de menor contagem.
 */
async function sortearAlunoTurmaCorretora(pool, { submissaoId, prova }) {
    /* Busca todos os membros da turma corretora via Classroom API */
    let membros = [];
    try {
        const { rows: tkRows } = await pool.query(
            `SELECT tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
        );
        if (tkRows[0]) {
            const { google } = await import('googleapis');
            const auth = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI || 'https://placeholder/callback'
            );
            auth.setCredentials(tkRows[0].tokens);
            const classroom = google.classroom({ version: 'v1', auth });
            let pageToken;
            do {
                const r = await classroom.courses.students.list({
                    courseId:  String(prova.turma_corretora_id),
                    pageSize:  100,
                    pageToken,
                });
                (r.data.students || []).forEach(s => {
                    const email = s.profile?.emailAddress;
                    const nome  = s.profile?.name?.fullName || null;
                    if (email) membros.push({ email: email.toLowerCase(), nome });
                });
                pageToken = r.data.nextPageToken;
            } while (pageToken);
        }
    } catch (apiErr) {
        /* Fallback: alunos que já visitaram o portal (cache local) */
        console.warn('[SORTEAR-TC] API indisponível, usando cache:', apiErr.message);
        const { rows: cached } = await pool.query(
            `SELECT DISTINCT aluno_email AS email FROM aluno_cursos_cache WHERE curso_id = $1`,
            [String(prova.turma_corretora_id)]
        );
        membros = cached.map(r => ({ email: r.email, nome: null }));
    }

    if (membros.length === 0) {
        console.warn(`[SORTEAR-TC] Nenhum membro encontrado na turma corretora ${prova.turma_corretora_id}`);
        return null;
    }

    /* Busca o e-mail do aluno dono da submissão para não sortear o próprio aluno */
    const { rows: [subOriginal] } = await pool.query(
        `SELECT aluno_email FROM classroom_prova_submissoes WHERE id = $1`, [submissaoId]
    );
    const emailDono = subOriginal?.aluno_email?.toLowerCase();

    /* Conta correções históricas (concluídas) de cada membro para balanceamento */
    const { rows: atribuicoes } = await pool.query(
        `SELECT tc.aluno_email, COUNT(*)::int AS total
           FROM classroom_prova_submissoes tc
          WHERE tc.prova_id = $1
            AND tc.eh_turma_corretora = true
            AND tc.nota IS NOT NULL
         GROUP BY tc.aluno_email`,
        [prova.id]
    );
    const contagemMap = {};
    for (const row of atribuicoes) {
        contagemMap[row.aluno_email.toLowerCase()] = row.total;
    }

    /* Correctors com atribuição pendente (nota IS NULL) → indisponíveis no momento */
    const { rows: pendentes } = await pool.query(
        `SELECT DISTINCT LOWER(aluno_email) AS email
           FROM classroom_prova_submissoes
          WHERE prova_id = $1 AND eh_turma_corretora = true AND nota IS NULL`,
        [prova.id]
    );
    const ocupadosSet = new Set(pendentes.map(r => r.email));

    /* Correctors já atribuídos a ESTA submissão específica */
    const { rows: jaAtribuidos } = await pool.query(
        `SELECT aluno_email FROM classroom_prova_submissoes
          WHERE submissao_ref_id = $1 AND eh_turma_corretora = true`,
        [submissaoId]
    );
    const jaAtribuidosSet = new Set(jaAtribuidos.map(r => r.aluno_email.toLowerCase()));

    /* Filtra: remove dono, ocupados (nota IS NULL) e já atribuídos a esta submissão */
    const elegíveis = membros.filter(m =>
        m.email !== emailDono && !ocupadosSet.has(m.email) && !jaAtribuidosSet.has(m.email)
    );

    if (elegíveis.length === 0) {
        console.warn(`[SORTEAR-TC] Nenhum elegível para sub ${submissaoId} — todos ocupados ou já atribuídos`);
        return null;
    }

    /* Balanceamento: menor contagem de correções CONCLUÍDAS; sorteia entre empatados */
    const minContagem = Math.min(...elegíveis.map(m => contagemMap[m.email] ?? 0));
    const candidatos  = elegíveis.filter(m => (contagemMap[m.email] ?? 0) === minContagem);

    /* Sorteia um aleatoriamente entre os de menor carga */
    const sorteado = candidatos[Math.floor(Math.random() * candidatos.length)];

    /* Recupera dados da submissão-referência para montar o registro de pré-atribuição */
    const { rows: [ref] } = await pool.query(
        `SELECT prova_id, variante_id, total_max FROM classroom_prova_submissoes WHERE id = $1`,
        [submissaoId]
    );
    if (!ref) return null;

    /* Insere pré-atribuição com nota=NULL (marcador de "atribuída mas não corrigida") */
    try {
        await pool.query(
            `INSERT INTO classroom_prova_submissoes
               (prova_id, variante_id, variante_id_original, aluno_email, aluno_nome,
                marcacoes_json, nota, total_max, ip, user_agent,
                eh_segundo_corretor, eh_turma_corretora, submissao_ref_id, origem)
             VALUES ($1,$2,$2,$3,$4,'{}',NULL,$5,'','',false,true,$6,'tcor-sortio')
             ON CONFLICT (submissao_ref_id, aluno_email) WHERE eh_turma_corretora = true
             DO NOTHING`,
            [ref.prova_id, ref.variante_id, sorteado.email, sorteado.nome || '',
             ref.total_max, submissaoId]
        );
    } catch (e) {
        console.warn(`[SORTEAR-TC] Erro ao inserir pré-atribuição: ${e.message}`);
        return null;
    }

    /* Notifica o sorteado — referencia = prova.id para compatibilidade com o filtro
       de atribuicoes (n.referencia = p.id::text); submissaoRefId fica em dados.
       Deduplica apenas sobre notificações NÃO LIDAS para permitir re-notificação
       quando o corrector conclui a primeira folha e recebe uma segunda. */
    await pool.query(
        `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
         SELECT $1, 'turma_corretora_atribuida', $2, $3, $4, $5
          WHERE NOT EXISTS (
              SELECT 1 FROM notificacoes_aluno
               WHERE aluno_email = $1
                 AND tipo        = 'turma_corretora_atribuida'
                 AND referencia  = $2
                 AND lida        = false
          )`,
        [sorteado.email, String(prova.id),
         '✏️ Você tem uma folha para corrigir!',
         `Você foi sorteado para corrigir uma folha da prova "${prova.nome}". Acesse a aba "✏️ Correções" no Portal do Aluno.`,
         JSON.stringify({ provaId: prova.id, provaNome: prova.nome, submissaoRefId: submissaoId })]
    );

    console.log(`[SORTEAR-TC] Sorteado: ${sorteado.email} → sub ${submissaoId} (prova ${prova.id})`);
    return sorteado.email;
}

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

            const { rows: variantesRaw } = await pool.query(
                `SELECT id, codigo, jsonb_array_length(gabarito_json) AS qtd_questoes, gabarito_json
                   FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                [prova.id]
            );
            const variantes = variantesRaw.map(v => {
                const gab = Array.isArray(v.gabarito_json) ? v.gabarito_json : [];
                const questoes_n_alts = gab.map(q => (q && q.n_alternativas) ? Number(q.n_alternativas) : 4);
                return { id: v.id, codigo: v.codigo, qtd_questoes: v.qtd_questoes, questoes_n_alts };
            });

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
                    link_prova: prova.link_prova || null,
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

            if (!aluno.nome || !String(aluno.nome).trim()) {
                console.warn(`[SUBMISSAO][SEM_NOME] submissao_id=${sub.id} prova_id=${prova.id} aluno_email=${aluno.email}`);
            }

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

            /* ── Verificação de cola pós-submissão (fire-and-forget) ── */
            setImmediate(() => {
                checarColaPosSubmissao(pool, {
                    provaId:      prova.id,
                    varianteId:   variante.id,
                    alunoEmail:   aluno.email,
                    marcacoesJson: marcacoes,
                });
            });

            /* ── Sorteio automático de 2º corretor (fire-and-forget) ──
             * Não bloqueia a resposta ao aluno. Erros apenas logados. */
            setImmediate(async () => {
                try {
                    if (!prova.segundo_corretor_ativo) return;
                    const pct = Number(prova.segundo_corretor_pct ?? 15);
                    if (pct <= 0 || Math.random() * 100 >= pct) return;
                    await sortearSegundoCorretor(pool, { submissaoId: sub.id, provaId: prova.id });
                    console.log(`[PROVAS] Auto-sorteio 2º corretor OK: sub ${sub.id}, prova ${prova.id}`);
                } catch (e) {
                    console.warn(`[PROVAS] Auto-sorteio 2º corretor falhou (sub ${sub.id}): ${e.message}`);
                }
            });

            /* ── Sorteia e atribui corretor da turma corretora (fire-and-forget) ── */
            if (prova.turma_corretora_id) {
                setImmediate(async () => {
                    try {
                        const sorteado = await sortearAlunoTurmaCorretora(pool, {
                            submissaoId: sub.id,
                            prova,
                        });
                        if (sorteado) {
                            console.log(`[SORTEAR-TC] Sub ${sub.id}: atribuída a ${sorteado}`);
                        } else {
                            /* Fallback: nenhum elegível — notifica toda a turma */
                            console.warn(`[SORTEAR-TC] Sub ${sub.id}: sem elegível, usando fallback genérico`);
                            await notificarTurmaCorretora(pool, prova, aluno.email);
                        }
                    } catch (e) {
                        console.warn(`[SORTEAR-TC] Falhou (prova ${prova.id}): ${e.message}`);
                    }
                });
            }
        } catch (e) {
            if (e.code === '23505') {
                return res.status(409).json({ erro: 'Você já enviou a correção desta prova.' });
            }
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
            const { rows: pendentesRaw } = await pool.query(
                `SELECT n.id AS notif_id, n.tipo, n.criado_em, n.dados,
                        s.id AS submissao_ref_id, s.foto_url,
                        p.id AS prova_id, p.nome AS prova_nome,
                        p.segundo_corretor_ativo,
                        v.id AS variante_id, v.codigo AS variante_codigo,
                        jsonb_array_length(v.gabarito_json) AS qtd_questoes,
                        v.gabarito_json
                   FROM notificacoes_aluno n
                   JOIN classroom_prova_submissoes s ON s.id = (n.dados->>'submissaoRefId')::int
                   JOIN classroom_provas p           ON p.id = s.prova_id
                   JOIN classroom_prova_variantes v  ON v.id = s.variante_id
                  WHERE n.aluno_email = $1
                    AND n.tipo IN ('segundo_corretor','segundo_corretor_voluntario')
                    AND (p.segundo_corretor_liberacao IS NULL OR p.segundo_corretor_liberacao <= NOW())
                    AND NOT EXISTS (
                        SELECT 1 FROM classroom_prova_submissoes c
                         WHERE c.submissao_ref_id = s.id
                           AND c.aluno_email = $1
                           AND c.eh_segundo_corretor = true
                    )
                  ORDER BY n.criado_em DESC`,
                [aluno.email]
            );
            const pendentes = pendentesRaw.map(row => {
                const { gabarito_json: gab, ...rest } = row;
                const gabArr = Array.isArray(gab) ? gab : [];
                return { ...rest, questoes_n_alts: gabArr.map(q => (q && q.n_alternativas) ? Number(q.n_alternativas) : 4) };
            });
            res.json({ pendentes });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* Questões para mini-quiz (quando a submissão não tem foto) */
    router.get('/alunos-portal/segundo-corretor/:subRefId/questoes', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const { rows: [ref] } = await pool.query(
                `SELECT s.id, s.prova_id, s.variante_id, s.foto_url,
                        v.gabarito_json, v.codigo AS variante_codigo,
                        p.gradepen_id
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                   JOIN classroom_provas p           ON p.id = s.prova_id
                  WHERE s.id = $1`,
                [req.params.subRefId]
            );
            if (!ref) return res.status(404).json({ erro: 'Submissão não encontrada.' });

            /* Guard: only applicable when there is no photo */
            if (ref.foto_url) {
                return res.status(400).json({ erro: 'Esta submissão tem foto — mini-quiz não aplicável.' });
            }

            const { rows: notif } = await pool.query(
                `SELECT id FROM notificacoes_aluno
                  WHERE aluno_email = $1
                    AND tipo IN ('segundo_corretor','segundo_corretor_voluntario')
                    AND (dados->>'submissaoRefId')::int = $2 LIMIT 1`,
                [aluno.email, ref.id]
            );
            if (notif.length === 0) return res.status(403).json({ erro: 'Você não foi sorteado para esta correção.' });

            const { rows: mapaQs } = await pool.query(
                `SELECT qf.posicao, qf.alternativas_json
                   FROM classroom_prova_mapa_questoes qf
                  WHERE qf.prova_id = $1 AND qf.variante_id = $2
                  ORDER BY qf.posicao`,
                [ref.prova_id, ref.variante_id]
            );

            const altByPos = {};
            for (const row of mapaQs) {
                altByPos[row.posicao] = row.alternativas_json;
            }

            /* Best-effort: try to enrich with enunciados from GradePen if session is active */
            let gpQuestoes = null;
            try {
                if (_gpPage && Date.now() < _gpPageExp && ref.gradepen_id) {
                    const varIdx = parseInt(ref.variante_codigo, 10);
                    if (!isNaN(varIdx)) {
                        const gpData = await gpFetchAnswers(ref.gradepen_id, varIdx);
                        if (gpData && Array.isArray(gpData.questions)) {
                            gpQuestoes = gpData.questions;
                        }
                    }
                }
            } catch (_gpErr) {
                /* GradePen unavailable or error — continue without enunciados */
            }

            const GP_LETRAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

            const gabarito = ref.gabarito_json || [];
            const questoes = gabarito.map((q, idx) => {
                const pos   = idx + 1;
                const tipo  = q.tipo || 'multipla';
                /* vf_count tells the frontend how many sub-items to render for V/F questions */
                const vfCount = (tipo === 'vf' && Array.isArray(q.correta)) ? q.correta.length : null;
                const nAlts   = q.n_alternativas || (tipo === 'multipla' ? 4 : null);

                let enunciado  = null;
                let altTexts   = altByPos[pos] || null;

                /* Enrich from GradePen data if available */
                const gpQ = gpQuestoes ? (gpQuestoes[idx] || null) : null;
                if (gpQ) {
                    const raw = gpQ.statement || gpQ.text || gpQ.title || gpQ.stem || gpQ.question || null;
                    if (raw && typeof raw === 'string' && raw.trim()) enunciado = raw.trim();
                    /* Extract alternative texts from GradePen choices array if present */
                    if (!altTexts && Array.isArray(gpQ.choices) && gpQ.choices.length > 0) {
                        altTexts = {};
                        gpQ.choices.forEach((ch, i) => {
                            if (GP_LETRAS[i]) {
                                altTexts[GP_LETRAS[i]] = typeof ch === 'string' ? ch : (ch.text || ch.label || String(ch));
                            }
                        });
                    }
                }

                return {
                    questao:       q.questao,
                    tipo,
                    vf_count:      vfCount,
                    n_alternativas: nAlts,
                    alternativas:  altTexts,
                    enunciado,
                };
            });

            res.json({ qtd_questoes: gabarito.length, questoes });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /* PDF da prova para o segundo corretor (modo mini-quiz sem foto) */
    router.get('/alunos-portal/segundo-corretor/:subRefId/prova-pdf', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).send('Não autenticado.');
        try {
            const subRefId = parseInt(req.params.subRefId, 10);

            const { rows: notif } = await pool.query(
                `SELECT id FROM notificacoes_aluno
                  WHERE aluno_email = $1
                    AND tipo IN ('segundo_corretor','segundo_corretor_voluntario')
                    AND (dados->>'submissaoRefId')::int = $2 LIMIT 1`,
                [aluno.email, subRefId]
            );
            if (notif.length === 0) return res.status(403).send('Você não foi sorteado para esta correção.');

            const { rows: [item] } = await pool.query(
                `SELECT p.link_prova,
                        p.link_prova_paginas,
                        p.id       AS prova_id,
                        v.codigo   AS variante_codigo
                   FROM classroom_provas p
                   JOIN classroom_prova_submissoes s ON s.prova_id = p.id
                   JOIN classroom_prova_variantes  v ON v.id       = s.variante_id
                  WHERE s.id = $1
                    AND p.link_prova IS NOT NULL`,
                [subRefId]
            );
            if (!item) return res.status(404).send('Submissão não encontrada ou PDF não configurado.');

            const { getPdfForVariante } = await import('../services/pdfVariante.service.js');
            const pdfBuf = await getPdfForVariante(
                item.link_prova,
                item.variante_codigo,
                item.prova_id,
                item.link_prova_paginas
            );

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition',
                `inline; filename="prova-variante-${item.variante_codigo}.pdf"`);
            res.send(pdfBuf);
        } catch (e) {
            console.error('[PDF-VARIANTE]', e.message);
            res.status(500).send('Erro ao processar PDF: ' + e.message);
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
                `SELECT s.*, v.gabarito_json, v.id AS variante_id_real,
                        p.turma_corretora_2a_correcao
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                   JOIN classroom_provas p           ON p.id = s.prova_id
                  WHERE s.id = $1`,
                [req.params.subRefId]
            );
            if (!ref) return res.status(404).json({ erro: 'Submissão de referência não encontrada.' });

            const ehProprioAluno = ref.aluno_email.toLowerCase() === aluno.email.toLowerCase();

            /* Auto-conferência permitida APENAS quando a prova tem turma_corretora_2a_correcao=true
             * E a turma corretora já corrigiu esta folha (eh_turma_corretora=true) */
            if (ehProprioAluno) {
                if (!ref.turma_corretora_2a_correcao) {
                    return res.status(403).json({ erro: 'Você não pode corrigir sua própria prova.' });
                }
                /* Verifica se a turma corretora já corrigiu esta folha */
                const { rows: tcorFeita } = await pool.query(
                    `SELECT 1 FROM classroom_prova_submissoes
                      WHERE submissao_ref_id = $1 AND eh_turma_corretora = true LIMIT 1`,
                    [ref.id]
                );
                if (tcorFeita.length === 0) {
                    return res.status(403).json({ erro: 'Aguarde a turma corretora corrigir sua folha antes de conferir.' });
                }
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
            if (e.code === '23505') {
                return res.status(409).json({ erro: 'Você já enviou a correção desta prova.' });
            }
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

    /* ════════════════════════════════════════════════════════════════
     *  TURMA CORRETORA — fila e submissão
     * ════════════════════════════════════════════════════════════════ */

    /**
     * GET /api/alunos-portal/turma-corretora/disponiveis
     * Retorna as PROVAS (metadados) onde o aluno pode atuar como turma corretora.
     * Não expõe submissões individuais — o aluno identifica o dono pelo nome via buscar-aluno.
     */
    /* ── Helper: notifica alunos elegíveis da turma corretora ──────────────
     * Busca corretores via histórico de submissões no curso da turma corretora.
     * Insere notificação somente se não houver outra não-lida para a mesma prova.
     * ------------------------------------------------------------------- */
    async function notificarTurmaCorretora(pool, prova, submiterEmail) {
        const { rows: correctors } = await pool.query(
            `SELECT DISTINCT s.aluno_email
               FROM classroom_prova_submissoes s
               JOIN classroom_provas p ON p.id = s.prova_id
              WHERE p.curso_id             = $1
                AND s.eh_segundo_corretor  = false
                AND s.eh_turma_corretora   = false
                AND s.aluno_email         != $2`,
            [prova.turma_corretora_id, submiterEmail]
        );
        if (correctors.length === 0) return;

        const titulo   = '✏️ Nova folha para corrigir!';
        const mensagem = `Chegaram folhas de "${prova.nome}" aguardando correção. Abra a aba "✏️ Correções" no Portal do Aluno.`;
        const dados    = JSON.stringify({ provaId: prova.id, provaNome: prova.nome });

        for (const { aluno_email } of correctors) {
            /* Só insere se não há notificação não-lida para esta prova */
            await pool.query(
                `INSERT INTO notificacoes_aluno
                       (aluno_email, tipo, referencia, titulo, mensagem, dados)
                 SELECT $1, 'turma_corretora_disponivel', $2, $3, $4, $5
                  WHERE NOT EXISTS (
                      SELECT 1 FROM notificacoes_aluno
                       WHERE aluno_email = $1
                         AND tipo        = 'turma_corretora_disponivel'
                         AND referencia  = $2
                         AND lida        = false
                  )`,
                [aluno_email, String(prova.id), titulo, mensagem, dados]
            );
        }
        console.log(`[NOTIF-TC] Notificou ${correctors.length} corretor(es) — prova ${prova.id}`);
    }

    /* ── Helper: notifica turma corretora no momento da ATRIBUIÇÃO pelo professor ──
     * Dispara imediatamente quando o professor salva a turma corretora, sem depender
     * de submissões já existentes. Deduplicado: só insere se não há notificação
     * não-lida do mesmo tipo para a mesma prova. */
    async function notificarAtribuicaoTurmaCorretora(pool, provaId, turmaCorretoraId) {
        const { rows: [prova] } = await pool.query(
            `SELECT nome FROM classroom_provas WHERE id = $1`, [provaId]
        );
        if (!prova) return;

        /* Busca corretores via Classroom API — notifica TODOS os alunos da turma,
         * inclusive os que nunca visitaram o portal. Fallback para cache local. */
        let correctorEmails = [];
        try {
            const { rows: tkRows } = await pool.query(
                `SELECT tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
            );
            if (tkRows[0]) {
                const { google } = await import('googleapis');
                const auth = new google.auth.OAuth2(
                    process.env.GOOGLE_CLIENT_ID,
                    process.env.GOOGLE_CLIENT_SECRET,
                    process.env.GOOGLE_REDIRECT_URI || 'https://placeholder/callback'
                );
                auth.setCredentials(tkRows[0].tokens);
                const classroom = google.classroom({ version: 'v1', auth });
                let pageToken;
                do {
                    const r = await classroom.courses.students.list({
                        courseId:  String(turmaCorretoraId),
                        pageSize:  100,
                        pageToken,
                    });
                    (r.data.students || []).forEach(s => {
                        const email = s.profile?.emailAddress;
                        if (email) correctorEmails.push(email.toLowerCase());
                    });
                    pageToken = r.data.nextPageToken;
                } while (pageToken);
                console.log(`[NOTIF-TC-ATRIB] ${correctorEmails.length} aluno(s) na turma ${turmaCorretoraId} via Classroom API`);
            }
        } catch (apiErr) {
            /* Fallback: apenas alunos que já visitaram o portal (cache local) */
            console.warn('[NOTIF-TC-ATRIB] API indisponível, usando cache:', apiErr.message);
            const { rows: cached } = await pool.query(
                `SELECT DISTINCT aluno_email FROM aluno_cursos_cache WHERE curso_id = $1`,
                [String(turmaCorretoraId)]
            );
            correctorEmails = cached.map(r => r.aluno_email);
        }
        const correctors = correctorEmails.map(e => ({ aluno_email: e }));
        if (correctors.length === 0) return;

        const titulo   = '🏫 Você foi atribuído como corretor!';
        const mensagem = `O professor atribuiu sua turma para corrigir a prova "${prova.nome}". Quando as folhas chegarem, acesse a aba "✏️ Correções" no Portal do Aluno para iniciar.`;
        const dados    = JSON.stringify({ provaId: Number(provaId), provaNome: prova.nome });

        for (const { aluno_email } of correctors) {
            await pool.query(
                `INSERT INTO notificacoes_aluno
                       (aluno_email, tipo, referencia, titulo, mensagem, dados)
                 SELECT $1, 'turma_corretora_atribuida', $2, $3, $4, $5
                  WHERE NOT EXISTS (
                      SELECT 1 FROM notificacoes_aluno
                       WHERE aluno_email = $1
                         AND tipo        = 'turma_corretora_atribuida'
                         AND referencia  = $2
                         AND lida        = false
                  )`,
                [aluno_email, String(provaId), titulo, mensagem, dados]
            );
        }
        console.log(`[NOTIF-TC-ATRIB] Atribuição notificada para ${correctors.length} corretor(es) — prova ${provaId}`);
    }

    /* ── Backfill na inicialização: garante que provas já atribuídas notifiquem ──
     * Deduplicado via NOT EXISTS no INSERT — seguro chamar a cada restart. */
    setImmediate(async () => {
        try {
            const { rows: existentes } = await pool.query(
                `SELECT id, nome, turma_corretora_id
                   FROM classroom_provas
                  WHERE turma_corretora_id IS NOT NULL AND efetivada = false`
            );
            for (const p of existentes) {
                await notificarAtribuicaoTurmaCorretora(pool, p.id, p.turma_corretora_id);
            }
            if (existentes.length > 0)
                console.log(`[NOTIF-TC-BACKFILL] ${existentes.length} prova(s) verificada(s) na inicialização`);
        } catch (e) {
            console.warn('[NOTIF-TC-BACKFILL]', e.message);
        }
    });

    /**
     * GET /api/alunos-portal/turma-corretora/atribuicoes
     * Estratégia híbrida:
     *   1. Consulta notificacoes_aluno (rápido, sem API) — funciona após primeira
     *      atribuição com token válido ou após primeira visita com API.
     *   2. Se vazio, tenta Classroom API (courses.students.get por prova ativa) e
     *      cria a notificação para requisições futuras (auto-bootstrap).
     */
    router.get('/alunos-portal/turma-corretora/atribuicoes', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        /* Sub-query de pendentes reutilizada.
         * Conta submissões da turma que:
         *   1. Não têm NENHUMA linha de turma corretora (nem rascunho), E
         *   2. Não estão na fila de 2º corretor cego (notificacoes_aluno).
         * Isso espelha exatamente o filtro do dropdown no lista-turma-alvo:
         * badge e select sempre mostram o mesmo número.
         */
        const PENDENTES_SQ = `
            COALESCE((
                SELECT COUNT(*)::int
                  FROM classroom_prova_submissoes ps
                 WHERE ps.prova_id            = p.id
                   AND ps.eh_segundo_corretor = false
                   AND ps.eh_turma_corretora  = false
                   AND ps.aluno_email         != $1
                   AND NOT EXISTS (
                       SELECT 1 FROM classroom_prova_submissoes tc
                        WHERE tc.submissao_ref_id   = ps.id
                          AND tc.eh_turma_corretora = true
                          AND tc.nota IS NOT NULL
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM notificacoes_aluno na
                        WHERE na.tipo IN ('segundo_corretor', 'segundo_corretor_voluntario')
                          AND (na.dados->>'provaId')::integer     = p.id
                          AND (na.dados->>'submissaoRefId')::integer = ps.id
                   )
            ), 0)`;

        /* Sub-query de "todos corrigidos": nenhuma submissão-alvo sem correção concluída */
        const TODOS_CORRIGIDOS_SQ = `
            (
                SELECT COUNT(*) FROM classroom_prova_submissoes ps
                 WHERE ps.prova_id = p.id
                   AND ps.eh_segundo_corretor = false
                   AND ps.eh_turma_corretora  = false
            ) > 0
            AND NOT EXISTS (
                SELECT 1 FROM classroom_prova_submissoes ps2
                 WHERE ps2.prova_id = p.id
                   AND ps2.eh_segundo_corretor = false
                   AND ps2.eh_turma_corretora  = false
                   AND NOT EXISTS (
                       SELECT 1 FROM classroom_prova_submissoes tc
                        WHERE tc.submissao_ref_id = ps2.id
                          AND tc.eh_turma_corretora = true
                          AND tc.nota IS NOT NULL
                   )
            )`;

        try {
            /* ── Passo 1: notificacoes_aluno (fonte primária, sem API) ── */
            const { rows } = await pool.query(
                `SELECT p.id AS prova_id, p.nome AS prova_nome,
                        p.turma_corretora_2a_correcao, p.link_prova,
                        p.efetivada,
                        NULL::text AS turma_corretora_nome,
                        ${PENDENTES_SQ} AS pendentes,
                        (${TODOS_CORRIGIDOS_SQ}) AS todos_corrigidos
                   FROM classroom_provas p
                  WHERE (p.turma_corretora_liberacao IS NULL OR p.turma_corretora_liberacao <= NOW())
                    AND EXISTS (
                        SELECT 1 FROM notificacoes_aluno n
                         WHERE n.aluno_email = $1
                           AND n.tipo        = 'turma_corretora_atribuida'
                           AND n.referencia  = p.id::text
                    )
                  ORDER BY p.efetivada ASC, pendentes DESC, p.id`,
                [aluno.email]
            );

            if (rows.length > 0) {
                console.log(`[ATRIB] ${aluno.email} — ${rows.length} prova(s) via notificações`);

                /* Bootstrap incremental: verifica em background se há provas novas
                   atribuídas após o primeiro bootstrap (sem bloquear a resposta) */
                setImmediate(async () => {
                    try {
                        /* Provas ativas sem notificação ainda para este aluno */
                        const { rows: provasSemNotif } = await pool.query(
                            `SELECT id, nome, turma_corretora_id
                               FROM classroom_provas
                              WHERE turma_corretora_id IS NOT NULL AND efetivada = false
                                AND (turma_corretora_liberacao IS NULL OR turma_corretora_liberacao <= NOW())
                                AND NOT EXISTS (
                                    SELECT 1 FROM notificacoes_aluno n
                                     WHERE n.aluno_email = $1
                                       AND n.tipo        = 'turma_corretora_atribuida'
                                       AND n.referencia  = classroom_provas.id::text
                                )`,
                            [aluno.email]
                        );
                        if (provasSemNotif.length === 0) return;

                        const { google: g2 } = await import('googleapis');
                        const id2  = process.env.GOOGLE_CLIENT_ID;
                        const sec2 = process.env.GOOGLE_CLIENT_SECRET;
                        if (!id2 || !sec2) return;

                        let tk2 = null; let cpf2 = null;
                        try {
                            const { rows: tkr } = await pool.query(
                                `SELECT cpf, tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
                            );
                            if (tkr[0]) { tk2 = tkr[0].tokens; cpf2 = tkr[0].cpf; }
                        } catch (_) {}
                        if (!tk2) return;

                        const uri2  = `${req.protocol}://${req.get('host')}/api/classroom/callback`;
                        const auth2 = new g2.auth.OAuth2(id2, sec2, uri2);
                        auth2.setCredentials(tk2);
                        if (tk2.expiry_date && tk2.expiry_date < Date.now()) {
                            try {
                                const { credentials: cr2 } = await auth2.refreshAccessToken();
                                auth2.setCredentials(cr2);
                                if (cpf2) await pool.query(
                                    `UPDATE classroom_tokens SET tokens=$1, atualizado=NOW() WHERE cpf=$2`,
                                    [JSON.stringify(cr2), cpf2]
                                );
                            } catch (_) {}
                        }
                        const cl2 = g2.classroom({ version: 'v1', auth: auth2 });
                        for (const prova of provasSemNotif) {
                            try {
                                await cl2.courses.students.get({
                                    courseId: String(prova.turma_corretora_id),
                                    userId:   aluno.email,
                                });
                                const titulo   = '🏫 Você foi atribuído como corretor!';
                                const mensagem = `O professor atribuiu sua turma para corrigir a prova "${prova.nome}". Acesse a aba "✏️ Correções" no Portal do Aluno.`;
                                await pool.query(
                                    `INSERT INTO notificacoes_aluno
                                           (aluno_email, tipo, referencia, titulo, mensagem, dados)
                                     SELECT $1,'turma_corretora_atribuida',$2,$3,$4,$5
                                      WHERE NOT EXISTS (
                                          SELECT 1 FROM notificacoes_aluno
                                           WHERE aluno_email=$1 AND tipo='turma_corretora_atribuida' AND referencia=$2
                                      )`,
                                    [aluno.email, String(prova.id), titulo, mensagem,
                                     JSON.stringify({ provaId: Number(prova.id), provaNome: prova.nome })]
                                );
                                console.log(`[ATRIB] Bootstrap incremental: ${aluno.email} → prova ${prova.id}`);
                            } catch (e2) {
                                const c2 = e2.code || e2.status;
                                if (c2 !== 404 && c2 !== '404')
                                    console.warn(`[ATRIB] Inc-bootstrap erro prova ${prova.id}:`, e2.message);
                            }
                        }
                    } catch (bsErr) {
                        console.warn('[ATRIB] Bootstrap incremental falhou:', bsErr.message);
                    }
                });

                return res.json({ provas: rows });
            }

            /* ── Passo 1.5: aluno_cursos_cache — fallback local sem API ── */
            {
                const { rows: cacheProvas } = await pool.query(
                    `SELECT p.id AS prova_id, p.nome AS prova_nome,
                            p.turma_corretora_2a_correcao, p.link_prova,
                            p.efetivada,
                            NULL::text AS turma_corretora_nome,
                            ${PENDENTES_SQ} AS pendentes,
                            (${TODOS_CORRIGIDOS_SQ}) AS todos_corrigidos
                       FROM classroom_provas p
                       JOIN aluno_cursos_cache acc
                         ON acc.curso_id    = p.turma_corretora_id::text
                        AND acc.aluno_email = $1
                      WHERE p.turma_corretora_id IS NOT NULL
                        AND (p.turma_corretora_liberacao IS NULL OR p.turma_corretora_liberacao <= NOW())
                      ORDER BY p.efetivada ASC, pendentes DESC, p.id`,
                    [aluno.email]
                );

                if (cacheProvas.length > 0) {
                    console.log(`[ATRIB] ${aluno.email} — ${cacheProvas.length} prova(s) via cache local`);
                    /* Cria notificações persistentes em background para requests futuros */
                    setImmediate(async () => {
                        for (const p of cacheProvas) {
                            try {
                                const titulo   = '🏫 Você foi atribuído como corretor!';
                                const mensagem = `O professor atribuiu sua turma para corrigir a prova "${p.prova_nome}". Acesse a aba "✏️ Correções" no Portal do Aluno.`;
                                await pool.query(
                                    `INSERT INTO notificacoes_aluno
                                           (aluno_email, tipo, referencia, titulo, mensagem, dados)
                                     SELECT $1,'turma_corretora_atribuida',$2,$3,$4,$5
                                      WHERE NOT EXISTS (
                                          SELECT 1 FROM notificacoes_aluno
                                           WHERE aluno_email=$1 AND tipo='turma_corretora_atribuida' AND referencia=$2
                                      )`,
                                    [aluno.email, String(p.prova_id), titulo, mensagem,
                                     JSON.stringify({ provaId: Number(p.prova_id), provaNome: p.prova_nome })]
                                );
                            } catch (_) {}
                        }
                    });
                    return res.json({ provas: cacheProvas });
                }
            }

            /* ── Passo 2: Classroom API — auto-bootstrap se aluno ainda não tem notif ── */
            const { rows: provasAtivas } = await pool.query(
                `SELECT id, nome, turma_corretora_id
                   FROM classroom_provas
                  WHERE turma_corretora_id IS NOT NULL AND efetivada = false
                    AND (turma_corretora_liberacao IS NULL OR turma_corretora_liberacao <= NOW())`
            );

            if (provasAtivas.length === 0) {
                return res.json({ provas: [] });
            }

            /* Carrega token do professor (tabela → fallback arquivo legado) */
            const { google } = await import('googleapis');
            const clientId  = process.env.GOOGLE_CLIENT_ID;
            const clientSec = process.env.GOOGLE_CLIENT_SECRET;
            if (!clientId || !clientSec) {
                console.warn('[ATRIB] GOOGLE_CLIENT_ID/SECRET ausentes');
                return res.json({ provas: [] });
            }

            let token     = null;
            let cpfFromDb = null;
            try {
                const { rows: tk } = await pool.query(
                    `SELECT cpf, tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
                );
                if (tk[0]) { token = tk[0].tokens; cpfFromDb = tk[0].cpf; }
            } catch (_) {}

            /* Fallback: arquivo legado (mesmo que getTeacherAuth usa) */
            if (!token) {
                try {
                    const fsSync = (await import('fs')).default;
                    const filePath = new URL('../../data/classroom_token.json', import.meta.url).pathname;
                    if (fsSync.existsSync(filePath))
                        token = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
                } catch (_) {}
            }

            if (!token) {
                console.warn('[ATRIB] Nenhum token de professor disponível — aluno não descoberto via API');
                return res.json({ provas: [] });
            }

            const uri  = `${req.protocol}://${req.get('host')}/api/classroom/callback`;
            const auth = new google.auth.OAuth2(clientId, clientSec, uri);
            auth.setCredentials(token);

            /* Renova token se expirado */
            if (token.expiry_date && token.expiry_date < Date.now()) {
                try {
                    const { credentials } = await auth.refreshAccessToken();
                    auth.setCredentials(credentials);
                    if (cpfFromDb) {
                        await pool.query(
                            `UPDATE classroom_tokens SET tokens = $1, atualizado = NOW() WHERE cpf = $2`,
                            [JSON.stringify(credentials), cpfFromDb]
                        );
                    }
                } catch (refErr) {
                    console.warn('[ATRIB] Falha ao renovar token:', refErr.message);
                }
            }

            const classroom = google.classroom({ version: 'v1', auth });
            const provasDoAluno = [];

            for (const prova of provasAtivas) {
                try {
                    await classroom.courses.students.get({
                        courseId: String(prova.turma_corretora_id),
                        userId:   aluno.email,
                    });
                    /* Aluno é membro desta turma corretora! */
                    provasDoAluno.push(prova);

                    /* Cria notificação para requests futuros (fire-and-forget) */
                    setImmediate(async () => {
                        try {
                            const titulo   = '🏫 Você foi atribuído como corretor!';
                            const mensagem = `O professor atribuiu sua turma para corrigir a prova "${prova.nome}". Acesse a aba "✏️ Correções" no Portal do Aluno.`;
                            const dados    = JSON.stringify({ provaId: Number(prova.id), provaNome: prova.nome });
                            await pool.query(
                                `INSERT INTO notificacoes_aluno
                                       (aluno_email, tipo, referencia, titulo, mensagem, dados)
                                 SELECT $1,'turma_corretora_atribuida',$2,$3,$4,$5
                                  WHERE NOT EXISTS (
                                      SELECT 1 FROM notificacoes_aluno
                                       WHERE aluno_email = $1
                                         AND tipo        = 'turma_corretora_atribuida'
                                         AND referencia  = $2
                                  )`,
                                [aluno.email, String(prova.id), titulo, mensagem, dados]
                            );
                            console.log(`[ATRIB] Auto-notif criada: ${aluno.email} → prova ${prova.id}`);
                        } catch (_) {}
                    });
                } catch (apiErr) {
                    const code = apiErr.code || apiErr.status;
                    if (code !== 404 && code !== '404') {
                        console.warn(`[ATRIB] Erro ao verificar curso ${prova.turma_corretora_id}:`, apiErr.message);
                    }
                    /* 404 = aluno não está neste curso — normal, pula */
                }
            }

            if (provasDoAluno.length === 0) {
                console.log(`[ATRIB] ${aluno.email} — não é membro de nenhuma turma_corretora ativa`);
                return res.json({ provas: [] });
            }

            /* Busca detalhes completos para as provas encontradas */
            const ids = provasDoAluno.map(p => p.id);
            const ph  = ids.map((_, i) => `$${i + 2}`).join(', ');
            const { rows: resultado } = await pool.query(
                `SELECT p.id AS prova_id, p.nome AS prova_nome,
                        p.turma_corretora_2a_correcao, p.link_prova,
                        NULL::text AS turma_corretora_nome,
                        ${PENDENTES_SQ} AS pendentes,
                        (${TODOS_CORRIGIDOS_SQ}) AS todos_corrigidos
                   FROM classroom_provas p
                  WHERE p.id IN (${ph}) AND p.efetivada = false
                  ORDER BY pendentes DESC, p.id`,
                [aluno.email, ...ids]
            );

            console.log(`[ATRIB] ${aluno.email} — ${resultado.length} prova(s) descoberta(s) via API`);
            res.json({ provas: resultado });

        } catch (e) {
            console.error('[ATRIB] Erro inesperado:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    router.get('/alunos-portal/turma-corretora/disponiveis', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const { rows } = await pool.query(
                `SELECT DISTINCT
                    p.id            AS prova_id,
                    p.nome          AS prova_nome,
                    p.turma_corretora_id,
                    p.turma_corretora_2a_correcao
                 FROM classroom_provas p
                 JOIN classroom_prova_submissoes s ON s.prova_id = p.id
                WHERE p.turma_corretora_id IS NOT NULL
                  AND p.efetivada = false
                  AND s.eh_segundo_corretor = false
                  AND s.eh_turma_corretora  = false
                  AND s.aluno_email != $1
                  AND NOT EXISTS (
                      SELECT 1 FROM classroom_prova_submissoes tc
                       WHERE tc.submissao_ref_id = s.id
                         AND tc.eh_turma_corretora = true
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM classroom_prova_submissoes tc2
                       WHERE tc2.submissao_ref_id = s.id
                         AND tc2.aluno_email = $1
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM classroom_prova_submissoes sc
                       JOIN classroom_provas pc ON pc.id = sc.prova_id
                      WHERE sc.aluno_email = $1
                        AND pc.curso_id = p.curso_id
                        AND sc.eh_segundo_corretor = false
                        AND sc.eh_turma_corretora  = false
                  )
                ORDER BY p.id`,
                [aluno.email]
            );
            res.json({ provas: rows });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * GET /api/alunos-portal/turma-corretora/buscar-aluno?prova_id=&nome=
     * Busca alunos elegíveis da turma-alvo cujo nome contém o texto informado.
     * Mínimo 2 caracteres. Retorna até 10 resultados com submissao_ref_id para redirecionar.
     */
    router.get('/alunos-portal/turma-corretora/buscar-aluno', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        const { prova_id, nome } = req.query;
        if (!prova_id) return res.status(400).json({ erro: 'prova_id obrigatório.' });
        const nomeTrimmed = String(nome || '').trim();
        if (nomeTrimmed.length < 2) return res.status(400).json({ erro: 'nome mínimo 2 caracteres.' });
        try {
            const pid = parseInt(prova_id, 10);

            /* Prova + variantes em paralelo */
            const [{ rows: [prova] }, { rows: variantes }] = await Promise.all([
                pool.query(
                    `SELECT id, nome, curso_id, turma_corretora_id, turma_corretora_2a_correcao
                       FROM classroom_provas
                      WHERE id = $1 AND efetivada = false AND turma_corretora_id IS NOT NULL`,
                    [pid]
                ),
                pool.query(
                    `SELECT id, codigo FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                    [pid]
                ),
            ]);
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada.' });

            /* ── Branch 1: alunos COM submissão nesta prova (DB) ── */
            /* Retorna email interno para deduplicação; removido antes de enviar ao cliente. */
            const { rows: comSubmissaoRaw } = await pool.query(
                `SELECT
                    s.id            AS submissao_ref_id,
                    s.foto_url      AS foto_url,
                    s.aluno_nome,
                    CONCAT(LEFT(s.aluno_email,2),'***@',SPLIT_PART(s.aluno_email,'@',2)) AS email_mascarado,
                    s.aluno_email   AS _email_interno,
                    NULL::text      AS email_real,
                    p.id            AS prova_id,
                    p.nome          AS prova_nome,
                    p.turma_corretora_2a_correcao,
                    v.codigo        AS variante_codigo,
                    jsonb_array_length(v.gabarito_json)::integer AS qtd_questoes,
                    false           AS sem_submissao
                 FROM classroom_provas p
                 JOIN classroom_prova_submissoes s ON s.prova_id = p.id
                 JOIN classroom_prova_variantes  v ON v.id = s.variante_id
                WHERE p.id = $1
                  AND s.eh_segundo_corretor = false
                  AND s.eh_turma_corretora  = false
                  AND s.aluno_email != $2
                  AND (s.aluno_nome ILIKE $3 OR s.aluno_nome IS NULL)
                  AND NOT EXISTS (
                      SELECT 1 FROM classroom_prova_submissoes tc2
                       WHERE tc2.submissao_ref_id = s.id AND tc2.eh_turma_corretora = true
                  )
                ORDER BY COALESCE(s.aluno_nome,''), v.codigo
                LIMIT 10`,
                [pid, aluno.email, `%${nomeTrimmed}%`]
            );
            /* Emails já cobertos pelo branch 1 — para deduplicar o roster */
            const emailsBranch1 = new Set(comSubmissaoRaw.map(r => r._email_interno?.toLowerCase()).filter(Boolean));
            /* Remove campo interno antes de enviar ao cliente */
            const comSubmissao = comSubmissaoRaw.map(({ _email_interno, ...rest }) => rest);

            /* Emails já corrigidos pela turma corretora (qualquer corretor) — para filtrar o roster */
            const { rows: correctedRows } = await pool.query(
                `SELECT DISTINCT s_orig.aluno_email
                   FROM classroom_prova_submissoes tc
                   JOIN classroom_prova_submissoes s_orig ON s_orig.id = tc.submissao_ref_id
                  WHERE tc.prova_id = $1 AND tc.eh_turma_corretora = true`,
                [pid]
            );
            const correctedEmails = new Set(correctedRows.map(r => r.aluno_email?.toLowerCase()).filter(Boolean));

            /* ── Branch 2: Google Classroom roster da turma alvo ── */
            /* Busca TODOS os alunos da turma alvo pelo nome, independente de submissão.  */
            /* Inclui Paola e qualquer aluno que nunca acessou o portal digitalmente.     */
            const semSubmissao = [];
            try {
                const { rows: tkRows } = await pool.query(
                    `SELECT tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
                );
                if (tkRows[0]?.tokens) {
                    const { google } = await import('googleapis');
                    const auth = new google.auth.OAuth2(
                        process.env.GOOGLE_CLIENT_ID,
                        process.env.GOOGLE_CLIENT_SECRET,
                        process.env.GOOGLE_REDIRECT_URI || 'https://placeholder/callback'
                    );
                    auth.setCredentials(tkRows[0].tokens);
                    const classroom = google.classroom({ version: 'v1', auth });

                    const filtro = nomeTrimmed.toLowerCase();
                    let pageToken;
                    do {
                        const r = await classroom.courses.students.list({
                            courseId:  String(prova.curso_id),
                            pageSize:  200,
                            pageToken,
                        });
                        for (const s of (r.data.students || [])) {
                            const email = (s.profile?.emailAddress || '').toLowerCase();
                            const nomeCls = s.profile?.name?.fullName || '';
                            if (!email) continue;
                            if (email === aluno.email.toLowerCase()) continue; /* não se auto-corrigir */
                            if (emailsBranch1.has(email)) continue;            /* já aparece no branch 1 */
                            if (correctedEmails.has(email)) continue;          /* já foi corrigido por outro */
                            if (!nomeCls.toLowerCase().includes(filtro)) continue;
                            semSubmissao.push({
                                submissao_ref_id:            null,
                                foto_url:                    null,
                                aluno_nome:                  nomeCls,
                                email_mascarado:             `${email.substring(0,2)}***@${email.split('@')[1]}`,
                                email_real:                  email,
                                prova_id:                    prova.id,
                                prova_nome:                  prova.nome,
                                turma_corretora_2a_correcao: prova.turma_corretora_2a_correcao,
                                variante_codigo:             null,
                                qtd_questoes:                null,
                                sem_submissao:               true,
                            });
                        }
                        pageToken = r.data.nextPageToken;
                    } while (pageToken);

                    semSubmissao.sort((a, b) => (a.aluno_nome || '').localeCompare(b.aluno_nome || '', 'pt-BR'));
                }
            } catch (apiErr) {
                console.warn('[BUSCAR-ALUNO] Classroom API falhou, sem resultados físicos:', apiErr.message);
            }

            /* Junta: com submissão primeiro, depois sem submissão, cap 10 */
            const todos = [...comSubmissao, ...semSubmissao].slice(0, 10);
            res.json({ alunos: todos, variantes });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * GET /api/alunos-portal/turma-corretora/lista-turma-alvo?prova_id=X
     * Retorna TODOS os alunos matriculados na turma alvo da prova via Google Classroom
     * roster, com submissao_ref_id quando já submeteram digitalmente.
     * Tenta enriquecer com numchamada do Supabase (alunos) por correspondência de nome.
     */
    router.get('/alunos-portal/turma-corretora/lista-turma-alvo', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        const { prova_id } = req.query;
        if (!prova_id) return res.status(400).json({ erro: 'prova_id obrigatório.' });
        try {
            const pid = parseInt(prova_id, 10);

            const [{ rows: [prova] }, { rows: variantes }] = await Promise.all([
                pool.query(
                    `SELECT id, nome, curso_id, criada_por_cpf, turma_corretora_id, turma_corretora_2a_correcao
                       FROM classroom_provas
                      WHERE id = $1 AND efetivada = false AND turma_corretora_id IS NOT NULL`,
                    [pid]
                ),
                pool.query(
                    `SELECT id, codigo FROM classroom_prova_variantes WHERE prova_id = $1 ORDER BY codigo`,
                    [pid]
                ),
            ]);
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada ou já efetivada.' });

            /* Submissões existentes para esta prova → email → submissao_ref_id */
            const { rows: subs } = await pool.query(
                `SELECT LOWER(aluno_email) AS email, id AS submissao_ref_id
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_segundo_corretor = false AND eh_turma_corretora = false`,
                [pid]
            );
            const submissaoMap = Object.fromEntries(subs.map(r => [r.email, r.submissao_ref_id]));

            /* ── Busca token do professor (mesma lógica do endpoint atribuicoes) ── */
            const { google } = await import('googleapis');
            const clientId  = process.env.GOOGLE_CLIENT_ID;
            const clientSec = process.env.GOOGLE_CLIENT_SECRET;

            let rawToken    = null;
            let tokenCpf    = null;

            /* 1. Prefere token do criador da prova, cai para qualquer token no DB */
            try {
                const { rows: tk } = await pool.query(
                    `SELECT cpf, tokens FROM classroom_tokens
                      WHERE ($1::text IS NULL OR cpf = $1)
                      ORDER BY atualizado DESC LIMIT 1`,
                    [prova.criada_por_cpf || null]
                );
                if (tk[0]?.tokens) { rawToken = tk[0].tokens; tokenCpf = tk[0].cpf; }
            } catch (_) {}

            if (!rawToken) {
                try {
                    const { rows: tk } = await pool.query(
                        `SELECT cpf, tokens FROM classroom_tokens ORDER BY atualizado DESC LIMIT 1`
                    );
                    if (tk[0]?.tokens) { rawToken = tk[0].tokens; tokenCpf = tk[0].cpf; }
                } catch (_) {}
            }

            /* 2. Fallback: arquivo legado classroom_token.json */
            if (!rawToken) {
                try {
                    const fsSync   = (await import('fs')).default;
                    const filePath = new URL('../../data/classroom_token.json', import.meta.url).pathname;
                    if (fsSync.existsSync(filePath))
                        rawToken = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
                } catch (_) {}
            }

            if (!rawToken) {
                console.warn('[LISTA-TURMA-ALVO] Nenhum token de professor disponível.');
                return res.json({ alunos: [], variantes, aviso: 'Nenhum token de professor disponível.' });
            }

            const redirectUri = `${req.protocol}://${req.get('host')}/api/classroom/callback`;
            const auth = new google.auth.OAuth2(clientId, clientSec, redirectUri);
            auth.setCredentials(rawToken);

            /* Renova access_token se expirado */
            if (rawToken.expiry_date && rawToken.expiry_date < Date.now()) {
                try {
                    const { credentials } = await auth.refreshAccessToken();
                    auth.setCredentials(credentials);
                    if (tokenCpf) {
                        await pool.query(
                            `UPDATE classroom_tokens SET tokens = $1, atualizado = NOW() WHERE cpf = $2`,
                            [JSON.stringify(credentials), tokenCpf]
                        );
                    }
                } catch (refreshErr) {
                    console.warn('[LISTA-TURMA-ALVO] Falha ao renovar token:', refreshErr.message);
                    return res.json({ alunos: [], variantes, aviso: 'Token do professor expirado. Peça ao professor para reconectar o Google Classroom.' });
                }
            }

            const classroom = google.classroom({ version: 'v1', auth });

            console.log(`[LISTA-TURMA-ALVO] prova=${pid} curso_id=${prova.curso_id} cpf_token=${tokenCpf || 'legado'} aluno=${aluno.email}`);

            let rosterAlunos = [];
            let pageToken;
            try {
                do {
                    const r = await classroom.courses.students.list({
                        courseId: String(prova.curso_id),
                        pageSize: 200,
                        pageToken,
                        fields:   'students(userId,profile(name/fullName,emailAddress)),nextPageToken',
                    });
                    const total = (r.data.students || []).length;
                    console.log(`[LISTA-TURMA-ALVO] API retornou ${total} aluno(s) para curso ${prova.curso_id}`);
                    if (total > 0) {
                        const s0 = r.data.students[0];
                        console.log(`[LISTA-TURMA-ALVO] amostra: userId=${s0.userId} email=${s0.profile?.emailAddress || '(vazio)'} nome=${s0.profile?.name?.fullName || '(vazio)'}`);
                    }
                    for (const s of (r.data.students || [])) {
                        const email = (s.profile?.emailAddress || '').toLowerCase();
                        const nome  = s.profile?.name?.fullName || '';
                        if (!email || email === aluno.email.toLowerCase()) continue;
                        rosterAlunos.push({ email, nome });
                    }
                    pageToken = r.data.nextPageToken;
                } while (pageToken);
            } catch (apiErr) {
                console.error('[LISTA-TURMA-ALVO] Classroom API error:', apiErr.message);
                return res.status(502).json({ erro: `Erro ao acessar Google Classroom: ${apiErr.message}` });
            }

            /* ── Enriquece com numchamada via Supabase (best-effort) ── */
            const numChamadaMap = {};   /* nome_normalizado → numchamada */
            try {
                const { supabaseAdmin } = await import('../config/supabase.js');
                const { data: alunosDB } = await supabaseAdmin
                    .from('alunos')
                    .select('nome, numchamada')
                    .not('numchamada', 'is', null);

                if (alunosDB?.length) {
                    const norm = n => (n || '').toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

                    alunosDB.forEach(a => {
                        numChamadaMap[norm(a.nome)] = a.numchamada;
                    });

                    /* Tenta casar cada aluno do roster com o Supabase */
                    rosterAlunos = rosterAlunos.map(a => {
                        const nNorm = norm(a.nome);
                        /* Correspondência exata */
                        if (numChamadaMap[nNorm] != null) {
                            return { ...a, numchamada: numChamadaMap[nNorm] };
                        }
                        /* Correspondência parcial: todos os tokens do nome do Classroom
                           aparecem no nome do Supabase (ou vice-versa) */
                        const tokens = nNorm.split(' ').filter(t => t.length > 2);
                        const matched = Object.entries(numChamadaMap).find(([k]) =>
                            tokens.length > 0 && tokens.every(t => k.includes(t))
                        );
                        return { ...a, numchamada: matched ? matched[1] : null };
                    });
                }
            } catch (supErr) {
                console.warn('[LISTA-TURMA-ALVO] Supabase erro:', supErr.message);
            }

            console.log(`[LISTA-TURMA-ALVO] após enriquecimento: ${rosterAlunos.length} aluno(s) | submissaoMap keys: ${Object.keys(submissaoMap).length}`);

            /* ── Emails já cobertos por correção CONCLUÍDA de turma corretora ── */
            const { rows: corrRows } = await pool.query(
                `SELECT LOWER(aluno_email) AS email
                   FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_turma_corretora = true AND nota IS NOT NULL`,
                [pid]
            );
            const correctedSet = new Set(corrRows.map(r => r.email));
            const rosterFiltrado = rosterAlunos.filter(a => !correctedSet.has(a.email));
            console.log(`[LISTA-TURMA-ALVO] já corrigidos pela turma corretora: ${correctedSet.size} | após filtro: ${rosterFiltrado.length}`);

            /* ── Submissões já sorteadas para conferência às cegas (2º corretor) ── */
            /* Alunos cujo submissao_ref_id já possui entrada em notificacoes_aluno
               com tipo segundo_corretor / segundo_corretor_voluntario para esta prova
               não devem mais aparecer no dropdown — não há nada a fazer por elas. */
            const { rows: cegaRows } = await pool.query(
                `SELECT DISTINCT (na.dados->>'submissaoRefId')::integer AS submissao_ref_id
                   FROM notificacoes_aluno na
                  WHERE na.tipo IN ('segundo_corretor', 'segundo_corretor_voluntario')
                    AND (na.dados->>'provaId')::integer = $1
                    AND na.dados->>'submissaoRefId' IS NOT NULL`,
                [pid]
            );
            const cegaSubmissaoIds = new Set(cegaRows.map(r => r.submissao_ref_id).filter(id => id != null));
            const rosterSemCega = rosterFiltrado.filter(a => {
                const subId = submissaoMap[a.email] ?? null;
                return subId == null || !cegaSubmissaoIds.has(subId);
            });
            console.log(`[LISTA-TURMA-ALVO] na fila às cegas: ${cegaSubmissaoIds.size} | após filtro cega: ${rosterSemCega.length}`);

            /* ── Se este corrector tem pré-atribuições abertas, exibir só essas folhas ── */
            const { rows: preAssigned } = await pool.query(
                `SELECT submissao_ref_id FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND eh_turma_corretora = true
                    AND aluno_email = $2 AND nota IS NULL`,
                [pid, aluno.email]
            );
            const preAssignedIds = new Set(preAssigned.map(r => r.submissao_ref_id));
            const rosterFinal = preAssignedIds.size > 0
                ? rosterSemCega.filter(a => {
                      const subId = submissaoMap[a.email] ?? null;
                      return subId != null && preAssignedIds.has(subId);
                  })
                : rosterSemCega;

            /* ── Monta resultado final — anonimiza quando há pré-atribuição ── */
            const result = rosterFinal.map(a => {
                const subId = submissaoMap[a.email] ?? null;
                /* Correção às cegas: quando o corrector foi sorteado, não revelar a
                   identidade do aluno-alvo em nenhuma etapa (listagem inclusive). */
                if (preAssignedIds.size > 0 && subId != null && preAssignedIds.has(subId)) {
                    const anonNum = String(((subId % 999) + 1)).padStart(3, '0');
                    return {
                        nome:             `Aluno #${anonNum}`,
                        email_mascarado:  '**@**',
                        email_real:       null,
                        numchamada:       null,
                        submissao_ref_id: subId,
                        sem_submissao:    false,
                        pre_atribuida:    true,
                    };
                }
                return {
                    nome:             a.nome,
                    email_mascarado:  `${a.email.substring(0,2)}***@${a.email.split('@')[1]}`,
                    email_real:       a.email,
                    numchamada:       a.numchamada ?? null,
                    submissao_ref_id: subId,
                    sem_submissao:    subId == null,
                    pre_atribuida:    false,
                };
            });

            console.log(`[LISTA-TURMA-ALVO] resultado final: ${result.length} aluno(s)`);

            /* Ordena: numchamada asc (nulos por último), depois nome */
            result.sort((a, b) => {
                if (a.numchamada != null && b.numchamada != null) return a.numchamada - b.numchamada;
                if (a.numchamada != null) return -1;
                if (b.numchamada != null) return  1;
                return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
            });

            const todosCorrigidos = result.length === 0 && correctedSet.size > 0;
            res.json({
                alunos: result,
                variantes,
                todos_corrigidos: todosCorrigidos,
                total_turma:   rosterAlunos.length,
                ja_corrigidos: correctedSet.size,
            });
        } catch (e) {
            console.error('[LISTA-TURMA-ALVO]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * POST /api/alunos-portal/turma-corretora/iniciar-correcao
     * Cria submissão-gatilho em branco para aluno sem submissão digital,
     * chamado pelo próprio membro da turma corretora ao selecionar a variante.
     * Body: { prova_id, aluno_email, aluno_nome, variante_codigo }
     */
    router.post('/alunos-portal/turma-corretora/iniciar-correcao', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const { prova_id, aluno_email, aluno_nome, variante_codigo } = req.body || {};
        if (!prova_id || !aluno_email || !aluno_nome || !variante_codigo) {
            return res.status(400).json({ erro: 'prova_id, aluno_email, aluno_nome e variante_codigo são obrigatórios.' });
        }

        try {
            const pid = parseInt(prova_id, 10);

            /* Valida que a prova existe e tem turma corretora ativa */
            const { rows: [prova] } = await pool.query(
                `SELECT id, turma_corretora_id FROM classroom_provas
                  WHERE id = $1 AND efetivada = false AND turma_corretora_id IS NOT NULL`,
                [pid]
            );
            if (!prova) return res.status(404).json({ erro: 'Prova não encontrada ou já efetivada.' });

            /* Valida que o corrector pertence à turma corretora desta prova */
            const { rows: notif } = await pool.query(
                `SELECT 1 FROM notificacoes_aluno
                  WHERE aluno_email = $1 AND tipo = 'turma_corretora_atribuida' AND referencia = $2`,
                [aluno.email, pid.toString()]
            );
            if (notif.length === 0) {
                return res.status(403).json({ erro: 'Você não pertence à turma corretora desta prova.' });
            }

            const emailNorm = String(aluno_email).toLowerCase().trim();

            /* Evita duplicata */
            const { rows: existe } = await pool.query(
                `SELECT id FROM classroom_prova_submissoes
                  WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false AND eh_turma_corretora = false`,
                [pid, emailNorm]
            );
            if (existe.length > 0) {
                return res.json({ submissao_ref_id: existe[0].id, ja_existia: true });
            }

            const { rows: [variante] } = await pool.query(
                `SELECT id, gabarito_json FROM classroom_prova_variantes WHERE prova_id = $1 AND codigo = $2`,
                [pid, String(variante_codigo)]
            );
            if (!variante) return res.status(404).json({ erro: `Variante "${variante_codigo}" não encontrada.` });

            const { total } = calcularNota(variante.gabarito_json, {});

            const { rows: [sub] } = await pool.query(
                `INSERT INTO classroom_prova_submissoes
                   (prova_id, variante_id, variante_id_original, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent, origem)
                 VALUES ($1,$2,$2,$3,$4,$5,0,$6,$7,$8,'tcor-auto')
                 RETURNING id`,
                [pid, variante.id, emailNorm, String(aluno_nome).trim(),
                 JSON.stringify({}), total, req.ip, req.get('user-agent') || '']
            );

            console.log(`[TCOR-AUTO] Submissão criada: prova=${pid} aluno=${emailNorm} por corretor=${aluno.email}`);
            res.json({ submissao_ref_id: sub.id, ja_existia: false });

            setImmediate(async () => {
                try { await notificarTurmaCorretora(pool, prova, emailNorm); } catch (_) {}
            });
        } catch (e) {
            console.error('[TCOR-AUTO] Erro:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * DELETE /api/alunos-portal/turma-corretora/cancelar-correcao/:subRefId
     * Apaga uma submissão vazia criada por iniciar-correcao quando o corretor cancela.
     * Só remove se origem = 'tcor-auto' e marcacoes_json = '{}' (nunca preenchida).
     */
    router.delete('/alunos-portal/turma-corretora/cancelar-correcao/:subRefId', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });

        const subRefId = parseInt(req.params.subRefId, 10);
        if (!Number.isFinite(subRefId)) return res.status(400).json({ erro: 'subRefId inválido.' });

        try {
            /* Busca a submissão junto com a prova para validar pertencimento */
            const { rows: [sub] } = await pool.query(
                `SELECT s.id, s.prova_id, s.aluno_email, s.origem, s.marcacoes_json
                   FROM classroom_prova_submissoes s
                  WHERE s.id = $1
                    AND s.eh_segundo_corretor = false
                    AND s.eh_turma_corretora  = false`,
                [subRefId]
            );

            /* Se não existe, retorna sucesso (idempotente) */
            if (!sub) return res.json({ cancelado: true, motivo: 'ja_inexistente' });

            /* Valida que o corretor logado pertence à turma corretora desta prova */
            const { rows: notif } = await pool.query(
                `SELECT 1 FROM notificacoes_aluno
                  WHERE aluno_email = $1 AND tipo = 'turma_corretora_atribuida' AND referencia = $2`,
                [aluno.email, sub.prova_id.toString()]
            );
            if (notif.length === 0) {
                return res.status(403).json({ erro: 'Você não pertence à turma corretora desta prova.' });
            }

            /* Só remove submissões que foram criadas automaticamente e nunca preenchidas */
            const marcacoes = sub.marcacoes_json;
            const vazia = marcacoes == null ||
                marcacoes === '{}' ||
                (typeof marcacoes === 'object' && Object.keys(marcacoes).length === 0);

            if (sub.origem !== 'tcor-auto' || !vazia) {
                return res.status(409).json({ erro: 'Submissão já preenchida; não pode ser cancelada por este endpoint.' });
            }

            await pool.query('DELETE FROM classroom_prova_submissoes WHERE id = $1', [subRefId]);
            console.log(`[TCOR-CANCEL] Submissão ${subRefId} removida (prova=${sub.prova_id} aluno=${sub.aluno_email} corretor=${aluno.email})`);
            res.json({ cancelado: true });
        } catch (e) {
            console.error('[TCOR-CANCEL] Erro:', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * GET /api/alunos-portal/turma-corretora/prova-pdf/:subRefId
     * Serve o PDF da prova filtrando apenas as páginas da variante do aluno alvo.
     * Prioridade: mapeamento manual → auto-detecção por texto → PDF completo.
     */
    router.get('/alunos-portal/turma-corretora/prova-pdf/:subRefId', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).send('Não autenticado.');
        try {
            const { rows: [item] } = await pool.query(
                `SELECT p.link_prova,
                        p.link_prova_paginas,
                        p.id            AS prova_id,
                        v.codigo        AS variante_codigo
                   FROM classroom_provas p
                   JOIN classroom_prova_submissoes s ON s.prova_id   = p.id
                   JOIN classroom_prova_variantes  v ON v.id         = s.variante_id
                  WHERE s.id            = $1
                    AND s.aluno_email  != $2
                    AND p.turma_corretora_id IS NOT NULL
                    AND p.link_prova   IS NOT NULL`,
                [parseInt(req.params.subRefId, 10), aluno.email]
            );
            if (!item) return res.status(404).send('Submissão não encontrada ou PDF não configurado.');

            const { getPdfForVariante } = await import('../services/pdfVariante.service.js');
            const pdfBuf = await getPdfForVariante(
                item.link_prova,
                item.variante_codigo,
                item.prova_id,
                item.link_prova_paginas
            );

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition',
                `inline; filename="prova-variante-${item.variante_codigo}.pdf"`);
            res.send(pdfBuf);
        } catch (e) {
            console.error('[PDF-VARIANTE]', e.message);
            res.status(500).send('Erro ao processar PDF: ' + e.message);
        }
    });

    /**
     * GET /api/alunos-portal/turma-corretora/submissao/:subRefId
     * Retorna os detalhes de uma submissão específica para o corretor lançar as respostas.
     * Aplica as mesmas regras de elegibilidade do buscar-aluno. Expõe o nome do dono.
     */
    router.get('/alunos-portal/turma-corretora/submissao/:subRefId', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        try {
            const subRefId = parseInt(req.params.subRefId, 10);

            /* Verifica se este corrector tem uma pré-atribuição (sorteio automático) */
            const { rows: [preAtrib] } = await pool.query(
                `SELECT 1 FROM classroom_prova_submissoes
                  WHERE submissao_ref_id = $1
                    AND aluno_email = $2
                    AND eh_turma_corretora = true
                    AND nota IS NULL`,
                [subRefId, aluno.email]
            );
            const temPreAtribuicao = !!preAtrib;

            /* Condições de acesso:
             *  – Se há pré-atribuição para este corrector: permite acesso direto
             *  – Caso contrário: usa as regras antigas (disponível para qualquer membro elegível)
             * Em ambos os casos: bloqueia se a submissão já foi completamente corrigida. */
            const { rows: [itemRaw] } = await pool.query(
                `SELECT
                    s.id            AS submissao_ref_id,
                    s.foto_url,
                    s.aluno_nome,
                    p.id            AS prova_id,
                    p.nome          AS prova_nome,
                    p.link_prova,
                    p.turma_corretora_2a_correcao,
                    v.codigo        AS variante_codigo,
                    jsonb_array_length(v.gabarito_json) AS qtd_questoes,
                    v.gabarito_json
                 FROM classroom_provas p
                 JOIN classroom_prova_submissoes s ON s.prova_id = p.id
                 JOIN classroom_prova_variantes  v ON v.id = s.variante_id
                WHERE s.id = $1
                  AND p.turma_corretora_id IS NOT NULL
                  AND p.efetivada = false
                  AND s.eh_segundo_corretor = false
                  AND s.eh_turma_corretora  = false
                  AND s.aluno_email != $2
                  AND NOT EXISTS (
                      SELECT 1 FROM classroom_prova_submissoes tc
                       WHERE tc.submissao_ref_id = s.id
                         AND tc.eh_turma_corretora = true
                         AND tc.nota IS NOT NULL
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM classroom_prova_submissoes tc2
                       WHERE tc2.submissao_ref_id = s.id
                         AND tc2.aluno_email = $2
                         AND tc2.nota IS NOT NULL
                  )
                  AND (
                      $3 = true
                      OR (
                          NOT EXISTS (
                              SELECT 1 FROM classroom_prova_submissoes tc3
                               WHERE tc3.submissao_ref_id = s.id
                                 AND tc3.eh_turma_corretora = true
                          )
                          AND NOT EXISTS (
                              SELECT 1 FROM classroom_prova_submissoes sc
                               JOIN classroom_provas pc ON pc.id = sc.prova_id
                              WHERE sc.aluno_email = $2
                                AND pc.curso_id = p.curso_id
                                AND sc.eh_segundo_corretor = false
                                AND sc.eh_turma_corretora  = false
                          )
                      )
                  )`,
                [subRefId, aluno.email, temPreAtribuicao]
            );
            if (!itemRaw) return res.status(404).json({ erro: 'Folha não encontrada ou já foi corrigida por outro aluno.' });
            const { gabarito_json: _gabTcor, ...itemBase } = itemRaw;
            const gabTcorArr = Array.isArray(_gabTcor) ? _gabTcor : [];

            /* Enriquece com numchamada via Supabase (best-effort) */
            let numchamada = null;
            try {
                const { supabaseAdmin } = await import('../config/supabase.js');
                const norm = n => (n || '').toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
                const { data: alunosDB } = await supabaseAdmin
                    .from('alunos')
                    .select('nome, numchamada')
                    .not('numchamada', 'is', null);
                if (alunosDB?.length) {
                    const nNorm = norm(itemRaw.aluno_nome);
                    const numChamadaMap = {};
                    alunosDB.forEach(a => { numChamadaMap[norm(a.nome)] = a.numchamada; });
                    if (numChamadaMap[nNorm] != null) {
                        numchamada = numChamadaMap[nNorm];
                    } else {
                        const tokens = nNorm.split(' ').filter(t => t.length > 2);
                        const matched = Object.entries(numChamadaMap).find(([k]) =>
                            tokens.length > 0 && tokens.every(t => k.includes(t))
                        );
                        if (matched) numchamada = matched[1];
                    }
                }
            } catch (supErr) {
                console.warn('[TURMA-CORRETORA] Supabase numchamada erro:', supErr.message);
            }

            const item = { ...itemBase, numchamada, questoes_n_alts: gabTcorArr.map(q => (q && q.n_alternativas) ? Number(q.n_alternativas) : 4) };
            res.json({ item });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    /**
     * POST /api/alunos-portal/turma-corretora/:subRefId/submeter
     * Aluno da turma corretora marca as respostas da folha e envia.
     * Body: { marcacoes: { "1":"a", ... } }
     */
    router.post('/alunos-portal/turma-corretora/:subRefId/submeter', async (req, res) => {
        const aluno = await getAlunoSession(req);
        if (!aluno) return res.status(401).json({ erro: 'Não autenticado.' });
        const { marcacoes } = req.body || {};
        if (!marcacoes) return res.status(400).json({ erro: 'marcacoes obrigatório.' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            /* Bloqueia a linha da submissão-referência para evitar corrida */
            const { rows: [ref] } = await client.query(
                `SELECT s.*, v.gabarito_json, v.id AS variante_id_real,
                        p.turma_corretora_id, p.turma_corretora_2a_correcao,
                        p.curso_id AS prova_curso_id,
                        p.segundo_corretor_ativo, p.segundo_corretor_pct
                   FROM classroom_prova_submissoes s
                   JOIN classroom_prova_variantes v ON v.id = s.variante_id
                   JOIN classroom_provas p           ON p.id = s.prova_id
                  WHERE s.id = $1
                    AND s.eh_segundo_corretor = false
                    AND s.eh_turma_corretora  = false
                  FOR UPDATE`,
                [req.params.subRefId]
            );
            if (!ref) {
                await client.query('ROLLBACK');
                return res.status(404).json({ erro: 'Submissão de referência não encontrada.' });
            }
            if (!ref.turma_corretora_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ erro: 'Esta prova não tem turma corretora configurada.' });
            }
            if (ref.aluno_email.toLowerCase() === aluno.email.toLowerCase()) {
                await client.query('ROLLBACK');
                return res.status(403).json({ erro: 'Você não pode corrigir sua própria folha.' });
            }

            /* Impede que aluno da turma-alvo use este fluxo */
            const { rows: naAlvo } = await client.query(
                `SELECT 1 FROM classroom_prova_submissoes sc
                  JOIN classroom_provas pc ON pc.id = sc.prova_id
                 WHERE sc.aluno_email = $1
                   AND pc.curso_id = $2
                   AND sc.eh_segundo_corretor = false
                   AND sc.eh_turma_corretora  = false
                 LIMIT 1`,
                [aluno.email, ref.prova_curso_id]
            );
            if (naAlvo.length > 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({ erro: 'Alunos da turma-alvo não podem corrigir por este fluxo.' });
            }

            /* Verifica se já foi corrigida por turma corretora (correção concluída) */
            const { rows: jaCorrigida } = await client.query(
                `SELECT 1 FROM classroom_prova_submissoes
                  WHERE submissao_ref_id = $1 AND eh_turma_corretora = true AND nota IS NOT NULL LIMIT 1`,
                [ref.id]
            );
            if (jaCorrigida.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ erro: 'Esta folha já foi corrigida pela turma corretora.' });
            }

            /* Verifica se este aluno já concluiu a correção desta folha */
            const { rows: jaFez } = await client.query(
                `SELECT 1 FROM classroom_prova_submissoes
                  WHERE submissao_ref_id = $1 AND aluno_email = $2 AND nota IS NOT NULL LIMIT 1`,
                [ref.id, aluno.email]
            );
            if (jaFez.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ erro: 'Você já corrigiu esta folha.' });
            }

            const { nota, total } = calcularNota(ref.gabarito_json, marcacoes);

            /* Verifica se há pré-atribuição aberta: se existir, só o sorteado pode submeter */
            const { rows: preAtrib } = await client.query(
                `SELECT aluno_email FROM classroom_prova_submissoes
                  WHERE submissao_ref_id = $1 AND eh_turma_corretora = true AND nota IS NULL LIMIT 1`,
                [ref.id]
            );
            if (preAtrib.length > 0 && preAtrib[0].aluno_email.toLowerCase() !== aluno.email.toLowerCase()) {
                await client.query('ROLLBACK');
                return res.status(403).json({ erro: 'Esta folha foi sorteada para outro corretor.' });
            }

            /* Faz UPSERT: atualiza pré-atribuição se existir, ou insere novo registro */
            const { rows: [novaSub] } = await client.query(
                `INSERT INTO classroom_prova_submissoes
                   (prova_id, variante_id, variante_id_original, aluno_email, aluno_nome,
                    marcacoes_json, nota, total_max, ip, user_agent,
                    eh_segundo_corretor, eh_turma_corretora, submissao_ref_id, origem)
                 VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,false,true,$10,'tcor-submissao')
                 ON CONFLICT (submissao_ref_id, aluno_email) WHERE eh_turma_corretora = true
                 DO UPDATE SET
                     marcacoes_json      = EXCLUDED.marcacoes_json,
                     nota                = EXCLUDED.nota,
                     total_max           = EXCLUDED.total_max,
                     ip                  = EXCLUDED.ip,
                     user_agent          = EXCLUDED.user_agent,
                     aluno_nome          = EXCLUDED.aluno_nome,
                     origem              = EXCLUDED.origem
                 RETURNING id`,
                [ref.prova_id, ref.variante_id_real, aluno.email, aluno.nome,
                 JSON.stringify(marcacoes), nota, total,
                 req.ip, req.get('user-agent') || '', ref.id]
            );

            /* Se configurado, notifica o aluno original para auto-verificação */
            if (ref.turma_corretora_2a_correcao) {
                await client.query(
                    `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
                     VALUES ($1,'segundo_corretor',$2,$3,$4,$5)
                     ON CONFLICT DO NOTHING`,
                    [ref.aluno_email, String(ref.id),
                     'Sua folha foi corrigida — confira agora',
                     'A turma corretora analisou sua folha. Acesse "Minhas tarefas de correção" no portal para conferir.',
                     JSON.stringify({ submissaoRefId: ref.id, provaId: ref.prova_id })]
                );
            }

            await client.query('COMMIT');

            /* Sorteio anônimo de 2º corretor (fire-and-forget) */
            setImmediate(async () => {
                try {
                    if (ref.turma_corretora_2a_correcao) {
                        /* Prova configurada para sempre sortear 2º corretor via turma corretora */
                        await sortearSegundoCorretor(pool, { submissaoId: ref.id, provaId: ref.prova_id });
                        console.log(`[PROVAS] Turma-corretora: sorteio 2º corretor (obrigatório) OK para sub ${ref.id}`);
                    } else {
                        /* Fluxo probabilístico normal para provas sem turma_corretora_2a_correcao */
                        if (!ref.segundo_corretor_ativo) return;
                        const pct = Number(ref.segundo_corretor_pct ?? 15);
                        if (pct <= 0 || Math.random() * 100 >= pct) return;
                        await sortearSegundoCorretor(pool, { submissaoId: ref.id, provaId: ref.prova_id });
                        console.log(`[PROVAS] Turma-corretora: sorteio 2º corretor OK para sub ${ref.id}`);
                    }
                } catch (e) {
                    console.warn(`[PROVAS] Turma-corretora: sorteio 2º corretor falhou (sub ${ref.id}): ${e.message}`);
                }
            });

            /* XP para o corretor (fire-and-forget) */
            const xpEventos = [];
            try {
                const r1 = await reputacao.creditar({
                    alunoEmail: aluno.email, alunoNome: aluno.nome,
                    evento: 'CORRECAO_ENVIADA', submissaoId: novaSub.id,
                });
                if (r1.creditado) xpEventos.push(r1);
            } catch (e) { console.warn('[REPUTACAO] turma-corretora enviada:', e.message); }

            res.json({
                ok: true,
                nota, total,
                xpGanho: xpEventos.reduce((a, e) => a + (e.xp || 0), 0),
                aviso: 'XP de precisão será creditado quando o professor efetivar a prova.',
            });
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            if (e.code === '23505') {
                return res.status(409).json({ erro: 'Você já corrigiu esta folha.' });
            }
            res.status(500).json({ erro: e.message });
        } finally {
            client.release();
        }
    });

    return router;
}
