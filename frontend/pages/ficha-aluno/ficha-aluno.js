// ── Ficha Completa do Aluno ───────────────────────────────────────────────────

const API = '';

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlightMatch(text, query) {
    if (!query) return escHtml(text);
    const escaped = escHtml(text);
    const words = query.trim().split(/\s+/).filter(Boolean)
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return escaped;
    const pattern = new RegExp(`(${words.join('|')})`, 'gi');
    return escaped.replace(pattern, '<mark class="busca-hl">$1</mark>');
}

function formatarData(iso) {
    if (!iso) return '—';
    const [y, m, d] = (iso || '').split('T')[0].split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
}

function formatarDataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

/* ── Inicialização ─────────────────────────────────────────────────────────── */

async function init() {
    const params = new URLSearchParams(location.search);
    const codMatrizAluno = params.get('codMatrizAluno');

    if (!codMatrizAluno) {
        /* Modo seletor: painel lateral com lista de alunos */
        document.getElementById('fichaMain').classList.add('ficha-modo-seletor');
        document.getElementById('fichaHeader').innerHTML = `
            <div class="ficha-header-info">
                <h2 class="ficha-aluno-nome" style="font-size:18px;opacity:.7">Selecione um aluno</h2>
                <p style="margin:4px 0 0;opacity:.55;font-size:13px">Escolha a turma no painel à esquerda e clique em um aluno.</p>
            </div>`;
        await carregarTurmas();
        return;
    }

    /* Modo direto: esconde painel lateral e carrega ficha imediatamente */
    document.getElementById('fichaMain').classList.add('ficha-modo-direto');
    await carregarFicha(codMatrizAluno);
}

/* ── Modo seletor ──────────────────────────────────────────────────────────── */

