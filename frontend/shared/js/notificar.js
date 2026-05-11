function notificar(msg, tipo = 'ok') {
    const bg = tipo === 'erro' ? '#dc2626' : tipo === 'aviso' ? '#d97706' : '#16a34a';
    const old = document.getElementById('_toast_notif');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = '_toast_notif';
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;background:${bg};color:#fff;font-size:.9rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:360px;word-break:break-word;transition:opacity .3s`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, 3500);
}
