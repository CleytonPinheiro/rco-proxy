const API_URL = window.location.origin;

let dadosGlobais = null;
let colegioSelecionado = null;

document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    document.getElementById('btnLogout').addEventListener('click', logout);
    document.getElementById('btnVoltar').addEventListener('click', () => {
        window.location.href = '/';
    });
});

// ── Carregar dados da API ─────────────────────────────────────────────────────
async function carregarDados() {
    const loading    = document.getElementById('loading');
    const content    = document.getElementById('content');
    const emptyState = document.getElementById('emptyState');

    // Inicializa dot do rodapé
    iniciarStatusFooter();

    try {
        const response = await fetch(`${API_URL}/api/acessos`);
        const data = await response.json();

        const vazio = !data || data === "" ||
            (Array.isArray(data) && data.length === 0) ||
            (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);

        if (vazio || data.erro) {
            loading.style.display = 'none';
            await preencherEmptyState();
            emptyState.style.display = 'block';
            return;
        }

        dadosGlobais = normalizarDados(data);

    } catch (e) {
        loading.style.display = 'none';
        await preencherEmptyState(`Não foi possível conectar ao servidor: ${e.message}`);
        emptyState.style.display = 'block';
        return;
    }

    loading.style.display = 'none';
    content.style.display  = 'block';

    const colegios = extrairColegios(dadosGlobais);
    colegioSelecionado = colegios[0] || null;

    configurarSeletorColegio(colegios);
    renderizarTudo();
}

// ── Preencher empty state com info do último sync ─────────────────────────────
async function preencherEmptyState(msgErro) {
    const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (msgErro) {
        document.getElementById('emptyDesc').textContent = msgErro;
    } else {
        document.getElementById('emptyDesc').innerHTML =
            `O RCO Digital não retornou turmas para <strong>${hoje}</strong>. ` +
            `Isso acontece em fins de semana, feriados ou recesso escolar.`;
    }

    try {
        const r = await fetch(`${API_URL}/api/sync/log`);
        if (r.ok) {
            const logs = await r.json();
            const ultimo = logs.find(l => l.estabelecimentos > 0) || logs[0];
            if (ultimo) {
                const dt = new Date(ultimo.executado_em);
                const dtStr = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                document.getElementById('emptySyncInfo').innerHTML = `
                    <div class="sync-info-item">
                        <span class="sync-info-label">Último sync com dados</span>
                        <span class="sync-info-value">${dtStr}</span>
                    </div>
                    <div class="sync-info-item">
                        <span class="sync-info-label">Turmas</span>
                        <span class="sync-info-value">${ultimo.turmas || 0}</span>
                    </div>
                    <div class="sync-info-item">
                        <span class="sync-info-label">Disciplinas</span>
                        <span class="sync-info-value">${ultimo.disciplinas || 0}</span>
                    </div>
                    <div class="sync-info-item">
                        <span class="sync-info-label">Status</span>
                        <span class="sync-info-value" style="color:#28a745">${ultimo.status === 'sucesso' ? '✓ OK' : '⚠ ' + ultimo.status}</span>
                    </div>
                `;
            }
        }
    } catch {}
}

// ── Forçar sincronização ──────────────────────────────────────────────────────
async function forcarSync() {
    const btn = document.getElementById('btnSyncNow');
    btn.disabled = true;
    btn.textContent = '⏳ Sincronizando...';
    try {
        const r = await fetch(`${API_URL}/api/sync`, { method: 'POST' });
        const d = await r.json();
        if (d.turmas > 0 || d.estabelecimentos > 0) {
            btn.textContent = '✓ Dados encontrados! Recarregando...';
            setTimeout(() => window.location.reload(), 1200);
        } else {
            btn.textContent = '📅 Sem dados no RCO agora';
            setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 Sincronizar agora'; }, 3000);
        }
    } catch {
        btn.textContent = '❌ Erro na sincronização';
        setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 Sincronizar agora'; }, 3000);
    }
}

// ── Status do rodapé ──────────────────────────────────────────────────────────
async function iniciarStatusFooter() {
    try {
        const r = await fetch(`${API_URL}/api/status`);
        const d = await r.json();
        const dot = document.getElementById('footerDot');
        if (!dot) return;
        if (!d.credenciaisConfiguradas) {
            dot.classList.add('offline');
        } else if (!d.tokenEmCache) {
            dot.classList.add('warning');
        }
    } catch {
        const dot = document.getElementById('footerDot');
        if (dot) dot.classList.add('offline');
    }
}

