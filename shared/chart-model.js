// Geometria grafov ako čisté dáta: body v súradniciach viewBoxu, mriežky, tooltipy.
// Kreslenie (SVG reťazce) je vo web/svg.js; tu nie je nič, čo by potrebovalo DOM.

import { INSTALLED_PV_KW } from './config.js';
import { formatGridKw, hourLabel, hourFloatToTimeStr, weekDateLabel, weekDayShort } from './format.js';
import { stripSegments } from './tariff.js';

/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {import('./solar.js').HourPoint} HourPoint */
/** @typedef {import('./solar.js').ForecastDay} ForecastDay */
/** @typedef {{ w: number, h: number, padL: number, padR: number, padT: number, padB: number, hourStep: number, xLabelGap: number, yAxis: boolean }} Dims */

// Os X grafov predpovede je pevná 06:00-21:00: pokrýva celé produkčné okno dňa.
export const HOUR_RANGE = { min: 6, max: 21 };
export const WEEK_HOURS = Array.from({ length: 17 }, (_, i) => 5 + i);

/** Dve veľkosti plátna: mobil a široká karta (popisky ostávajú zhruba 1:1). @param {boolean} wide @returns {Dims} */
export function chartDims(wide) {
    return wide
        ? { w: 680, h: 420, padL: 42, padR: 14, padT: 18, padB: 34, hourStep: 2, xLabelGap: 10, yAxis: true }
        : { w: 320, h: 150, padL: 8, padR: 8, padT: 10, padB: 22, hourStep: 3, xLabelGap: 6, yAxis: false };
}

/** Rovnaké okraje ako široké plátno, ale na skutočný rozmer karty. @param {number} w @param {number} h @returns {Dims} */
export function fillDims(w, h) {
    return { ...chartDims(true), w: Math.round(w), h: Math.round(h) };
}

/**
 * Lineárna interpolácia poľa bodov podľa poľa `xField` (predvolene hour).
 * @template {Record<string, any>} T
 * @param {T[]} pts @param {number} x @param {string} [field] @param {string} [xField]
 */
export function interpolate(pts, x, field = 'kw', xField = 'hour') {
    if (!pts.length) return 0;
    if (x <= pts[0][xField]) return pts[0][field];
    const last = pts[pts.length - 1];
    if (x >= last[xField]) return last[field];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (x >= a[xField] && x <= b[xField]) {
            const t = (x - a[xField]) / (b[xField] - a[xField] || 1);
            return a[field] + (b[field] - a[field]) * t;
        }
    }
    return last[field];
}

/** Hladká krivka cez body (kubické Béziery so stredovými kontrolnými bodmi). @param {Pt[]} points */
export function smoothPath(points) {
    if (!points.length) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const cx = (p0.x + p1.x) / 2;
        d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
}

/** Krok vodorovnej mriežky: najjemnejší s najviac 10 čiarami a okrúhlymi číslami. @param {number} maxKw */
export function kwGridStep(maxKw) {
    const steps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20];
    return steps.find((s) => maxKw / s <= 10) || steps[steps.length - 1];
}

/** Prevod hodina/kW -> súradnice plátna. @param {Dims} dims @param {number} maxKw */
export function makeScale(dims, maxKw, hMin = HOUR_RANGE.min, hMax = HOUR_RANGE.max) {
    const plotW = dims.w - dims.padL - dims.padR;
    const plotH = dims.h - dims.padT - dims.padB;
    return {
        x: (/** @type {number} */ hour) => dims.padL + ((hour - hMin) / (hMax - hMin || 1)) * plotW,
        y: (/** @type {number} */ kw) => dims.padT + (1 - kw / maxKw) * plotH,
        yPct: (/** @type {number} */ pct) => dims.padT + (1 - pct / 100) * plotH,
        hourAtX: (/** @type {number} */ x) => Math.max(hMin, Math.min(hMax, hMin + ((x - dims.padL) / (plotW || 1)) * (hMax - hMin))),
    };
}

