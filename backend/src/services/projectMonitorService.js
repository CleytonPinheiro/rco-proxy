/**
 * Monitor de Projetos — EduSync
 *
 * Rastreia repositórios GitHub cadastrados nos grupos de trabalho.
 * A cada hora, consulta a API pública do GitHub e armazena novos
 * commits em grupo_projeto_eventos (local PG). Dados são imutáveis:
 * apenas o professor pode adicionar/remover projetos; alunos só veem.
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ── Helpers públicos ────────────────────────────────────────────────────── */

export function inferirTipo(url) {
    if (!url) return 'outro';
    const u = url.toLowerCase();
    if (u.includes('github.com'))                                       return 'github';
    if (u.includes('replit.com') || u.includes('repl.it'))             return 'replit';
    if (u.includes('supabase.com') || u.includes('supabase.co'))       return 'supabase';
    if (u.includes('vercel.app'))                                       return 'vercel';
    if (u.includes('netlify.app'))                                      return 'netlify';
    if (u.includes('railway.app') || u.includes('render.com'))         return 'deploy';
    return 'outro';
}

export function parseGitHub(url) {
    try {
        const m = url.match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/);
        if (!m) return null;
        return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
    } catch { return null; }
}

/* ── Sync de um único repositório GitHub ────────────────────────────────── */

async function syncGitHub(projeto) {
    const since = projeto.ultimo_check
        ? new Date(projeto.ultimo_check).toISOString()
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const headers = {
        'User-Agent': 'EduSync-Monitor/1.0',
        'Accept': 'application/vnd.github.v3+json',
    };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

    try {
        const apiUrl = `https://api.github.com/repos/${projeto.github_owner}/${projeto.github_repo}/commits?since=${since}&per_page=50`;
        const resp = await fetch(apiUrl, { headers });

        if (!resp.ok) {
            const msg = resp.status === 404 ? 'repo não encontrado'
                      : resp.status === 409 ? 'repo vazio'
                      : resp.status === 403 ? 'rate limit atingido'
                      : `HTTP ${resp.status}`;
            console.warn(`[MONITOR] ${projeto.github_owner}/${projeto.github_repo}: ${msg}`);
            await pool.query('UPDATE grupo_projetos SET ultimo_check = NOW() WHERE id = $1', [projeto.id]);
            return 0;
        }

        const commits = await resp.json();
        if (!Array.isArray(commits) || commits.length === 0) {
            await pool.query('UPDATE grupo_projetos SET ultimo_check = NOW() WHERE id = $1', [projeto.id]);
            return 0;
        }

        let novos = 0;
        for (const c of [...commits].reverse()) { /* oldest first → timeline order */
            const sha = c.sha;
            const { rows } = await pool.query(
                'SELECT 1 FROM grupo_projeto_eventos WHERE sha = $1 AND projeto_id = $2',
                [sha, projeto.id]
            );
            if (rows.length) continue;

            const titulo    = (c.commit?.message?.split('\n')[0] || '(sem mensagem)').slice(0, 255);
            const autor     = (c.commit?.author?.name || c.author?.login || 'desconhecido').slice(0, 100);
            const urlEvento = (c.html_url || '').slice(0, 500);
            const detectEm  = c.commit?.author?.date || new Date().toISOString();

            await pool.query(
                `INSERT INTO grupo_projeto_eventos (projeto_id, tipo, titulo, autor, url_evento, sha, detectado_em)
                 VALUES ($1, 'commit', $2, $3, $4, $5, $6)`,
                [projeto.id, titulo, autor, urlEvento, sha, detectEm]
            );
            novos++;
        }

        const ultimoSha = commits[0]?.sha || projeto.ultimo_sha;
        await pool.query(
            'UPDATE grupo_projetos SET ultimo_check = NOW(), ultimo_sha = $1 WHERE id = $2',
            [ultimoSha, projeto.id]
        );
        return novos;

    } catch (e) {
        console.warn(`[MONITOR] Erro GitHub ${projeto.github_owner}/${projeto.github_repo}:`, e.message);
        return 0;
    }
}

/* ── Sync de todos os projetos GitHub ativos ─────────────────────────────── */

export async function syncTodos() {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM grupo_projetos
             WHERE ativo = true AND tipo = 'github'
             ORDER BY ultimo_check NULLS FIRST
             LIMIT 60`
        );
        let total = 0;
        for (const p of rows) {
            const novos = await syncGitHub(p);
            if (novos > 0) {
                console.log(`[MONITOR] ${p.github_owner}/${p.github_repo}: +${novos} commit(s)`);
                total += novos;
            }
        }
        if (total > 0) console.log(`[MONITOR] Ciclo: ${total} evento(s) detectado(s)`);
    } catch (e) {
        console.warn('[MONITOR] Erro no ciclo de sync:', e.message);
    }
}

/* ── Sync manual de um projeto individual ────────────────────────────────── */

export async function syncProjetoManual(projetoId) {
    const { rows } = await pool.query('SELECT * FROM grupo_projetos WHERE id = $1', [projetoId]);
    if (!rows[0] || rows[0].tipo !== 'github') return 0;
    return syncGitHub(rows[0]);
}

/* ── Iniciar agendamento ─────────────────────────────────────────────────── */

export function iniciarMonitorProjetos() {
    /* Primeiro ciclo: 3 min após o boot (dar tempo para o PG inicializar) */
    setTimeout(() => syncTodos(), 3 * 60 * 1000);
    /* Ciclo horário */
    setInterval(() => syncTodos(), 60 * 60 * 1000);
    console.log('[MONITOR] Serviço de projetos iniciado (ciclo horário)');
}
