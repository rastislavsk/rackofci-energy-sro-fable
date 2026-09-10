// Všetky poslucháče udalostí. Každý končí volaním setState alebo lokálnou zmenou tooltipu;
// nikto tu nekreslí do DOM okrem tooltipov, ktoré nie sú súčasťou stavu.

import { chartTooltipModel, STRIP } from '../shared/chart-model.js';
import { PAGER_SETTLE_MS, REFRESH, SWIPE, TOOLTIP_HOLD_MS } from '../shared/config.js';
import { loadData } from './data.js';
import { forecastModel } from './render/predpoved.js';
import { weekCurveModel } from './render/sedemdni.js';
import { initSwipe } from './swipe.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */
/** @typedef {import('./state.js').Panel} Panel */

/** @param {Store} store @param {Dom} dom */
function initNavigation(store, dom) {
    document.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        // Selektor musí byť `button[data-panel]`, nie `[data-panel]`: ten istý atribút nesie aj
        // #page (nastavuje ho renderPanels pre CSS), takže by ho našiel klik kdekoľvek v stránke
        // a zavrel detail dňa - kartu by to prepínalo na tú istú, na ktorej používateľ stojí.
        const panelBtn = target.closest('button[data-panel]');
        // Prepnutie karty vždy začína na prehľade dní - detail dňa je vec jedného pozretia,
        // nie stav, do ktorého by sa appka mala vrátiť o hodinu neskôr.
        if (panelBtn instanceof HTMLElement && panelBtn.dataset.panel)
            store.setState({ panel: /** @type {Panel} */ (panelBtn.dataset.panel), weekDetail: false });
        const dayBtn = target.closest('[data-day]');
        if (dayBtn instanceof HTMLElement) store.setState({ forecastDay: dayBtn.dataset.day === 'tomorrow' ? 'tomorrow' : 'today' });
        // Deň sa dá vybrať v tabuľke, v prepínači dní aj priamo v grafoch. Klik v tabuľke
        // navyše otvorí detail dňa (na mobile; na širokej obrazovke sa stav neprejaví).
        const weekBtn = target.closest('[data-day-index]');
        if (weekBtn instanceof Element && dom.panels['7dni'].contains(weekBtn)) {
            const weekSelDay = Number(weekBtn.getAttribute('data-day-index'));
            store.setState(dom.weekTbody.contains(weekBtn) ? { weekSelDay, weekDetail: true } : { weekSelDay });
        }
        // Bodka len posunie pás; stránka sa dopočíta z výslednej pozície ako pri prste. Cieľ je
        // samotná stránka (scrollIntoView), nie index krát clientWidth - ten je celočíselný, kým
        // skutočná šírka stránky býva desatinná, čo na desktope (klik na bodku, nie prstom) nechávalo
        // pás o pár pixelov mimo prichytenia a cez okraj presvital kúsok susednej stránky. +1, lebo
        // pred prvou reálnou stránkou je klon poslednej (kolotoč, viď initVerdictPager).
        const pageBtn = target.closest('[data-verdict-page]');
        if (pageBtn instanceof HTMLElement) {
            const pageEl = dom.verdictPager.children[Number(pageBtn.dataset.verdictPage) + 1];
            if (pageEl instanceof HTMLElement) pageEl.scrollIntoView({ inline: 'start', block: 'nearest' });
        }
    });
    dom.previewReset.addEventListener('click', () => store.setState({ previewMinutes: null, isDragging: false }));
    dom.weekDayBack.addEventListener('click', () => store.setState({ weekDetail: false }));
}

/** @param {Dom} dom @param {number} clientX */
function minutesFromClientX(dom, clientX) {
    const rect = dom.daystrip.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return Math.round((relX / (rect.width || 1)) * STRIP.w) % STRIP.w;
}

/** Ťahanie bežca a klik na pás dňa = náhľad iného času. @param {Store} store @param {Dom} dom */
function initTimePreview(store, dom) {
    const handle = dom.stripMarkerHandle;
    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        store.setState({ previewMinutes: minutesFromClientX(dom, e.clientX), isDragging: true });
    });
    handle.addEventListener('pointermove', (e) => {
        if (store.get().isDragging) store.setState({ previewMinutes: minutesFromClientX(dom, e.clientX) });
    });
    const end = () => {
        if (store.get().isDragging) store.setState({ isDragging: false });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    dom.daystripWrap.addEventListener('click', (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('.strip-marker-handle')) return;
        store.setState({ previewMinutes: minutesFromClientX(dom, e.clientX), isDragging: false });
    });
}

