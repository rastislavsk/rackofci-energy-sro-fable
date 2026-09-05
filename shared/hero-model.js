// Model hlavnej karty (ciferník, odznak, verdikt, spotrebiče) pre daný čas dňa.
// Rovnaká logika pre živé "teraz" aj pre náhľad iného času; líši sa len zdroj výkonu.

import { INSTALLED_PV_KW } from './config.js';
import { dayKwAt, realCurveBoundary } from './chart-model.js';
import { minutesToTimeStr, pad2 } from './format.js';
import { buildEyebrow, getSlotMessage } from './messages.js';
import { autoTier, deviceStates, productionLevel, smartTier, windowAt, windowsFor } from './tariff.js';

/**
 * @typedef {{ now: Date, season: import('./config.js').Season, pv: import('./kiosk.js').PvData | null,
 *   forecast: import('./solar.js').Forecast | null, previewMinutes: number | null }} HeroInput
 */

/** @param {Date} date */
export function minutesOfDay(date) {
    return date.getHours() * 60 + date.getMinutes();
}

/** Výkon pre danú minútu: živý z kiosku, v náhľade z krivky dňa (namerané/predpoveď). @param {HeroInput} state @param {number} minutes @param {number} nowMinutes */
function powerFor(state, minutes, nowMinutes) {
    if (state.previewMinutes === null) return state.pv ? Number(state.pv.realTimePowerKw) : NaN;
    return dayKwAt(minutes, state.pv ? state.pv.realCurveToday : null, state.forecast ? state.forecast.hourlyToday : null, nowMinutes);
}

/** "Lepšie bude o HH:00" - len naživo, mimo okna so spotrebičmi a keď predpoveď hlási silnejšie slnko. @param {HeroInput} state @param {boolean} hasDevices */
function waitTimeFor(state, hasDevices) {
    const f = state.forecast;
    if (state.previewMinutes !== null || hasDevices || !f || !f.strongerWindowAhead || !Number.isFinite(f.hoursAhead)) return null;
    return `${pad2((state.now.getHours() + Math.round(/** @type {number} */ (f.hoursAhead))) % 24)}:00`;
}

/** Ciferník: podiel inštalovaného výkonu a farba podľa pásma výroby. @param {number} power */
function dialFor(power) {
    const level = productionLevel(power);
    /** @type {Record<string, import('./config.js').Tier>} */ const tierByLevel = { niz: 'red', str: 'amber', vys: 'green' };
    return {
        fraction: Number.isFinite(power) ? Math.max(0, Math.min(1, power / INSTALLED_PV_KW)) : 0,
        tier: level ? tierByLevel[level] : null,
    };
}

/** @param {HeroInput} state */
export function heroModel(state) {
    const nowMinutes = minutesOfDay(state.now);
    const preview = state.previewMinutes !== null;
    const minutes = preview ? /** @type {number} */ (state.previewMinutes) : nowMinutes;
    const power = powerFor(state, minutes, nowMinutes);
    // Okná pokrývajú celý deň (overené testom); fallback je len poistka proti chybnému configu.
    const win = windowAt(minutes, state.season) || windowsFor(state.season)[0];
    const tier = win.status;
    const isNight = !!win.night;
    const message = (isNight ? null : getSlotMessage(tier, power, state.forecast)) || { headline: win.title, body: win.sub };
    const deviceTier = smartTier(tier, power, null);
    const measured = (() => {
        const boundary = realCurveBoundary(state.pv ? state.pv.realCurveToday : null, nowMinutes);
        return boundary !== null && minutes <= boundary;
    })();

    return {
        minutes,
        preview,
        power,
        tier,
        accent: smartTier(tier, power),
        isNight,
        eyebrow: buildEyebrow(tier, power, isNight),
        message,
        devices: deviceStates(minutes, state.season).map((d) => ({
            ...d,
            tier: d.name === 'Auto' ? autoTier(minutes, tier, power) : deviceTier,
        })),
        waitTime: waitTimeFor(state, !!win.devices),
        dial: dialFor(power),
        powerText: Number.isFinite(power) ? power.toFixed(2) : '–',
        unitText: preview ? (measured ? 'kW (merané)' : 'kW (odhad)') : 'kW teraz',
        previewLabel: preview ? `Náhľad · ${minutesToTimeStr(minutes)}` : null,
    };
}
