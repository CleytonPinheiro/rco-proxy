'use strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = (path, opts = {}) => fetch(`/api${path}`, { credentials: 'include', ...opts });

/* ── Toggle Mensal / Anual ──────────────────────────────────── */
const toggle       = document.getElementById('togglePeriodo');
const labelMensal  = document.getElementById('labelMensal');
const labelAnual   = document.getElementById('labelAnual');
const precos       = document.querySelectorAll('.pl-price-valor');
const cobrancas    = {
    inicial:      document.getElementById('cobrancaInicial'),
    profissional: document.getElementById('cobrancaProfissional'),
    rede:         document.getElementById('cobrancaRede'),
    individual:   document.getElementById('cobrancaIndividual'),
};

let anual = false;

function atualizarPrecos(animado = true) {
    precos.forEach(el => {
        const val = anual ? el.dataset.anual : el.dataset.mensal;
        if (animado) {
            el.classList.add('pl-animando');
            setTimeout(() => {
                el.textContent = val;
                el.classList.remove('pl-animando');
            }, 150);
        } else {
            el.textContent = val;
        }
    });

    const txt = anual ? 'Cobrado anualmente' : 'Cobrado mensalmente';
    Object.values(cobrancas).forEach(el => { if (el) el.textContent = txt; });
    labelMensal.classList.toggle('pl-toggle-label--ativo', !anual);
    labelAnual.classList.toggle('pl-toggle-label--ativo', anual);
}

toggle.addEventListener('click', () => {
    anual = !anual;
    toggle.setAttribute('aria-pressed', String(anual));
    atualizarPrecos(true);
});

atualizarPrecos(false);

/* ══════════════════════════════════════════════════════════════
   GESTÃO DE ASSINATURAS
══════════════════════════════════════════════════════════════ */

const PLANO_INFO = {
    inicial:               { icone: '🌱', label: 'Inicial',              cor: 'pl-plano-badge--inicial' },
    profissional:          { icone: '🚀', label: 'Profissional',         cor: 'pl-plano-badge--profissional' },
    rede:                  { icone: '🏫', label: 'Rede Escolar',         cor: 'pl-plano-badge--rede' },
    'classroom-individual':{ icone: '👨‍🏫', label: 'Classroom Individual', cor: 'pl-plano-badge--individual' },
};

let escolas   = [];
let usuarios  = [];

function badgePlano(plano) {
    if (!plano) return `<span class="pl-plano-badge pl-plano-badge--sem">Sem plano</span>`;
    const info = PLANO_INFO[plano] || { icone: '?', label: plano, cor: 'pl-plano-badge--sem' };
    return `<span class="pl-plano-badge ${info.cor}">${info.icone} ${info.label}</span>`;
}

function formatarData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function venceEmBreve(iso) {
    if (!iso) return false;
    const dias = (new Date(iso) - new Date()) / (1000 * 60 * 60 * 24);
    return dias >= 0 && dias <= 30;
}

function contarPorPlano(lista) {
    const counts = { sem: 0, inicial: 0, profissional: 0, rede: 0 };
    lista.forEach(e => {
        if (!e.plano) counts.sem++;
        else counts[e.plano] = (counts[e.plano] || 0) + 1;
    });
    return counts;
}

