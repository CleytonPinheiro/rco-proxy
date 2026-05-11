'use strict';
/* Provas — UI do professor */

const $ = id => document.getElementById(id);

let cursos = [];
let cursoAtual = '';
let provas = [];
let provaAberta = null;
let _colaCarregada = false;
let _colaExpandido = null;
let _colaFlags = {};
let _renderColaTabela = null;

async function init() {
    await carregarCursos();
    /* mostra/esconde % foto conforme modo */
    $('prvfFoto').addEventListener('change', () => {
        $('prvfFotoPctWrap').style.display = $('prvfFoto').value === 'sorteio' ? '' : 'none';
    });
}

async function carregarCursos() {
    try {
        const r = await fetch('/api/classroom/courses', { credentials: 'include' });
        if (!r.ok) {
            $('prvCurso').innerHTML = '<option>Erro — conecte o Classroom primeiro</option>';
            return;
        }
        cursos = await r.json();
        const sel = $('prvCurso');
        sel.innerHTML = '<option value="">Selecione um curso…</option>' +
            cursos.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}${c.secao ? ' — ' + escapeHtml(c.secao) : ''}</option>`).join('');
    } catch (e) {
        console.error(e);
    }
}

async function onCursoChange() {
    cursoAtual = $('prvCurso').value;
    $('prvBtnNova').disabled = !cursoAtual;
    if (!cursoAtual) {
        $('prvLista').innerHTML = '<div class="prv-empty">Selecione um curso acima para ver as provas.</div>';
        return;
    }
    await carregarProvas();
}

async function carregarProvas() {
    $('prvLista').innerHTML = '<div class="prv-empty">Carregando…</div>';
    try {
        const r = await fetch(`/api/classroom/provas?courseId=${encodeURIComponent(cursoAtual)}&includeSuspiciousSummary=1`, { credentials: 'include' });
        const d = await r.json();
        provas = d.provas || [];
        if (provas.length === 0) {
            $('prvLista').innerHTML = '<div class="prv-empty">Nenhuma prova cadastrada neste curso. Clique em "+ Nova prova" para começar.</div>';
            return;
        }
        $('prvLista').innerHTML = provas.map(p => `
            <div class="prv-card" onclick="abrirDetalhe(${p.id})">
                <div class="prv-card-info">
                    <div class="prv-card-nome">${escapeHtml(p.nome)}
                        ${p.efetivada
                            ? '<span class="prv-badge prv-badge-efetiva">Efetivada</span>'
                            : '<span class="prv-badge prv-badge-rascunho">Rascunho</span>'}
                        ${p.segundo_corretor_ativo ? '<span class="prv-badge prv-badge-2cor">2º corretor</span>' : ''}
                        ${p.pares_suspeitos > 0 ? `<span class="prv-badge prv-badge-cola" title="Pares com ≥70% de similaridade — abra a aba Análise de Cola para detalhes">⚠️ ${p.pares_suspeitos} par${p.pares_suspeitos > 1 ? 'es' : ''} suspeito${p.pares_suspeitos > 1 ? 's' : ''}</span>` : ''}
                        ${p.pares_flagged > 0 ? `<span class="prv-badge prv-badge-flagged" title="Pares suspeitos já marcados pelo professor">🔍 ${p.pares_flagged} marcado${p.pares_flagged > 1 ? 's' : ''}</span>` : ''}
                    </div>
                    <div class="prv-card-meta">
                        <span>GradePen #${escapeHtml(p.gradepen_id)}</span>
                        <span>${p.data_aplicacao ? new Date(p.data_aplicacao).toLocaleDateString('pt-BR') : 'Sem data'}</span>
                        <span>${p.variantes_count} variante(s)</span>
                    </div>
                </div>
                <div class="prv-card-stats">
                    <div class="prv-stat">
                        <div class="prv-stat-num">${p.submissoes_count}</div>
                        <div class="prv-stat-lbl">corrigidas</div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        $('prvLista').innerHTML = `<div class="prv-empty">Erro: ${escapeHtml(e.message)}</div>`;
    }
}

