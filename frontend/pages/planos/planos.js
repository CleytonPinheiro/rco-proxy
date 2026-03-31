'use strict';

/* ── Toggle Mensal / Anual ──────────────────────────────────── */
const toggle       = document.getElementById('togglePeriodo');
const labelMensal  = document.getElementById('labelMensal');
const labelAnual   = document.getElementById('labelAnual');
const precos       = document.querySelectorAll('.pl-price-valor');
const cobrancas    = {
    inicial:       document.getElementById('cobrancaInicial'),
    profissional:  document.getElementById('cobrancaProfissional'),
    rede:          document.getElementById('cobrancaRede'),
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

    const txtMensal = anual ? 'Cobrado anualmente' : 'Cobrado mensalmente';
    Object.values(cobrancas).forEach(el => { if (el) el.textContent = txtMensal; });

    labelMensal.classList.toggle('pl-toggle-label--ativo', !anual);
    labelAnual.classList.toggle('pl-toggle-label--ativo', anual);
}

toggle.addEventListener('click', () => {
    anual = !anual;
    toggle.setAttribute('aria-pressed', String(anual));
    atualizarPrecos(true);
});

atualizarPrecos(false);

/* ── Logout (delegado ao auth.js via evento padrão) ─────────── */
document.getElementById('btnLogout')?.addEventListener('click', () => {
    window.__edusyncLogout?.();
});
