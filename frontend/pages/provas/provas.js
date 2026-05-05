'use strict';
/* Provas — UI do professor */

const $ = id => document.getElementById(id);

let cursos = [];
let cursoAtual = '';
let provas = [];
let provaAberta = null;

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
    await carregarGruposDoCurso();
}

async function carregarProvas() {
    $('prvLista').innerHTML = '<div class="prv-empty">Carregando…</div>';
    try {
        const r = await fetch(`/api/classroom/provas?courseId=${encodeURIComponent(cursoAtual)}`, { credentials: 'include' });
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
                    </div>
                    <div class="prv-card-meta">
                        <span>GradePen #${escapeHtml(p.gradepen_id)}</span>
                        <span>${p.data_aplicacao ? new Date(p.data_aplicacao).toLocaleDateString('pt-BR') : 'Sem data'}</span>
                        <span>${p.variantes_count} variante(s)</span>
                        ${p.grupo_destino_nome ? `<span>→ ${escapeHtml(p.grupo_destino_nome)}</span>` : ''}
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

async function carregarGruposDoCurso() {
    try {
        const r = await fetch(`/api/classroom/groups?courseId=${encodeURIComponent(cursoAtual)}`, { credentials: 'include' });
        if (!r.ok) { $('prvfGrupo').innerHTML = '<option value="">(nenhum grupo encontrado)</option>'; return; }
        const grupos = await r.json();
        const lista = Array.isArray(grupos) ? grupos : (grupos.grupos || []);
        $('prvfGrupo').innerHTML = '<option value="">(sem grupo destino)</option>' +
            lista.map(g => `<option value="${g.id}">${escapeHtml(g.nome)}</option>`).join('');
    } catch (e) {
        $('prvfGrupo').innerHTML = '<option value="">(sem grupo destino)</option>';
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
        grupoDestinoId:       $('prvfGrupo').value || null,
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
        alert(`Prova cadastrada! ${d.variantes_count} variante(s) baixadas da GradePen.`);
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
    } catch (e) { alert('Erro: ' + e.message); }
}

function renderDetalhe(d) {
    const p = d.prova;
    $('prvDetNome').textContent = p.nome;
    $('prvDetMeta').innerHTML = `
        <span>📋 GradePen #${escapeHtml(p.gradepen_id)}</span>
        <span>📅 ${p.data_aplicacao ? new Date(p.data_aplicacao).toLocaleDateString('pt-BR') : 'Sem data'}</span>
        <span>📊 ${d.variantes.length} variantes • ${d.submissoes.filter(s=>!s.eh_segundo_corretor).length} alunos corrigiram</span>
        ${p.grupo_destino_nome ? `<span>🎯 Grupo: ${escapeHtml(p.grupo_destino_nome)}</span>` : '<span>⚠️ Sem grupo destino</span>'}
        <span>📷 Foto: ${p.foto_modo}${p.foto_modo === 'sorteio' ? ` (${p.foto_sorteio_pct}%)` : ''}</span>
        <span>👁 2º corretor: ${p.segundo_corretor_ativo ? 'ativo' : 'desativado'}${p.segundo_corretor_ativo && p.permitir_outra_turma ? ' (cross-turma ON)' : ''}</span>
    `;

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
        sub += `<div class="prv-info-box">⚠️ <strong>As notas estão como rascunho.</strong> Quando estiver pronto, clique em <strong>"Efetivar notas"</strong> abaixo. Depois disso, lance manualmente no grupo destino "${escapeHtml(p.grupo_destino_nome || 'sem grupo')}" usando o módulo Classroom.</div>`;
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
            if (s.foto_url) flags.push('<span class="prv-flag prv-flag-foto">📷</span>');
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

    $('prvBtnEfetivar').textContent = p.efetivada ? 'Reabrir como rascunho' : 'Efetivar notas';
}

async function sortear(submissaoId) {
    if (!confirm('Sortear um colega para 2ª correção desta prova?')) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/sortear-segundo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ submissaoId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        alert(`2º corretor sorteado: ${d.sorteado}`);
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { alert('Erro: ' + e.message); }
}

async function regabaritar() {
    if (!confirm('Re-baixar o gabarito da GradePen? As notas calculadas serão refeitas se você efetivar de novo.')) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/regabaritar`, {
            method: 'POST', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        alert('Gabarito atualizado: ' + d.variantes_count + ' variantes.');
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { alert('Erro: ' + e.message); }
}

async function toggleEfetivar() {
    const acao = provaAberta.prova.efetivada ? 'reabrir' : 'efetivar';
    if (!confirm(`${acao === 'efetivar' ? 'Efetivar' : 'Reabrir como rascunho'} esta prova?`)) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/${acao}`, {
            method: 'POST', credentials: 'include',
        });
        if (!r.ok) throw new Error('Falhou');
        await abrirDetalhe(provaAberta.prova.id);
        await carregarProvas();
    } catch (e) { alert('Erro: ' + e.message); }
}