// ── Modal: Status do Serviço ──────────────────────────────────────────────────
async function abrirModalStatus() {
    document.getElementById('modalStatus').classList.add('open');
    const body = document.getElementById('statusModalBody');
    body.innerHTML = '<div class="loading" style="padding:40px 20px"><div class="spinner"></div><p>Verificando...</p></div>';

    try {
        const [statusR, syncR] = await Promise.all([
            fetch(`${API_URL}/api/status`),
            fetch(`${API_URL}/api/sync/log`)
        ]);
        const status = await statusR.json();
        const syncLog = syncR.ok ? await syncR.json() : [];

        const exp = status.tokenExpiracao ? new Date(status.tokenExpiracao) : null;
        const agora = new Date();
        const tokenOk = exp && exp > agora;
        const expStr = exp ? exp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · ' + exp.toLocaleDateString('pt-BR') : '—';
        const minutosRestantes = exp ? Math.round((exp - agora) / 60000) : 0;

        const logsHtml = syncLog.slice(0, 5).map(l => {
            const dt = new Date(l.executado_em);
            const dtStr = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const stats = l.estabelecimentos > 0
                ? `${l.turmas}T · ${l.disciplinas}D · ${l.classes}C`
                : 'sem dados';
            return `
                <div class="status-sync-row">
                    <span class="sync-dot ${l.status === 'sucesso' ? 'ok' : 'error'}"></span>
                    <span>${l.status === 'sucesso' ? 'Sucesso' : 'Erro'}</span>
                    <span class="sync-row-time">${dtStr}</span>
                    <span class="sync-row-stats">${stats}</span>
                </div>`;
        }).join('');

        body.innerHTML = `
            <div class="status-grid">
                <div class="status-card">
                    <div class="status-card-label">Credenciais</div>
                    <div class="status-card-value">
                        <span class="status-badge ${status.credenciaisConfiguradas ? 'ok' : 'error'}">
                            ${status.credenciaisConfiguradas ? '✓ Configuradas' : '✗ Ausentes'}
                        </span>
                    </div>
                </div>
                <div class="status-card">
                    <div class="status-card-label">Token RCO</div>
                    <div class="status-card-value">
                        <span class="status-badge ${tokenOk ? 'ok' : status.tokenEmCache ? 'warn' : 'error'}">
                            ${tokenOk ? '✓ Válido' : status.tokenEmCache ? '⚠ Expirando' : '✗ Sem token'}
                        </span>
                    </div>
                    <div class="status-card-sub">
                        ${exp ? `Expira: ${expStr}${tokenOk ? ` (em ${minutosRestantes} min)` : ''}` : 'Token não obtido'}
                    </div>
                </div>
            </div>

            <div class="status-card-label" style="margin-bottom:10px">Histórico de Sincronizações</div>
            <div class="status-sync-log">
                ${logsHtml || '<div style="color:var(--text-muted);font-size:13px;padding:10px 0">Nenhum registro encontrado</div>'}
            </div>

            <button class="btn-sync-now" id="btnSyncModal" onclick="forcarSyncModal()">
                🔄 Forçar sincronização agora
            </button>
        `;
    } catch (e) {
        body.innerHTML = `<div style="color:#dc3545;padding:20px;text-align:center">Erro ao verificar status: ${e.message}</div>`;
    }
}

async function forcarSyncModal() {
    const btn = document.getElementById('btnSyncModal');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '⏳ Sincronizando...';
    try {
        const r = await fetch(`${API_URL}/api/sync`, { method: 'POST' });
        const d = await r.json();
        btn.textContent = d.turmas > 0
            ? `✓ ${d.turmas} turma(s) encontradas — recarregando...`
            : '📅 Sem dados no RCO para hoje';
        if (d.turmas > 0) setTimeout(() => window.location.reload(), 1400);
        else setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 Forçar sincronização agora'; }, 3500);
    } catch {
        btn.textContent = '❌ Erro na sincronização';
        setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 Forçar sincronização agora'; }, 3000);
    }
}

function fecharModalStatus(e) {
    if (e && e.target !== document.getElementById('modalStatus')) return;
    document.getElementById('modalStatus').classList.remove('open');
}

