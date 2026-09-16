import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY } from '../shared/config.js';
import {
    chartDims,
    chartTooltipModel,
    fillDims,
    dayKwAt,
    dayRingModel,
    forecastChartModel,
    interpolate,
    kwGridStep,
    minutesFromAngle,
    RING,
    ringGap,
    ringPercent,
    ringPoint,
    smoothPath,
    usePct,
    WEEK_HOURS,
    weekBarsModel,
    weekListModel,
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

test('denný prstenec: 00:00 hore, pásma obídu celý deň, uhol a minúta sú navzájom opačné', () => {
    const c = RING.viewBox / 2;
    const top = ringPoint(RING.rDay, 0);
    assert.ok(Math.abs(top.x - c) < 1e-9 && top.y < c, '00:00 je hore');
    const noon = ringPoint(RING.rDay, MINUTES_PER_DAY / 2);
    assert.ok(Math.abs(noon.x - c) < 1e-9 && noon.y > c, 'poludnie je dole');
    const six = ringPoint(RING.rDay, MINUTES_PER_DAY / 4);
    assert.ok(six.x > c && Math.abs(six.y - c) < 1e-9, '06:00 je vpravo - deň ide v smere ručičiek');

    // minutesFromAngle je opak ringPoint: čo jeden vyrobí, druhý prečíta späť.
    for (const m of [0, 95, 370, 786, 1000, 1435]) {
        const p = ringPoint(RING.rDay, m);
        assert.equal(minutesFromAngle(p.x - c, p.y - c), m, `minúta ${m} tam a späť`);
    }

    const mid = ringPercent(MINUTES_PER_DAY / 2);
    assert.ok(Math.abs(mid.left - 50) < 1e-9 && mid.top > 50, 'percentá sedia s bodom');

    // Polnoc nie je stena: 23:50 a 00:10 sú od seba 20 minút, nie 1420.
    assert.equal(ringGap(1430, 10), 20);
    assert.equal(ringGap(600, 700), 100);

    const bands = dayRingModel('summer');
    assert.ok(bands.length > 1 && bands.every((b) => ['green', 'amber', 'red'].includes(b.cls)));
    assert.ok(
        bands.every((b) => b.large === 0),
        'žiadne letné okno nie je dlhšie než pol dňa',
    );
    // Posledné pásmo končí tesne pred polnocou, nie na nej - oblúk s totožnými koncami
    // by sa nevykreslil vôbec.
    const last = bands[bands.length - 1];
    assert.ok(Math.abs(last.end.x - c) > 1e-6 || last.end.y > c, 'posledný oblúk nekončí presne hore');

    const nowMinutes = 13 * 60;
    assert.ok(Number.isNaN(dayKwAt(600, null, null, nowMinutes)));
    assert.ok(dayKwAt(600, pv.realCurveToday, forecast.hourlyToday, nowMinutes) > 0);
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

test('weekListModel: pásik podľa najsilnejšieho dňa, výroba v celých kWh', () => {
    const rows = weekListModel(forecast.days, 3);
    assert.equal(rows.length, 7);
    assert.ok(rows[0].today && rows[3].sel, 'dnešok a vybraný deň sú označené');
    assert.equal(rows[0].name, 'Dnes');
    assert.equal(rows[1].name, 'Zajtra');
    // Najsilnejší deň má plný pásik, žiadny iný ho nepresiahne.
    const najsilnejsi = Math.max(...forecast.days.map((d) => d.kwhTotal));
    assert.equal(rows[forecast.days.findIndex((d) => d.kwhTotal === najsilnejsi)].barPct, 100);
    assert.ok(
        rows.every((r) => r.barPct >= 0 && r.barPct <= 100),
        'pásik ostáva v rozsahu 0-100 %',
    );
    assert.ok(
        rows.every((r) => Number.isInteger(r.kwh)),
        'výroba je v celých kWh',
    );
});

test('weekListModel: týždeň bez výroby má prázdne pásiky, nie NaN', () => {
    const rows = weekListModel(
        forecast.days.map((d) => ({ ...d, kwhTotal: 0 })),
        0,
    );
    assert.ok(
        rows.every((r) => r.barPct === 0 && r.kwh === 0),
        'delenie nulou nesmie pásiky rozhodiť',
    );
});

test('weekStatsModel', () => {
    const s = weekStatsModel(forecast.days, pv, forecast.tomorrowSunny);
    assert.ok(s.progress && s.progress.realKwh === 31.7);
    assert.ok(Math.abs(s.totalKwh - forecast.days.reduce((a, d) => a + d.kwhTotal, 0)) < 1e-9);
    assert.ok(s.best.kwh >= s.avgKwh);
    assert.equal(weekStatsModel(forecast.days, null, false).progress, null);
    assert.equal(typeof s.trendPct, 'number');
    assert.equal(usePct({ ...forecast.days[0], clearKwhTotal: 0 }), null);
});
