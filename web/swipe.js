// Prepínanie kariet potiahnutím prsta (mobil, tablet). Gesto len rozhodne, ktorá karta je
// na rade; zmenu robí setState ako všetko ostatné, takže sa to od kliku na navigáciu nelíši.

import { SWIPE } from '../shared/config.js';
import { effectivePanel } from './render/index.js';
import { nextPanel } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */
/** @typedef {{ x: number, y: number, t: number, room: { left: number, right: number } | null, chart: boolean }} Zaciatok */

/** Bežec na páse dňa nie je posuvný pás, ale úchytka na ťahanie - pravidlo o vnútorných
 * pásoch nižšie ho nechytí a bez tejto výnimky by ťahanie bežca prepínalo kartu namiesto
 * náhľadu iného času. Jediné menované miesto v celom module; inde rozhoduje pravidlo. */
const DRAG_HANDLE = '.strip-marker-handle';

/** Nad grafom ide tooltip za prstom, takže pomalý ťah po krivke je prezeranie, nie
 * listovanie - kartu tam prepne len rýchle švihnutie (SWIPE.flickMs). */
const CHART = '.chart-wrap';

/**
 * Koľko miesta ostáva najbližšiemu vnútornému pásu pod prstom, ktorý sa dá posúvať do strán:
 * kolotoč odporúčaní na karte Terazky, na úzkych displejoch aj tabuľka 7 dní. Kým má taký pás
 * kam ísť, patrí gesto jemu a nie karte - rovnaké pravidlo, aké medzi sebou používajú vnorené
 * kolotoče. Menovať jednotlivé miesta netreba: pás sa pozná podľa toho, že sa naozaj má kam
 * posunúť. @param {EventTarget | null} target @param {HTMLElement} page
 */
function innerScrollRoom(target, page) {
    for (let el = target instanceof Element ? target : null; el && el !== page; el = el.parentElement) {
        const room = el.scrollWidth - el.clientWidth;
        if (room > 1 && getComputedStyle(el).overflowX !== 'visible') return { left: el.scrollLeft, right: room - el.scrollLeft };
    }
    return null;
}

/** Bolo gesto dosť dlhé, dosť vodorovné a dosť rýchle na to, aby to bolo listovanie?
 * @param {Zaciatok} from @param {number} dx @param {number} dy @param {number} ms */
function isSwipe(from, dx, dy, ms) {
    const limit = from.chart ? SWIPE.flickMs : SWIPE.maxDurationMs;
    return Math.abs(dx) >= SWIPE.minDistPx && Math.abs(dy) <= Math.abs(dx) * SWIPE.maxOffAxisRatio && ms <= limit;
}

/** Posúval prst vnútorný pás namiesto karty? @param {Zaciatok} from @param {number} dx */
function pansInner(from, dx) {
    return !!from.room && (dx < 0 ? from.room.right : from.room.left) > 1;
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

/** @param {Store} store @param {Dom} dom @param {() => void} hideTooltips zavrie tooltipy grafov */
export function initSwipe(store, dom, hideTooltips) {
    /** @type {Zaciatok | null} */
    let start = null;
    const cancel = () => (start = null);

    dom.page.addEventListener(
        'touchstart',
        (e) => {
            const target = e.target;
            const handle = target instanceof Element && target.closest(DRAG_HANDLE);
            if (e.touches.length !== 1 || handle) return cancel();
            start = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                // Trvanie gesta sa meria časom udalostí, nie hodinami: timeStamp beží
                // monotónne od načítania stránky, takže ho neovplyvní posun systémového času
                // (ani zamrznuté hodiny v testoch).
                t: e.timeStamp,
                // Obe merania patria k začiatku gesta: pás sa počas ťahania posunie a graf
                // môže po prepnutí karty zmiznúť, takže na konci by sa už nedali zistiť.
                room: innerScrollRoom(target, dom.page),
                chart: target instanceof Element && !!target.closest(CHART),
            };
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
            if (!isSwipe(from, dx, dy, e.timeStamp - from.t) || pansInner(from, dx)) return;
            // Po geste prehliadač ešte posiela klik na miesto, kde prst skončil - ťah ponad
            // pás dňa by tak nastavil náhľad iného času, ťah ponad tabuľku 7 dní otvoril
            // detail dňa. preventDefault na touchend ten klik zruší. Je tu pred rozhodnutím
            // o karte zámerne: aj ťah, ktorý narazil na kraj poradia a nikam nevedie, je
            // gesto, nie ťuknutie.
            //
            // Podmienka cancelable nie je opatrnosť navyše: keď si prehliadač gesto vyhodnotí
            // ako posúvanie stránky, pošle touchend s cancelable=false a zrušiť sa už nedá.
            // Klik v tom prípade nepošle ani tak (posúvanie si ho ruší samo), no volanie
            // preventDefault by len napísalo chybu do konzoly.
            if (e.cancelable) e.preventDefault();
            const patch = targetFor(store.get(), dx);
            if (!patch) return;
            // Tooltip grafu ostal otvorený pod prstom - po odchode z karty nemá čo držať.
            hideTooltips();
            store.setState(patch);
        },
        { passive: false },
    );
}
