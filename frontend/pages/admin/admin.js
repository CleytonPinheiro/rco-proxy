'use strict';

/* ── Helpers ── */
const esc  = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api  = (path, opts = {}) => fetch(`/api${path}`, { credentials: 'include', ...opts });

function showToast(msg, tipo = 'success') {
    const old = document.getElementById('_adminToast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = '_adminToast';
    const bg = tipo === 'error' ? '#dc2626' : tipo === 'warning' ? '#d97706' : '#16a34a';
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;background:${bg};color:#fff;font-size:.9rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:360px;word-break:break-word;transition:opacity .3s`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, 3500);
}

/* ── Estado ── */
let usuarios    = [];
let perfisDisp  = [];

/* ── Abas ── */
document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('admin-tab--ativo'));
        document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('admin-panel--ativo'));
        btn.classList.add('admin-tab--ativo');
        document.getElementById(`panel-${btn.dataset.tab}`).classList.add('admin-panel--ativo');

        if (btn.dataset.tab === 'audit')   carregarAuditLog();
        if (btn.dataset.tab === 'escolas') carregarEscolas();
        if (btn.dataset.tab === 'suporte') carregarSuporte();
        if (btn.dataset.tab === 'config')  { carregarConfig(); carregarDadosEscola(); }
        if (btn.dataset.tab === 'alunos')  carregarTurmasAlunos();
    });
});

/* ════════════════════════════════════════════════════════════
   USUÁRIOS
════════════════════════════════════════════════════════════ */
async function carregarUsuarios() {
    const wrap = document.getElementById('tabelaUsuariosWrap');
    wrap.innerHTML = '<p style="color:var(--text-muted)">Carregando...</p>';
    try {
        const [resU, resP] = await Promise.all([
            api('/admin/usuarios'),
            api('/admin/perfis'),
        ]);
        usuarios   = await resU.json();
        perfisDisp = await resP.json();
        renderTabelaUsuarios(usuarios);
    } catch (e) {
        wrap.innerHTML = `<p style="color:#dc2626">Erro: ${esc(e.message)}</p>`;
    }
}

const PLANO_BADGE_INFO = {
    'trial':                { icone: '⏳', label: 'Trial',         bg: '#fef3c7', cor: '#92400e' },
    'basico':               { icone: '📘', label: 'Básico',        bg: '#dbeafe', cor: '#1d4ed8' },
    'completo':             { icone: '🚀', label: 'Completo',      bg: '#dcfce7', cor: '#15803d' },
    'classroom-individual': { icone: '👨‍🏫', label: 'Individual',  bg: '#ede9fe', cor: '#6d28d9' },
    'inicial':              { icone: '🌱', label: 'Inicial',       bg: '#dcfce7', cor: '#15803d' },
    'profissional':         { icone: '🚀', label: 'Profissional',  bg: '#dbeafe', cor: '#1d4ed8' },
    'rede':                 { icone: '🏫', label: 'Rede Escolar',  bg: '#fef9c3', cor: '#854d0e' },
};

function badgePlanoUsuario(plano, userId) {
    const btnStyle = `font-size:.72rem;padding:2px 6px;border-radius:4px;cursor:pointer;border:none;`;
    if (!plano) return `<button style="${btnStyle}background:var(--bg-hover);color:var(--text-muted)" onclick="abrirModalPlano(${userId})">+ plano</button>`;
    const info = PLANO_BADGE_INFO[plano];
    if (!info) return `<button style="${btnStyle}background:var(--bg-hover);color:var(--text-muted)" onclick="abrirModalPlano(${userId})">${plano}</button>`;
    return `<button style="${btnStyle}background:${info.bg};color:${info.cor};font-weight:600" onclick="abrirModalPlano(${userId})">${info.icone} ${info.label}</button>`;
}

function renderTabelaUsuarios(lista) {
    const wrap = document.getElementById('tabelaUsuariosWrap');
    if (!lista.length) {
        wrap.innerHTML = '<p style="color:var(--text-muted)">Nenhum usuário cadastrado.</p>';
        return;
    }
    wrap.innerHTML = `
    <table class="admin-table">
        <thead>
            <tr>
                <th>Nome</th>
                <th>CPF</th>
                <th>Perfil</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Cadastrado em</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            ${lista.map(u => `
            <tr data-id="${u.id}">
                <td>${esc(u.nome)}</td>
                <td style="font-family:monospace;font-size:.8rem">${formatCpf(u.cpf)}</td>
                <td><span class="perfil-badge perfil-${u.perfil}">${labelPerfil(u.perfil)}</span></td>
                <td>${badgePlanoUsuario(u.plano, u.id)}</td>
                <td><span class="${u.ativo ? 'status-ativo' : 'status-inativo'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td style="color:var(--text-muted);font-size:.8rem">${formatData(u.criado_em)}</td>
                <td>
                    <button class="btn-acao" onclick="abrirModalEditar(${u.id})">Editar</button>
                    ${u.ativo
                        ? `<button class="btn-acao btn-acao--danger" onclick="desativarUsuario(${u.id}, '${esc(u.nome)}')">Desativar</button>`
                        : `<button class="btn-acao" onclick="reativarUsuario(${u.id})">Reativar</button>`
                    }
                </td>
            </tr>`).join('')}
        </tbody>
    </table>`;
}

/* ── Modal: novo usuário ── */
document.getElementById('btnNovoUsuario').addEventListener('click', () => {
    document.getElementById('modalTitulo').textContent = 'Novo usuário';
    document.getElementById('modalUserId').value       = '';
    document.getElementById('modalNome').value         = '';
    document.getElementById('modalCpf').value          = '';
    document.getElementById('modalPerfil').value       = 'professor';
    document.getElementById('modalCpf').disabled       = false;
    esconderFormMsg();
    document.getElementById('modalUsuario').classList.add('modal-overlay--ativo');
});

/* ── Modal: editar ── */
window.abrirModalEditar = function (id) {
    const u = usuarios.find(x => x.id === id);
    if (!u) return;
    document.getElementById('modalTitulo').textContent = 'Editar usuário';
    document.getElementById('modalUserId').value       = u.id;
    document.getElementById('modalNome').value         = u.nome;
    document.getElementById('modalCpf').value          = u.cpf;
    document.getElementById('modalPerfil').value       = u.perfil;
    document.getElementById('modalCpf').disabled       = true; // CPF não editável
    esconderFormMsg();
    document.getElementById('modalUsuario').classList.add('modal-overlay--ativo');
};

document.getElementById('btnCancelarModal').addEventListener('click', fecharModal);
document.getElementById('modalUsuario').addEventListener('click', e => {
    if (e.target === document.getElementById('modalUsuario')) fecharModal();
});

function fecharModal() {
    document.getElementById('modalUsuario').classList.remove('modal-overlay--ativo');
}

/* ── Salvar usuário (criar ou editar) ── */
document.getElementById('formUsuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id    = document.getElementById('modalUserId').value;
    const nome  = document.getElementById('modalNome').value.trim();
    const cpf   = document.getElementById('modalCpf').value.replace(/\D/g, '');
    const perfil= document.getElementById('modalPerfil').value;
    const btn   = document.getElementById('btnSalvarModal');

    if (!nome || (!id && !cpf) || !perfil) {
        mostrarFormMsg('Preencha todos os campos.', 'erro');
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Salvando...';

    try {
        let res;
        if (id) {
            res = await api(`/admin/usuarios/${id}`, {
                method:  'PUT',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ nome, perfil }),
            });
        } else {
            res = await api('/admin/usuarios', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ nome, cpf, perfil }),
            });
        }

        const data = await res.json();
        if (!res.ok) {
            mostrarFormMsg(data.erro || 'Erro ao salvar.', 'erro');
        } else {
            fecharModal();
            await carregarUsuarios();
        }
    } catch (err) {
        mostrarFormMsg('Erro de conexão: ' + err.message, 'erro');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Salvar';
    }
});

/* ── Desativar usuário ── */
window.desativarUsuario = async function (id, nome) {
    if (!confirm(`Desativar "${nome}"? O usuário não poderá mais fazer login.`)) return;
    try {
        const res = await api(`/admin/usuarios/${id}`, { method: 'DELETE' });
        if (res.ok) carregarUsuarios();
        else {
            const d = await res.json();
            alert(d.erro || 'Erro ao desativar.');
        }
    } catch { alert('Erro de conexão.'); }
};