async function carregarTurmas() {
    const sel = document.getElementById('fichaTurmaSelect');

    try {
        const r = await fetch(`${API}/api/alunos/turmas/lista`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const turmas = await r.json();

        if (!turmas || turmas.length === 0) {
            sel.innerHTML = '<option value="">Nenhuma turma encontrada</option>';
            return;
        }

        sel.innerHTML = '<option value="">Selecione a turma…</option>' +
            turmas.map(t => `<option value="${t.codturma}">${escHtml(t.turma)}</option>`).join('');

        sel.addEventListener('change', () => {
            if (sel.value) carregarAlunos(sel.value);
            else {
                document.getElementById('fichaListaAlunos').innerHTML =
                    '<div class="ficha-lista-placeholder">Selecione uma turma para ver os alunos.</div>';
            }
        });
    } catch (e) {
        sel.innerHTML = '<option value="">Erro ao carregar turmas</option>';
    }
}

async function carregarAlunos(codturma) {
    const listEl = document.getElementById('fichaListaAlunos');
    listEl.innerHTML = '<div class="ficha-lista-loading"><div class="spinner" style="width:22px;height:22px;margin:0 auto 6px"></div>Carregando alunos…</div>';

    try {
        const r = await fetch(`${API}/api/ficha-aluno/resumo-turma?codturma=${encodeURIComponent(codturma)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { alunos } = await r.json();

        if (!alunos || alunos.length === 0) {
            listEl.innerHTML = '<div class="ficha-lista-placeholder">Nenhum aluno encontrado nesta turma.</div>';
            return;
        }

        /* Ordena alfabeticamente */
        alunos.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));

        listEl.innerHTML = alunos.map(a => {
            const { positivo = 0, atencao = 0, grave = 0 } = a.ocorrencias || {};
            const badges = [
                positivo > 0 ? `<span class="fai-badge fai-pos" title="${positivo} positiv${positivo===1?'a':'as'}">✅ ${positivo}</span>` : '',
                atencao  > 0 ? `<span class="fai-badge fai-atencao" title="${atencao} atenção">⚠️ ${atencao}</span>` : '',
                grave    > 0 ? `<span class="fai-badge fai-grave" title="${grave} grav${grave===1?'e':'es'}">❌ ${grave}</span>` : '',
            ].filter(Boolean).join('');

            return `<button class="ficha-aluno-item" data-cod="${a.codMatrizAluno}"
                        onclick="selecionarAluno(${a.codMatrizAluno})"
                        title="${escHtml(a.nome)}">
                <div class="fai-linha1">
                    ${a.numchamada ? `<span class="fai-num">Nº ${a.numchamada}</span>` : ''}
                    <span class="fai-nome">${escHtml(a.nome)}</span>
                </div>
                ${badges ? `<div class="fai-badges">${badges}</div>` : ''}
            </button>`;
        }).join('');

    } catch (e) {
        listEl.innerHTML = `<div class="ficha-lista-placeholder" style="color:#dc2626">Erro: ${escHtml(e.message)}</div>`;
    }
}

async function selecionarAluno(codMatrizAluno) {
    /* Destaca na lista */
    document.querySelectorAll('.ficha-aluno-item').forEach(btn => {
        btn.classList.toggle('ativo', btn.dataset.cod == codMatrizAluno);
    });

    /* Mostra spinner no painel direito */
    document.getElementById('fichaHeader').innerHTML = `
        <div class="ficha-header-info">
            <div class="ficha-loading">
                <div class="spinner"></div>
                <p>Carregando ficha…</p>
            </div>
        </div>`;
    document.getElementById('fichaConteudo').innerHTML = '';

    /* No mobile, rola para o painel da ficha */
    document.querySelector('.ficha-detalhe-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    await carregarFicha(codMatrizAluno);
}

/* ── Carregamento da ficha (compartilhado pelos dois modos) ────────────────── */

async function carregarFicha(codMatrizAluno) {
    try {
        const r = await fetch(`${API}/api/ficha-aluno?codMatrizAluno=${encodeURIComponent(codMatrizAluno)}`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.erro || `Erro ${r.status}`);
        }
        const dados = await r.json();
        renderFicha(dados);
    } catch (e) {
        document.getElementById('fichaHeader').innerHTML = '';
        document.getElementById('fichaConteudo').innerHTML = `
            <div class="ficha-secao">
                <div class="ficha-secao-corpo">
                    <div class="ficha-aviso">❌ Erro ao carregar ficha: ${escHtml(e.message)}</div>
                </div>
            </div>`;
    }
}

/* ── Busca por nome (cross-turma) ──────────────────────────────────────────── */

function ocultarResultados() {
    const el = document.getElementById('fichaBuscaResultados');
    if (el) { el.hidden = true; el.innerHTML = ''; }
}

async function buscarAlunos(termo) {
    const resultadosEl = document.getElementById('fichaBuscaResultados');
    if (!resultadosEl) return;

    resultadosEl.hidden = false;
    resultadosEl.innerHTML = `<div class="ficha-busca-carregando">Buscando...</div>`;

    try {
        const r = await fetch(`${API}/api/alunos?search=${encodeURIComponent(termo)}`);
        if (!r.ok) throw new Error(`Erro ${r.status}`);
        const alunos = await r.json();

        if (!alunos || alunos.length === 0) {
            resultadosEl.innerHTML = `<div class="ficha-busca-vazio">Nenhum aluno encontrado para "<strong>${escHtml(termo)}</strong>".</div>`;
            return;
        }

        resultadosEl.innerHTML = alunos.map(a => `
            <button class="ficha-busca-item" data-cod="${escHtml(String(a.codmatrizaluno || ''))}" type="button">
                <span class="ficha-busca-item-nome">${highlightMatch(a.nome, termo)}</span>
                <span class="ficha-busca-item-turma">${escHtml(a.turma || '—')}</span>
            </button>
        `).join('');

        resultadosEl.querySelectorAll('.ficha-busca-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const cod = btn.dataset.cod;
                if (!cod) return;
                ocultarResultados();
                selecionarAluno(parseInt(cod, 10));
            });
        });
    } catch (e) {
        resultadosEl.innerHTML = `<div class="ficha-busca-vazio">Erro ao buscar: ${escHtml(e.message)}</div>`;
    }
}

/* ── Renderização ──────────────────────────────────────────────────────────── */

function renderFicha(dados) {
    const { aluno, frequencias, ocorrencias, observacoes, emprestimos, geradoEm } = dados;

    document.title = `Ficha — ${aluno.nome}`;
    document.getElementById('fichaHeader').innerHTML = `
        <div class="ficha-header-info">
            <h1 class="ficha-aluno-nome">${escHtml(aluno.nome)}</h1>
            <div class="ficha-meta">
                ${aluno.turma      ? `<span class="ficha-meta-item">🏫 ${escHtml(aluno.turma)}</span>` : ''}
                ${aluno.numchamada ? `<span class="ficha-meta-item">📋 Nº ${aluno.numchamada}</span>` : ''}
                ${aluno.codMatrizAluno ? `<span class="ficha-meta-item">🆔 Matrícula ${aluno.codMatrizAluno}</span>` : ''}
            </div>
        </div>
        <div class="ficha-header-actions">
            <span class="ficha-data-geracao">Gerado em ${formatarData(geradoEm)}</span>
            <button class="btn-imprimir" onclick="window.print()">🖨️ Imprimir / PDF</button>
        </div>`;

    document.getElementById('fichaConteudo').innerHTML =
        renderSecaoFrequencias(frequencias) +
        renderSecaoOcorrencias(ocorrencias) +
        renderSecaoObservacoes(observacoes) +
        renderSecaoEmprestimos(emprestimos) +
        `<div class="ficha-print-footer">Gerado pelo EduSync em ${formatarData(geradoEm)} — Ficha do aluno: ${escHtml(aluno.nome)}</div>`;
}

function renderSecaoFrequencias(frequencias) {
    let corpo = '';
    if (frequencias === null) {
        corpo = `<div class="ficha-aviso">⚠️ Frequências indisponíveis — o token RCO não está ativo para esta sessão.</div>`;
    } else if (!frequencias || frequencias.length === 0) {
        corpo = `<div class="ficha-vazio">Nenhuma frequência encontrada para este aluno.</div>`;
    } else {
        corpo = frequencias.map(f => {
            const pct = f.percentual;
            let pctClass = 'freq-pct-ok';
            if (pct !== null && pct < 75)  pctClass = 'freq-pct-critico';
            else if (pct !== null && pct < 85) pctClass = 'freq-pct-alerta';

            const corpo = f.semDados
                ? `<div class="freq-sem-dados">Nenhuma frequência registrada ainda nesta disciplina.</div>`
                : `<table class="freq-table">
                    <thead>
                        <tr>
                            <th>Total de Aulas</th>
                            <th>Presenças</th>
                            <th>Faltas</th>
                            <th>% Presença</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>${f.totalAulas}</td>
                            <td style="color:#16a34a">${f.presencas}</td>
                            <td style="color:#dc2626">${f.faltas}</td>
                            <td><span class="freq-pct ${pctClass}">${pct !== null ? pct + '%' : '—'}</span></td>
                        </tr>
                    </tbody>
                </table>`;

            return `
            <div class="freq-disciplina${f.semDados ? ' freq-disciplina-sem-dados' : ''}">
                <div class="freq-disciplina-nome">📖 ${escHtml(f.nomeDisciplina)}</div>
                ${corpo}
            </div>`;
        }).join('');
    }

    return `
    <div class="ficha-secao">
        <div class="ficha-secao-titulo"><span class="secao-icone">📊</span> Frequências por Disciplina</div>
        <div class="ficha-secao-corpo">${corpo}</div>
    </div>`;
}

function renderSecaoOcorrencias(ocorrencias) {
    let corpo = '';
    if (!ocorrencias || ocorrencias.length === 0) {
        corpo = `<div class="ficha-vazio">Nenhuma ocorrência de comportamento registrada.</div>`;
    } else {
        const grupos = {};
        for (const o of ocorrencias) {
            const turma = o.nome_turma || `Turma ${o.cod_turma || 'desconhecida'}`;
            if (!grupos[turma]) grupos[turma] = [];
            grupos[turma].push(o);
        }

        const turmaNomes = Object.keys(grupos);
        const multiplas = turmaNomes.length > 1;

        for (const turma of turmaNomes) {
            if (multiplas) {
                corpo += `<div class="ocorr-grupo-titulo">🏫 ${escHtml(turma)}</div>`;
            }
            for (const o of grupos[turma]) {
                const icone = o.tipo === 'positivo' ? '✅' : o.tipo === 'atencao' ? '⚠️' : '❌';
                const ptsSign = o.pontos > 0 ? '+' : '';
                const ptsClass = `pts-${o.tipo === 'grave' ? 'grave' : o.tipo}`;
                corpo += `
                <div class="ocorr-item ${escHtml(o.tipo)}">
                    <span class="ocorr-icone">${icone}</span>
                    <div class="ocorr-info">
                        <div class="ocorr-cat">${escHtml(o.categoria_label || o.categoria)}</div>
                        <div class="ocorr-meta">
                            <span>📅 ${formatarData(o.data)}</span>
                            ${o.professor_nome ? `<span>👤 ${escHtml(o.professor_nome)}</span>` : ''}
                            ${!multiplas && o.nome_turma ? `<span>🏫 ${escHtml(o.nome_turma)}</span>` : ''}
                        </div>
                        ${o.descricao ? `<div class="ocorr-desc">${escHtml(o.descricao)}</div>` : ''}
                    </div>
                    <span class="ocorr-pts ${ptsClass}">${ptsSign}${o.pontos}</span>
                </div>`;
            }
        }
    }

    return `
    <div class="ficha-secao">
        <div class="ficha-secao-titulo"><span class="secao-icone">📋</span> Ocorrências de Comportamento (${ocorrencias?.length || 0})</div>
        <div class="ficha-secao-corpo">${corpo}</div>
    </div>`;
}

function renderSecaoObservacoes(observacoes) {
    let corpo = '';
    if (!observacoes || observacoes.length === 0) {
        corpo = `<div class="ficha-vazio">Nenhuma observação pedagógica do RCO registrada.</div>`;
    } else {
        const grupos = {};
        for (const o of observacoes) {
            const chave = o.nome_disciplina || `Classe ${o.cod_classe || '?'}`;
            if (!grupos[chave]) grupos[chave] = [];
            grupos[chave].push(o);
        }

        for (const [chave, obs] of Object.entries(grupos)) {
            corpo += `<div class="obs-grupo">
                <span class="obs-grupo-titulo">📝 ${escHtml(chave)}</span>`;
            for (const o of obs) {
                corpo += `
                <div class="obs-item">
                    <span class="obs-data">${formatarData(o.data_aula)}</span>
                    <span class="obs-texto">${escHtml(o.observacao)}</span>
                </div>`;
            }
            corpo += `</div>`;
        }
    }

    return `
    <div class="ficha-secao">
        <div class="ficha-secao-titulo"><span class="secao-icone">📝</span> Observações do RCO</div>
        <div class="ficha-secao-corpo">${corpo}</div>
    </div>`;
}

function renderSecaoEmprestimos(emprestimos) {
    let corpo = '';
    if (!emprestimos || emprestimos.length === 0) {
        corpo = `<div class="ficha-vazio">Nenhum empréstimo de livro registrado.</div>`;
    } else {
        const linhas = emprestimos.map(e => {
            const statusLabel = { emprestado: 'Emprestado', devolvido: 'Devolvido', perdido: 'Perdido' }[e.status] || e.status;
            const statusClass = `emp-status-${e.status}`;
            return `
            <tr>
                <td>${escHtml(e.livro_titulo || '—')}</td>
                <td>${escHtml(e.livro_disciplina || '—')}</td>
                <td>${formatarDataHora(e.data_emprestimo)}</td>
                <td>${e.data_devolucao ? formatarDataHora(e.data_devolucao) : '—'}</td>
                <td><span class="emp-status ${statusClass}">${statusLabel}</span></td>
            </tr>`;
        }).join('');

        corpo = `
        <table class="emp-table">
            <thead>
                <tr>
                    <th>Título</th>
                    <th>Disciplina</th>
                    <th>Emprestado em</th>
                    <th>Devolvido em</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>${linhas}</tbody>
        </table>`;
    }

    return `
    <div class="ficha-secao">
        <div class="ficha-secao-titulo"><span class="secao-icone">📚</span> Histórico de Empréstimos</div>
        <div class="ficha-secao-corpo">${corpo}</div>
    </div>`;
}

init();