function abrirNova() {
    $('prvfNome').value  = '';
    $('prvfAnsid').value = '';
    $('prvfData').value  = new Date().toISOString().slice(0,10);
    $('prvfFoto').value  = 'sorteio';
    $('prvfFotoPct').value = 20;
    $('prvfFotoPctWrap').style.display = '';
    $('prvfSegundo').checked = false;
    $('prvfOutraTurma').checked = false;
    $('prvfOutraTurmaWrap').style.display = 'none';
    $('prvNovaErro').style.display = 'none';
    $('prvModalNova').style.display = '';
}
function fecharNova() { $('prvModalNova').style.display = 'none'; }

async function salvarNova() {
    const body = {
        courseId:             cursoAtual,
        nome:                 $('prvfNome').value.trim(),
        gradepenId:           $('prvfAnsid').value.trim().split('.')[0],
        dataAplicacao:        $('prvfData').value || null,
        fotoModo:             $('prvfFoto').value,
        fotoSorteioPct:       parseInt($('prvfFotoPct').value, 10) || 20,
        segundoCorretorAtivo: $('prvfSegundo').checked,
        permitirOutraTurma:   $('prvfOutraTurma').checked,
    };
    if (!body.nome || !body.gradepenId) {
        return mostraErro('Preencha nome e ID GradePen.');
    }
    $('prvBtnSalvarNova').disabled = true;
    try {
        const r = await fetch('/api/classroom/provas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) {
            const msg = d.precisaGabaritoManual
                ? `Não consegui ler a GradePen (${d.detalhe || 'erro'}).\n\nVerifique se o ID está correto e se as credenciais GRADEPEN_EMAIL/GRADEPEN_PASSWORD foram configuradas no servidor.`
                : (d.erro || 'Erro ao cadastrar.');
            return mostraErro(msg);
        }
        fecharNova();
        await carregarProvas();
        await notificar('Prova cadastrada', `${d.variantes_count} variante(s) baixadas da GradePen.`, {tipo: 'ok'});
    } catch (e) {
        mostraErro(e.message);
    } finally {
        $('prvBtnSalvarNova').disabled = false;
    }
}

function mostraErro(msg) {
    $('prvNovaErro').textContent = msg;
    $('prvNovaErro').style.display = '';
}

