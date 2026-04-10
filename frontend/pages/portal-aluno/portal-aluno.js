'use strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = (path, opts = {}) => fetch(`/api${path}`, { credentials: 'include', ...opts });

const TIPO_LABEL = {
    ASSIGNMENT:              'Tarefa',
    SHORT_ANSWER_QUESTION:   'Pergunta',
    MULTIPLE_CHOICE_QUESTION:'Múltipla escolha',
    QUIZ:                    'Questionário',
};

/* ── Modo (aluno / disciplina) ── */
function trocarModo(modo) {
    document.querySelectorAll('.pa-modo-btn').forEach(b => {
        b.classList.toggle('pa-modo-btn--ativo', b.dataset.modo === modo);
    });
    document.getElementById('paModoAluno').style.display      = modo === 'aluno'      ? 'flex' : 'none';
    document.getElementById('paModoDisciplina').style.display = modo === 'disciplina' ? 'flex' : 'none';
    document.getElementById('paResultado').innerHTML = '';
}

/* ── Modo: Por aluno ── */
async function buscarPortalAluno() {
    const sel    = document.getElementById('paAlunoSelect');
    const userId = sel ? sel.value : '';
    const nome   = sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex].text : '';
    const wrap   = document.getElementById('paResultado');

    if (!userId) {
        wrap.innerHTML = '<p style="color:#dc2626;font-size:.88rem;padding:8px 0">⚠ Selecione um aluno na lista acima.</p>';
        return;
    }
    wrap.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">Buscando atividades...</p>';
    try {
        const res  = await api(`/admin/portal-aluno/preview?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.erro || 'Erro desconhecido.');
        /* Substitui o studentId pela nome legível no cabeçalho do resultado */
        if (nome) data.email = nome;
        renderPreviewAluno(data, wrap);
    } catch (e) {
        wrap.innerHTML = `<p style="color:#dc2626;font-size:.9rem">Erro: ${esc(e.message)}</p>`;
    }
}

/* ── Carrega alunos de um curso (2ª etapa do "Por aluno") ── */
async function carregarAlunos(cursoId) {
    const selAluno  = document.getElementById('paAlunoSelect');
    const resultado = document.getElementById('paResultado');

    if (!cursoId) {
        selAluno.innerHTML = '<option value="">— Selecione primeiro uma turma —</option>';
        selAluno.disabled  = true;
        resultado.innerHTML = '';
        return;
    }

    selAluno.innerHTML = '<option value="">— Carregando alunos... —</option>';
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

function renderPreviewAluno({ email, cursos, totalPendentes, totalZeradas = 0, totalAguardando = 0 }, wrap) {
    const total = totalPendentes + totalZeradas + totalAguardando;
    if (!cursos.length || total === 0) {
        wrap.innerHTML = `<p style="color:var(--text-muted);font-size:.9rem">✅ Nenhuma atividade pendente para <strong>${esc(email)}</strong>.</p>`;
        return;
    }

    /* ── estilos inline (imunes a cache de CSS) ── */
    const S = {
        outerWrap:   'display:flex;flex-direction:column;gap:10px;margin-top:10px',
        card:        'border:1px solid var(--border);border-radius:10px;overflow:hidden',
        /* cabeçalhos de card por tipo */
        headerPend:  'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-hover);font-size:.83rem;font-weight:700;color:var(--text-primary);gap:8px',
        headerZer:   'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(135deg,#f97316 0%,#c2410c 100%);font-size:.83rem;font-weight:700;color:#fff;gap:8px',
        headerAguard:'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);font-size:.83rem;font-weight:700;color:#fff;gap:8px',
        badge:       'display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:rgba(255,255,255,.25);color:#fff;font-size:.72rem;font-weight:700;flex-shrink:0',
        badgePend:   'display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#6366f1;color:#fff;font-size:.72rem;font-weight:700;flex-shrink:0',
        /* sub-seções por grupo */
        subGrupo:    'border-left:4px solid #4285F4;background:rgba(59,130,246,.07);margin:8px 10px;border-radius:6px;overflow:hidden',
        subLivre:    'border-left:4px solid #f59e0b;background:rgba(245,158,11,.07);margin:8px 10px;border-radius:6px;overflow:hidden',
        subHdrGrupo: 'padding:6px 12px;background:rgba(59,130,246,.30);font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#93c5fd',
        subHdrLivre: 'padding:6px 12px;background:rgba(245,158,11,.35);font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fcd34d',
        /* item */
        itemBase:    'display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-top:1px solid rgba(128,128,128,.1)',
        /* tag de grupo */
        tag:         'display:inline-flex;align-items:center;font-size:.68rem;font-weight:700;color:#93c5fd;background:rgba(59,130,246,.18);border:1px solid rgba(59,130,246,.35);border-radius:4px;padding:1px 6px;white-space:nowrap;flex-shrink:0',
        /* status badges */
        statusAguard:'display:inline-flex;align-items:center;font-size:.68rem;font-weight:700;background:rgba(29,78,216,.12);color:#1d4ed8;border:1px solid rgba(29,78,216,.25);border-radius:4px;padding:1px 7px',
        statusZer:   'display:inline-flex;align-items:center;font-size:.68rem;font-weight:700;background:rgba(249,115,22,.12);color:#c2410c;border:1px solid rgba(249,115,22,.25);border-radius:4px;padding:1px 7px',
        statusDev:   'display:inline-flex;align-items:center;font-size:.68rem;font-weight:700;background:rgba(242,153,0,.12);color:#b45309;border:1px solid rgba(242,153,0,.3);border-radius:4px;padding:1px 7px',
        /* Quizizz tag */
        qzTag:       'display:inline-flex;align-items:center;gap:4px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);border-radius:5px;padding:1px 7px;font-size:.68rem',
        qzLabel:     'font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:.04em;font-size:.64rem',
        qzLink:      'color:#7c3aed;text-decoration:none;font-weight:700;border-bottom:1px dashed rgba(124,58,237,.4)',
        /* botões direita */
        btn:         'padding:4px 10px;border-radius:6px;background:#1e1b4b;color:#a5b4fc;font-size:.75rem;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0;margin-top:1px',
        btnZer:      'padding:4px 10px;border-radius:6px;background:#f97316;color:#fff;font-size:.75rem;font-weight:700;text-decoration:none;white-space:nowrap;flex-shrink:0;margin-top:1px',
        btnEntregue: 'font-size:.75rem;font-weight:600;color:#1d4ed8;white-space:nowrap;flex-shrink:0;margin-top:3px',
    };

    const qzHtml = (a) => {
        if (!a.quizizzId) return '';
        const isId = /^[0-9a-f]{24}$/i.test(a.quizizzId);
        const lnk  = isId ? `<a href="https://quizizz.com/admin/quiz/${a.quizizzId}" target="_blank" style="${S.qzLink}">Ver quiz ↗</a>` : '';
        return `<span style="${S.qzTag}"><span>🎮</span><span style="${S.qzLabel}">Quizizz</span>${lnk}</span>`;
    };

    const renderAtiv = (a, tipo = 'pend') => `
        <div style="${S.itemBase}">
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                    <span style="font-size:.83rem;font-weight:600;color:var(--text-primary)"
                          title="${esc(a.titulo)}">${esc(a.titulo)}</span>
                    ${a.grupoNome ? `<span style="${S.tag}">${esc(a.grupoNome)}</span>` : ''}
                    ${qzHtml(a)}
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:.75rem;color:var(--text-muted)">
                    <span>${TIPO_LABEL[a.tipo] || a.tipo}</span>
                    ${a.prazo ? `<span>·</span><span style="color:${a.vencida ? '#dc2626' : 'inherit'}">${a.vencida ? '⚠️ Vencida' : '📅'} ${esc(a.prazo)}</span>` : '<span>· Sem prazo</span>'}
                    ${a.pontos != null ? `<span>·</span><span>${a.pontos} pts</span>` : ''}
                    ${tipo === 'aguard'       ? `<span style="${S.statusAguard}">⏳ Aguardando correção</span>` : ''}
                    ${tipo === 'zer'          ? `<span style="${S.statusZer}">↩ Entrou com 0 pts</span>` : ''}
                    ${a.devolvida            ? `<span style="${S.statusDev}">↩ Devolvida</span>` : ''}
                </div>
            </div>
            ${tipo === 'aguard'
                ? `<span style="${S.btnEntregue}">Entregue</span>`
                : tipo === 'zer'
                    ? (a.link ? `<a href="${esc(a.link)}" target="_blank" style="${S.btnZer}">Tentar novamente ↗</a>` : '')
                    : (a.link ? `<a href="${esc(a.link)}" target="_blank" style="${S.btn}">Abrir ↗</a>` : '')
            }
        </div>`;

    const renderCursoSection = (c, tipo) => {
        const items = tipo === 'pend' ? c.atividades : tipo === 'zer' ? c.zeradas : c.aguardando;
        if (!items || !items.length) return '';

        const headerStyle = tipo === 'zer' ? S.headerZer : tipo === 'aguard' ? S.headerAguard : S.headerPend;
        const badgeStyle  = tipo === 'pend' ? S.badgePend : S.badge;
        const icone       = tipo === 'zer' ? '🎮' : tipo === 'aguard' ? '⏳' : '📚';
        const sufixo      = tipo === 'zer' ? ' · zeradas' : tipo === 'aguard' ? ' · aguardando' : '';

        if (tipo === 'pend' && c.temGrupos) {
            const emGrupo  = items.filter(a =>  a.emGrupo);
            const semGrupo = items.filter(a => !a.emGrupo);
            return `
            <div style="${S.card}">
                <div style="${headerStyle}">
                    <span>${icone} ${esc(c.nome)}${c.secao ? ` · <span style="font-weight:400;opacity:.8">${esc(c.secao)}</span>` : ''}${sufixo}</span>
                    <span style="${badgeStyle}">${items.length}</span>
                </div>
                ${emGrupo.length ? `<div style="${S.subGrupo}"><div style="${S.subHdrGrupo}">EM GRUPO · ${emGrupo.length}</div>${emGrupo.map(a => renderAtiv(a, tipo)).join('')}</div>` : ''}
                ${semGrupo.length ? `<div style="${S.subLivre}"><div style="${S.subHdrLivre}">SEM GRUPO · ${semGrupo.length}</div>${semGrupo.map(a => renderAtiv(a, tipo)).join('')}</div>` : ''}
            </div>`;
        }

        return `
        <div style="${S.card}">
            <div style="${headerStyle}">
                <span>${icone} ${esc(c.nome)}${c.secao ? ` · <span style="font-weight:400;opacity:.8">${esc(c.secao)}</span>` : ''}${sufixo}</span>
                <span style="${badgeStyle}">${items.length}</span>
            </div>
            ${items.map(a => renderAtiv(a, tipo)).join('')}
        </div>`;
    };

    /* ── Badges de resumo ── */
    const resumoParts = [];
    if (totalPendentes)  resumoParts.push(`<span style="color:#6366f1;font-weight:700">${totalPendentes} pendente${totalPendentes !== 1 ? 's' : ''}</span>`);
    if (totalAguardando) resumoParts.push(`<span style="color:#1d4ed8;font-weight:700">⏳ ${totalAguardando} aguardando</span>`);
    if (totalZeradas)    resumoParts.push(`<span style="color:#c2410c;font-weight:700">⚠️ ${totalZeradas} zerada${totalZeradas !== 1 ? 's' : ''}</span>`);

    const html = `
    <div style="border-top:1.5px solid #c7d2fe;padding-top:14px">
        <div style="font-size:.85rem;color:#4f46e5;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            📋 Portal de <strong>${esc(email)}</strong> — ${resumoParts.join(' &nbsp;·&nbsp; ')}
        </div>

        ${totalPendentes ? `
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6366f1;margin:10px 0 6px">
            📋 Pendentes (${totalPendentes})
        </div>
        <div style="${S.outerWrap}">
            ${cursos.filter(c => c.atividades.length).map(c => renderCursoSection(c, 'pend')).join('')}
        </div>` : ''}

        ${totalAguardando ? `
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#1d4ed8;margin:18px 0 6px">
            ⏳ Aguardando correção (${totalAguardando})
        </div>
        <div style="${S.outerWrap}">
            ${cursos.filter(c => c.aguardando?.length).map(c => renderCursoSection(c, 'aguard')).join('')}
        </div>` : ''}

        ${totalZeradas ? `
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#c2410c;margin:18px 0 6px">
            🎮 Entrou com 0 pts (${totalZeradas})
        </div>
        <div style="${S.outerWrap}">
            ${cursos.filter(c => c.zeradas?.length).map(c => renderCursoSection(c, 'zer')).join('')}
        </div>` : ''}
    </div>`;
    wrap.innerHTML = html;
}

/* ── Extrai a turma do nome do curso (ex: "Matemática - 2º Ano C Manha - Médio Integrado") ── */
function extrairTurma(nome) {
    /* Procura padrão: Nº Ano X Período (Manha/Tarde/Noite) */
    const m = nome.match(/(\d+[ºª°]?\s*Ano\s+\w+\s+(?:Manha|Tarde|Noite)[^·]*)/i);
    if (m) return m[1].trim().replace(/\s*-\s*$/, '');
    /* Fallback: usa a parte após o primeiro " - " */
    const idx = nome.indexOf(' - ');
    if (idx !== -1) return nome.slice(idx + 3).trim();
    return 'Outras';
}

/* ── Extrai só o nome da disciplina (antes da turma) ── */
function extrairDisciplina(nome) {
    const idx = nome.indexOf(' - ');
    return idx !== -1 ? nome.slice(0, idx).trim() : nome;
}

/* ── Modo: Por disciplina ── */
async function carregarCursos() {
    try {
        const res    = await api('/admin/portal-aluno/cursos');
        const cursos = await res.json();
        if (!res.ok) throw new Error(cursos.erro || 'Erro');

        /* Agrupa por turma */
        const grupos = {};
        for (const c of cursos) {
            const turma = extrairTurma(c.nome);
            if (!grupos[turma]) grupos[turma] = [];
            grupos[turma].push(c);
        }

        /* Ordena turmas: 1º Ano → 2º Ano → 3º Ano → resto */
        const turmasOrdenadas = Object.keys(grupos).sort((a, b) => {
            const na = parseInt(a) || 99;
            const nb = parseInt(b) || 99;
            if (na !== nb) return na - nb;
            return a.localeCompare(b, 'pt-BR');
        });

        /* ── Seletor de disciplina: optgroup por turma ── */
        const selDisciplina = document.getElementById('paCursoSelect');
        selDisciplina.innerHTML = '<option value="">— Selecione uma disciplina —</option>' +
            turmasOrdenadas.map(turma => {
                const itens = grupos[turma]
                    .sort((a, b) => extrairDisciplina(a.nome).localeCompare(extrairDisciplina(b.nome), 'pt-BR'))
                    .map(c => `<option value="${esc(c.id)}">${esc(extrairDisciplina(c.nome))}</option>`)
                    .join('');
                return `<optgroup label="${esc(turma)}">${itens}</optgroup>`;
            }).join('');

        /* ── Seletor de turma (modo "Por aluno"): 1 option por turma,
              value = cursoId do primeiro curso da turma (para buscar o roster) ── */
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
    wrap.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">Buscando alunos com pendências...</p>';
    try {
        const res  = await api(`/admin/portal-aluno/disciplina?cursoId=${encodeURIComponent(cursoId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.erro || 'Erro desconhecido.');
        renderPreviewDisciplina(data, wrap);
    } catch (e) {
        wrap.innerHTML = `<p style="color:#dc2626;font-size:.9rem">Erro: ${esc(e.message)}</p>`;
    }
}

function renderPreviewDisciplina({ curso, alunos, totalAlunos, totalComPendencia }, wrap) {
    if (!alunos.length) {
        wrap.innerHTML = `<p style="color:var(--text-muted);font-size:.9rem">✅ Nenhum aluno com pendências em <strong>${esc(curso.nome)}</strong>.</p>`;
        return;
    }

    const html = `
    <div style="border-top:1.5px solid #c7d2fe;padding-top:16px">
        <div style="font-size:.85rem;color:#4f46e5;font-weight:700;margin-bottom:14px">
            📚 ${esc(curso.nome)}${curso.secao ? ` · ${esc(curso.secao)}` : ''} —
            ${totalComPendencia} de ${totalAlunos} aluno(s) com pendências
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
        ${alunos.map(a => `
        <div class="pa-curso-card">
            <div class="pa-curso-header" style="cursor:pointer"
                 onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'flex':'none'">
                <span>👤 ${esc(a.nome)} <span style="font-weight:400;color:var(--text-muted);font-size:.75rem">${esc(a.email)}</span></span>
                <span class="pa-badge">${a.atividades.length}</span>
            </div>
            <div class="pa-atividades" style="display:none">
                ${a.atividades.map(at => `
                <div class="pa-ativ-item ${at.vencida ? 'pa-ativ--vencida' : ''}">
                    <div style="flex:1;min-width:0">
                        <div style="font-size:.83rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                             title="${esc(at.titulo)}">${esc(at.titulo)}</div>
                        <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">
                            ${TIPO_LABEL[at.tipo] || at.tipo}
                            ${at.prazo ? ` · <span style="color:${at.vencida ? '#dc2626' : 'var(--text-muted)'}">${at.vencida ? '⚠ Vencida' : '📅'} ${at.prazo}</span>` : ' · Sem prazo'}
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

/* ── Init ── */
carregarCursos();

/* URL param: ?modo=disciplina */
(function () {
    const modo = new URLSearchParams(location.search).get('modo');
    if (modo === 'disciplina') trocarModo('disciplina');
})();
