/* ════════════════════════════════════════════════════════════════════
 *  Reputação / Gamificação
 *  Dois trilhos independentes:
 *    - "aluno"     → 1º corretor (o aluno corrigindo a própria prova)
 *    - "corretor"  → 2º corretor (corrigindo prova de colega)
 *
 *  Idempotência: cada (trilho,evento,submissao_id,aluno_email) só credita
 *  uma vez (UNIQUE constraint na tabela de log).
 * ════════════════════════════════════════════════════════════════════ */

export const RANKS = {
    aluno: [
        { min: 0,   nome: 'Novato sem Auréola',    emoji: '🌱' },
        { min: 15,  nome: 'Farmando XP',            emoji: '📖' },
        { min: 50,  nome: 'Auréola em Construção',  emoji: '🎯' },
        { min: 120, nome: 'Aura Ativada',           emoji: '🏅' },
        { min: 250, nome: 'Lenda das Provas',       emoji: '🌟' },
    ],
    corretor: [
        { min: 0,   nome: 'Corretor Iniciante',     emoji: '🥉' },
        { min: 20,  nome: 'Olho Treinado',          emoji: '🥈' },
        { min: 60,  nome: 'Veterano da Régua',      emoji: '🥇' },
        { min: 150, nome: 'Mestre da Auréola',      emoji: '💎' },
        { min: 300, nome: 'Lenda da Correção 🔱',   emoji: '👑' },
    ],
};

export function getRank(trilho, xp) {
    const ranks = RANKS[trilho] || [];
    let atual = ranks[0];
    let proximo = null;
    for (let i = 0; i < ranks.length; i++) {
        if (xp >= ranks[i].min) {
            atual = ranks[i];
            proximo = ranks[i+1] || null;
        }
    }
    return { atual, proximo, faltaProx: proximo ? Math.max(0, proximo.min - xp) : 0 };
}

/* Catálogo de eventos → XP base + se é "ação válida" (entra no streak) */
export const EVENTOS = {
    /* aluno (1º corretor) */
    SUBMISSAO_RAPIDA:    { trilho: 'aluno',    xp: +5,  streak: true,  rotulo: '⚡ Speedrunner — enviou em menos de 24h' },
    SUBMISSAO_NO_PRAZO:  { trilho: 'aluno',    xp: +2,  streak: true,  rotulo: '✅ Entregou antes do prazo' },
    VARIANTE_CORRETA:    { trilho: 'aluno',    xp: +3,  streak: false, rotulo: '🎯 Variante certinha — farmou auréola' },
    FOTO_OK:             { trilho: 'aluno',    xp: +8,  streak: true,  rotulo: '🛡️ Foto aprovada — integridade total' },
    FOTO_DIVERGENTE:     { trilho: 'aluno',    xp: -10, streak: false, rotulo: '📸 Foto suspeita — aura drenada' },

    /* corretor (2º corretor) */
    CORRECAO_ENVIADA:    { trilho: 'corretor', xp: +1,  streak: false, rotulo: '🚀 Correção lançada — auréola farmada' },
    CORRECAO_PERFEITA:   { trilho: 'corretor', xp: +10, streak: true,  rotulo: '🦅 Olho de Águia — diferença de 0 a 0.3', perfeita: true },
    CORRECAO_PRECISA:    { trilho: 'corretor', xp: +6,  streak: true,  rotulo: '🎯 Olho afiado — diferença ≤0.7' },
    CORRECAO_OK:         { trilho: 'corretor', xp: +3,  streak: true,  rotulo: '👍 Correção sólida — diferença ≤1.5' },
    CORRECAO_LONGE:      { trilho: 'corretor', xp: +1,  streak: false, rotulo: '🤔 Um pouco distante — diferença ≤3.0' },
    CORRECAO_DESVIANTE:  { trilho: 'corretor', xp: 0,   streak: false, rotulo: '💀 Chutou no escuro — aura drenada' },
    CORRECAO_VOLUNTARIA: { trilho: 'corretor', xp: +2,  streak: false, rotulo: '🤝 Bônus voluntário — espírito de equipe' },
};

