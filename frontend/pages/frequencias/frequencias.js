// ── Frequências — agrupadas por Turma ────────────────────────────────────────

const API = '';
let acessosCache   = null;
const disciplinaCache = {};   // { codClasse: { nomeDisciplina, cor, codClasse, alunos, codAulas, aulaDatas } }
let alunoSelecionado = null;  // { nome, numChamada }

// ── Auth guard ───────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        if (!d.credenciaisConfiguradas) { window.location.href = '/'; return false; }
        return true;
    } catch { window.location.href = '/'; return false; }
}

document.getElementById('btnLogout').addEventListener('click', async () => {
    await fetch(`${API}/api/logout`, { method: 'POST' });
    window.location.href = '/';
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function init() {
    const ok = await checkAuth();
    if (!ok) return;

    try {
        const r = await fetch(`${API}/api/acessos`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        acessosCache = await r.json();
    } catch (e) {
        mostrarErro('Erro ao carregar acessos: ' + e.message);
        return;
    }

    // Verifica se há dados
    const vazio = !acessosCache ||
        (Array.isArray(acessosCache) && acessosCache.length === 0) ||
        (typeof acessosCache === 'object' && !Array.isArray(acessosCache) && Object.keys(acessosCache).length === 0);

    if (vazio) {
        document.getElementById('loading').style.display = 'none';
        await preencherEmptyStateFreq();
        document.getElementById('emptyStateFreq').style.display = 'block';
        return;
    }

    const turmas = coletarTurmas(acessosCache);
    renderCards(turmas);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';

    // Delegação global: clique em linha de aluno abre drawer
    document.getElementById('content').addEventListener('click', e => {
        const row = e.target.closest('tr.freq-aluno-row');
        if (row) abrirDrawerAluno(row.dataset.nome, row.dataset.chamada);
    });
}

// ── Coletar turmas com suas disciplinas ──────────────────────────────────────
function coletarTurmas(acessos) {
    const mapa = {};
    const root = Array.isArray(acessos) ? acessos[0] : acessos;

    for (const periodo of (root.periodoLetivos || [])) {
        for (const livro of (periodo.livros || [])) {
            const classe = livro.classe;
            if (!classe) continue;

            const disc      = classe.disciplina || {};
            const turma     = classe.turma || {};
            const codTurma  = turma.codTurma || 0;
            const nomeTurma = turma.descrTurma || '';

            const serieMatch = nomeTurma.match(/(\d+[ªa]?\s*[sS]érie)/i);
            const serie      = serieMatch ? serieMatch[1] : nomeTurma;

            if (!mapa[codTurma]) {
                mapa[codTurma] = { codTurma, nomeTurma, serie, disciplinas: [] };
            }

            mapa[codTurma].disciplinas.push({
                nome:      disc.nomeDisciplina || 'Disciplina',
                cor:       disc.corFundo || '#667eea',
                codClasse: classe.codClasse,
            });
        }
    }

    return Object.values(mapa).sort((a, b) => {
        const na = parseInt(a.serie) || 99;
        const nb = parseInt(b.serie) || 99;
        return na - nb;
    });
}

// ── Render cards por turma ───────────────────────────────────────────────────
function renderCards(turmas) {
    const container = document.getElementById('listaDiscDisciplinas');
    container.innerHTML = '';

    if (!turmas.length) {
        container.innerHTML = '<p class="freq-vazio">Nenhuma turma encontrada.</p>';
        return;
    }

    turmas.forEach((turma, ti) => {
        const card = document.createElement('div');
        card.className = 'turma-card';

        const discRows = turma.disciplinas
            .sort((a, b) => a.nome.localeCompare(b.nome))
            .map((disc, di) => `
                <div class="disc-row" id="disc-row-${ti}-${di}">
                    <button class="disc-btn" data-ti="${ti}" data-di="${di}"
                            data-codclasse="${disc.codClasse}" aria-expanded="false">
                        <span class="disc-btn-icon" style="background:${disc.cor}">${disc.nome.charAt(0)}</span>
                        <span class="disc-btn-nome">${disc.nome}</span>
                        <span class="disc-btn-chevron">▾</span>
                    </button>
                    <div class="disc-freq-panel" id="freq-panel-${ti}-${di}"
                         data-codclasse="${disc.codClasse}"
                         data-nome="${disc.nome}"
                         data-cor="${disc.cor}"
                         data-loaded="false" style="display:none;">
                        <div class="freq-loading-mini">
                            <div class="spinner-sm"></div>
                            <span>Carregando lista de chamada...</span>
                        </div>
                    </div>
                </div>
            `).join('');

        card.innerHTML = `
            <div class="turma-card-header">
                <div class="turma-card-title">
                    <span class="turma-card-serie">${turma.serie}</span>
                    <span class="turma-card-nome">${turma.nomeTurma}</span>
                </div>
                <span class="turma-card-badge">${turma.disciplinas.length} disciplina${turma.disciplinas.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="disc-list">${discRows}</div>
        `;

        container.appendChild(card);

        card.querySelectorAll('.disc-btn').forEach(btn => {
            btn.addEventListener('click', () => toggleDisc(btn, ti));
        });
    });
}

// ── Toggle disciplina (accordion) ─────────────────────────────────────────────
function toggleDisc(btn, ti) {
    const di        = btn.dataset.di;
    const codClasse = btn.dataset.codclasse;
    const panel     = document.getElementById(`freq-panel-${ti}-${di}`);
    const open      = btn.getAttribute('aria-expanded') === 'true';

    const card = btn.closest('.turma-card');
    card.querySelectorAll('.disc-btn[aria-expanded="true"]').forEach(b => {
        if (b !== btn) {
            b.setAttribute('aria-expanded', 'false');
            const p = document.getElementById(`freq-panel-${ti}-${b.dataset.di}`);
            if (p) p.style.display = 'none';
        }
    });

    if (!open) {
        btn.setAttribute('aria-expanded', 'true');
        panel.style.display = 'block';
        if (panel.dataset.loaded === 'false') {
            carregarFrequencias(panel, codClasse, ti, di);
        }
    } else {
        btn.setAttribute('aria-expanded', 'false');
        panel.style.display = 'none';
    }
}

// ── Carregar frequências via API ──────────────────────────────────────────────
async function carregarFrequencias(panel, codClasse, ti, di) {
    panel.innerHTML = `<div class="freq-loading-mini"><div class="spinner-sm"></div><span>Carregando lista de chamada...</span></div>`;
    try {
        const r = await fetch(`${API}/api/frequencias?codClasse=${codClasse}`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
            throw new Error(err.erro || `HTTP ${r.status}`);
        }
        const data = await r.json();
        panel.dataset.loaded = 'true';

        // ── Armazenar no cache da disciplina ──────────────────────────────
        disciplinaCache[codClasse] = {
            codClasse,
            nomeDisciplina: panel.dataset.nome || 'Disciplina',
            cor:            panel.dataset.cor  || '#667eea',
            alunos:         data.alunos        || [],
            codAulas:       data.codAulas      || [],
            aulaDatas:      data.aulaDatas     || {},
        };

        panel.innerHTML = renderTabelaFrequencias(data, codClasse);

        // Atualizar drawer se já há aluno selecionado
        if (alunoSelecionado) popularDrawer(alunoSelecionado.nome, alunoSelecionado.numChamada);

    } catch (e) {
        panel.dataset.loaded = 'false';
        panel.innerHTML = `
            <div class="freq-erro-inline">
                ⚠ Erro ao carregar: ${e.message}
                <button class="btn-retry" onclick="recarregarFreq(this,${codClasse},${ti},${di})">Tentar novamente</button>
            </div>`;
    }
}

function recarregarFreq(btn, codClasse, ti, di) {
    const panel = document.getElementById(`freq-panel-${ti}-${di}`);
    panel.dataset.loaded = 'false';
    carregarFrequencias(panel, codClasse, ti, di);
}

// ── Montar tabela de frequências ──────────────────────────────────────────────
function renderTabelaFrequencias(data, codClasse) {
    const { codAulas, aulaDatas = {}, alunos } = data;

    if (!alunos || alunos.length === 0) {
        return '<p class="freq-vazio">Nenhum aluno encontrado.</p>';
    }
    if (!codAulas || codAulas.length === 0) {
        return '<p class="freq-vazio">Nenhuma aula registrada neste período.</p>';
    }

    const headerCols = codAulas.map((cod, i) => {
        const data = aulaDatas[cod];
        const label = data || (i + 1);
        const title = data ? `Aula ${i + 1} — ${data}` : `Aula ${i + 1}`;
        return `<th class="col-aula" title="${title}">${label}</th>`;
    }).join('');

    const linhas = alunos
        .slice()
        .sort((a, b) => (a.numChamada || 0) - (b.numChamada || 0))
        .map(a => {
            const pct      = a.percentual !== null ? a.percentual : '-';
            const pctClass = a.percentual === null ? '' :
                             a.percentual >= 80 ? 'pct-ok' :
                             a.percentual >= 60 ? 'pct-alerta' : 'pct-critico';

            const cellsFreq = codAulas.map(cod => {
                const val = a.frequencias[cod];
                if (!val)        return `<td class="fc-vazio" title="Não registrado">·</td>`;
                if (val === 'C') return `<td class="fc-presente" title="Presente">P</td>`;
                return `<td class="fc-falta" title="Falta">${val === 'F' ? 'F' : val}</td>`;
            }).join('');

            const nomeEsc  = (a.nome || '').replace(/"/g, '&quot;');
            const chamada  = a.numChamada || '';

            return `
                <tr class="freq-aluno-row" data-nome="${nomeEsc}" data-chamada="${chamada}">
                    <td class="col-chamada">${chamada || '-'}</td>
                    <td class="col-nome">${a.nome}</td>
                    ${cellsFreq}
                    <td class="col-presenca">${a.presencas}</td>
                    <td class="col-falta">${a.faltas}</td>
                    <td class="col-pct ${pctClass}">${pct}${a.percentual !== null ? '%' : ''}</td>
                </tr>`;
        }).join('');

    const totaisAula = codAulas.map((cod, i) => {
        const faltas = alunos.filter(a => a.frequencias[cod] && a.frequencias[cod] !== 'C').length;
        const pres   = alunos.filter(a => a.frequencias[cod] === 'C').length;
        return `<td class="col-aula-total" title="Aula ${i + 1}: ${pres}P / ${faltas}F">${faltas > 0 ? faltas : ''}</td>`;
    }).join('');

    return `
        <div class="freq-tabela-wrap">
            <div class="freq-legenda">
                <span class="leg-presente">P = Presente</span>
                <span class="leg-falta">F = Falta</span>
                <span class="leg-pct-ok">≥80% Pé-de-Meia OK</span>
                <span class="leg-pct-alerta">60–79% Em risco</span>
                <span class="leg-pct-critico">&lt;60% Sem direito</span>
            </div>
            <div class="freq-scroll">
                <table class="freq-tabela">
                    <thead>
                        <tr>
                            <th class="col-chamada">#</th>
                            <th class="col-nome">Aluno</th>
                            ${headerCols}
                            <th class="col-presenca" title="Total de presenças">P</th>
                            <th class="col-falta" title="Total de faltas">F</th>
                            <th class="col-pct">%</th>
                        </tr>
                    </thead>
                    <tbody>${linhas}</tbody>
                    <tfoot>
                        <tr class="linha-totais">
                            <td colspan="2" class="totais-label">Faltas por aula</td>
                            ${totaisAula}
                            <td colspan="3"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Drawer Direito — Detalhes do Aluno
// ══════════════════════════════════════════════════════════════════════════════

async function abrirDrawerAluno(nome, numChamada) {
    alunoSelecionado = { nome, numChamada };

    // Cabeçalho
    document.getElementById('drawerAvatar').textContent  = nome.charAt(0).toUpperCase();
    document.getElementById('drawerNome').textContent    = nome;
    document.getElementById('drawerChamada').textContent = numChamada ? `Chamada nº ${numChamada}` : '';

    // Abrir layout
    document.getElementById('freqLayout').classList.add('drawer-aberto');

    // Highlight na linha selecionada
    document.querySelectorAll('.freq-aluno-row').forEach(r => {
        r.classList.toggle('freq-aluno-ativo', r.dataset.nome === nome);
    });

    // Mostrar loading enquanto busca todas as disciplinas
    document.getElementById('drawerBody').innerHTML = `
        <div class="drawer-placeholder" style="padding-top:40px">
            <div class="spinner-sm" style="width:28px;height:28px;border-width:3px;margin:0 auto 14px"></div>
            <p style="font-size:12px">Buscando dados em<br>todas as disciplinas...</p>
        </div>`;

    // Buscar todas as disciplinas não carregadas antes de exibir
    await carregarTodasDisciplinas();

    // Exibir drawer completo
    popularDrawer(nome, numChamada);
}

// ── Busca todas as disciplinas do acessosCache em paralelo ───────────────────
async function carregarTodasDisciplinas() {
    if (!acessosCache) return;
    const root = Array.isArray(acessosCache) ? acessosCache[0] : acessosCache;
    const pendentes = [];

    for (const periodo of (root.periodoLetivos || [])) {
        for (const livro of (periodo.livros || [])) {
            const classe = livro.classe;
            if (!classe) continue;
            const codClasse = classe.codClasse;
            if (disciplinaCache[codClasse]) continue; // já carregado

            pendentes.push({
                codClasse,
                nomeDisciplina: classe.disciplina?.nomeDisciplina || 'Disciplina',
                cor:            classe.disciplina?.corFundo       || '#667eea',
            });
        }
    }

    if (pendentes.length === 0) return;

    // Buscar em paralelo — ignora falhas individuais
    await Promise.allSettled(pendentes.map(async ({ codClasse, nomeDisciplina, cor }) => {
        try {
            const r = await fetch(`${API}/api/frequencias?codClasse=${codClasse}`);
            if (!r.ok) return;
            const data = await r.json();
            disciplinaCache[codClasse] = {
                codClasse, nomeDisciplina, cor,
                alunos:    data.alunos    || [],
                codAulas:  data.codAulas  || [],
                aulaDatas: data.aulaDatas || {},
            };
            // Sincroniza o accordion se o painel já estava aberto
            const panel = document.querySelector(`.disc-freq-panel[data-codclasse="${codClasse}"]`);
            if (panel && panel.dataset.loaded === 'true') return;
            if (panel) panel.dataset.loaded = 'true';
        } catch { /* silencioso */ }
    }));
}

function fecharDrawerAluno() {
    alunoSelecionado = null;
    document.getElementById('freqLayout').classList.remove('drawer-aberto');
    document.getElementById('drawerNome').textContent    = 'Nenhum aluno';
    document.getElementById('drawerChamada').textContent = 'selecionado';
    document.getElementById('drawerAvatar').textContent  = '?';
    document.getElementById('drawerBody').innerHTML = `
        <div class="drawer-placeholder">
            <div class="drawer-placeholder-icon">👆</div>
            <p>Clique em um aluno<br>na tabela para ver<br>seu resumo</p>
        </div>`;
    document.querySelectorAll('.freq-aluno-row.freq-aluno-ativo').forEach(r => {
        r.classList.remove('freq-aluno-ativo');
    });
}

function popularDrawer(nome, numChamada) {
    const body = document.getElementById('drawerBody');
    const disciplinas = Object.values(disciplinaCache);

    if (disciplinas.length === 0) {
        body.innerHTML = `
            <div class="drawer-placeholder">
                <div class="drawer-placeholder-icon">📂</div>
                <p>Abra uma disciplina<br>na tabela para<br>carregar os dados</p>
            </div>`;
        return;
    }

    // ── Calcular por disciplina ──────────────────────────────────────────────
    let totalP = 0, totalF = 0;
    const cards = disciplinas
        .sort((a, b) => a.nomeDisciplina.localeCompare(b.nomeDisciplina))
        .map(disc => {
            const aluno = disc.alunos.find(a => a.nome === nome);
            if (!aluno) return null;

            totalP += aluno.presencas || 0;
            totalF += aluno.faltas    || 0;

            const pct      = aluno.percentual;
            const pctStr   = pct !== null ? `${pct}%` : '—';
            const pctClass = pct === null ? '' : pct >= 80 ? 'pct-ok' : pct >= 60 ? 'pct-alerta' : 'pct-critico';
            const stClass  = pct === null ? '' : pct >= 80 ? 'ok'     : pct >= 60 ? 'alerta'     : 'critico';
            const stLabel  = pct === null ? '' : pct >= 80 ? '✓ Pé-de-Meia OK' : pct >= 60 ? '⚠ Em risco' : '✗ Sem direito';
            const barColor = pct === null ? '#e5e7eb'
                           : pct >= 80 ? '#22c55e'
                           : pct >= 60 ? '#f59e0b'
                           : '#ef4444';
            const barWidth = pct !== null ? Math.min(100, pct) : 0;

            return `
                <div class="drawer-disc-card">
                    <div class="drawer-disc-header">
                        <div class="drawer-disc-icon" style="background:${disc.cor}">${disc.nomeDisciplina.charAt(0)}</div>
                        <span class="drawer-disc-nome" title="${disc.nomeDisciplina}">${disc.nomeDisciplina}</span>
                    </div>
                    <div class="drawer-disc-bar-wrap">
                        <div class="drawer-disc-bar" style="width:${barWidth}%;background:${barColor}"></div>
                    </div>
                    <div class="drawer-disc-stats">
                        <span class="dstat-pct ${pctClass}">${pctStr}</span>
                        <span class="dstat-sep">·</span>
                        <span class="dstat-p">${aluno.presencas}P</span>
                        <span class="dstat-sep">·</span>
                        <span class="dstat-f">${aluno.faltas}F</span>
                    </div>
                    ${stLabel ? `<div class="drawer-disc-status ${stClass}">${stLabel}</div>` : ''}
                </div>`;
        })
        .filter(Boolean);

    // ── Resumo geral (somente disciplinas carregadas) ────────────────────────
    const totalGeral   = totalP + totalF;
    const pctGeral     = totalGeral > 0 ? Math.round((totalP / totalGeral) * 100) : null;
    const pctGeralCls  = pctGeral === null ? '' : pctGeral >= 80 ? 'pct-ok' : pctGeral >= 60 ? 'pct-alerta' : 'pct-critico';
    const barGeralColor = pctGeral === null ? '#e5e7eb'
                        : pctGeral >= 80 ? '#22c55e'
                        : pctGeral >= 60 ? '#f59e0b'
                        : '#ef4444';

    const resumoHTML = `
        <div class="drawer-resumo">
            <div class="drawer-resumo-titulo">Resumo Geral (${cards.length} disciplina${cards.length !== 1 ? 's' : ''})</div>
            <div class="drawer-resumo-bar-wrap">
                <div class="drawer-resumo-bar" style="width:${pctGeral || 0}%;background:${barGeralColor}"></div>
            </div>
            <div class="drawer-resumo-stats">
                <div class="drawer-resumo-stat">
                    <span class="rstat-val ${pctGeralCls}">${pctGeral !== null ? pctGeral + '%' : '—'}</span>
                    <span class="rstat-label">Geral</span>
                </div>
                <div class="drawer-resumo-stat">
                    <span class="rstat-val" style="color:#15803d">${totalP}</span>
                    <span class="rstat-label">Presenças</span>
                </div>
                <div class="drawer-resumo-stat">
                    <span class="rstat-val" style="color:#dc2626">${totalF}</span>
                    <span class="rstat-label">Faltas</span>
                </div>
            </div>
        </div>`;

    body.innerHTML = resumoHTML
        + `<div class="drawer-disc-label">Por Disciplina (${cards.length})</div>`
        + (cards.length > 0
            ? cards.join('')
            : `<div class="drawer-placeholder" style="padding:20px 14px">
                   <div class="drawer-placeholder-icon" style="font-size:22px">🔍</div>
                   <p>Aluno não encontrado<br>nas disciplinas.</p>
               </div>`);
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function mostrarErro(msg) {
    document.getElementById('loading').style.display = 'none';
    const el = document.getElementById('erro');
    el.style.display = 'block';
    document.getElementById('erroMsg').textContent = msg;
}

// ── Empty State de Frequências ────────────────────────────────────────────────
async function preencherEmptyStateFreq() {
    const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('emptyDescFreq').innerHTML =
        `O RCO Digital não retornou turmas para <strong>${hoje}</strong>. ` +
        `Isso acontece em fins de semana, feriados ou recesso escolar.`;
    try {
        const r = await fetch(`${API}/api/sync/log`);
        if (!r.ok) return;
        const logs = await r.json();
        const ultimo = logs.find(l => l.estabelecimentos > 0) || logs[0];
        if (!ultimo) return;
        const dt = new Date(ultimo.executado_em);
        const dtStr = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('emptySyncInfoFreq').innerHTML = `
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
    } catch {}
}

async function forcarSyncFreq() {
    const btn = document.getElementById('btnSyncFreq');
    btn.disabled = true;
    btn.textContent = '⏳ Sincronizando...';
    try {
        const r = await fetch(`${API}/api/sync`, { method: 'POST' });
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

// ── Rodapé: Status do Serviço ─────────────────────────────────────────────────
async function abrirModalStatusFreq() {
    const modal = document.getElementById('modalStatusFreq');
    modal.classList.add('open');
    const body = document.getElementById('statusBodyFreq');
    try {
        const [statusR, syncR] = await Promise.all([
            fetch(`${API}/api/status`),
            fetch(`${API}/api/sync/log`)
        ]);
        const status = await statusR.json();
        const syncLog = syncR.ok ? await syncR.json() : [];
        const exp = status.tokenExpiracao ? new Date(status.tokenExpiracao) : null;
        const agora = new Date();
        const tokenOk = exp && exp > agora;
        const expStr = exp ? exp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · ' + exp.toLocaleDateString('pt-BR') : '—';
        const minutos = exp ? Math.round((exp - agora) / 60000) : 0;
        const logsHtml = syncLog.slice(0, 5).map(l => {
            const dt = new Date(l.executado_em);
            const dtStr = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const stats = l.estabelecimentos > 0 ? `${l.turmas}T · ${l.disciplinas}D · ${l.classes}C` : 'sem dados';
            return `<div class="status-sync-row">
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
                    <div class="status-card-sub">${exp ? `Expira: ${expStr}${tokenOk ? ` (em ${minutos} min)` : ''}` : 'Token não obtido'}</div>
                </div>
            </div>
            <div class="status-card-label" style="margin-bottom:10px">Histórico de Sincronizações</div>
            <div class="status-sync-log">${logsHtml || '<div style="color:var(--text-muted);font-size:13px;padding:10px 0">Nenhum registro</div>'}</div>
        `;
        const dot = document.getElementById('footerDotFreq');
        if (dot) {
            if (!status.credenciaisConfiguradas) dot.classList.add('offline');
            else if (!tokenOk && !status.tokenEmCache) dot.classList.add('warning');
        }
    } catch (e) {
        body.innerHTML = `<div style="color:#dc3545;padding:20px;text-align:center">Erro: ${e.message}</div>`;
    }
}

// ── Rodapé: Dados do RCO ─────────────────────────────────────────────────────
let rcoRawCache = null;

async function abrirModalRcoFreq() {
    const modal = document.getElementById('modalRcoFreq');
    modal.classList.add('open');
    const body = document.getElementById('rcoBodyFreq');
    body.innerHTML = '<div class="loading" style="padding:40px 20px"><div class="spinner"></div><p>Consultando RCO...</p></div>';
    try {
        if (!rcoRawCache) {
            const r = await fetch(`${API}/api/acessos`);
            rcoRawCache = await r.json();
        }
        const data = rcoRawCache;
        const jsonStr = JSON.stringify(data, null, 2);
        const colorido = jsonStr
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"([^"]+)"(\s*:)/g,'<span class="json-key">"$1"</span>$2')
            .replace(/:\s*"([^"]*)"/g,': <span class="json-str">"$1"</span>')
            .replace(/:\s*(-?\d+\.?\d*)/g,': <span class="json-num">$1</span>')
            .replace(/:\s*(true|false)/g,': <span class="json-bool">$1</span>')
            .replace(/:\s*(null)/g,': <span class="json-null">$1</span>');
        const vazio = !data || (Array.isArray(data) && data.length === 0);
        body.innerHTML = `
            <div class="rco-data-stats" style="margin-bottom:14px">
                <div class="rco-stat-chip">Resposta: <strong>${vazio ? 'vazia' : 'com dados'}</strong></div>
                <div class="rco-stat-chip">Bytes: <strong>${new Blob([jsonStr]).size}</strong></div>
                <button class="rco-btn-refresh" onclick="rcoRawCache=null;abrirModalRcoFreq()">↺ Atualizar</button>
            </div>
            <div class="rco-json-viewer">${colorido}</div>
        `;
    } catch (e) {
        body.innerHTML = `<div style="color:#dc3545;padding:20px;text-align:center">Erro: ${e.message}</div>`;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODO GERAL — Filtro por Faixa de Frequência Total
// ══════════════════════════════════════════════════════════════════════════════

let modoGeralAtivo    = false;
let modoGeralCarregado = false;
let filtroMin = 0, filtroMax = 100;

async function alternarModoGeral() {
    modoGeralAtivo = !modoGeralAtivo;
    const btn    = document.getElementById('btnModoGeral');
    const painel = document.getElementById('painelGeral');
    const normal = document.getElementById('modoNormal');
    const titulo = document.getElementById('tituloModoPagina');
    const drawer = document.getElementById('freqLayout');

    if (modoGeralAtivo) {
        btn.classList.add('btn-modo-ativo');
        btn.textContent = '← Voltar por Disciplina';
        titulo.textContent = 'Visão Geral de Frequência';
        painel.style.display = 'block';
        normal.style.display = 'none';
        drawer.classList.remove('drawer-aberto');
        fecharDrawerAluno();
        await ativarModoGeral();
    } else {
        btn.classList.remove('btn-modo-ativo');
        btn.textContent = '📊 Visão Geral por Aluno';
        titulo.textContent = 'Frequências por Disciplina';
        painel.style.display = 'none';
        normal.style.display = 'block';
    }
}

async function ativarModoGeral() {
    if (modoGeralCarregado) { renderModoGeral(); return; }

    const loading = document.getElementById('geralLoading');
    const lista   = document.getElementById('geralLista');
    loading.style.display = 'flex';
    lista.innerHTML = '';

    await carregarTodasDisciplinas();

    loading.style.display = 'none';
    modoGeralCarregado = true;
    renderModoGeral();
}

function calcularFreqGeral() {
    const disciplinas = Object.values(disciplinaCache);
    const mapa = {};

    disciplinas.forEach(disc => {
        (disc.alunos || []).forEach(aluno => {
            const key = aluno.codMatrizAluno || aluno.nome;
            if (!mapa[key]) {
                mapa[key] = {
                    key,
                    nome:      aluno.nome,
                    numChamada: aluno.numChamada,
                    totalP:    0,
                    totalF:    0,
                    disciplinas: [],
                };
            }
            mapa[key].totalP += aluno.presencas || 0;
            mapa[key].totalF += aluno.faltas    || 0;
            if ((aluno.presencas || 0) + (aluno.faltas || 0) > 0) {
                mapa[key].disciplinas.push({
                    nome: disc.nomeDisciplina,
                    cor:  disc.cor,
                    pct:  aluno.percentual,
                });
            }
        });
    });

    return Object.values(mapa).map(a => {
        const total  = a.totalP + a.totalF;
        const pct    = total > 0 ? Math.round((a.totalP / total) * 100) : null;
        return { ...a, total, pct };
    });
}

function renderModoGeral() {
    const min     = filtroMin;
    const max     = filtroMax;
    const sort    = document.getElementById('selectSort')?.value || 'asc';
    const lista   = document.getElementById('geralLista');
    const resumo  = document.getElementById('geralResumo');

    const todos = calcularFreqGeral();

    const filtrados = todos.filter(a => {
        if (a.pct === null) return min === 0;
        return a.pct >= min && a.pct <= max;
    });

    const ordenados = [...filtrados].sort((a, b) => {
        if (sort === 'asc')  return (a.pct ?? -1) - (b.pct ?? -1);
        if (sort === 'desc') return (b.pct ?? -1) - (a.pct ?? -1);
        return a.nome.localeCompare(b.nome);
    });

    // Resumo estatístico
    const comDado = todos.filter(a => a.pct !== null);
    const nOk      = comDado.filter(a => a.pct >= 80).length;
    const nAlerta  = comDado.filter(a => a.pct >= 60 && a.pct < 80).length;
    const nCritico = comDado.filter(a => a.pct < 60).length;

    resumo.style.display = 'flex';
    resumo.innerHTML = `
        <div class="geral-resumo-stat">
            <span class="gres-val">${todos.length}</span>
            <span class="gres-label">Alunos</span>
        </div>
        <div class="geral-resumo-stat gres-ok">
            <span class="gres-val">${nOk}</span>
            <span class="gres-label">≥80% OK</span>
        </div>
        <div class="geral-resumo-stat gres-alerta">
            <span class="gres-val">${nAlerta}</span>
            <span class="gres-label">60–79%</span>
        </div>
        <div class="geral-resumo-stat gres-critico">
            <span class="gres-val">${nCritico}</span>
            <span class="gres-label">&lt;60%</span>
        </div>
        <div class="geral-resumo-stat gres-filtrado">
            <span class="gres-val">${filtrados.length}</span>
            <span class="gres-label">Nesta faixa</span>
        </div>
    `;

    if (todos.length === 0) {
        lista.innerHTML = `<div class="geral-vazio">Nenhuma disciplina carregada. Abra uma disciplina primeiro ou aguarde.</div>`;
        return;
    }

    if (filtrados.length === 0) {
        lista.innerHTML = `<div class="geral-vazio">Nenhum aluno na faixa ${min}%–${max}%.</div>`;
        return;
    }

    lista.innerHTML = `
        <div class="geral-count">${filtrados.length} aluno${filtrados.length !== 1 ? 's' : ''} na faixa ${min}%–${max}%</div>
        ${ordenados.map(a => renderAlunoGeralCard(a)).join('')}
    `;

    lista.querySelectorAll('.aluno-geral-card').forEach(card => {
        card.addEventListener('click', () => {
            const nome     = card.dataset.nome;
            const chamada  = card.dataset.chamada;
            // Volta ao modo disciplina temporariamente para o drawer funcionar?
            // Não: apenas abre o drawer (o layout suporta)
            document.getElementById('freqLayout').classList.add('drawer-aberto');
            abrirDrawerAluno(nome, chamada);
        });
    });
}

function renderAlunoGeralCard(a) {
    const pct      = a.pct;
    const pctStr   = pct !== null ? `${pct}%` : '—';
    const pctClass = pct === null ? '' : pct >= 80 ? 'pct-ok' : pct >= 60 ? 'pct-alerta' : 'pct-critico';
    const barColor = pct === null ? '#e5e7eb' : pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
    const barW     = pct !== null ? Math.min(100, pct) : 0;
    const badge    = pct === null ? '' :
                     pct >= 80 ? '<span class="aluno-badge badge-ok">Pé-de-Meia OK</span>' :
                     pct >= 60 ? '<span class="aluno-badge badge-alerta">Em risco</span>' :
                                 '<span class="aluno-badge badge-critico">Crítico</span>';

    const discMini = (a.disciplinas || []).slice(0, 6).map(d =>
        `<span class="disc-mini-dot" style="background:${d.cor}" title="${d.nome}: ${d.pct !== null ? d.pct + '%' : '—'}"></span>`
    ).join('');

    const nomeEsc = (a.nome || '').replace(/"/g, '&quot;');

    return `
        <div class="aluno-geral-card" data-nome="${nomeEsc}" data-chamada="${a.numChamada || ''}">
            <div class="aluno-geral-topo">
                <div class="aluno-geral-avatar">${(a.nome || '?').charAt(0).toUpperCase()}</div>
                <div class="aluno-geral-info">
                    <div class="aluno-geral-nome">${a.nome}</div>
                    <div class="aluno-geral-meta">
                        ${a.numChamada ? `<span class="aluno-chamada-num">#${a.numChamada}</span>` : ''}
                        <span>${a.totalP}P · ${a.totalF}F · ${a.disciplinas.length} disc.</span>
                        ${discMini}
                    </div>
                </div>
                <div class="aluno-geral-pct ${pctClass}">${pctStr}</div>
            </div>
            <div class="aluno-geral-bar-wrap">
                <div class="aluno-geral-bar" style="width:${barW}%;background:${barColor}"></div>
            </div>
            ${badge}
        </div>`;
}

function selecionarChip(chip) {
    document.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('chip-ativo'));
    chip.classList.add('chip-ativo');
    filtroMin = parseInt(chip.dataset.min);
    filtroMax = parseInt(chip.dataset.max);
    document.getElementById('rangeMin').value = filtroMin;
    document.getElementById('rangeMax').value = filtroMax;
    renderModoGeral();
}

function aplicarRangeCustom() {
    const min = parseInt(document.getElementById('rangeMin').value) || 0;
    const max = parseInt(document.getElementById('rangeMax').value) || 100;
    filtroMin = Math.max(0, Math.min(100, min));
    filtroMax = Math.max(0, Math.min(100, max));
    document.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('chip-ativo'));
    renderModoGeral();
}

init();
