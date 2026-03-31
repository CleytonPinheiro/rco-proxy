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

function badgePlanoAdmin(plano) {
    if (!plano) return `<span style="font-size:.75rem;color:var(--text-muted)">—</span>`;
    const info = ADMIN_PLANO_INFO[plano] || { icone: '?', label: plano, bg: '#f3f4f6', color: '#6b7280' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:${info.bg};color:${info.color};font-size:.72rem;font-weight:700;padding:3px 9px;border-radius:20px">${info.icone} ${info.label}</span>`;
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
                <td>${badgePlanoAdmin(e.plano)}</td>
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

/* ── Init ── */
carregarUsuarios();
carregarEscolas();
