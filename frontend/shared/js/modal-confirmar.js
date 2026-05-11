/**
 * modal-confirmar.js — Utilitário global de confirmação
 *
 * Substitui o confirm() nativo por um modal consistente com a identidade visual do EduSync.
 * É auto-injetante: ao ser carregado, injeta o HTML e o CSS necessários no DOM.
 *
 * Uso:
 *   const ok = await confirmar('Título', 'Mensagem de confirmação');
 *   const ok = await confirmar('Título', 'Mensagem', { confirmLabel: 'Sim, excluir', tipo: 'danger' });
 */
(function () {
    const MODAL_ID = 'mcModalConfirmar';

    function injetarEstilos() {
        if (document.getElementById('mcModalEstilos')) return;
        const style = document.createElement('style');
        style.id = 'mcModalEstilos';
        style.textContent = `
            #mcModalConfirmar {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: rgba(0,0,0,.45);
                align-items: center;
                justify-content: center;
                padding: 1rem;
            }
            #mcModalConfirmar.mc-visivel {
                display: flex;
            }
            .mc-caixa {
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,.18);
                max-width: 420px;
                width: 100%;
                padding: 1.5rem 1.75rem 1.25rem;
                font-family: inherit;
                animation: mcEntrar .15s ease;
            }
            @keyframes mcEntrar {
                from { transform: scale(.95); opacity: 0; }
                to   { transform: scale(1);  opacity: 1; }
            }
            .mc-icone {
                font-size: 1.6rem;
                margin-bottom: .5rem;
            }
            .mc-titulo {
                margin: 0 0 .5rem;
                font-size: 1rem;
                font-weight: 700;
                color: #111827;
            }
            .mc-mensagem {
                margin: 0 0 1.25rem;
                font-size: .875rem;
                color: #374151;
                line-height: 1.6;
                white-space: pre-line;
            }
            .mc-rodape {
                display: flex;
                justify-content: flex-end;
                gap: .6rem;
            }
            .mc-btn {
                padding: .45rem 1.1rem;
                border-radius: 8px;
                font-size: .875rem;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: background .15s;
            }
            .mc-btn-cancelar {
                background: #f3f4f6;
                color: #374151;
            }
            .mc-btn-cancelar:hover { background: #e5e7eb; }
            .mc-btn-ok {
                background: #2563eb;
                color: #fff;
            }
            .mc-btn-ok:hover { background: #1d4ed8; }
            .mc-caixa.mc-danger .mc-btn-ok {
                background: #dc2626;
            }
            .mc-caixa.mc-danger .mc-btn-ok:hover { background: #b91c1c; }
            .mc-caixa.mc-ok .mc-btn-ok {
                background: #16a34a;
            }
            .mc-caixa.mc-ok .mc-btn-ok:hover { background: #15803d; }
        `;
        document.head.appendChild(style);
    }

    function injetarHTML() {
        if (document.getElementById(MODAL_ID)) return;
        const div = document.createElement('div');
        div.id = MODAL_ID;
        div.setAttribute('role', 'dialog');
        div.setAttribute('aria-modal', 'true');
        div.setAttribute('aria-labelledby', 'mcModalTitulo');
        div.innerHTML = `
            <div class="mc-caixa" id="mcModalCaixa">
                <div class="mc-icone" id="mcModalIcone">⚠️</div>
                <h3 class="mc-titulo" id="mcModalTitulo"></h3>
                <p class="mc-mensagem" id="mcModalMensagem"></p>
                <div class="mc-rodape">
                    <button class="mc-btn mc-btn-cancelar" id="mcModalCancelar">Cancelar</button>
                    <button class="mc-btn mc-btn-ok" id="mcModalOk">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }

    function injetar() {
        injetarEstilos();
        injetarHTML();
    }

    /* ── Input modal (solicitarTexto) ─────────────────────────────── */
    const INPUT_ID = 'mcModalTexto';

    function injetarHTMLTexto() {
        if (document.getElementById(INPUT_ID)) return;
        const div = document.createElement('div');
        div.id = INPUT_ID;
        div.setAttribute('role', 'dialog');
        div.setAttribute('aria-modal', 'true');
        div.setAttribute('aria-labelledby', 'mcTextoTitulo');
        div.innerHTML = `
            <div class="mc-caixa" id="mcTextoCaixa">
                <div class="mc-icone" id="mcTextoIcone">✏️</div>
                <h3 class="mc-titulo" id="mcTextoTitulo"></h3>
                <p class="mc-mensagem" id="mcTextoMensagem"></p>
                <input class="mc-input" id="mcTextoInput" type="text" autocomplete="off">
                <div class="mc-rodape">
                    <button class="mc-btn mc-btn-cancelar" id="mcTextoCancelar">Cancelar</button>
                    <button class="mc-btn mc-btn-ok" id="mcTextoOk">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);

        /* Inject extra style for the input field (once) */
        const existing = document.getElementById('mcModalEstilos');
        if (existing && !existing.dataset.textoAdded) {
            existing.textContent += `
                #mcModalTexto {
                    display: none;
                    position: fixed;
                    inset: 0;
                    z-index: 9999;
                    background: rgba(0,0,0,.45);
                    align-items: center;
                    justify-content: center;
                    padding: 1rem;
                }
                #mcModalTexto.mc-visivel { display: flex; }
                .mc-input {
                    width: 100%;
                    box-sizing: border-box;
                    padding: .45rem .75rem;
                    border: 1.5px solid #d1d5db;
                    border-radius: 8px;
                    font-size: .875rem;
                    font-family: inherit;
                    margin-bottom: 1.25rem;
                    outline: none;
                    transition: border-color .15s;
                }
                .mc-input:focus { border-color: #2563eb; }
            `;
            existing.dataset.textoAdded = '1';
        }
    }

    /**
     * Exibe um modal de entrada de texto (substitui prompt()).
     * @param {string} titulo - Título do modal.
     * @param {string} mensagem - Texto explicativo exibido acima do campo.
     * @param {string} [valorPadrao=''] - Valor inicial do campo.
     * @param {object} [opcoes]
     * @param {string} [opcoes.confirmLabel='Confirmar'] - Texto do botão OK.
     * @param {string} [opcoes.cancelLabel='Cancelar'] - Texto do botão cancelar.
     * @param {string} [opcoes.icone] - Ícone exibido acima do título.
     * @param {string} [opcoes.placeholder] - Placeholder do campo de texto.
     * @param {string} [opcoes.inputType] - Valor do atributo type do <input> (ex: 'number').
     * @param {string} [opcoes.inputMode] - Valor do atributo inputmode do <input> (ex: 'decimal').
     * @returns {Promise<string|null>} Texto digitado ou null se cancelado.
     */
    window.solicitarTexto = function solicitarTexto(titulo, mensagem, valorPadrao, opcoes) {
        injetarEstilos();
        injetarHTMLTexto();

        const {
            confirmLabel = 'Confirmar',
            cancelLabel  = 'Cancelar',
            icone        = '✏️',
            placeholder  = '',
            inputType    = 'text',
            inputMode    = '',
        } = opcoes || {};

        const overlay  = document.getElementById(INPUT_ID);
        const elTitulo = document.getElementById('mcTextoTitulo');
        const elMsg    = document.getElementById('mcTextoMensagem');
        const elIcone  = document.getElementById('mcTextoIcone');
        const elInput  = document.getElementById('mcTextoInput');
        const btnOk    = document.getElementById('mcTextoOk');
        const btnCan   = document.getElementById('mcTextoCancelar');

        elTitulo.textContent    = titulo;
        elMsg.textContent       = mensagem;
        elIcone.textContent     = icone;
        btnOk.textContent       = confirmLabel;
        btnCan.textContent      = cancelLabel;
        elInput.value           = valorPadrao != null ? String(valorPadrao) : '';
        elInput.placeholder     = placeholder;
        elInput.type            = inputType;
        if (inputMode) {
            elInput.setAttribute('inputmode', inputMode);
        } else {
            elInput.removeAttribute('inputmode');
        }

        overlay.classList.add('mc-visivel');
        elInput.focus();
        elInput.select();

        return new Promise(resolve => {
            function fechar(valor) {
                overlay.classList.remove('mc-visivel');
                btnOk.removeEventListener('click', onOk);
                btnCan.removeEventListener('click', onCancel);
                overlay.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKey);
                resolve(valor);
            }
            function onOk()     { fechar(elInput.value); }
            function onCancel() { fechar(null); }
            function onBackdrop(e) { if (e.target === overlay) fechar(null); }
            function onKey(e) {
                if (e.key === 'Escape') { fechar(null); }
                if (e.key === 'Enter' && document.activeElement !== btnCan) { e.preventDefault(); fechar(elInput.value); }
            }

            btnOk.addEventListener('click', onOk);
            btnCan.addEventListener('click', onCancel);
            overlay.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKey);
        });
    };

    /**
     * Exibe um modal de notificação (substitui alert()).
     * Não tem botão de cancelar — apenas um botão OK para fechar.
     * @param {string} titulo - Título do modal.
     * @param {string} [mensagem=''] - Mensagem exibida abaixo do título.
     * @param {object} [opcoes]
     * @param {'info'|'ok'|'danger'} [opcoes.tipo='info'] - Esquema de cor: info=azul, ok=verde, danger=vermelho.
     * @param {string} [opcoes.icone] - Ícone exibido acima do título (emoji ou texto).
     * @param {string} [opcoes.okLabel='OK'] - Texto do botão de fechamento.
     * @returns {Promise<void>}
     */
    window.notificar = function notificar(titulo, mensagem, opcoes) {
        const {
            tipo     = 'info',
            icone,
            okLabel  = 'OK',
        } = opcoes || {};

        const iconeDefault = tipo === 'danger' ? '❌' : tipo === 'ok' ? '✅' : 'ℹ️';

        return confirmar(titulo, mensagem || '', {
            confirmLabel: okLabel,
            cancelLabel:  '',
            tipo,
            icone: icone || iconeDefault,
        });
    };

    /**
     * Exibe o modal de confirmação.
     * @param {string} titulo - Título do modal.
     * @param {string} mensagem - Mensagem de confirmação.
     * @param {object} [opcoes]
     * @param {string} [opcoes.confirmLabel='Confirmar'] - Texto do botão de confirmação.
     * @param {string} [opcoes.cancelLabel='Cancelar'] - Texto do botão de cancelamento.
     * @param {'info'|'ok'|'danger'} [opcoes.tipo='info'] - Estilo do botão de confirmação.
     * @param {string} [opcoes.icone] - Ícone exibido acima do título.
     * @returns {Promise<boolean>}
     */
    /* ── Toast (auto-dismissing snackbar) ────────────────────────── */

    function injetarEstilesToast() {
        if (document.getElementById('mcToastEstilos')) return;
        const style = document.createElement('style');
        style.id = 'mcToastEstilos';
        style.textContent = `
            #mcToastContainer {
                position: fixed;
                bottom: 1.25rem;
                right: 1.25rem;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: .5rem;
                align-items: flex-end;
                pointer-events: none;
            }
            .mc-toast {
                display: flex;
                align-items: center;
                gap: .55rem;
                background: #1f2937;
                color: #f9fafb;
                border-radius: 10px;
                padding: .6rem 1rem;
                font-size: .875rem;
                font-family: inherit;
                font-weight: 500;
                box-shadow: 0 4px 16px rgba(0,0,0,.22);
                max-width: 340px;
                pointer-events: auto;
                animation: mcToastEntrar .2s ease;
                border-left: 4px solid #6b7280;
            }
            .mc-toast.mc-toast-ok     { border-left-color: #16a34a; }
            .mc-toast.mc-toast-danger { border-left-color: #dc2626; }
            .mc-toast.mc-toast-info   { border-left-color: #2563eb; }
            .mc-toast.mc-toast-saindo {
                animation: mcToastSair .25s ease forwards;
            }
            @keyframes mcToastEntrar {
                from { transform: translateX(110%); opacity: 0; }
                to   { transform: translateX(0);    opacity: 1; }
            }
            @keyframes mcToastSair {
                from { transform: translateX(0);    opacity: 1; }
                to   { transform: translateX(110%); opacity: 0; }
            }
            .mc-toast-icone { flex-shrink: 0; font-size: 1rem; }
        `;
        document.head.appendChild(style);
    }

    function injetarContainerToast() {
        if (document.getElementById('mcToastContainer')) return;
        const container = document.createElement('div');
        container.id = 'mcToastContainer';
        document.body.appendChild(container);
    }

    /**
     * Exibe um toast auto-dismissível (snackbar) no canto inferior direito.
     * @param {string} msg - Mensagem exibida no toast.
     * @param {'info'|'ok'|'danger'} [tipo='info'] - Esquema de cor.
     * @param {number} [duracao=3500] - Duração em ms antes de desaparecer.
     */
    window.toast = function toast(msg, tipo = 'info', duracao = 3500) {
        injetarEstilesToast();
        injetarContainerToast();

        const icones = { ok: '✅', danger: '❌', info: 'ℹ️' };

        const el = document.createElement('div');
        el.className = `mc-toast mc-toast-${tipo}`;

        const elIcone = document.createElement('span');
        elIcone.className = 'mc-toast-icone';
        elIcone.textContent = icones[tipo] || icones.info;

        const elMsg = document.createElement('span');
        elMsg.textContent = msg;

        el.appendChild(elIcone);
        el.appendChild(elMsg);

        const container = document.getElementById('mcToastContainer');
        container.appendChild(el);

        function remover() {
            el.classList.add('mc-toast-saindo');
            el.addEventListener('animationend', () => el.remove(), { once: true });
        }

        const timer = setTimeout(remover, duracao);
        el.addEventListener('click', () => { clearTimeout(timer); remover(); });
    };

    window.confirmar = function confirmar(titulo, mensagem, opcoes) {
        injetar();

        const {
            confirmLabel = 'Confirmar',
            cancelLabel  = 'Cancelar',
            tipo         = 'info',
            icone,
        } = opcoes || {};

        const overlay  = document.getElementById(MODAL_ID);
        const caixa    = document.getElementById('mcModalCaixa');
        const elTitulo = document.getElementById('mcModalTitulo');
        const elMsg    = document.getElementById('mcModalMensagem');
        const elIcone  = document.getElementById('mcModalIcone');
        const btnOk    = document.getElementById('mcModalOk');
        const btnCan   = document.getElementById('mcModalCancelar');

        elTitulo.textContent = titulo;
        elMsg.textContent    = mensagem;
        elIcone.textContent  = icone || (tipo === 'danger' ? '⚠️' : tipo === 'ok' ? '✅' : '❓');
        btnOk.textContent    = confirmLabel;
        btnCan.textContent   = cancelLabel;
        btnCan.style.display = cancelLabel ? '' : 'none';
        caixa.classList.toggle('mc-danger', tipo === 'danger');
        caixa.classList.toggle('mc-ok', tipo === 'ok');

        overlay.classList.add('mc-visivel');
        btnOk.focus();

        return new Promise(resolve => {
            function fechar(resultado) {
                overlay.classList.remove('mc-visivel');
                btnOk.removeEventListener('click', onOk);
                btnCan.removeEventListener('click', onCancel);
                overlay.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKey);
                resolve(resultado);
            }
            function onOk()      { fechar(true); }
            function onCancel()  { fechar(false); }
            function onBackdrop(e) { if (e.target === overlay) fechar(false); }
            function onKey(e) {
                if (e.key === 'Escape') { fechar(false); }
                if (e.key === 'Enter' && document.activeElement === btnOk) { e.preventDefault(); fechar(true); }
            }

            btnOk.addEventListener('click', onOk);
            btnCan.addEventListener('click', onCancel);
            overlay.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKey);
        });
    };
})();
