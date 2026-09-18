const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const frontendSource = fs.readFileSync(
  path.join(__dirname, '../frontend/pages/frequencias/frequencias.js'),
  'utf8',
);

function elemento(overrides = {}) {
  return {
    style: { display: 'none' },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    insertBefore() {},
    replaceChildren(...children) { this.children = children; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
    remove() {},
    options: [],
    value: '',
    innerHTML: '',
    textContent: '',
    disabled: false,
    isConnected: true,
    ...overrides,
  };
}

function criarHarness({ agora = '2026-05-15T12:00:00', fetchImpl } = {}) {
  const elementos = new Map();
  const document = {
    getElementById(id) {
      if (!elementos.has(id)) elementos.set(id, elemento());
      return elementos.get(id);
    },
    createElement() { return elemento(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: elemento(),
  };
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [agora]));
    }
    static now() { return new RealDate(agora).getTime(); }
  }
  const context = {
    console,
    URLSearchParams,
    Date: FixedDate,
    document,
    localStorage: { getItem() { return null; } },
    window: { location: {}, open() { return null; } },
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    setTimeout() { return 0; },
    clearTimeout() {},
    MutationObserver: class { observe() {} },
  };
  context.window.document = document;
  vm.createContext(context);
  const sourceSemBootstrap = frontendSource
    .replace(/\ninit\(\);\s*\ninitSyncStatus\(\);/, '\n')
    .replace(/\n\/\* Apply custom selects[\s\S]*$/, '\n');
  vm.runInContext(`${sourceSemBootstrap}
    globalThis.__freq = {
      parseDataRco, extrairPeriodos, configurarPeriodos, periodoDaDisciplina,
      coletarTurmas, carregarFrequencias, carregarTodasDisciplinas,
      sincronizarFrequencias,
      get periodoAtivo() { return periodoAtivo; },
      get periodos() { return periodosDisponiveis; },
      get cache() { return disciplinaCache; },
      setAcessos(v) { acessosCache = v; },
      selecionar(chave) {
        periodoAtivo = periodosDisponiveis.find(p => p.chave === chave);
        periodoSelecionadoManualmente = true;
      },
      setGeracao(v) { geracaoConsultas = v; },
      incrementarGeracao() { geracaoConsultas++; },
    };`, context);
  return { api: context.__freq, document, elementos };
}

function acessosFixture() {
  const calendario = (codigo, nome, inicio, fim) => ({
    periodoAvaliacao: { codPeriodoAvaliacao: codigo, descrPeriodoAvaliacao: nome },
    dataInicio: inicio,
    dataFim: fim,
  });
  const livro = (codClasse, disciplina, calendarios) => ({
    classe: {
      codClasse,
      disciplina: { nomeDisciplina: disciplina },
      turma: { codTurma: 10, descrTurma: '1ª Série A' },
    },
    calendarioAvaliacaos: calendarios,
  });
  return [{
    periodoLetivos: [
      {
        codPeriodoLetivo: 2025,
        livros: [livro(15, 'História 2025', [
          calendario(1, '1º trimestre', '2025-02-03', '2025-05-09'),
        ])],
      },
      {
        codPeriodoLetivo: 2026,
        livros: [
          livro(16, 'Matemática', [
            calendario(1, '1º trimestre', '2026-02-02', '2026-05-08'),
            calendario(2, '2º trimestre', '2026-05-11', '2026-08-28'),
          ]),
          livro(17, 'Arte', [
            calendario(1, '1º trimestre', '2026-02-02', '2026-05-08'),
          ]),
        ],
      },
    ],
  }];
}

test('seleciona automaticamente o trimestre pelas datas oficiais', () => {
  const { api } = criarHarness();
  api.configurarPeriodos(acessosFixture());
  assert.equal(api.periodoAtivo.chave, '2026:2');
  assert.equal(api.periodoAtivo.nome, '2º trimestre');
});