/** Index reálnej stránky pod prstom práve teraz, aj keď je pás ešte v pohybe - záporný/za
 * koncom tok (klon) sa pre zobrazenie pripne na najbližší reálny okraj. @param {HTMLElement} pager @param {Dom} dom */
function currentFlowPage(pager, dom) {
    const width = pager.clientWidth || 1;
    const realPages = dom.verdictPageWait.classList.contains('hidden') ? 4 : 5;
    const flowIndex = Math.round(pager.scrollLeft / width);
    return { realPages, flowIndex, logical: Math.min(Math.max(flowIndex - 1, 0), realPages - 1) };
}

/** Bodka nech prstu/kolieskam sleduje plynulo, nie až po ustálení pásu - toto len kozmeticky
 * prepne triedu na dobu pohybu; naozajstný stav (a korekcia na kraji, viď nižšie) príde až
 * z debounced časti. @param {Dom} dom @param {number} index */
function highlightDot(dom, index) {
    dom.verdictDotButtons.forEach((dot, i) => dot.classList.toggle('active', i === index));
}

/** Listovanie verdiktu posúva prehliadač sám. Pred prvou a za poslednou reálnou stránkou je
 * neviditeľný klon poslednej/prvej (obsah drží syncPagerClones v terazky.js) - keď sa naň
 * pás ustáli, znamená to, že sa listovalo za okraj, a JS ho bez animácie preskočí na skutočnú
 * stránku na druhom konci, takže to pôsobí ako kolotoč. Do stavu ide až ustálená stránka - inak
 * by prekreslenie uprostred gesta prepisovalo bodky tam a späť. @param {Store} store @param {Dom} dom */
function initVerdictPager(store, dom) {
    const pager = dom.verdictPager;

    // Defaultná prvá stránka je skutočná prvá (index 1 v toku pásu, index 0 je klon poslednej).
    // rAF počká na prvé prekreslenie (nastaví #page data-panel, od ktorého závisí na desktope
    // šírka stránky pageru) a skočí tam bez animácie.
    requestAnimationFrame(() => {
        const firstPage = pager.children[1];
        if (firstPage instanceof HTMLElement) firstPage.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'instant' });
    });

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    pager.addEventListener(
        'scroll',
        () => {
            highlightDot(dom, currentFlowPage(pager, dom).logical);

            clearTimeout(timer);
            timer = setTimeout(() => {
                const { realPages, flowIndex } = currentFlowPage(pager, dom);
                if (flowIndex <= 0) {
                    const lastPage = pager.children[realPages];
                    if (lastPage instanceof HTMLElement)
                        lastPage.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'instant' });
                    store.setState({ verdictPage: realPages - 1 });
                } else if (flowIndex >= realPages + 1) {
                    const firstPage = pager.children[1];
                    if (firstPage instanceof HTMLElement)
                        firstPage.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'instant' });
                    store.setState({ verdictPage: 0 });
                } else {
                    store.setState({ verdictPage: flowIndex - 1 });
                }
            }, PAGER_SETTLE_MS);
        },
        { passive: true },
    );
}

/** @type {Array<{ wrap: HTMLElement, hide: () => void }>} */
const tapTooltips = [];
/** Ťuknutie mimo grafu zavrie jeho tooltip okamžite. */
function initTapTooltipClosing() {
    const closeOthers = (/** @type {Event} */ e) =>
        tapTooltips.forEach(({ wrap, hide }) => !wrap.contains(/** @type {Node} */ (e.target)) && hide());
    document.addEventListener('touchstart', closeOthers, { passive: true });
    document.addEventListener('click', closeOthers);
}

/** Zavrie tooltipy všetkých grafov naraz. Potrebuje to listovanie prstom: gesto sa začína
 * nad grafom, takže closeOthers vyššie ho za "mimo grafu" nepovažuje. */
function hideChartTooltips() {
    tapTooltips.forEach(({ hide }) => hide());
}

