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

function abrirDrawerAluno(nome, numChamada) {
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

    popularDrawer(nome, numChamada);
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
    let totalP = 0, totalF = 0, discNaoEncontrada = 0;
    const cards = disciplinas
        .sort((a, b) => a.nomeDisciplina.localeCompare(b.nomeDisciplina))
        .map(disc => {
            const aluno = disc.alunos.find(a => a.nome === nome);
            if (!aluno) { discNaoEncontrada++; return null; }

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

    const naoCarregadoHTML = discNaoEncontrada > 0
        ? `<div class="drawer-nao-carregado">+ ${discNaoEncontrada} disciplina${discNaoEncontrada !== 1 ? 's' : ''} ainda não carregada${discNaoEncontrada !== 1 ? 's' : ''}</div>`
        : '';

    body.innerHTML = resumoHTML
        + `<div class="drawer-disc-label">Por Disciplina</div>`
        + (cards.length > 0
            ? cards.join('')
            : `<p class="drawer-placeholder" style="padding:20px 14px;font-size:12px;color:#9ca3af">Aluno não encontrado nas disciplinas carregadas.</p>`)
        + naoCarregadoHTML;
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function mostrarErro(msg) {
    document.getElementById('loading').style.display = 'none';
    const el = document.getElementById('erro');
    el.style.display = 'block';
    document.getElementById('erroMsg').textContent = msg;
}

init();
