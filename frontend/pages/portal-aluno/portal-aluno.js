'use strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (path, opts = {}) => fetch(`/api${path}`, { credentials: 'include', ...opts });

const TIPO_LABEL = {
    ASSIGNMENT:               'Tarefa',
    SHORT_ANSWER_QUESTION:    'Pergunta',
    MULTIPLE_CHOICE_QUESTION: 'Múltipla escolha',
    QUIZ:                     'Questionário',
};

/* ════════════════════════════════════════════
   Modo (aluno / disciplina)
   ════════════════════════════════════════════ */
function trocarModo(modo) {
    document.querySelectorAll('.pa-modo-btn').forEach(b => {
        b.classList.toggle('pa-modo-btn--ativo', b.dataset.modo === modo);
    });
    document.getElementById('paModoAluno').style.display      = modo === 'aluno'      ? 'flex' : 'none';
    document.getElementById('paModoDisciplina').style.display = modo === 'disciplina' ? 'flex' : 'none';
    document.getElementById('paResultado').innerHTML = '';
    _iframeReady = false;
    _iframePendingData = null;
}

/* ════════════════════════════════════════════
   Modo: Por aluno
   ════════════════════════════════════════════ */
async function buscarPortalAluno() {
    const sel    = document.getElementById('paAlunoSelect');
    const userId = sel ? sel.value : '';
    const nome   = sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex].text : '';
    const wrap   = document.getElementById('paResultado');

    if (!userId) {
        wrap.innerHTML = '<p class="pa-msg pa-msg--erro">⚠ Selecione um aluno na lista acima.</p>';
        return;
    }

    mostrarCarregando(wrap, `Buscando atividades de ${nome || 'aluno'}…`);

    try {
        const res  = await api(`/admin/portal-aluno/preview?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.erro || 'Erro desconhecido.');
        mostrarIframePrevia({ nomeAluno: nome || data.email, data });
    } catch (e) {
        wrap.innerHTML = `<p class="pa-msg pa-msg--erro">Erro: ${esc(e.message)}</p>`;
    }
}

/* ── Carrega lista de alunos de uma turma ── */
async function carregarAlunos(cursoId) {
    const selAluno  = document.getElementById('paAlunoSelect');
    const resultado = document.getElementById('paResultado');

    if (!cursoId) {
        selAluno.innerHTML = '<option value="">— Selecione primeiro uma turma —</option>';
        selAluno.disabled  = true;
        resultado.innerHTML = '';
        return;
    }

    selAluno.innerHTML = '<option value="">— Carregando alunos… —</option>';
    selAluno.disabled  = true;
    resultado.innerHTML = '';

    try {
        const res    = await api(`/admin/portal-aluno/alunos?cursoId=${encodeURIComponent(cursoId)}`);
        const alunos = await res.json();
        if (!res.ok) throw new Error(alunos.erro || 'Erro');

        if (!alunos.length) {
            selAluno.innerHTML = '<option value="">Nenhum aluno encontrado nesta turma</option>';
            return;
        }

        selAluno.innerHTML = '<option value="">— Selecione um aluno —</option>' +
            alunos.map(a => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join('');
        selAluno.disabled = false;
    } catch (e) {
        selAluno.innerHTML = `<option value="">Erro: ${esc(e.message)}</option>`;
    }
}

/* ════════════════════════════════════════════
   iframe de prévia fiel
   ════════════════════════════════════════════ */
let _iframeReady       = false;
let _iframePendingData = null;

/* Envia dados ao iframe assim que ele avisar que está pronto */
window.addEventListener('message', ev => {
    if (!ev.data) return;

    if (ev.data.tipo === 'edusync:previa-pronto') {
        _iframeReady = true;
        if (_iframePendingData) {
            enviarDadosIframe(_iframePendingData);
            _iframePendingData = null;
        }
    }

    if (ev.data.tipo === 'edusync:previa-altura') {
        const iframe = document.getElementById('paPreviaFrame');
        if (iframe && ev.data.altura) {
            iframe.style.height = (ev.data.altura + 32) + 'px';
        }
    }
});

function enviarDadosIframe(payload) {
    const iframe = document.getElementById('paPreviaFrame');
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({
        tipo:       'edusync:previa-aluno',
        nomeAluno:  payload.nomeAluno,
        data:       payload.data,
        tema:       document.documentElement.getAttribute('data-theme') || 'light',
        solicitacoes: payload.solicitacoes || [],
    }, window.location.origin);
}

function mostrarIframePrevia({ nomeAluno, data, solicitacoes = [] }) {
    const wrap = document.getElementById('paResultado');

    /* Verifica se o iframe já existe */
    let iframe = document.getElementById('paPreviaFrame');

    if (!iframe) {
        /* Monta o container da prévia */
        wrap.innerHTML = `
            <div class="prev-container">
                <div class="prev-header">
                    <div class="prev-header-left">
                        <span class="prev-titulo">👁 Como o aluno está vendo</span>
                        <span class="prev-aluno-nome" id="prevContainerNome"></span>
                    </div>
                    <div class="prev-header-actions">
                        <button class="prev-btn-tema" onclick="alternarTemaPrevia()" title="Alternar tema claro/escuro">🌙 Tema</button>
                        <button class="prev-btn-abrir" onclick="abrirPreviaJanela()" title="Abrir em nova aba">↗ Nova aba</button>
                    </div>
                </div>
                <div class="prev-device">
                    <iframe id="paPreviaFrame"
                            src="/pages/portal-aluno/preview.html"
                            class="prev-iframe"
                            title="Prévia do Portal do Aluno"
                            scrolling="yes">
                    </iframe>
                </div>
            </div>`;

        iframe = document.getElementById('paPreviaFrame');
        _iframeReady = false;
    }

    /* Atualiza nome no container */
    const nomeEl = document.getElementById('prevContainerNome');
    if (nomeEl) nomeEl.textContent = nomeAluno;

    /* Guarda os dados para enviar quando o iframe estiver pronto */
    const payload = { nomeAluno, data, solicitacoes };
    if (_iframeReady) {
        enviarDadosIframe(payload);
    } else {
        _iframePendingData = payload;
    }
}

/* Alterna tema dentro do iframe */
window.alternarTemaPrevia = function () {
    const iframe = document.getElementById('paPreviaFrame');
    if (!iframe || !iframe.contentWindow) return;
    const temaAtual = document.documentElement.getAttribute('data-theme') || 'light';
    const novoTema  = temaAtual === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novoTema);
    iframe.contentWindow.postMessage({
        tipo: 'edusync:previa-aluno',
        nomeAluno: document.getElementById('prevContainerNome')?.textContent || '',
        data: _iframePendingData?.data || {},
        tema: novoTema,
        solicitacoes: [],
    }, window.location.origin);
};

/* Abre a prévia em nova aba */
window.abrirPreviaJanela = function () {
    window.open('/pages/portal-aluno/preview.html', '_blank', 'noopener');
};

/* ════════════════════════════════════════════
   Modo: Por disciplina
   ════════════════════════════════════════════ */
function extrairTurma(nome) {
    const m = nome.match(/(\d+[ºª°]?\s*Ano\s+\w+\s+(?:Manha|Tarde|Noite)[^·]*)/i);
    if (m) return m[1].trim().replace(/\s*-\s*$/, '');
    const idx = nome.indexOf(' - ');
    if (idx !== -1) return nome.slice(idx + 3).trim();
    return 'Outras';
}

function extrairDisciplina(nome) {
    const idx = nome.indexOf(' - ');
    return idx !== -1 ? nome.slice(0, idx).trim() : nome;
}

async function carregarCursos() {
    try {
        const res    = await api('/admin/portal-aluno/cursos');
        const cursos = await res.json();
        if (!res.ok) throw new Error(cursos.erro || 'Erro');

        const grupos = {};
        for (const c of cursos) {
            const turma = extrairTurma(c.nome);
            if (!grupos[turma]) grupos[turma] = [];
            grupos[turma].push(c);
        }

        const turmasOrdenadas = Object.keys(grupos).sort((a, b) => {
            const na = parseInt(a) || 99;
            const nb = parseInt(b) || 99;
            if (na !== nb) return na - nb;
            return a.localeCompare(b, 'pt-BR');
        });

        /* Seletor disciplina */
        const selDisciplina = document.getElementById('paCursoSelect');
        selDisciplina.innerHTML = '<option value="">— Selecione uma disciplina —</option>' +
            turmasOrdenadas.map(turma => {
                const itens = grupos[turma]
                    .sort((a, b) => extrairDisciplina(a.nome).localeCompare(extrairDisciplina(b.nome), 'pt-BR'))
                    .map(c => `<option value="${esc(c.id)}">${esc(extrairDisciplina(c.nome))}</option>`)
                    .join('');
                return `<optgroup label="${esc(turma)}">${itens}</optgroup>`;
            }).join('');

        /* Seletor turma (modo "Por aluno") */
        const selTurma = document.getElementById('paTurmaSelect');
        if (selTurma) {
            selTurma.innerHTML = '<option value="">— Selecione uma turma —</option>' +
                turmasOrdenadas.map(turma => {
                    const primeiroId = grupos[turma][0].id;
                    return `<option value="${esc(primeiroId)}">${esc(turma)}</option>`;
                }).join('');
        }
    } catch (e) {
        document.getElementById('paCursoSelect').innerHTML = `<option value="">Erro ao carregar: ${esc(e.message)}</option>`;
        const selTurma = document.getElementById('paTurmaSelect');
        if (selTurma) selTurma.innerHTML = `<option value="">Erro ao carregar turmas</option>`;
    }
}

async function buscarPortalDisciplina() {
    const cursoId = document.getElementById('paCursoSelect').value;
    if (!cursoId) { alert('Selecione uma disciplina.'); return; }
    const wrap = document.getElementById('paResultado');
    mostrarCarregando(wrap, 'Buscando alunos com pendências…');
    try {
        const res  = await api(`/admin/portal-aluno/disciplina?cursoId=${encodeURIComponent(cursoId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.erro || 'Erro desconhecido.');
        renderPreviewDisciplina(data, wrap);
    } catch (e) {
        wrap.innerHTML = `<p class="pa-msg pa-msg--erro">Erro: ${esc(e.message)}</p>`;
    }
}

function renderPreviewDisciplina({ curso, alunos, totalAlunos, totalComPendencia }, wrap) {
    if (!alunos.length) {
        wrap.innerHTML = `<p class="pa-msg">✅ Nenhum aluno com pendências em <strong>${esc(curso.nome)}</strong>.</p>`;
        return;
    }

    const html = `
    <div class="pa-disc-wrap">
        <div class="pa-disc-titulo">
            📚 ${esc(curso.nome)}${curso.secao ? ` · ${esc(curso.secao)}` : ''} —
            <strong>${totalComPendencia}</strong> de ${totalAlunos} aluno(s) com pendências
        </div>
        <div class="pa-disc-lista">
        ${alunos.map(a => `
        <div class="pa-curso-card">
            <div class="pa-curso-header" style="cursor:pointer"
                 onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'flex':'none'">
                <span>👤 ${esc(a.nome)} <span class="pa-disc-email">${esc(a.email)}</span></span>
                <span class="pa-badge">${a.atividades.length}</span>
            </div>
            <div class="pa-atividades" style="display:none">
                ${a.atividades.map(at => `
                <div class="pa-ativ-item ${at.vencida ? 'pa-ativ--vencida' : ''}">
                    <div style="flex:1;min-width:0">
                        <div class="pa-disc-ativ-titulo" title="${esc(at.titulo)}">${esc(at.titulo)}</div>
                        <div class="pa-disc-ativ-meta">
                            ${TIPO_LABEL[at.tipo] || at.tipo}
                            ${at.prazo ? ` · <span style="color:${at.vencida ? '#dc2626' : 'inherit'}">${at.vencida ? '⚠ Vencida' : '📅'} ${at.prazo}</span>` : ' · Sem prazo'}
                            ${at.pontos != null ? ` · ${at.pontos} pts` : ''}
                        </div>
                    </div>
                    ${at.link ? `<a href="${esc(at.link)}" target="_blank" class="pa-link-btn">Abrir</a>` : ''}
                </div>`).join('')}
            </div>
        </div>`).join('')}
        </div>
    </div>`;
    wrap.innerHTML = html;
}

/* ── Carregando ── */
function mostrarCarregando(wrap, msg = 'Buscando…') {
    wrap.innerHTML = `<p class="pa-msg" style="color:var(--text-muted)">${esc(msg)}</p>`;
}

/* ── Init ── */
carregarCursos();

(function () {
    const modo = new URLSearchParams(location.search).get('modo');
    if (modo === 'disciplina') trocarModo('disciplina');
})();
