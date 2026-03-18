const API = '';
let dataAtual = hoje();
let dadosGlobais = null;
let periodoModalAtivo = null;

function hoje() {
    return new Date().toISOString().split('T')[0];
}

function formatarData(iso) {
    const [a, m, d] = iso.split('-');
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const data = new Date(iso + 'T12:00:00');
    return `${dias[data.getDay()]}, ${d}/${m}/${a}`;
}

function nomePeriodo(p) {
    return { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' }[p] || p;
}

// Relógio ao vivo
function iniciarRelogio() {
    function tick() {
        const agora = new Date();
        const hh = String(agora.getHours()).padStart(2, '0');
        const mm = String(agora.getMinutes()).padStart(2, '0');
        const ss = String(agora.getSeconds()).padStart(2, '0');
        document.getElementById('clockDisplay').textContent = `${hh}:${mm}:${ss}`;
    }
    tick();
    setInterval(tick, 1000);
}

async function carregarDados() {
    try {
        const resp = await fetch(`${API}/api/cozinha?data=${dataAtual}`);
        const json = await resp.json();
        if (!resp.ok || json.erro) {
            toast('Tabela de presença não criada ainda. Execute setup_presenca.sql no Supabase.');
            return;
        }
        dadosGlobais = json;
        renderizarTudo();
    } catch (e) {
        toast('Erro ao carregar dados: ' + e.message);
    }
}

function renderizarTudo() {
    if (!dadosGlobais) return;

    document.getElementById('dataLabel').textContent = formatarData(dataAtual);

    const periodos = ['manha', 'tarde', 'noite'];
    let algumEstimado = false;

    periodos.forEach(p => {
        const d = dadosGlobais.resultado[p];
        if (!d) return;

        const cap = p.charAt(0).toUpperCase() + p.slice(1);
        const presentes = d.presentes;
        const matriculados = d.matriculados;
        const ausentes = d.ausentes;
        const pct = d.percentualPresenca;

        // Número principal
        document.getElementById(`presentes${cap}`).textContent = presentes != null ? presentes : '?';
        document.getElementById(`matriculados${cap}`).textContent = matriculados;
        document.getElementById(`ausentes${cap}`).textContent = ausentes != null ? ausentes : '?';
        document.getElementById(`pct${cap}`).textContent = pct != null ? `${pct}%` : '?';

        // Status badge
        const statusEl = document.getElementById(`status${cap}`);
        statusEl.textContent = traduzirStatus(d.status);
        statusEl.className = 'periodo-status status-' + d.status;

        // Confirmação da cozinha
        const confEl = document.getElementById(`conf${cap}`);
        if (d.confirmacaoCozinha) {
            const conf = d.confirmacaoCozinha;
            const hora = new Date(conf.confirmado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            confEl.className = 'confirmacao-info confirmado';
            confEl.textContent = `✅ Confirmado às ${hora}: ${conf.total_confirmado} refeições`;
        } else {
            confEl.className = 'confirmacao-info';
            confEl.textContent = 'Aguardando confirmação da cozinha';
        }

        // Histórico mini
        renderizarHistorico(p, dadosGlobais.historico[p] || []);

        if (d.status !== 'confirmado') algumEstimado = true;
    });

    document.getElementById('alertSync').style.display = algumEstimado ? 'block' : 'none';
}

function traduzirStatus(s) {
    return { aguardando: 'Aguardando', parcial: 'Parcial', confirmado: 'Confirmado' }[s] || s;
}

function renderizarHistorico(periodo, hist) {
    const cap = periodo.charAt(0).toUpperCase() + periodo.slice(1);
    const el = document.getElementById(`hist${cap}`);
    if (!hist.length) { el.innerHTML = '<span style="font-size:11px;color:#444">Sem histórico</span>'; return; }

    const max = Math.max(...hist.map(h => h.total), 1);
    el.innerHTML = hist.slice(-7).map(h => {
        const pct = Math.round(h.total / max * 100);
        const [a, m, d] = h.data.split('-');
        return `<div class="hist-bar" title="${d}/${m}: ${h.total} presentes">
            <div class="hist-fill" style="height:${Math.max(pct, 5)}%"></div>
            <span class="hist-label">${d}/${m}</span>
        </div>`;
    }).join('');
}

// Modal cozinha
function abrirConfirmarCozinha(periodo) {
    periodoModalAtivo = periodo;
    const d = dadosGlobais?.resultado?.[periodo];
    document.getElementById('modalCozinhaTitulo').textContent = `Confirmar Cardápio — ${nomePeriodo(periodo)}`;
    document.getElementById('modalCozinhaPeriodo').textContent = `${nomePeriodo(periodo)} de ${formatarData(dataAtual)}`;

    const sugestao = d?.presentes ?? d?.matriculados ?? 0;
    document.getElementById('inputCozinha').value = sugestao;
    document.getElementById('inputObsCozinha').value = '';

    document.getElementById('modalCozinha').style.display = 'flex';
}

function fecharModalCozinha() {
    document.getElementById('modalCozinha').style.display = 'none';
    periodoModalAtivo = null;
}

function ajustarCozinha(delta) {
    const el = document.getElementById('inputCozinha');
    el.value = Math.max(0, (parseInt(el.value) || 0) + delta);
}

async function confirmarCozinha() {
    if (!periodoModalAtivo) return;
    const total_confirmado = parseInt(document.getElementById('inputCozinha').value);
    const observacao = document.getElementById('inputObsCozinha').value.trim();

    if (isNaN(total_confirmado) || total_confirmado < 0) {
        toast('Informe um número válido');
        return;
    }

    try {
        const resp = await fetch(`${API}/api/cozinha/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: dataAtual, periodo: periodoModalAtivo, total_confirmado, observacao }),
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.erro);

        fecharModalCozinha();
        await carregarDados();
        toast(`✅ ${nomePeriodo(periodoModalAtivo)}: ${total_confirmado} refeições confirmadas!`);
    } catch (e) {
        toast('Erro: ' + e.message);
    }
}

// Auto-refresh (60s)
setInterval(carregarDados, 60 * 1000);

// Toast
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
}

// Data selector
document.getElementById('inputData').addEventListener('change', (e) => {
    dataAtual = e.target.value;
    carregarDados();
});
document.getElementById('btnHoje').addEventListener('click', () => {
    dataAtual = hoje();
    document.getElementById('inputData').value = dataAtual;
    carregarDados();
});
document.getElementById('btnAtualizar').addEventListener('click', carregarDados);

// Init
document.getElementById('inputData').value = dataAtual;
iniciarRelogio();
carregarDados();