/* Badges: id → { nome, emoji, descricao, trilho, condicao(rep) → bool } */
export const BADGES = [
    { id: 'PRIMEIRA_CORRECAO', emoji: '🚀', nome: 'Primeira Correção', trilho: 'corretor',
      descricao: 'A lenda começa agora. Primeira correção feita!',
      condicao: r => r.acoes_total >= 1 },
    { id: 'OLHO_DE_AGUIA',     emoji: '🦅', nome: 'Olho de Águia', trilho: 'corretor',
      descricao: '3 correções perfeitas seguidas. Você não chuta — você sabe.',
      condicao: r => (r.streak_perfeitas || 0) >= 3 },
    { id: 'STREAK_7',          emoji: '🔥', nome: 'Streak 7', trilho: 'corretor',
      descricao: '7 correções válidas seguidas. A auréola está em chamas.',
      condicao: r => r.melhor_streak >= 7 },
    { id: 'DEZ_CORRECOES',     emoji: '📚', nome: 'Estudioso Disfarçado', trilho: 'corretor',
      descricao: '10 correções no total. Tá farmando auréola com estilo.',
      condicao: r => r.acoes_total >= 10 },
    { id: 'PRIMEIRA_PROVA',    emoji: '🌱', nome: 'Primeira Prova', trilho: 'aluno',
      descricao: 'A jornada começa. Primeira prova submetida!',
      condicao: r => r.acoes_total >= 1 },
    { id: 'PONTUAL',           emoji: '⏰', nome: 'Velocista de Provas', trilho: 'aluno',
      descricao: '3x entregou antes das 24h. Speedrunner confirmado.',
      condicao: r => (r.streak_rapido || 0) >= 3 },
    { id: 'HONRA_AO_MERITO',   emoji: '🛡️', nome: 'Honra ao Mérito', trilho: 'aluno',
      descricao: '5 fotos aprovadas seguidas. Integridade máxima. Auréola full.',
      condicao: r => (r.streak_foto_ok || 0) >= 5 },
];

