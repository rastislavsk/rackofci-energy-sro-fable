// Jediný stav appky a jediné miesto, odkiaľ sa spúšťa prekreslenie.
// setState zlúči zmenu a zavolá odberateľov práve raz; rovnaké hodnoty nič nespustia.

import { PANELS } from './dom.js';

/**
 * @typedef {import('../shared/config.js').Season} Season
 * @typedef {'terazky' | 'predpoved' | '7dni' | 'zdielat'} Panel
 * @typedef {{
 *   now: Date,
 *   season: Season,
 *   panel: Panel,
 *   panelDir: 1 | -1,
 *   pv: import('../shared/kiosk.js').PvData | null,
 *   forecast: import('../shared/solar.js').Forecast | null,
 *   source: 'worker' | 'legacy' | null,
 *   dataError: boolean,
 *   forecastDay: 'today' | 'tomorrow',
 *   weekSelDay: number,
 *   weekDetail: boolean,
 *   verdictPage: number,
 *   previewMinutes: number | null,
 *   isDragging: boolean,
 *   wide: boolean,
 *   desktop: boolean,
 *   chartSizes: Record<string, { w: number, h: number }>,
 * }} AppState
 * @typedef {{ panel: Panel, weekDetail: boolean }} NavStep krok navigácie pre tlačidlo Späť
 */

/** @param {Date} now @param {Season} season @param {{ wide: boolean, desktop: boolean }} layout @returns {AppState} */
export function initialState(now, season, layout) {
    return {
        now,
        season,
        panel: 'terazky',
        // Smer posledného prechodu medzi kartami: 1 dopredu v poradí navigácie, -1 späť.
        // Od neho závisí, z ktorej strany sa nová karta prisunie (viď panel-in-* v style.css).
        panelDir: 1,
        pv: null,
        forecast: null,
        source: null,
        dataError: false,
        forecastDay: 'today',
        weekSelDay: 0,
        // Karta 7 dní má na mobile dve obrazovky: prehľad dní a detail vybraného dňa.
        // Na širokej obrazovke je na všetko miesto naraz a toto pole sa neprejaví.
        weekDetail: false,
        verdictPage: 0,
        previewMinutes: null,
        isDragging: false,
        wide: layout.wide,
        desktop: layout.desktop,
        // Skutočné rozmery plátien grafov. Napĺňa ich ResizeObserver v interactions.js;
        // kým sú prázdne, grafy sa kreslia na pevné plátno z chartDims.
        chartSizes: {},
    };
}

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
    let state = initial;
    /** @type {Array<(state: T, prev: T) => void>} */
    const listeners = [];
    return {
        get: () => state,
        /** @param {Partial<T>} patch */
        setState(patch) {
            const keys = /** @type {Array<keyof T>} */ (Object.keys(patch));
            if (!keys.some((k) => patch[k] !== state[k])) return;
            const prev = state;
            state = { ...state, ...patch };
            listeners.forEach((fn) => fn(state, prev));
        },
        /** @param {(state: T, prev: T) => void} fn */
        subscribe(fn) {
            listeners.push(fn);
            return () => listeners.splice(listeners.indexOf(fn), 1);
        },
    };
}

/** @typedef {ReturnType<typeof createStore<AppState>>} Store */

/**
 * Susedná karta v poradí navigácie, alebo null na kraji - listovanie sa nezacyklí.
 * Na desktope Predpoveď nie je samostatná destinácia (splýva so Spotrebičmi, viď
 * effectivePanel vo web/render/index.js), takže v poradí nie je.
 * @param {Panel} panel karta, ktorá je práve vidno (effectivePanel, nie holý stav)
 * @param {boolean} desktop
 * @param {1 | -1} dir 1 = ďalšia, -1 = predchádzajúca
 * @returns {Panel | null}
 */
export function nextPanel(panel, desktop, dir) {
    const order = panelOrder(desktop);
    const i = order.indexOf(panel);
    return i < 0 ? null : (order[i + dir] ?? null);
}

/** Poradie kariet v navigácii. @param {boolean} desktop */
function panelOrder(desktop) {
    return PANELS.filter((p) => !(desktop && p === 'predpoved'));
}

/**
 * Zmena karty aj so smerom, ktorým sa má nová karta prisunúť. Smer sa berie z poradia
 * v navigácii, nie z toho, či sa ťahalo alebo klikalo - prechod tak vyzerá rovnako pri
 * oboch. Detail dňa sa pritom zatvára: je to vec jedného pozretia, nie stav, do ktorého
 * by sa appka mala vrátiť o hodinu neskôr.
 * @param {Panel} from karta, ktorá je práve vidno (effectivePanel, nie holý stav)
 * @param {Panel} to @param {boolean} desktop
 */
export function panelChange(from, to, desktop) {
    const order = panelOrder(desktop);
    return { panel: to, panelDir: /** @type {1 | -1} */ (order.indexOf(to) < order.indexOf(from) ? -1 : 1), weekDetail: false };
}

/**
 * Krok navigácie, na ktorý sa dá vrátiť tlačidlom Späť: karta a či je otvorený detail dňa.
 * Zvyšok stavu (vybraný deň, stránka verdiktu, náhľad času) je nastavenie vnútri karty,
 * nie miesto v appke - tam sa Späť nevracia, rovnako ako v iných appkách.
 * @param {AppState} state @returns {NavStep}
 */
export function navStep(state) {
    return { panel: state.panel, weekDetail: state.weekDetail };
}

/** @param {NavStep} a @param {NavStep} b */
export function sameNavStep(a, b) {
    return a.panel === b.panel && a.weekDetail === b.weekDetail;
}

/**
 * Návrat na skorší krok navigácie (tlačidlo Späť). Od panelChange sa líši jediným:
 * detail dňa nezatvára, ale nastavuje na to, čo v tom kroku bolo - Späť má obnoviť,
 * čo používateľ videl, nie to upratať.
 * @param {Panel} from karta, ktorá je práve vidno (effectivePanel, nie holý stav)
 * @param {NavStep} step @param {boolean} desktop
 */
export function navChange(from, step, desktop) {
    return { ...panelChange(from, step.panel, desktop), weekDetail: step.weekDetail };
}

/**
 * Krok navigácie z položky histórie. Cudzie položky (iná stránka v tej istej karte
 * prehliadača, staršia verzia appky) vracajú null a Späť sa pri nich správa ako
 * predtým - odíde zo stránky.
 * @param {unknown} raw @returns {NavStep | null}
 */
export function navStepFrom(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const step = /** @type {{ step?: unknown }} */ (raw).step;
    if (!step || typeof step !== 'object') return null;
    const { panel, weekDetail } = /** @type {{ panel?: unknown, weekDetail?: unknown }} */ (step);
    if (typeof weekDetail !== 'boolean' || !PANELS.some((p) => p === panel)) return null;
    return { panel: /** @type {Panel} */ (panel), weekDetail };
}