/* ── Reativar usuário ── */
window.reativarUsuario = async function (id) {
    try {
        const res = await api(`/admin/usuarios/${id}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ ativo: true }),
        });
        if (res.ok) carregarUsuarios();
        else {
            const d = await res.json();
            alert(d.erro || 'Erro ao reativar.');
        }
    } catch { alert('Erro de conexão.'); }
};

/* ════════════════════════════════════════════════════════════
   AUDIT LOG
════════════════════════════════════════════════════════════ */
async function carregarAuditLog() {
    const modulo = document.getElementById('filtroModulo').value;
    const wrap   = document.getElementById('tabelaAuditWrap');
    wrap.innerHTML = '<p style="color:var(--text-muted)">Carregando...</p>';

    try {
        const params = new URLSearchParams({ limite: 200 });
        if (modulo) params.set('modulo', modulo);
        const res  = await api(`/admin/audit-log?${params}`);
        const logs = await res.json();

        if (!logs.length) {
            wrap.innerHTML = '<p style="color:var(--text-muted)">Nenhum registro encontrado.</p>';
            return;
        }

        wrap.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Data/Hora</th>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Módulo</th>
                    <th>Detalhes</th>
                    <th>IP</th>
                </tr>
            </thead>
            <tbody>
                ${logs.map(l => `
                <tr>
                    <td style="font-size:.8rem;color:var(--text-muted);white-space:nowrap">${formatData(l.criado_em, true)}</td>
                    <td>${esc(l.usuario_nome || '—')}</td>
                    <td><span class="audit-row-acao ${l.acao}">${esc(l.acao)}</span></td>
                    <td style="font-size:.8rem;color:var(--text-muted)">${esc(l.modulo || '—')}</td>
                    <td style="font-size:.75rem;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                        title="${esc(JSON.stringify(l.detalhes))}">
                        ${l.detalhes ? esc(JSON.stringify(l.detalhes)).slice(0, 60) : '—'}
                    </td>
                    <td style="font-size:.78rem;color:var(--text-muted)">${esc(l.ip || '—')}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    } catch (e) {
        wrap.innerHTML = `<p style="color:#dc2626">Erro: ${esc(e.message)}</p>`;
    }
}

document.getElementById('btnFiltrar').addEventListener('click', carregarAuditLog);

/* ════════════════════════════════════════════════════════════
   ESCOLAS — whitelist de estabelecimentos autorizados
════════════════════════════════════════════════════════════ */
let escolas        = [];
let rcoEstabs      = [];  // cache dos estabelecimentos do RCO (dropdown)

async function carregarEscolas() {
    const wrap = document.getElementById('tabelaEscolasWrap');
    wrap.innerHTML = '<p style="color:var(--text-muted)">Carregando...</p>';

    try {
        const [resE, resR] = await Promise.all([
            api('/admin/escolas'),
            api('/admin/rco-estabelecimentos'),
        ]);
        escolas   = await resE.json();
        rcoEstabs = await resR.json();
        renderBannerEscolas(escolas);
        renderTabelaEscolas(escolas);
    } catch (e) {
        wrap.innerHTML = `<p style="color:#dc2626">Erro: ${esc(e.message)}</p>`;
    }
}

function renderBannerEscolas(lista) {
    const banner  = document.getElementById('escolaBanner');
    const ativas  = lista.filter(e => e.ativo && e.permite_auto_cadastro);

    if (lista.length === 0 || ativas.length === 0) {
        banner.className   = 'escola-info-banner escola-info-banner--aberta';
        banner.innerHTML   = `<strong>⚠ Whitelist vazia — cadastro aberto</strong><br>
            Qualquer professor com credenciais válidas no RCO Digital do Paraná pode se auto-cadastrar.
            Adicione ao menos uma escola para restringir o acesso ao seu colégio.`;
    } else {
        banner.className   = 'escola-info-banner escola-info-banner--restrita';
        banner.innerHTML   = `<strong>✓ Whitelist ativa — ${ativas.length} escola(s) autorizada(s)</strong><br>
            Apenas professores vinculados às escolas abaixo podem se auto-cadastrar.`;
    }
}

const ADMIN_PLANO_INFO = {
    inicial:      { icone: '🌱', label: 'Inicial',      bg: '#dcfce7', color: '#15803d' },
    profissional: { icone: '🚀', label: 'Profissional', bg: '#dbeafe', color: '#1d4ed8' },
    rede:         { icone: '🏫', label: 'Rede',         bg: '#fef9c3', color: '#854d0e' },
};

function badgePlanoAdmin(plano, escolaId) {
    const btnBase = `display:inline-flex;align-items:center;gap:4px;font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:20px;cursor:pointer;border:none;`;
    if (!plano) return `<button style="${btnBase}background:var(--bg-hover);color:var(--text-muted)" onclick="abrirModalPlanoEscola(${escolaId})">+ plano</button>`;
    const info = ADMIN_PLANO_INFO[plano] || { icone: '?', label: plano, bg: '#f3f4f6', color: '#6b7280' };
    return `<button style="${btnBase}background:${info.bg};color:${info.color}" onclick="abrirModalPlanoEscola(${escolaId})">${info.icone} ${info.label}</button>`;
}

function renderTabelaEscolas(lista) {
    const wrap = document.getElementById('tabelaEscolasWrap');
    if (!lista.length) {
        wrap.innerHTML = '<p style="color:var(--text-muted)">Nenhuma escola cadastrada. O sistema está com cadastro aberto.</p>';
        return;
    }

    wrap.innerHTML = `
    <table class="admin-table">
        <thead>
            <tr>
                <th>Nome da escola</th>
                <th>Código RCO</th>
                <th>Plano</th>
                <th>Auto-cadastro</th>
                <th>Status</th>
                <th>Adicionada em</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            ${lista.map(e => `
            <tr data-id="${e.id}">
                <td>${esc(e.nome)}</td>
                <td style="font-family:monospace;font-size:.85rem">${e.codigo_estabelecimento}</td>
                <td>${badgePlanoAdmin(e.plano, e.id)}</td>
                <td>
                    <span class="badge-auto ${e.permite_auto_cadastro ? 'badge-auto--sim' : 'badge-auto--nao'}">
                        ${e.permite_auto_cadastro ? 'Sim' : 'Não'}
                    </span>
                </td>
                <td><span class="${e.ativo ? 'status-ativo' : 'status-inativo'}">${e.ativo ? 'Ativa' : 'Inativa'}</span></td>
                <td style="color:var(--text-muted);font-size:.8rem">${formatData(e.criado_em)}</td>
                <td>
                    <button class="btn-acao" onclick="abrirModalEditarEscola(${e.id})">Editar</button>
                    ${e.ativo
                        ? `<button class="btn-acao btn-acao--danger" onclick="removerEscola(${e.id}, '${esc(e.nome)}')">Remover</button>`
                        : `<button class="btn-acao" onclick="reativarEscola(${e.id})">Reativar</button>`
                    }
                </td>
            </tr>`).join('')}
        </tbody>
    </table>`;
}

/* ── Modal: nova escola ── */
document.getElementById('btnNovaEscola').addEventListener('click', () => {
    document.getElementById('modalEscolaTitulo').textContent = 'Adicionar escola';
    document.getElementById('modalEscolaId').value           = '';
    document.getElementById('modalEscolaNome').value         = '';
    document.getElementById('modalEscolaCodigo').value       = '';
    document.getElementById('modalEscolaAutoCadastro').checked = true;
    document.getElementById('modalEscolaCodigo').disabled    = false;
    popularDropdownRco('');
    esconderFormEscolaMsg();
    document.getElementById('modalEscola').classList.add('modal-overlay--ativo');
});

/* ── Modal: editar escola ── */
window.abrirModalEditarEscola = function (id) {
    const e = escolas.find(x => x.id === id);
    if (!e) return;
    document.getElementById('modalEscolaTitulo').textContent       = 'Editar escola';
    document.getElementById('modalEscolaId').value                 = e.id;
    document.getElementById('modalEscolaNome').value               = e.nome;
    document.getElementById('modalEscolaCodigo').value             = e.codigo_estabelecimento;
    document.getElementById('modalEscolaCodigo').disabled          = true;
    document.getElementById('modalEscolaAutoCadastro').checked     = e.permite_auto_cadastro;
    popularDropdownRco(e.codigo_estabelecimento);
    esconderFormEscolaMsg();
    document.getElementById('modalEscola').classList.add('modal-overlay--ativo');
};

document.getElementById('btnCancelarModalEscola').addEventListener('click', fecharModalEscola);
document.getElementById('modalEscola').addEventListener('click', e => {
    if (e.target === document.getElementById('modalEscola')) fecharModalEscola();
});

function fecharModalEscola() {
    document.getElementById('modalEscola').classList.remove('modal-overlay--ativo');
}

/* ── Preenche o dropdown com escolas do RCO sincronizadas ── */
function popularDropdownRco(codigoSelecionado) {
    const sel = document.getElementById('modalEscolaRco');
    sel.innerHTML = '<option value="">— Selecione para preencher —</option>';
    rcoEstabs.forEach(e => {
        const opt   = document.createElement('option');
        opt.value   = e.cod_estabelecimento;
        opt.text    = `${e.nome_estabelecimento} (${e.cod_estabelecimento})`;
        if (String(e.cod_estabelecimento) === String(codigoSelecionado)) opt.selected = true;
        sel.appendChild(opt);
    });
}

/* Ao selecionar no dropdown, preenche os campos */
document.getElementById('modalEscolaRco').addEventListener('change', function () {
    const cod = this.value;
    if (!cod) return;
    const estab = rcoEstabs.find(e => String(e.cod_estabelecimento) === String(cod));
    if (estab) {
        document.getElementById('modalEscolaNome').value   = estab.nome_estabelecimento;
        document.getElementById('modalEscolaCodigo').value = estab.cod_estabelecimento;
    }
});

/* ── Salvar escola ── */
document.getElementById('formEscola').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id              = document.getElementById('modalEscolaId').value;
    const nome            = document.getElementById('modalEscolaNome').value.trim();
    const codigo          = document.getElementById('modalEscolaCodigo').value;
    const autoCadastro    = document.getElementById('modalEscolaAutoCadastro').checked;
    const btn             = document.getElementById('btnSalvarEscola');

    if (!nome || (!id && !codigo)) {
        mostrarFormEscolaMsg('Preencha nome e código do estabelecimento.', 'erro');
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Salvando...';

    try {
        let res;
        if (id) {
            res = await api(`/admin/escolas/${id}`, {
                method:  'PUT',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ nome, permite_auto_cadastro: autoCadastro }),
            });
        } else {
            res = await api('/admin/escolas', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ nome, codigo_estabelecimento: parseInt(codigo, 10), permite_auto_cadastro: autoCadastro }),
            });
        }
        const data = await res.json();
        if (!res.ok) {
            mostrarFormEscolaMsg(data.erro || 'Erro ao salvar.', 'erro');
        } else {
            fecharModalEscola();
            await carregarEscolas();
        }
    } catch (err) {
        mostrarFormEscolaMsg('Erro de conexão: ' + err.message, 'erro');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Salvar';
    }
});

window.removerEscola = async function (id, nome) {
    if (!confirm(`Remover "${nome}" da whitelist?\nProfessores desta escola não poderão mais se auto-cadastrar.`)) return;
    const res = await api(`/admin/escolas/${id}`, { method: 'DELETE' });
    if (res.ok) carregarEscolas();
    else { const d = await res.json(); alert(d.erro || 'Erro.'); }
};

