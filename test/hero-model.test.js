import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroModel, minutesOfDay } from '../shared/hero-model.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
const at = (/** @type {string} */ hm) => {
    const d = new Date(FIXED_NOW);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
};
const base = { season: /** @type {const} */ ('summer'), pv, forecast, previewMinutes: null };

test('minutesOfDay', () => {
    assert.equal(minutesOfDay(at('13:05')), 13 * 60 + 5);
});

test('13:00 v lete so 6,4 kW: zelené okno, všetky spotrebiče go, žiadne čakanie', () => {
    const m = heroModel({ ...base, now: at('13:00') });
    assert.equal(m.tier, 'green');
    assert.equal(m.accent, 'green');
    assert.equal(m.eyebrow, "IT'S GREENTIME 🙂 · silné slnko");
    assert.equal(m.message.headline, 'Najlepší čas dňa — zapni všetko');
    assert.ok(m.devices.every((d) => d.state === 'go' && d.tier === 'green'));
    assert.equal(m.waitTime, null);
    assert.equal(m.powerText, '6.41');
    assert.equal(m.unitText, 'kW teraz');
    assert.equal(m.dial.tier, 'green');
});

test('02:00 nočný slot: text z okna, odznak s nocou, auto oranžové', () => {
    const m = heroModel({ ...base, now: at('02:00'), pv: { ...pv, realTimePowerKw: 0 } });
    assert.ok(m.isNight);
    assert.equal(m.message.headline, 'Lacný nočný prúd');
    assert.equal(m.eyebrow, 'Lacná elektrina · noc');
    assert.equal(m.devices.find((d) => d.name === 'Auto')?.tier, 'amber');
    assert.equal(m.dial.tier, 'red');
});

test('08:00 drahý slot bez dát: farba podľa tarify, číslo pomlčka', () => {
    const m = heroModel({ ...base, now: at('08:00'), pv: null, forecast: null });
    assert.equal(m.accent, 'red');
    assert.equal(m.powerText, '–');
    assert.equal(m.eyebrow, 'Drahá elektrina');
    assert.equal(m.message.headline, 'Najdrahšia sieť');
});

test('čakací chip len mimo zeleného okna, keď predpoveď hlási silnejšie slnko', () => {
    const f = { ...forecast, strongerWindowAhead: true, hoursAhead: 3, windowDaypart: 'poobede' };
    const m = heroModel({ ...base, now: at('09:00'), forecast: f, pv: { ...pv, realTimePowerKw: 0.5 } });
    assert.equal(m.waitTime, '12:00');
    assert.equal(m.message.headline, 'Radšej počkaj na slnko', '08:30-09:30 je lacný slot, slabé slnko');
    assert.equal(heroModel({ ...base, now: at('13:00'), forecast: f }).waitTime, null, 'v okne so spotrebičmi sa nečaká');
});

test('náhľad iného času berie výkon z krivky: minulosť merané, budúcnosť odhad', () => {
    const past = heroModel({ ...base, now: at('13:00'), previewMinutes: 10 * 60 });
    assert.ok(past.preview && past.unitText === 'kW (merané)' && past.previewLabel === 'Náhľad · 10:00');
    const future = heroModel({ ...base, now: at('13:00'), previewMinutes: 16 * 60 });
    assert.equal(future.unitText, 'kW (odhad)');
    assert.equal(future.waitTime, null);
    assert.ok(Number.isFinite(future.power));
});
