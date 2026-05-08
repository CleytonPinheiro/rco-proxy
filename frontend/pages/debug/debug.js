/* ── Estado global ── */
let dadosRaw = null;

function notificar(msg, tipo = 'ok') {
    const bg = tipo === 'erro' ? '#dc2626' : tipo === 'aviso' ? '#d97706' : '#16a34a';
    const old = document.getElementById('_toast_notif');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = '_toast_notif';
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;background:${bg};color:#fff;font-size:.9rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:360px;word-break:break-word;transition:opacity .3s`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, 3500);
}

/* ── Histórico de buscas (localStorage) ── */
const HIST_KEY = 'debug_rco_hist';
function carregarHistorico() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function salvarHistorico(avalId, codClasse) {
    const hist  = carregarHistorico().filter(h => h.avalId !== avalId);
    const novo  = [{ avalId, codClasse, ts: Date.now() }, ...hist].slice(0, 6);
    localStorage.setItem(HIST_KEY, JSON.stringify(novo));
}
function renderHistorico() {
    const hist = carregarHistorico();
    const el   = document.getElementById('historico');
    if (!el) return;
    if (!hist.length) { el.innerHTML = '<span style="color:var(--text-muted);font-size:.8rem">Nenhum ainda</span>'; return; }
    el.innerHTML = hist.map(h =>
        `<span class="historico-item" onclick="preencherForm('${h.avalId}','${h.codClasse || ''}')"
              title="${new Date(h.ts).toLocaleString('pt-BR')}">
            ${h.avalId}${h.codClasse ? ' / ' + h.codClasse : ''}
        </span>`
    ).join('');
}
function preencherForm(avalId, codClasse) {
    document.getElementById('inpAvaliacaoId').value  = avalId   || '';
    document.getElementById('inpCodClasse').value    = codClasse || '';
    buscarDebug();
}

/* ── Renderizador JSON com syntax highlight ── */
function jsonHL(val, depth = 0) {
    if (val === null)              return `<span class="jnull">null</span>`;
    if (typeof val === 'boolean')  return `<span class="jb">${val}</span>`;
    if (typeof val === 'number')   return `<span class="jn">${val}</span>`;
    if (typeof val === 'string')   return `<span class="js">"${esc(val)}"</span>`;
    const ind  = '  '.repeat(depth + 1);
    const ind0 = '  '.repeat(depth);
    if (Array.isArray(val)) {
        if (!val.length) return `<span class="jpunct">[]</span>`;
        const items = val.map(v => `${ind}${jsonHL(v, depth + 1)}`).join(`<span class="jpunct">,</span>\n`);
        return `<span class="jpunct">[</span>\n${items}\n${ind0}<span class="jpunct">]</span>`;
    }
    const keys = Object.keys(val);
    if (!keys.length) return `<span class="jpunct">{}</span>`;
    const pairs = keys.map(k =>
        `${ind}<span class="jk">"${esc(k)}"</span><span class="jpunct">: </span>${jsonHL(val[k], depth + 1)}`
    ).join(`<span class="jpunct">,</span>\n`);
    return `<span class="jpunct">{</span>\n${pairs}\n${ind0}<span class="jpunct">}</span>`;
}
function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function renderJson(elId, val) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = `<pre style="margin:0">${jsonHL(val)}</pre>`;
}

