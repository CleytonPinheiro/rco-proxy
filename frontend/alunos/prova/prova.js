'use strict';
/* Portal do Aluno — Tela de Correção de Prova (estilo GradePen) */

function escHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _lerQuestoesTxt(provaId, varianteCodigo) {
    try {
        const raw = localStorage.getItem(`edusync_qt_${provaId}`);
        if (!raw) return null;
        const qt = JSON.parse(raw);
        return qt[varianteCodigo] || null;
    } catch (_) { return null; }
}

const TEMA_KEY = 'aluno_tema';
function aplicarTema(t) { document.documentElement.setAttribute('data-theme', t); localStorage.setItem(TEMA_KEY, t); }
function toggleTema() { aplicarTema((document.documentElement.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark'); }

const $ = id => document.getElementById(id);
const LETRAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

let estado = {
    aluno:        null,
    ansid:        null,
    jobId:        null,
    varSugerida:  null,
    prova:        null,
    variantes:    [],
    varianteSel:  null,            // {id, codigo, qtd_questoes}
    qtdQuestoes:  0,
    marcacoes:    {},              // { "1": "a", "2": "c", ... }
    fotoBase64:   null,
    submissao:    null,            // resposta do POST
};

function show(id) {
    ['ppLoading','ppLogin','ppErro','ppJaFeita','ppVariante','ppEtapa1','ppFoto','ppEtapa2','ppSegundo','ppTurmaCorretora']
        .forEach(s => { const el = $(s); if (el) el.style.display = (s === id ? '' : 'none'); });
}

function showErro(msg) {
    $('ppErroMsg').textContent = msg || 'Erro desconhecido.';
    show('ppErro');
}

async function init() {
    const params = new URLSearchParams(location.search);
    const ansid = params.get('ansid');
    const seg   = params.get('seg');
    const tcor  = params.get('tcor');
    if (!ansid && !seg && !tcor) return showErro('Link inválido — falta o código da prova.');

    /* Verifica login (compartilhado) */
    try {
        const r = await fetch('/api/alunos-portal/status', { credentials: 'include' });
        const d = await r.json();
        if (!d.aluno) {
            sessionStorage.setItem('pp_redirect', location.href);
            return show('ppLogin');
        }
        estado.aluno = d.aluno;
    } catch (e) {
        return showErro('Não foi possível verificar o login.');
    }

    if (tcor) return iniciarTurmaCorretora(tcor);
    if (seg)  return iniciarSegundoCorretor(seg);

    estado.ansid = ansid;
    const [job, varCod] = ansid.split('.');
    estado.jobId = job;
    estado.varSugerida = varCod || null;

    /* Busca prova */
    try {
        const r = await fetch(`/api/alunos-portal/prova/${encodeURIComponent(ansid)}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) return showErro(d.erro || 'Prova não disponível.');

        estado.prova     = d.prova;
        estado.variantes = d.variantes;

        /* Já submeteu? */
        if (d.jaSubmeti) {
            estado.submissao = d.jaSubmeti;
            $('ppNotaSalva').textContent = `${d.jaSubmeti.nota ?? '?'} / ${d.jaSubmeti.total_max ?? '?'}`;
            return show('ppJaFeita');
        }

        /* Se variante já veio na URL, pula direto */
        if (estado.varSugerida) {
            const v = estado.variantes.find(v => v.codigo === estado.varSugerida);
            if (v) { selecionarVariante(v); return; }
        }

        renderVariantes();
        show('ppVariante');
    } catch (e) {
        showErro(e.message);
    }
}

function renderVariantes() {
    $('ppNomeProva').textContent = estado.prova.nome;
    $('ppAlunoNome').textContent = estado.aluno.nome || estado.aluno.email;
    const linkProva = estado.prova.link_prova;
    const linkWrap = $('ppLinkProvaWrap');
    const linkEl   = $('ppLinkProva');
    if (linkProva) {
        linkEl.href = linkProva;
        linkWrap.style.display = '';
    } else {
        linkWrap.style.display = 'none';
    }
    const wrap = $('ppListaVariantes');
    wrap.innerHTML = '';
    estado.variantes.forEach(v => {
        const b = document.createElement('button');
        b.className = 'pp-variante-btn';
        b.innerHTML = `Variante .${v.codigo}<small>${v.qtd_questoes} questões</small>`;
        b.onclick = () => selecionarVariante(v);
        wrap.appendChild(b);
    });
}

async function selecionarVariante(v) {
    estado.varianteSel = v;
    estado.qtdQuestoes = v.qtd_questoes;
    estado.marcacoes = {};
    $('ppVarCod1').textContent = v.codigo;
    const linkProva = estado.prova.link_prova;
    const etapa1LinkWrap = $('ppLinkProvaEtapa1Wrap');
    const etapa1LinkEl   = $('ppLinkProvaEtapa1');
    if (linkProva) {
        etapa1LinkEl.href = linkProva;
        etapa1LinkWrap.style.display = '';
    } else {
        etapa1LinkWrap.style.display = 'none';
    }
    renderTabelaEtapa1();
    show('ppEtapa1');
}

function renderTabelaEtapa1() {
    /* Sem gabarito ainda — só a coluna "Marque" */
    const wrap = $('ppTabelaEtapa1');
    let html = `<table class="pp-tabela"><thead><tr>
        <th style="width:40px">#</th>
        <th>Sua resposta</th>
    </tr></thead><tbody>`;
    for (let q = 1; q <= estado.qtdQuestoes; q++) {
        html += `<tr><td class="pp-q-num">${q}</td><td>`;
        for (const letra of LETRAS.slice(0, 5)) {
            html += `<span class="pp-bolha" data-q="${q}" data-l="${letra}" onclick="marcar(${q},'${letra}')">${letra.toUpperCase()}</span>`;
        }
        html += `</td></tr>`;
    }
    html += `</tbody></table>`;
    wrap.innerHTML = html;
}

function marcar(q, letra) {
    estado.marcacoes[String(q)] = letra;
    /* Atualiza visual */
    document.querySelectorAll(`.pp-bolha[data-q="${q}"]`).forEach(el => {
        el.classList.toggle('pp-marcada', el.dataset.l === letra);
    });
}

function voltarVariante() {
    estado.marcacoes = {};
    show('ppVariante');
}

async function confirmarMarcacoes() {
    const marcadas = Object.keys(estado.marcacoes).length;
    if (marcadas < estado.qtdQuestoes) {
        if (!await confirmar('Enviar incompleto?', `Você marcou ${marcadas} de ${estado.qtdQuestoes}. Enviar mesmo assim?`, { confirmLabel: 'Enviar assim', tipo: 'danger' })) return;
    }
    /* Tentamos enviar SEM foto primeiro. Se backend disser que foto é obrigatória, redirecionamos pra etapa de foto. */
    if (estado.prova.foto_modo === 'sempre') {
        return show('ppFoto');
    }
    enviarSubmissao();
}

function previewFoto(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        estado.fotoBase64 = e.target.result;
        $('ppFotoPreview').src = e.target.result;
        $('ppFotoPreview').style.display = '';
        $('ppBtnEnviar').disabled = false;
    };
    reader.readAsDataURL(file);
}

async function enviarFotoOuSubmissao() {
    /* Se já submeteu (foto era exigida via sorteio), só anexa a foto */
    if (estado.submissao && estado.submissao.submissaoId) {
        $('ppBtnEnviar').disabled = true;
        try {
            const r = await fetch(`/api/alunos-portal/prova/submissao/${estado.submissao.submissaoId}/foto`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ fotoBase64: estado.fotoBase64 }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.erro || 'Erro ao enviar foto.');
            renderResultado(estado.submissao);
        } catch (e) {
            notificar('Erro: ' + e.message, 'erro');
            $('ppBtnEnviar').disabled = false;
        }
        return;
    }
    return enviarSubmissao();
}

async function enviarSubmissao() {
    $('ppBtnConfirmar') && ($('ppBtnConfirmar').disabled = true);
    $('ppBtnEnviar')    && ($('ppBtnEnviar').disabled = true);
    try {
        const r = await fetch(`/api/alunos-portal/prova/${estado.prova.id}/submeter`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                varianteCodigo: estado.varianteSel.codigo,
                marcacoes:      estado.marcacoes,
                fotoBase64:     estado.fotoBase64,
            }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao enviar.');

        estado.submissao = d;

        /* Se foto era exigida (sorteio) e ainda não enviamos, vai pra etapa foto agora */
        if (d.fotoObrigatoria && !d.fotoEntregue) {
            estado.submissao = d;
            show('ppFoto');
            return;
        }
        renderResultado(d);
    } catch (e) {
        notificar('Erro: ' + e.message, 'erro');
        $('ppBtnConfirmar') && ($('ppBtnConfirmar').disabled = false);
        $('ppBtnEnviar')    && ($('ppBtnEnviar').disabled = false);
    }
}

function renderResultado(d) {
    $('ppNotaFinal').textContent = (d.nota ?? '—').toString();
    $('ppTotalMax').textContent  = (d.total ?? '—').toString();
    if (d.xpGanho > 0 || (d.badgesGanhas && d.badgesGanhas.length > 0)) {
        const det = (d.xpDetalhes || []).map(x => `${x.rotulo}: +${x.xp} XP`).join(' · ');
        const bd = (d.badgesGanhas || []).map(b => `${b.emoji} ${b.nome}`).join(', ');
        const linha = `🎮 Você ganhou +${d.xpGanho} XP! ${det ? '(' + det + ')' : ''}${bd ? ' · 🏆 Nova badge: ' + bd : ''}`;
        let xpDiv = $('ppXpInfo');
        if (!xpDiv) {
            xpDiv = document.createElement('div');
            xpDiv.id = 'ppXpInfo';
            xpDiv.style.cssText = 'margin:12px 0;padding:10px;background:#f0fdf4;border:1px solid #4ade80;border-radius:8px;color:#166534;font-weight:500';
            $('ppEtapa2').insertBefore(xpDiv, $('ppEtapa2').firstChild);
        }
        xpDiv.textContent = linha;
    }

    const wrap = $('ppTabelaEtapa2');
    let html = `<table class="pp-tabela"><thead><tr>
        <th style="width:40px">#</th>
        <th>Gabarito</th>
        <th>Você marcou</th>
        <th>Acerto</th>
        <th>Valor</th>
    </tr></thead><tbody>`;
    for (const det of d.detalhes) {
        const acerto = det.acerto;
        const cls = acerto ? 'pp-row-acerto' : (det.marcado ? 'pp-row-erro' : '');
        html += `<tr class="${cls}">
            <td class="pp-q-num">${det.questao}</td>
            <td class="pp-gab-cell"><label>${(det.correta || '?').toString().toUpperCase()}</label></td>
            <td>${(det.marcado || '—').toString().toUpperCase()}</td>
            <td class="${acerto ? 'pp-acerto-sim' : 'pp-acerto-nao'}">${acerto ? '✓' : '✗'}</td>
            <td>${(det.valor ?? 0).toFixed(2)}</td>
        </tr>`;
    }
    html += `</tbody></table>`;
    wrap.innerHTML = html;
    show('ppEtapa2');
}

async function verResultado() {
    if (!estado.submissao?.id) return;
    try {
        const r = await fetch(`/api/alunos-portal/prova/submissao/${estado.submissao.id}`, { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        renderResultado({ nota: d.submissao.nota, total: d.total, detalhes: d.detalhes });
    } catch (e) { notificar('Erro: ' + e.message, 'erro'); }
}

async function iniciarTurmaCorretora(subRefId) {
    try {
        const r = await fetch(
            `/api/alunos-portal/turma-corretora/submissao/${encodeURIComponent(subRefId)}`,
            { credentials: 'include' }
        );
        const d = await r.json();
        if (!r.ok) return showErro(d.erro || 'Folha não encontrada ou já foi corrigida por outro aluno.');

        const item = d.item;
        estado.tcor = item;
        estado.qtdQuestoes = item.qtd_questoes || 12;
        estado.marcacoes = {};

        /* Exibe nome do aluno dono como confirmação visual */
        const nomeWrap = $('ppTcorNomeWrap');
        const nomeEl   = $('ppTcorNomeAluno');
        if (nomeWrap && nomeEl) {
            nomeEl.textContent = item.aluno_nome || '(sem nome)';
            nomeWrap.style.display = '';
        }

        if (item.foto_url) {
            $('ppTcorFoto').src = item.foto_url;
            $('ppTcorFoto').style.display = '';
            $('ppTcorSemFoto').style.display = 'none';
        } else {
            $('ppTcorFoto').style.display = 'none';
            $('ppTcorSemFoto').style.display = '';
        }

        estado.tcorQuestoesTxt = _lerQuestoesTxt(item.prova_id, item.variante_codigo);
        renderTabelaTcor();
        show('ppTurmaCorretora');
    } catch (e) { showErro(e.message); }
}

function renderTabelaTcor() {
    const wrap = $('ppTcorTabela');
    const qt = estado.tcorQuestoesTxt || null;
    let html = `<table class="pp-tabela pp-tabela-cor"><thead><tr>
        <th style="width:40px">#</th>
        <th>O que está marcado na folha</th>
    </tr></thead><tbody>`;
    for (let q = 1; q <= estado.qtdQuestoes; q++) {
        const qInfo = qt ? qt[q] : null;
        html += `<tr><td class="pp-q-num">${q}</td><td class="pp-td-cor">`;
        if (qInfo && qInfo.enunciado) {
            const resumo = escHtml(qInfo.enunciado.slice(0, 80));
            const enuncFull = escHtml(qInfo.enunciado);
            html += `<details class="pp-qtxt"><summary class="pp-qtxt-summary">${resumo}…</summary><div class="pp-qtxt-body">${enuncFull}</div>`;
            for (const letra of ['a', 'b', 'c', 'd', 'e']) {
                if (qInfo.alternativas && qInfo.alternativas[letra]) {
                    html += `<div class="pp-qtxt-alt"><span class="pp-qtxt-letra">${letra.toUpperCase()}</span> ${escHtml(qInfo.alternativas[letra])}</div>`;
                }
            }
            html += `</details>`;
        }
        html += `<div class="pp-bolhas-row">`;
        for (const letra of LETRAS.slice(0, 5)) {
            html += `<span class="pp-bolha" data-q="${q}" data-l="${letra}" onclick="marcar(${q},'${letra}')">${letra.toUpperCase()}</span>`;
        }
        html += `<span class="pp-bolha" data-q="${q}" data-l="-" onclick="marcar(${q},'-')" title="Em branco">∅</span>`;
        html += `</div></td></tr>`;
    }
    html += `</tbody></table>`;
    wrap.innerHTML = html;
}

async function enviarTurmaCorretora() {
    const limpo = {};
    for (const [k, v] of Object.entries(estado.marcacoes)) {
        if (v && v !== '-') limpo[k] = v;
    }
    $('ppTcorBtn').disabled = true;
    try {
        const r = await fetch(`/api/alunos-portal/turma-corretora/${estado.tcor.submissao_ref_id}/submeter`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ marcacoes: limpo }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro ao enviar.');
        let msg = '✅ Correção enviada! Obrigado pela ajuda.';
        if (d.xpGanho) msg += ` | +${d.xpGanho} XP ganho`;
        notificar(msg);
        setTimeout(() => { location.href = '/alunos/'; }, 2000);
    } catch (e) {
        notificar('Erro: ' + e.message, 'erro');
        $('ppTcorBtn').disabled = false;
    }
}

async function iniciarSegundoCorretor(subRefId) {
    try {
        const r = await fetch('/api/alunos-portal/segundo-corretor/pendentes', { credentials: 'include' });
        const d = await r.json();
        const pend = (d.pendentes || []).find(p => String(p.submissao_ref_id) === String(subRefId));
        if (!pend) return showErro('Tarefa não encontrada (talvez já tenha sido feita).');

        estado.segundo = pend;
        estado.qtdQuestoes = 0;
        estado.marcacoes = {};

        if (pend.foto_url) {
            $('ppSegFoto').src = pend.foto_url;
        } else {
            $('ppSegFoto').style.display = 'none';
            $('ppSegSemFoto').style.display = '';
        }

        estado.qtdQuestoes = pend.qtd_questoes || 12;
        estado.segQuestoesTxt = _lerQuestoesTxt(pend.prova_id, pend.variante_codigo);
        renderTabelaSegundo();
        show('ppSegundo');
    } catch (e) { showErro(e.message); }
}

function renderTabelaSegundo() {
    const wrap = $('ppSegTabela');
    const qt = estado.segQuestoesTxt || null;
    let html = `<table class="pp-tabela pp-tabela-cor"><thead><tr>
        <th style="width:40px">#</th>
        <th>O que está marcado na folha</th>
    </tr></thead><tbody>`;
    for (let q = 1; q <= estado.qtdQuestoes; q++) {
        const qInfo = qt ? qt[q] : null;
        html += `<tr><td class="pp-q-num">${q}</td><td class="pp-td-cor">`;
        if (qInfo && qInfo.enunciado) {
            const resumo = escHtml(qInfo.enunciado.slice(0, 80));
            const enuncFull = escHtml(qInfo.enunciado);
            html += `<details class="pp-qtxt"><summary class="pp-qtxt-summary">${resumo}…</summary><div class="pp-qtxt-body">${enuncFull}</div>`;
            for (const letra of ['a', 'b', 'c', 'd', 'e']) {
                if (qInfo.alternativas && qInfo.alternativas[letra]) {
                    html += `<div class="pp-qtxt-alt"><span class="pp-qtxt-letra">${letra.toUpperCase()}</span> ${escHtml(qInfo.alternativas[letra])}</div>`;
                }
            }
            html += `</details>`;
        }
        html += `<div class="pp-bolhas-row">`;
        for (const letra of LETRAS.slice(0, 5)) {
            html += `<span class="pp-bolha" data-q="${q}" data-l="${letra}" onclick="marcar(${q},'${letra}')">${letra.toUpperCase()}</span>`;
        }
        html += `<span class="pp-bolha" data-q="${q}" data-l="-" onclick="marcar(${q},'-')" title="Em branco">∅</span>`;
        html += `</div></td></tr>`;
    }
    html += `</tbody></table>`;
    wrap.innerHTML = html;
}

async function enviarSegundo() {
    /* Remove marcações '-' (em branco) */
    const limpo = {};
    for (const [k, v] of Object.entries(estado.marcacoes)) {
        if (v && v !== '-') limpo[k] = v;
    }
    $('ppSegBtn').disabled = true;
    try {
        const r = await fetch(`/api/alunos-portal/segundo-corretor/${estado.segundo.submissao_ref_id}/submeter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ marcacoes: limpo }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || 'Erro');
        let msg = '✅ Correção enviada. Obrigado pela ajuda!';
        if (d.xpGanho) msg += ` | +${d.xpGanho} XP ganho`;
        if (d.badgesGanhas && d.badgesGanhas.length) msg += ` | Badge: ${d.badgesGanhas.map(b => b.emoji + ' ' + b.nome).join(', ')}`;
        notificar(msg);
        setTimeout(() => { location.href = '/alunos/'; }, 2000);
    } catch (e) {
        notificar('Erro: ' + e.message, 'erro');
        $('ppSegBtn').disabled = false;
    }
}

window.enviarTurmaCorretora   = enviarTurmaCorretora;
window.enviarSegundo          = enviarSegundo;
window.toggleTema             = toggleTema;
window.marcar                 = marcar;
window.voltarVariante         = voltarVariante;
window.confirmarMarcacoes     = confirmarMarcacoes;
window.previewFoto            = previewFoto;
window.enviarSubmissao        = enviarSubmissao;
window.enviarFotoOuSubmissao  = enviarFotoOuSubmissao;
window.verResultado           = verResultado;

init();
