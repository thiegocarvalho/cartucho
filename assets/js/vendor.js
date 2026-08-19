// Carregamento sob demanda das bibliotecas de terceiros.
//
// html5-qrcode sozinho pesa ~366 KB e só serve para o scanner de QR; qrcodejs só serve
// para o modal de compartilhar. Carregá-las no boot é pagar por algo que a maioria das
// sessões nunca usa, então elas entram só quando a funcionalidade é acionada.
import { QRCODE_JS_URL, HTML5_QRCODE_URL } from './config.js';

/** src -> promessa em andamento/resolvida, para nunca injetar o mesmo script duas vezes. */
const emCarregamento = new Map();

/**
 * Injeta um <script> uma única vez.
 * @param {string} src
 * @param {{id?: string}} [opts] id opcional, para quem precisa achar a tag depois
 * @returns {Promise<void>}
 */
export function loadScript(src, opts = {}) {
    if (emCarregamento.has(src)) return emCarregamento.get(src);

    const promessa = new Promise((resolve, reject) => {
        if (opts.id && document.getElementById(opts.id)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        if (opts.id) script.id = opts.id;
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`falha ao carregar ${src}`));
        document.head.appendChild(script);
    });

    // Falha não fica memoizada: a próxima tentativa pode dar certo (rede instável).
    emCarregamento.set(src, promessa);
    promessa.catch(() => emCarregamento.delete(src));
    return promessa;
}

/** Garante a global `QRCode` (geração do QR de compartilhamento). */
export function loadQrGenerator() {
    return window.QRCode ? Promise.resolve() : loadScript(QRCODE_JS_URL);
}

/** Garante a global `Html5Qrcode` (leitura de QR pela câmera). */
export function loadQrScanner() {
    return window.Html5Qrcode ? Promise.resolve() : loadScript(HTML5_QRCODE_URL);
}
