const test = require('node:test');
const assert = require('node:assert/strict');

async function carregarFiltro() {
    const modulo = await import('../backend/src/services/atas-pendentes.service.js');
    return modulo.filtrarAtasPendentes;
}

function registro(nome, matriculas, ocorrencias) {
    return {
        aluno: { nome, codmatrizaluno: matriculas[0] },
        matriculasEquivalentes: matriculas,
        combinadas: ocorrencias.map(id => ({ id })),
    };
}

function poolComHistorico(rows) {
    return {
        async query(sql, params) {
            assert.match(sql, /FROM ata_impressa/);
            assert.ok(Array.isArray(params[0]));
            return { rows };
        },
    };
}

test('mantém somente ocorrências comuns ainda não impressas', async () => {
    const filtrar = await carregarFiltro();
    const resultado = await filtrar(
        [registro('Ana', [101], [1, 2, 3])],
        poolComHistorico([{ cod_matriz_aluno: 101, ocorrencia_id: '2' }])
    );
    assert.deepEqual(resultado[0].combinadas.map(o => o.id), [1, 3]);
});

test('reconhece observações RCO por seu identificador sintético', async () => {
    const filtrar = await carregarFiltro();
    const resultado = await filtrar(
        [registro('Bia', [201], ['rco_77', 'rco_78'])],
        poolComHistorico([{ cod_matriz_aluno: 201, ocorrencia_id: 'rco_77' }])
    );
    assert.deepEqual(resultado[0].combinadas.map(o => o.id), ['rco_78']);
});

test('considera histórico de matrículas equivalentes reunidas pelo nome', async () => {
    const filtrar = await carregarFiltro();
    const resultado = await filtrar(
        [registro('Caio', [301, 302], [10, 11])],
        poolComHistorico([{ cod_matriz_aluno: 302, ocorrencia_id: '10' }])
    );
    assert.deepEqual(resultado[0].combinadas.map(o => o.id), [11]);
});

test('preserva alunos pendentes quando outros já estão totalmente impressos', async () => {
    const filtrar = await carregarFiltro();
    const resultado = await filtrar(
        [
            registro('Davi', [401], [20]),
            registro('Eva', [501], [30, 31]),
        ],
        poolComHistorico([
            { cod_matriz_aluno: 401, ocorrencia_id: '20' },
            { cod_matriz_aluno: 501, ocorrencia_id: '30' },
        ])
    );
    assert.deepEqual(resultado[0].combinadas, []);
    assert.deepEqual(resultado[1].combinadas.map(o => o.id), [31]);
});

test('não remove páginas quando não existe histórico', async () => {
    const filtrar = await carregarFiltro();
    const entrada = [registro('Fê', [601], [40, 'rco_90'])];
    const resultado = await filtrar(entrada, poolComHistorico([]));
    assert.deepEqual(resultado[0].combinadas.map(o => o.id), [40, 'rco_90']);
});