/** Najpomalšie gesto, ktoré ešte môže byť švihnutím na susednú kartu (viď web/swipe.js):
 * prejsť minDistPx za flickMs. Kto ide pomalšie, prezerá si krivku. Odvodené, nie nová
 * konštanta - hranica sa tak nemôže rozísť s tým, čo za švihnutie považuje swipe.js. */
const MIN_FLICK_SPEED = SWIPE.minDistPx / SWIPE.flickMs;

/**
 * Prst nad grafom. Kým môže gesto skončiť prepnutím karty, tooltip sa neukáže - inak by pri
 * každom prelistovaní ponad graf preblikol a hneď zmizol. Ukázať a vziať späť sa nedá,
 * rozhodnúť treba skôr, než je koniec gesta známy, tak rozhoduje rýchlosť: prst pomalší než
 * najpomalšie možné švihnutie si krivku prezerá. Po uplynutí okna švihnutia sa karta prepnúť
 * nemôže, takže tam už tooltip patrí vždy.
 *
 * Ťuknutie (prst sa nikam nepohol) neposiela touchmove, preto sa ukáže až pri zdvihnutí -
 * na pohľad je to to isté, len o pár desiatok milisekúnd neskôr.
 * @param {HTMLElement} wrap @param {(clientX: number, clientY: number) => void} handle @param {() => void} hide
 */
function bindTouch(wrap, handle, hide) {
    /** @type {{ x: number, y: number, t: number } | null} */
    let start = null;
    let shown = false;
    const vzdialenost = (/** @type {Touch} */ t) => Math.hypot(t.clientX - (start?.x ?? 0), t.clientY - (start?.y ?? 0));

    wrap.addEventListener(
        'touchstart',
        (e) => {
            start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp };
            shown = false;
        },
        { passive: true },
    );
    wrap.addEventListener(
        'touchmove',
        (e) => {
            if (!start) return;
            const cas = e.timeStamp - start.t;
            if (cas <= SWIPE.flickMs && vzdialenost(e.touches[0]) / (cas || 1) >= MIN_FLICK_SPEED) return;
            shown = true;
            handle(e.touches[0].clientX, e.touches[0].clientY);
        },
        { passive: true },
    );
    wrap.addEventListener('touchend', (e) => {
        const bolStart = start;
        start = null;
        // Ťuknutie ukáže tooltip až tu; švihnutie ho neukáže vôbec (kartu prepne swipe.js).
        if (!shown && bolStart && e.changedTouches.length === 1 && vzdialenost(e.changedTouches[0]) < SWIPE.minDistPx)
            handle(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        setTimeout(hide, TOOLTIP_HOLD_MS);
    });
}

/** Spoločná obsluha kurzora aj prsta nad grafom. @param {HTMLElement} wrap @param {HTMLElement} tooltip @param {(clientX: number, clientY: number) => void} handle */
function bindPointer(wrap, tooltip, handle) {
    const hide = () => tooltip.classList.remove('visible');
    tapTooltips.push({ wrap, hide });
    wrap.addEventListener('mousemove', (e) => handle(e.clientX, e.clientY));
    wrap.addEventListener('mouseleave', hide);
    bindTouch(wrap, handle, hide);
}

/** Tooltip je vodorovne vystredený na `pos.left` (CSS transform: translateX(-50%)). Bez orezania
 * by pri bode blízko okraja grafu presiahol .chart-wrap aj viewport - mobilné prehliadače potom
 * natrvalo rozšíria layout viewport, aj keď je tooltip už dávno preč (viď README/PR história
 * pinch-zoom opravy). @param {HTMLElement} tooltip @param {string} time @param {string} text
 * @param {{ left: number, top: number, maxWidth: number }} pos maxWidth = šírka .chart-wrap */
function showTooltip(tooltip, time, text, pos) {
    const t = tooltip.querySelector('.tt-time');
    const k = tooltip.querySelector('.tt-kw');
    if (t) t.textContent = time;
    if (k) k.textContent = text;
    const half = tooltip.offsetWidth / 2;
    const clampedLeft = Math.min(Math.max(pos.left, half), Math.max(pos.maxWidth - half, half));
    tooltip.style.left = `${clampedLeft}px`;
    tooltip.style.top = `${pos.top}px`;
    tooltip.classList.add('visible');
}

