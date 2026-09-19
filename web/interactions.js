// Všetky poslucháče udalostí. Každý končí volaním setState alebo lokálnou zmenou tooltipu;
// nikto tu nekreslí do DOM okrem tooltipov, ktoré nie sú súčasťou stavu.

import { chartTooltipModel, minutesFromAngle, ringGap } from '../shared/chart-model.js';
import {
    MINUTES_PER_DAY,
    PAGER_SETTLE_MS,
    PREVIEW,
    REFRESH,
    SWIPE,
    TOOLTIP_FADE_MS,
    TOOLTIP_HOLD_MS,
    WEEK_MSG_MIN_H,
} from '../shared/config.js';
import { minutesOfDay } from '../shared/hero-model.js';
import { loadData } from './data.js';
import { initHistory } from './history.js';
import { weekCurveModel } from './render/sedemdni.js';
import { panelChange } from './state.js';
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
        // panelChange dopočíta aj smer prechodu (a zavrie detail dňa), takže sa karta prisunie
        // z tej istej strany ako pri ťahaní prstom.
        if (panelBtn instanceof HTMLElement && panelBtn.dataset.panel) {
            store.setState(panelChange(store.get().panel, /** @type {Panel} */ (panelBtn.dataset.panel)));
        }
        // Deň sa dá vybrať v rebríčku, v tabuľke, v bublinách Dnes/Zajtra, v prepínači dní aj
        // priamo v grafoch. Prehľad dní - v oboch podobách - navyše otvorí detail dňa (na mobile;
        // na širokej obrazovke sa stav neprejaví), kým výber v grafoch a v prepínači len prepína,
        // čo je na nich vidno.
        const totalBtn = target.closest('[data-week-detail]');
        if (totalBtn instanceof HTMLElement) store.setState({ weekDetail: 'week' });
        const weekBtn = target.closest('[data-day-index]');
        if (weekBtn instanceof Element && dom.panels['7dni'].contains(weekBtn)) {
            const weekSelDay = Number(weekBtn.getAttribute('data-day-index'));
            const doDetailu = dom.weekList.contains(weekBtn) || dom.weekTbody.contains(weekBtn) || dom.weekTrio.contains(weekBtn);
            store.setState(doDetailu ? { weekSelDay, weekDetail: 'day' } : { weekSelDay });
        }
        // Bodka len posunie pás; stránka sa dopočíta z výslednej pozície ako pri prste. Cieľ je
        // samotná stránka (scrollIntoView), nie index krát clientWidth - ten je celočíselný, kým
        // skutočná šírka stránky býva desatinná, čo na desktope (klik na bodku, nie prstom) nechávalo
        // pás o pár pixelov mimo prichytenia a cez okraj presvital kúsok susednej stránky. Bodku
        // hľadá poradie v zozname bodiek, nie atribút s číslom stránky: zoznam je ten istý, ktorý
        // bodky rozsvecuje, takže si obe strany nemajú ako rozísť. Skryté stránky do poradia
        // nepatria - rovnako ako ich neráta currentPage.
        const dotBtn = target.closest('.pager-dot');
        const dotIndex = dotBtn instanceof HTMLElement ? dom.verdictDotButtons.indexOf(dotBtn) : -1;
        if (dotIndex >= 0) {
            const pageEl = dom.verdictPager.querySelectorAll('.pager-page:not(.hidden)')[dotIndex];
            if (pageEl instanceof HTMLElement) pageEl.scrollIntoView({ inline: 'start', block: 'nearest' });
        }
    });
    dom.previewReset.addEventListener('click', () => store.setState({ previewMinutes: null, isDragging: false }));
    dom.weekDayBack.addEventListener('click', () => store.setState({ weekDetail: null }));
}

/** Uhol bodu voči stredu ciferníka -> minúta dňa. @param {Dom} dom @param {number} clientX @param {number} clientY */
function minutesFromPoint(dom, clientX, clientY) {
    const box = dom.dialWrap.getBoundingClientRect();
    return minutesFromAngle(clientX - (box.left + box.width / 2), clientY - (box.top + box.height / 2));
}