window.reativarEscola = async function (id) {
    const res = await api(`/admin/escolas/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ativo: true }),
    });
    if (res.ok) carregarEscolas();
    else { const d = await res.json(); alert(d.erro || 'Erro.'); }
};

function mostrarFormEscolaMsg(txt, tipo) {
    const el = document.getElementById('formEscolaMsg');
    el.textContent   = txt;
    el.style.display = 'block';
    el.style.background = tipo === 'erro' ? '#fef2f2' : '#f0fdf4';
    el.style.color      = tipo === 'erro' ? '#dc2626' : '#16a34a';
}
function esconderFormEscolaMsg() {
    document.getElementById('formEscolaMsg').style.display = 'none';
}

/* ════════════════════════════════════════════════════════════
   UTILS
════════════════════════════════════════════════════════════ */
const PERFIL_LABELS = {
    admin: 'Administrador', professor: 'Professor', pedagogo: 'Pedagogo',
    secretaria: 'Secretaria', aux_turno: 'Aux. Turno', cozinha: 'Cozinha',
};
function labelPerfil(p)  { return PERFIL_LABELS[p] || p; }
function formatCpf(cpf)  { return (cpf || '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.***.***-$4'); }
function formatData(iso, comHora = false) {
    if (!iso) return '—';
    const d = new Date(iso);
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (comHora) Object.assign(opts, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return d.toLocaleString('pt-BR', opts);
}
function mostrarFormMsg(txt, tipo) {
    const el = document.getElementById('formMsg');
    el.textContent  = txt;
    el.style.display = 'block';
    el.style.background = tipo === 'erro' ? '#fef2f2' : '#f0fdf4';
    el.style.color      = tipo === 'erro' ? '#dc2626' : '#16a34a';
}
function esconderFormMsg() {
    document.getElementById('formMsg').style.display = 'none';
}

/* ════════════════════════════════════════════════════════════
   PLANO DO USUÁRIO
════════════════════════════════════════════════════════════ */
function calcTrialStatus(plano, planoInicio) {
    if (plano !== 'trial' || !planoInicio) return null;
    const inicio = new Date(planoInicio);
    const expira = new Date(inicio);
    expira.setDate(expira.getDate() + 30);
    const agora = new Date();
    const diffMs = expira.getTime() - agora.getTime();
    const diasRestantes = Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
    return { expirado: diasRestantes <= 0, diasRestantes, expiraEm: expira.toLocaleDateString('pt-BR') };
}

function atualizarStatusPlanoModal() {
    const plano = document.getElementById('modalPlanoTipo').value;
    const inicio = document.getElementById('modalPlanoInicio').value;
    const statusEl = document.getElementById('modalPlanoStatus');
    const estenderWrap = document.getElementById('modalPlanoEstenderWrap');

    const trial = calcTrialStatus(plano, inicio);
    if (trial) {
        statusEl.style.display = 'block';
        estenderWrap.style.display = 'block';
        if (trial.expirado) {
            statusEl.style.background = '#fef2f2';
            statusEl.style.color = '#dc2626';
            statusEl.style.border = '1px solid #fca5a5';
            statusEl.innerHTML = `<strong>Expirado</strong> — O trial venceu em ${trial.expiraEm}.`;
        } else {
            statusEl.style.background = '#fffbeb';
            statusEl.style.color = '#92400e';
            statusEl.style.border = '1px solid #fcd34d';
            statusEl.innerHTML = `<strong>${trial.diasRestantes} dia(s) restante(s)</strong> — Expira em ${trial.expiraEm}.`;
        }
    } else {
        statusEl.style.display = 'none';
        estenderWrap.style.display = 'none';
    }
}

window.abrirModalPlano = function (id) {
    const u = usuarios.find(x => x.id === id);
    if (!u) return;
    document.getElementById('modalPlanoUserId').value = id;
    document.getElementById('modalPlanoUserNome').textContent = `${u.nome} (${labelPerfil(u.perfil)})`;
    document.getElementById('modalPlanoTipo').value = u.plano || '';
    document.getElementById('modalPlanoInicio').value = u.plano_inicio ? u.plano_inicio.slice(0, 10) : '';
    document.getElementById('modalPlanoRenovacao').value = u.plano_renovacao ? u.plano_renovacao.slice(0, 10) : '';
    document.getElementById('modalPlanoObs').value = u.plano_obs || '';
    document.getElementById('formPlanoMsg').style.display = 'none';
    atualizarStatusPlanoModal();
    carregarPlanoHistorico(id);
    document.getElementById('modalPlano').classList.add('modal-overlay--ativo');
};

async function carregarPlanoHistorico(userId) {
    const el = document.getElementById('planoHistoricoAdmin');
    el.innerHTML = '<div style="font-size:.8rem;color:var(--text-secondary)">Carregando histórico...</div>';
    try {
        const res = await api(`/admin/usuarios/${userId}/plano-historico`);
        const hist = await res.json();
        if (!hist.length) {
            el.innerHTML = '<div style="font-size:.8rem;color:var(--text-secondary)">Nenhum histórico registrado.</div>';
            return;
        }
        const acaoLabel = {
            PLANO_ATIVADO: '🟢 Ativado',
            PLANO_ALTERADO: '🔵 Alterado',
            PLANO_ESTENDIDO: '🟡 Estendido',
            PLANO_REMOVIDO: '🔴 Removido',
            EXTENSAO_APROVADA: '🟣 Extensão aprovada',
        };
        const fmtDt = iso => iso ? new Date(iso).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
        el.innerHTML = `<div style="font-size:.82rem;font-weight:600;margin-bottom:8px;color:var(--text-secondary)">Histórico de plano (${hist.length})</div>` +
            hist.map(h => `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:.8rem">
                <div>
                    <div>${acaoLabel[h.acao] || h.acao}</div>
                    ${h.plano_novo ? `<div style="color:var(--text-secondary)">${h.plano_anterior || 'nenhum'} → ${h.plano_novo}</div>` : ''}
                    ${h.admin_nome ? `<div style="color:var(--text-secondary)">por ${h.admin_nome}</div>` : ''}
                    ${h.obs ? `<div style="color:var(--text-secondary);font-style:italic">${h.obs}</div>` : ''}
                </div>
                <div style="white-space:nowrap;color:var(--text-secondary);font-size:.75rem">${fmtDt(h.criado_em)}</div>
            </div>`).join('');
    } catch (e) {
        el.innerHTML = `<div style="font-size:.8rem;color:#dc2626">Erro: ${e.message}</div>`;
    }
}

document.getElementById('modalPlanoTipo').addEventListener('change', function () {
    if (this.value === 'trial' && !document.getElementById('modalPlanoInicio').value) {
        document.getElementById('modalPlanoInicio').value = new Date().toISOString().slice(0, 10);
    }
    atualizarStatusPlanoModal();
});
document.getElementById('modalPlanoInicio').addEventListener('change', atualizarStatusPlanoModal);

document.getElementById('btnEstenderPlano').addEventListener('click', function () {
    const inicioEl = document.getElementById('modalPlanoInicio');
    const atual = inicioEl.value;
    if (!atual) {
        inicioEl.value = new Date().toISOString().slice(0, 10);
        atualizarStatusPlanoModal();
        return;
    }
    const dataAtual = new Date(atual);
    dataAtual.setDate(dataAtual.getDate() + 30);
    inicioEl.value = dataAtual.toISOString().slice(0, 10);
    atualizarStatusPlanoModal();
    const msg = document.getElementById('formPlanoMsg');
    msg.textContent = 'Data de início avançada em +30 dias. Clique "Salvar plano" para confirmar.';
    msg.style.display = 'block';
    msg.style.background = '#f0fdf4';
    msg.style.color = '#166534';
});

document.getElementById('btnCancelarPlano').addEventListener('click', () => {
    document.getElementById('modalPlano').classList.remove('modal-overlay--ativo');
});
document.getElementById('modalPlano').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalPlano'))
        document.getElementById('modalPlano').classList.remove('modal-overlay--ativo');
});

document.getElementById('formPlano').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id   = document.getElementById('modalPlanoUserId').value;
    const plano = document.getElementById('modalPlanoTipo').value || null;
    const plano_inicio = document.getElementById('modalPlanoInicio').value || null;
    const plano_renovacao = document.getElementById('modalPlanoRenovacao').value || null;
    const plano_obs = document.getElementById('modalPlanoObs').value.trim() || null;
    const btn = document.getElementById('btnSalvarPlano');

    if (plano === 'trial' && !plano_inicio) {
        const msg = document.getElementById('formPlanoMsg');
        msg.textContent = 'Para o plano Trial, informe a data de início.';
        msg.style.display = 'block';
        msg.style.background = '#fef2f2';
        msg.style.color = '#dc2626';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        const res = await api(`/admin/usuarios/${id}/plano`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plano, plano_inicio, plano_renovacao, plano_obs }),
        });
        const data = await res.json();
        if (!res.ok) {
            const msg = document.getElementById('formPlanoMsg');
            msg.textContent = data.erro || 'Erro ao salvar plano.';
            msg.style.display = 'block';
            msg.style.background = '#fef2f2';
            msg.style.color = '#dc2626';
        } else {
            document.getElementById('modalPlano').classList.remove('modal-overlay--ativo');
            await carregarUsuarios();
        }
    } catch (err) {
        const msg = document.getElementById('formPlanoMsg');
        msg.textContent = 'Erro de conexão: ' + err.message;
        msg.style.display = 'block';
        msg.style.background = '#fef2f2';
        msg.style.color = '#dc2626';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar plano';
    }
});

/* ════════════════════════════════════════════════════════════
   PLANO DA ESCOLA
════════════════════════════════════════════════════════════ */
window.abrirModalPlanoEscola = function (id) {
    const e = escolas.find(x => x.id === id);
    if (!e) return;
    document.getElementById('modalPlanoEscolaId').value = id;
    document.getElementById('modalPlanoEscolaNome').textContent = e.nome;
    document.getElementById('modalPlanoEscolaTipo').value = e.plano || '';
    document.getElementById('modalPlanoEscolaInicio').value = e.plano_inicio ? e.plano_inicio.slice(0, 10) : '';
    document.getElementById('modalPlanoEscolaRenovacao').value = e.plano_renovacao ? e.plano_renovacao.slice(0, 10) : '';
    document.getElementById('modalPlanoEscolaObs').value = e.plano_obs || '';
    document.getElementById('formPlanoEscolaMsg').style.display = 'none';
    document.getElementById('modalPlanoEscola').classList.add('modal-overlay--ativo');
};

document.getElementById('btnCancelarPlanoEscola').addEventListener('click', () => {
    document.getElementById('modalPlanoEscola').classList.remove('modal-overlay--ativo');
});
document.getElementById('modalPlanoEscola').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalPlanoEscola'))
        document.getElementById('modalPlanoEscola').classList.remove('modal-overlay--ativo');
});

document.getElementById('formPlanoEscola').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id   = document.getElementById('modalPlanoEscolaId').value;
    const plano = document.getElementById('modalPlanoEscolaTipo').value || null;
    const plano_inicio = document.getElementById('modalPlanoEscolaInicio').value || null;
    const plano_renovacao = document.getElementById('modalPlanoEscolaRenovacao').value || null;
    const plano_obs = document.getElementById('modalPlanoEscolaObs').value.trim() || null;
    const btn = document.getElementById('btnSalvarPlanoEscola');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        const res = await api(`/admin/escolas/${id}/plano`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plano, plano_inicio, plano_renovacao, plano_obs }),
        });
        const data = await res.json();
        if (!res.ok) {
            const msg = document.getElementById('formPlanoEscolaMsg');
            msg.textContent = data.erro || 'Erro ao salvar plano.';
            msg.style.display = 'block';
            msg.style.background = '#fef2f2';
            msg.style.color = '#dc2626';
        } else {
            document.getElementById('modalPlanoEscola').classList.remove('modal-overlay--ativo');
            await carregarEscolas();
        }
    } catch (err) {
        const msg = document.getElementById('formPlanoEscolaMsg');
        msg.textContent = 'Erro de conexão: ' + err.message;
        msg.style.display = 'block';
        msg.style.background = '#fef2f2';
        msg.style.color = '#dc2626';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar plano';
    }
});

/* ════════════════════════════════════════════════════════════
   IMPERSONAÇÃO
════════════════════════════════════════════════════════════ */
document.getElementById('btnImpersonar')?.addEventListener('click', async () => {
    const perfil = document.getElementById('selectPerfilImpersonar').value;
    if (!perfil) {
        alert('Selecione um perfil antes de entrar na visualização.');
        return;
    }

    const btn = document.getElementById('btnImpersonar');
    btn.disabled    = true;
    btn.textContent = 'Entrando…';

    try {
        const res  = await api('/admin/impersonar', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ perfil }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.erro || 'Erro ao ativar visualização.');

        // Redireciona para o dashboard como o perfil simulado
        window.location.replace('/pages/dashboard/');
    } catch (e) {
        alert(`Erro: ${e.message}`);
        btn.disabled    = false;
        btn.textContent = 'Entrar na visualização';
    }
});

/* ════════════════════════════════════════════════════════════
   SUPORTE / TICKETS
════════════════════════════════════════════════════════════ */
const TIPO_LABEL_SUPORTE = {
    extensao: '📅 Extensão',
    duvida: '❓ Dúvida',
    bug: '🐛 Bug',
    sugestao: '💡 Sugestão',
    outro: '📌 Outro',
};
const STATUS_LABEL_SUPORTE = { pendente: 'Pendente', resolvido: 'Resolvido', negado: 'Negado' };

async function carregarSuporte() {
    const el = document.getElementById('suporteContainer');
    const status = document.getElementById('filtroSuporteStatus').value;
    try {
        const q = status ? `?status=${status}` : '';
        const res = await api(`/admin/suporte${q}`);
        const tickets = await res.json();

        const badgeEl = document.getElementById('suporteBadge');
        const badgeRes = await api('/admin/suporte/badge');
        const badgeData = await badgeRes.json();
        if (badgeData.pendentes > 0) {
            badgeEl.textContent = badgeData.pendentes;
            badgeEl.style.display = 'inline';
        } else {
            badgeEl.style.display = 'none';
        }

        if (!tickets.length) {
            el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-secondary)">Nenhum ticket encontrado.</div>';
            return;
        }

        const fmtDt = iso => iso ? new Date(iso).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

        el.innerHTML = tickets.map(t => `
            <div style="padding:14px;border:1.5px solid var(--border);border-radius:10px;margin-bottom:10px;background:var(--bg-hover)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <div style="display:flex;gap:6px;align-items:center">
                        <span style="font-size:.75rem;font-weight:700;padding:2px 8px;border-radius:12px;background:${t.tipo==='extensao'?'#fef3c7':t.tipo==='bug'?'#fef2f2':'#dbeafe'};color:${t.tipo==='extensao'?'#92400e':t.tipo==='bug'?'#dc2626':'#1e40af'}">${TIPO_LABEL_SUPORTE[t.tipo] || t.tipo}</span>
                        <span style="font-size:.78rem;color:var(--text-secondary)">${t.usuario_nome}</span>
                    </div>
                    <span style="font-size:.75rem;font-weight:700;padding:2px 8px;border-radius:12px;background:${t.status==='pendente'?'#fef3c7':t.status==='resolvido'?'#d1fae5':'#fef2f2'};color:${t.status==='pendente'?'#92400e':t.status==='resolvido'?'#065f46':'#dc2626'}">${STATUS_LABEL_SUPORTE[t.status]}</span>
                </div>
                <div style="font-weight:600;font-size:.88rem;margin-bottom:4px">${t.assunto}</div>
                <div style="font-size:.83rem;color:var(--text-secondary);white-space:pre-wrap;margin-bottom:6px">${t.mensagem}</div>
                <div style="font-size:.76rem;color:var(--text-secondary)">${fmtDt(t.criado_em)}</div>
                ${t.resposta ? `<div style="margin-top:8px;padding:8px 12px;background:var(--bg-card);border-radius:8px;border-left:3px solid var(--accent,#2563eb);font-size:.83rem"><strong style="display:block;font-size:.78rem;color:var(--accent,#2563eb);margin-bottom:4px">Resposta (${fmtDt(t.respondido_em)})</strong>${t.resposta}</div>` : ''}
                ${t.status === 'pendente' ? `
                    <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
                        <input type="text" placeholder="Resposta (opcional)" id="respSuporte${t.id}" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:.82rem;background:var(--bg-input);color:var(--text-primary)" />
                        <button onclick="responderSuporte(${t.id},'resolvido')" style="padding:7px 14px;background:#22c55e;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:.8rem;cursor:pointer">Resolver</button>
                        <button onclick="responderSuporte(${t.id},'negado')" style="padding:7px 14px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:.8rem;cursor:pointer">Negar</button>
                    </div>
                ` : ''}
            </div>
        `).join('');
    } catch (e) {
        el.innerHTML = `<div style="color:#dc2626">Erro: ${e.message}</div>`;
    }
}

window.responderSuporte = async function (id, acao) {
    const respInput = document.getElementById(`respSuporte${id}`);
    const resposta = respInput ? respInput.value.trim() : '';
    try {
        const res = await api(`/admin/suporte/${id}/responder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao, resposta }),
        });
        if (!res.ok) {
            const d = await res.json();
            alert(d.erro || 'Erro ao responder.');
            return;
        }
        carregarSuporte();
    } catch (e) {
        alert('Erro: ' + e.message);
    }
};

