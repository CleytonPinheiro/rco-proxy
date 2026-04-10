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

function renderPreviewAluno({ email, cursos, totalPendentes }, wrap) {
    if (!cursos.length) {
        wrap.innerHTML = `<p style="color:var(--text-muted);font-size:.9rem">✅ Nenhuma atividade pendente para <strong>${esc(email)}</strong>.</p>`;
        return;
    }

    const html = `
    <div style="border-top:1.5px solid #c7d2fe;padding-top:16px">
        <div style="font-size:.85rem;color:#4f46e5;font-weight:700;margin-bottom:14px">
            📋 Portal de <strong>${esc(email)}</strong> — ${totalPendentes} atividade(s) pendente(s)
        </div>
        ${cursos.map(c => `
        <div class="pa-curso-card">
            <div class="pa-curso-header">
                <span>📚 ${esc(c.nome)}${c.secao ? ` <span style="font-weight:400;color:var(--text-muted)">· ${esc(c.secao)}</span>` : ''}
                ${c.temGrupos ? `<span style="margin-left:6px;font-size:.7rem;font-weight:600;background:rgba(66,133,244,.15);color:#4285F4;border:1px solid rgba(66,133,244,.3);border-radius:4px;padding:1px 6px">com grupos</span>` : ''}
                </span>
                <span class="pa-badge">${c.atividades.length}</span>
            </div>
            <div class="pa-atividades">
                ${c.atividades.map(a => `
                <div class="pa-ativ-item ${a.vencida ? 'pa-ativ--vencida' : ''}${a.grupoId ? ' pa-ativ--grupo' : ''}">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                            <span style="font-size:.83rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%"
                                  title="${esc(a.titulo)}">${esc(a.titulo)}</span>
                            ${a.grupoNome ? `<span class="pa-grupo-tag">${esc(a.grupoNome)}</span>` : ''}
                        </div>
                        <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">
                            ${TIPO_LABEL[a.tipo] || a.tipo}
                            ${a.prazo ? ` · <span style="color:${a.vencida ? '#dc2626' : 'var(--text-muted)'}">${a.vencida ? '⚠ Vencida' : '📅'} ${a.prazo}</span>` : ' · Sem prazo'}
                            ${a.pontos != null ? ` · ${a.pontos} pts` : ''}
                        </div>
                    </div>
                    ${a.link ? `<a href="${esc(a.link)}" target="_blank" class="pa-link-btn">Abrir</a>` : ''}
                </div>`).join('')}
            </div>
        </div>`).join('')}
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