// ── Modal: Dados do RCO ───────────────────────────────────────────────────────
let rcoDataCache = null;

async function abrirModalRco() {
    document.getElementById('modalRco').classList.add('open');
    const body = document.getElementById('rcoModalBody');
    body.innerHTML = '<div class="loading" style="padding:40px 20px"><div class="spinner"></div><p>Consultando RCO...</p></div>';
    await carregarDadosRco(body);
}

async function carregarDadosRco(body, filtro) {
    try {
        if (!rcoDataCache) {
            const r = await fetch(`${API_URL}/api/acessos`);
            rcoDataCache = await r.json();
        }

        const data = rcoDataCache;
        const vazio = !data || (Array.isArray(data) && data.length === 0);

        // Estatísticas
        let turmaCount = 0, discCount = 0, livroCount = 0;
        if (!vazio && Array.isArray(data)) {
            data.forEach(estab => {
                (estab.periodoLetivos || []).forEach(p => {
                    (p.livros || []).forEach(l => {
                        livroCount++;
                        if (l.classe?.turma) turmaCount++;
                        if (l.classe?.disciplina) discCount++;
                    });
                });
            });
        }

        const jsonStr = JSON.stringify(data, null, 2);
        const jsonFiltrado = filtro
            ? jsonStr.split('\n').filter(l => l.toLowerCase().includes(filtro.toLowerCase())).join('\n') || '(nenhum resultado)'
            : jsonStr;

        const colorido = colorirJson(jsonFiltrado);

        body.innerHTML = `
            <div class="rco-search-bar">
                <input class="rco-search-input" id="rcoSearchInput" placeholder="Filtrar por chave ou valor..." value="${filtro || ''}"
                    oninput="filtrarJsonRco(this.value)">
                <button class="rco-btn-refresh" onclick="rcoDataCache=null;carregarDadosRco(document.getElementById('rcoModalBody'))">↺ Atualizar</button>
            </div>
            <div class="rco-data-stats">
                <div class="rco-stat-chip">Resposta: <strong>${vazio ? 'vazia' : 'com dados'}</strong></div>
                ${!vazio ? `
                    <div class="rco-stat-chip">Turmas: <strong>${turmaCount}</strong></div>
                    <div class="rco-stat-chip">Disciplinas: <strong>${discCount}</strong></div>
                    <div class="rco-stat-chip">Livros: <strong>${livroCount}</strong></div>
                ` : ''}
                <div class="rco-stat-chip">Bytes: <strong>${new Blob([jsonStr]).size}</strong></div>
            </div>
            <div class="rco-json-viewer">${colorido}</div>
        `;
    } catch (e) {
        body.innerHTML = `<div style="color:#dc3545;padding:20px;text-align:center">Erro ao carregar: ${e.message}</div>`;
    }
}

function filtrarJsonRco(valor) {
    const body = document.getElementById('rcoModalBody');
    carregarDadosRco(body, valor || undefined);
}

function fecharModalRco(e) {
    if (e && e.target !== document.getElementById('modalRco')) return;
    document.getElementById('modalRco').classList.remove('open');
}

// ── Colorir JSON ──────────────────────────────────────────────────────────────
function colorirJson(str) {
    return str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"([^"]+)"(\s*:)/g, '<span class="json-key">"$1"</span>$2')
        .replace(/:\s*"([^"]*)"/g, ': <span class="json-str">"$1"</span>')
        .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
        .replace(/:\s*(true|false)/g, ': <span class="json-bool">$1</span>')
        .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>');
}

