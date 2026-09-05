import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, extractRealCurveToday, parseKiosk } from '../shared/kiosk.js';
import { FIXED_NOW, fixture } from './helpers.js';

test('decodeEntities dekóduje HTML entity', () => {
    assert.equal(decodeEntities('&quot;a&quot; &amp; &lt;b&gt; &#39;c&#39;'), '"a" & <b> \'c\'');
});

test('extractRealCurveToday preskočí prázdne, neplatné a "-" hodnoty', () => {
    const curve = extractRealCurveToday({ xAxis: ['06:00', '06:05', '06:10', '06:15', 'xx'], activePower: ['0.5', '-', null, 'abc', '1'] });
    assert.deepEqual(curve, [{ hour: 6, kw: 0.5 }]);
    assert.deepEqual(extractRealCurveToday(null), []);
    assert.deepEqual(extractRealCurveToday({ xAxis: 'nie pole' }), []);
});

test('parseKiosk vráti formát pv zo vzorky kiosku', () => {
    const pv = parseKiosk(fixture('kiosk.json'), FIXED_NOW);
    assert.equal(pv.realTimePowerKw, 6.412);
    assert.equal(pv.dailyEnergyKwh, 31.7);
    assert.equal(pv.stationName, 'Račkofci Energy s.r.o.');
    assert.equal(pv.updatedAt, FIXED_NOW.toISOString());
    assert.ok(pv.realCurveToday.length > 100);
    assert.ok(
        pv.realCurveToday.every((p) => p.hour <= 13),
        'po 13:00 sú v kiosku len "-"',
    );
});

test('parseKiosk: chýbajúce polia dajú null, bez data hodí chybu', () => {
    const encoded = JSON.stringify({ realKpi: { realTimePower: 'x' } }).replace(/"/g, '&quot;');
    const pv = parseKiosk({ data: encoded }, FIXED_NOW);
    assert.equal(pv.realTimePowerKw, null);
    assert.equal(pv.stationName, null);
    assert.deepEqual(pv.realCurveToday, []);
    assert.throws(() => parseKiosk({}, FIXED_NOW));
});
