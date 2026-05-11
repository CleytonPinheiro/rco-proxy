function notificar(msg, tipo = 'ok', opcoes = {}) {
    const { icone } = opcoes;
    const duracao = (Number.isFinite(opcoes.duracao) && opcoes.duracao > 0) ? opcoes.duracao : 3500;
    const bg = tipo === 'erro' ? '#dc2626' : tipo === 'aviso' ? '#d97706' : '#16a34a';
    const old = document.getElementById('_toast_notif');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = '_toast_notif';
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;background:${bg};color:#fff;font-size:.9rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:360px;word-break:break-word;overflow-wrap:anywhere;transition:opacity .3s;display:flex;align-items:flex-start;gap:8px`;
    if (icone) {
        const ic = document.createElement('span');
        ic.style.cssText = 'flex-shrink:0;font-size:1.1rem;line-height:1.3;display:flex;align-items:center';
        if (typeof icone === 'string' && icone.trim().startsWith('<')) {
            ic.innerHTML = icone;
        } else {
            ic.textContent = icone;
        }
        t.appendChild(ic);
    }
    const txt = document.createElement('span');
    txt.textContent = msg;
    t.appendChild(txt);
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, duracao);
}