// ── Normalizar dados da API real para o formato esperado ──────────────────────
// Estrutura real do RCO:
// [ estab { nomeCompletoEstab, codEstabelecimento, periodoLetivos: [
//     { descrPeriodoLetivo, livros: [
//         { classe: { codClasse, turma: { codTurma, descrTurma, seriacao },
//                     disciplina: { codDisciplina, nomeDisciplina, corFundo } },
//           calendarioAvaliacaos: [...] }] }] } ]
function normalizarDados(raw) {
    const turmas      = [];
    const disciplinas = [];
    const livros      = [];

    const estabs = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    estabs.forEach(estab => {
        const escola = estab.nomeCompletoEstab || estab.nmEstabelecimento || '';

        (estab.periodoLetivos || []).forEach(periodo => {
            const anoLetivo = periodo.descrPeriodoLetivo || '';

            (periodo.livros || []).forEach(livro => {
                const classe = livro.classe;
                if (!classe) return;

                const turma = classe.turma || {};
                const disc  = classe.disciplina || {};

                const nmTurma = turma.descrTurma || turma.nmTurma || '';
                const nmDisc  = disc.nomeDisciplina || disc.nmDisciplina || '';

                // Turma
                if (nmTurma) {
                    turmas.push({
                        nmTurma,
                        serie:      extrairSerie(nmTurma),
                        turno:      extrairTurno(nmTurma),
                        escola,
                        anoLetivo,
                        codTurma:   turma.codTurma,
                        codClasse:  classe.codClasse,
                    });
                }

                // Disciplina
                if (nmDisc) {
                    disciplinas.push({
                        nmDisciplina: nmDisc,
                        nmTurma,
                        cargaHoraria: '',
                        status:       'Ativa',
                        escola,
                        corFundo:     disc.corFundo || '',
                        codDisciplina: disc.codDisciplina,
                        codClasse:    classe.codClasse,
                        codTurma:     turma.codTurma,
                    });
                }

                // Livros de classe (calendários/trimestres)
                const calendarios = livro.calendarioAvaliacaos || [];
                if (calendarios.length > 0) {
                    calendarios.forEach(cal => {
                        const periodoAval = cal.periodoAvaliacao || {};
                        livros.push({
                            nmLivro:      `${nmDisc} — ${periodoAval.descrPeriodoAvaliacao || anoLetivo}`,
                            nmTurma,
                            nmDisciplina: nmDisc,
                            periodo:      periodoAval.descrPeriodoAvaliacao || '',
                            statusLivro:  'Em andamento',
                            escola,
                            codCalendario: cal.codCalendarioAvaliacao,
                            dataInicio:   cal.dataInicio,
                            dataFim:      cal.dataFim,
                        });
                    });
                } else {
                    livros.push({
                        nmLivro:      nmDisc || 'Livro de Classe',
                        nmTurma,
                        nmDisciplina: nmDisc,
                        periodo:      anoLetivo,
                        statusLivro:  'Em andamento',
                        escola,
                    });
                }
            });
        });
    });

    return {
        turmas:      deduplicate(turmas,      t => t.codTurma + '|' + t.escola),
        disciplinas: deduplicate(disciplinas, d => d.codDisciplina + '|' + d.codClasse),
        livros:      deduplicate(livros,      l => (l.codCalendario || l.nmLivro) + '|' + l.nmTurma),
        alunos:      []
    };
}

function extrairSerie(descrTurma) {
    const m = descrTurma.match(/(\d+)[aªº]\s*[Ss]érie|\d+[aªº]\s*[Aa]no/);
    return m ? m[0] : '';
}

function extrairTurno(descrTurma) {
    if (/manh[ãa]/i.test(descrTurma)) return 'Manhã';
    if (/tarde/i.test(descrTurma)) return 'Tarde';
    if (/noite/i.test(descrTurma)) return 'Noite';
    if (/integral/i.test(descrTurma)) return 'Integral';
    return '';
}

function deduplicate(arr, keyFn) {
    const seen = new Set();
    return arr.filter(item => {
        const k = keyFn(item);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// ── Extrair colégios únicos ───────────────────────────────────────────────────
function extrairColegios(dados) {
    const set = new Set();
    [...(dados.turmas || []), ...(dados.disciplinas || []), ...(dados.livros || [])].forEach(item => {
        const e = item.escola || item.nmEstabelecimento || '';
        if (e) set.add(e);
    });
    return [...set];
}

// ── Montar seletor de colégio ─────────────────────────────────────────────────
function configurarSeletorColegio(colegios) {
    const seletor      = document.getElementById('seletorColegio');
    const tabs         = document.getElementById('colegioTabs');
    const ativoHeader  = document.getElementById('colegioAtivo');
    const ativoNome    = document.getElementById('colegioAtivoNome');

    if (colegios.length <= 1) {
        seletor.style.display = 'none';
        if (colegios.length === 1) {
            ativoHeader.style.display = 'block';
            ativoNome.textContent = colegios[0];
        }
        return;
    }

    seletor.style.display = 'flex';
    ativoHeader.style.display = 'none';

    tabs.innerHTML = '';
    colegios.forEach(colegio => {
        const btn = document.createElement('button');
        btn.className = 'colegio-tab' + (colegio === colegioSelecionado ? ' active' : '');
        btn.textContent = colegio;
        btn.addEventListener('click', () => selecionarColegio(colegio));
        tabs.appendChild(btn);
    });
}

function selecionarColegio(colegio) {
    colegioSelecionado = colegio;
    document.querySelectorAll('.colegio-tab').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === colegio);
    });
    renderizarTudo();
}