export class ReputacaoService {
    #pool;
    constructor(pool) { this.#pool = pool; }

    async migrate() {
        await this.#pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_reputacao (
                aluno_email      TEXT NOT NULL,
                trilho           TEXT NOT NULL CHECK (trilho IN ('aluno','corretor')),
                aluno_nome       TEXT,
                xp_total         INT  NOT NULL DEFAULT 0,
                acoes_total      INT  NOT NULL DEFAULT 0,
                streak_atual     INT  NOT NULL DEFAULT 0,
                melhor_streak    INT  NOT NULL DEFAULT 0,
                streak_perfeitas INT  NOT NULL DEFAULT 0,
                streak_rapido    INT  NOT NULL DEFAULT 0,
                streak_foto_ok   INT  NOT NULL DEFAULT 0,
                badges_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
                atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (aluno_email, trilho)
            )
        `);
        await this.#pool.query(`
            CREATE TABLE IF NOT EXISTS aluno_reputacao_log (
                id            SERIAL PRIMARY KEY,
                aluno_email   TEXT NOT NULL,
                trilho        TEXT NOT NULL,
                evento        TEXT NOT NULL,
                xp_delta      INT  NOT NULL,
                submissao_id  INT,
                detalhes_json JSONB,
                criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        /* Idempotência: evento+submissao+aluno única (mas FOTO_OK e FOTO_DIVERGENTE são exclusivos
           por submissao — ambos os eventos são bloqueados por essa unique se já creditado o outro). */
        await this.#pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_repu_log_idemp
                ON aluno_reputacao_log (aluno_email, evento, submissao_id)
                WHERE submissao_id IS NOT NULL
        `);
        await this.#pool.query(`CREATE INDEX IF NOT EXISTS idx_repu_log_aluno ON aluno_reputacao_log(aluno_email, criado_em DESC)`);
        console.log('[REPUTACAO] Tabelas OK');
    }

    /* Crédita XP. Tudo em uma transação para evitar log idempotente sem o agregado correspondente. */
    async creditar({ alunoEmail, alunoNome, evento, submissaoId = null, detalhes = null }) {
        const meta = EVENTOS[evento];
        if (!meta) throw new Error(`Evento desconhecido: ${evento}`);
        const trilho = meta.trilho;
        const xp     = meta.xp;

        const client = await this.#pool.connect();
        try {
            await client.query('BEGIN');

        /* INSERT no log com ON CONFLICT DO NOTHING (idempotente por submissaoId) */
        const { rowCount } = await client.query(
            `INSERT INTO aluno_reputacao_log (aluno_email, trilho, evento, xp_delta, submissao_id, detalhes_json)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT DO NOTHING`,
            [alunoEmail, trilho, evento, xp, submissaoId, detalhes ? JSON.stringify(detalhes) : null]
        );
        if (rowCount === 0) { await client.query('ROLLBACK'); return { creditado: false }; }

        /* Atualiza agregado: xp e streaks */
        const incStreakBase = meta.streak ? 1 : 0;
        /* Streak base zera em: eventos negativos (FOTO_DIVERGENTE) OU correções não-válidas (LONGE/DESVIANTE).
           Eventos neutros como CORRECAO_ENVIADA/CORRECAO_VOLUNTARIA/VARIANTE_CORRETA não incrementam mas não quebram. */
        const resetStreakBase = (xp < 0) || (evento === 'CORRECAO_LONGE') || (evento === 'CORRECAO_DESVIANTE');
        const incPerf = meta.perfeita ? 1 : 0;
        const resetPerf = (evento.startsWith('CORRECAO_') && !meta.perfeita && evento !== 'CORRECAO_VOLUNTARIA' && evento !== 'CORRECAO_ENVIADA');
        const incRapido = (evento === 'SUBMISSAO_RAPIDA') ? 1 : 0;
        const resetRapido = (evento === 'SUBMISSAO_NO_PRAZO');
        const incFotoOk = (evento === 'FOTO_OK') ? 1 : 0;
        const resetFotoOk = (evento === 'FOTO_DIVERGENTE');

        const { rows: [rep] } = await client.query(
            `INSERT INTO aluno_reputacao
                 (aluno_email, trilho, aluno_nome, xp_total, acoes_total,
                  streak_atual, melhor_streak, streak_perfeitas, streak_rapido, streak_foto_ok)
             VALUES ($1,$2,$3, GREATEST(0,$4), 1,
                     $5, $5, $6, $7, $8)
             ON CONFLICT (aluno_email, trilho) DO UPDATE SET
                 aluno_nome    = COALESCE(EXCLUDED.aluno_nome, aluno_reputacao.aluno_nome),
                 xp_total      = GREATEST(0, aluno_reputacao.xp_total + $4),
                 acoes_total   = aluno_reputacao.acoes_total + 1,
                 streak_atual  = CASE
                     WHEN $9::bool THEN 0
                     WHEN $5 > 0  THEN aluno_reputacao.streak_atual + 1
                     ELSE aluno_reputacao.streak_atual
                 END,
                 melhor_streak = GREATEST(
                     aluno_reputacao.melhor_streak,
                     CASE WHEN $9::bool THEN 0
                          WHEN $5 > 0 THEN aluno_reputacao.streak_atual + 1
                          ELSE aluno_reputacao.streak_atual END
                 ),
                 streak_perfeitas = CASE
                     WHEN $6 > 0 THEN aluno_reputacao.streak_perfeitas + 1
                     WHEN $10::bool THEN 0
                     ELSE aluno_reputacao.streak_perfeitas
                 END,
                 streak_rapido = CASE
                     WHEN $7 > 0 THEN aluno_reputacao.streak_rapido + 1
                     WHEN $11::bool THEN 0
                     ELSE aluno_reputacao.streak_rapido
                 END,
                 streak_foto_ok = CASE
                     WHEN $8 > 0 THEN aluno_reputacao.streak_foto_ok + 1
                     WHEN $12::bool THEN 0
                     ELSE aluno_reputacao.streak_foto_ok
                 END,
                 atualizado_em = NOW()
             RETURNING *`,
            [alunoEmail, trilho, alunoNome || null, xp,
             incStreakBase, incPerf, incRapido, incFotoOk,
             resetStreakBase, resetPerf, resetRapido, resetFotoOk]
        );

        /* Checa novas badges */
        const badgesAtuais = new Set((rep.badges_json || []).map(b => b.id));
        const novas = [];
        for (const b of BADGES) {
            if (b.trilho !== trilho) continue;
            if (badgesAtuais.has(b.id)) continue;
            if (b.condicao(rep)) novas.push({ id: b.id, emoji: b.emoji, nome: b.nome, em: new Date().toISOString() });
        }
        if (novas.length > 0) {
            const novoArr = [...(rep.badges_json || []), ...novas];
            await client.query(
                `UPDATE aluno_reputacao SET badges_json = $1 WHERE aluno_email = $2 AND trilho = $3`,
                [JSON.stringify(novoArr), alunoEmail, trilho]
            );
        }

            await client.query('COMMIT');
            return { creditado: true, evento, xp, novoXp: rep.xp_total, badgesGanhas: novas };
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        } finally {
            client.release();
        }
    }

    /* Resumo público pro aluno (ambos trilhos + rank + badges + últimos eventos) */
    async getResumo(alunoEmail) {
        const { rows: trilhos } = await this.#pool.query(
            `SELECT * FROM aluno_reputacao WHERE aluno_email = $1`, [alunoEmail]
        );
        const { rows: ultimos } = await this.#pool.query(
            `SELECT evento, xp_delta, criado_em FROM aluno_reputacao_log
              WHERE aluno_email = $1 ORDER BY criado_em DESC LIMIT 10`,
            [alunoEmail]
        );
        const blank = (trilho) => ({
            trilho, xp_total: 0, acoes_total: 0, streak_atual: 0,
            melhor_streak: 0, streak_perfeitas: 0, streak_rapido: 0, streak_foto_ok: 0,
            badges_json: [],
        });
        const aluno    = trilhos.find(t => t.trilho === 'aluno')    || blank('aluno');
        const corretor = trilhos.find(t => t.trilho === 'corretor') || blank('corretor');
        const enrich = (rep) => {
            const r = getRank(rep.trilho, rep.xp_total);
            return { ...rep, rank: r.atual, proximoRank: r.proximo, faltaProximo: r.faltaProx };
        };
        return {
            aluno:    enrich(aluno),
            corretor: enrich(corretor),
            ultimos:  ultimos.map(u => ({
                evento: u.evento,
                rotulo: EVENTOS[u.evento]?.rotulo || u.evento,
                xp:     u.xp_delta,
                quando: u.criado_em,
            })),
        };
    }
}
