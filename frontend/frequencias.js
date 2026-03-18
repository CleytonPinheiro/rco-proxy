// ── Frequências por Disciplina ───────────────────────────────────────────────

const API = '';
let acessosCache = null;

// ── Auth guard ───────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const r = await fetch(`${API}/api/status`);
        const d = await r.json();
        if (!d.loggedIn) { window.location.href = '/'; return false; }
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

    const disciplinas = coletarDisciplinas(acessosCache);
    renderAccordion(disciplinas);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
}

// ── Coletar disciplinas únicas com suas turmas ───────────────────────────────
// Estrutura real do /api/acessos:
//   root.periodoLetivos[].livros[].classe.{codClasse, turma, disciplina}
function coletarDisciplinas(acessos) {
    const mapa = {};
    const root = Array.isArray(acessos) ? acessos[0] : acessos;

    for (const periodo of (root.periodoLetivos || [])) {
        for (const livro of (periodo.livros || [])) {
            const classe = livro.classe;
            if (!classe) continue;

            const disc      = classe.disciplina || {};
            const turma     = classe.turma || {};
            const nomeDisc  = disc.nomeDisciplina || 'Disciplina';
            const codClasse = classe.codClasse;
            const nomeTurma = turma.descrTurma || '';
            const codTurma  = turma.codTurma || null;
            const corFundo  = disc.corFundo || '#667eea';

            // Extrair série da descrição da turma (ex: "... - 3ª Série - ...")
            const serieMatch = nomeTurma.match(/(\d+[ªa]?\s*[sS]érie)/);
            const serie      = serieMatch ? serieMatch[1] : '';

            if (!mapa[nomeDisc]) {
                mapa[nomeDisc] = { nome: nomeDisc, cor: corFundo, turmas: [] };
            }
            mapa[nomeDisc].turmas.push({ nomeTurma, serie, codClasse, codTurma });
        }
    }

    return Object.values(mapa).sort((a, b) => a.nome.localeCompare(b.nome));
}

// ── Render accordion ─────────────────────────────────────────────────────────
function renderAccordion(disciplinas) {
    const container = document.getElementById('listaDiscDisciplinas');
    container.innerHTML = '';

    if (!disciplinas.length) {
        container.innerHTML = '<p class="freq-vazio">Nenhuma disciplina encontrada.</p>';
        return;
    }

    disciplinas.forEach((disc, idx) => {
        const item = document.createElement('div');
        item.className = 'disc-item';
        item.innerHTML = `
            <button class="disc-header" data-idx="${idx}" aria-expanded="false">
                <span class="disc-icon" style="background:${disc.cor || '#667eea'}">${disc.nome.charAt(0).toUpperCase()}</span>
                <span class="disc-nome">${disc.nome}</span>
                <span class="disc-turma-badges">
                    ${disc.turmas.map(t => `<span class="badge-turma-mini">${t.serie || t.nomeTurma}</span>`).join('')}
                </span>
                <span class="disc-chevron">▾</span>
            </button>
            <div class="disc-body" id="disc-body-${idx}" style="display:none;">
                ${disc.turmas.map((t, ti) => `
                    <div class="turma-freq-block" id="turma-block-${idx}-${ti}">
                        <div class="turma-freq-header">
                            <span class="turma-freq-label">${t.nomeTurma || t.serie}</span>
                            <span class="turma-freq-serie">${t.serie}</span>
                        </div>
                        <div class="turma-freq-content" id="freq-content-${idx}-${ti}"
                             data-codclasse="${t.codClasse}" data-loaded="false">
                            <div class="freq-loading-mini">
                                <div class="spinner-sm"></div>
                                <span>Carregando lista de chamada...</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(item);

        item.querySelector('.disc-header').addEventListener('click', () => {
            toggleAccordion(item, disc, idx);
        });
    });
}

