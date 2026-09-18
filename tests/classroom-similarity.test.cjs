const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.join(__dirname, '..', 'backend', 'src', 'services', 'classroom-similarity.service.js');
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'routes', 'classroom.routes.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'src', 'config', 'dbInit.js'), 'utf8');

test('normaliza acentos, pontuação e espaços de forma determinística', async () => {
    const { normalizeSimilarityText } = await import(servicePath);
    assert.equal(normalizeSimilarityText('  Olá,   MÚNDO! '), 'ola mundo');
});

test('remove texto-base da atividade antes da comparação', async () => {
    const { normalizeSimilarityText } = await import(servicePath);
    const base = 'Explique detalhadamente como ocorre o processo de fotossíntese nas plantas';
    assert.equal(normalizeSimilarityText(`${base}. Minha conclusão exclusiva`, base), 'minha conclusao exclusiva');
});

test('identifica arquivo idêntico mesmo com nomes diferentes', async () => {
    const { compareSubmissionPair } = await import(servicePath);
    const result = compareSubmissionPair(
        { sources: [], files: [{ name: 'trabalho-a.pdf', hash: 'abc' }] },
        { sources: [], files: [{ name: 'renomeado.pdf', hash: 'abc' }] },
    );
    assert.equal(result.signal, 'arquivo_identico');
    assert.equal(result.identicalFiles.length, 1);
});

test('separa limites de texto semelhante, cópia parcial e possível paráfrase', async () => {
    const { classifySimilarity } = await import(servicePath);
    assert.equal(classifySimilarity(90), 'texto_muito_semelhante');
    assert.equal(classifySimilarity(60), 'copia_parcial');
    assert.equal(classifySimilarity(40), 'possivel_parafrase');
    assert.equal(classifySimilarity(20), 'baixo');
});

test('versão da entrega é idempotente e muda quando a entrega muda', async () => {
    const { submissionVersion } = await import(servicePath);
    const submission = { id: 's1', updateTime: '2026-09-18T10:00:00Z', state: 'TURNED_IN' };
    assert.equal(submissionVersion(submission), submissionVersion({ ...submission }));
    assert.notEqual(submissionVersion(submission), submissionVersion({ ...submission, updateTime: '2026-09-18T11:00:00Z' }));
});

test('contrato exige escopo Drive, isolamento por professor e unicidade da execução', () => {
    assert.match(routeSource, /DRIVE_READONLY_SCOPE/);
    assert.match(routeSource, /tokenHasDriveScope\(token\)/);
    assert.match(routeSource, /WHERE id=\$1 AND professor_cpf=\$2/);
    assert.match(dbSource, /UNIQUE\(professor_cpf, curso_id, atividade_id, versao_entregas\)/);
});

test('rotas de similaridade são somente leitura no Google Classroom', () => {
    const block = routeSource.slice(
        routeSource.indexOf("router.post('/classroom/assistida/similaridade'"),
        routeSource.indexOf('/* ── Atualizar nota de uma entrega'),
    );
    assert.doesNotMatch(block, /studentSubmissions\.(patch|return)/);
    assert.doesNotMatch(block, /assignedGrade|draftGrade/);
});

test('arquivo idêntico aparece no relatório mesmo com percentual textual zero', () => {
    assert.match(
        routeSource,
        /percentual >= \$2 OR jsonb_array_length\(arquivos_identicos\) > 0/,
    );
});

test('nova versão da mesma atividade é rejeitada antes de criar uma execução órfã', () => {
    const block = routeSource.slice(
        routeSource.indexOf("router.post('/classroom/assistida/similaridade'"),
        routeSource.indexOf("router.get('/classroom/assistida/similaridade/:runId'"),
    );
    const activeCheck = block.indexOf('if (similarityJobs.has(jobKey))');
    const insertRun = block.indexOf('INSERT INTO classroom_similarity_runs');
    assert.ok(activeCheck >= 0, 'deve verificar job ativo');
    assert.ok(insertRun > activeCheck, 'deve rejeitar antes de inserir uma nova execução');
    assert.match(block, /if \(!similarityJobs\.has\(jobKey\)\)[\s\S]*Processamento interrompido/);
});