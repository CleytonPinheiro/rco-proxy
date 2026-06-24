// ── Ficha Completa do Aluno ───────────────────────────────────────────────────

const API = '';

/* ── Estado de multi-seleção ─────────────────────────────────────────────────*/
window._fichaMultiMode      = false;
window._fichaAlunosSelecionados = new Set();

/* ── Cache de turmas para filtragem por curso ────────────────────────────── */
let _fichaTodasTurmas = [];

function _extrairCurso(turma) {
    const p = (turma || '').split(' - ');
    return p.length > 1 ? p[0].trim() : (turma || '').trim();
}

function _extrairTurno(turma) {
    const p = (turma || '').split(' - ');
    return p.length > 1 ? p.slice(1).join(' - ').trim() : (turma || '').trim();
}

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

async function sincronizarTurma() {
    const sel = document.getElementById('fichaTurmaSelect');
    const btn = document.getElementById('fichaSyncBtn');
    if (!sel || !sel.value) {
        notificar('Selecione uma turma', 'Escolha a turma no seletor acima antes de sincronizar a listagem de alunos.', { tipo: 'info', icone: '📋', okLabel: 'Entendido' });
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
        const r = await fetch(`${API}/api/sync/force`, { method: 'POST' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await carregarAlunos(sel.value);
        toast('Turma sincronizada com sucesso!', 'ok');
    } catch (e) {
        notificar('Erro ao sincronizar', e.message, { tipo: 'danger', icone: '❌', okLabel: 'Fechar' });
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄'; }
    }
}

async function carregarTurmas() {
    const selCurso = document.getElementById('fichaCursoSelect');
    const selTurma = document.getElementById('fichaTurmaSelect');

    /* Inicializa custom selects ANTES do fetch para que o MutationObserver
       esteja no lugar quando o innerHTML mudar depois. O WeakMap impede
       dupla inicialização se carregarTurmas for chamado mais de uma vez. */
    if (window.createCustomSelect) {
        createCustomSelect(selCurso);
        createCustomSelect(selTurma);
    }

    selCurso.addEventListener('change', _onFichaCursoChange);
    selTurma.addEventListener('change', _onFichaTurmaChange);

    try {
        const r = await fetch(`${API}/api/alunos/turmas/lista`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        let turmas = await r.json();

        /* Filtra pela escola selecionada no menu principal */
        try {
            const raw = localStorage.getItem('edusync_escola_codturmas');
            if (raw) {
                const codturmasFiltro = JSON.parse(raw);
                if (Array.isArray(codturmasFiltro) && codturmasFiltro.length > 0)
                    turmas = turmas.filter(t => codturmasFiltro.includes(t.codturma));
            }
        } catch {}

        if (!turmas || turmas.length === 0) {
            selCurso.innerHTML = '<option value="">Nenhum curso encontrado</option>';
            if (window.refreshCustomSelect) refreshCustomSelect(selCurso);
            return;
        }

        _fichaTodasTurmas = turmas;

        /* Cursos únicos extraídos da parte antes do " - " no nome da turma */
        const cursosSet = new Set(turmas.map(t => _extrairCurso(t.turma)));
        const cursos = [...cursosSet].sort((a, b) => a.localeCompare(b, 'pt-BR'));

        selCurso.innerHTML = '<option value="">Selecione o curso…</option>' +
            cursos.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');

        selTurma.innerHTML = '<option value="">← Selecione o curso acima</option>';
        selTurma.disabled = true;

        /* Força atualização do display text — o MutationObserver faz isso
           automaticamente mas chamar refreshCustomSelect garante sincronia. */
        if (window.refreshCustomSelect) {
            refreshCustomSelect(selCurso);
            refreshCustomSelect(selTurma);
        }

    } catch (e) {
        if (selCurso) {
            selCurso.innerHTML = '<option value="">Erro ao carregar cursos</option>';
            if (window.refreshCustomSelect) refreshCustomSelect(selCurso);
        }
    }
}

function _onFichaCursoChange() {
    const selCurso = document.getElementById('fichaCursoSelect');
    const selTurma = document.getElementById('fichaTurmaSelect');
    const curso = selCurso.value;

    if (!curso) {
        selTurma.innerHTML = '<option value="">← Selecione o curso acima</option>';
        selTurma.disabled = true;
        document.getElementById('fichaListaAlunos').innerHTML =
            '<div class="ficha-lista-placeholder">Selecione um curso e depois a turma.</div>';
        return;
    }

    const filtradas = _fichaTodasTurmas.filter(t => _extrairCurso(t.turma) === curso);
    selTurma.disabled = false;
    selTurma.innerHTML = '<option value="">Selecione a turma…</option>' +
        filtradas.map(t => {
            const label = _extrairTurno(t.turma);
            return `<option value="${escHtml(String(t.codturma))}">${escHtml(label)}</option>`;
        }).join('');

    document.getElementById('fichaListaAlunos').innerHTML =
        '<div class="ficha-lista-placeholder">Selecione uma turma para ver os alunos.</div>';

    if (window.refreshCustomSelect) refreshCustomSelect(selTurma);
}

function _onFichaTurmaChange() {
    const selTurma = document.getElementById('fichaTurmaSelect');
    if (selTurma.value) carregarAlunos(selTurma.value);
    else {
        document.getElementById('fichaListaAlunos').innerHTML =
            '<div class="ficha-lista-placeholder">Selecione uma turma para ver os alunos.</div>';
    }
}

async function carregarAlunos(codturma) {
    const listEl = document.getElementById('fichaListaAlunos');
    listEl.innerHTML = '<div class="ficha-lista-loading"><div class="spinner" style="width:22px;height:22px;margin:0 auto 6px"></div>Carregando alunos…</div>';

    try {
        const r = await fetch(`${API}/api/ficha-aluno/resumo-turma?codturma=${encodeURIComponent(codturma)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { alunos } = await r.json();

        /* DEBUG temporário — remover após confirmar correção */
        const comOcorr = (alunos || []).filter(a => {
            const { positivo=0, atencao=0, grave=0 } = a.ocorrencias || {};
            return (positivo + atencao + grave) > 0;
        });
        console.log('[FICHA-ALUNO] total alunos:', (alunos||[]).length,
                    '| com ocorrências:', comOcorr.length,
                    '| exemplos:', comOcorr.slice(0,3).map(a => `${a.nome}: ${JSON.stringify(a.ocorrencias)}`));

        if (!alunos || alunos.length === 0) {
            listEl.innerHTML = '<div class="ficha-lista-placeholder">Nenhum aluno encontrado nesta turma.</div>';
            return;
        }

        /* Ordena alfabeticamente */
        alunos.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));

        /* Ativa modo multi automaticamente ao carregar turma */
        window._fichaMultiMode = true;
        window._fichaAlunosSelecionados = new Set();
        listEl.classList.add('multi-mode');

        // Guarda mapa de atas impressas para uso no aviso de re-impressão
        window._atasImpressasMap = {};
        for (const a of alunos) {
            if (a.atasImpressas) window._atasImpressasMap[a.codMatrizAluno] = a.atasImpressas;
        }

        listEl.innerHTML = alunos.map(a => {
            const { positivo = 0, atencao = 0, grave = 0 } = a.ocorrencias || {};
            const totalOcc = positivo + atencao + grave;
            const ai = a.atasImpressas;
            const dataImp = ai?.ultimaImpressao
                ? new Date(ai.ultimaImpressao).toLocaleDateString('pt-BR')
                : null;
            const tooltipImp = ai
                ? `🖨️ ${ai.qtd} ata${ai.qtd !== 1 ? 's' : ''} já impressa${ai.qtd !== 1 ? 's' : ''}${dataImp ? ' — última em ' + dataImp : ''}${ai.impressaPor ? ' por ' + ai.impressaPor : ''}`
                : '';

            /* Badge de total de ocorrências ao lado do nome */
            let tooltipTotal = '';
            if (totalOcc > 0) {
                const partes = [];
                if (positivo > 0) partes.push(`✅ ${positivo} positiv${positivo===1?'a':'as'}`);
                if (atencao  > 0) partes.push(`⚠️ ${atencao} atenção`);
                if (grave    > 0) partes.push(`❌ ${grave} grav${grave===1?'e':'es'}`);
                tooltipTotal = `${totalOcc} ocorrência${totalOcc===1?'':'s'} — ${partes.join(', ')}`;
            }
            const badgeTotal = totalOcc > 0
                ? `<span class="fai-total-occ${grave > 0 ? ' fai-tot-grave' : atencao > 0 ? ' fai-tot-atencao' : ' fai-tot-pos'}" title="${escHtml(tooltipTotal)}">📋 ${totalOcc}</span>`
                : '';

            const badges = [
                ai       ? `<span class="fai-badge fai-impressa" title="${escHtml(tooltipImp)}">🖨️ ${ai.qtd}</span>` : '',
                positivo > 0 ? `<span class="fai-badge fai-pos" title="${positivo} positiv${positivo===1?'a':'as'}">✅ ${positivo}</span>` : '',
                atencao  > 0 ? `<span class="fai-badge fai-atencao" title="${atencao} atenção">⚠️ ${atencao}</span>` : '',
                grave    > 0 ? `<span class="fai-badge fai-grave" title="${grave} grav${grave===1?'e':'es'}">❌ ${grave}</span>` : '',
            ].filter(Boolean).join('');

            return `<div class="fai-item-wrap">
                <input type="checkbox" class="fai-check" id="faic-${a.codMatrizAluno}"
                       onchange="toggleAlunoSelecao(${a.codMatrizAluno}, this.checked)">
                <button class="ficha-aluno-item${ai ? ' fai-tem-impressa' : ''}" data-cod="${a.codMatrizAluno}"
                        onclick="selecionarAluno(${a.codMatrizAluno})"
                        title="${escHtml(a.nome)}">
                    <div class="fai-linha1">
                        ${a.numchamada ? `<span class="fai-num">Nº ${a.numchamada}</span>` : ''}
                        <span class="fai-nome">${escHtml(a.nome)}</span>
                        ${badgeTotal}
                    </div>
                    ${badges ? `<div class="fai-badges">${badges}</div>` : ''}
                </button>
            </div>`;
        }).join('');

        /* Mostra barra de ação agora que há alunos */
        updateBatchBtn();

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

/* ── Multi-seleção ─────────────────────────────────────────────────────────── */

function toggleMultiMode() {
    /* Modo multi sempre ligado — limpa seleção ao clicar no botão de sync */
    window._fichaMultiMode = true;
    window._fichaAlunosSelecionados = new Set();

    const masterCheck = document.getElementById('fichaSelectAllCheck');
    if (masterCheck)  { masterCheck.checked = false; masterCheck.indeterminate = false; }

    document.querySelectorAll('.fai-check').forEach(c => { c.checked = false; });
    document.querySelectorAll('.ficha-aluno-item').forEach(b => b.classList.remove('selecionado'));

    updateBatchBtn();
}

function toggleAlunoSelecao(codMatrizAluno, selecionado) {
    if (selecionado) {
        window._fichaAlunosSelecionados.add(codMatrizAluno);
    } else {
        window._fichaAlunosSelecionados.delete(codMatrizAluno);
    }
    /* Destaque visual no botão */
    const btn = document.querySelector(`.ficha-aluno-item[data-cod="${codMatrizAluno}"]`);
    if (btn) btn.classList.toggle('selecionado', selecionado);
    updateBatchBtn();
}

function updateBatchBtn() {
    const bar       = document.getElementById('fichaBatchBar');
    const contador  = document.getElementById('fichaBatchContador');
    const n         = window._fichaAlunosSelecionados?.size ?? 0;

    if (!bar) return;
    const hasAlunos = document.querySelectorAll('.fai-check').length > 0;
    bar.style.display = hasAlunos ? 'flex' : 'none';
    if (contador) contador.textContent = n > 0 ? `${n} selecionado${n !== 1 ? 's' : ''}` : '';
    const gerarBtn  = document.getElementById('fichaBatchBtn');
    if (gerarBtn) gerarBtn.disabled = n === 0;

    const total = document.querySelectorAll('.fai-check').length;

    /* Sincroniza checkbox mestre */
    const masterCheck = document.getElementById('fichaSelectAllCheck');
    const textoMaster = document.getElementById('fichaSelectAllTexto');
    if (masterCheck) {
        const todosMarc = total > 0 && n === total;
        masterCheck.checked       = todosMarc;
        masterCheck.indeterminate = n > 0 && !todosMarc;
        if (textoMaster) textoMaster.textContent = todosMarc ? 'Desmarcar todos' : 'Selecionar todos';
    }

    /* Atualiza botão "Todos / Nenhum" na barra */
    const todosBtn = document.getElementById('fichaBatchTodosBtn');
    if (todosBtn) {
        const todosMarc = total > 0 && n === total;
        todosBtn.textContent = todosMarc ? '✕ Nenhum' : '☑ Todos';
        todosBtn.classList.toggle('todos-ativo', todosMarc);
        todosBtn.title = todosMarc ? 'Desmarcar todos os alunos' : 'Selecionar todos os alunos da turma';
    }
}

function selecionarTodos(forceState) {
    const checkboxes = Array.from(document.querySelectorAll('.fai-check'));
    const n          = window._fichaAlunosSelecionados?.size ?? 0;
    const marcarTudo = (typeof forceState === 'boolean') ? forceState : n < checkboxes.length;

    checkboxes.forEach(cb => {
        const cod = parseInt(cb.id.replace('faic-', ''), 10);
        if (isNaN(cod)) return;
        cb.checked = marcarTudo;
        if (marcarTudo) {
            window._fichaAlunosSelecionados.add(cod);
        } else {
            window._fichaAlunosSelecionados.delete(cod);
        }
        const item = document.querySelector(`.ficha-aluno-item[data-cod="${cod}"]`);
        if (item) item.classList.toggle('selecionado', marcarTudo);
    });

    updateBatchBtn();
}

async function gerarTermosBatch(btn) {
    const selecionados = Array.from(window._fichaAlunosSelecionados || []);
    if (selecionados.length === 0) {
        notificar('Nenhum aluno selecionado', 'Marque ao menos um aluno na lista antes de gerar o PDF em lote.', { tipo: 'info', icone: '☑️', okLabel: 'Entendido' });
        return;
    }

    // Verifica se algum selecionado já tem atas impressas
    const mapa = window._atasImpressasMap || {};
    const comImpressas = selecionados.filter(cod => mapa[cod]?.qtd > 0);
    if (comImpressas.length > 0) {
        const linhas = comImpressas.slice(0, 5).map(cod => {
            const ai = mapa[cod];
            const nomeEl = document.querySelector(`.ficha-aluno-item[data-cod="${cod}"] .fai-nome`);
            const nome = nomeEl?.textContent?.trim() || `Aluno #${cod}`;
            const data = ai.ultimaImpressao
                ? new Date(ai.ultimaImpressao).toLocaleDateString('pt-BR')
                : null;
            return `• ${nome} — ${ai.qtd} ata${ai.qtd !== 1 ? 's' : ''} impressa${ai.qtd !== 1 ? 's' : ''}${data ? ' em ' + data : ''}`;
        });
        if (comImpressas.length > 5) linhas.push(`  ...e mais ${comImpressas.length - 5} aluno(s)`);
        const ok = await confirmar(
            linhas.join('\n'),
            { titulo: `⚠️ ${comImpressas.length} aluno${comImpressas.length !== 1 ? 's' : ''} com atas já impressas`, confirmLabel: 'Imprimir mesmo assim', tipo: 'danger' }
        );
        if (!ok) return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando…'; }
    try {
        const r = await fetch('/api/relatorio-ocorrencias/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codMatrizes: selecionados }),
        });
        if (r.status === 204) {
            notificar('Sem ocorrências', 'Nenhum dos alunos selecionados possui ocorrências ou observações registradas para os filtros informados.', { tipo: 'info', icone: '📋', okLabel: 'OK' });
            return;
        }
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.erro || `Erro ${r.status}`);
        }
        const blob   = await r.blob();
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, '_blank');
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
        toast(`PDF aberto em nova aba — ${selecionados.length} aluno${selecionados.length !== 1 ? 's' : ''}!`, 'ok');
    } catch (e) {
        notificar('Erro ao gerar PDF', e.message, { tipo: 'danger', icone: '❌', okLabel: 'Fechar' });
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📄 Gerar PDF'; }
        updateBatchBtn();
    }
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
        // Carrega professores distintos para o select de filtro (em background)
        if (dados.ocorrencias && dados.ocorrencias.length > 0) {
            carregarProfessoresTermo(codMatrizAluno).then(profs => {
                const sel = document.getElementById('termoProfessor');
                if (!sel || !profs.length) return;
                profs.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
                    sel.appendChild(opt);
                });
                /* Atualiza o painel do custom-select com as novas opções */
                if (window.refreshCustomSelect) refreshCustomSelect(sel);
            });
        }
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

