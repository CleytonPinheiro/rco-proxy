// ── Ficha Completa do Aluno ───────────────────────────────────────────────────

const API = '';

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

async function init() {
    const params = new URLSearchParams(location.search);
    const codMatrizAluno = params.get('codMatrizAluno');

    if (!codMatrizAluno) {
        document.getElementById('fichaConteudo').innerHTML = `
            <div class="ficha-secao">
                <div class="ficha-secao-corpo">
                    <div class="ficha-aviso">⚠️ Nenhum aluno selecionado. Acesse esta página a partir do histórico de comportamento.</div>
                </div>
            </div>`;
        return;
    }

    try {
        const r = await fetch(`${API}/api/ficha-aluno?codMatrizAluno=${codMatrizAluno}`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.erro || `Erro ${r.status}`);
        }
        const dados = await r.json();
        renderFicha(dados);
    } catch (e) {
        document.getElementById('fichaConteudo').innerHTML = `
            <div class="ficha-secao">
                <div class="ficha-secao-corpo">
                    <div class="ficha-aviso">❌ Erro ao carregar ficha: ${escHtml(e.message)}</div>
                </div>
            </div>`;
    }
}

function renderFicha(dados) {
    const { aluno, frequencias, ocorrencias, observacoes, emprestimos, geradoEm } = dados;

    // Cabeçalho
    document.title = `Ficha — ${aluno.nome}`;
    document.getElementById('fichaHeader').innerHTML = `
        <div class="ficha-header-info">
            <h1 class="ficha-aluno-nome">${escHtml(aluno.nome)}</h1>
            <div class="ficha-meta">
                ${aluno.turma   ? `<span class="ficha-meta-item">🏫 ${escHtml(aluno.turma)}</span>` : ''}
                ${aluno.numchamada ? `<span class="ficha-meta-item">📋 Nº ${aluno.numchamada}</span>` : ''}
                ${aluno.codMatrizAluno ? `<span class="ficha-meta-item">🆔 Matrícula ${aluno.codMatrizAluno}</span>` : ''}
            </div>
        </div>
        <div class="ficha-header-actions">
            <span class="ficha-data-geracao">Gerado em ${formatarData(geradoEm)}</span>
            <button class="btn-imprimir" onclick="window.print()">🖨️ Imprimir / PDF</button>
        </div>`;

    // Seções
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

            return `
            <div class="freq-disciplina">
                <div class="freq-disciplina-nome">📖 ${escHtml(f.nomeDisciplina)}</div>
                <table class="freq-table">
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
                </table>
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
        // Agrupar por turma
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
        // Agrupar por disciplina (nome_disciplina enriquecido pelo backend)
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