document.getElementById('filtroSuporteStatus').addEventListener('change', carregarSuporte);

/* ════════════════════════════════════════════════════════════
   CONFIGURAÇÕES DO SISTEMA
════════════════════════════════════════════════════════════ */
const CONFIG_LABELS = {
    portal_modo_demo: {
        nome: 'Modo Demonstração dos Portais',
        desc: 'Quando ativado, permite login no Portal do Aluno e Portal Pedagógico com qualquer email Google (sem restrição de domínio @escola.pr.gov.br). Útil para testes e demonstrações.',
        tipo: 'toggle',
    },
};

async function carregarConfig() {
    const el = document.getElementById('configContainer');
    try {
        const res = await api('/admin/config');
        const configs = await res.json();

        const ESCOLA_CHAVES = ['escola_nome_oficial', 'escola_endereco', 'escola_logo_base64'];
        const configsFiltradas = configs.filter(c => !ESCOLA_CHAVES.includes(c.chave));
        if (!configsFiltradas.length) {
            el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-secondary)">Nenhuma configuração disponível.</div>';
            return;
        }

        el.innerHTML = configsFiltradas.map(c => {
            const meta = CONFIG_LABELS[c.chave] || { nome: c.chave, desc: c.obs || '', tipo: 'text' };
            const isToggle = meta.tipo === 'toggle';
            const isOn = c.valor === 'true';

            if (isToggle) {
                return `<div style="padding:16px;border:1.5px solid var(--border);border-radius:10px;margin-bottom:12px;background:var(--bg-hover);display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
                    <div style="flex:1">
                        <div style="font-weight:700;font-size:.9rem;margin-bottom:4px">${meta.nome}</div>
                        <div style="font-size:.8rem;color:var(--text-secondary)">${meta.desc}</div>
                    </div>
                    <label style="position:relative;width:52px;height:28px;flex-shrink:0;cursor:pointer">
                        <input type="checkbox" ${isOn ? 'checked' : ''} onchange="toggleConfig('${c.chave}', this.checked)"
                               style="position:absolute;opacity:0;width:0;height:0" />
                        <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:${isOn ? '#22c55e' : '#d1d5db'};border-radius:14px;transition:background .2s"></span>
                        <span style="position:absolute;top:2px;left:${isOn ? '26px' : '2px'};width:24px;height:24px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
                    </label>
                </div>`;
            }
            return `<div style="padding:16px;border:1.5px solid var(--border);border-radius:10px;margin-bottom:12px;background:var(--bg-hover)">
                <div style="font-weight:700;font-size:.9rem;margin-bottom:4px">${meta.nome}</div>
                <div style="font-size:.8rem;color:var(--text-secondary);margin-bottom:8px">${meta.desc}</div>
                <div style="display:flex;gap:8px">
                    <input type="text" value="${c.valor}" id="cfgVal_${c.chave}" style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:.84rem;background:var(--bg-input);color:var(--text-primary)" />
                    <button onclick="salvarConfig('${c.chave}')" style="padding:7px 14px;background:var(--accent,#2563eb);color:#fff;border:none;border-radius:6px;font-weight:700;font-size:.82rem;cursor:pointer">Salvar</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        el.innerHTML = `<div style="color:#dc2626">Erro: ${e.message}</div>`;
    }
}

window.toggleConfig = async function (chave, ativo) {
    try {
        const res = await api(`/admin/config/${chave}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor: ativo ? 'true' : 'false' }),
        });
        if (!res.ok) {
            const d = await res.json();
            alert(d.erro || 'Erro ao salvar.');
        }
        carregarConfig();
    } catch (e) {
        alert('Erro: ' + e.message);
    }
};

