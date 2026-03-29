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

        if (btn.dataset.tab === 'audit') carregarAuditLog();
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

/* ── Init ── */
carregarUsuarios();