async function abrirDetalhe(id) {
    try {
        const r = await fetch(`/api/classroom/provas/${id}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        provaAberta = d;
        renderDetalhe(d);
        $('prvModalDet').style.display = '';
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

function renderDetalhe(d) {
    const p = d.prova;
    $('prvDetNome').textContent = p.nome;
    $('prvDetMeta').innerHTML = `
        <span>📋 GradePen #${escapeHtml(p.gradepen_id)}</span>
        <span>📅 ${p.data_aplicacao ? new Date(p.data_aplicacao).toLocaleDateString('pt-BR') : 'Sem data'}</span>
        <span>📊 ${d.variantes.length} variantes • ${d.submissoes.filter(s=>!s.eh_segundo_corretor).length} alunos corrigiram</span>
        <span>📷 Foto: ${p.foto_modo}${p.foto_modo === 'sorteio' ? ` (${p.foto_sorteio_pct}%)` : ''}</span>
        <span>👁 2º corretor: ${p.segundo_corretor_ativo ? 'ativo' : 'desativado'}${p.segundo_corretor_ativo && p.permitir_outra_turma ? ' (cross-turma ON)' : ''}</span>
    `;
    $('prvDetCola').innerHTML = '<div class="prv-empty">Clique em <strong>🔍 Análise de Cola</strong> para carregar.</div>';
    _colaCarregada = false;
    _colaExpandido = null;
    _colaFlags = {};
    _renderColaTabela = null;
    prvAtivarAba('gabarito');

    /* Gabarito */
    let gab = `<h3>Gabarito por variante</h3>`;
    for (const v of d.variantes) {
        const linhas = (v.gabarito_json || []).map(q =>
            `<tr><td>${q.questao}</td><td><strong>${(q.correta || '?').toString().toUpperCase()}</strong></td><td>${(q.valor||0).toFixed(2)}</td></tr>`
        ).join('');
        gab += `<details><summary>Variante .${escapeHtml(v.codigo)} — ${v.gabarito_json.length} questões</summary>
            <table class="prv-tabela"><thead><tr><th>Q</th><th>Correta</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table>
        </details>`;
    }
    $('prvDetGabarito').innerHTML = gab;

    /* Submissões */
    const principais = d.submissoes.filter(s => !s.eh_segundo_corretor);
    const segundas   = d.submissoes.filter(s =>  s.eh_segundo_corretor);
    let sub = `<h3>Submissões dos alunos</h3>`;
    if (!p.efetivada) {
        sub += `<div class="prv-info-box">⚠️ <strong>As notas estão como rascunho.</strong> Quando estiver pronto, clique em <strong>"Efetivar notas"</strong> abaixo. Depois lance as notas no Classroom (ou use o botão <strong>📢 Publicar no Classroom</strong> que cria a atividade no grupo dedicado da avaliação).</div>`;
    }
    if (principais.length === 0) {
        sub += '<div class="prv-empty">Nenhum aluno corrigiu ainda.</div>';
    } else {
        const optsVar = d.variantes.map(v => `<option value="${v.id}">.${escapeHtml(v.codigo)}</option>`).join('');
        sub += `<table class="prv-tabela"><thead><tr>
            <th>Aluno</th><th>Variante</th><th>Quando</th><th>Flags</th><th class="prv-nota">Nota</th><th>Ações</th>
        </tr></thead><tbody>`;
        for (const s of principais) {
            const seg = segundas.find(x => x.submissao_ref_id === s.id);
            const flags = [];
            if (s.foto_obrigatoria && !s.foto_url) flags.push('<span class="prv-flag prv-flag-foto">SEM FOTO</span>');
            if (s.foto_url) {
                if (s.foto_conferida === 'ok') flags.push('<span class="prv-flag prv-flag-foto" style="background:#dcfce7;color:#166534">📷 ✅ confere</span>');
                else if (s.foto_conferida === 'divergente') flags.push('<span class="prv-flag prv-flag-foto" style="background:#fee2e2;color:#991b1b">📷 ⚠️ não confere</span>');
                else flags.push(`<button class="prv-link-acao prv-act-foto" data-sub="${s.id}" title="Conferir se a foto bate com as marcações enviadas">📷 conferir</button>`);
            }
            if (seg) {
                const div = Math.abs((seg.nota || 0) - (s.nota || 0));
                if (div > 0.01) flags.push(`<span class="prv-flag prv-flag-2cor">DIVERG ${div.toFixed(1)}</span>`);
                else flags.push('<span class="prv-flag prv-flag-2cor">2º ✓</span>');
            }
            const selVar = `<select id="prvVar_${s.id}" class="prv-sel-variante" title="Trocar variante recalcula a nota">
                ${d.variantes.map(v => `<option value="${v.id}" ${v.id===s.variante_id?'selected':''}>.${escapeHtml(v.codigo)}</option>`).join('')}
            </select>
            <button class="prv-link-acao prv-act-trocar" data-sub="${s.id}" title="Recalcula a nota com o gabarito da variante escolhida">↻</button>`;
            const acoes = [];
            if (p.segundo_corretor_ativo) acoes.push(seg ? '<small>2ª ok</small>' : `<button class="prv-link-acao prv-act-sortear" data-sub="${s.id}">Sortear 2º</button>`);
            acoes.push(`<button class="prv-link-acao prv-link-danger prv-act-apagar" data-sub="${s.id}" data-aluno="${escapeHtml(s.aluno_nome || s.aluno_email)}" title="Apaga a submissão deste aluno para ele refazer">🗑</button>`);
            sub += `<tr>
                <td>${escapeHtml(s.aluno_nome || s.aluno_email)}<br><small style="color:#888">${escapeHtml(s.aluno_email)}</small></td>
                <td>${selVar}</td>
                <td>${new Date(s.criada_em).toLocaleString('pt-BR')}</td>
                <td>${flags.join(' ') || '—'}</td>
                <td class="prv-nota">${s.nota} / ${s.total_max}</td>
                <td>${acoes.join(' ')}</td>
            </tr>`;
        }
        sub += `</tbody></table>`;
    }
    $('prvDetSubmissoes').innerHTML = sub;
    $('prvDetSubmissoes').querySelectorAll('.prv-act-trocar').forEach(b =>
        b.addEventListener('click', () => trocarVariante(parseInt(b.dataset.sub, 10))));
    $('prvDetSubmissoes').querySelectorAll('.prv-act-sortear').forEach(b =>
        b.addEventListener('click', () => sortear(parseInt(b.dataset.sub, 10))));
    $('prvDetSubmissoes').querySelectorAll('.prv-act-apagar').forEach(b =>
        b.addEventListener('click', () => apagarSubmissao(parseInt(b.dataset.sub, 10), b.dataset.aluno)));
    $('prvDetSubmissoes').querySelectorAll('.prv-act-foto').forEach(b =>
        b.addEventListener('click', () => conferirFoto(parseInt(b.dataset.sub, 10))));

    $('prvBtnEfetivar').textContent = p.efetivada ? 'Reabrir como rascunho' : 'Efetivar notas';
}

async function sortear(submissaoId) {
    if (!await confirmar('Sortear corretor?', 'Sortear um colega para 2ª correção desta prova?')) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/sortear-segundo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ submissaoId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await notificar('Corretor sorteado', `2º corretor: ${d.sorteado}`, {tipo: 'ok', icone: '🎲'});
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function regabaritar() {
    if (!await confirmar('Re-baixar gabarito?', 'Re-baixar o gabarito da GradePen? As notas calculadas serão refeitas se você efetivar de novo.')) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/regabaritar`, {
            method: 'POST', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await notificar('Gabarito atualizado', d.variantes_count + ' variantes.', {tipo: 'ok', icone: '📋'});
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function toggleEfetivar() {
    const acao = provaAberta.prova.efetivada ? 'reabrir' : 'efetivar';
    if (!await confirmar(`${acao === 'efetivar' ? 'Efetivar prova?' : 'Reabrir como rascunho?'}`, `${acao === 'efetivar' ? 'Efetivar' : 'Reabrir como rascunho'} esta prova?`)) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/${acao}`, {
            method: 'POST', credentials: 'include',
        });
        if (!r.ok) throw new Error('Falhou');
        await abrirDetalhe(provaAberta.prova.id);
        await carregarProvas();
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function excluirProva() {
    if (!await confirmar('Excluir prova?', 'EXCLUIR esta prova? Todas as correções dos alunos serão apagadas. Não dá pra desfazer.', { confirmLabel: 'Excluir', tipo: 'danger' })) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}`, {
            method: 'DELETE', credentials: 'include',
        });
        if (!r.ok) throw new Error('Falhou');
        fecharDet();
        await carregarProvas();
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function trocarVariante(submissaoId) {
    const sel = $(`prvVar_${submissaoId}`);
    if (!sel) return;
    const varianteId = sel.value;
    if (!await confirmar('Trocar variante?', 'Trocar a variante desta submissão? A nota será recalculada com o novo gabarito. Se houver 2ª correção, ela será apagada (vai precisar ser sorteada de novo).')) return;
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}/variante`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ varianteId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        if (d.semMudanca) { await notificar('Sem mudança', 'Já era essa variante. Nada mudou.', {tipo: 'info'}); return; }
        let msg = `Variante trocada. Nova nota: ${d.nota} / ${d.total_max}.`;
        if (d.segundasRemovidas) msg += ` ${d.segundasRemovidas} 2ª(s) correção(ões) foram apagadas.`;
        await notificar('Variante trocada', msg, {tipo: 'ok'});
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function apagarSubmissao(submissaoId, nomeAluno) {
    if (!await confirmar('Apagar submissão?', `Apagar a submissão de "${nomeAluno}"?\n\nIsso libera o aluno pra refazer a prova do zero (e remove qualquer 2ª correção vinculada).`, { confirmLabel: 'Apagar', tipo: 'danger' })) return;
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}`, {
            method: 'DELETE', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}

async function publicarNoClassroom() {
    if (!provaAberta) return;
    const sugestao = provaAberta.prova.pontos_avaliacao || 6;
    const txt = await solicitarTexto(
        'Publicar no Classroom',
        'Quantos pontos vale esta avaliação?\n(será o valor do grupo de notas dedicado)',
        sugestao,
        { confirmLabel: 'Publicar', icone: '📢', placeholder: 'Ex: 6', inputMode: 'decimal' }
    );
    if (txt === null) return;
    const pontos = parseFloat(String(txt).replace(/,/g, '.'));
    if (!isFinite(pontos) || pontos <= 0) {
        await confirmar('Valor inválido', 'Informe um número válido maior que zero.', { confirmLabel: 'OK', cancelLabel: '', icone: '⚠️' });
        return;
    }
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/publicar-classroom`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pontosMeta: pontos }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        const dt = d.dueDate ? `${String(d.dueDate.day).padStart(2,'0')}/${String(d.dueDate.month).padStart(2,'0')}/${d.dueDate.year}` : '—';
        if (await confirmar('Atividade publicada!', `Atividade publicada no Classroom!\n\n📅 Prazo: ${dt} 23:59\n💯 Vale: ${d.maxPoints} pts (Trim. ${d.trimestre}/${d.ano})\n✅ Grupo dedicado da avaliação criado/atualizado.\n\nAbrir a atividade no Classroom agora?`, { confirmLabel: 'Abrir no Classroom', cancelLabel: 'Fechar', icone: '✅' })) {
            if (d.alternateLink) window.open(d.alternateLink, '_blank');
        }
    } catch (e) { await notificar('Erro ao publicar', e.message, {tipo: 'danger'}); }
}

function prvAtivarAba(aba) {
    const abas = ['gabarito', 'submissoes', 'cola'];
    abas.forEach(a => {
        const secEl  = $('prvDetSec_' + a);
        const btnEl  = $('prvTabBtn_' + a);
        if (secEl) secEl.style.display = a === aba ? '' : 'none';
        if (btnEl) {
            btnEl.classList.toggle('prv-tab-ativa', a === aba);
        }
    });
    if (aba === 'cola' && !_colaCarregada) carregarColAnalise();
}

async function carregarColAnalise() {
    if (!provaAberta) return;
    const cont = $('prvDetCola');
    cont.innerHTML = '<div class="prv-empty">Carregando análise…</div>';
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/analise-cola`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        /* Constrói mapa de flags a partir dos dados já embutidos em cada par */
        _colaFlags = {};
        for (const par of (d.pares || [])) {
            if (par.flag) {
                const [ea, eb] = [par.alunoA, par.alunoB].sort();
                _colaFlags[`${ea}|${eb}`] = par.flag;
            }
        }
        _colaCarregada = true;
        renderColAnalise(d);
    } catch (e) {
        $('prvDetCola').innerHTML = `<div class="prv-empty" style="color:#dc2626">Erro: ${escapeHtml(e.message)}</div>`;
    }
}

function renderColAnalise({ pares, temDiscursiva }) {
    const cont = $('prvDetCola');

    if (!pares || pares.length === 0) {
        cont.innerHTML = `<div class="prv-empty">Sem dados suficientes para análise.<br><small>São necessárias ao menos 2 submissões na mesma variante.</small></div>`;
        return;
    }

    const flagCount = Object.keys(_colaFlags).length;
    const thresholdId = 'prvColaThreshold';

    const html = `
        <div class="prv-cola-controles">
            <label>Similaridade mínima:
                <input type="range" id="${thresholdId}" min="0" max="100" value="70" style="vertical-align:middle;width:120px">
                <span id="prvColaThresholdVal">70</span>%
            </label>
            <span class="prv-cola-legenda">
                <span class="prv-cola-badge prv-cola-alerta">≥70%</span> suspeito &nbsp;
                <span class="prv-cola-badge prv-cola-critico">≥85%</span> alto risco
            </span>
            ${flagCount > 0 ? `<button class="prv-btn prv-cola-export-btn" id="prvColaExportBtn" onclick="exportarFlags(${provaAberta.prova.id})">⬇️ Exportar flags (${flagCount})</button>` : ''}
        </div>
        <div id="prvColaTabelaWrap"></div>
        ${temDiscursiva ? '<p class="prv-cola-rodape">* Questões discursivas foram excluídas da comparação (apenas múltipla escolha e V/F são analisadas).</p>' : ''}
    `;
    cont.innerHTML = html;

    const slider = document.getElementById(thresholdId);
    const valSpan = document.getElementById('prvColaThresholdVal');
    const wrap    = document.getElementById('prvColaTabelaWrap');

    function renderTabela() {
        const threshold = parseInt(slider.value, 10);
        valSpan.textContent = threshold;
        const filtrados = pares.filter(p => p.similaridade >= threshold);

        if (filtrados.length === 0) {
            wrap.innerHTML = '<div class="prv-empty">Nenhum par acima do threshold atual.</div>';
            _colaExpandido = null;
            return;
        }

        let rows = '';
        for (const par of filtrados) {
            const nivel = par.similaridade >= 85 ? 'critico' : (par.similaridade >= 70 ? 'alerta' : '');
            const parKey = `${par.alunoA}|${par.alunoB}`;
            const [ea, eb] = [par.alunoA, par.alunoB].sort();
            const flag = _colaFlags[`${ea}|${eb}`] || null;
            const expandido = _colaExpandido === parKey;
            const flagBadge = flag
                ? (flag.status === 'resolvido'
                    ? '<span class="prv-cola-badge prv-cola-flag-resolvido">✅ Resolvido</span>'
                    : '<span class="prv-cola-badge prv-cola-flag-investigar">🔍 Investigar</span>')
                : '';
            rows += `
                <tr class="prv-cola-row ${nivel ? 'prv-cola-row-' + nivel : ''} ${flag ? 'prv-cola-row-flagged' : ''}" data-par="${escapeHtml(parKey)}" style="cursor:pointer">
                    <td><strong>${escapeHtml(par.nomeA)}</strong><br><small>${escapeHtml(par.alunoA)}</small></td>
                    <td><strong>${escapeHtml(par.nomeB)}</strong><br><small>${escapeHtml(par.alunoB)}</small></td>
                    <td style="text-align:center">.${escapeHtml(par.varianteCodigo)}</td>
                    <td style="text-align:center">
                        <span class="prv-cola-badge ${nivel === 'critico' ? 'prv-cola-critico' : nivel === 'alerta' ? 'prv-cola-alerta' : ''}">${par.similaridade}%</span>
                    </td>
                    <td style="text-align:center">${par.identicasErradas}</td>
                    <td style="text-align:center">${par.total}</td>
                    <td style="text-align:center">${flagBadge}</td>
                </tr>
            `;
            if (expandido) {
                rows += `<tr class="prv-cola-detalhe-row"><td colspan="7">${renderDetalhePar(par, flag)}</td></tr>`;
            }
        }

        wrap.innerHTML = `
            <table class="prv-tabela prv-cola-tabela">
                <thead><tr>
                    <th>Aluno A</th><th>Aluno B</th>
                    <th style="text-align:center">Variante</th>
                    <th style="text-align:center">Similaridade</th>
                    <th style="text-align:center">Erros coincidentes</th>
                    <th style="text-align:center">Total questões</th>
                    <th style="text-align:center">Status</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        wrap.querySelectorAll('.prv-cola-row').forEach(tr => {
            tr.addEventListener('click', () => {
                const key = tr.dataset.par;
                _colaExpandido = _colaExpandido === key ? null : key;
                renderTabela();
            });
        });
    }

    _renderColaTabela = renderTabela;
    slider.addEventListener('input', renderTabela);
    renderTabela();
}

function renderDetalhePar(par, flag) {
    let rows = '';
    for (const q of par.detalhes) {
        const fmtResp = v => {
            if (v === null) return '<em style="color:#aaa">—</em>';
            if (Array.isArray(v)) return escapeHtml(v.join(', '));
            return escapeHtml(String(v).toUpperCase());
        };
        const fmtGab = v => {
            if (v === null) return '—';
            if (Array.isArray(v)) return escapeHtml(v.join(', '));
            return escapeHtml(String(v).toUpperCase());
        };
        const cls = q.amboserram
            ? 'prv-cola-q-erro'
            : (q.igual ? 'prv-cola-q-igual' : '');
        rows += `<tr class="${cls}">
            <td style="text-align:center;font-weight:600">${q.questao}</td>
            <td style="text-align:center">${fmtResp(q.respA)}</td>
            <td style="text-align:center">${fmtResp(q.respB)}</td>
            <td style="text-align:center;color:#166534;font-weight:600">${fmtGab(q.correta)}</td>
            <td style="text-align:center">${q.amboserram ? '<span class="prv-cola-badge prv-cola-critico">erro coincidente</span>' : (q.igual ? '<span class="prv-cola-badge prv-cola-alerta">idêntica</span>' : '')}</td>
        </tr>`;
    }

    /* Flag UI */
    const safeA = escapeHtml(par.alunoA);
    const safeB = escapeHtml(par.alunoB);
    const notaId = `prvFlagNota-${par.alunoA.replace(/[^a-zA-Z0-9]/g, '-')}-${par.alunoB.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const currentStatus = flag ? flag.status : '';
    const currentNota = flag ? (flag.nota_professor || '') : '';
    const btnInvCls = currentStatus === 'investigar' ? 'prv-cola-flag-btn-ativo' : '';
    const btnResCls = currentStatus === 'resolvido'  ? 'prv-cola-flag-btn-ativo' : '';

    const flagHtml = `
        <div class="prv-cola-flag-wrap">
            <div class="prv-cola-flag-title">Decisão do professor</div>
            <div class="prv-cola-flag-btns">
                <button class="prv-btn prv-cola-flag-btn ${btnInvCls}"
                    onclick="salvarFlag(${provaAberta.prova.id}, '${safeA}', '${safeB}', 'investigar')">
                    🔍 Investigar
                </button>
                <button class="prv-btn prv-cola-flag-btn ${btnResCls}"
                    onclick="salvarFlag(${provaAberta.prova.id}, '${safeA}', '${safeB}', 'resolvido')">
                    ✅ Resolvido
                </button>
            </div>
            <div class="prv-cola-flag-nota-wrap">
                <textarea id="${notaId}" class="prv-cola-flag-nota" rows="2"
                    placeholder="Anotação opcional (ex: conversa agendada, coincidência confirmada…)">${escapeHtml(currentNota)}</textarea>
                <button class="prv-btn" onclick="salvarFlagNota(${provaAberta.prova.id}, '${safeA}', '${safeB}', '${notaId}')">
                    Salvar nota
                </button>
            </div>
        </div>
    `;

    return `
        <div class="prv-cola-detalhe">
            <strong>Detalhamento questão a questão — ${escapeHtml(par.nomeA)} × ${escapeHtml(par.nomeB)}</strong>
            <table class="prv-tabela" style="margin-top:8px">
                <thead><tr>
                    <th style="text-align:center">Q</th>
                    <th style="text-align:center">Aluno A</th>
                    <th style="text-align:center">Aluno B</th>
                    <th style="text-align:center">Gabarito</th>
                    <th style="text-align:center">Status</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            ${flagHtml}
        </div>
    `;
}

async function exportarFlags(provaId) {
    const btn = $('prvColaExportBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Exportando…'; }
    try {
        const r = await fetch(`/api/classroom/provas/${provaId}/cola-flags/export`, { credentials: 'include' });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.erro || 'Erro ao exportar.');
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flags-cola-prova-${provaId}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        await notificar('Erro ao exportar flags', e.message, { tipo: 'danger' });
    } finally {
        if (btn) {
            btn.disabled = false;
            const flagCount = Object.keys(_colaFlags).length;
            btn.textContent = `⬇️ Exportar flags (${flagCount})`;
        }
    }
}

async function salvarFlag(provaId, alunoA, alunoB, status) {
    const notaIdSafe = `prvFlagNota-${alunoA.replace(/[^a-zA-Z0-9]/g, '-')}-${alunoB.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const notaEl = document.getElementById(notaIdSafe);
    const notaProfessor = notaEl ? notaEl.value.trim() : '';
    try {
        const r = await fetch(`/api/classroom/provas/${provaId}/cola-flags`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alunoA, alunoB, status, notaProfessor }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        /* Atualiza mapa local */
        const [ea, eb] = [alunoA, alunoB].sort();
        _colaFlags[`${ea}|${eb}`] = { status, nota_professor: notaProfessor };
        if (_renderColaTabela) _renderColaTabela();
    } catch (e) {
        await notificar('Erro ao salvar decisão', e.message, { tipo: 'danger' });
    }
}

async function salvarFlagNota(provaId, alunoA, alunoB, notaId) {
    const [ea, eb] = [alunoA, alunoB].sort();
    const existing = _colaFlags[`${ea}|${eb}`];
    const status = existing ? existing.status : 'investigar';
    const notaEl = document.getElementById(notaId);
    const notaProfessor = notaEl ? notaEl.value.trim() : '';
    try {
        const r = await fetch(`/api/classroom/provas/${provaId}/cola-flags`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alunoA, alunoB, status, notaProfessor }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        _colaFlags[`${ea}|${eb}`] = { status, nota_professor: notaProfessor };
        if (_renderColaTabela) _renderColaTabela();
    } catch (e) {
        await notificar('Erro ao salvar nota', e.message, { tipo: 'danger' });
    }
}

function fecharDet() { $('prvModalDet').style.display = 'none'; provaAberta = null; }

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

window.onCursoChange   = onCursoChange;
window.abrirNova       = abrirNova;
window.fecharNova      = fecharNova;
window.salvarNova      = salvarNova;
window.abrirDetalhe    = abrirDetalhe;
window.sortear         = sortear;
window.regabaritar     = regabaritar;
window.toggleEfetivar  = toggleEfetivar;
window.excluirProva    = excluirProva;
async function conferirFoto(submissaoId) {
    const ok = await confirmar('Conferir foto?', 'A foto da folha BATE com as marcações que o aluno enviou?\n\nConfirmar = ✅ Confere (aluno ganha XP)\nCancelar = ❌ Não confere (aluno perde XP, será sinalizado)', { confirmLabel: '✅ Confere', cancelLabel: '❌ Não confere' });
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}/conferir-foto`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ok }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { await notificar('Erro', e.message, {tipo: 'danger'}); }
}
window.conferirFoto    = conferirFoto;
window.trocarVariante  = trocarVariante;
window.apagarSubmissao = apagarSubmissao;
window.publicarNoClassroom = publicarNoClassroom;
window.exportarFlags   = exportarFlags;
window.salvarFlag      = salvarFlag;
window.salvarFlagNota  = salvarFlagNota;
window.fecharDet       = fecharDet;
window.prvAtivarAba    = prvAtivarAba;

init();