window.salvarConfig = async function (chave) {
    const valor = document.getElementById(`cfgVal_${chave}`).value;
    try {
        const res = await api(`/admin/config/${chave}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor }),
        });
        if (!res.ok) {
            const d = await res.json();
            alert(d.erro || 'Erro ao salvar.');
        }
        carregarConfig();
    } catch (e) {
        alert('Erro: ' + e.message);
    }
};

/* ════════════════════════════════════════════════════════════════
   DADOS DA ESCOLA (CABEÇALHO DO PDF)
══════════════════════════════════════════════════════════════ */

let _escolaLogoBase64Pendente = null;

async function carregarDadosEscola() {
    try {
        const res = await api('/admin/config');
        const configs = await res.json();
        const get = chave => (configs.find(c => c.chave === chave) || {}).valor || '';

        const nome = get('escola_nome_oficial');
        const end  = get('escola_endereco');
        const logo = get('escola_logo_base64');

        const elNome = document.getElementById('escolaNomeOficial');
        const elEnd  = document.getElementById('escolaEndereco');
        if (elNome) elNome.value = nome;
        if (elEnd)  elEnd.value  = end;

        _escolaLogoBase64Pendente = null;
        atualizarPreviewLogo(logo);
    } catch { /* silencia */ }
}

function atualizarPreviewLogo(base64) {
    const preview = document.getElementById('escolaLogoPreview');
    const btnRemover = document.getElementById('btnRemoverLogo');
    if (!preview) return;
    if (base64) {
        preview.src = base64;
        preview.style.display = 'block';
        if (btnRemover) btnRemover.style.display = 'inline-block';
    } else {
        preview.src = '';
        preview.style.display = 'none';
        if (btnRemover) btnRemover.style.display = 'none';
    }
}

window.onEscolaLogoChange = function (input) {
    const file = input.files[0];
    if (!file) return;

    const TIPOS_SUPORTADOS = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!TIPOS_SUPORTADOS.includes(file.type)) {
        showToast('Formato não suportado. Use PNG, JPG, GIF, WebP ou SVG.', 'error');
        input.value = '';
        return;
    }

    const WARN_SIZE_BYTES = 500 * 1024;
    const MAX_B64_CHARS   = 50 * 1024 * (4 / 3);

    if (file.size > WARN_SIZE_BYTES) {
        showToast('Imagem grande detectada. Ela será reduzida automaticamente antes de salvar.', 'warning');
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onload = function () {
            const MAX = 200;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            let result = canvas.toDataURL('image/png');

            if (result.length > MAX_B64_CHARS) {
                const qualities = [0.85, 0.70, 0.55, 0.40];
                for (const q of qualities) {
                    const candidate = canvas.toDataURL('image/jpeg', q);
                    result = candidate;
                    if (candidate.length <= MAX_B64_CHARS) break;
                }
            }

            if (result.length > MAX_B64_CHARS) {
                showToast('Imagem muito grande mesmo após compressão. Use uma imagem menor ou mais simples.', 'error');
                input.value = '';
                return;
            }

            _escolaLogoBase64Pendente = result;
            atualizarPreviewLogo(_escolaLogoBase64Pendente);
        };
        img.onerror = function () {
            showToast('Não foi possível carregar a imagem. Tente outro arquivo.', 'error');
            input.value = '';
        };
        img.src = dataUrl;
    };
    reader.readAsDataURL(file);
};

window.removerLogoEscola = function () {
    _escolaLogoBase64Pendente = '';
    atualizarPreviewLogo('');
    const input = document.getElementById('escolaLogoInput');
    if (input) input.value = '';
};

window.salvarDadosEscola = async function () {
    const nome = (document.getElementById('escolaNomeOficial')?.value || '').trim();
    const end  = (document.getElementById('escolaEndereco')?.value || '').trim();

    const salvar = async (chave, valor) => {
        const r = await api(`/admin/config/${chave}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor }),
        });
        if (!r.ok) throw new Error((await r.json()).erro || 'Erro');
    };

    try {
        await salvar('escola_nome_oficial', nome);
        await salvar('escola_endereco', end);
        if (_escolaLogoBase64Pendente !== null) {
            await salvar('escola_logo_base64', _escolaLogoBase64Pendente);
            _escolaLogoBase64Pendente = null;
        }
        showToast('Dados da escola salvos com sucesso!', 'success');
    } catch (e) {
        showToast('Erro ao salvar: ' + e.message, 'error');
    }
};

/* ════════════════════════════════════════════════════════════════
   EXPORTAR / IMPORTAR CONFIGURAÇÃO
══════════════════════════════════════════════════════════════ */