/** Zvislá mriežka po hodinách a vodorovná po kW (len na širokom plátne). @param {Dims} dims @param {ReturnType<typeof makeScale>} scale @param {number} maxKw */
function buildGrid(dims, scale, maxKw) {
    const { min: hMin, max: hMax } = HOUR_RANGE;
    const gridX = [];
    for (let h = hMin; h <= hMax; h++) {
        if (h % dims.hourStep !== 0) continue;
        gridX.push({ x: scale.x(h), label: `${h}:00`, anchor: h === hMin ? 'start' : h === hMax ? 'end' : 'middle' });
    }
    const gridY = [];
    if (dims.yAxis) {
        const step = kwGridStep(maxKw);
        // Násobenie krokom, nie pripočítavanie - inak by sa nazbierala desatinná chyba.
        for (let i = 0; i * step <= maxKw; i++) gridY.push({ y: scale.y(i * step), label: formatGridKw(i * step) });
    }
    return { gridX, gridY };
}

/**
 * Model grafu hodinovej výroby (Predpoveď Dnes/Zajtra aj Priebeh výroby na karte 7 dní).
 * @param {{ pts: HourPoint[], realPts?: Array<{hour: number, kw: number}>, nowHour?: number | null, dims: Dims }} input
 */
export function forecastChartModel({ pts, realPts = [], nowHour = null, dims }) {
    const { min: hMin, max: hMax } = HOUR_RANGE;
    const visible = pts.filter((p) => p.hour >= hMin && p.hour <= hMax);
    if (!visible.length) return null;
    const real = realPts.filter((p) => p.hour >= hMin && p.hour <= hMax);
    const maxKw = Math.max(...visible.map((p) => p.kw), ...real.map((p) => p.kw), 0.5) * 1.15;
    const scale = makeScale(dims, maxKw);
    const { gridX, gridY } = buildGrid(dims, scale, maxKw);

    const cloudAvailable = visible.every((p) => Number.isFinite(p.cloud));
    const realPoints = real.map((p) => ({ x: scale.x(p.hour), y: scale.y(p.kw) }));
    const peak = visible.reduce((a, b) => (b.kw > a.kw ? b : a), visible[0]);

    return {
        dims,
        hMin,
        hMax,
        maxKw,
        pts: visible,
        line: visible.map((p) => ({ x: scale.x(p.hour), y: scale.y(p.kw) })),
        cloud: cloudAvailable ? visible.map((p) => ({ x: scale.x(p.hour), y: scale.yPct(/** @type {number} */ (p.cloud)) })) : null,
        real: realPoints,
        realLast: realPoints.length ? realPoints[realPoints.length - 1] : null,
        gridX,
        gridY,
        nowX: nowHour === null ? null : scale.x(Math.max(hMin, Math.min(hMax, nowHour))),
        peak: { hour: peak.hour, kw: peak.kw },
        totalKwh: Math.round(visible.reduce((s, p) => s + p.kw, 0) * 10) / 10,
    };
}

/**
 * Tooltip nad krivkou: pre relatívnu polohu kurzora (0-1 šírky plátna) vráti čas,
 * výkon, oblačnosť, prípadne bezoblačný strop a polohu bodu v % plátna.
 * @param {NonNullable<ReturnType<typeof forecastChartModel>>} model @param {number} relX
 */
export function chartTooltipModel(model, relX) {
    const scale = makeScale(model.dims, model.maxKw);
    const hour = scale.hourAtX(relX * model.dims.w);
    const kw = interpolate(model.pts, hour, 'kw');
    const hasCloud = model.cloud !== null;
    const hasClear = model.pts.every((p) => Number.isFinite(/** @type {any} */ (p).clearKw));
    return {
        time: hourFloatToTimeStr(hour),
        kw,
        cloud: hasCloud ? Math.round(interpolate(model.pts, hour, 'cloud')) : null,
        clearKw: hasClear ? interpolate(model.pts, hour, 'clearKw') : null,
        yFrac: scale.y(kw) / model.dims.h,
    };
}