function buildTermoUrl(codMatrizAluno, filtros) {
    const params = new URLSearchParams();
    if (filtros?.de)        params.set('de',        filtros.de);
    if (filtros?.ate)       params.set('ate',        filtros.ate);
    if (filtros?.tipo)      params.set('tipo',       filtros.tipo);
    if (filtros?.professor) params.set('professor',  filtros.professor);
    const qs = params.toString();
    return `/api/relatorio-ocorrencias/${codMatrizAluno}${qs ? '?' + qs : ''}`;
}

async function carregarProfessoresTermo(codMatrizAluno) {
    try {
        const r = await fetch(`/api/relatorio-ocorrencias/${codMatrizAluno}/professores`);
        if (!r.ok) return [];
        return await r.json();
    } catch { return []; }
}

// ── Visor de PDF inline ───────────────────────────────────────────────────────
let _termoBlobUrl = null;

function fecharTermoViewer() {
    const v = document.getElementById('fichaTermoViewer');
    if (v) v.remove();
    if (_termoBlobUrl) { URL.revokeObjectURL(_termoBlobUrl); _termoBlobUrl = null; }
}

function _abrirTermoViewer(blobUrl, nomeAluno) {
    fecharTermoViewer();
    _termoBlobUrl = blobUrl;

    const detalhe = document.querySelector('.ficha-detalhe-panel');
    if (!detalhe) { window.open(blobUrl, '_blank'); return; }

    const viewer = document.createElement('div');
    viewer.id = 'fichaTermoViewer';
    viewer.className = 'ficha-termo-viewer';
    viewer.innerHTML = `
        <div class="ficha-termo-viewer-bar">
            <span class="ficha-termo-viewer-titulo">📄 Termos de Ocorrência${nomeAluno ? ' — ' + nomeAluno : ''}</span>
            <div class="ficha-termo-viewer-acoes">
                <a href="${blobUrl}" download="termos-ocorrencias.pdf" class="ficha-termo-viewer-dl" title="Baixar PDF">⬇ Baixar</a>
                <button class="ficha-termo-viewer-fs" title="Abrir em tela cheia" onclick="window.open('${blobUrl}','_blank')">⛶ Tela cheia</button>
                <button class="ficha-termo-viewer-close" title="Fechar visor" onclick="fecharTermoViewer()">✕</button>
            </div>
        </div>
        <iframe src="${blobUrl}" class="ficha-termo-viewer-iframe" title="PDF Termos de Ocorrência"></iframe>`;

    detalhe.insertBefore(viewer, detalhe.firstChild);
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function gerarTermoPDF(codMatrizAluno, btn) {
    const de        = document.getElementById('termoDe')?.value        || '';
    const ate       = document.getElementById('termoAte')?.value       || '';
    const tipo      = document.getElementById('termoTipo')?.value      || '';
    const professor = document.getElementById('termoProfessor')?.value || '';
    const url       = buildTermoUrl(codMatrizAluno, { de, ate, tipo, professor });
    const nomeAluno = document.querySelector('.ficha-aluno-nome')?.textContent?.trim() || '';

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando PDF…'; }
    try {
        const r = await fetch(url);
        if (r.status === 204) {
            notificar('Sem ocorrências', 'Nenhuma ocorrência ou observação encontrada para os filtros informados. Tente ampliar o período ou remover filtros.', { tipo: 'info', icone: '📋', okLabel: 'OK' });
            return;
        }
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.erro || `Erro ${r.status}`);
        }
        const blob   = await r.blob();
        const objUrl = URL.createObjectURL(blob);
        _abrirTermoViewer(objUrl, nomeAluno);
    } catch (e) {
        notificar('Erro ao gerar PDF', e.message, { tipo: 'danger', icone: '❌', okLabel: 'Fechar' });
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📄 Gerar Termos PDF'; }
    }
}