/** Tooltip nad krivkou (interpolácia podľa X). @param {Store} store @param {HTMLElement} wrap @param {Element} svg @param {HTMLElement} tooltip @param {(s: import('./state.js').AppState) => ReturnType<typeof forecastModel>} modelFor */
function initCurveTooltip(store, wrap, svg, tooltip, modelFor) {
    bindPointer(wrap, tooltip, (clientX) => {
        const model = modelFor(store.get());
        if (!model) return;
        const rect = svg.getBoundingClientRect();
        const relX = (clientX - rect.left) / (rect.width || 1);
        const tip = chartTooltipModel(model, relX);
        const extra =
            (tip.clearKw !== null ? ` · strop ${tip.clearKw.toFixed(2)} kW` : '') +
            (tip.cloud !== null ? ` · ${tip.cloud}% oblačnosť` : '');
        showTooltip(tooltip, tip.time, `${tip.kw.toFixed(2)} kW${extra}`, {
            left: clientX - rect.left,
            top: tip.yFrac * rect.height,
            maxWidth: rect.width,
        });
    });
}

/** Tooltip nad bunkami a stĺpcami (obsah je v data-tip atribútoch). @param {HTMLElement} wrap @param {HTMLElement} tooltip */
function initRectTooltip(wrap, tooltip) {
    bindPointer(wrap, tooltip, (clientX, clientY) => {
        const hit = document.elementFromPoint(clientX, clientY);
        const target = hit && hit.closest('[data-tip]');
        if (!(target instanceof Element)) return tooltip.classList.remove('visible');
        const wrapRect = wrap.getBoundingClientRect();
        const cell = target.getBoundingClientRect();
        showTooltip(tooltip, target.getAttribute('data-tip-title') || '', target.getAttribute('data-tip') || '', {
            left: cell.left - wrapRect.left + cell.width / 2,
            top: cell.top - wrapRect.top,
            maxWidth: wrapRect.width,
        });
    });
}

/** Klik na spotrebič prepne tooltip s príkonom nad ním; zmizne sám alebo klikom inde.
 * Tooltip je jeden zdieľaný prvok mimo pageru (position: fixed), pozíciu dopočíta JS
 * podľa kliknutého chipu. @param {Dom} dom */
function initDeviceChips(dom) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
    /** @type {HTMLElement | null} */ let openChip = null;
    const hide = () => {
        dom.verdictChipTooltip.classList.remove('visible');
        openChip = null;
    };
    document.addEventListener('click', (e) => {
        const chip = /** @type {HTMLElement} */ (e.target).closest('.go-chip');
        const wasOpen = chip === openChip;
        clearTimeout(timer);
        hide();
        if (chip instanceof HTMLElement && !wasOpen) {
            const rect = chip.getBoundingClientRect();
            dom.verdictChipTooltip.textContent = chip.dataset.power || '';
            dom.verdictChipTooltip.style.left = `${rect.left + rect.width / 2}px`;
            dom.verdictChipTooltip.style.top = `${rect.top}px`;
            dom.verdictChipTooltip.classList.add('visible');
            openChip = chip;
            timer = setTimeout(hide, TOOLTIP_HOLD_MS);
        }
    });
}

/** Po pinch-zoome (najmä okolo grafov, kde majú .chart-wrap touch-action:none) sa stránka
 * niekedy vráti na zoom 1x, ale vizuálny viewport ostane posunutý od layout viewportu -
 * známa nezhoda v mobilných prehliadačoch, prejaví sa orezaným obsahom pri okraji displeja.
 * `window.scrollX` tento posun nevidí (appka nemá vodorovný scroll), signálom je
 * `visualViewport.offsetLeft/offsetTop`. Po ustálení gesta preto posun skontrolujeme a opravíme.
 *
 * `resize` na visualViewport ale nastane aj pri skutočnom otočení displeja, nie len pri zoome -
 * vtedy sa okno naozaj zmenšilo/zväčšilo a `offsetLeft/offsetTop` s `window.scrollX/scrollY`
 * môžu byť počas prechodu vzájomne nekonzistentné (z inej orientácie). Korekciu preto robíme
 * len vtedy, keď sa skutočný rozmer okna medzičasom nezmenil - inak by mohla stránku posunúť
 * zle namiesto toho, aby ju opravila. */
