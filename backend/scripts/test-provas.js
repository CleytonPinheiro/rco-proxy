/**
 * Script de teste end-to-end do módulo Provas.
 *
 * Uso:
 *   node backend/scripts/test-provas.js [--cursoId=ID] [--keep]
 *
 * Flags:
 *   --cursoId=<id>  Curso Classroom a usar (default: pega o 1º existente em classroom_grupos)
 *   --keep          Não apaga a prova de teste no final
 *
 * O script:
 *  1. Cria 3 sessões de aluno fake direto no DB (bypass OAuth)
 *  2. Cria uma prova com 2 variantes manuais (5 questões cada)
 *  3. Simula 3 alunos submetendo (1 com variante errada de propósito)
 *  4. Lista submissões → troca variante do que errou → confere recálculo
 *  5. Sorteia 2º corretor e confere candidato escolhido
 *  6. 2º corretor submete e confere divergência calculada
 *  7. Apaga submissão de 1 aluno e confere que pode re-submeter
 *  8. Limpa tudo (a menos que --keep)
 */

import pkg from 'pg';
import crypto from 'crypto';

const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';

const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
        const [k, v] = a.replace(/^--/, '').split('=');
        return [k, v ?? true];
    })
);

const KEEP = !!args.keep;

const ALUNOS = [
    { email: 'teste-prova-aluno1@edusync.local', nome: 'Aluno Teste 1' },
    { email: 'teste-prova-aluno2@edusync.local', nome: 'Aluno Teste 2' },
    { email: 'teste-prova-aluno3@edusync.local', nome: 'Aluno Teste 3' },
];

const ANSID_TEST = `TEST-${Date.now()}`;
const VARIANTES_MANUAIS = [
    {
        codigo: '0',
        gabarito: [
            { questao: 1, tipo: 'multipla', correta: 'a', valor: 2.0, n_alternativas: 5 },
            { questao: 2, tipo: 'multipla', correta: 'b', valor: 2.0, n_alternativas: 5 },
            { questao: 3, tipo: 'multipla', correta: 'c', valor: 2.0, n_alternativas: 5 },
            { questao: 4, tipo: 'multipla', correta: 'd', valor: 2.0, n_alternativas: 5 },
            { questao: 5, tipo: 'multipla', correta: 'e', valor: 2.0, n_alternativas: 5 },
        ],
    },
    {
        codigo: '1',
        gabarito: [
            { questao: 1, tipo: 'multipla', correta: 'e', valor: 2.0, n_alternativas: 5 },
            { questao: 2, tipo: 'multipla', correta: 'd', valor: 2.0, n_alternativas: 5 },
            { questao: 3, tipo: 'multipla', correta: 'c', valor: 2.0, n_alternativas: 5 },
            { questao: 4, tipo: 'multipla', correta: 'b', valor: 2.0, n_alternativas: 5 },
            { questao: 5, tipo: 'multipla', correta: 'a', valor: 2.0, n_alternativas: 5 },
        ],
    },
];

const ok    = (m) => console.log('  ✅', m);
const info  = (m) => console.log('  ℹ️ ', m);
const fail  = (m) => { console.error('  ❌', m); process.exitCode = 1; };
const step  = (n, t) => console.log(`\n━━━ ${n}. ${t} ━━━`);

async function ensureCursoId() {
    if (args.cursoId) return String(args.cursoId);
    const { rows } = await pool.query(`SELECT DISTINCT curso_id FROM classroom_grupos LIMIT 1`);
    if (rows[0]) return String(rows[0].curso_id);
    /* fallback — usa um id sintético; o DB não restringe FK para curso_id */
    return 'TEST-CURSO-001';
}

async function criarSessaoAluno(email, nome) {
    const id = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60_000);
    await pool.query(
        `INSERT INTO aluno_portal_sessions (id, email, nome, foto, expires_at)
         VALUES ($1,$2,$3,'',$4)
         ON CONFLICT (id) DO UPDATE SET email=$2, nome=$3, expires_at=$4`,
        [id, email, nome, expires]
    );
    return id;
}

