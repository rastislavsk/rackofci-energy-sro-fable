import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PLANT } from '../shared/config.js';
import {
    buildForecast,
    clearSkyAcKw,
    clearSkyIrradiance,
    daypartFor,
    forecastAcKw,
    hourlySeries,
    localDateKey,
    localHour,
    poaIrradiance,
    solarPosition,
} from '../shared/solar.js';
import { FIXED_NOW, fixture } from './helpers.js';

// Pravé slnečné poludnie v Dvoranoch (18,12° E) je približne 10:47 UTC.
const NOON_JUNE = new Date('2026-06-21T10:47:00Z');
const NOON_DEC = new Date('2026-12-21T10:47:00Z');

test('solarPosition: letné poludnie ~65°, zimné ~18°, azimut na juh', () => {
    const summer = solarPosition(NOON_JUNE);
    assert.ok(summer.elevationDeg > 63.5 && summer.elevationDeg < 66.5, `leto ${summer.elevationDeg}`);
    assert.ok(Math.abs(summer.azimuthDeg - 180) < 3, `azimut ${summer.azimuthDeg}`);
    const winter = solarPosition(NOON_DEC);
    assert.ok(winter.elevationDeg > 16.5 && winter.elevationDeg < 19.5, `zima ${winter.elevationDeg}`);
    assert.ok(solarPosition(new Date('2026-06-21T23:00:00Z')).elevationDeg < 0, 'polnoc pod horizontom');
});

test('solarPosition: ráno východ (azimut < 180), popoludní západ (> 180)', () => {
    assert.ok(solarPosition(new Date('2026-06-21T05:00:00Z')).azimuthDeg < 180);
    assert.ok(solarPosition(new Date('2026-06-21T15:00:00Z')).azimuthDeg > 180);
});

test('poaIrradiance: pod horizontom 0, kolmé slnko dáva beam ≈ dni + difúzna zložka', () => {
    assert.equal(
        poaIrradiance({ ghi: 500, dni: 800, dhi: 100 }, { elevationDeg: -1, azimuthDeg: 180 }, { tiltDeg: 40, azimuthDeg: 180 }),
        0,
    );
    // Slnko presne kolmo na panel so sklonom 40° orientovaný na juh: elevácia 50°, azimut 180°.
    const poa = poaIrradiance({ ghi: 0, dni: 800, dhi: 0 }, { elevationDeg: 50, azimuthDeg: 180 }, { tiltDeg: 40, azimuthDeg: 180 });
    assert.ok(Math.abs(poa - 800) < 1e-6, `poa ${poa}`);
});

test('forecastAcKw: vždy v intervale 0 až limit striedača', () => {
    for (let h = 0; h < 24; h++) {
        const kw = forecastAcKw(900, 900, 150, 30, new Date(`2026-06-21T${String(h).padStart(2, '0')}:00:00Z`));
        assert.ok(kw >= 0 && kw <= PLANT.acLimitKw, `hodina ${h}: ${kw}`);
    }
    assert.equal(forecastAcKw(0, 0, 0, 20, NOON_JUNE), 0);
});

test('clearSky: pri poludní v lete blízko limitu, v noci 0', () => {
    assert.deepEqual(clearSkyIrradiance(0), { ghi: 0, dni: 0, dhi: 0 });
    const kw = clearSkyAcKw(NOON_JUNE);
    assert.ok(kw > 6 && kw <= PLANT.acLimitKw, `strop ${kw}`);
    assert.equal(clearSkyAcKw(new Date('2026-06-21T23:00:00Z')), 0);
});

test('localHour/localDateKey/daypartFor: Europe/Bratislava vrátane letného času', () => {
    assert.equal(localHour(new Date('2026-07-01T10:00:00Z')), 12);
    assert.equal(localHour(new Date('2026-01-01T10:00:00Z')), 11);
    assert.equal(localDateKey(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
    assert.equal(daypartFor(new Date('2026-07-01T12:00:00Z')), 'poobede');
    assert.equal(daypartFor(new Date('2026-07-01T16:00:00Z')), 'podvečer');
    assert.equal(daypartFor(new Date('2026-07-01T19:00:00Z')), 'neskôr');
});

test('hourlySeries: zoradené podľa miestnej hodiny, kw na 2 desatiny, cloud zaokrúhlený', () => {
    const series = hourlySeries([
        { dateUtc: new Date('2026-07-01T12:00:00Z'), acKw: 3.14159, localDate: '2026-07-01', cloudPct: 33.3, tempC: 20 },
        { dateUtc: new Date('2026-07-01T10:00:00Z'), acKw: 1, localDate: '2026-07-01', cloudPct: null, tempC: 18 },
    ]);
    assert.deepEqual(series, [
        { hour: 12, kw: 1, cloud: null },
        { hour: 14, kw: 3.14, cloud: 33 },
    ]);
});

test('buildForecast: 7 dní, dnes = miestny dátum, zajtra má 24 hodín, golden sa nemení', () => {
    const forecast = buildForecast(fixture('open-meteo.json'), FIXED_NOW);
    assert.equal(forecast.days.length, 7);
    assert.equal(forecast.days[0].date, '2026-09-05');
    assert.equal(forecast.hourlyTomorrow.length, 24);
    assert.equal(forecast.updatedAt, FIXED_NOW.toISOString());
    // Open-Meteo začína o 00:00 UTC, takže dnešný miestny deň má v lete len 22 hodín, ďalšie dni 24.
    assert.ok(
        forecast.days.every((d, i) => d.clearKwhTotal > 0 && d.hourly.length === (i === 0 ? 22 : 24)),
        'každý deň má bezoblačný strop a plný počet hodín',
    );
    // "Využitie" v karte 7 dní je pomer týchto dvoch čísel, takže nesmie vyjsť nad 100 %.
    // Na úrovni jednotlivých hodín pripúšťame krok zaokrúhlenia (0,01 kW na oboch stranách),
    // ktorý sa prejaví len pri súmraku, kde ide o stotiny kilowattu.
    assert.ok(
        forecast.days.every((d) => d.kwhTotal <= d.clearKwhTotal),
        'denná výroba neprekročí bezoblačný strop',
    );
    assert.ok(
        forecast.days.every((d) => d.hourly.every((h) => h.kw <= h.clearKw + 0.02)),
        'hodinová výroba neprekročí bezoblačný strop tej istej hodiny',
    );

    const goldenPath = new URL('./golden/forecast.json', import.meta.url);
    if (!existsSync(goldenPath) || process.env.UPDATE_GOLDEN) writeFileSync(goldenPath, JSON.stringify(forecast, null, 1) + '\n');
    assert.deepEqual(
        forecast,
        JSON.parse(readFileSync(goldenPath, 'utf8')),
        'zmena výstupu predpovede - ak je zámerná, spusti UPDATE_GOLDEN=1 npm test',
    );
});
