// Prepínanie kariet potiahnutím prsta (mobil, tablet). Gesto len rozhodne, ktorá karta je
// na rade; zmenu robí setState ako všetko ostatné, takže sa to od kliku na navigáciu nelíši.

import { SWIPE } from '../shared/config.js';
import { effectivePanel } from './render/index.js';
import { nextPanel } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Miesta, kde vodorovné ťahanie už niečo znamená a kartu teda prepínať nesmie: kolotoč
 * odporúčaní, grafy s tooltipmi, vodorovne posuvná tabuľka 7 dní a bežec na páse dňa.
 * Pás dňa samotný v zozname zámerne nie je - je to na mobile veľká plocha a klik naň
 * (náhľad iného času) sa po podarenom geste potlačí, viď preventDefault nižšie. */
const DEAD_ZONES = '.pager, .chart-wrap, .week-tbl-wrap, .strip-marker-handle';

/** Bolo gesto dosť dlhé, dosť vodorovné a dosť rýchle na to, aby to bolo listovanie?
 * @param {number} dx @param {number} dy @param {number} ms */
function isSwipe(dx, dy, ms) {
    return Math.abs(dx) >= SWIPE.minDistPx && Math.abs(dy) <= Math.abs(dx) * SWIPE.maxOffAxisRatio && ms <= SWIPE.maxDurationMs;
}

/** Kam gesto vedie: buď späť z detailu dňa (podobrazovka karty 7 dní), alebo na susednú
 * kartu, alebo nikam (kraj poradia). @param {import('./state.js').AppState} state @param {number} dx */
function targetFor(state, dx) {
    // V detaile dňa je ťah doprava to isté ako tlačidlo Späť. Na širokej obrazovke detail
    // neexistuje (viď renderSedemdni), tam sa ťahom rovno prepína karta.
    if (state.panel === '7dni' && state.weekDetail && !state.wide && dx > 0) return { weekDetail: false };
    const panel = nextPanel(effectivePanel(state), state.desktop, dx < 0 ? 1 : -1);
    return panel ? { panel, weekDetail: false } : null;
}

/** @param {Store} store @param {Dom} dom */
export function initSwipe(store, dom) {
    /** @type {{ x: number, y: number, t: number } | null} */
    let start = null;
    const cancel = () => (start = null);

    dom.page.addEventListener(
        'touchstart',
        (e) => {
            const target = e.target;
            const dead = target instanceof Element && target.closest(DEAD_ZONES);
            start = e.touches.length === 1 && !dead ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
        },
        { passive: true },
    );
    // Druhý prst znamená pinch-zoom, nie listovanie.
    dom.page.addEventListener('touchmove', (e) => e.touches.length > 1 && cancel(), { passive: true });
    dom.page.addEventListener('touchcancel', cancel, { passive: true });

    dom.page.addEventListener(
        'touchend',
        (e) => {
            const from = start;
            start = null;
            if (!from || e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - from.x;
            const dy = e.changedTouches[0].clientY - from.y;
            if (!isSwipe(dx, dy, Date.now() - from.t)) return;
            // Po geste prehliadač ešte posiela klik na miesto, kde prst skončil - ťah ponad
            // pás dňa by tak nastavil náhľad iného času. preventDefault na touchend ten klik
            // zruší. Je tu pred rozhodnutím o karte zámerne: aj ťah, ktorý narazil na kraj
            // poradia a nikam nevedie, je gesto, nie ťuknutie.
            e.preventDefault();
            const patch = targetFor(store.get(), dx);
            if (patch) store.setState(patch);
        },
        { passive: false },
    );
}
