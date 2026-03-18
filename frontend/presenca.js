const API = '';
let dataAtual = hoje();
let todosRegistros = [];
let periodoAtivo = 'todos';
let turmaEditando = null;

function hoje() {
    return new Date().toISOString().split('T')[0];
}

function formatarData(iso) {
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
}

function nomePeriodo(p) {
    return { manha: '🌅 Manhã', tarde: '☀️ Tarde', noite: '🌙 Noite' }[p] || p;
}

function labelFonte(fonte) {
    if (fonte === 'rco') return { texto: '✓ RCO', classe: 'fonte-rco' };
    if (fonte === 'professor') return { texto: '✓ Professor', classe: 'fonte-professor' };
    if (fonte === 'estimado') return { texto: '◑ Estimado', classe: 'fonte-estimado' };
    return { texto: '– Pendente', classe: 'fonte-pendente' };
}

async function carregarDados(data) {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('turmasGrid').style.display = 'none';
    document.getElementById('vazio').style.display = 'none';

    try {
        const resp = await fetch(`${API}/api/presenca-diaria?data=${data}`);
        const json = await resp.json();
        todosRegistros = Array.isArray(json) ? json : [];
        if (!resp.ok && json.erro) {
            toast('Atenção: tabela de presença ainda não criada no banco. Execute o SQL em backend/setup_presenca.sql no Supabase.', true);
        }
        renderizarTudo();
    } catch (e) {
        toast('Erro ao carregar dados: ' + e.message, true);
        document.getElementById('loading').style.display = 'none';
    }
}

function renderizarTudo() {
    atualizarResumo();
    renderizarGrid();
}

function atualizarResumo() {
    const periodos = ['manha', 'tarde', 'noite'];
    let totalPresentes = 0;
    let totalMatriculados = 0;
    let algumSemDado = false;

    periodos.forEach(p => {
        const turmasP = todosRegistros.filter(r => r.periodo === p);
        const matriculados = turmasP.reduce((s, r) => s + (r.total_matriculados || 0), 0);
        const todosTemDado = turmasP.length > 0 && turmasP.every(r => r.total_presentes != null);
        const presentes = todosTemDado ? turmasP.reduce((s, r) => s + (r.total_presentes || 0), 0) : null;

        if (presentes != null) {
            totalPresentes += presentes;
        } else {
            algumSemDado = true;
        }
        totalMatriculados += matriculados;

        const numEl = document.getElementById(`num${cap(p)}`);
        const subEl = document.getElementById(`sub${cap(p)}`);

        if (turmasP.length === 0) {
            numEl.textContent = '–';
            subEl.textContent = 'sem turmas';
        } else if (presentes == null) {
            numEl.textContent = '?';
            subEl.textContent = `${matriculados} matr. / aguardando`;
        } else {
            numEl.textContent = presentes;
            const pct = matriculados > 0 ? Math.round(presentes / matriculados * 100) : 0;
            subEl.textContent = `de ${matriculados} matriculados (${pct}%)`;
        }
    });

    document.getElementById('numTotal').textContent = algumSemDado ? '?' : totalPresentes;
    document.getElementById('subTotal').textContent = `de ${totalMatriculados} matriculados`;
}

function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

function renderizarGrid() {
    const grid = document.getElementById('turmasGrid');
    document.getElementById('loading').style.display = 'none';

    let registros = periodoAtivo === 'todos'
        ? todosRegistros
        : todosRegistros.filter(r => r.periodo === periodoAtivo);

    if (!registros.length) {
        grid.style.display = 'none';
        document.getElementById('vazio').style.display = 'block';
        return;
    }

    document.getElementById('vazio').style.display = 'none';
    grid.style.display = 'grid';

    // Ordenar: manhã → tarde → noite, depois por nome
    const ordem = { manha: 0, tarde: 1, noite: 2 };
    registros = [...registros].sort((a, b) => {
        const dp = ordem[a.periodo] - ordem[b.periodo];
        if (dp !== 0) return dp;
        return (a.descr_turma || '').localeCompare(b.descr_turma || '');
    });

    grid.innerHTML = registros.map(r => {
        const fonte = labelFonte(r.fonte);
        const m = r.total_matriculados || 0;
        const p = r.total_presentes;
        const a = r.total_ausentes;
        const pct = (p != null && m > 0) ? Math.round(p / m * 100) : null;

        const pctClass = pct == null ? '' : pct >= 75 ? '' : pct >= 50 ? 'amarelo' : 'vermelho';
        const numClass = p == null ? 'cinza' : p > 0 ? 'verde' : 'vermelho';

        return `
        <div class="turma-card periodo-${r.periodo}" data-id="${r.cod_turma}">
            <div class="turma-card-header">
                <div class="turma-nome">${r.descr_turma || 'Turma ' + r.cod_turma}</div>
                <span class="fonte-badge ${fonte.classe}">${fonte.texto}</span>
            </div>
            <div class="turma-card-nums">
                <div class="num-item">
                    <div class="num-val ${numClass}">${p != null ? p : '?'}</div>
                    <div class="num-label">Presentes</div>
                </div>
                <div class="num-item">
                    <div class="num-val cinza">${a != null ? a : '?'}</div>
                    <div class="num-label">Ausentes</div>
                </div>
                <div class="num-item">
                    <div class="num-val cinza">${m}</div>
                    <div class="num-label">Matriculados</div>
                </div>
            </div>
            ${pct != null ? `
            <div class="turma-pct">
                <span>${pct}% de presença</span>
                <div class="pct-bar"><div class="pct-fill ${pctClass}" style="width:${pct}%"></div></div>
            </div>` : ''}
            ${r.observacao ? `<div class="turma-obs">📝 ${r.observacao}</div>` : ''}
            <button class="btn-editar" onclick="abrirConfirmar(${r.cod_turma})">
                ✏️ Confirmar Presença
            </button>
        </div>`;
    }).join('');
}