/**
 * Náhľad iného času: jazdec na dennom prstenci. Ťahať sa dá len samotný jazdec, nie celý
 * ciferník - ten reaguje na ťuknutie. Klik a ťah sa tak nebijú a ťah do strán ponad ciferník
 * naďalej prepína kartu (jazdec je v swipe.js menovanou výnimkou).
 *
 * Dotiahnutie jazdca na značku "teraz" náhľad zruší. Je to skratka, nie náhrada tlačidla:
 * hlavnou cestou späť ostáva "Teraz" pod číslom.
 * @param {Store} store @param {Dom} dom
 */
function initTimePreview(store, dom) {
    const grip = dom.dialGrip;
    const move = (/** @type {PointerEvent} */ e) => {
        const minutes = minutesFromPoint(dom, e.clientX, e.clientY);
        const nowMinutes = minutesOfDay(store.get().now);
        store.setState({ previewMinutes: ringGap(minutes, nowMinutes) <= PREVIEW.snapToNowMin ? null : minutes });
    };
    grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        store.setState({ isDragging: true });
    });
    grip.addEventListener('pointermove', (e) => {
        if (store.get().isDragging) move(e);
    });
    const end = () => {
        if (store.get().isDragging) store.setState({ isDragging: false });
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    // Jazdec je jediná cesta k náhľadu času, preto musí celý fungovať aj z klávesnice:
    // šípky ho posúvajú a keď náhľad nebeží, rovno ho otvoria od aktuálneho času; Esc sa
    // vráti do živého stavu. Otvoriť náhľad inak než ťuknutím sa dá len takto - v pokoji
    // je jazdec značkou "teraz" bez pointer-events (viď .dial-grip.at-now v style.css),
    // takže myš ani prst sa naň nedostanú a ťuknutie prepadne na ciferník pod ním.
    grip.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            return store.setState({ previewMinutes: null, isDragging: false });
        }
        const step =
            e.key === 'ArrowLeft' || e.key === 'ArrowDown'
                ? -PREVIEW.keyStepMin
                : e.key === 'ArrowRight' || e.key === 'ArrowUp'
                  ? PREVIEW.keyStepMin
                  : 0;
        if (!step) return;
        e.preventDefault();
        const from = store.get().previewMinutes ?? minutesOfDay(store.get().now);
        store.setState({ previewMinutes: (((from + step) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY });
    });
    // Enter a medzerník na značke "teraz" otvoria náhľad na aktuálnom čase.
    // detail === 0 je klik z klávesnice; myš a prst posielajú aspoň 1. Bez tej podmienky by
    // sa náhľad znovu otvoril hneď po tom, ako ho dotiahnutie jazdca na "teraz" zrušilo -
    // ťahanie totiž na konci pošle aj klik.
    grip.addEventListener('click', (e) => {
        if (e.detail === 0 && store.get().previewMinutes === null) {
            store.setState({ previewMinutes: minutesOfDay(store.get().now) });
        }
    });
    dom.dialWrap.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('#dial-grip, #preview-reset')) return;
        store.setState({ previewMinutes: minutesFromPoint(dom, e.clientX, e.clientY), isDragging: false });
    });
}

/** Index stránky pod prstom práve teraz, aj keď je pás ešte v pohybe. Skrytá stránka
 * (napr. "lepšie bude" bez času čakania) z toku vypadne, takže do poradia nepatrí - preto
 * sa počíta zo skutočne zobrazených stránok a nie z pevného čísla. @param {HTMLElement} pager */
function currentPage(pager) {
    const pages = pager.querySelectorAll('.pager-page:not(.hidden)').length;
    const index = Math.round(pager.scrollLeft / (pager.clientWidth || 1));
    return Math.min(Math.max(index, 0), pages - 1);
}

/** Bodka nech prstu/kolieskam sleduje plynulo, nie až po ustálení pásu - toto len kozmeticky
 * prepne triedu na dobu pohybu; naozajstný stav príde až z debounced časti.
 * @param {Dom} dom @param {number} index */
function highlightDot(dom, index) {
    dom.verdictDotButtons.forEach((dot, i) => dot.classList.toggle('active', i === index));
}

/** Listovanie verdiktu posúva a prichytáva prehliadač sám; JS len číta, na ktorej stránke sa
 * pás ustálil. Poradie má konce: na poslednej správe sa dá ísť už len späť, na prvej len ďalej.
 * Do stavu ide až ustálená stránka - inak by prekreslenie uprostred gesta prepisovalo bodky
 * tam a späť. @param {Store} store @param {Dom} dom */
