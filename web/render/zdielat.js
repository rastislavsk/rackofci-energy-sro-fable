// Karta Zdieľať: QR kód (knižnica z CDN, generuje sa až pri prvom otvorení) a odkazy.

import { APP_URL } from '../../shared/config.js';

let qrInitialized = false;

/** @param {import('../state.js').AppState} _state @param {import('../dom.js').Dom} dom */
export function renderZdielat(_state, dom) {
    dom.shareUrl.textContent = APP_URL;
    dom.shareWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(APP_URL)}`;
    // Ak knižnica ešte nie je načítaná (pomalá sieť), skúsi sa to pri ďalšom otvorení; zvyšok karty funguje.
    const QRCode = /** @type {any} */ (globalThis).QRCode;
    if (qrInitialized || typeof QRCode === 'undefined') return;
    qrInitialized = true;
    new QRCode(dom.qrcode, {
        text: APP_URL,
        width: 256,
        height: 256,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H,
    });
}
