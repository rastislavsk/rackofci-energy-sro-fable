import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POWER_HIGH_KW, POWER_LOW_KW } from '../shared/config.js';
import {
    autoTier,
    deviceStates,
    isInWindow,
    productionLevel,
    seasonFor,
    smartTier,
    stripSegments,
    windowAt,
    windowsFor,
} from '../shared/tariff.js';

const m = (/** @type {number} */ h, /** @type {number} */ min = 0) => h * 60 + min;

test('seasonFor: marec až október leto, inak zima', () => {
    assert.equal(seasonFor(new Date(2026, 2, 1)), 'summer');
    assert.equal(seasonFor(new Date(2026, 9, 31)), 'summer');
    assert.equal(seasonFor(new Date(2026, 10, 1)), 'winter');
    assert.equal(seasonFor(new Date(2026, 1, 15)), 'winter');
});

test('isInWindow zvláda okno cez polnoc', () => {
    assert.ok(isInWindow(m(2), '23:30', '07:30'));
    assert.ok(isInWindow(m(23, 45), '23:30', '07:30'));
    assert.ok(!isInWindow(m(7, 30), '23:30', '07:30'));
    assert.ok(isInWindow(m(10, 30), '10:30', '17:30'));
    assert.ok(!isInWindow(m(17, 30), '10:30', '17:30'));
});

test('windowAt: leto 12:00 green, 19:00 amber, 08:00 red, 02:00 nočné amber; zima 15:00 amber', () => {
    assert.equal(windowAt(m(12), 'summer')?.status, 'green');
    assert.equal(windowAt(m(19), 'summer')?.status, 'amber');
    assert.equal(windowAt(m(8), 'summer')?.status, 'red');
    assert.equal(windowAt(m(2), 'summer')?.night, true);
    assert.equal(windowAt(m(15), 'winter')?.status, 'amber');
    assert.equal(windowAt(m(15), 'summer')?.status, 'green');
});

test('okná pokrývajú celý deň bez dier a prekryvov v oboch sezónach', () => {
    for (const season of /** @type {const} */ (['summer', 'winter'])) {
        for (let minute = 0; minute < 1440; minute++) {
            const hits = windowsFor(season).filter((w) => isInWindow(minute, w.start, w.end));
            assert.equal(hits.length, 1, `${season} ${minute}: ${hits.length} okien`);
        }
    }
});

test('stripSegments: súčet 1440 minút a rovnaký vzor ako pôvodná appka', () => {
    const summer = stripSegments('summer');
    assert.equal(
        summer.reduce((s, x) => s + x.min, 0),
        1440,
    );
    assert.deepEqual(
        summer.map((s) => `${s.min}${s.cls[0]}`),
        ['450a', '60r', '60a', '60r', '420g', '180a', '60r', '60a', '60r', '30a'],
    );
    assert.deepEqual(
        stripSegments('winter').map((s) => `${s.min}${s.cls[0]}`),
        ['450a', '60r', '60a', '60r', '240g', '360a', '60r', '60a', '60r', '30a'],
    );
});

test('productionLevel a smartTier používajú hranice z configu', () => {
    assert.equal(productionLevel(NaN), null);
    assert.equal(productionLevel(POWER_LOW_KW - 0.01), 'niz');
    assert.equal(productionLevel(POWER_LOW_KW), 'str');
    assert.equal(productionLevel(POWER_HIGH_KW), 'vys');
    assert.equal(smartTier('red', NaN), 'red');
    assert.equal(smartTier('red', NaN, null), null);
    assert.equal(smartTier('red', POWER_LOW_KW), 'green');
    assert.equal(smartTier('red', 0.5), 'red');
    assert.equal(smartTier('amber', 0.5), 'amber');
    assert.equal(smartTier('green', 0.5), 'amber');
});

test('autoTier: noc amber, slabé slnko red, silné slnko + lacná sieť green', () => {
    assert.equal(autoTier(m(1), 'amber', 0), 'amber');
    assert.equal(autoTier(m(12), 'green', 1), 'red');
    assert.equal(autoTier(m(12), 'green', POWER_HIGH_KW), 'green');
    assert.equal(autoTier(m(8), 'red', POWER_HIGH_KW), 'amber');
});

test('deviceStates: v zelenom okne go, mimo wait, v zime sušička a umývačka no', () => {
    const summerNoon = deviceStates(m(12), 'summer');
    assert.ok(summerNoon.every((d) => d.state === 'go'));
    assert.ok(deviceStates(m(20), 'summer').every((d) => d.state === 'wait'));
    const winter = Object.fromEntries(deviceStates(m(12), 'winter').map((d) => [d.name, d.state]));
    assert.deepEqual(winter, { Práčka: 'go', Sušička: 'no', Umývačka: 'no', Auto: 'go', Bojler: 'go' });
    assert.equal(summerNoon.find((d) => d.name === 'Auto')?.powerKw, 11);
});