function initVerdictPager(store, dom) {
    const pager = dom.verdictPager;

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    pager.addEventListener(
        'scroll',
        () => {
            highlightDot(dom, currentPage(pager));

            clearTimeout(timer);
            timer = setTimeout(() => store.setState({ verdictPage: currentPage(pager) }), PAGER_SETTLE_MS);
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
 * To isté platí pre zvislý ťah, len tam nerozhoduje rýchlosť, ale smer: krivka ide po
 * vodorovnej osi (čas), takže kto ide viac hore-dole než do strán, posúva stránku a tooltip
 * by mu len preblikol. Smer sa počíta z celého gesta a rozhoduje sa nanovo pri každom pohybe,
 * takže ťah, ktorý sa zlomí do strany, tooltip ukáže.
 *
 * Ťuknutie (prst sa nikam nepohol) neposiela touchmove, preto sa ukáže až pri zdvihnutí -
 * na pohľad je to to isté, len o pár desiatok milisekúnd neskôr.
 * @param {HTMLElement} wrap @param {(clientX: number, clientY: number) => void} handle @param {() => void} hide
 */
function bindTouch(wrap, handle, hide) {
    /** @typedef {{ x: number, y: number, t: number, scrollY: number }} Zaciatok */
    /** @type {Zaciatok | null} */
    let start = null;
    let shown = false;
    // Začiatok gesta ide dovnútra ako parameter, nie cez `start` zvonku: v touchend je už
    // vynulovaný a vzdialenosť by sa merala od ľavého horného rohu displeja.
    const vzdialenost = (/** @type {Touch} */ t, /** @type {Zaciatok} */ from) => Math.hypot(t.clientX - from.x, t.clientY - from.y);

    wrap.addEventListener(
        'touchstart',
        (e) => {
            start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp, scrollY: window.scrollY };
            shown = false;
        },
        { passive: true },
    );
    wrap.addEventListener(
        'touchmove',
        (e) => {
            if (!start) return;
            const cas = e.timeStamp - start.t;
            const zvislo = Math.abs(e.touches[0].clientY - start.y) > Math.abs(e.touches[0].clientX - start.x);
            if (zvislo || (cas <= SWIPE.flickMs && vzdialenost(e.touches[0], start) / (cas || 1) >= MIN_FLICK_SPEED)) return;
            shown = true;
            handle(e.touches[0].clientX, e.touches[0].clientY);
        },
        { passive: true },
    );
    wrap.addEventListener('touchend', (e) => {
        const bolStart = start;
        start = null;
        // Ťuknutie ukáže tooltip až tu; švihnutie ho neukáže vôbec (kartu prepne swipe.js).
        // Posunutá stránka znamená, že gesto si vzal prehliadač na scrollovanie - aj keď prst
        // prešiel krátku vzdialenosť a na ťuknutie by inak vyzeral.
        if (
            !shown &&
            bolStart &&
            e.changedTouches.length === 1 &&
            window.scrollY === bolStart.scrollY &&
            vzdialenost(e.changedTouches[0], bolStart) < SWIPE.minDistPx
        )
            handle(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        setTimeout(hide, TOOLTIP_HOLD_MS);
    });
}

/** Spoločná obsluha kurzora aj prsta nad grafom. @param {HTMLElement} wrap @param {HTMLElement} tooltip @param {(clientX: number, clientY: number) => void} handle */
function bindPointer(wrap, tooltip, handle) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let uprac;
    // Skrytý tooltip ostáva v layoute - mizne len cez `opacity`. Jeho súradnice sú pixely
    // vypočítané pre vtedajší rozmer grafu, takže po otočení displeja (graf sa zúži zo 654
    // na 324 px) by trčal ďaleko za jeho okraj a rozšíril by layout viewport - stránka by sa
    // potom kreslila širšia než displej. Preto ich po zmiznutí zahodíme; s odstupom, nech
    // tooltip pri miznutí nepodskočí.
    const hide = () => {
        tooltip.classList.remove('visible');
        clearTimeout(uprac);
        uprac = setTimeout(() => {
            if (tooltip.classList.contains('visible')) return;
            tooltip.style.left = '';
            tooltip.style.top = '';
        }, TOOLTIP_FADE_MS);
    };
    tapTooltips.push({ wrap, hide });
    // Kurzor a pero idú cez pointer udalosti, prst nie - toho obsluhuje bindTouch nižšie.
    // Prehliadač totiž po každom ťuknutí prstom dopošle aj kurzorové udalosti (mouseover,
    // mousemove, click, mouseout, mouseleave), takže tooltip ukázaný prstom hneď zhaslo
    // `mouseleave` - na displeji z neho ostalo asi 15 ms bliknutie. Rozhoduje teda typ
    // vstupu, nie druh udalosti.
    wrap.addEventListener('pointermove', (e) => e.pointerType !== 'touch' && handle(e.clientX, e.clientY));
    wrap.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && hide());
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

/** Tooltip nad krivkou (interpolácia podľa X). @param {Store} store @param {HTMLElement} wrap @param {Element} svg @param {HTMLElement} tooltip @param {(s: import('./state.js').AppState) => ReturnType<typeof weekCurveModel>} modelFor */
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

/** Po pinch-zoome (najmä okolo grafov, kde .chart-wrap nenecháva prehliadaču celé gesto) sa stránka
 * niekedy vráti na zoom 1x, ale vizuálny viewport ostane posunutý od layout viewportu -
 * známa nezhoda v mobilných prehliadačoch, prejaví sa orezaným obsahom pri okraji displeja.
 * `window.scrollX` tento posun nevidí (appka nemá vodorovný scroll), signálom je
 * `visualViewport.offsetLeft/offsetTop`. Po ustálení gesta preto posun skontrolujeme a opravíme.
 *
 * Korekcia zámerne nerozlišuje, čo `resize` spustilo. Skúšali sme ju preskakovať pri zmene
 * `window.innerWidth/innerHeight` (aby nezasiahla pri otáčaní displeja), lenže presne o toľko
 * sa okno zmení aj vtedy, keď layout viewport rozšíri pretečený obsah - teda v scenári, pre
 * ktorý je táto korekcia napísaná. Podmienka ju tam vypínala, a otáčaniu aj tak nepomohla. */
function initViewportZoomRealign() {
    const vv = window.visualViewport;
    if (!vv) return;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let settleTimer;
    const checkAlignment = () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            if (vv.scale <= 1.001 && (vv.offsetLeft !== 0 || vv.offsetTop !== 0))
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

/**
 * Je okno dosť vysoké na správu týždňa v prehľade dní? Rozhoduje `visualViewport` - to je
 * to, čo je z okna naozaj vidieť. `innerHeight` v mobilnom prehliadači počíta aj pás pod
 * adresným riadkom, takže by tvrdil, že miesto je, hoci by sa muselo scrollovať.
 */
export function isTall() {
    return (window.visualViewport ? window.visualViewport.height : window.innerHeight) >= WEEK_MSG_MIN_H;
}

/** Hodiny, obnova dát, návrat z pozadia a zmeny rozmerov okna. @param {Store} store @param {{ wide: MediaQueryList }} mq */
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
    // Viditeľná výška sa mení aj bez otočenia displeja - ukrytím adresného riadka pri
    // scrollovaní, klávesnicou, priblížením. setState zahodí rovnakú hodnotu, takže
    // z tohto poslucháča vzíde prekreslenie len vtedy, keď sa naozaj prekročí hranica.
    const sledujVysku = () => store.setState({ tall: isTall() });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', sledujVysku);
    window.addEventListener('resize', sledujVysku);
    return refresh;
}

/** @param {Store} store @param {Dom} dom @param {{ wide: MediaQueryList }} mq */
export function initInteractions(store, dom, mq) {
    initViewportZoomRealign();
    initNavigation(store, dom);
    initHistory(store);
    initSwipe(store, dom, hideChartTooltips);
    initTimePreview(store, dom);
    initVerdictPager(store, dom);
    initTapTooltipClosing();
    initCurveTooltip(store, dom.weekCurveWrap, dom.weekCurve, dom.weekCurveTooltip, weekCurveModel);
    initRectTooltip(dom.weekHeatWrap, dom.weekHeatTooltip);
    initRectTooltip(dom.weekBarsWrap, dom.weekBarsTooltip);
    initDeviceChips(dom);
    initChartSizes(store, dom);
    return initTicks(store, mq);
}
