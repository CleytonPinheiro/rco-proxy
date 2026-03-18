// ── Frequências — agrupadas por Turma ────────────────────────────────────────

const API = '';
let acessosCache = null;

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
}

// ── Coletar turmas com suas disciplinas ──────────────────────────────────────
// Estrutura real: root.periodoLetivos[].livros[].classe.{codClasse, turma, disciplina}
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

            // Extrair série da descrição (ex: "... - 3ª Série - Manhã - C")
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

    // Ordenar turmas por série (1ª, 2ª, 3ª)
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
                         data-codclasse="${disc.codClasse}" data-loaded="false" style="display:none;">
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

        // Bind cliques nos botões de disciplina
        card.querySelectorAll('.disc-btn').forEach(btn => {
            btn.addEventListener('click', () => toggleDisc(btn, ti));
        });
    });
}

// ── Toggle disciplina (accordion dentro do card) ──────────────────────────────
function toggleDisc(btn, ti) {
    const di        = btn.dataset.di;
    const codClasse = btn.dataset.codclasse;
    const panel     = document.getElementById(`freq-panel-${ti}-${di}`);
    const open      = btn.getAttribute('aria-expanded') === 'true';

    // Fechar qualquer outra disciplina do mesmo card que esteja aberta
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
        panel.innerHTML = renderTabelaFrequencias(data);
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
function renderTabelaFrequencias(data) {
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

            return `
                <tr>
                    <td class="col-chamada">${a.numChamada || '-'}</td>
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

// ── Utilitários ───────────────────────────────────────────────────────────────
function mostrarErro(msg) {
    document.getElementById('loading').style.display = 'none';
    const el = document.getElementById('erro');
    el.style.display = 'block';
    document.getElementById('erroMsg').textContent = msg;
}

init();