// ── Renderizar tudo com filtro de colégio ─────────────────────────────────────
function renderizarTudo() {
    const filtrar = arr => {
        if (!colegioSelecionado) return arr;
        return arr.filter(i => (i.escola || '') === colegioSelecionado);
    };

    const turmas      = filtrar(dadosGlobais.turmas      || []);
    const disciplinas = filtrar(dadosGlobais.disciplinas || []);
    const livros      = filtrar(dadosGlobais.livros      || []);

    renderizarTurmas(turmas);
    renderizarDisciplinas(disciplinas);
    renderizarLivros(livros);
}

// ── Cards de turmas ───────────────────────────────────────────────────────────
function renderizarTurmas(turmas) {
    const container = document.getElementById('turmas');
    const counter   = document.getElementById('totalTurmas');
    counter.textContent = turmas.length ? `${turmas.length} encontradas` : '';

    if (!turmas.length) {
        container.innerHTML = '<div class="empty-message">Nenhuma turma encontrada</div>';
        return;
    }

    container.innerHTML = '';
    turmas.forEach(turma => {
        const card = document.createElement('div');
        card.className = 'card card-turma';
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => abrirModalAlunos({
            titulo:   turma.nmTurma,
            nmTurma:  turma.nmTurma,
            codTurma: turma.codTurma,
            codClasse: turma.codClasse,
        }));

        const turnoIcon = turno => {
            if (!turno) return '';
            if (turno.toLowerCase().includes('manhã')) return '🌅';
            if (turno.toLowerCase().includes('tarde')) return '🌤';
            if (turno.toLowerCase().includes('noite')) return '🌙';
            return '📅';
        };

        card.innerHTML = `
            <div class="card-icon turma-icon">T</div>
            <div class="card-title">${turma.nmTurma}</div>
            ${turma.serie  ? `<div class="card-info"><strong>Série:</strong> ${turma.serie}</div>` : ''}
            ${turma.turno  ? `<div class="card-info">${turnoIcon(turma.turno)} ${turma.turno}</div>` : ''}
            ${turma.anoLetivo ? `<span class="card-badge">${turma.anoLetivo}</span>` : ''}
            <div class="card-action-hint">Ver alunos →</div>
        `;
        container.appendChild(card);
    });
}

// ── Cards de disciplinas ──────────────────────────────────────────────────────
function renderizarDisciplinas(disciplinas) {
    const container = document.getElementById('disciplinas');
    const counter   = document.getElementById('totalDisciplinas');
    counter.textContent = disciplinas.length ? `${disciplinas.length} encontradas` : '';

    if (!disciplinas.length) {
        container.innerHTML = '<div class="empty-message">Nenhuma disciplina encontrada</div>';
        return;
    }

    // Agrupar por disciplina (nome), preservando codClasse por turma
    const agrupadas = {};
    disciplinas.forEach(d => {
        const nome = d.nmDisciplina || 'Disciplina';
        if (!agrupadas[nome]) agrupadas[nome] = { nome, items: [], cargaHoraria: d.cargaHoraria, status: d.status };
        if (d.nmTurma) agrupadas[nome].items.push({ nmTurma: d.nmTurma, codClasse: d.codClasse, codTurma: d.codTurma });
    });

    container.innerHTML = '';
    Object.values(agrupadas).forEach(disc => {
        const card = document.createElement('div');
        card.className = 'card card-disciplina';

        const turmasHtml = disc.items.length
            ? disc.items.map(it => {
                const label = it.nmTurma.match(/(\d+)[aªº]\s*[Ss]érie/)?.[0] || it.nmTurma.substring(0, 18);
                return `<span class="turma-pill turma-pill-btn"
                    data-codclasse="${it.codClasse || ''}"
                    data-codturma="${it.codTurma || ''}"
                    data-nmturma="${it.nmTurma}"
                    data-disc="${disc.nome}"
                    title="${it.nmTurma}">${label}</span>`;
            }).join('')
            : '';

        card.innerHTML = `
            <div class="card-icon disc-icon">${disc.nome.charAt(0)}</div>
            <div class="card-title">${disc.nome}</div>
            ${disc.cargaHoraria ? `<div class="card-info"><strong>Carga Horária:</strong> ${disc.cargaHoraria}h</div>` : ''}
            ${turmasHtml ? `<div class="turmas-pills">${turmasHtml}</div>` : ''}
            <span class="card-badge verde">${disc.status || 'Ativa'}</span>
        `;

        // Turma pills clicáveis para ver alunos da disciplina naquela turma
        card.querySelectorAll('.turma-pill-btn').forEach(pill => {
            pill.style.cursor = 'pointer';
            pill.addEventListener('click', e => {
                e.stopPropagation();
                abrirModalAlunos({
                    titulo:    `${pill.dataset.disc} — ${pill.dataset.nmturma}`,
                    nmTurma:   pill.dataset.nmturma,
                    codTurma:  pill.dataset.codturma ? parseInt(pill.dataset.codturma) : null,
                    codClasse: pill.dataset.codclasse ? parseInt(pill.dataset.codclasse) : null,
                });
            });
        });

        container.appendChild(card);
    });
}

