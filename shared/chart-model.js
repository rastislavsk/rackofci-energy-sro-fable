// Geometria grafov ako čisté dáta: body v súradniciach viewBoxu, mriežky, tooltipy.
// Kreslenie (SVG reťazce) je vo web/svg.js; tu nie je nič, čo by potrebovalo DOM.

import { MINUTES_PER_DAY } from './config.js';
import { formatGridKw, hourLabel, hourFloatToTimeStr, weekDateLabel, weekDayName, weekDayShort } from './format.js';
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

// Aspoň toľko pixelov na jeden popisok osi Y, aby sa čísla nelepili na seba.
const Y_LABEL_SPACE_PX = 22;

/**
 * Krok vodorovnej mriežky: najjemnejší s okrúhlymi číslami, ktorý sa na plátno ešte zmestí.
 * `maxLines` obmedzuje počet čiar podľa dostupnej výšky - na nízkom plátne by ich desať
 * splynulo do jedného stĺpca číslic.
 * @param {number} maxKw @param {number} [maxLines]
 */
export function kwGridStep(maxKw, maxLines = 10) {
    const limit = Math.max(1, Math.min(10, Math.floor(maxLines)));
    const steps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20];
    return steps.find((s) => maxKw / s <= limit) || steps[steps.length - 1];
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
        const plotH = dims.h - dims.padT - dims.padB;
        const step = kwGridStep(maxKw, plotH / Y_LABEL_SPACE_PX);
        // Násobenie krokom, nie pripočítavanie - inak by sa nazbierala desatinná chyba.
        for (let i = 0; i * step <= maxKw; i++) gridY.push({ y: scale.y(i * step), label: formatGridKw(i * step) });
    }
    return { gridX, gridY };
}

/** Body dňa v produkčnom okne grafu (HOUR_RANGE) - mimo neho sú len nulové nočné hodiny,
 * ktoré by skreslili špičku aj text správy dňa. @param {HourPoint[]} pts */
export function visibleHours(pts) {
    return pts.filter((p) => p.hour >= HOUR_RANGE.min && p.hour <= HOUR_RANGE.max);
}

/**
 * Model grafu hodinovej výroby (Predpoveď Dnes/Zajtra aj Priebeh výroby na karte 7 dní).
 * @param {{ pts: HourPoint[], realPts?: Array<{hour: number, kw: number}>, nowHour?: number | null, dims: Dims }} input
 */
