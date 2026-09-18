const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const backend = fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'src', 'routes', 'classroom.routes.js'),
  'utf8',
);
const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'pages', 'classroom', 'classroom.js'),
  'utf8',
);

test('o resumo expõe totais brutos oficial, interno e previsto', () => {
  assert.match(backend, /totalGanho:\s+a\.totalGanho/);
  assert.match(backend, /totalGanhoInterno:\s+ganhoInterno/);
  assert.match(backend, /totalGanhoPrevisto:\s+ganhoPrevisto/);
});

test('a tela prioriza totais normalizados pelo backend', () => {
  assert.match(frontend, /soma:\s*a\.totalNaMeta\s*\?\?/);
  assert.match(frontend, /somaInterna:\s*a\.totalInternoNaMeta\s*\?\?/);
  assert.match(frontend, /somaPrevista:\s*a\.totalPrevistoNaMeta\s*\?\?/);
  assert.equal((frontend.match(/mapearAlunoResumo\(a, meta, recMap\)/g) || []).length, 2);
});

test('paginação deduplica submissões por aluno antes da soma', () => {
  assert.match(backend, /const subsPorAluno = new Map\(\)/);
  assert.match(backend, /indexSubmissionsByUser\(resp\.data\.studentSubmissions, subsPorAluno\)/);
  assert.match(backend, /submissions: Array\.from\(subsPorAluno\.values\(\)\)/);
});

test('falhas parciais são propagadas e exibidas na lista', () => {
  assert.match(backend, /resumoCompleto: errosResumo\.length === 0/);
  assert.match(backend, /errosResumo,/);
  assert.match(frontend, /Resumo incompleto/);
  assert.match(frontend, /resumoCompleto: resumo\.resumoCompleto !== false/);
});

test('rascunho de fonte externa não entra no total oficial', () => {
  assert.match(backend, /const grade = s\.assignedGrade \?\? null/);
  assert.match(backend, /const draftGrade = s\.draftGrade \?\? null/);
  assert.match(backend, /fonteDraftScores/);
});

test('calcula múltiplas atividades e alunos preservando zero, rascunho e limite', async () => {
  const service = await import(pathToFileURL(path.join(
    __dirname, '..', 'backend', 'src', 'services', 'classroom-summary.service.js',
  )));
  const scenarios = {
    aluno1: [
      { assignedGrade: 0, draftGrade: null, maxPoints: 10 },
      { assignedGrade: 7, draftGrade: null, maxPoints: 10 },
      { assignedGrade: null, draftGrade: 5, maxPoints: 10 },
      { assignedGrade: 20, draftGrade: null, maxPoints: 10 },
    ],
    aluno2: [
      { assignedGrade: 4, draftGrade: null, maxPoints: 10 },
      { assignedGrade: null, draftGrade: null, maxPoints: 10 },
      { assignedGrade: 9, draftGrade: null, maxPoints: null },
    ],
  };
  const totals = Object.fromEntries(Object.entries(scenarios).map(([uid, entries]) => {
    const value = entries
      .map(service.calculateSubmissionContribution)
      .reduce((sum, item) => ({
        official: sum.official + item.official,
        predicted: sum.predicted + item.predicted,
        pending: sum.pending + item.pending,
      }), { official: 0, predicted: 0, pending: 0 });
    return [uid, value];
  }));

  assert.deepEqual(totals.aluno1, { official: 17, predicted: 22, pending: 1 });
  assert.deepEqual(totals.aluno2, { official: 4, predicted: 4, pending: 1 });
});

test('deduplica aluno entre páginas e respeita exclusões de recuperação e atraso', async () => {
  const service = await import(pathToFileURL(path.join(
    __dirname, '..', 'backend', 'src', 'services', 'classroom-summary.service.js',
  )));
  const index = service.indexSubmissionsByUser([
    { userId: 'a', assignedGrade: 3 },
    { userId: 'b', assignedGrade: 4 },
  ]);
  service.indexSubmissionsByUser([
    { userId: 'a', assignedGrade: 5 },
  ], index);
  assert.deepEqual([...index.values()].map(s => s.assignedGrade), [5, 4]);
  assert.deepEqual(service.calculateSubmissionContribution({
    assignedGrade: 8, draftGrade: null, maxPoints: 10, excludedAsLate: true,
  }), { official: 0, predicted: 0, pending: 0 });
  assert.deepEqual(service.calculateSubmissionContribution({
    assignedGrade: 8, draftGrade: 6, maxPoints: 10, excludedByRecovery: true,
  }), { official: 0, predicted: 6, pending: 0 });
});

test('normaliza para a meta quando o total possível é menor ou maior', async () => {
  const service = await import(pathToFileURL(path.join(
    __dirname, '..', 'backend', 'src', 'services', 'classroom-summary.service.js',
  )));
  assert.equal(service.normalizePointsToTarget(20, 20, 40), 40);
  assert.equal(service.normalizePointsToTarget(40, 100, 40), 16);
  assert.equal(service.normalizePointsToTarget(0, 20, 40), 0);
  assert.equal(service.normalizePointsToTarget(10, 0, 40), 0);
});