function initViewportZoomRealign() {
    const vv = window.visualViewport;
    if (!vv) return;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let settleTimer;
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;
    const checkAlignment = () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            const resized = window.innerWidth !== lastWidth || window.innerHeight !== lastHeight;
            lastWidth = window.innerWidth;
            lastHeight = window.innerHeight;
            if (!resized && vv.scale <= 1.001 && (vv.offsetLeft !== 0 || vv.offsetTop !== 0))
                window.scrollTo(window.scrollX + vv.offsetLeft, window.scrollY + vv.offsetTop);
        }, 150);
    };
    vv.addEventListener('resize', checkAlignment);
    vv.addEventListener('scroll', checkAlignment);
}

/**
 * Skutočné rozmery plátien grafov idú do stavu, aby sa graf dal vykresliť presne na kartu
 * namiesto na pevné plátno. Bez toho sa SVG buď roztiahne (a skreslí popisky), alebo si
 * nechá pomer strán a v karte ostane prázdne miesto.
 *
 * Zapisuje sa len skutočná zmena. Prekreslenie totiž zapíše do plátna nové SVG a keby to
 * jeho rozmer zmenilo, ResizeObserver by sa spustil znovu - porovnanie ten kruh zastaví.
 * @param {Store} store @param {Dom} dom
 */
function initChartSizes(store, dom) {
    /** @type {Array<[string, HTMLElement]>} */
    const wraps = [
        ['forecast', dom.forecastChartWrap],
        ['weekHeat', dom.weekHeatWrap],
        ['weekBars', dom.weekBarsWrap],
        ['weekCurve', dom.weekCurveWrap],
    ];
    const measure = () => {
        const prev = store.get().chartSizes;
        /** @type {Record<string, { w: number, h: number }>} */ const next = {};
        let zmena = false;
        for (const [key, el] of wraps) {
            const { width, height } = el.getBoundingClientRect();
            if (!width || !height) {
                if (prev[key]) next[key] = prev[key];
                continue;
            }
            const w = Math.round(width);
            const h = Math.round(height);
            next[key] = { w, h };
            if (!prev[key] || prev[key].w !== w || prev[key].h !== h) zmena = true;
        }
        if (zmena) store.setState({ chartSizes: next });
    };
    const observer = new ResizeObserver(measure);
    for (const [, el] of wraps) observer.observe(el);
    measure();
}

/** Hodiny, obnova dát, návrat z pozadia a zmeny šírky okna. @param {Store} store @param {{ wide: MediaQueryList, desktop: MediaQueryList }} mq */
function initTicks(store, mq) {
    const refresh = async () => {
        const result = await loadData();
        store.setState({
            pv: result.pv,
            forecast: result.forecast,
            source: result.source,
            dataError: !result.pv && !result.forecast,
            now: new Date(),
        });
    };
    setInterval(() => !document.hidden && store.setState({ now: new Date() }), REFRESH.clockMs);
    setInterval(() => !document.hidden && refresh(), REFRESH.dataMs);
    document.addEventListener('visibilitychange', () => !document.hidden && refresh());
    mq.wide.addEventListener('change', (e) => store.setState({ wide: e.matches }));
    mq.desktop.addEventListener('change', (e) => store.setState({ desktop: e.matches }));
    return refresh;
}

/** @param {Store} store @param {Dom} dom @param {{ wide: MediaQueryList, desktop: MediaQueryList }} mq */
export function initInteractions(store, dom, mq) {
    initViewportZoomRealign();
    initNavigation(store, dom);
    initSwipe(store, dom, hideChartTooltips);
    initTimePreview(store, dom);
    initVerdictPager(store, dom);
    initTapTooltipClosing();
    initCurveTooltip(store, dom.forecastChartWrap, dom.forecastChart, dom.forecastTooltip, forecastModel);
    initCurveTooltip(store, dom.weekCurveWrap, dom.weekCurve, dom.weekCurveTooltip, weekCurveModel);
    initRectTooltip(dom.weekHeatWrap, dom.weekHeatTooltip);
    initRectTooltip(dom.weekBarsWrap, dom.weekBarsTooltip);
    initDeviceChips(dom);
    initChartSizes(store, dom);
    return initTicks(store, mq);
}