/* ── Render: escolas ─────────────────────────────────────────── */
function renderGestao(lista) {
    const wrap = document.getElementById('plGestaoWrap');
    if (!lista.length) {
        wrap.innerHTML = '<p class="pl-gestao-empty">Nenhuma escola cadastrada no sistema.</p>';
        return;
    }

    const counts      = contarPorPlano(lista);
    const totalAtivos = lista.filter(e => e.plano).length;

    wrap.innerHTML = `
        <div class="pl-gestao-resumo">
            <div class="pl-resumo-card">
                <div class="pl-resumo-num">${lista.length}</div>
                <div class="pl-resumo-label">Total</div>
            </div>
            <div class="pl-resumo-card">
                <div class="pl-resumo-num" style="color:#16a34a">${totalAtivos}</div>
                <div class="pl-resumo-label">Com plano</div>
            </div>
            <div class="pl-resumo-card">
                <div class="pl-resumo-num" style="color:#2563eb">${counts.profissional || 0}</div>
                <div class="pl-resumo-label">Profissional</div>
            </div>
            <div class="pl-resumo-card">
                <div class="pl-resumo-num" style="color:#854d0e">${counts.rede || 0}</div>
                <div class="pl-resumo-label">Rede Escolar</div>
            </div>
            <div class="pl-resumo-card">
                <div class="pl-resumo-num" style="color:var(--text-muted)">${counts.sem || 0}</div>
                <div class="pl-resumo-label">Sem plano</div>
            </div>
        </div>
        <div style="overflow-x:auto">
        <table class="pl-gestao-table">
            <thead>
                <tr>
                    <th>Escola</th>
                    <th>Código RCO</th>
                    <th>Plano atual</th>
                    <th>Início</th>
                    <th>Renovação</th>
                    <th>Obs.</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${lista.map(e => {
                    const renovClass = venceEmBreve(e.plano_renovacao) ? 'pl-data-vencendo' : '';
                    const obsExibe   = e.plano_obs ? `<span title="${esc(e.plano_obs)}" style="cursor:default">📝</span>` : '—';
                    return `
                    <tr>
                        <td style="font-weight:600;color:var(--text-primary)">${esc(e.nome)}</td>
                        <td style="font-family:monospace;font-size:.82rem">${e.codigo_estabelecimento}</td>
                        <td>${badgePlano(e.plano)}</td>
                        <td class="pl-data-col">${formatarData(e.plano_inicio)}</td>
                        <td class="pl-data-col ${renovClass}">${formatarData(e.plano_renovacao)}</td>
                        <td style="font-size:.82rem;color:var(--text-muted)">${obsExibe}</td>
                        <td>
                            <button class="pl-btn-alterar" onclick="abrirModalEscola(${e.id})">
                                ✏ Alterar
                            </button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        </div>`;
}

async function carregarEscolas() {
    const wrap = document.getElementById('plGestaoWrap');
    wrap.innerHTML = '<p class="pl-gestao-loading">Carregando escolas...</p>';
    try {
        const res = await api('/admin/escolas');
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        escolas = await res.json();
        renderGestao(escolas);
    } catch (e) {
        wrap.innerHTML = `<p class="pl-gestao-empty" style="color:#dc2626">Erro ao carregar: ${esc(e.message)}</p>`;
    }
}

document.getElementById('plBtnReload').addEventListener('click', carregarEscolas);

/* ── Render: professores individuais ─────────────────────────── */
function renderGestaoProf(lista) {
    const wrap = document.getElementById('plGestaoWrapProf');

    const comPlano = lista.filter(u => u.plano === 'classroom-individual');

    if (!comPlano.length) {
        wrap.innerHTML = '<p class="pl-gestao-empty">Nenhum professor com assinatura individual ativa.</p>';
        return;
    }

    wrap.innerHTML = `
        <div class="pl-gestao-resumo">
            <div class="pl-resumo-card">
                <div class="pl-resumo-num" style="color:#7c3aed">${comPlano.length}</div>
                <div class="pl-resumo-label">Classroom Individual</div>
            </div>
        </div>
        <div style="overflow-x:auto">
        <table class="pl-gestao-table">
            <thead>
                <tr>
                    <th>Professor</th>
                    <th>CPF</th>
                    <th>Plano</th>
                    <th>Início</th>
                    <th>Renovação</th>
                    <th>Obs.</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${lista.map(u => {
                    if (!u.plano) return '';
                    const renovClass = venceEmBreve(u.plano_renovacao) ? 'pl-data-vencendo' : '';
                    const obsExibe   = u.plano_obs ? `<span title="${esc(u.plano_obs)}" style="cursor:default">📝</span>` : '—';
                    const cpfFmt     = u.cpf ? u.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—';
                    return `
                    <tr>
                        <td style="font-weight:600;color:var(--text-primary)">${esc(u.nome)}</td>
                        <td style="font-family:monospace;font-size:.82rem">${cpfFmt}</td>
                        <td>${badgePlano(u.plano)}</td>
                        <td class="pl-data-col">${formatarData(u.plano_inicio)}</td>
                        <td class="pl-data-col ${renovClass}">${formatarData(u.plano_renovacao)}</td>
                        <td style="font-size:.82rem;color:var(--text-muted)">${obsExibe}</td>
                        <td>
                            <button class="pl-btn-alterar" onclick="abrirModalProf(${u.id})">
                                ✏ Alterar
                            </button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        </div>`;
}

async function carregarProfessores() {
    const wrap = document.getElementById('plGestaoWrapProf');
    wrap.innerHTML = '<p class="pl-gestao-loading">Carregando professores...</p>';
    try {
        const res = await api('/admin/usuarios');
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        usuarios = await res.json();
        renderGestaoProf(usuarios);
    } catch (e) {
        wrap.innerHTML = `<p class="pl-gestao-empty" style="color:#dc2626">Erro ao carregar: ${esc(e.message)}</p>`;
    }
}

document.getElementById('plBtnReloadProf').addEventListener('click', carregarProfessores);

/* ── Modal (modo escola | professor) ─────────────────────────── */
const modal              = document.getElementById('plModalOverlay');
const elModalTitulo      = document.getElementById('plModalTitulo');
const elModalEscolaId    = document.getElementById('plModalEscolaId');
const elModalUsuarioId   = document.getElementById('plModalUsuarioId');
const elModalModo        = document.getElementById('plModalModo');
const elModalPlano       = document.getElementById('plModalPlano');
const elModalPlanoProf   = document.getElementById('plModalPlanoProf');
const elGrupoEscola      = document.getElementById('plGrupoPlanoEscola');
const elGrupoProf        = document.getElementById('plGrupoPlanoProf');
const elModalInicio      = document.getElementById('plModalInicio');
const elModalRenov       = document.getElementById('plModalRenovacao');
const elModalObs         = document.getElementById('plModalObs');
const elModalMsg         = document.getElementById('plModalMsg');

function abrirModal() { modal.classList.add('pl-modal-overlay--ativo'); }
function fecharModal() {
    modal.classList.remove('pl-modal-overlay--ativo');
    elModalMsg.style.display = 'none';
}

/* Modo: escola */
window.abrirModalEscola = function (id) {
    const e = escolas.find(x => x.id === id);
    if (!e) return;

    elModalModo.value         = 'escola';
    elModalEscolaId.value     = e.id;
    elModalUsuarioId.value    = '';
    elModalTitulo.textContent = `Plano — ${e.nome}`;

    elGrupoEscola.style.display = '';
    elGrupoProf.style.display   = 'none';

    elModalPlano.value  = e.plano || '';
    elModalInicio.value = e.plano_inicio    ? e.plano_inicio.split('T')[0]    : '';
    elModalRenov.value  = e.plano_renovacao ? e.plano_renovacao.split('T')[0] : '';
    elModalObs.value    = e.plano_obs || '';
    elModalMsg.style.display = 'none';
    abrirModal();
};

/* Modo: professor individual */
window.abrirModalProf = function (id) {
    const u = usuarios.find(x => x.id === id);
    if (!u) return;

    elModalModo.value         = 'professor';
    elModalUsuarioId.value    = u.id;
    elModalEscolaId.value     = '';
    elModalTitulo.textContent = `Plano Individual — ${u.nome}`;

    elGrupoEscola.style.display = 'none';
    elGrupoProf.style.display   = '';

    elModalPlanoProf.value = u.plano || '';
    elModalInicio.value    = u.plano_inicio    ? u.plano_inicio.split('T')[0]    : '';
    elModalRenov.value     = u.plano_renovacao ? u.plano_renovacao.split('T')[0] : '';
    elModalObs.value       = u.plano_obs || '';
    elModalMsg.style.display = 'none';
    abrirModal();
};

/* Abre modal de professor com plano em branco (novo) */
window.abrirModalProfNovo = function (id) {
    const u = usuarios.find(x => x.id === id);
    if (!u) return;
    u.plano = u.plano || null;
    window.abrirModalProf(id);
};

document.getElementById('plModalFechar').addEventListener('click', fecharModal);
document.getElementById('plModalCancelar').addEventListener('click', fecharModal);
modal.addEventListener('click', e => { if (e.target === modal) fecharModal(); });

document.getElementById('plModalSalvar').addEventListener('click', async () => {
    const modo  = elModalModo.value;
    const inicio = elModalInicio.value || null;
    const renov  = elModalRenov.value  || null;
    const obs    = elModalObs.value.trim() || null;

    const btn = document.getElementById('plModalSalvar');
    btn.disabled    = true;
    btn.textContent = 'Salvando...';
    elModalMsg.style.display = 'none';

    try {
        if (modo === 'escola') {
            const id    = parseInt(elModalEscolaId.value, 10);
            const plano = elModalPlano.value || null;

            const res  = await api(`/admin/escolas/${id}/plano`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plano, plano_inicio: inicio, plano_renovacao: renov, plano_obs: obs }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);

            const idx = escolas.findIndex(x => x.id === id);
            if (idx !== -1) escolas[idx] = { ...escolas[idx], plano, plano_inicio: inicio, plano_renovacao: renov, plano_obs: obs };
            renderGestao(escolas);

            elModalMsg.className   = 'pl-modal-msg pl-modal-msg--ok';
            elModalMsg.textContent = `✓ Plano de "${data.nome}" atualizado com sucesso.`;

        } else {
            const id    = parseInt(elModalUsuarioId.value, 10);
            const plano = elModalPlanoProf.value || null;

            const res  = await api(`/admin/usuarios/${id}/plano`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plano, plano_inicio: inicio, plano_renovacao: renov, plano_obs: obs }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);

            const idx = usuarios.findIndex(x => x.id === id);
            if (idx !== -1) usuarios[idx] = { ...usuarios[idx], plano, plano_inicio: inicio, plano_renovacao: renov, plano_obs: obs };
            renderGestaoProf(usuarios);

            elModalMsg.className   = 'pl-modal-msg pl-modal-msg--ok';
            elModalMsg.textContent = `✓ Plano de "${data.nome}" atualizado com sucesso.`;
        }

        elModalMsg.style.display = 'block';
        setTimeout(fecharModal, 1800);

    } catch (e) {
        elModalMsg.className   = 'pl-modal-msg pl-modal-msg--err';
        elModalMsg.textContent = `✗ ${e.message}`;
        elModalMsg.style.display = 'block';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Salvar plano';
    }
});

/* ── Logout ──────────────────────────────────────────────────── */
document.getElementById('btnLogout')?.addEventListener('click', () => {
    window.__edusyncLogout?.();
});

/* ── Init ────────────────────────────────────────────────────── */
carregarEscolas();
carregarProfessores();