window.exportarConfig = async function () {
    try {
        const res = await api('/admin/export-config');
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `edusync-config-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Configuração exportada com sucesso!', 'success');
    } catch (e) {
        showToast('Erro ao exportar: ' + e.message, 'error');
    }
};

window.importarConfig = function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.versao) { showToast('Arquivo inválido — não é um export do EduSync.', 'error'); return; }

            const resumo = [];
            if (data.classroom_grupos?.length) resumo.push(`${data.classroom_grupos.length} grupos`);
            if (data.classroom_grupo_atividades?.length) resumo.push(`${data.classroom_grupo_atividades.length} atividades vinculadas`);
            if (data.classroom_ausencias?.length) resumo.push(`${data.classroom_ausencias.length} ausências`);
            if (data.classroom_entregas_tardias?.length) resumo.push(`${data.classroom_entregas_tardias.length} tardias`);
            if (data.edusync_config?.length) resumo.push(`${data.edusync_config.length} configurações`);
            if (data.classroom_acesso_pedagogo?.length) resumo.push(`${data.classroom_acesso_pedagogo.length} acessos pedagógicos`);

            const msg = `Importar configuração?\n\nArquivo: ${file.name}\nExportado em: ${data.exportadoEm || '?'}\n\nConteúdo:\n• ${resumo.join('\n• ') || 'Vazio'}\n\nDados existentes não serão sobrescritos (apenas novos serão adicionados).`;
            if (!confirm(msg)) return;

            const btn = document.getElementById('btnImportar');
            if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }

            const res = await api('/admin/import-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const result = await res.json();
            if (btn) { btn.disabled = false; btn.textContent = 'Importar Configuração'; }

            if (result.erro) { showToast('Erro: ' + result.erro, 'error'); return; }

            const r = result.resultado;
            showToast(`Importado: ${r.grupos} grupos, ${r.atividades} atividades, ${r.ausencias} ausências, ${r.tardias} tardias, ${r.configs} configs, ${r.acessos} acessos`, 'success');
        } catch (err) {
            showToast('Erro ao importar: ' + err.message, 'error');
        }
    };
    input.click();
};

/* ════════════════════════════════════════════════════════════
   ALUNOS — listagem e comunicado de suspensão
════════════════════════════════════════════════════════════ */
let _alunoSuspensaoAtual = null;
let _alunosListaCache    = [];

async function carregarTurmasAlunos() {
    const sel = document.getElementById('filtroAlunosTurma');
    if (!sel || sel.options.length > 1) return;
    try {
        const res = await api('/alunos/turmas/lista');
        const turmas = await res.json();
        turmas.forEach(t => {
            const opt = document.createElement('option');
            opt.value       = t.codturma;
            opt.textContent = t.turma;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error('Erro ao carregar turmas:', e);
    }
}

async function buscarAlunos() {
    const codturma = document.getElementById('filtroAlunosTurma').value;
    const wrap     = document.getElementById('tabelaAlunosWrap');
    if (!codturma) {
        wrap.innerHTML = '<p style="color:#d97706;font-size:.875rem">Selecione uma turma para buscar os alunos.</p>';
        return;
    }
    wrap.innerHTML = '<p style="color:var(--text-muted)">Carregando...</p>';
    try {
        const res   = await api(`/alunos?codturma=${encodeURIComponent(codturma)}`);
        const lista = await res.json();
        if (!lista.length) {
            wrap.innerHTML = '<p style="color:var(--text-muted)">Nenhum aluno encontrado nesta turma.</p>';
            return;
        }
        renderTabelaAlunos(lista);
    } catch (e) {
        wrap.innerHTML = `<p style="color:#dc2626">Erro: ${esc(e.message)}</p>`;
    }
}

function renderTabelaAlunos(lista) {
    _alunosListaCache = lista;
    const wrap = document.getElementById('tabelaAlunosWrap');
    wrap.innerHTML = `
    <table class="admin-table">
        <thead>
            <tr>
                <th>#</th>
                <th>Nome</th>
                <th>Turma</th>
                <th>Registro</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            ${lista.map((a, i) => `
            <tr>
                <td style="color:var(--text-muted);font-size:.8rem">${a.numchamada ?? '—'}</td>
                <td>${esc(a.nome)}</td>
                <td style="font-size:.85rem">${esc(a.turma || '—')}</td>
                <td style="font-family:monospace;font-size:.8rem;color:var(--text-muted)">${esc(a.registro || '—')}</td>
                <td>
                    <button class="btn-acao" style="background:#dc2626;color:#fff;border:none"
                        onclick="abrirModalSuspensao(${i})">
                        📄 Comunicado de Suspensão
                    </button>
                </td>
            </tr>`).join('')}
        </tbody>
    </table>`;
}

window.abrirModalSuspensao = function (idx) {
    const aluno = _alunosListaCache[idx];
    if (!aluno) return;
    _alunoSuspensaoAtual = aluno;
    document.getElementById('suspensaoNomeAluno').textContent  = aluno.nome || '—';
    document.getElementById('suspensaoTurmaAluno').textContent = aluno.turma ? `· ${aluno.turma}` : '';
    document.getElementById('suspensaoResponsavel').value = '';
    document.getElementById('suspensaoDataInicio').value  = '';
    document.getElementById('suspensaoDataFim').value     = '';
    document.getElementById('suspensaoMotivo').value      = '';
    const msg = document.getElementById('suspensaoMsg');
    msg.style.display = 'none';
    document.getElementById('modalSuspensao').classList.add('modal-overlay--ativo');
};

document.getElementById('btnCancelarSuspensao').addEventListener('click', fecharModalSuspensao);
document.getElementById('modalSuspensao').addEventListener('click', e => {
    if (e.target === document.getElementById('modalSuspensao')) fecharModalSuspensao();
});

function fecharModalSuspensao() {
    document.getElementById('modalSuspensao').classList.remove('modal-overlay--ativo');
    _alunoSuspensaoAtual = null;
}

document.getElementById('formSuspensao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const responsavel  = document.getElementById('suspensaoResponsavel').value.trim();
    const dataInicio   = document.getElementById('suspensaoDataInicio').value;
    const dataFim      = document.getElementById('suspensaoDataFim').value;
    const motivo       = document.getElementById('suspensaoMotivo').value.trim();
    const msg          = document.getElementById('suspensaoMsg');
    const btn          = document.getElementById('btnGerarComunicado');

    if (!responsavel || !dataInicio || !dataFim) {
        msg.textContent   = 'Preencha os campos obrigatórios: responsável, data de início e data de fim.';
        msg.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:6px;font-size:.85rem;margin-top:8px';
        return;
    }
    if (dataFim < dataInicio) {
        msg.textContent   = 'A data de fim não pode ser anterior à data de início.';
        msg.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:6px;font-size:.85rem;margin-top:8px';
        return;
    }

    msg.style.display = 'none';
    btn.disabled      = true;
    btn.textContent   = 'Gerando PDF...';

    try {
        await gerarComunicadoSuspensaoPDF({
            aluno:       _alunoSuspensaoAtual,
            responsavel,
            dataInicio,
            dataFim,
            motivo,
        });
        fecharModalSuspensao();
    } catch (err) {
        msg.textContent   = 'Erro ao gerar PDF: ' + err.message;
        msg.style.cssText = 'display:block;background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:6px;font-size:.85rem;margin-top:8px';
    } finally {
        btn.disabled    = false;
        btn.textContent = '📄 Gerar PDF';
    }
});

function formatarDataPtBr(isoDate) {
    if (!isoDate) return '—';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

async function gerarQrCodeDataUrl(url) {
    return new Promise((resolve, reject) => {
        const div = document.createElement('div');
        div.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:128px;height:128px';
        document.body.appendChild(div);
        try {
            new QRCode(div, {
                text:          url,
                width:         128,
                height:        128,
                colorDark:     '#000000',
                colorLight:    '#ffffff',
                correctLevel:  QRCode.CorrectLevel.M,
            });
            setTimeout(() => {
                const canvas = div.querySelector('canvas');
                const img    = div.querySelector('img');
                let dataUrl  = null;
                if (canvas) {
                    dataUrl = canvas.toDataURL('image/png');
                } else if (img) {
                    dataUrl = img.src;
                }
                document.body.removeChild(div);
                if (dataUrl) resolve(dataUrl);
                else reject(new Error('QR Code canvas não encontrado'));
            }, 200);
        } catch (err) {
            document.body.removeChild(div);
            reject(err);
        }
    });
}

async function carregarLogoDataUrl() {
    return new Promise(resolve => {
        try {
            const img   = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width  = 64;
                canvas.height = 64;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 64, 64);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(null);
            img.src = '/shared/assets/favicon.svg';
        } catch { resolve(null); }
    });
}

async function gerarComunicadoSuspensaoPDF({ aluno, responsavel, dataInicio, dataFim, motivo }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    /* ── Busca configs da escola no banco ── */
    let escolaNomeOficial = '';
    let escolaEndereco    = '';
    let escolaLogoBase64  = '';
    try {
        const cfgRes = await api('/admin/config');
        const cfgs   = await cfgRes.json();
        const get    = chave => (cfgs.find(c => c.chave === chave) || {}).valor || '';
        escolaNomeOficial = get('escola_nome_oficial');
        escolaEndereco    = get('escola_endereco');
        escolaLogoBase64  = get('escola_logo_base64');
    } catch { /* usa fallbacks abaixo */ }

    const portalUrl  = window.location.origin + '/alunos/';
    const escolaNome = escolaNomeOficial || localStorage.getItem('edusync_escola') || 'Estabelecimento de Ensino';
    const nomeAluno  = aluno.nome || 'Aluno não identificado';
    const turmaAluno = aluno.turma || '—';
    const dataEmissao   = formatarDataPtBr(new Date().toISOString().slice(0, 10));
    const dataInicioFmt = formatarDataPtBr(dataInicio);
    const dataFimFmt    = formatarDataPtBr(dataFim);

    /* ── Paleta de cor do documento ── */
    const COR_ACCENT   = [30, 58, 138];   /* navy-800 — discreto e elegante */
    const COR_ACCENT_L = [219, 234, 254]; /* blue-100 — fundo suave dos boxes */

    const margL  = 13;
    const margR  = 197;
    const largura = margR - margL;
    let y = 20;

    /* Ponto de divisão ALUNO | TURMA — 55% para aluno, 45% para turma */
    const splitX   = margL + Math.round(largura * 0.55);
    const nomeColW = splitX - margL - 6;
    const turmaColX = splitX + 4;
    const turmaColW = margR - turmaColX - 2;

    /* ── Carrega logo: usa base64 do banco se disponível, senão favicon ── */
    const logoDataUrl = escolaLogoBase64 || await carregarLogoDataUrl();

    /* ── BORDA DECORATIVA ── */
    const cabecalhoAltura = escolaEndereco ? 27 : 22;
    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.8);
    doc.rect(8, 8, 194, 281, 'S');
    doc.setLineWidth(0.25);
    doc.setDrawColor(200, 210, 230);
    doc.rect(10, 10, 190, 277, 'S');

    /* ── CABEÇALHO ── fundo navy discreto */
    doc.setFillColor(...COR_ACCENT);
    doc.rect(8, 8, 194, cabecalhoAltura, 'F');

    /* Logo da escola (destaque, lado esquerdo) */
    const logoSize = cabecalhoAltura - 4;
    const logoX    = margL;
    const logoY    = 8 + 2;
    if (logoDataUrl) {
        const mimeMatch  = logoDataUrl.match(/^data:image\/(\w+);/);
        const imgFormat  = mimeMatch ? mimeMatch[1].toUpperCase() : 'PNG';
        const jsPdfFmt   = (imgFormat === 'JPG' || imgFormat === 'JPEG') ? 'JPEG' : 'PNG';
        try {
            doc.setFillColor(255, 255, 255);
            doc.roundedRect(logoX - 1, logoY - 1, logoSize + 2, logoSize + 2, 2, 2, 'F');
            doc.addImage(logoDataUrl, jsPdfFmt, logoX, logoY, logoSize, logoSize);
        } catch { /* ignora se formato não suportado */ }
    }

    /* Nome da escola — ao lado da logo */
    const nomeX    = logoDataUrl ? logoX + logoSize + 5 : margL;
    const nomeMaxW = margR - nomeX - 2;
    const cabMeio  = 8 + cabecalhoAltura / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    const nomeEscolaLinhas = doc.splitTextToSize(escolaNome.toUpperCase(), nomeMaxW);
    const nomeEscolaY = escolaEndereco ? cabMeio - 2 : cabMeio + 2;
    doc.text(nomeEscolaLinhas[0], nomeX, nomeEscolaY);

    if (escolaEndereco) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(180, 210, 255);
        const endTrunc = doc.splitTextToSize(escolaEndereco, nomeMaxW)[0];
        doc.text(endTrunc, nomeX, nomeEscolaY + 5.5);
    }

    /* Data de emissão — canto inferior direito do cabeçalho */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(180, 210, 255);
    doc.text('Emissão: ' + dataEmissao, margR, 8 + cabecalhoAltura - 3, { align: 'right' });

    y = escolaEndereco ? 47 : 42;

    /* ── TÍTULO DO DOCUMENTO ── */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(30, 30, 30);
    doc.text('COMUNICADO DE SUSPENSÃO ESCOLAR', 105, y, { align: 'center' });
    y += 4;

    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.6);
    doc.line(margL, y, margR, y);
    y += 10;

    /* ── DADOS DO ALUNO ── */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const nomeLinhas  = doc.splitTextToSize(nomeAluno,  nomeColW);
    const turmaLinhas = doc.splitTextToSize(turmaAluno, turmaColW);
    const maxLinhas   = Math.max(nomeLinhas.length, turmaLinhas.length);
    const altDados    = maxLinhas * 5.5 + 14;

    doc.setFillColor(248, 250, 255);
    doc.setDrawColor(200, 215, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(margL, y, largura, altDados, 2, 2, 'FD');

    /* Linha divisória vertical entre colunas */
    doc.setDrawColor(220, 225, 240);
    doc.setLineWidth(0.25);
    doc.line(splitX, y + 2, splitX, y + altDados - 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(80, 100, 150);
    doc.text('ALUNO', margL + 4, y + 6);
    doc.text('TURMA', turmaColX, y + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(nomeLinhas,  margL + 4,  y + 12);
    doc.text(turmaLinhas, turmaColX,  y + 12);
    y += altDados + 6;

    /* ── PERÍODO DE SUSPENSÃO ── */
    doc.setFillColor(...COR_ACCENT_L);
    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.4);
    doc.roundedRect(margL, y, largura, 20, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COR_ACCENT);
    doc.text('PERIODO DE SUSPENSAO', margL + 4, y + 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text(`${dataInicioFmt}  a  ${dataFimFmt}`, (margL + margR) / 2, y + 14, { align: 'center' });
    y += 26;

    /* ── TEXTO FORMAL ── */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);

    const textoFormal = `Comunicamos ao(à) responsável que o(a) aluno(a) ${nomeAluno}, matriculado(a) na turma ${turmaAluno}, encontra-se SUSPENSO(A) das atividades presenciais no período de ${dataInicioFmt} a ${dataFimFmt}.`;
    const linhasFormais = doc.splitTextToSize(textoFormal, largura);
    doc.text(linhasFormais, margL, y, { lineHeightFactor: 1.6 });
    y += linhasFormais.length * 6.2 + 3;

    if (motivo) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        doc.text('Motivo:', margL, y);
        doc.setFont('helvetica', 'normal');
        const linhasMotivo = doc.splitTextToSize(motivo, largura - 20);
        doc.text(linhasMotivo, margL + 18, y);
        y += linhasMotivo.length * 5 + 4;
    }

    /* ── RESPONSABILIDADE PELO CONTEÚDO DO CADERNO ── */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const textoCaderno =
        `Os conteúdos ministrados em sala de aula durante o período de suspensão NÃO serão` +
        ` repassados pelo(a) professor(a). É de inteira responsabilidade do(a) aluno(a) ${nomeAluno}` +
        ` buscar os conteúdos com os colegas de turma e transcrever, em seu próprio caderno, todos os registros` +
        ` das aulas ocorridas no período de ausência.`;
    const linhasCaderno = doc.splitTextToSize(textoCaderno, largura - 8);
    const altCaderno = linhasCaderno.length * 4.5 + 16;

    doc.setFillColor(255, 251, 235);
    doc.setDrawColor(180, 120, 0);
    doc.setLineWidth(0.4);
    doc.roundedRect(margL, y, largura, altCaderno, 2, 2, 'FD');

    /* Barra lateral de destaque */
    doc.setFillColor(202, 138, 4);
    doc.rect(margL, y, 3, altCaderno, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(120, 70, 0);
    doc.text('Responsabilidade pelo Conteudo do Caderno', margL + 7, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 30, 30);
    doc.text(linhasCaderno, margL + 7, y + 14);
    y += altCaderno + 5;

    /* ── ORIENTAÇÃO PORTAL DO ALUNO ── */
    doc.setFillColor(...COR_ACCENT_L);
    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.4);
    const altPortal = 42;
    doc.roundedRect(margL, y, largura, altPortal, 2, 2, 'FD');

    /* Barra lateral de destaque */
    doc.setFillColor(...COR_ACCENT);
    doc.rect(margL, y, 3, altPortal, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COR_ACCENT);
    doc.text('Acesse o Portal do Aluno', margL + 7, y + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 30, 30);
    const textoPortal = 'Durante o período de suspensão, o(a) aluno(a) poderá acompanhar suas atividades escolares pelo Portal do Aluno. Acesse pelo link abaixo ou escaneie o QR Code com a câmera do celular:';
    const linhasPortal = doc.splitTextToSize(textoPortal, largura - 44);
    doc.text(linhasPortal, margL + 7, y + 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COR_ACCENT);
    const portalUrlLinhas = doc.splitTextToSize(portalUrl, largura - 44);
    doc.text(portalUrlLinhas, margL + 7, y + 16 + linhasPortal.length * 4.2 + 3);
    const qrY = y;
    const qrSize = altPortal - 4;
    const qrX = margR - qrSize - 2;
    y += altPortal + 5;

    /* ── INSTRUÇÕES MOBILE ── */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    const linhasInst = [
        '1. Abra a camera do celular',
        '2. Aponte para o QR Code',
        '3. Toque no link que aparecer na tela',
        '4. Entre com o e-mail institucional do(a) aluno(a)',
    ];
    doc.text(linhasInst, margL, y, { lineHeightFactor: 1.3 });
    y += linhasInst.length * 4.2 + 6;

    /* ── LOCAL E DATA (acima das assinaturas) ── */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    const dataLocalStr = `${escolaNome}, ${dataEmissao}`;
    const linhasLocal  = doc.splitTextToSize(dataLocalStr, largura);
    doc.text(linhasLocal, 105, y, { align: 'center' });
    y += linhasLocal.length * 4 + 4;

    /* ── ASSINATURAS ── */
    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.35);
    doc.line(margL, y, margL + 82, y);
    doc.line(margR - 72, y, margR, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text('Responsavel pelo aluno', margL, y + 5);
    doc.setFont('helvetica', 'bold');
    const respLinhas = doc.splitTextToSize(responsavel, 78);
    doc.text(respLinhas[0], margL, y + 10);

    doc.setFont('helvetica', 'normal');
    doc.text('Ciente: Coordenador(a)/Diretor(a)', margR - 68, y + 5);

    /* ── RODAPÉ ── EduSync discreto */
    doc.setFillColor(240, 244, 252);
    doc.rect(8, 275, 194, 14, 'F');
    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.3);
    doc.line(8, 275, 202, 275);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 120, 170);
    doc.text('EduSync - Sistema de Gestao Escolar  |  ' + portalUrl.replace('https://', ''), 105, 281, { align: 'center' });
    doc.setTextColor(140, 150, 170);
    doc.text(`${escolaNome}  •  ${dataEmissao}`, 105, 285.5, { align: 'center' });

    /* ── QR CODE (gerado por último para não bloquear o layout) ── */
    try {
        const qrDataUrl = await gerarQrCodeDataUrl(portalUrl);
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY + 3, qrSize, qrSize);
    } catch {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(100, 100, 100);
        doc.text('[QR Code indisponível]', qrX + qrSize / 2, qrY + qrSize / 2, { align: 'center' });
    }

    /* ══════════════════════════════════════════════════════════════
       PÁGINAS EXTRAS — ATIVIDADES DO PORTAL DO ALUNO
       ══════════════════════════════════════════════════════════════ */

    /* Timestamp completo para o snapshot */
    const agora     = new Date();
    const snapHora  = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const snapData  = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const snapLabel = `Snapshot gerado em ${snapData} as ${snapHora}`;

    /* Helpers de página ─────────────────────────────────── */
    function pdfCabecalhoSecundario(titulo) {
        const altCab = 18;
        doc.setFillColor(...COR_ACCENT);
        doc.rect(8, 8, 194, altCab, 'F');

        /* Logo mínima */
        if (logoDataUrl) {
            try {
                const mimeM  = logoDataUrl.match(/^data:image\/(\w+);/);
                const fmtL   = mimeM && (mimeM[1].toUpperCase() === 'JPG' || mimeM[1].toUpperCase() === 'JPEG') ? 'JPEG' : 'PNG';
                doc.setFillColor(255, 255, 255);
                doc.roundedRect(margL - 1, 8 + 2, 13, 13, 1.5, 1.5, 'F');
                doc.addImage(logoDataUrl, fmtL, margL, 8 + 3, 11, 11);
            } catch { /* ok */ }
        }
        const txtX = logoDataUrl ? margL + 16 : margL;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(255, 255, 255);
        doc.text(titulo.toUpperCase(), txtX, 8 + 11);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(180, 210, 255);
        doc.text(snapLabel + '  |  ' + escolaNome, margR, 8 + 14.5, { align: 'right' });
    }

    function pdfRodapeSecundario() {
        doc.setFillColor(240, 244, 252);
        doc.rect(8, 275, 194, 14, 'F');
        doc.setDrawColor(...COR_ACCENT);
        doc.setLineWidth(0.3);
        doc.line(8, 275, 202, 275);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 120, 170);
        doc.text('EduSync - Sistema de Gestao Escolar  |  Portal: ' + portalUrl.replace('https://', ''), 105, 281, { align: 'center' });
        doc.setTextColor(140, 150, 170);
        doc.text(`${nomeAluno}  •  Turma: ${turmaAluno}  •  Gerado em ${snapData}`, 105, 285.5, { align: 'center' });
    }

    function pdfBordaSecundaria() {
        doc.setDrawColor(...COR_ACCENT);
        doc.setLineWidth(0.8);
        doc.rect(8, 8, 194, 281, 'S');
        doc.setLineWidth(0.25);
        doc.setDrawColor(200, 210, 230);
        doc.rect(10, 10, 190, 277, 'S');
    }

    /* Verifica espaço e faz nova página se necessário */
    function pdfChecarPagina(yAtual, alturaNeeded, tituloHeader) {
        if (yAtual + alturaNeeded > 272) {
            doc.addPage();
            pdfBordaSecundaria();
            pdfCabecalhoSecundario(tituloHeader);
            pdfRodapeSecundario();
            return 30;
        }
        return yAtual;
    }

    /* Tenta buscar atividades via portal ─────────────────── */
    let portalData = null;
    const emailAluno = aluno.email || '';
    if (emailAluno) {
        try {
            const pRes  = await api(`/admin/portal-aluno/preview?email=${encodeURIComponent(emailAluno)}`);
            if (pRes.ok) portalData = await pRes.json();
        } catch { /* falhou silenciosamente */ }
    }

    const cursos        = portalData?.cursos || [];
    const totalPend     = portalData?.totalPendentes  || 0;
    const totalZer      = portalData?.totalZeradas    || 0;
    const totalAguard   = portalData?.totalAguardando || 0;

    const TIPO_LABEL_PDF = {
        ASSIGNMENT:               'Tarefa',
        SHORT_ANSWER_QUESTION:    'Pergunta',
        MULTIPLE_CHOICE_QUESTION: 'Multipla escolha',
        MATERIAL:                 'Material',
        QUIZ:                     'Questionario',
    };

    /* ── Função para renderizar uma lista de cursos/atividades ── */
    function renderizarSecaoAtividades(doc, cursosFiltr, chave, titulo, corFundo, corBorda, corTexto, yInicio, tituloPag) {
        let y2 = yInicio;
        if (!cursosFiltr.length) return y2;

        /* Título da seção */
        y2 = pdfChecarPagina(y2, 14, tituloPag);
        doc.setFillColor(...corFundo);
        doc.setDrawColor(...corBorda);
        doc.setLineWidth(0.3);
        doc.roundedRect(margL, y2, largura, 10, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...corTexto);
        doc.text(titulo, margL + 4, y2 + 6.5);
        y2 += 12;

        cursosFiltr.forEach(curso => {
            const ativs = curso[chave] || [];
            if (!ativs.length) return;

            /* Header do curso */
            y2 = pdfChecarPagina(y2, 12, tituloPag);
            doc.setFillColor(245, 247, 255);
            doc.setDrawColor(200, 215, 240);
            doc.setLineWidth(0.25);
            doc.roundedRect(margL, y2, largura, 9, 1, 1, 'FD');
            doc.setFillColor(...COR_ACCENT);
            doc.rect(margL, y2, 2.5, 9, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(20, 40, 100);
            const nomeC = doc.splitTextToSize(curso.nome || '—', largura - 12);
            doc.text(nomeC[0], margL + 6, y2 + 6);
            const badgeTxt = `${ativs.length} ${ativs.length === 1 ? 'atividade' : 'atividades'}`;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(100, 120, 170);
            doc.text(badgeTxt, margR - 2, y2 + 6, { align: 'right' });
            y2 += 10;

            /* Itens */
            ativs.forEach((at, idx) => {
                const altItem = 11;
                y2 = pdfChecarPagina(y2, altItem, tituloPag);

                /* Zebra */
                if (idx % 2 === 0) {
                    doc.setFillColor(250, 252, 255);
                    doc.rect(margL, y2, largura, altItem, 'F');
                }

                /* Linha separadora leve */
                doc.setDrawColor(230, 235, 245);
                doc.setLineWidth(0.15);
                doc.line(margL + 2, y2, margR - 2, y2);

                /* Título da atividade */
                const tipoLabel = TIPO_LABEL_PDF[at.tipo] || at.tipo || '';
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(20, 20, 20);
                const tituloAt  = doc.splitTextToSize(at.titulo || '—', 110);
                doc.text(tituloAt[0], margL + 4, y2 + 4.5);

                /* Badge tipo */
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.setTextColor(60, 80, 140);
                doc.text(tipoLabel, margL + 4, y2 + 9);

                /* Prazo */
                if (at.prazo) {
                    doc.setTextColor(at.vencida ? 180 : 80, at.vencida ? 30 : 100, at.vencida ? 30 : 80);
                    doc.text('Prazo: ' + at.prazo, 130, y2 + 4.5);
                }

                /* Pontos */
                if (at.pontos != null) {
                    doc.setTextColor(30, 80, 30);
                    doc.text(String(at.pontos) + ' pts', 175, y2 + 4.5);
                }

                y2 += altItem;
            });

            y2 += 3; /* respiro entre cursos */
        });

        return y2;
    }

    /* ── PÁGINA(S) DE ATIVIDADES ── */
    const cursosComPend   = cursos.filter(c => (c.atividades   || []).length > 0);
    const cursosComZer    = cursos.filter(c => (c.zeradas      || []).length > 0);
    const cursosComAguard = cursos.filter(c => (c.aguardando   || []).length > 0);
    const temQualquer     = cursosComPend.length || cursosComZer.length || cursosComAguard.length;

    doc.addPage();
    pdfBordaSecundaria();
    pdfCabecalhoSecundario('Atividades do Portal do Aluno');
    pdfRodapeSecundario();

    let yAts = 30;

    /* Resumo topo */
    doc.setFillColor(...COR_ACCENT_L);
    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.3);
    doc.roundedRect(margL, yAts, largura, 16, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COR_ACCENT);
    doc.text('Resumo das Atividades', margL + 4, yAts + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 30, 30);
    const resumoTxt = temQualquer
        ? `Pendentes: ${totalPend}   |   Zeradas (0 pts): ${totalZer}   |   Aguardando correcao: ${totalAguard}`
        : 'Nenhuma atividade encontrada no Portal do Aluno para este aluno.';
    doc.text(resumoTxt, margL + 4, yAts + 13);
    yAts += 19;

    if (!emailAluno) {
        /* Aluno sem email no cadastro — aviso */
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(100, 100, 100);
        const avisoLinhas = doc.splitTextToSize(
            'O cadastro deste aluno nao possui e-mail vinculado ao Google Classroom. Para exibir as atividades do portal neste PDF, vincule o e-mail do aluno no cadastro do sistema.',
            largura);
        doc.text(avisoLinhas, margL, yAts, { lineHeightFactor: 1.5 });
        yAts += avisoLinhas.length * 5.5 + 4;
    } else if (temQualquer) {
        /* Pendentes */
        yAts = renderizarSecaoAtividades(
            doc, cursosComPend, 'atividades',
            `Atividades Pendentes (${totalPend})`,
            [255, 251, 235], [180, 120, 0], [120, 70, 0],
            yAts, 'Atividades do Portal do Aluno');

        /* Zeradas */
        yAts = renderizarSecaoAtividades(
            doc, cursosComZer, 'zeradas',
            `Entradas com Zero — Prazo Encerrado (${totalZer})`,
            [255, 241, 242], [200, 50, 50], [160, 30, 30],
            yAts, 'Atividades do Portal do Aluno');

        /* Aguardando */
        yAts = renderizarSecaoAtividades(
            doc, cursosComAguard, 'aguardando',
            `Aguardando Correcao do Professor (${totalAguard})`,
            [240, 253, 244], [22, 120, 60], [15, 80, 40],
            yAts, 'Atividades do Portal do Aluno');
    }

    /* ── NOTA SOBRE ATIVIDADES FUTURAS (sempre presente) ── */
    yAts = pdfChecarPagina(yAts + 6, 38, 'Atividades do Portal do Aluno');

    doc.setFillColor(...COR_ACCENT_L);
    doc.setDrawColor(...COR_ACCENT);
    doc.setLineWidth(0.5);
    doc.roundedRect(margL, yAts, largura, 38, 2, 2, 'FD');

    /* Barra lateral de destaque */
    doc.setFillColor(...COR_ACCENT);
    doc.rect(margL, yAts, 3.5, 38, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COR_ACCENT);
    doc.text('Sobre atividades futuras', margL + 7, yAts + 9);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(20, 20, 20);
    const futuroTxt = 'Novas atividades publicadas pelo professor durante e apos o periodo de suspensao aparecerão automaticamente no Portal do Aluno e no Google Classroom. O(a) aluno(a) e o(a) responsavel sao encorajados a acessar o portal regularmente para acompanhar as tarefas e prazos.';
    const futuroLinhas = doc.splitTextToSize(futuroTxt, largura - 12);
    doc.text(futuroLinhas, margL + 7, yAts + 16, { lineHeightFactor: 1.5 });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COR_ACCENT);
    doc.text('Portal do Aluno: ' + portalUrl, margL + 7, yAts + 32);

    /* ── DOWNLOAD ── */
    const nomeArq = `comunicado-suspensao-${nomeAluno.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${dataInicio}.pdf`;
    doc.save(nomeArq);

    /* ── SALVAR HISTÓRICO ── */
    try {
        const histRes = await api('/admin/comunicados-suspensao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                aluno_id:   aluno.id   || aluno.cod_matriz_aluno || null,
                nome_aluno: nomeAluno,
                turma:      turmaAluno,
                registro:   aluno.registro || null,
                responsavel,
                data_inicio: dataInicio,
                data_fim:    dataFim,
                motivo:      motivo || null,
            }),
        });
        if (!histRes.ok) {
            const errData = await histRes.json().catch(() => ({}));
            console.warn('[EduSync] Servidor recusou o registro do histórico:', histRes.status, errData?.erro || '');
        }
    } catch (e) {
        console.warn('[EduSync] Falha ao salvar histórico do comunicado:', e.message);
    }
}

document.getElementById('btnBuscarAlunos').addEventListener('click', buscarAlunos);

/* ════════════════════════════════════════════════════════════
   HISTÓRICO DE COMUNICADOS DE SUSPENSÃO
════════════════════════════════════════════════════════════ */

async function carregarHistoricoComunicados() {
    const busca = document.getElementById('buscaComunicados').value.trim();
    const wrap  = document.getElementById('historicoComunicadosWrap');
    wrap.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem">Carregando...</p>';

    try {
        const params = new URLSearchParams({ limite: 100 });
        if (busca) params.set('busca', busca);

        const res  = await api(`/admin/comunicados-suspensao?${params}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.erro || 'Erro ao carregar histórico.');

        if (!data.comunicados || !data.comunicados.length) {
            wrap.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem">Nenhum comunicado encontrado.</p>';
            return;
        }

        renderHistoricoComunicados(data.comunicados, data.total);
    } catch (e) {
        wrap.innerHTML = `<p style="color:#dc2626;font-size:.875rem">Erro: ${esc(e.message)}</p>`;
    }
}

