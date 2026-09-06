import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTALLED_PV_KW } from '../shared/config.js';
import {
    chartDims,
    chartTooltipModel,
    fillDims,
    dayKwAt,
    dayStripModel,
    forecastChartModel,
    interpolate,
    kwGridStep,
    kwToStripY,
    realProductionSoFar,
    smoothPath,
    STRIP,
    usePct,
    WEEK_HOURS,
    weekBarsModel,
    weekHeatModel,
    weekStatsModel,
} from '../shared/chart-model.js';
import { hourLabel, weekDateLabel, weekDayShort } from '../shared/format.js';
import { fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();

test('interpolate: okraje, stred, iné pole', () => {
    const pts = [
        { hour: 6, kw: 0, cloud: 10 },
        { hour: 8, kw: 4, cloud: 50 },
    ];
    assert.equal(interpolate(pts, 5), 0);
    assert.equal(interpolate(pts, 9), 4);
    assert.equal(interpolate(pts, 7), 2);
    assert.equal(interpolate(pts, 7, 'cloud'), 30);
    assert.equal(interpolate([], 7), 0);
});

test('smoothPath a kwGridStep', () => {
    assert.equal(smoothPath([]), '');
    assert.match(
        smoothPath([
            { x: 0, y: 0 },
            { x: 10, y: 5 },
        ]),
        /^M 0 0 C 5 0, 5 5, 10 5$/,
    );
    assert.equal(kwGridStep(1.5), 0.25);
    assert.equal(kwGridStep(9), 1);
    assert.equal(kwGridStep(500), 20);
    // Na nízkom plátne sa krok zhrubne, aby popisky osi Y nesplynuli do stĺpca číslic.
    assert.equal(kwGridStep(9, 2), 5, 'dve čiary namiesto deviatich');
    assert.equal(kwGridStep(9, 1), 10, 'jedna čiara');
    assert.equal(kwGridStep(9, 0.4), 10, 'menej než jedna čiara sa berie ako jedna');
    assert.equal(kwGridStep(9, 99), kwGridStep(9), 'nad desať čiar sa nejde ani tak');
});

test('forecastChartModel: null bez dát, maxKw = 1,15 × maximum, mriežka podľa plátna', () => {
    assert.equal(forecastChartModel({ pts: [], dims: chartDims(false) }), null);
    assert.equal(forecastChartModel({ pts: [{ hour: 2, kw: 1, cloud: 0 }], dims: chartDims(false) }), null, 'body mimo 06-21 sa nekreslia');
    const pts = forecast.hourlyToday;
    const maxPt = Math.max(...pts.filter((p) => p.hour >= 6 && p.hour <= 21).map((p) => p.kw));
    const mobile = forecastChartModel({ pts, dims: chartDims(false), nowHour: 13 });
    assert.ok(mobile);
    assert.ok(Math.abs(mobile.maxKw - Math.max(maxPt, 0.5) * 1.15) < 1e-9);
    assert.equal(mobile.gridX.length, 6, 'mobil: každé 3 hodiny od 6 do 21');
    assert.equal(mobile.gridY.length, 0, 'mobil bez osi Y');
    assert.ok(mobile.nowX !== null && mobile.nowX > mobile.dims.padL);
    assert.ok(mobile.cloud && mobile.cloud.length === mobile.line.length);
    const wide = forecastChartModel({ pts, dims: chartDims(true), realPts: pv.realCurveToday });
    assert.ok(wide && wide.gridY.length > 2 && wide.real.length > 0 && wide.realLast);
    assert.equal(wide.nowX, null);
});

test('chartTooltipModel: ľavý okraj = 06:00, pravý = 21:00, strop len ak body majú clearKw', () => {
    const m = forecastChartModel({ pts: forecast.hourlyToday, dims: chartDims(true) });
    assert.ok(m);
    assert.equal(chartTooltipModel(m, 0).time, '06:00');
    assert.equal(chartTooltipModel(m, 1).time, '21:00');
    assert.equal(chartTooltipModel(m, 0.5).clearKw, null);
    const week = forecastChartModel({ pts: forecast.days[0].hourly, dims: chartDims(true) });
    assert.ok(week);
    const tip = chartTooltipModel(week, 0.5);
    assert.ok(tip.clearKw !== null && tip.yFrac > 0 && tip.yFrac < 1);
});

test('pás dňa: mierka 0..inštalovaný výkon, hranica meranie/predpoveď, pásma pokryjú deň', () => {
    assert.equal(kwToStripY(0), STRIP.baseY);
    assert.equal(kwToStripY(INSTALLED_PV_KW), STRIP.topY);
    assert.equal(kwToStripY(NaN), STRIP.baseY);
    const nowMinutes = 13 * 60;
    assert.ok(Number.isNaN(dayKwAt(600, null, null, nowMinutes)));
    assert.ok(dayKwAt(600, pv.realCurveToday, forecast.hourlyToday, nowMinutes) > 0);
    const model = dayStripModel({ season: 'summer', hourlyToday: forecast.hourlyToday, realCurve: pv.realCurveToday, nowMinutes });
    assert.equal(
        model.bands.reduce((s, b) => s + b.width, 0),
        1440,
    );
    assert.ok(model.hasData && model.boundary === nowMinutes, 'kiosk končí 13:00 = teraz');
    assert.ok(model.future && model.future[0].x === nowMinutes);
    assert.equal(model.points.length, 1440 / STRIP.sampleMin + 1);
    const empty = dayStripModel({ season: 'winter', hourlyToday: null, realCurve: null, nowMinutes });
    assert.ok(!empty.hasData && empty.boundary === null && empty.future === null && empty.points.length === 5);
});

test('weekHeatModel: 7 riadkov × 17 hodín, popisky a výber dňa', () => {
    const m = weekHeatModel(forecast.days, 2);
    assert.equal(m.cells.length, 7 * 17);
    assert.equal(m.dayLabels.length, 7);
    assert.ok(m.dayLabels[2].sel && m.dayLabels[0].today);
    assert.ok(m.cells.some((c) => c.tip) && m.cells.some((c) => !c.tip));
    assert.ok(m.cells.every((c) => c.frac >= 0 && c.frac <= 1));
    assert.equal(m.hourLabels.map((l) => l.label).join(','), '8,12,16,20');
});

test('weekHeatModel: farebné pásma bunky - nízky výkon červená, vysoký zelená', () => {
    const m = weekHeatModel(forecast.days, 0);
    assert.ok(
        m.cells.some((c) => c.tier === null),
        'bunky bez výroby nemajú pásmo (sivá)',
    );
    assert.ok(m.cells.some((c) => c.tier === 'red'));
    assert.ok(m.cells.some((c) => c.tier === 'amber'));
    assert.ok(m.cells.some((c) => c.tier === 'green'));
    assert.ok(m.cells.every((c) => c.tier === null || c.frac > 0.02));
    assert.equal(m.legend.length, 10);
    assert.equal(m.legend[0].tier, 'red');
    assert.equal(m.legend[m.legend.length - 1].tier, 'green');
});

test('weekHeatModel: tooltip bunky patrí svojmu dňu a svojej hodine', () => {
    const m = weekHeatModel(forecast.days, 0);
    const cols = WEEK_HOURS.length;
    // Bunka sa hľadá podľa vlastnej pozície, nie podľa poradia v poli - tak sa overí,
    // že bunke nesedí tooltip susedného dňa ani susednej hodiny.
    for (const [ri, ci] of [
        [0, 6],
        [3, 8],
        [6, 10],
    ]) {
        const cell = m.cells[ri * cols + ci];
        const hour = WEEK_HOURS[ci];
        const day = forecast.days[ri];
        assert.equal(cell.dayIndex, ri);
        if (!cell.tip) continue;
        const point = day.hourly.find((h) => h.hour === hour);
        assert.equal(
            cell.tip.title,
            `${weekDayShort(day.date, ri)} ${weekDateLabel(day.date)} · ${hourLabel(hour)}–${hourLabel(hour + 1)}`,
        );
        assert.ok(cell.tip.text.startsWith(`${(point ? point.kw : 0).toFixed(2)} kW`), `text bunky [${ri}][${ci}]: ${cell.tip.text}`);
    }
});

test('fillDims: okraje širokého plátna na skutočnom rozmere karty', () => {
    const d = fillDims(498.6, 377.2);
    assert.equal(d.w, 499, 'rozmer sa zaokrúhli na celý pixel, aby viewBox sedel s kartou');
    assert.equal(d.h, 377);
    const wide = chartDims(true);
    assert.equal(d.padL, wide.padL, 'okraje aj os Y ostávajú tie zo širokého plátna');
    assert.equal(d.yAxis, wide.yAxis);
    assert.equal(d.hourStep, wide.hourStep);
});

test('weekHeatModel: so zadanou veľkosťou vyplní kartu, bez nej si plátno určí sama', () => {
    const bez = weekHeatModel(forecast.days, 0);
    assert.equal(bez.W, 440, 'predvolené plátno ostáva 440 široké');
    assert.equal(bez.H, 20 + forecast.days.length * 24 + 4);

    const so = weekHeatModel(forecast.days, 0, { W: 462, H: 481 });
    assert.equal(so.W, 462);
    assert.equal(so.H, 481, 'plátno je presne to, ktoré dostalo - inak by v karte ostalo prázdno');
    assert.equal(so.cells.length, bez.cells.length, 'počet buniek sa veľkosťou nemení');
    assert.ok(so.cells[0].h > bez.cells[0].h, 'vyššia karta = vyššie bunky');
    // Posledný riadok musí končiť v plátne, inak by mapa pretiekla cez okraj karty.
    const posledny = so.cells[so.cells.length - 1];
    assert.ok(posledny.y + posledny.h <= so.H, `posledný riadok končí na ${posledny.y + posledny.h}, plátno má ${so.H}`);

    // Aj v extrémne nízkej karte musí bunka ostať kladná, nie záporná.
    const nizka = weekHeatModel(forecast.days, 0, { W: 300, H: 30 });
    assert.ok(
        nizka.cells.every((c) => c.h > 0),
        'bunky nesmú mať zápornú výšku',
    );
});

test('weekBarsModel: stĺpce s tooltipom a stropom, vybraný deň označený', () => {
    const m = weekBarsModel(forecast.days, 1);
    assert.equal(m.bars.length, 7);
    assert.ok(m.bars[1].sel && m.bars[0].today);
    assert.match(m.bars[0].tip.text, /kWh · strop/);
    assert.ok(
        m.bars.every((b) => b.h >= 0 && b.clearY >= 0),
        'geometria je v plátne',
    );
    assert.ok(m.grid.length >= 2);
});

test('weekBarsModel: showCeiling = false vypne čiaru stropu, ale nie tooltip', () => {
    const m = weekBarsModel(forecast.days, 1, undefined, false);
    assert.ok(
        m.bars.every((b) => b.clearY === null),
        'bez stropu nemá žiadny stĺpec clearY',
    );
    assert.match(m.bars[0].tip.text, /kWh · strop/, 'tooltip pri hoveri stále ukáže strop');
});

test('weekStatsModel a realProductionSoFar', () => {
    assert.equal(realProductionSoFar(null), null);
    const real = realProductionSoFar(pv);
    assert.ok(real && real.total === 31.7 && real.peakKw !== null && real.peakHour !== null);
    const s = weekStatsModel(forecast.days, pv, forecast.tomorrowSunny);
    assert.ok(s.progress && s.progress.realKwh === 31.7);
    assert.ok(Math.abs(s.totalKwh - forecast.days.reduce((a, d) => a + d.kwhTotal, 0)) < 1e-9);
    assert.ok(s.best.kwh >= s.avgKwh);
    assert.equal(weekStatsModel(forecast.days, null, false).progress, null);
    assert.equal(typeof s.trendPct, 'number');
    assert.equal(usePct({ ...forecast.days[0], clearKwhTotal: 0 }), null);
});
