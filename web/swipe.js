// Listovanie potiahnutím prsta (mobil, tablet): karty, a v detaile dňa dni v týždni. Gesto
// len rozhodne, čo je na rade; zmenu robí setState ako všetko ostatné, takže sa to od kliku
// na navigáciu nelíši.

import { SWIPE } from '../shared/config.js';
import { nextPanel, nextWeekDay, panelChange } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */
/** @typedef {{ x: number, y: number, t: number, room: { left: number, right: number, pager: boolean } | null, chart: boolean }} Zaciatok */

/** Jazdec na dennom prstenci nie je posuvný pás, ale úchytka na ťahanie - pravidlo
 * o vnútorných pásoch nižšie ho nechytí a bez tejto výnimky by ťahanie jazdca prepínalo
 * kartu namiesto náhľadu iného času. Jediné menované miesto v celom module; inde
 * rozhoduje pravidlo. */
const DRAG_HANDLE = '.dial-grip';

/** Nad grafom ide tooltip za prstom, takže pomalý ťah po krivke je prezeranie, nie
 * listovanie - kartu tam prepne len rýchle švihnutie (SWIPE.flickMs). */
const CHART = '.chart-wrap';

/** Posúvať do strán sa dá len `auto` a `scroll`. `hidden` a `clip` obsah navyše iba orežú -
 * prehliadač s nimi prstom nepohne, takže gesto nad nimi nepatrí im. */
const PANNABLE = /^(auto|scroll)$/;

/** Pás, ktorý sa sám prichytáva po stránkach, je listovanie sám o sebe - gesto nad ním patrí
 * jemu aj vtedy, keď stojí na krajnej stránke a nemá kam ísť. Bez toho by ťah z poslednej
 * správy pod ciferníkom odišiel na susednú kartu. Nie je to menované miesto, ale pravidlo:
 * prichytávanie po stránkach má v štýloch jediný pás, kolotoč odporúčaní (.pager). */
const SNAPS_X = /^(x|both)\b/;

/**
 * Koľko miesta ostáva najbližšiemu vnútornému pásu pod prstom, ktorý sa dá posúvať do strán:
 * pás odporúčaní na karte Terazky, na úzkych displejoch aj tabuľka 7 dní. Kým má taký pás
 * kam ísť, patrí gesto jemu a nie karte - rovnaké pravidlo, aké medzi sebou používajú vnorené
 * pásy. Menovať jednotlivé miesta netreba: pás sa pozná podľa toho, že sa naozaj má kam
 * posunúť - a že sa posunúť vôbec dá.
 *
 * Druhá podmienka tu nie je navyše. Stačilo, aby obsah presiahol orezaný prvok o dva pixely,
 * a gesto dostal prvok, ktorý sa nikdy nepohne - listovanie tým celé zhaslo. Na karte Terazky
 * sa to dialo okolo 06:00: značka "teraz" vtedy stojí na pravom okraji prstenca a jej štvorec
 * presiahne kartu (overflow-x: hidden) o necelé dva pixely.
 * @param {EventTarget | null} target @param {HTMLElement} page
 */
function innerScrollRoom(target, page) {
    for (let el = target instanceof Element ? target : null; el && el !== page; el = el.parentElement) {
        const room = el.scrollWidth - el.clientWidth;
        const style = getComputedStyle(el);
        if (room > 1 && PANNABLE.test(style.overflowX))
            return { left: el.scrollLeft, right: room - el.scrollLeft, pager: SNAPS_X.test(style.scrollSnapType) };
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
    if (!from.room) return false;
    return from.room.pager || (dx < 0 ? from.room.right : from.room.left) > 1;
}

/** Kam gesto vedie: buď na susedný deň (v detaile dňa), alebo späť do prehľadu dní, alebo
 * na susednú kartu, alebo nikam (koniec poradia dní, kraj poradia kariet).
 *
 * Detail je podobrazovka karty 7 dní a ťah ju neopúšťa - v detaile dňa listuje dni, tak ako
 * inde listuje karty. Ťah doprava je pritom všade v appke krok späť, takže keď už listovať
 * nie je kam (prvý deň, alebo detail týždňa, kde je jediná obrazovka), vedie tam, kam šípka
 * v hlavičke detailu: do prehľadu dní. Doľava sa na poslednom dni nedeje nič - vpred z detailu
 * cesta nevedie. Na širokej obrazovke detail neexistuje (viď renderSedemdni), tam sa ťahom
 * prepína karta.
 * @param {import('./state.js').AppState} state @param {number} dx */
function targetFor(state, dx) {
    if (state.panel === '7dni' && state.weekDetail && !state.wide) {
        const spat = dx > 0 ? { weekDetail: null } : null;
        if (state.weekDetail !== 'day') return spat;
        const dir = /** @type {1 | -1} */ (dx < 0 ? 1 : -1);
        const den = nextWeekDay(state.weekSelDay, dir, state.forecast?.days.length ?? 0);
        // Smer ide do stavu s dňom: podľa neho sa detail prisunie z tej strany, ktorou sa
        // listovalo - to isté, čo panelChange robí pre karty.
        return den === null ? spat : { weekSelDay: den, weekDayDir: dir };
    }
    const panel = nextPanel(state.panel, dx < 0 ? 1 : -1);
    return panel ? panelChange(state.panel, panel) : null;
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
            // Tooltip grafu ostal otvorený pod prstom - po odchode z karty (aj po prelistovaní
            // na iný deň) ukazuje hodnotu, ktorá už pod ním nie je.
            hideTooltips();
            store.setState(patch);
        },
        { passive: false },
    );
}
