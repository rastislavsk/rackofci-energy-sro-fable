// Jediný stav appky a jediné miesto, odkiaľ sa spúšťa prekreslenie.
// setState zlúči zmenu a zavolá odberateľov práve raz; rovnaké hodnoty nič nespustia.

/**
 * @typedef {import('../shared/config.js').Season} Season
 * @typedef {'spotrebice' | 'predpoved' | '7dni' | 'zdielat'} Panel
 * @typedef {{
 *   now: Date,
 *   season: Season,
 *   panel: Panel,
 *   pv: import('../shared/kiosk.js').PvData | null,
 *   forecast: import('../shared/solar.js').Forecast | null,
 *   source: 'worker' | 'legacy' | null,
 *   dataError: boolean,
 *   forecastDay: 'today' | 'tomorrow',
 *   weekSelDay: number,
 *   previewMinutes: number | null,
 *   isDragging: boolean,
 *   wide: boolean,
 *   desktop: boolean,
 * }} AppState
 */

/** @param {Date} now @param {Season} season @param {{ wide: boolean, desktop: boolean }} layout @returns {AppState} */
export function initialState(now, season, layout) {
    return {
        now,
        season,
        panel: 'spotrebice',
        pv: null,
        forecast: null,
        source: null,
        dataError: false,
        forecastDay: 'today',
        weekSelDay: 0,
        previewMinutes: null,
        isDragging: false,
        wide: layout.wide,
        desktop: layout.desktop,
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