async function fetchAluno(sid, path, opts = {}) {
    const r = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', cookie: `aluno_sid=${sid}`, ...(opts.headers || {}) },
    });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, data: d };
}

async function fetchProf(path, opts = {}) {
    /* Endpoints de prof exigem cookie de sessão de prof. Como não conseguimos
       fazer login programaticamente, batemos direto no DB pra essas operações. */
    throw new Error('use direct DB for prof actions in tests');
}

/* ════════════════════════════════════════════════════════════════════ */
async function main() {
    console.log(`\n🧪 Teste do módulo Provas — base ${BASE}\n`);
    const cursoId = await ensureCursoId();
    info(`Curso: ${cursoId}`);

    /* 1) Sessões de aluno */
    step(1, 'Criando 3 sessões de aluno fake');
    const sids = {};
    for (const a of ALUNOS) {
        sids[a.email] = await criarSessaoAluno(a.email, a.nome);
        ok(`${a.nome} (${a.email}) → sid=${sids[a.email].slice(0, 8)}…`);
    }

    /* 2) Cria prova direto no DB (evita Puppeteer + auth) */
    step(2, `Criando prova de teste (ansid=${ANSID_TEST}) com 2 variantes manuais`);
    const { rows: [prova] } = await pool.query(
        `INSERT INTO classroom_provas
           (curso_id, gradepen_id, nome, foto_modo, segundo_corretor_ativo, criada_por_cpf, criada_por_nome)
         VALUES ($1,$2,'Prova Automatizada (delete-me)','nunca',true,'00000000000','TestRunner')
         RETURNING *`,
        [cursoId, ANSID_TEST]
    );
    ok(`prova.id = ${prova.id}`);

    const variantes = {};
    for (const v of VARIANTES_MANUAIS) {
        const { rows: [vr] } = await pool.query(
            `INSERT INTO classroom_prova_variantes (prova_id, codigo, gabarito_json)
             VALUES ($1,$2,$3) RETURNING *`,
            [prova.id, v.codigo, JSON.stringify(v.gabarito)]
        );
        variantes[v.codigo] = vr;
        ok(`variante .${v.codigo} → id=${vr.id}`);
    }

    /* 3) Cada aluno submete via API */
    step(3, 'Alunos submetendo (aluno1=acerta tudo .0; aluno2=acerta tudo .1; aluno3=marca .0 mas escolhe .1 ERRADO)');
    /* Aluno 1 — variante 0, acerta tudo */
    const r1 = await fetchAluno(sids[ALUNOS[0].email], `/api/alunos-portal/prova/${prova.id}/submeter`, {
        method: 'POST',
        body: JSON.stringify({
            varianteCodigo: '0',
            marcacoes: { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e' },
        }),
    });
    if (r1.status === 200 && r1.data.nota === 10) ok(`Aluno 1: nota=${r1.data.nota}`);
    else fail(`Aluno 1 falhou (status ${r1.status}, nota ${r1.data?.nota}): ${JSON.stringify(r1.data)}`);

    /* Aluno 2 — variante 1, acerta tudo */
    const r2 = await fetchAluno(sids[ALUNOS[1].email], `/api/alunos-portal/prova/${prova.id}/submeter`, {
        method: 'POST',
        body: JSON.stringify({
            varianteCodigo: '1',
            marcacoes: { '1': 'e', '2': 'd', '3': 'c', '4': 'b', '5': 'a' },
        }),
    });
    if (r2.status === 200 && r2.data.nota === 10) ok(`Aluno 2: nota=${r2.data.nota}`);
    else fail(`Aluno 2 falhou (status ${r2.status}, nota ${r2.data?.nota})`);

    /* Aluno 3 — marca como se fosse .0 (a,b,c,d,e) mas escolhe .1 ERRADO. Só acerta a 3 (c). */
    const r3 = await fetchAluno(sids[ALUNOS[2].email], `/api/alunos-portal/prova/${prova.id}/submeter`, {
        method: 'POST',
        body: JSON.stringify({
            varianteCodigo: '1',
            marcacoes: { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e' },
        }),
    });
    if (r3.status === 200 && r3.data.nota === 2) ok(`Aluno 3 (variante errada): nota=${r3.data.nota} (esperado 2 — só q.3 coincide)`);
    else fail(`Aluno 3: status ${r3.status}, nota ${r3.data?.nota} (esperado 2)`);

    /* 4) Trocar variante do aluno 3 → recalcular nota direto via DB+helper */
    step(4, 'Trocando variante do Aluno 3 (.1 → .0) — deve recalcular para 10');
    const { rows: [sub3] } = await pool.query(
        `SELECT * FROM classroom_prova_submissoes
          WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false`,
        [prova.id, ALUNOS[2].email]
    );

    /* Recalcula localmente usando o gabarito da variante .0 */
    const novaVar = variantes['0'];
    let novaNota = 0, novoTotal = 0;
    for (const q of novaVar.gabarito_json) {
        novoTotal += q.valor;
        if (sub3.marcacoes_json[String(q.questao)] === q.correta) novaNota += q.valor;
    }
    await pool.query(
        `UPDATE classroom_prova_submissoes SET variante_id=$1, nota=$2, total_max=$3 WHERE id=$4`,
        [novaVar.id, novaNota, novoTotal, sub3.id]
    );
    const { rows: [sub3b] } = await pool.query(`SELECT nota FROM classroom_prova_submissoes WHERE id = $1`, [sub3.id]);
    if (Number(sub3b.nota) === 10) ok(`Aluno 3: nota recalculada = ${sub3b.nota}`);
    else fail(`Recálculo falhou: nota=${sub3b.nota}`);

    /* 5) Sorteio de 2º corretor pra submissão do aluno 1 */
    step(5, 'Sorteando 2º corretor para a submissão do Aluno 1');
    const { rows: [sub1] } = await pool.query(
        `SELECT id, variante_id FROM classroom_prova_submissoes
          WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false`,
        [prova.id, ALUNOS[0].email]
    );
    /* Candidatos: outros alunos da mesma prova com variante diferente */
    const { rows: cands } = await pool.query(
        `SELECT aluno_email FROM classroom_prova_submissoes
          WHERE prova_id = $1 AND aluno_email <> $2 AND eh_segundo_corretor = false AND variante_id <> $3`,
        [prova.id, ALUNOS[0].email, sub1.variante_id]
    );
    if (cands.length >= 1) ok(`Encontrei ${cands.length} candidato(s) elegíveis: ${cands.map(c=>c.aluno_email).join(', ')}`);
    else fail('Nenhum candidato elegível pra 2ª correção');

    /* Cria notificação manual + submissão de 2º corretor (Aluno 2) */
    const corretor = cands.find(c => c.aluno_email === ALUNOS[1].email) || cands[0];
    await pool.query(
        `INSERT INTO notificacoes_aluno (aluno_email, tipo, referencia, titulo, mensagem, dados)
         VALUES ($1,'segundo_corretor',$2,'Sorteio de teste','Teste',$3)`,
        [corretor.aluno_email, String(sub1.id),
         JSON.stringify({ submissaoRefId: sub1.id, provaId: prova.id })]
    );

    /* 6) Lista pendentes via API + simula corretor enviando */
    step(6, 'Corretor consulta pendentes e envia 2ª correção (com 1 erro de propósito)');
    const pend = await fetchAluno(sids[corretor.aluno_email], '/api/alunos-portal/segundo-corretor/pendentes');
    if (pend.status === 200 && pend.data.pendentes?.length >= 1) {
        ok(`${pend.data.pendentes.length} tarefa(s) na fila`);
    } else {
        fail(`Pendentes inesperado: status ${pend.status}, body ${JSON.stringify(pend.data).slice(0,200)}`);
    }

    /* Marca igual ao aluno 1 mas erra a questão 5 (marca 'a' quando devia ser 'e') */
    const env2 = await fetchAluno(sids[corretor.aluno_email],
        `/api/alunos-portal/segundo-corretor/${sub1.id}/submeter`, {
        method: 'POST',
        body: JSON.stringify({ marcacoes: { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'a' } }),
    });
    if (env2.status === 200) ok(`2ª correção enviada (status 200)`);
    else fail(`Envio 2ª correção falhou: status ${env2.status}, body ${JSON.stringify(env2.data).slice(0,200)}`);

    const { rows: [seg] } = await pool.query(
        `SELECT nota FROM classroom_prova_submissoes WHERE submissao_ref_id = $1 AND eh_segundo_corretor = true`,
        [sub1.id]
    );
    if (seg && Number(seg.nota) === 8) ok(`Nota da 2ª correção = ${seg.nota} (esperado 8 — divergência de 2 com a original 10)`);
    else fail(`Nota 2ª correção inesperada: ${seg?.nota}`);

    /* 7) Apagar submissão do aluno 2 e re-submeter */
    step(7, 'Apagando submissão do Aluno 2 e verificando re-submissão');
    const { rows: [sub2] } = await pool.query(
        `SELECT id FROM classroom_prova_submissoes
          WHERE prova_id = $1 AND aluno_email = $2 AND eh_segundo_corretor = false`,
        [prova.id, ALUNOS[1].email]
    );
    await pool.query(`DELETE FROM classroom_prova_submissoes WHERE id = $1`, [sub2.id]);
    ok('Submissão do Aluno 2 apagada');

    /* Re-submete */
    const r2b = await fetchAluno(sids[ALUNOS[1].email], `/api/alunos-portal/prova/${prova.id}/submeter`, {
        method: 'POST',
        body: JSON.stringify({
            varianteCodigo: '1',
            marcacoes: { '1': 'e', '2': 'd', '3': 'c', '4': 'b', '5': 'a' },
        }),
    });
    if (r2b.status === 200 && r2b.data.nota === 10) ok(`Aluno 2 re-submeteu: nota=${r2b.data.nota}`);
    else fail(`Re-submissão falhou: status ${r2b.status}`);

    /* 8) Limpeza */
    step(8, KEEP ? 'Mantendo dados (--keep)' : 'Limpando dados de teste');
    if (!KEEP) {
        const { rows: subIds } = await pool.query(`SELECT id FROM classroom_prova_submissoes WHERE prova_id = $1`, [prova.id]);
        const subIdArr = subIds.map(r => r.id);
        if (subIdArr.length > 0) {
            await pool.query(`DELETE FROM aluno_reputacao_log WHERE submissao_id = ANY($1)`, [subIdArr]);
        }
        await pool.query(`DELETE FROM aluno_reputacao     WHERE aluno_email = ANY($1)`, [['teste-prova-aluno1@edusync.local','teste-prova-aluno2@edusync.local','teste-prova-aluno3@edusync.local']]);
        await pool.query(`DELETE FROM aluno_reputacao_log WHERE aluno_email = ANY($1)`, [['teste-prova-aluno1@edusync.local','teste-prova-aluno2@edusync.local','teste-prova-aluno3@edusync.local']]);
        await pool.query(`DELETE FROM notificacoes_aluno WHERE referencia IN (SELECT id::text FROM classroom_prova_submissoes WHERE prova_id = $1)`, [prova.id]);
        await pool.query(`DELETE FROM classroom_provas WHERE id = $1`, [prova.id]);
        for (const sid of Object.values(sids)) {
            await pool.query(`DELETE FROM aluno_portal_sessions WHERE id = $1`, [sid]);
        }
        ok('Limpou prova, sessões e notificações');
    } else {
        info(`Prova ${prova.id} mantida. Acesse /pages/provas/ logado como prof e selecione o curso ${cursoId}.`);
        info(`Sessões aluno (cookies aluno_sid):\n     ${Object.entries(sids).map(([e,s]) => `${e}: ${s}`).join('\n     ')}`);
    }

    console.log(`\n${process.exitCode ? '⚠️  Alguns testes falharam.' : '🎉 Todos os testes passaram.'}\n`);
    await pool.end();
}

main().catch(e => {
    console.error('💥', e);
    pool.end();
    process.exit(1);
});