function renderFicha(dados) {
    const { aluno, frequencias, ocorrencias, observacoes, emprestimos, geradoEm,
            escolaLogo, escolaNome } = dados;

    const btnTermoHtml = `
        <div class="ficha-termo-controles" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px">
            <input type="date" id="termoDe"  title="Data inicial (opcional)"
                   style="padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:.8rem;background:var(--bg-input);color:var(--text-primary)" />
            <span style="font-size:.8rem;color:var(--text-muted)">até</span>
            <input type="date" id="termoAte" title="Data final (opcional)"
                   style="padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:.8rem;background:var(--bg-input);color:var(--text-primary)" />
            <select id="termoTipo" style="padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:.8rem;background:var(--bg-input);color:var(--text-primary)">
                <option value="">Todos os tipos</option>
                <option value="grave">Grave</option>
                <option value="atencao">Atenção</option>
                <option value="positivo">Positivo</option>
            </select>
            <select id="termoProfessor" title="Filtrar por professor"
                    style="padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:.8rem;background:var(--bg-input);color:var(--text-primary)">
                <option value="">Todos os professores</option>
            </select>
            <button id="btnGerarTermo" class="btn-imprimir"
                    onclick="gerarTermoPDF(${aluno.codMatrizAluno}, this)"
                    style="background:#dc2626;color:#fff;border-color:#dc2626">📄 Gerar Termos PDF</button>
        </div>`;

    document.title = `Ficha — ${aluno.nome}`;
    document.getElementById('fichaHeader').innerHTML = `
        <div class="ficha-header-info">
            <h1 class="ficha-aluno-nome">${escHtml(aluno.nome)}</h1>
            <div class="ficha-meta">
                ${aluno.turma      ? `<span class="ficha-meta-item">🏫 ${escHtml(aluno.turma)}</span>` : ''}
                ${aluno.numchamada ? `<span class="ficha-meta-item">📋 Nº ${aluno.numchamada}</span>` : ''}
                ${aluno.codMatrizAluno ? `<span class="ficha-meta-item">🆔 Matrícula ${aluno.codMatrizAluno}</span>` : ''}
            </div>
            ${btnTermoHtml}
        </div>
        <div class="ficha-header-actions">
            ${(escolaLogo || escolaNome) ? `
            <div class="ficha-escola-bloco">
                ${escolaLogo ? `<img class="ficha-escola-logo" src="${escolaLogo}" alt="Logo da escola">` : ''}
                ${escolaNome ? `<div class="ficha-escola-nome">${escHtml(escolaNome)}</div>` : ''}
            </div>` : ''}
            <span class="ficha-data-geracao">Gerado em ${formatarData(geradoEm)}</span>
            <button class="btn-imprimir" onclick="window.print()">🖨️ Imprimir / PDF</button>
        </div>`;

    /* Converte os selects de filtro de termo para custom-select */
    if (window.createCustomSelect) {
        const sTipo = document.getElementById('termoTipo');
        const sProf = document.getElementById('termoProfessor');
        if (sTipo) createCustomSelect(sTipo);
        if (sProf) createCustomSelect(sProf);
    }

    document.getElementById('fichaConteudo').innerHTML =
        renderSecaoFrequencias(frequencias, ocorrencias) +
        renderSecaoObservacoes(observacoes, dados.todasDisciplinas) +
        renderSecaoEmprestimos(emprestimos) +
        renderSecaoOcorrencias(ocorrencias) +
        `<div class="ficha-print-footer">
            <div class="ficha-print-footer-esq">
                <span class="ficha-print-footer-sistema">⚡ EduSync</span>
                <span class="ficha-print-footer-sub">Sistema de Gestão Escolar — Paraná</span>
            </div>
            <div class="ficha-print-footer-dir">
                <span>📋 ${escHtml(aluno.nome)}</span>
                <span>🗓️ Gerado em ${formatarData(geradoEm)}</span>
            </div>
        </div>`;
}