async function excluirProva() {
    if (!confirm('EXCLUIR esta prova? Todas as correções dos alunos serão apagadas. Não dá pra desfazer.')) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}`, {
            method: 'DELETE', credentials: 'include',
        });
        if (!r.ok) throw new Error('Falhou');
        fecharDet();
        await carregarProvas();
    } catch (e) { alert('Erro: ' + e.message); }
}

async function trocarVariante(submissaoId) {
    const sel = $(`prvVar_${submissaoId}`);
    if (!sel) return;
    const varianteId = sel.value;
    if (!confirm('Trocar a variante desta submissão? A nota será recalculada com o novo gabarito. Se houver 2ª correção, ela será apagada (vai precisar ser sorteada de novo).')) return;
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}/variante`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ varianteId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        if (d.semMudanca) { alert('Já era essa variante. Nada mudou.'); return; }
        let msg = `Variante trocada. Nova nota: ${d.nota} / ${d.total_max}.`;
        if (d.segundasRemovidas) msg += `\n${d.segundasRemovidas} 2ª(s) correção(ões) foram apagadas.`;
        alert(msg);
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { alert('Erro: ' + e.message); }
}

async function apagarSubmissao(submissaoId, nomeAluno) {
    if (!confirm(`Apagar a submissão de "${nomeAluno}"?\n\nIsso libera o aluno pra refazer a prova do zero (e remove qualquer 2ª correção vinculada).`)) return;
    try {
        const r = await fetch(`/api/classroom/provas/submissoes/${submissaoId}`, {
            method: 'DELETE', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        await abrirDetalhe(provaAberta.prova.id);
    } catch (e) { alert('Erro: ' + e.message); }
}

async function publicarNoClassroom() {
    if (!provaAberta) return;
    if (!confirm('Publicar no Google Classroom um link de correção pra esta prova?\n\nVai aparecer pros alunos como Material no curso, com a variante já pré-selecionada quando abrirem.')) return;
    try {
        const r = await fetch(`/api/classroom/provas/${provaAberta.prova.id}/publicar-classroom`, {
            method: 'POST', credentials: 'include',
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        const dt = d.dueDate ? `${String(d.dueDate.day).padStart(2,'0')}/${String(d.dueDate.month).padStart(2,'0')}/${d.dueDate.year}` : '—';
        if (confirm(`Atividade publicada no Classroom!\n\n📅 Prazo: ${dt} 23:59\n💯 Vale: ${d.maxPoints} pts (Trim. ${d.trimestre}/${d.ano})\n✅ Grupo dedicado da avaliação criado/atualizado (id ${d.grupoAvaliacaoId}).\n\nLink: ${d.link}\n\nAbrir a atividade no Classroom agora?`)) {
            if (d.alternateLink) window.open(d.alternateLink, '_blank');
        }
    } catch (e) { alert('Erro ao publicar: ' + e.message); }
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
window.trocarVariante  = trocarVariante;
window.apagarSubmissao = apagarSubmissao;
window.publicarNoClassroom = publicarNoClassroom;
window.fecharDet       = fecharDet;

init();