function renderHistoricoComunicados(lista, total) {
    const wrap = document.getElementById('historicoComunicadosWrap');

    const linhas = lista.map(c => {
        const emitido = c.emitido_em
            ? new Date(c.emitido_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
            : '—';
        const periodo = `${formatarDataPtBr(c.data_inicio)} a ${formatarDataPtBr(c.data_fim)}`;
        return `
        <tr>
            <td>${esc(c.nome_aluno)}</td>
            <td style="font-size:.82rem">${esc(c.turma || '—')}</td>
            <td style="font-size:.82rem">${esc(periodo)}</td>
            <td style="font-size:.82rem">${esc(c.responsavel)}</td>
            <td style="font-size:.82rem;color:var(--text-muted)">${esc(c.gerado_por_nome || '—')}</td>
            <td style="font-size:.8rem;color:var(--text-muted);white-space:nowrap">${emitido}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
    <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:8px">Total: ${total} comunicado(s)</p>
    <div style="overflow-x:auto">
    <table class="admin-table">
        <thead>
            <tr>
                <th>Aluno</th>
                <th>Turma</th>
                <th>Período</th>
                <th>Responsável</th>
                <th>Gerado por</th>
                <th>Emitido em</th>
            </tr>
        </thead>
        <tbody>${linhas}</tbody>
    </table>
    </div>`;
}

document.getElementById('btnBuscarComunicados').addEventListener('click', carregarHistoricoComunicados);
document.getElementById('buscaComunicados').addEventListener('keydown', e => {
    if (e.key === 'Enter') carregarHistoricoComunicados();
});

/* ── Init ── */
carregarUsuarios();
carregarEscolas();
carregarSuporte();