// ── Toggle accordion ─────────────────────────────────────────────────────────
function toggleAccordion(item, disc, idx) {
    const btn  = item.querySelector('.disc-header');
    const body = item.querySelector('.disc-body');
    const open = btn.getAttribute('aria-expanded') === 'true';

    // Fechar todos os outros
    document.querySelectorAll('.disc-header[aria-expanded="true"]').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
        b.closest('.disc-item').querySelector('.disc-body').style.display = 'none';
    });

    if (!open) {
        btn.setAttribute('aria-expanded', 'true');
        body.style.display = 'block';

        // Carregar frequências das turmas ainda não carregadas
        disc.turmas.forEach((t, ti) => {
            const el = document.getElementById(`freq-content-${idx}-${ti}`);
            if (el && el.dataset.loaded === 'false' && t.codClasse) {
                carregarFrequencias(el, t.codClasse, idx, ti);
            } else if (el && !t.codClasse) {
                el.innerHTML = '<p class="freq-vazio">Sem codClasse registrado para esta turma/disciplina.</p>';
            }
        });
    }
}

// ── Carregar e renderizar frequências ────────────────────────────────────────
async function carregarFrequencias(el, codClasse, idx, ti) {
    try {
        const r = await fetch(`${API}/api/frequencias?codClasse=${codClasse}`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
            throw new Error(err.erro || `HTTP ${r.status}`);
        }
        const data = await r.json();
        el.dataset.loaded = 'true';
        el.innerHTML = renderTabelaFrequencias(data);
    } catch (e) {
        el.dataset.loaded = 'false';
        el.innerHTML = `
            <div class="freq-erro-inline">
                ⚠ Erro ao carregar: ${e.message}
                <button class="btn-retry" onclick="recarregarFreq(this, ${codClasse}, ${idx}, ${ti})">Tentar novamente</button>
            </div>`;
    }
}

function recarregarFreq(btn, codClasse, idx, ti) {
    const el = document.getElementById(`freq-content-${idx}-${ti}`);
    el.dataset.loaded = 'false';
    el.innerHTML = `<div class="freq-loading-mini"><div class="spinner-sm"></div><span>Carregando...</span></div>`;
    carregarFrequencias(el, codClasse, idx, ti);
}

// ── Montar tabela de frequências ─────────────────────────────────────────────
function renderTabelaFrequencias(data) {
    const { codAulas, alunos } = data;

    if (!alunos || alunos.length === 0) {
        return '<p class="freq-vazio">Nenhum aluno encontrado.</p>';
    }
    if (!codAulas || codAulas.length === 0) {
        return '<p class="freq-vazio">Nenhuma aula registrada neste período.</p>';
    }

    const totalAulas = codAulas.length;

    // Legenda de aulas: apenas sequência (Aula 1, Aula 2, ...)
    const headerCols = codAulas.map((_, i) => `<th class="col-aula" title="Aula ${i + 1}">${i + 1}</th>`).join('');

    const linhas = alunos
        .slice()
        .sort((a, b) => (a.numChamada || 0) - (b.numChamada || 0))
        .map(a => {
            const pct = a.percentual !== null ? a.percentual : '-';
            const pctClass = a.percentual === null ? '' : a.percentual >= 75 ? 'pct-ok' : a.percentual >= 50 ? 'pct-alerta' : 'pct-critico';

            const cellsFreq = codAulas.map(cod => {
                const val = a.frequencias[cod];
                if (!val)           return `<td class="fc-vazio" title="Não registrado">·</td>`;
                if (val === 'C')    return `<td class="fc-presente" title="Presente">P</td>`;
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

    // Linha de totais por aula (quantos faltaram em cada aula)
    const totaisAula = codAulas.map((cod, i) => {
        const faltas = alunos.filter(a => a.frequencias[cod] && a.frequencias[cod] !== 'C').length;
        const pres   = alunos.filter(a => a.frequencias[cod] === 'C').length;
        const title  = `Aula ${i + 1}: ${pres} presentes, ${faltas} faltaram`;
        return `<td class="col-aula-total" title="${title}">${faltas > 0 ? faltas : ''}</td>`;
    }).join('');

    return `
        <div class="freq-tabela-wrap">
            <div class="freq-legenda">
                <span class="leg-presente">P = Presente</span>
                <span class="leg-falta">F = Falta</span>
                <span class="leg-pct-ok">≥75% OK</span>
                <span class="leg-pct-alerta">50–74% Atenção</span>
                <span class="leg-pct-critico">&lt;50% Crítico</span>
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

// ── Utilitários ──────────────────────────────────────────────────────────────
function mostrarErro(msg) {
    document.getElementById('loading').style.display = 'none';
    const el = document.getElementById('erro');
    el.style.display = 'block';
    document.getElementById('erroMsg').textContent = msg;
}

// ── Start ────────────────────────────────────────────────────────────────────
init();
