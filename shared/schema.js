// Kontrakt dát medzi Workerom a appkou. Malý validátor bez knižníc: vráti zoznam chýb,
// prázdny zoznam znamená platné dáta.

const isNum = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (/** @type {unknown} */ v) => v === null || isNum(v);
const isIso = (/** @type {unknown} */ v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** @param {unknown} pts @param {string} path @param {string[]} errors */
function checkHourPoints(pts, path, errors) {
    if (!Array.isArray(pts)) return errors.push(`${path}: očakávané pole`);
    pts.forEach((p, i) => {
        if (!p || !isNum(p.hour) || !isNum(p.kw)) errors.push(`${path}[${i}]: hour a kw musia byť čísla`);
        if (p && 'cloud' in p && !isNumOrNull(p.cloud)) errors.push(`${path}[${i}].cloud: číslo alebo null`);
    });
}

/** @param {unknown} pv @returns {string[]} */
export function validatePv(pv) {
    const errors = [];
    if (!pv || typeof pv !== 'object') return ['pv: očakávaný objekt'];
    const o = /** @type {Record<string, unknown>} */ (pv);
    for (const key of ['realTimePowerKw', 'dailyEnergyKwh', 'monthEnergyKwh', 'yearEnergyKwh', 'cumulativeEnergyKwh']) {
        if (!isNumOrNull(o[key])) errors.push(`pv.${key}: číslo alebo null`);
    }
    if (o.stationName !== null && typeof o.stationName !== 'string') errors.push('pv.stationName: text alebo null');
    checkHourPoints(o.realCurveToday, 'pv.realCurveToday', errors);
    if (!isIso(o.updatedAt)) errors.push('pv.updatedAt: ISO dátum');
    return errors;
}

/** @param {any} d @param {number} i @param {string[]} errors */
function checkDay(d, i, errors) {
    if (!d || typeof d !== 'object') return errors.push(`forecast.days[${i}]: očakávaný objekt`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) errors.push(`forecast.days[${i}].date: YYYY-MM-DD`);
    if (!isNum(d.kwhTotal) || !isNum(d.clearKwhTotal) || !isNum(d.peakKw))
        errors.push(`forecast.days[${i}]: kwhTotal, clearKwhTotal, peakKw čísla`);
    if (d.peakHour !== null && !isNum(d.peakHour)) errors.push(`forecast.days[${i}].peakHour: číslo alebo null`);
    if (!isNumOrNull(d.cloudAvgPct)) errors.push(`forecast.days[${i}].cloudAvgPct: číslo alebo null`);
    checkHourPoints(d.hourly, `forecast.days[${i}].hourly`, errors);
}

/** @param {unknown} forecast @returns {string[]} */
export function validateForecast(forecast) {
    const errors = [];
    if (!forecast || typeof forecast !== 'object') return ['forecast: očakávaný objekt'];
    const o = /** @type {Record<string, any>} */ (forecast);
    if (typeof o.strongerWindowAhead !== 'boolean') errors.push('forecast.strongerWindowAhead: boolean');
    if (typeof o.tomorrowSunny !== 'boolean') errors.push('forecast.tomorrowSunny: boolean');
    if (o.windowDaypart !== null && typeof o.windowDaypart !== 'string') errors.push('forecast.windowDaypart: text alebo null');
    if (!isNumOrNull(o.peakKw)) errors.push('forecast.peakKw: číslo alebo null');
    if (!isNumOrNull(o.hoursAhead)) errors.push('forecast.hoursAhead: číslo alebo null');
    if (!isNum(o.tomorrowPeakKw)) errors.push('forecast.tomorrowPeakKw: číslo');
    checkHourPoints(o.hourlyToday, 'forecast.hourlyToday', errors);
    checkHourPoints(o.hourlyTomorrow, 'forecast.hourlyTomorrow', errors);
    if (!Array.isArray(o.days)) errors.push('forecast.days: pole');
    else o.days.forEach((d, i) => checkDay(d, i, errors));
    if (!isIso(o.updatedAt)) errors.push('forecast.updatedAt: ISO dátum');
    return errors;
}