function abrirConfirmar(codTurma) {
    const r = todosRegistros.find(x => x.cod_turma === codTurma);
    if (!r) return;

    turmaEditando = r;
    document.getElementById('modalTurmaNome').textContent = r.descr_turma || 'Turma ' + codTurma;
    document.getElementById('modalMatriculados').textContent = r.total_matriculados || '?';
    document.getElementById('modalFonte').textContent = labelFonte(r.fonte).texto;
    document.getElementById('inputPresentes').value = r.total_presentes != null ? r.total_presentes : (r.total_matriculados || 0);
    document.getElementById('inputObs').value = r.observacao || '';
    atualizarHintContador();

    document.getElementById('modalConfirmar').style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modalConfirmar').style.display = 'none';
    turmaEditando = null;
}

function ajustarContador(delta) {
    const el = document.getElementById('inputPresentes');
    const val = parseInt(el.value) || 0;
    const max = turmaEditando?.total_matriculados || 999;
    el.value = Math.max(0, Math.min(max, val + delta));
    atualizarHintContador();
}

function atualizarHintContador() {
    if (!turmaEditando) return;
    const p = parseInt(document.getElementById('inputPresentes').value) || 0;
    const m = turmaEditando.total_matriculados || 0;
    const a = Math.max(0, m - p);
    const pct = m > 0 ? Math.round(p / m * 100) : 0;
    document.getElementById('counterHint').textContent =
        m > 0 ? `${a} ausente(s) · ${pct}% de presença` : '';
}

document.getElementById('inputPresentes').addEventListener('input', atualizarHintContador);

document.getElementById('btnConfirmarModal').addEventListener('click', async () => {
    if (!turmaEditando) return;
    const total_presentes = parseInt(document.getElementById('inputPresentes').value);
    const observacao = document.getElementById('inputObs').value.trim();

    if (isNaN(total_presentes) || total_presentes < 0) {
        toast('Informe um número válido de presentes', true);
        return;
    }

    document.getElementById('btnConfirmarModal').textContent = 'Salvando...';
    document.getElementById('btnConfirmarModal').disabled = true;

    try {
        const resp = await fetch(`${API}/api/presenca-diaria/confirmar`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: dataAtual,
                cod_turma: turmaEditando.cod_turma,
                total_presentes,
                observacao,
            }),
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.erro || 'Erro ao confirmar');

        // Atualizar localmente
        const idx = todosRegistros.findIndex(r => r.cod_turma === turmaEditando.cod_turma);
        if (idx >= 0) todosRegistros[idx] = result;

        fecharModal();
        renderizarTudo();
        toast('✅ Presença confirmada com sucesso!');
    } catch (e) {
        toast('Erro: ' + e.message, true);
    } finally {
        document.getElementById('btnConfirmarModal').textContent = '✅ Confirmar';
        document.getElementById('btnConfirmarModal').disabled = false;
    }
});

// Sync RCO
document.getElementById('btnSyncRCO').addEventListener('click', async () => {
    const btn = document.getElementById('btnSyncRCO');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const resp = await fetch(`${API}/api/presenca-diaria/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: dataAtual }),
        });
        const result = await resp.json();
        toast('🔄 ' + (result.msg || 'Sincronização iniciada! Aguarde e recarregue em 1-2 minutos.'));

        // Recarregar após delay
        setTimeout(() => carregarDados(dataAtual), 90000);
    } catch (e) {
        toast('Erro ao iniciar sync: ' + e.message, true);
    } finally {
        setTimeout(() => {
            btn.classList.remove('loading');
            btn.disabled = false;
        }, 5000);
    }
});

// Seed (carregar turmas sem dados do RCO)
document.getElementById('btnSeed').addEventListener('click', async () => {
    const btn = document.getElementById('btnSeed');
    btn.textContent = 'Carregando...';
    btn.disabled = true;

    try {
        const resp = await fetch(`${API}/api/presenca-diaria/seed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: dataAtual }),
        });
        const result = await resp.json();
        toast(`📋 ${result.turmas} turma(s) preparada(s) para o dia.`);
        await carregarDados(dataAtual);
    } catch (e) {
        toast('Erro: ' + e.message, true);
    } finally {
        btn.textContent = '📋 Carregar Turmas';
        btn.disabled = false;
    }
});

// Seletor de data
document.getElementById('inputData').addEventListener('change', (e) => {
    dataAtual = e.target.value;
    carregarDados(dataAtual);
});
document.getElementById('btnHoje').addEventListener('click', () => {
    dataAtual = hoje();
    document.getElementById('inputData').value = dataAtual;
    carregarDados(dataAtual);
});

// Abas
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        periodoAtivo = btn.dataset.periodo;
        renderizarGrid();
    });
});

// Toast
function toast(msg, isErro = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.background = isErro ? '#dc2626' : '#1a1a2e';
    el.style.color = 'white';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
}

// Init
document.getElementById('inputData').value = dataAtual;
carregarDados(dataAtual);