// ── Cards de livros ───────────────────────────────────────────────────────────
function renderizarLivros(livros) {
    const container = document.getElementById('livros');
    const counter   = document.getElementById('totalLivros');
    counter.textContent = livros.length ? `${livros.length} encontrados` : '';

    if (!livros.length) {
        container.innerHTML = '<div class="empty-message">Nenhum livro de classe encontrado</div>';
        return;
    }

    container.innerHTML = '';
    livros.forEach(livro => {
        const card = document.createElement('div');
        card.className = 'card';

        const statusClass = (livro.statusLivro || '').toLowerCase().includes('aberto') ? 'verde'
            : (livro.statusLivro || '').toLowerCase().includes('fechado') ? 'vermelho'
            : 'amarelo';

        card.innerHTML = `
            <div class="card-icon livro-icon">L</div>
            <div class="card-title">${livro.nmLivro || 'Livro de Classe'}</div>
            ${livro.nmTurma      ? `<div class="card-info"><strong>Turma:</strong> ${livro.nmTurma}</div>` : ''}
            ${livro.nmDisciplina ? `<div class="card-info"><strong>Disciplina:</strong> ${livro.nmDisciplina}</div>` : ''}
            ${livro.periodo      ? `<div class="card-info"><strong>Período:</strong> ${livro.periodo}</div>` : ''}
            <span class="card-badge ${statusClass}">${livro.statusLivro || 'Em andamento'}</span>
        `;
        container.appendChild(card);
    });
}

