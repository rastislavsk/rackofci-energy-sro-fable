import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTALLED_PV_KW } from '../shared/config.js';
import {
    chartDims,
    chartTooltipModel,
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
    weekBarsModel,
    weekHeatModel,
    weekStatsModel,
} from '../shared/chart-model.js';
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
