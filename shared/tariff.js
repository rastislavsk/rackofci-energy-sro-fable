// Tarifné okná, sezóna a farebné "tiery" - všetko, čo odvodzuje stav siete a spotrebičov
// z času dňa a výkonu FV. Čisté funkcie bez DOM.

import { AUTO_MIN_PV_KW, AUTO_NIGHT_WINDOW, DEVICES, POWER_HIGH_KW, POWER_LOW_KW, SUMMER_MONTHS, TARIFF_WINDOWS } from './config.js';
import { timeStrToMinutes } from './format.js';

/** @typedef {import('./config.js').Season} Season */
/** @typedef {import('./config.js').Tier} Tier */
/** @typedef {(typeof TARIFF_WINDOWS)[number]} TariffWindow */

/**
 * Je čas v okne [start, end)? Okno môže prechádzať cez polnoc (start > end).
 * @param {number} minutes @param {string} start @param {string} end
 */
export function isInWindow(minutes, start, end) {
    const s = timeStrToMinutes(start);
    const e = timeStrToMinutes(end);
    if (s > e) return minutes >= s || minutes < e;
    return minutes >= s && minutes < e;
}

/** Leto = marec až október. @param {Date} date @returns {Season} */
export function seasonFor(date) {
    const month = date.getMonth() + 1;
    return month >= SUMMER_MONTHS.from && month <= SUMMER_MONTHS.to ? 'summer' : 'winter';
}

/** Okná platné v danej sezóne, chronologicky. @param {Season} season */
export function windowsFor(season) {
    return TARIFF_WINDOWS.filter((w) => w.seasons.includes(season));
}

/** Okno aktívne v danej minúte dňa. @param {number} minutes @param {Season} season @returns {TariffWindow | null} */
export function windowAt(minutes, season) {
    return windowsFor(season).find((w) => isInWindow(minutes, w.start, w.end)) || null;
}

/** Jediné okno s odporúčanými spotrebičmi (zelené). @param {Season} season */
export function deviceWindow(season) {
    return windowsFor(season).find((w) => Array.isArray(w.devices)) || null;
}

/**
 * Segmenty pásu dňa od 00:00 do 24:00: {startMin, min, cls}. Odvodené z okien,
 * nočné okno je rozdelené na koniec a začiatok dňa.
 * @param {Season} season
 */
export function stripSegments(season) {
    const segments = [];
    let cursor = 0;
    while (cursor < 1440) {
        const win = windowAt(cursor, season);
        const end = win ? timeStrToMinutes(win.end) : 1440;
        const stop = end <= cursor ? 1440 : Math.min(end, 1440);
        segments.push({ startMin: cursor, min: stop - cursor, cls: win ? win.status : 'amber' });
        cursor = stop;
    }
    return segments;
}

/** Zaradenie výkonu FV do pásma: 'niz' | 'str' | 'vys' | null bez dát. @param {number} powerKw */
export function productionLevel(powerKw) {
    if (!Number.isFinite(powerKw)) return null;
    if (powerKw < POWER_LOW_KW) return 'niz';
    if (powerKw < POWER_HIGH_KW) return 'str';
    return 'vys';
}

/**
 * Farba reaguje aj na výkon FV: od POWER_LOW_KW je zelená bez ohľadu na tarifu,
 * pod ňou ostáva podľa rozvrhu (červená v drahých slotoch, inak oranžová).
 * @param {Tier | null} tier @param {number} powerKw @param {Tier | null} [fallback]
 * @returns {Tier | null}
 */
export function smartTier(tier, powerKw, fallback = tier) {
    if (!Number.isFinite(powerKw)) return fallback;
    if (powerKw >= POWER_LOW_KW) return 'green';
    return tier === 'red' ? 'red' : 'amber';
}

/** "Nízka tarifa" = všetko okrem drahého pásma. @param {Tier | null} tier */
export function isLowTariff(tier) {
    return tier === 'green' || tier === 'amber';
}

/** Nočná NT sadzba pre auto. @param {number} minutes */
export function isAutoNightWindow(minutes) {
    return isInWindow(minutes, AUTO_NIGHT_WINDOW.start, AUTO_NIGHT_WINDOW.end);
}

/**
 * Auto má vlastnú farebnú logiku: v noci oranžové (lacná sadzba bez slnka),
 * cez deň zelené len pri silnom slnku a lacnej sieti.
 * @param {number} minutes @param {Tier | null} tier @param {number} powerKw @returns {Tier}
 */
export function autoTier(minutes, tier, powerKw) {
    if (isAutoNightWindow(minutes)) return 'amber';
    if (!Number.isFinite(powerKw) || powerKw < AUTO_MIN_PV_KW) return 'red';
    return isLowTariff(tier) ? 'green' : 'amber';
}

/**
 * Stav každého spotrebiča v danej minúte: 'go' v zelenom okne, 'wait' mimo neho,
 * 'no' ak spotrebič v sezóne nie je odporúčaný vôbec.
 * @param {number} minutes @param {Season} season
 * @returns {Array<{name: string, powerKw: number, state: 'go' | 'wait' | 'no'}>}
 */
export function deviceStates(minutes, season) {
    const win = deviceWindow(season);
    const recommended = win && win.devices;
    if (!win || !recommended) return [];
    const inWindow = isInWindow(minutes, win.start, win.end);
    return DEVICES.map((d) => {
        if (!recommended.includes(d.name)) return { ...d, state: 'no' };
        return { ...d, state: inWindow ? 'go' : 'wait' };
    });
}
