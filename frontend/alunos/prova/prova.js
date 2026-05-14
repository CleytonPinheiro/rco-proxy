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

function _salvarRascunho(chave, marcacoes) {
    try { localStorage.setItem(chave, JSON.stringify(marcacoes)); } catch (_) {}
}

function _lerRascunho(chave) {
    try {
        const raw = localStorage.getItem(chave);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

function _apagarRascunho(chave) {
    try { localStorage.removeItem(chave); } catch (_) {}
}

function _chaveRascunhoProva() {
    if (!estado.ansid || !estado.varianteSel) return null;
    return `edusync_rascunho_prova_${estado.ansid}_${estado.varianteSel.codigo}`;
}

function _chaveRascunhoTcor() {
    if (!estado.tcor) return null;
    return `edusync_rascunho_tcor_${estado.tcor.submissao_ref_id}`;
}

function _mostrarAvisoRascunho(containerEl) {
    if (!containerEl) return;
    if (containerEl.querySelector('.pp-rascunho-restaurado')) return;
    const aviso = document.createElement('div');
    aviso.className = 'pp-rascunho-restaurado';
    aviso.textContent = '📝 Rascunho restaurado — continue de onde parou.';
    aviso.style.cssText = 'margin:8px 0 12px;padding:8px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:13px;color:#92400e;font-weight:500';
    containerEl.insertBefore(aviso, containerEl.firstChild);
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
    if (id !== 'ppTurmaCorretora') {
        _tcorPausarCronometro();
        document.body.classList.remove('pp-tcor-split-ativo');
    }
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

    /* Restaura rascunho se existir */
    const chave = _chaveRascunhoProva();
    if (chave) {
        const rascunho = _lerRascunho(chave);
        if (rascunho && Object.keys(rascunho).length > 0) {
            estado.marcacoes = rascunho;
            for (const [q, letra] of Object.entries(rascunho)) {
                document.querySelectorAll(`.pp-bolha[data-q="${q}"]`).forEach(el => {
                    el.classList.toggle('pp-marcada', el.dataset.l === letra);
                });
            }
            _mostrarAvisoRascunho($('ppEtapa1'));
        }
    }

    show('ppEtapa1');
}

function renderTabelaEtapa1() {
    /* Sem gabarito ainda — só a coluna "Marque" */
    const wrap = $('ppTabelaEtapa1');
    const qt = _lerQuestoesTxt(estado.prova?.id, estado.varianteSel?.codigo);
    let html = `<table class="pp-tabela"><thead><tr>
        <th style="width:40px">#</th>
        <th>Sua resposta</th>
    </tr></thead><tbody>`;
    for (let q = 1; q <= estado.qtdQuestoes; q++) {
        const qInfo = qt ? qt[q] : null;
        const nAlts = estado.varianteSel?.questoes_n_alts?.[q - 1];
        const temE = nAlts === 5 || (qInfo && qInfo.alternativas && qInfo.alternativas['e']);
        const letras = temE ? LETRAS.slice(0, 5) : LETRAS.slice(0, 4);
        html += `<tr><td class="pp-q-num">${q}</td><td>`;
        for (const letra of letras) {
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
    /* Persiste rascunho (não salva para o fluxo do segundo corretor) */
    if (!estado.segundo) {
        const chave = estado.tcor ? _chaveRascunhoTcor() : _chaveRascunhoProva();
        if (chave) _salvarRascunho(chave, estado.marcacoes);
    }
}

function marcarVF(q, subIdx, letra, vfCount) {
    const chave = String(q);
    const total = vfCount || (Array.isArray(estado.marcacoes[chave]) ? estado.marcacoes[chave].length : subIdx + 1);
    if (!Array.isArray(estado.marcacoes[chave])) {
        estado.marcacoes[chave] = new Array(total).fill(null);
    }
    estado.marcacoes[chave][subIdx] = letra;
    /* Atualiza visual */
    document.querySelectorAll(`.pp-bolha-vf[data-q="${q}"][data-sub="${subIdx}"]`).forEach(el => {
        el.classList.toggle('pp-marcada', el.dataset.l === letra);
    });
}

function voltarVariante() {
    const chave = _chaveRascunhoProva();
    if (chave) _apagarRascunho(chave);
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
        const chaveProva = _chaveRascunhoProva();
        if (chaveProva) _apagarRascunho(chaveProva);
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
    /* Reset explícito do painel PDF e cronômetro antes de carregar nova folha */
    _tcorPausarCronometro();
    document.body.classList.remove('pp-tcor-split-ativo');
    const _pdfPanel = $('ppTcorPainelPdf');
    if (_pdfPanel) _pdfPanel.style.display = 'none';
    const _layoutEl = $('ppTcorLayout');
    if (_layoutEl) _layoutEl.classList.remove('pp-tcor-split-ativo');
    const _iframeEl = $('ppTcorIframePdf');
    if (_iframeEl) { _iframeEl.removeAttribute('data-carregado'); _iframeEl.src = ''; }
    const _badgeEl = $('ppTcorCronometro');
    if (_badgeEl) _badgeEl.style.display = 'none';
    const _btnEnvEl = $('ppTcorBtn');
    if (_btnEnvEl) _btnEnvEl.disabled = false;

    try {
        const r = await fetch(
            `/api/alunos-portal/turma-corretora/submissao/${encodeURIComponent(subRefId)}`,
            { credentials: 'include' }
        );
        const d = await r.json();
        if (!r.ok) {
            if (r.status === 404 || r.status === 403) {
                try { localStorage.removeItem(`edusync_rascunho_tcor_${subRefId}`); } catch (_) {}
            }
            return showErro(d.erro || 'Folha não encontrada ou já foi corrigida por outro aluno.');
        }

        const item = d.item;
        estado.tcor = item;
        estado.qtdQuestoes = item.qtd_questoes || 12;
        estado.marcacoes = {};

        /* Exibe nome + variante do aluno dono como confirmação visual */
        const nomeWrap = $('ppTcorNomeWrap');
        const nomeEl   = $('ppTcorNomeAluno');
        if (nomeWrap && nomeEl) {
            nomeEl.textContent = item.aluno_nome || '(sem nome)';
            nomeWrap.style.display = 'flex';
        }
        const varWrap = $('ppTcorVarianteWrap');
        const varEl   = $('ppTcorVariante');
        if (varWrap && varEl && item.variante_codigo != null) {
            varEl.textContent = item.variante_codigo;
            varWrap.style.display = '';
        }

        /* Botão de consulta ao PDF da folha de prova — abre painel embutido */
        const btnPdf  = $('ppTcorBtnPdf');
        const linkVar = $('ppTcorLinkVariante');
        if (linkVar) linkVar.textContent = item.variante_codigo || '';
        estado.tcorPdfAberto    = false;
        estado.tcorTempoRestante = 0;
        estado.tcorIntervalId   = null;
        if (btnPdf) {
            if (item.link_prova) {
                estado.tcorPdfUrl = `/api/alunos-portal/turma-corretora/prova-pdf/${item.submissao_ref_id}`;
                btnPdf.onclick = _tcorTogglePdf;
                btnPdf.disabled = false;
                btnPdf.style.opacity = '';
                btnPdf.style.cursor = 'pointer';
                btnPdf.style.background = '#eff6ff';
                btnPdf.style.color = '#1d4ed8';
                btnPdf.style.borderColor = '#93c5fd';
            } else {
                estado.tcorPdfUrl = null;
                btnPdf.disabled = true;
                btnPdf.style.opacity = '0.55';
                btnPdf.style.cursor = 'not-allowed';
                btnPdf.style.background = '#f3f4f6';
                btnPdf.style.color = '#9ca3af';
                btnPdf.style.borderColor = '#d1d5db';
                btnPdf.innerHTML = '📄 Folha não anexada pelo professor';
            }
        }

        if (item.foto_url) {
            $('ppTcorFoto').src = item.foto_url;
            $('ppTcorFoto').style.display = '';
        } else {
            $('ppTcorFoto').style.display = 'none';
        }

        estado.tcorQuestoesTxt = _lerQuestoesTxt(item.prova_id, item.variante_codigo);
        renderTabelaTcor();

        /* Restaura rascunho de turma corretora se existir */
        const chaveTcor = _chaveRascunhoTcor();
        if (chaveTcor) {
            const rascunho = _lerRascunho(chaveTcor);
            if (rascunho && Object.keys(rascunho).length > 0) {
                estado.marcacoes = rascunho;
                for (const [q, letra] of Object.entries(rascunho)) {
                    document.querySelectorAll(`.pp-bolha[data-q="${q}"]`).forEach(el => {
                        el.classList.toggle('pp-marcada', el.dataset.l === letra);
                    });
                }
                _mostrarAvisoRascunho($('ppTurmaCorretora'));
            }
        }

        /* Anti-chute: cronômetro mínimo de leitura (só se houver PDF) */
        if (estado.tcorPdfUrl) {
            const tempoMin = Math.min(Math.max((estado.qtdQuestoes || 12) * 5, 20), 180);
            estado.tcorTempoRestante = tempoMin;
            const btnEnv = $('ppTcorBtn');
            if (btnEnv) btnEnv.disabled = true;
            const badge = $('ppTcorCronometro');
            if (badge) {
                badge.textContent = `Consulte as questões da prova antes de enviar. Aguarde ${tempoMin}s`;
                badge.style.display = '';
            }
        }

        show('ppTurmaCorretora');
    } catch (e) { showErro(e.message); }
}

/* ── Painel PDF embutido e cronômetro anti-chute ─────────── */

function _tcorTogglePdf() {
    const painel = $('ppTcorPainelPdf');
    const iframe  = $('ppTcorIframePdf');
    const btnPdf  = $('ppTcorBtnPdf');
    const layout  = $('ppTcorLayout');
    const varCod  = estado.tcor?.variante_codigo != null ? String(estado.tcor.variante_codigo) : '';

    const isOpen = painel && painel.style.display !== 'none';

    if (isOpen) {
        painel.style.display = 'none';
        if (layout) layout.classList.remove('pp-tcor-split-ativo');
        document.body.classList.remove('pp-tcor-split-ativo');
        if (btnPdf) {
            btnPdf.innerHTML = `📄 Ver folha de prova — Variante <strong style="font-size:1.15em;margin-left:2px">${escHtml(varCod)}</strong>`;
            btnPdf.style.background   = '#eff6ff';
            btnPdf.style.color        = '#1d4ed8';
            btnPdf.style.borderColor  = '#93c5fd';
        }
        _tcorPausarCronometro();
        estado.tcorPdfAberto = false;
    } else {
        if (iframe && estado.tcorPdfUrl && !iframe.getAttribute('data-carregado')) {
            iframe.src = estado.tcorPdfUrl;
            iframe.setAttribute('data-carregado', '1');
        }
        painel.style.display = 'flex';
        if (layout) layout.classList.add('pp-tcor-split-ativo');
        document.body.classList.add('pp-tcor-split-ativo');
        if (btnPdf) {
            btnPdf.innerHTML         = '✕ Fechar PDF';
            btnPdf.style.background  = '#fef2f2';
            btnPdf.style.color       = '#dc2626';
            btnPdf.style.borderColor = '#fca5a5';
        }
        _tcorIniciarCronometro();
        estado.tcorPdfAberto = true;
    }
}

function _tcorIniciarCronometro() {
    if (estado.tcorTempoRestante <= 0) return;
    if (estado.tcorIntervalId) return;
    estado.tcorIntervalId = setInterval(() => {
        estado.tcorTempoRestante = Math.max(0, estado.tcorTempoRestante - 1);
        _tcorAtualizarCronometro();
        if (estado.tcorTempoRestante <= 0) {
            clearInterval(estado.tcorIntervalId);
            estado.tcorIntervalId = null;
            _tcorFinalizarCronometro();
        }
    }, 1000);
}

function _tcorPausarCronometro() {
    if (estado.tcorIntervalId) {
        clearInterval(estado.tcorIntervalId);
        estado.tcorIntervalId = null;
    }
}

function _tcorAtualizarCronometro() {
    const badge = $('ppTcorCronometro');
    if (!badge) return;
    badge.textContent = `Consulte as questões da prova antes de enviar. Aguarde ${estado.tcorTempoRestante}s`;
}

function _tcorFinalizarCronometro() {
    const badge = $('ppTcorCronometro');
    if (badge) badge.style.display = 'none';
    const btn = $('ppTcorBtn');
    if (btn) btn.disabled = false;
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
        const nAltsTcor = estado.tcor?.questoes_n_alts?.[q - 1];
        const temETcor = nAltsTcor === 5 || (qInfo && qInfo.alternativas && qInfo.alternativas['e']);
        const letrasTcor = temETcor ? LETRAS.slice(0, 5) : LETRAS.slice(0, 4);
        for (const letra of letrasTcor) {
            html += `<span class="pp-bolha" data-q="${q}" data-l="${letra}" onclick="marcar(${q},'${letra}')">${letra.toUpperCase()}</span>`;
        }
        html += `</div></td></tr>`;
    }
    html += `</tbody></table>`;
    wrap.innerHTML = html;
}

async function enviarTurmaCorretora() {
    _tcorPausarCronometro();
    document.body.classList.remove('pp-tcor-split-ativo');
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
        if (r.status === 409 && (d.erro || '').includes('já corrigiu')) {
            const chaveTcor = _chaveRascunhoTcor();
            if (chaveTcor) _apagarRascunho(chaveTcor);
            notificar('✅ Correção já registrada!');
            setTimeout(() => { location.href = '/alunos/'; }, 2000);
            return;
        }
        if (!r.ok) throw new Error(d.erro || 'Erro ao enviar.');
        const chaveTcor = _chaveRascunhoTcor();
        if (chaveTcor) _apagarRascunho(chaveTcor);
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
        estado.segMiniQuiz = false;
        estado.segQuestoesMiniQuiz = null;

        if (pend.foto_url) {
            $('ppSegFoto').src = pend.foto_url;
            $('ppSegFoto').style.display = '';
            const aviso = $('ppSegMiniQuizAviso');
            if (aviso) aviso.style.display = 'none';
        } else {
            $('ppSegFoto').style.display = 'none';
            estado.segMiniQuiz = true;

            /* Busca as questões para o mini-quiz */
            try {
                const qr = await fetch(
                    `/api/alunos-portal/segundo-corretor/${encodeURIComponent(subRefId)}/questoes`,
                    { credentials: 'include' }
                );
                const qd = await qr.json();
                if (qr.ok) {
                    estado.segQuestoesMiniQuiz = qd.questoes || [];
                    if (qd.qtd_questoes) pend.qtd_questoes = qd.qtd_questoes;
                }
            } catch (_) { /* usa fallback de qtd_questoes */ }

            const aviso = $('ppSegMiniQuizAviso');
            if (aviso) aviso.style.display = '';
        }

        estado.qtdQuestoes = pend.qtd_questoes || 12;
        estado.segQuestoesTxt = _lerQuestoesTxt(pend.prova_id, pend.variante_codigo);

        const segVarWrap = $('ppSegVarianteWrap');
        const segVarEl   = $('ppSegVariante');
        if (segVarWrap && segVarEl && pend.variante_codigo != null) {
            segVarEl.textContent = pend.variante_codigo;
            segVarWrap.style.display = '';
        } else if (segVarWrap) {
            segVarWrap.style.display = 'none';
        }

        renderTabelaSegundo();
        show('ppSegundo');
    } catch (e) { showErro(e.message); }
}

function renderTabelaSegundo() {
    const wrap = $('ppSegTabela');
    const qt = estado.segQuestoesTxt || null;
    const miniQuiz = estado.segMiniQuiz;
    const mqQuestoes = estado.segQuestoesMiniQuiz || [];

    const cabecalho = miniQuiz
        ? 'Qual você acha que é a resposta correta?'
        : 'O que está marcado na folha';

    let html = `<table class="pp-tabela pp-tabela-cor"><thead><tr>
        <th style="width:40px">#</th>
        <th>${cabecalho}</th>
    </tr></thead><tbody>`;

    for (let q = 1; q <= estado.qtdQuestoes; q++) {
        const qInfo = qt ? qt[q] : null;
        const mqInfo = miniQuiz ? (mqQuestoes[q - 1] || null) : null;
        const tipo = mqInfo?.tipo || 'multipla';

        html += `<tr><td class="pp-q-num">${q}</td><td class="pp-td-cor">`;

        /* Enunciado: prioridade 1 = localStorage cache (qInfo.enunciado),
           prioridade 2 = endpoint mini-quiz (mqInfo.enunciado),
           prioridade 3 = alternativas do endpoint sem enunciado */
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
        } else if (mqInfo && (mqInfo.enunciado || mqInfo.alternativas)) {
            /* Enunciado e/ou alternativas vindos do endpoint mini-quiz */
            const enuncFull  = mqInfo.enunciado ? escHtml(mqInfo.enunciado) : null;
            const resumo     = mqInfo.enunciado
                ? escHtml(mqInfo.enunciado.slice(0, 80)) + (mqInfo.enunciado.length > 80 ? '…' : '')
                : 'Ver alternativas…';
            const altObj = mqInfo.alternativas;
            const temAlt = altObj && typeof altObj === 'object' && !Array.isArray(altObj)
                && Object.keys(altObj).some(k => altObj[k]);
            if (enuncFull || temAlt) {
                html += `<details class="pp-qtxt"><summary class="pp-qtxt-summary">${resumo}</summary>`;
                if (enuncFull) html += `<div class="pp-qtxt-body">${enuncFull}</div>`;
                if (temAlt) {
                    for (const letra of Object.keys(altObj).filter(k => altObj[k])) {
                        html += `<div class="pp-qtxt-alt"><span class="pp-qtxt-letra">${letra.toUpperCase()}</span> ${escHtml(altObj[letra])}</div>`;
                    }
                }
                html += `</details>`;
            }
        }

        html += `<div class="pp-bolhas-row">`;

        if (miniQuiz && tipo === 'vf') {
            /* V/F mini-quiz: per-sub-item V/F selection, stored as array */
            const vfCount = mqInfo?.vf_count || 4;
            html += `</div><div class="pp-vf-grid">`;
            for (let si = 0; si < vfCount; si++) {
                html += `<div class="pp-vf-row">
                    <span class="pp-vf-idx">${si + 1}</span>
                    <span class="pp-bolha-vf" data-q="${q}" data-sub="${si}" data-l="V" onclick="marcarVF(${q},${si},'V',${vfCount})">V</span>
                    <span class="pp-bolha-vf" data-q="${q}" data-sub="${si}" data-l="F" onclick="marcarVF(${q},${si},'F',${vfCount})">F</span>
                </div>`;
            }
        } else if (miniQuiz && tipo === 'discursiva') {
            /* Discursiva em mini-quiz: não há bolhas — o corretor só visualiza o enunciado */
            html += `<span style="font-size:12px;color:var(--pp-muted);font-style:italic">Questão discursiva — não marcável</span>`;
        } else {
            /* multipla ou desconhecido: determina quantas letras */
            let nAlts = mqInfo?.n_alternativas || estado.segundo?.questoes_n_alts?.[q - 1] || null;
            let temE = qInfo && qInfo.alternativas && qInfo.alternativas['e'];
            if (!temE && mqInfo && mqInfo.alternativas && typeof mqInfo.alternativas === 'object') {
                temE = !!mqInfo.alternativas['e'];
            }
            const letrasSeg = nAlts === 5 || temE ? LETRAS.slice(0, 5) : LETRAS.slice(0, 4);
            for (const letra of letrasSeg) {
                html += `<span class="pp-bolha" data-q="${q}" data-l="${letra}" onclick="marcar(${q},'${letra}')">${letra.toUpperCase()}</span>`;
            }
        }

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
window.marcarVF               = marcarVF;
window.voltarVariante         = voltarVariante;
window.confirmarMarcacoes     = confirmarMarcacoes;
window.previewFoto            = previewFoto;
window.enviarSubmissao        = enviarSubmissao;
window.enviarFotoOuSubmissao  = enviarFotoOuSubmissao;
window.verResultado           = verResultado;

init();
