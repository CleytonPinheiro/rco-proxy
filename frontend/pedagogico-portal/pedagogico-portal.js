'use strict';

const $ = id => document.getElementById(id);
const API = '/api/pedagogico-portal';

let _pedagogo = null;
let _cursoAtivo = null;
let _grupoAtivo = null;
let _alunosMap = {};

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function rco(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
}

async function api(path, opts = {}) {
    const url = API + path;
    const r = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.erro || `Erro ${r.status}`);
    }
    return r.json();
}

const TEMA_KEY = 'pedagogo_tema';
function temaAtual() { return document.documentElement.getAttribute('data-theme') || 'light'; }
function aplicarTema(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(TEMA_KEY, t);
    atualizarIconeTema(t);
}
function atualizarIconeTema(t) {
    const el = $('ppThemeIcon');
    if (el) el.textContent = t === 'dark' ? '☀️' : '🌙';
}
function toggleTema() { aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark'); }

function toggleDropdown(e) {
    e.stopPropagation();
    const wrap = $('ppPerfilWrap');
    const dd = $('ppDropdown');
    const aberto = wrap.classList.toggle('open');
    dd.style.display = aberto ? '' : 'none';
}
document.addEventListener('click', () => {
    const wrap = $('ppPerfilWrap');
    const dd = $('ppDropdown');
    if (!wrap) return;
    wrap.classList.remove('open');
    if (dd) dd.style.display = 'none';
});

let _toastTimer;
function toast(msg, tipo = 'info') {
    const el = $('ppToast');
    el.textContent = msg;
    el.className = 'pp-toast pp-toast--visivel' + (tipo === 'erro' ? ' pp-toast--erro' : tipo === 'ok' ? ' pp-toast--ok' : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('pp-toast--visivel'), 4000);
}

function loading(show) {
    $('ppLoading').style.display = show ? 'flex' : 'none';
}

function mostrarPreLogin() {
    $('ppPreLogin').style.display = '';
    $('ppDashboard').style.display = 'none';
    $('ppUserArea').style.display = 'none';
}

function mostrarDashboard(p) {
    _pedagogo = p;
    $('ppPreLogin').style.display = 'none';
    $('ppDashboard').style.display = '';
    $('ppUserArea').style.display = 'flex';

    $('ppUserNome').textContent = p.nome;
    $('ppDropNome').textContent = p.nome;
    $('ppDropEmail').textContent = p.email;

    const ini = (p.nome || 'P').charAt(0).toUpperCase();
    $('ppAvatarPlaceholder').textContent = ini;
    $('ppDropPlaceholder').textContent = ini;

    if (p.foto) {
        $('ppUserFoto').src = p.foto;
        $('ppUserFoto').style.display = '';
        $('ppAvatarPlaceholder').style.display = 'none';
        $('ppDropFoto').src = p.foto;
        $('ppDropFoto').style.display = '';
        $('ppDropPlaceholder').style.display = 'none';
    }

    carregarCursos();
}

async function entrarComGoogle() {
    try {
        const r = await api('/auth-url');
        location.href = r.url;
    } catch (e) {
        toast('Erro ao iniciar login: ' + e.message, 'erro');
    }
}

async function fazerLogout() {
    await api('/logout', { method: 'POST' }).catch(() => {});
    _pedagogo = null;
    _cursoAtivo = null;
    _grupoAtivo = null;
    _alunosMap = {};
    mostrarPreLogin();
    toast('Sessão encerrada.', 'ok');
}

async function carregarCursos() {
    _cursoAtivo = null;
    _grupoAtivo = null;
    $('ppTituloPagina').textContent = 'Disciplinas disponíveis';
    $('ppBtnVoltar').style.display = 'none';
    $('ppCursosList').style.display = '';
    $('ppGruposList').style.display = 'none';
    $('ppResumoArea').style.display = 'none';

    loading(true);
    try {
        const cursos = await api('/cursos');
        loading(false);
        if (!cursos.length) {
            $('ppCursosList').innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">📭</span>Nenhuma disciplina encontrada.</div>';
            return;
        }
        $('ppCursosList').innerHTML = cursos.map(c => `
            <div class="pp-curso-card" data-curso-id="${esc(c.id)}" data-curso-nome="${esc(c.nome)}">
                <h3>${esc(c.nome)}</h3>
                ${c.secao ? `<span class="pp-curso-secao">${esc(c.secao)}</span>` : ''}
            </div>
        `).join('');
        $('ppCursosList').querySelectorAll('.pp-curso-card').forEach(el => {
            el.addEventListener('click', () => selecionarCurso(el.dataset.cursoId, el.dataset.cursoNome));
        });
    } catch (e) {
        loading(false);
        toast('Erro ao carregar cursos: ' + e.message, 'erro');
    }
}

async function selecionarCurso(id, nome) {
    _cursoAtivo = { id, nome };
    _grupoAtivo = null;
    $('ppTituloPagina').textContent = nome;
    $('ppBtnVoltar').style.display = '';
    $('ppBtnVoltar').onclick = () => carregarCursos();
    $('ppCursosList').style.display = 'none';
    $('ppGruposList').style.display = '';
    $('ppResumoArea').style.display = 'none';

    loading(true);
    try {
        const [grupos] = await Promise.all([
            api('/grupos?courseId=' + id),
            carregarAlunosCurso(id),
        ]);
        loading(false);
        if (!grupos.length) {
            $('ppGruposList').innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">📂</span>Nenhum grupo criado para esta disciplina.</div>';
            return;
        }
        $('ppGruposList').innerHTML = grupos.map(g => {
            const fechado = !!g.dataFechamento;
            const isRec = g.tipo === 'recuperacao';
            let badges = '';
            if (fechado) badges += `<span class="pp-grupo-badge pp-grupo-badge--fechado">Fechado</span>`;
            if (isRec) badges += `<span class="pp-grupo-badge pp-grupo-badge--rec">Recuperação</span>`;

            return `<div class="pp-grupo-card" style="border-left-color:${g.cor || '#7c3aed'}" data-grupo-id="${g.id}">
                <h3>${esc(g.nome)}${badges}</h3>
                <div class="pp-grupo-meta">
                    <span>${g.atividades.length} atividade(s)</span>
                    <span>Meta: ${g.pontosMeta} pts</span>
                </div>
            </div>`;
        }).join('');
        window._gruposCache = grupos;
        $('ppGruposList').querySelectorAll('.pp-grupo-card').forEach(el => {
            el.addEventListener('click', () => selecionarGrupo(Number(el.dataset.grupoId)));
        });
    } catch (e) {
        loading(false);
        toast('Erro ao carregar grupos: ' + e.message, 'erro');
    }
}

async function carregarAlunosCurso(courseId) {
    try {
        _alunosMap = await api('/alunos?courseId=' + courseId);
    } catch (e) {
        _alunosMap = {};
    }
}

async function selecionarGrupo(grupoId) {
    const grupoData = (window._gruposCache || []).find(g => g.id === grupoId);
    if (!grupoData) return;
    _grupoAtivo = grupoData;

    $('ppGruposList').style.display = 'none';
    $('ppResumoArea').style.display = '';
    $('ppBtnVoltar').style.display = '';
    $('ppBtnVoltar').onclick = () => selecionarCurso(_cursoAtivo.id, _cursoAtivo.nome);

    $('ppResumoTitulo').textContent = grupoData.nome;

    let badgesHtml = '';
    if (grupoData.tipo === 'recuperacao') badgesHtml += '<span class="pp-grupo-badge pp-grupo-badge--rec">Recuperação</span>';
    if (grupoData.dataFechamento) badgesHtml += '<span class="pp-grupo-badge pp-grupo-badge--fechado">Fechado</span>';
    $('ppResumoBadges').innerHTML = badgesHtml;

    loading(true);
    try {
        const dados = await api(`/grupos/${grupoId}/summary?courseId=${_cursoAtivo.id}`);
        loading(false);
        renderResumo(dados, grupoData);
    } catch (e) {
        loading(false);
        toast('Erro ao carregar resumo: ' + e.message, 'erro');
    }
}

function renderResumo(dados, grupoData) {
    const { atividades, alunos } = dados;
    const totalAlunos = alunos.length;
    const media = totalAlunos
        ? rco(alunos.reduce((s, a) => s + a.mediaIndice, 0) / totalAlunos * grupoData.pontosMeta / 100)
        : '0.0';
    const pendentes = alunos.filter(a => a.pendentes > 0).length;
    const fechado = !!grupoData.dataFechamento;

    const statsHtml = `
        <div class="pp-stat-card"><div class="pp-stat-valor">${totalAlunos}</div><div class="pp-stat-label">Alunos</div></div>
        <div class="pp-stat-card"><div class="pp-stat-valor">${atividades.length}</div><div class="pp-stat-label">Atividades</div></div>
        <div class="pp-stat-card"><div class="pp-stat-valor">${media}</div><div class="pp-stat-label">Média (pts)</div></div>
        <div class="pp-stat-card ${pendentes > 0 ? 'pp-stat-card--warn' : ''}"><div class="pp-stat-valor">${pendentes}</div><div class="pp-stat-label">Com pendências</div></div>
    `;
    $('ppResumoStats').innerHTML = statsHtml;

    $('ppResumoActions').innerHTML = '';
    if (fechado) {
        const btnReabrir = document.createElement('button');
        btnReabrir.className = 'pp-btn pp-btn--accent pp-btn--sm';
        btnReabrir.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg> Reabrir grupo`;
        btnReabrir.addEventListener('click', () => reabrirGrupo(grupoData.id));
        $('ppResumoActions').appendChild(btnReabrir);
    }

    let thead = '<tr><th>Aluno</th>';
    atividades.forEach(a => {
        const titulo = a.titulo.length > 25 ? a.titulo.substring(0, 22) + '...' : a.titulo;
        thead += `<th title="${esc(a.titulo)}">${esc(titulo)}<br><small>${a.pontos ?? '?'} pts</small></th>`;
    });
    thead += '<th>Nota final</th><th>Pendências</th></tr>';
    $('ppResumoCabecalho').innerHTML = thead;

    const sorted = [...alunos].sort((a, b) => {
        const nA = (_alunosMap[a.userId]?.nome || '').toLowerCase();
        const nB = (_alunosMap[b.userId]?.nome || '').toLowerCase();
        return nA.localeCompare(nB);
    });

    let tbody = '';
    sorted.forEach(al => {
        const info = _alunosMap[al.userId] || {};
        const nome = info.nome || al.userId;
        const nota = rco(al.mediaIndice * grupoData.pontosMeta / 100);

        tbody += `<tr><td title="${esc(info.email || '')}">${esc(nome)}</td>`;
        atividades.forEach(a => {
            const sub = al.atividades[a.id];
            if (!sub) {
                tbody += '<td class="pp-nota--pendente">-</td>';
                return;
            }
            if (sub.eDeRecuperacao) {
                tbody += `<td class="pp-nota--rec" title="Pertence à recuperação">${sub.nota != null ? sub.nota : '-'}</td>`;
            } else if (sub.eTardia) {
                tbody += `<td class="pp-nota--tardia" title="Entrega tardia">${sub.nota != null ? sub.nota : '-'}</td>`;
            } else if (sub.nota != null) {
                const cls = sub.nota === 0 ? 'pp-nota--zero' : '';
                tbody += `<td class="${cls}">${sub.nota}</td>`;
            } else if (!sub.entregue) {
                tbody += '<td class="pp-nota--pendente">N/E</td>';
            } else {
                tbody += '<td>Entregue</td>';
            }
        });
        tbody += `<td><strong>${nota}</strong></td>`;
        tbody += `<td>${al.pendentes > 0 ? `<span style="color:var(--pp-warn)">${al.pendentes}</span>` : '0'}</td>`;
        tbody += '</tr>';
    });
    $('ppResumoCorpo').innerHTML = tbody || '<tr><td colspan="100" class="pp-empty">Nenhum aluno encontrado.</td></tr>';
}

async function reabrirGrupo(grupoId) {
    if (!confirm('Tem certeza que deseja reabrir este grupo? As notas serão recalculadas incluindo entregas tardias.')) return;

    loading(true);
    try {
        await api(`/grupos/${grupoId}/abrir`, { method: 'POST', body: {} });
        toast('Grupo reaberto com sucesso!', 'ok');

        const gIdx = (window._gruposCache || []).findIndex(g => g.id === grupoId);
        if (gIdx >= 0) {
            window._gruposCache[gIdx].dataFechamento = null;
        }
        if (_grupoAtivo && _grupoAtivo.id === grupoId) {
            _grupoAtivo.dataFechamento = null;
        }

        await selecionarGrupo(grupoId);
    } catch (e) {
        toast('Erro ao reabrir: ' + e.message, 'erro');
    }
    loading(false);
}

function voltarParaCursos() {
    carregarCursos();
}

document.addEventListener('DOMContentLoaded', async () => {
    atualizarIconeTema(temaAtual());

    const params = new URLSearchParams(location.search);
    const erro = params.get('erro');
    if (erro) {
        const msgs = {
            acesso_negado:       'Acesso negado pelo Google.',
            sem_email:           'Não foi possível obter seu e-mail.',
            falha_auth:          'Erro durante a autenticação.',
            sem_credenciais:     'Google não configurado no servidor.',
            email_nao_verificado:'Seu e-mail não está verificado no Google.',
            dominio_invalido:    'Acesso restrito a e-mails institucionais (@escola.pr.gov.br).',
        };
        toast(msgs[erro] || 'Erro desconhecido.', 'erro');
        history.replaceState(null, '', location.pathname);
    }

    try {
        const r = await api('/status');
        if (r.pedagogo) {
            mostrarDashboard(r.pedagogo);
        } else {
            mostrarPreLogin();
        }
    } catch {
        mostrarPreLogin();
    }
});
