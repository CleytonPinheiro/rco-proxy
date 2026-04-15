'use strict';

/* ── Helpers ── */
const esc  = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api  = (path, opts = {}) => fetch(`/api${path}`, { credentials: 'include', ...opts });

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
        if (btn.dataset.tab === 'config')  carregarConfig();
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
        if (!configs.length) {
            el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-secondary)">Nenhuma configuração disponível.</div>';
            return;
        }

        el.innerHTML = configs.map(c => {
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

/* ── Init ── */
carregarUsuarios();
carregarEscolas();
carregarSuporte();
