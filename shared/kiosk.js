// Parser verejného kiosk JSON z Huawei FusionSolar. Jediné miesto, kde vzniká formát `pv`.

/**
 * @typedef {{ realTimePowerKw: number | null, dailyEnergyKwh: number | null, monthEnergyKwh: number | null,
 *   yearEnergyKwh: number | null, cumulativeEnergyKwh: number | null, stationName: string | null,
 *   realCurveToday: Array<{ hour: number, kw: number }>, updatedAt: string }} PvData
 */

/** Kiosk vracia vnútorné JSON ako HTML-escapovaný reťazec. @param {string} str */
export function decodeEntities(str) {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'");
}

/**
 * Dnešná skutočná výroba v 5-minútových krokoch; preskočí prázdne hodnoty ('-', null).
 * @param {{ xAxis?: unknown[], activePower?: unknown[] } | null | undefined} powerCurve
 * @returns {Array<{ hour: number, kw: number }>}
 */
export function extractRealCurveToday(powerCurve) {
    if (!powerCurve || !Array.isArray(powerCurve.xAxis) || !Array.isArray(powerCurve.activePower)) return [];
    const points = [];
    for (let i = 0; i < powerCurve.xAxis.length; i++) {
        const raw = powerCurve.activePower[i];
        if (raw === undefined || raw === null || raw === '-') continue;
        const kw = Number(raw);
        if (!Number.isFinite(kw)) continue;
        const [hh, mm] = String(powerCurve.xAxis[i]).split(':').map(Number);
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
        points.push({ hour: Number((hh + mm / 60).toFixed(4)), kw });
    }
    return points;
}

const numOrNull = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Prevedie vonkajšiu odpoveď kiosku na formát `pv`, ktorý appka zobrazuje.
 * @param {{ data?: string }} outer @param {Date} now
 * @returns {PvData}
 */
export function parseKiosk(outer, now) {
    if (!outer || typeof outer.data !== 'string') throw new Error('kiosk: chýba pole data');
    const inner = JSON.parse(decodeEntities(outer.data));
    const kpi = inner.realKpi || {};
    return {
        realTimePowerKw: numOrNull(kpi.realTimePower),
        dailyEnergyKwh: numOrNull(kpi.dailyEnergy),
        monthEnergyKwh: numOrNull(kpi.monthEnergy),
        yearEnergyKwh: numOrNull(kpi.yearEnergy),
        cumulativeEnergyKwh: numOrNull(kpi.cumulativeEnergy),
        stationName:
            inner.stationOverview && typeof inner.stationOverview.stationName === 'string' ? inner.stationOverview.stationName : null,
        realCurveToday: extractRealCurveToday(inner.powerCurve),
        updatedAt: now.toISOString(),
    };
}