// ---- Pás dňa (Priebeh dňa na karte Spotrebiče) -------------------------------------
export const STRIP = { w: 1440, h: 60, baseY: 54, topY: 6, sampleMin: 15 };

/** Výkon -> výška v páse, pevná mierka 0 až inštalovaný výkon. @param {number} kw */
export function kwToStripY(kw) {
    const frac = Number.isFinite(kw) ? Math.max(0, Math.min(1, kw / INSTALLED_PV_KW)) : 0;
    return STRIP.baseY - frac * (STRIP.baseY - STRIP.topY);
}

/**
 * Hranica medzi nameraným a predpovedaným: posledný nameraný bod, nikdy v budúcnosti.
 * @param {Array<{hour: number, kw: number}> | null | undefined} realCurve @param {number} nowMinutes
 */
export function realCurveBoundary(realCurve, nowMinutes) {
    if (!realCurve || !realCurve.length) return null;
    return Math.min(realCurve[realCurve.length - 1].hour * 60, nowMinutes);
}

/**
 * Výkon v ľubovoľnej minúte dňa: po hranicu meranie, za ňou predpoveď; NaN bez dát.
 * @param {number} minutes @param {Array<{hour: number, kw: number}> | null | undefined} realCurve
 * @param {HourPoint[] | null | undefined} hourlyToday @param {number} nowMinutes
 */
export function dayKwAt(minutes, realCurve, hourlyToday, nowMinutes) {
    const boundary = realCurveBoundary(realCurve, nowMinutes);
    if (boundary !== null && minutes <= boundary) return interpolate(/** @type {any} */ (realCurve), minutes / 60, 'kw');
    if (!hourlyToday || !hourlyToday.length) return NaN;
    return interpolate(hourlyToday, minutes / 60, 'kw');
}

/** Interpolácia Y krivky pásu v danej minúte. @param {Pt[]} points @param {number} x */
export function stripCurveY(points, x) {
    return interpolate(points, x, 'y', 'x');
}

/**
 * Model pásu dňa: farebné pásma tarify + krivka výroby (namerané plnou, predpoveď
 * prerušovanou). Bez predpovede sa kreslí dekoratívna krivka s vrcholom v zelenom okne.
 * @param {{ season: import('./config.js').Season, hourlyToday?: HourPoint[] | null,
 *   realCurve?: Array<{hour: number, kw: number}> | null, nowMinutes: number }} input
 */
export function dayStripModel({ season, hourlyToday, realCurve, nowMinutes }) {
    const bands = stripSegments(season).map((s) => ({ x: s.startMin, width: s.min, cls: s.cls }));
    const hasData = !!(hourlyToday && hourlyToday.length);

    /** @type {Pt[]} */ let points;
    if (hasData) {
        points = [];
        for (let m = 0; m <= STRIP.w; m += STRIP.sampleMin)
            points.push({ x: m, y: kwToStripY(dayKwAt(m, realCurve, hourlyToday, nowMinutes)) });
    } else {
        const green = bands.find((b) => b.cls === 'green');
        points = green
            ? [
                  { x: 0, y: STRIP.baseY },
                  { x: green.x, y: 40 },
                  { x: green.x + green.width / 2, y: 8 },
                  { x: green.x + green.width, y: 40 },
                  { x: STRIP.w, y: STRIP.baseY },
              ]
            : [
                  { x: 0, y: STRIP.baseY },
                  { x: STRIP.w, y: STRIP.baseY },
              ];
    }

    const boundary = hasData ? realCurveBoundary(realCurve, nowMinutes) || 0 : null;
    let past = points;
    /** @type {Pt[] | null} */ let future = null;
    if (boundary !== null) {
        const joint = { x: boundary, y: stripCurveY(points, boundary) };
        past = points.filter((p) => p.x < boundary).concat([joint]);
        future = [joint].concat(points.filter((p) => p.x > boundary));
    }
    return { bands, points, boundary, hasData, past, future };
}