/* Normaliza string para comparação de nomes de disciplina:
   remove acentos, lowercase, mantém apenas letras e números */
function normalizarDisciplina(str) {
    return (str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/* Retorna true se ocorrDisciplina corresponde (parcialmente) ao nome da disciplina RCO */
function disciplinaCorresponde(nomeDisciplina, ocorrDisciplina) {
    if (!ocorrDisciplina) return false;
    const nd = normalizarDisciplina(nomeDisciplina);
    const od = normalizarDisciplina(ocorrDisciplina);
    if (!nd || !od) return false;
    // Match bidirecional por substring (cobre "Lógica" ↔ "LOGICA COMPUTACIONAL")
    return nd.includes(od) || od.includes(nd);
}

function renderSecaoFrequencias(frequencias, ocorrencias) {
    let corpo = '';
    if (frequencias === null) {
        corpo = `<div class="ficha-aviso">⚠️ Frequências indisponíveis — o token RCO não está ativo para esta sessão.</div>`;
    } else if (!frequencias || frequencias.length === 0) {
        corpo = `<div class="ficha-vazio">Nenhuma frequência encontrada para este aluno.</div>`;
    } else {
        // Ocorrências com disciplina registrada (campo vindo de ocorrencia_meta)
        const ocorrComDisc = (ocorrencias || []).filter(o => o.disciplina);

        corpo = frequencias.map(f => {
            const pct = f.percentual;
            let pctClass = 'freq-pct-ok';
            if (pct !== null && pct < 75)  pctClass = 'freq-pct-critico';
            else if (pct !== null && pct < 85) pctClass = 'freq-pct-alerta';

            const freqHtml = f.semDados
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

            // Ocorrências que correspondem a esta disciplina
            const ocorrDisc = ocorrComDisc.filter(o => disciplinaCorresponde(f.nomeDisciplina, o.disciplina));
            let ocorrDiscHtml = '';
            if (ocorrDisc.length > 0) {
                const items = ocorrDisc.map(o => {
                    const icone = o.tipo === 'positivo' ? '✅' : o.tipo === 'atencao' ? '⚠️' : '❌';
                    const ptsSign = o.pontos > 0 ? '+' : '';
                    return `
                    <div class="freq-ocorr-item freq-ocorr-${o.tipo}">
                        <span class="freq-ocorr-icone">${icone}</span>
                        <div class="freq-ocorr-info">
                            <span class="freq-ocorr-cat">${escHtml(o.categoria_label || o.categoria)}</span>
                            <span class="freq-ocorr-data">📅 ${formatarData(o.data)}</span>
                            ${o.professor_nome ? `<span class="freq-ocorr-prof">👤 ${escHtml(o.professor_nome)}</span>` : ''}
                        </div>
                        <span class="freq-ocorr-pts freq-ocorr-pts-${o.tipo}">${ptsSign}${o.pontos}</span>
                    </div>`;
                }).join('');

                ocorrDiscHtml = `
                <div class="freq-ocorr-bloco">
                    <div class="freq-ocorr-titulo">📋 Ocorrências nesta disciplina (${ocorrDisc.length})</div>
                    ${items}
                </div>`;
            }

            return `
            <div class="freq-disciplina${f.semDados ? ' freq-disciplina-sem-dados' : ''}">
                <div class="freq-disciplina-nome">📖 ${escHtml(f.nomeDisciplina)}</div>
                ${freqHtml}
                ${ocorrDiscHtml}
            </div>`;
        }).join('');

        // Ocorrências com disciplina que não casou com nenhuma disciplina RCO
        const nomesRco = frequencias.map(f => f.nomeDisciplina);
        const ocorrSemMatch = ocorrComDisc.filter(o =>
            !nomesRco.some(nd => disciplinaCorresponde(nd, o.disciplina))
        );
        if (ocorrSemMatch.length > 0) {
            // Agrupar por disciplina digitada
            const grupos = {};
            for (const o of ocorrSemMatch) {
                const k = o.disciplina;
                if (!grupos[k]) grupos[k] = [];
                grupos[k].push(o);
            }
            const extras = Object.entries(grupos).map(([disc, items]) => {
                const rows = items.map(o => {
                    const icone = o.tipo === 'positivo' ? '✅' : o.tipo === 'atencao' ? '⚠️' : '❌';
                    const ptsSign = o.pontos > 0 ? '+' : '';
                    return `
                    <div class="freq-ocorr-item freq-ocorr-${o.tipo}">
                        <span class="freq-ocorr-icone">${icone}</span>
                        <div class="freq-ocorr-info">
                            <span class="freq-ocorr-cat">${escHtml(o.categoria_label || o.categoria)}</span>
                            <span class="freq-ocorr-data">📅 ${formatarData(o.data)}</span>
                            ${o.professor_nome ? `<span class="freq-ocorr-prof">👤 ${escHtml(o.professor_nome)}</span>` : ''}
                        </div>
                        <span class="freq-ocorr-pts freq-ocorr-pts-${o.tipo}">${ptsSign}${o.pontos}</span>
                    </div>`;
                }).join('');
                return `
                <div class="freq-disciplina freq-disciplina-sem-dados">
                    <div class="freq-disciplina-nome">📖 ${escHtml(disc)}</div>
                    <div class="freq-sem-dados">Frequência não vinculada ao RCO.</div>
                    <div class="freq-ocorr-bloco">
                        <div class="freq-ocorr-titulo">📋 Ocorrências (${items.length})</div>
                        ${rows}
                    </div>
                </div>`;
            }).join('');
            corpo += extras;
        }
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

function renderSecaoObservacoes(observacoes, todasDisciplinas) {
    let corpo = '';
    const obs = observacoes || [];

    if (todasDisciplinas && todasDisciplinas.length > 0) {
        /* Agrupa observações por cod_classe */
        const obsPorClasse = {};
        for (const o of obs) {
            const k = o.cod_classe;
            if (!obsPorClasse[k]) obsPorClasse[k] = [];
            obsPorClasse[k].push(o);
        }

        /* Disciplinas conhecidas */
        const classesConhecidas = new Set(todasDisciplinas.map(d => d.cod_classe));

        /* Exibe todas as disciplinas da turma */
        for (const disc of todasDisciplinas) {
            const discObs = obsPorClasse[disc.cod_classe] || [];
            corpo += `<div class="obs-grupo${discObs.length === 0 ? ' obs-grupo-vazio' : ''}">
                <span class="obs-grupo-titulo">📝 ${escHtml(disc.nome_disciplina)}</span>`;
            if (discObs.length > 0) {
                for (const o of discObs) {
                    corpo += `
                    <div class="obs-item">
                        <span class="obs-data">${formatarData(o.data_aula)}</span>
                        <span class="obs-texto">${escHtml(o.observacao)}</span>
                    </div>`;
                }
            } else {
                corpo += `<div class="obs-disc-vazia">Nenhuma observação registrada.</div>`;
            }
            corpo += `</div>`;
        }

        /* Observações cujo cod_classe não está nas disciplinas conhecidas */
        const obsOrfas = obs.filter(o => !classesConhecidas.has(o.cod_classe));
        if (obsOrfas.length > 0) {
            const grupos = {};
            for (const o of obsOrfas) {
                const chave = o.nome_disciplina || `Classe ${o.cod_classe || '?'}`;
                if (!grupos[chave]) grupos[chave] = [];
                grupos[chave].push(o);
            }
            for (const [chave, items] of Object.entries(grupos)) {
                corpo += `<div class="obs-grupo"><span class="obs-grupo-titulo">📝 ${escHtml(chave)}</span>`;
                for (const o of items) {
                    corpo += `
                    <div class="obs-item">
                        <span class="obs-data">${formatarData(o.data_aula)}</span>
                        <span class="obs-texto">${escHtml(o.observacao)}</span>
                    </div>`;
                }
                corpo += `</div>`;
            }
        }

        if (!corpo) {
            corpo = `<div class="ficha-vazio">Nenhuma observação pedagógica do RCO registrada.</div>`;
        }
    } else {
        /* Fallback: sem lista de disciplinas — agrupa pelo nome_disciplina da obs */
        if (obs.length === 0) {
            corpo = `<div class="ficha-vazio">Nenhuma observação pedagógica do RCO registrada.</div>`;
        } else {
            const grupos = {};
            for (const o of obs) {
                const chave = o.nome_disciplina || `Classe ${o.cod_classe || '?'}`;
                if (!grupos[chave]) grupos[chave] = [];
                grupos[chave].push(o);
            }
            for (const [chave, items] of Object.entries(grupos)) {
                corpo += `<div class="obs-grupo"><span class="obs-grupo-titulo">📝 ${escHtml(chave)}</span>`;
                for (const o of items) {
                    corpo += `
                    <div class="obs-item">
                        <span class="obs-data">${formatarData(o.data_aula)}</span>
                        <span class="obs-texto">${escHtml(o.observacao)}</span>
                    </div>`;
                }
                corpo += `</div>`;
            }
        }
    }

    return `
    <div class="ficha-secao">
        <div class="ficha-secao-titulo"><span class="secao-icone">📝</span> Observações do RCO</div>
        <div class="ficha-secao-corpo">${corpo}</div>
    </div>`;
}

function renderSecaoEmprestimos(emprestimos) {
    if (!emprestimos || emprestimos.length === 0) return '';
    let corpo = '';
    {
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