export function forecastChartModel({ pts, realPts = [], nowHour = null, dims }) {
    const { min: hMin, max: hMax } = HOUR_RANGE;
    const visible = visibleHours(pts);
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

// ---- Denný prstenec (ciferník na karte Spotrebiče) --------------------------------
// Ciferník sa číta ako 24-hodinový: 00:00 hore, deň v smere hodinových ručičiek.
// Vonkajší prstenec je deň s tarifnými pásmami, vnútorný oblúk aktuálny výkon.
export const RING = { viewBox: 240, rDay: 106, dayWidth: 8, rPower: 78, powerWidth: 14 };

/** Bod na kružnici pre minútu dňa, v jednotkách viewBoxu. @param {number} r @param {number} minutes */
export function ringPoint(r, minutes) {
    const rad = ((minutes / MINUTES_PER_DAY) * 2 - 0.5) * Math.PI;
    const c = RING.viewBox / 2;
    return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
}

/** Poloha na dennom prstenci v percentách jeho obalu - obal je štvorec, takže sa mierka
 * vyrieši sama a appka nemusí poznať, aký veľký ciferník práve je. @param {number} minutes */
export function ringPercent(minutes) {
    const p = ringPoint(RING.rDay, minutes);
    return { left: (p.x / RING.viewBox) * 100, top: (p.y / RING.viewBox) * 100 };
}

/** Uhol jazdca od stredu ciferníka -> minúta dňa. Opak ringPoint; polnoc nie je stena,
 * záporný uhol sa obtočí. @param {number} dx @param {number} dy vzdialenosť od stredu */
export function minutesFromAngle(dx, dy) {
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return Math.round(((deg < 0 ? deg + 360 : deg) / 360) * MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Vzdialenosť dvoch minút po obvode - cez polnoc je to bližšie než rozdiel čísel.
 * @param {number} a @param {number} b */
export function ringGap(a, b) {
    const d = Math.abs(a - b) % MINUTES_PER_DAY;
    return Math.min(d, MINUTES_PER_DAY - d);
}

/**
 * Tarifné pásma dňa ako oblúky vonkajšieho prstenca. Krajné body a príznak dlhého oblúka
 * sú čísla, samotné "d" skladá web/svg.js.
 * @param {import('./config.js').Season} season
 */
export function dayRingModel(season) {
    return stripSegments(season).map((s) => {
        const to = s.startMin + s.min;
        return {
            cls: s.cls,
            start: ringPoint(RING.rDay, s.startMin),
            end: ringPoint(RING.rDay, to === MINUTES_PER_DAY ? to - 0.01 : to),
            large: s.min > MINUTES_PER_DAY / 2 ? 1 : 0,
        };
    });
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

// ---- Karta 7 dní -----------------------------------------------------------------

/** @param {ForecastDay} day */
function hourMap(day) {
    /** @type {Record<number, import('./solar.js').DayHourPoint>} */ const map = {};
    day.hourly.forEach((h) => {
        map[h.hour] = h;
    });
    return map;
}

/** Popisky tooltipu pre bunku hodina × deň. Mapu hodín dostáva hotovú - stavať ju pre každú
 * bunku znovu znamenalo prejsť dáta dňa 13x namiesto raz.
 * @param {ForecastDay} d @param {number} i @param {number} h
 * @param {Record<number, import('./solar.js').DayHourPoint>} map */
function cellTip(d, i, h, map) {
    const cell = map[h];
    const cloudTxt = cell && cell.cloud != null ? ` · ${Math.round(cell.cloud)} % oblačnosť` : '';
    return {
        title: `${weekDayShort(d.date, i)} ${weekDateLabel(d.date)} · ${hourLabel(h)}–${hourLabel(h + 1)}`,
        text: `${(cell ? cell.kw : 0).toFixed(2)} kW${cloudTxt}`,
    };
}

/** Farebné pásmo bunky heatmapy podľa podielu z maxima (0..1): nízky výkon = červená, vysoký = zelená. @param {number} frac */
function heatBand(frac) {
    if (frac < 1 / 3) return 'red';
    if (frac < 2 / 3) return 'amber';
    return 'green';
}

/**
 * Farebné pásmo celého dňa - tá istá logika ako v heatmape, len o úroveň vyššie: namiesto
 * podielu z najsilnejšej hodiny sa počíta podiel z najsilnejšieho dňa v týždni. Vďaka tomu
 * hovoria stĺpce, rebríček aj heatmapa na jednej obrazovke tou istou mierkou.
 *
 * Deň bez výroby (a týždeň bez jedinej kWh) nemá pásmo - `null` znamená "nefarbiť", rovnako
 * ako pri prázdnej bunke heatmapy. Inak by polárny týždeň vyšiel celý červený.
 * @param {ForecastDay[]} days @returns {('red' | 'amber' | 'green' | null)[]}
 */
export function weekDayTiers(days) {
    const max = Math.max(...days.map((d) => d.kwhTotal), 0);
    return days.map((d) => {
        const frac = max > 0 ? d.kwhTotal / max : 0;
        return frac <= 0.02 ? null : heatBand(frac);
    });
}

/**
 * Mapa výroby hodina × deň. Bez `size` si plátno určí sama (mobil), s ním sa roztiahne
 * na skutočný rozmer karty - vtedy sa riadky rozdelia o dostupnú výšku.
 * @param {ForecastDay[]} days @param {number} selDay @param {{ W: number, H: number } | null} [size]
 */
export function weekHeatModel(days, selDay, size = null, jedenDen = false) {
    // Miesto vľavo je na skratky dní. V detaile dňa deň pomenúva hlavička nad mapou, takže
    // skratka odpadá a riadok sa roztiahne na celú šírku.
    const padL = jedenDen ? 4 : 44;
    const padT = 20;
    const padR = 4;
    const gap = 2;
    // V detaile dňa sa kreslí jediný riadok, mierka farieb ale ostáva z celého týždňa -
    // inak by aj najslabší deň vyzeral sám o sebe ako plný.
    const riadky = jedenDen ? [selDay] : days.map((_, i) => i);
    const W = size ? size.W : 440;
    const rh = size ? Math.max(gap + 1, (size.H - padT - 4) / riadky.length) : 24;
    const cw = (W - padL - padR) / WEEK_HOURS.length;
    const H = size ? size.H : padT + riadky.length * rh + 4;
    const maps = days.map(hourMap);
    let max = 0.4;
    maps.forEach((map) => WEEK_HOURS.forEach((h) => (max = Math.max(max, map[h] ? map[h].kw : 0))));

    const hourLabels = WEEK_HOURS.filter((h) => h % 4 === 0).map((h) => ({
        x: padL + (h - WEEK_HOURS[0]) * cw + cw / 2,
        y: padT - 8,
        label: String(h),
    }));
    const dayLabels = jedenDen
        ? []
        : riadky.map((di, ri) => ({
              x: padL - 8,
              y: padT + ri * rh + rh / 2 + 3.5,
              label: weekDayShort(days[di].date, di),
              dayIndex: di,
              today: di === 0,
              sel: di === selDay,
          }));
    const cells = [];
    riadky.forEach((di, ri) => {
        WEEK_HOURS.forEach((h, ci) => {
            const cell = maps[di][h];
            const v = cell ? cell.kw : 0;
            const frac = v / max;
            cells.push({
                x: padL + ci * cw + gap / 2,
                y: padT + ri * rh + gap / 2,
                w: cw - gap,
                h: rh - gap,
                frac,
                tier: frac <= 0.02 ? null : heatBand(frac),
                dayIndex: di,
                tip: v > 0.02 ? cellTip(days[di], di, h, maps[di]) : null,
            });
        });
    });
    // Zvýraznenie riadka má zmysel len v mape celého týždňa - v jednom riadku niet čo odlíšiť.
    const selRect = jedenDen ? null : { x: padL - 1, y: padT + selDay * rh, w: W - padL - padR + 2, h: rh - gap };
    const legend = Array.from({ length: 10 }, (_, i) => {
        const frac = i / 9;
        return { frac, tier: heatBand(frac) };
    });
    return { W, H, cells, hourLabels, dayLabels, selRect, max, legend };
}

/** Denná výroba v kWh, voliteľne so stropom jasnej oblohy. @param {ForecastDay[]} days @param {number} selDay @param {{ W: number, H: number }} [size] @param {boolean} [showCeiling] */
export function weekBarsModel(days, selDay, size = { W: 440, H: 190 }, showCeiling = true) {
    const { W, H } = size;
    const padL = 30;
    const padT = 14;
    const padR = 6;
    const padB = 32;
    const slot = (W - padL - padR) / days.length;
    const bw = slot * 0.5;
    const plotH = H - padT - padB;
    const maxV = Math.max(...days.map((d) => Math.max(d.kwhTotal, showCeiling ? d.clearKwhTotal : 0)), 1) * 1.08;
    const gridStep = maxV > 80 ? 40 : maxV > 40 ? 20 : maxV > 16 ? 10 : 5;
    const yFor = (/** @type {number} */ v) => padT + plotH - (v / maxV) * plotH;

    const grid = [];
    for (let g = 0; g <= maxV; g += gridStep) grid.push({ y: yFor(g), label: String(g) });
    const tiers = weekDayTiers(days);
    const bars = days.map((d, i) => {
        const cx = padL + i * slot + slot / 2;
        const usePct = d.clearKwhTotal > 0 ? Math.round((100 * d.kwhTotal) / d.clearKwhTotal) : 0;
        return {
            dayIndex: i,
            sel: i === selDay,
            today: i === 0,
            tier: tiers[i],
            x: cx - bw / 2,
            y: yFor(d.kwhTotal),
            w: bw,
            h: Math.max(0, (d.kwhTotal / maxV) * plotH),
            cx,
            clearY: showCeiling ? yFor(d.clearKwhTotal) : null,
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
    let bestIndex = 0;
    days.forEach((d, i) => {
        if (d.kwhTotal > best.kwhTotal) {
            best = d;
            bestIndex = i;
        }
    });
    // Dnešná nabehnutá výroba proti predpovedi. Iné dni namerané nie sú, takže progress
    // patrí vždy k dnešku.
    const realKwh = pv && Number.isFinite(Number(pv.dailyEnergyKwh)) ? Number(pv.dailyEnergyKwh) : null;
    const progress = realKwh !== null && today.kwhTotal > 0 ? { realKwh, pct: Math.round((100 * realKwh) / today.kwhTotal) } : null;
    const trendPct = tomorrow && today.kwhTotal > 0 ? Math.round((100 * (tomorrow.kwhTotal - today.kwhTotal)) / today.kwhTotal) : null;
    return {
        today,
        tomorrow,
        tomorrowSunny,
        totalKwh: total,
        avgKwh: total / days.length,
        best: {
            label: weekDayShort(best.date, bestIndex),
            fullLabel: `${weekDayShort(best.date, bestIndex)}${bestIndex > 1 ? ' ' + weekDateLabel(best.date) : ''}`,
            kwh: best.kwhTotal,
        },
        trendPct,
        progress,
    };
}

/**
 * Rebríček dní: prehľad karty 7 dní na mobile. Jeden riadok na deň, v ňom meno, dátum,
 * obloha, výroba a dĺžka pásika.
 *
 * Pásik sa škáluje voči najsilnejšiemu dňu v týždni, nie voči stropu jasnej oblohy: otázka
 * prehľadu je "ktorý deň z týchto siedmich je dobrý", nie "koľko dnes ubrali mraky" - to
 * druhé hovorí využitie v detaile dňa. Znamená to, že aj v škaredom týždni má najsilnejší
 * deň plný pásik; číslo vedľa neho to opravuje.
 * @param {ForecastDay[]} days @param {number} selDay
 */
export function weekListModel(days, selDay) {
    // Týždeň bez jedinej kWh (polárna noc, pokazené dáta) by z delenia urobil NaN a pásiky
    // by zmizli aj s rozložením mriežky - vtedy sú prázdne, čo je pravda o takom týždni.
    const max = Math.max(...days.map((d) => d.kwhTotal), 0);
    const tiers = weekDayTiers(days);
    return days.map((d, i) => ({
        dayIndex: i,
        today: i === 0,
        sel: i === selDay,
        tier: tiers[i],
        name: weekDayName(d.date, i),
        dateLabel: weekDateLabel(d.date),
        cloudAvgPct: d.cloudAvgPct,
        // Celé kWh: pri predpovedi na týždeň je desatina falošná presnosť a v riadku
        // zaberá miesto, ktoré patrí pásiku.
        kwh: Math.round(d.kwhTotal),
        barPct: max > 0 ? Math.round((100 * d.kwhTotal) / max) : 0,
    }));
}

/** Percento využitia jasnej oblohy pre deň. @param {ForecastDay} day */
export function usePct(day) {
    return day.clearKwhTotal > 0 ? Math.round((100 * day.kwhTotal) / day.clearKwhTotal) : null;
}