// ---- Karta 7 dní -----------------------------------------------------------------

/** Skutočná výroba dnes: špička krivky a nabehnuté kWh. @param {import('./kiosk.js').PvData | null | undefined} pv */
export function realProductionSoFar(pv) {
    if (!pv) return null;
    const curve = Array.isArray(pv.realCurveToday) ? pv.realCurveToday : [];
    const peak = curve.length ? curve.reduce((a, b) => (b.kw > a.kw ? b : a), curve[0]) : null;
    const total = Number.isFinite(Number(pv.dailyEnergyKwh)) ? Number(pv.dailyEnergyKwh) : null;
    return { peakKw: peak ? peak.kw : null, peakHour: peak ? peak.hour : null, total };
}

/** @param {ForecastDay} day */
function hourMap(day) {
    /** @type {Record<number, import('./solar.js').DayHourPoint>} */ const map = {};
    day.hourly.forEach((h) => {
        map[h.hour] = h;
    });
    return map;
}

/** Popisky tooltipu pre bunku hodina × deň. @param {ForecastDay} d @param {number} i @param {number} h */
function cellTip(d, i, h) {
    const cell = hourMap(d)[h];
    const cloudTxt = cell && cell.cloud != null ? ` · ${Math.round(cell.cloud)} % oblačnosť` : '';
    return {
        title: `${weekDayShort(d.date, i)} ${weekDateLabel(d.date)} · ${hourLabel(h)}–${hourLabel(h + 1)}`,
        text: `${(cell ? cell.kw : 0).toFixed(2)} kW${cloudTxt}`,
    };
}

/** Mapa výroby hodina × deň. @param {ForecastDay[]} days @param {number} selDay */
export function weekHeatModel(days, selDay) {
    const W = 440;
    const padL = 44;
    const padT = 20;
    const padR = 4;
    const gap = 2;
    const rh = 24;
    const cw = (W - padL - padR) / WEEK_HOURS.length;
    const H = padT + days.length * rh + 4;
    const maps = days.map(hourMap);
    let max = 0.4;
    maps.forEach((map) => WEEK_HOURS.forEach((h) => (max = Math.max(max, map[h] ? map[h].kw : 0))));

    const hourLabels = WEEK_HOURS.filter((h) => h % 4 === 0).map((h) => ({
        x: padL + (h - WEEK_HOURS[0]) * cw + cw / 2,
        y: padT - 8,
        label: String(h),
    }));
    const dayLabels = days.map((d, ri) => ({
        x: padL - 8,
        y: padT + ri * rh + rh / 2 + 3.5,
        label: weekDayShort(d.date, ri),
        dayIndex: ri,
        today: ri === 0,
        sel: ri === selDay,
    }));
    const cells = [];
    days.forEach((d, ri) => {
        WEEK_HOURS.forEach((h, ci) => {
            const v = maps[ri][h] ? maps[ri][h].kw : 0;
            cells.push({
                x: padL + ci * cw + gap / 2,
                y: padT + ri * rh + gap / 2,
                w: cw - gap,
                h: rh - gap,
                frac: v / max,
                dayIndex: ri,
                tip: v > 0.02 ? cellTip(d, ri, h) : null,
            });
        });
    });
    const selRect = { x: padL - 1, y: padT + selDay * rh, w: W - padL - padR + 2, h: rh - gap };
    return { W, H, cells, hourLabels, dayLabels, selRect, max, legendFracs: Array.from({ length: 10 }, (_, i) => i / 9) };
}

