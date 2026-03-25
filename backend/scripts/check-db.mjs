import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();

if (!url || !key) {
    console.error('Faltam SUPABASE_URL ou chaves');
    process.exit(1);
}

const sb = createClient(url, key);

async function count(table, filter = null) {
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = q.match(filter);
    const { count: c, error } = await q;
    if (error) return `ERRO: ${error.message}`;
    return c;
}

async function sample(table, cols = '*', limit = 3) {
    const { data, error } = await sb.from(table).select(cols).limit(limit);
    if (error) return `ERRO: ${error.message}`;
    return data;
}

console.log('\n========== DIAGNÓSTICO DO BANCO SUPABASE ==========\n');

// 1. Estabelecimentos / Colégios do professor
const nEstab = await count('rco_estabelecimentos');
const estab = await sample('rco_estabelecimentos', 'codestabelecimento, descrestabelecimento', 10);
console.log(`COLÉGIOS (rco_estabelecimentos): ${nEstab} registros`);
if (Array.isArray(estab)) estab.forEach(e => console.log(`  [${e.codestabelecimento}] ${e.descrestabelecimento}`));
else console.log(' ', estab);

// 2. Turmas
const nTurmas = await count('rco_turmas');
const turmas = await sample('rco_turmas', 'codturma, descr_turma, codestabelecimento', 10);
console.log(`\nTURMAS (rco_turmas): ${nTurmas} registros`);
if (Array.isArray(turmas)) turmas.forEach(t => console.log(`  [${t.codturma}] ${t.descr_turma} — Estab ${t.codestabelecimento}`));
else console.log(' ', turmas);

// 3. Disciplinas
const nDisc = await count('rco_disciplinas');
const disc = await sample('rco_disciplinas', 'coddisciplina, descrdisciplina, codturma', 10);
console.log(`\nDISCIPLINAS (rco_disciplinas): ${nDisc} registros`);
if (Array.isArray(disc)) disc.forEach(d => console.log(`  [${d.coddisciplina}] ${d.descrdisciplina} — Turma ${d.codturma}`));
else console.log(' ', disc);

// 4. Classes (alunos por disciplina)
const nClasses = await count('rco_classes');
const classes = await sample('rco_classes', 'codmatrizaluno, nome, codturma, coddisciplina', 10);
console.log(`\nALUNOS POR DISCIPLINA (rco_classes): ${nClasses} registros`);
if (Array.isArray(classes)) classes.forEach(c => console.log(`  [${c.codmatrizaluno}] ${c.nome} — Turma ${c.codturma} / Disc ${c.coddisciplina}`));
else console.log(' ', classes);

// 5. Alunos
const nAlunos = await count('alunos');
const alunos = await sample('alunos', 'registro, nome, turma, codturma, numchamada', 5);
console.log(`\nALUNOS (alunos): ${nAlunos} registros`);
if (Array.isArray(alunos)) alunos.forEach(a => console.log(`  [${a.registro}] ${a.nome} — ${a.turma} (chamada ${a.numchamada})`));
else console.log(' ', alunos);

// 6. Frequências
const nFreq = await count('rco_observacoes');
const freq = await sample('rco_observacoes', 'codmatrizaluno, codaula, data, presenca', 5);
console.log(`\nFREQUÊNCIAS (rco_observacoes): ${nFreq} registros`);
if (Array.isArray(freq)) freq.forEach(f => console.log(`  Aluno ${f.codmatrizaluno} — Aula ${f.codaula} | ${f.data} | ${f.presenca}`));
else console.log(' ', freq);

// 7. Presença diária
const nPresenca = await count('presenca_diaria');
const presenca = await sample('presenca_diaria', 'data, total_presentes, total_alunos, status', 5);
console.log(`\nPRESENÇA DIÁRIA (presenca_diaria): ${nPresenca} registros`);
if (Array.isArray(presenca)) presenca.forEach(p => console.log(`  ${p.data} — ${p.total_presentes}/${p.total_alunos} | ${p.status}`));
else console.log(' ', presenca);

// 8. Crachás
const nCrachas = await count('crachas');
console.log(`\nCRACHÁS (crachas): ${nCrachas} registros`);

// 9. Grupos
const nGrupos = await count('grupos');
const nGrupoAlunos = await count('grupo_alunos');
console.log(`\nGRUPOS (grupos): ${nGrupos} | ALUNOS NOS GRUPOS (grupo_alunos): ${nGrupoAlunos}`);

// 10. Comportamento
const nComport = await count('comportamento');
console.log(`\nCOMPORTAMENTO (comportamento): ${nComport} registros`);

// 11. Materiais e empréstimos
const nMateriais = await count('materiais');
const nEmprestimos = await count('emprestimos');
console.log(`\nMATERIAIS (materiais): ${nMateriais} | EMPRÉSTIMOS (emprestimos): ${nEmprestimos}`);

console.log('\n========== FIM DO DIAGNÓSTICO ==========\n');