/* ── Resumo rápido ── */
function renderResumo(dados) {
    const av = dados.avaliacao?.data;
    const ma = dados.matrizAlunos?.data;
    const tk = dados.tokenInfo;
    const pp = dados.payloadPutSimulado;

    /* Avaliação */
    const rAvEl = document.getElementById('resumoAvaliacao');
    if (av) {
        const tipo = av.codTipoAvaliacaoParcial === 2 ? '🔄 Recuperação' : '📝 Principal';
        rAvEl.innerHTML = `
            <div class="resumo-titulo">Avaliação</div>
            <div class="resumo-valor">#${av.codAvaliacaoParcialClasse}</div>
            <div class="resumo-detalhe">${tipo} — ${av.descrAvaliacaoParcial || ''}</div>
            <div class="resumo-detalhe">Peso: <b>${av.pesoDecimal}</b> | Alunos no GET: <b>${av.alunos?.length ?? 0}</b></div>
            <div class="resumo-detalhe">dataAtualizacao: ${av.dataAtualizacao ?? '—'}</div>
        `;
    } else {
        rAvEl.innerHTML = `<div class="resumo-titulo">Avaliação</div><div class="tag-err">Erro ao buscar</div>`;
    }

    /* matrizAlunos */
    const rMaEl = document.getElementById('resumoMatriz');
    if (Array.isArray(ma)) {
        rMaEl.innerHTML = `
            <div class="resumo-titulo">matrizAlunos</div>
            <div class="resumo-valor tag-ok">${ma.length}</div>
            <div class="resumo-detalhe">alunos carregados</div>
        `;
    } else {
        const aviso = dados.matrizAlunos?.aviso || dados.matrizAlunos?.erro || 'sem dados';
        rMaEl.innerHTML = `<div class="resumo-titulo">matrizAlunos</div><div class="tag-warn">${esc(aviso)}</div>`;
    }

    /* Token */
    const rTkEl = document.getElementById('resumoToken');
    if (tk && !tk.erro) {
        const exp = new Date(tk.exp);
        const ok  = exp > new Date();
        rTkEl.innerHTML = `
            <div class="resumo-titulo">Token RCO</div>
            <div class="resumo-valor ${ok ? 'tag-ok' : 'tag-err'}">${ok ? '✓ Válido' : '✗ Expirado'}</div>
            <div class="resumo-detalhe">codUsuario: <b>${tk.codUsuario}</b></div>
            <div class="resumo-detalhe">Expira: ${exp.toLocaleString('pt-BR')}</div>
        `;
    } else {
        rTkEl.innerHTML = `<div class="resumo-titulo">Token RCO</div><div class="tag-err">Erro</div>`;
    }

    /* Payload simulado */
    const rPpEl = document.getElementById('resumoPayload');
    const res   = pp?._resumo;
    if (res) {
        const semMatriz = res.semMatriz > 0
            ? `<div class="resumo-detalhe tag-warn">⚠ ${res.semMatriz} sem matrizAlunos</div>`
            : `<div class="resumo-detalhe tag-ok">✓ Todos com matrizAlunos</div>`;
        rPpEl.innerHTML = `
            <div class="resumo-titulo">Payload simulado</div>
            <div class="resumo-valor">${res.totalAlunos} alunos</div>
            <div class="resumo-detalhe">Com nota atual: <b>${res.comNotaAtual}</b></div>
            ${semMatriz}
        `;
    } else {
        rPpEl.innerHTML = `<div class="resumo-titulo">Payload simulado</div><div class="tag-warn">codClasse necessário</div>`;
    }
}

/* ── Tabela de alunos do payload simulado ── */
function renderTabelaAlunos(alunos) {
    const wrapper = document.getElementById('alunos-table-wrapper');
    if (!alunos?.length) { wrapper.innerHTML = ''; return; }

    const linhas = alunos.map(a => {
        const temMatriz = a._temMatriz;
        const nota      = a.notaDecimal;
        const badgeM    = temMatriz ? '<span class="badge-ok">✓ matriz</span>' : '<span class="badge-err">✗ sem matriz</span>';
        const notaCell  = nota != null ? `<b>${nota}</b>` : '<span class="tag-warn">—</span>';
        return `<tr>
            <td>${a.numChamada ?? '—'}</td>
            <td>${esc(a.nome ?? '—')}</td>
            <td style="font-family:monospace;font-size:.78rem">${a.codMatrizAluno}</td>
            <td>${a.codAvaliacaoParcialAluno ?? '—'}</td>
            <td>${notaCell}</td>
            <td>${badgeM}</td>
            <td>${esc(a.situacaoMatricula ?? '—')}</td>
            <td>${a.indAtivo != null ? (a.indAtivo ? '✓' : '✗') : '—'}</td>
        </tr>`;
    }).join('');

    wrapper.innerHTML = `
        <div class="alunos-scroll">
            <table class="alunos-table">
                <thead>
                    <tr>
                        <th>#</th><th>Nome</th><th>codMatrizAluno</th>
                        <th>codAvParcialAluno</th><th>notaDecimal atual</th>
                        <th>matrizAlunos</th><th>situação</th><th>ativo</th>
                    </tr>
                </thead>
                <tbody>${linhas}</tbody>
            </table>
        </div>
    `;
}