// ── Modal de alunos ───────────────────────────────────────────────────────────
// ctx pode ser uma string (nome da turma) ou objeto { titulo, nmTurma, codTurma, codClasse }
async function abrirModalAlunos(ctx) {
    const titulo    = typeof ctx === 'string' ? ctx : (ctx.titulo || ctx.nmTurma || 'Turma');
    const nmTurma   = typeof ctx === 'string' ? ctx : (ctx.nmTurma  || '');
    const codTurma  = typeof ctx === 'string' ? null : (ctx.codTurma  || null);
    const codClasse = typeof ctx === 'string' ? null : (ctx.codClasse || null);

    document.getElementById('modalTitulo').textContent = `Alunos — ${titulo}`;
    const lista = document.getElementById('listaAlunos');
    lista.innerHTML = '<div class="empty-message">Carregando alunos...</div>';
    document.getElementById('modalAlunos').style.display = 'flex';

    try {
        let alunos = [];

        // 1. Tenta Supabase por codturma (mais rápido, sem RCO)
        if (codTurma) {
            const r = await fetch(`${API_URL}/api/alunos?codturma=${codTurma}`);
            if (r.ok) alunos = await r.json();
        }

        // 2. Fallback: Supabase por nome de turma
        if (!alunos.length && nmTurma) {
            const r = await fetch(`${API_URL}/api/alunos?turma=${encodeURIComponent(nmTurma)}`);
            if (r.ok) alunos = await r.json();
        }

        // 3. Fallback: busca direta no RCO por codClasse (funciona sem migração Supabase)
        if (!alunos.length && codClasse) {
            const r = await fetch(`${API_URL}/api/alunos-rco?codClasse=${codClasse}&codPeriodoAvaliacao=9`);
            if (r.ok) {
                const rcoAlunos = await r.json();
                // Normalizar formato RCO para o formato do modal
                alunos = (Array.isArray(rcoAlunos) ? rcoAlunos : []).map(a => ({
                    nome:          a.nome,
                    registro:      String(a.codMatrizAluno || ''),
                    numchamada:    a.numChamada || a.numchamada,
                    status:        a.situacao || 'Ativo',
                    codmatrizaluno: a.codMatrizAluno,
                }));
            }
        }

        if (!alunos.length) {
            lista.innerHTML = '<div class="empty-message">Nenhum aluno encontrado nesta turma</div>';
            return;
        }

        lista.innerHTML = '';
        alunos.forEach(aluno => {
            const chamada  = aluno.numchamada || aluno.numChamada || '';
            const registro = String(aluno.codmatrizaluno || aluno.registro || '');
            const div = document.createElement('div');
            div.className = 'aluno-card';
            div.innerHTML = `
                <div class="aluno-info">
                    ${chamada ? `<div class="aluno-chamada">#${chamada}</div>` : ''}
                    <div class="aluno-nome">${aluno.nome}</div>
                    <div class="aluno-detalhe"><strong>ID:</strong> <code class="aluno-id">${registro}</code></div>
                    <div class="aluno-detalhe"><strong>Status:</strong> <span class="status-ativo">${aluno.status || 'Ativo'}</span></div>
                </div>
                <div class="aluno-codigos">
                    <div class="aluno-qrcode" title="QR Code — ${registro}">
                        ${gerarQRCodeSVG(registro)}
                        <div class="aluno-codigo-label">QR Code</div>
                    </div>
                    <div class="aluno-codigo-barras" title="Código de Barras — ${registro}">
                        ${gerarCodigoBarrasSVG(registro)}
                        <div class="aluno-codigo-label">Cód. Barras</div>
                    </div>
                </div>
            `;
            lista.appendChild(div);
        });
    } catch (e) {
        lista.innerHTML = `<div class="empty-message">Erro ao carregar alunos: ${e.message}</div>`;
    }
}

function fecharModal() {
    document.getElementById('modalAlunos').style.display = 'none';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

// ── QR Code SVG (via qrcode-generator CDN) ───────────────────────────────────
function gerarQRCodeSVG(codigo) {
    try {
        const qr = qrcode(0, 'M');
        qr.addData(String(codigo));
        qr.make();
        // cellSize=3, margin=1 → SVG compacto ~75×75px
        return qr.createSvgTag({ cellSize: 3, margin: 1 });
    } catch (e) {
        // Fallback silencioso se a lib não carregar
        return `<svg width="75" height="75" xmlns="http://www.w3.org/2000/svg">
            <rect width="75" height="75" fill="#f0f0f0" rx="4"/>
            <text x="37" y="42" text-anchor="middle" font-size="9" fill="#999">QR indisponível</text>
        </svg>`;
    }
}

// ── Código de barras SVG ──────────────────────────────────────────────────────
function gerarCodigoBarrasSVG(codigo) {
    const barWidth = 2, height = 50;
    const patterns = [[1,1,1,0,0,1,0],[0,0,1,1,0,1,0],[0,1,0,0,1,1,0],[1,1,0,0,1,0,0],
                      [0,1,1,0,0,1,0],[1,0,1,0,0,1,0],[0,0,0,1,1,1,0],[1,0,0,1,0,1,0],
                      [0,0,1,0,1,1,0],[1,1,0,1,0,0,0]];
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${height+20}" viewBox="0 0 200 ${height+20}">`;
    let x = 10;
    for (const ch of String(codigo)) {
        const d = parseInt(ch);
        if (isNaN(d)) continue;
        for (const bit of patterns[d]) {
            if (bit) svg += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="black"/>`;
            x += barWidth;
        }
        x += barWidth;
    }
    svg += `<text x="100" y="${height+15}" text-anchor="middle" font-family="monospace" font-size="12">${codigo}</text></svg>`;
    return svg;
}

function logout() { window.location.href = '/'; }