/** Denná výroba v kWh so stropom jasnej oblohy. @param {ForecastDay[]} days @param {number} selDay @param {{ W: number, H: number }} size */
export function weekBarsModel(days, selDay, size = { W: 440, H: 190 }) {
    const { W, H } = size;
    const padL = 30;
    const padT = 14;
    const padR = 6;
    const padB = 32;
    const slot = (W - padL - padR) / days.length;
    const bw = slot * 0.5;
    const plotH = H - padT - padB;
    const maxV = Math.max(...days.map((d) => Math.max(d.kwhTotal, d.clearKwhTotal)), 1) * 1.08;
    const gridStep = maxV > 80 ? 40 : maxV > 40 ? 20 : maxV > 16 ? 10 : 5;
    const yFor = (/** @type {number} */ v) => padT + plotH - (v / maxV) * plotH;

    const grid = [];
    for (let g = 0; g <= maxV; g += gridStep) grid.push({ y: yFor(g), label: String(g) });
    const bars = days.map((d, i) => {
        const cx = padL + i * slot + slot / 2;
        const usePct = d.clearKwhTotal > 0 ? Math.round((100 * d.kwhTotal) / d.clearKwhTotal) : 0;
        return {
            dayIndex: i,
            sel: i === selDay,
            today: i === 0,
            x: cx - bw / 2,
            y: yFor(d.kwhTotal),
            w: bw,
            h: Math.max(0, (d.kwhTotal / maxV) * plotH),
            cx,
            clearY: yFor(d.clearKwhTotal),
            valueLabel: d.kwhTotal.toFixed(1),
            dayLabel: weekDayShort(d.date, i),
            dateLabel: weekDateLabel(d.date),
            hit: { x: padL + i * slot, w: slot },
            tip: {
                title: `${weekDayShort(d.date, i)} ${weekDateLabel(d.date)}`,
                text: `${d.kwhTotal.toFixed(1)} kWh · strop ${d.clearKwhTotal.toFixed(1)} kWh (${usePct} %)`,
            },
        };
    });
    return { W, H, padL, padR, grid, bars, labelY: H - 14, dateY: H - 4 };
}

/**
 * Súhrnné čísla karty 7 dní (Dnes/Zajtra/spolu, trend, priebeh dnešnej výroby).
 * @param {ForecastDay[]} days @param {import('./kiosk.js').PvData | null | undefined} pv @param {boolean} tomorrowSunny
 */
export function weekStatsModel(days, pv, tomorrowSunny) {
    const today = days[0];
    const tomorrow = days[1] || null;
    const total = days.reduce((s, d) => s + d.kwhTotal, 0);
    let best = days[0];
    days.forEach((d) => {
        if (d.kwhTotal > best.kwhTotal) best = d;
    });
    const real = realProductionSoFar(pv);
    const progress =
        real && Number.isFinite(real.total) && today.kwhTotal > 0
            ? { realKwh: /** @type {number} */ (real.total), pct: Math.round((100 * /** @type {number} */ (real.total)) / today.kwhTotal) }
            : null;
    const trendPct = tomorrow && today.kwhTotal > 0 ? Math.round((100 * (tomorrow.kwhTotal - today.kwhTotal)) / today.kwhTotal) : null;
    return {
        today,
        tomorrow,
        tomorrowSunny,
        totalKwh: total,
        avgKwh: total / days.length,
        best: {
            label: weekDayShort(best.date, days.indexOf(best)),
            fullLabel: `${weekDayShort(best.date, days.indexOf(best))}${days.indexOf(best) > 1 ? ' ' + weekDateLabel(best.date) : ''}`,
            kwh: best.kwhTotal,
        },
        trendPct,
        progress,
    };
}

/** Percento využitia jasnej oblohy pre deň. @param {ForecastDay} day */
export function usePct(day) {
    return day.clearKwhTotal > 0 ? Math.round((100 * day.kwhTotal) / day.clearKwhTotal) : null;
}