/* ── Busca principal ── */
async function buscarDebug() {
    const avalId   = document.getElementById('inpAvaliacaoId').value.trim();
    const codClasse = document.getElementById('inpCodClasse').value.trim();

    if (!avalId) {
        notificar('Informe o ID da avaliação.', 'aviso');
        return;
    }

    document.getElementById('debugLoading').style.display = 'flex';
    document.getElementById('debugResumo').style.display  = 'none';
    document.getElementById('debugTabs').style.display    = 'none';
    document.getElementById('btnBuscar').disabled         = true;

    try {
        const params = new URLSearchParams({ ...(codClasse ? { codClasse } : {}) });
        const resp   = await fetch(`/api/rco-lancamento/debug/${avalId}?${params}`, {
            credentials: 'include',
        });
        const dados  = await resp.json();
        dadosRaw     = dados;

        /* Salva histórico */
        salvarHistorico(avalId, codClasse);
        renderHistorico();

        /* Renderiza abas */
        renderJson('json-avaliacao', dados.avaliacao ?? {});
        renderJson('json-matriz',    dados.matrizAlunos ?? {});
        renderJson('json-roster',    dados.rosterAlunos ?? {});
        renderJson('json-token',     dados.tokenInfo ?? {});

        /* Payload simulado */
        const pp = dados.payloadPutSimulado;
        if (pp) {
            renderTabelaAlunos(pp.alunos);
            const res = pp._resumo;
            document.getElementById('info-payload').textContent =
                `${res.totalAlunos} alunos | ${res.comMatriz} com matriz | ${res.semMatriz} sem matriz`;

            /* Remove campo interno _resumo e _temMatriz para exibição limpa */
            const ppLimpo = { ...pp, alunos: pp.alunos.map(({ _temMatriz: _, ...a }) => a) };
            delete ppLimpo._resumo;
            renderJson('json-payload', ppLimpo);
        } else {
            document.getElementById('alunos-table-wrapper').innerHTML = '';
            renderJson('json-payload', { aviso: 'Forneça codClasse para gerar o payload simulado.' });
        }

        /* Info das abas */
        const ma = dados.matrizAlunos?.data;
        if (Array.isArray(ma)) {
            document.getElementById('info-matriz').textContent = `${ma.length} alunos`;
        }
        const ro = dados.rosterAlunos?.data;
        if (Array.isArray(ro)) {
            document.getElementById('info-roster').textContent = `${ro.length} alunos`;
        }

        /* JSON completo */
        document.getElementById('json-raw').textContent = JSON.stringify(dados, null, 2);

        /* Resumo */
        renderResumo(dados);

        document.getElementById('debugResumo').style.display = 'grid';
        document.getElementById('debugTabs').style.display   = 'block';

    } catch (e) {
        notificar('Erro ao buscar dados: ' + e.message, 'erro');
    } finally {
        document.getElementById('debugLoading').style.display = 'none';
        document.getElementById('btnBuscar').disabled         = false;
    }
}

/* ── Troca de abas ── */
function abrirTab(btn, tabId) {
    document.querySelectorAll('.dtab').forEach(b => b.classList.remove('dtab--ativo'));
    document.querySelectorAll('.dtab-content').forEach(c => c.classList.remove('dtab-content--ativo'));
    btn.classList.add('dtab--ativo');
    document.getElementById('tab-' + tabId)?.classList.add('dtab-content--ativo');
}

/* ── Copiar ── */
const tabData = {
    avaliacao: () => dadosRaw?.avaliacao,
    matriz:    () => dadosRaw?.matrizAlunos,
    roster:    () => dadosRaw?.rosterAlunos,
    payload:   () => dadosRaw?.payloadPutSimulado,
    token:     () => dadosRaw?.tokenInfo,
};
function copiarTab(tab) {
    const val = tabData[tab]?.();
    if (!val) return;
    navigator.clipboard.writeText(JSON.stringify(val, null, 2))
        .then(() => notificar('Copiado!'))
        .catch(() => notificar('Falha ao copiar.', 'erro'));
}
function copiarRaw() {
    if (!dadosRaw) return;
    navigator.clipboard.writeText(JSON.stringify(dadosRaw, null, 2))
        .then(() => notificar('JSON completo copiado!'))
        .catch(() => notificar('Falha ao copiar.', 'erro'));
}

/* ── Atalho: Enter nos inputs ── */
['inpAvaliacaoId', 'inpCodClasse'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') buscarDebug();
    });
});

/* ── Init ── */
renderHistorico();

/* Pré-preenche da URL (?id=X&codClasse=Y) */
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('id')) {
    document.getElementById('inpAvaliacaoId').value = urlParams.get('id');
    if (urlParams.get('codClasse')) {
        document.getElementById('inpCodClasse').value = urlParams.get('codClasse');
    }
    buscarDebug();
}