test('não colide códigos iguais de períodos letivos diferentes', () => {
  const { api } = criarHarness();
  const periodos = api.extrairPeriodos(acessosFixture());
  assert.deepEqual(
    Array.from(periodos, p => p.chave),
    ['2025:1', '2026:1', '2026:2'],
  );
});

test('omite disciplina sem calendário no trimestre selecionado', () => {
  const { api } = criarHarness();
  const acessos = acessosFixture();
  api.configurarPeriodos(acessos);
  const disciplinas = api.coletarTurmas(acessos).flatMap(t => t.disciplinas);
  assert.deepEqual(Array.from(disciplinas, d => d.nome), ['Matemática']);
});

test('sincronização preserva uma seleção manual que continua válida', async () => {
  const acessos = acessosFixture();
  const fetchImpl = async url => ({
    ok: true,
    status: 200,
    json: async () => url.endsWith('/api/acessos') ? acessos : {},
  });
  const { api, document } = criarHarness({ fetchImpl });
  api.configurarPeriodos(acessos);
  api.selecionar('2026:1');
  document.getElementById('btnSyncRco').disabled = false;
  await api.sincronizarFrequencias();
  assert.equal(api.periodoAtivo.chave, '2026:1');
});

test('troca rápida de trimestre descarta resposta antiga', async () => {
  let liberar;
  const resposta = new Promise(resolve => { liberar = resolve; });
  const { api } = criarHarness({ fetchImpl: () => resposta });
  const acessos = acessosFixture();
  api.configurarPeriodos(acessos);
  api.setAcessos(acessos);
  const carregamento = api.carregarTodasDisciplinas();
  api.incrementarGeracao();
  liberar({ ok: true, json: async () => ({ alunos: [{ nome: 'Resposta antiga' }] }) });
  await carregamento;
  assert.equal(Object.keys(api.cache).length, 0);
});

test('visão normal, visão geral e drawer consultam o mesmo período selecionado', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ codAulas: [], alunos: [] }) };
  };
  const { api } = criarHarness({ fetchImpl });
  const acessos = acessosFixture();
  api.configurarPeriodos(acessos);
  api.setAcessos(acessos);
  const panel = elemento({
    dataset: {
      codperiodoavaliacao: '2',
      codperiodoletivo: '2026',
      nome: 'Matemática',
      codturma: '10',
    },
  });
  await api.carregarFrequencias(panel, '16', 0, 0);
  delete api.cache['16'];
  await api.carregarTodasDisciplinas();
  assert.equal(urls.length, 2);
  for (const url of urls) {
    const query = new URL(url, 'https://edusync.test').searchParams;
    assert.equal(query.get('codPeriodoAvaliacao'), '2');
    assert.equal(query.get('codPeriodoLetivo'), '2026');
  }
  assert.equal(api.periodoAtivo.chave, '2026:2');
});

test('backend encaminha os dois identificadores do período ao RCO', async () => {
  const chamadas = [];
  const rcoApiService = {
    async get(url) {
      chamadas.push(url);
      return { status: 200, data: [] };
    },
  };
  const modulo = await import(
    `${pathToFileURL(path.join(__dirname, '../backend/src/routes/rco.routes.js')).href}?test=${Date.now()}`
  );
  const router = modulo.createRcoRouter({
    rcoApiService,
    supabaseAdmin: { from() { throw new Error('não deveria acessar o banco'); } },
  });
  const layer = router.stack.find(item => item.route?.path === '/frequencias');
  const handler = layer.route.stack.at(-1).handle;
  let payload;
  await handler(
    { query: { codClasse: '77', codPeriodoAvaliacao: '1', codPeriodoLetivo: '2025' } },
    {
      status() { return this; },
      json(value) { payload = value; return this; },
    },
  );
  assert.match(chamadas[0], /codClasse=77/);
  assert.match(chamadas[0], /codPeriodoAvaliacao=1/);
  assert.match(chamadas[0], /codPeriodoLetivo=2025/);
  assert.deepEqual(payload, { codAulas: [], aulaDatas: {}, alunos: [] });
});