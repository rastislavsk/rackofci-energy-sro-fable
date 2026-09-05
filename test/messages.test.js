import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEyebrow, forecastDayMessage, getSlotMessage, SLOT_MESSAGES, weekMessage } from '../shared/messages.js';

test('getSlotMessage: každá kombinácia tarify × výroby má neprázdny nadpis aj text', () => {
    for (const tier of /** @type {const} */ (['red', 'amber', 'green'])) {
        for (const kw of [0.5, 3, 6]) {
            const msg = getSlotMessage(tier, kw, null);
            assert.ok(msg && msg.headline && msg.body, `${tier} ${kw}`);
        }
    }
    assert.equal(getSlotMessage('red', NaN, null), null);
    assert.equal(getSlotMessage(null, 3, null), null);
});

test('getSlotMessage: override pri silnejšom slnku, green podľa zajtrajška', () => {
    const forecast = { strongerWindowAhead: true, windowDaypart: 'poobede', tomorrowSunny: true };
    assert.equal(getSlotMessage('red', 0.5, forecast)?.headline, SLOT_MESSAGES.red.niz.override.h);
    assert.match(getSlotMessage('amber', 3, forecast)?.body || '', /poobede/);
    assert.equal(getSlotMessage('red', 6, forecast)?.headline, SLOT_MESSAGES.red.vys.h, 'vysoká výroba nemá override');
    assert.match(getSlotMessage('green', 0.5, forecast)?.body || '', /Zajtra bude slnečno/);
    assert.match(getSlotMessage('green', 0.5, { tomorrowSunny: false })?.body || '', /slnečno nebude/);
});

test('buildEyebrow: tarifa a slnko, v noci bez slnka', () => {
    assert.equal(buildEyebrow('green', 6, false), "IT'S GREENTIME 🙂 · silné slnko");
    assert.equal(buildEyebrow('amber', 3, false), 'Lacná elektrina · mierne slnko');
    assert.equal(buildEyebrow('red', 0.5, false), 'Drahá elektrina · slnko je slabé');
    assert.equal(buildEyebrow('red', NaN, false), 'Drahá elektrina');
    assert.equal(buildEyebrow('amber', 0, true), 'Lacná elektrina · noc');
});

test('forecastDayMessage: slabý deň, dnes a zajtra', () => {
    const weak = [{ hour: 12, kw: 0.8 }];
    assert.equal(forecastDayMessage(weak, true).title, 'Dnes bude slabo');
    assert.equal(forecastDayMessage(weak, false).title, 'Zajtra bude slabšie');
    const pts = [
        { hour: 8, kw: 1 },
        { hour: 11, kw: 4 },
        { hour: 13, kw: 6 },
        { hour: 15, kw: 4.5 },
        { hour: 18, kw: 1 },
    ];
    const today = forecastDayMessage(pts, true);
    assert.equal(today.title, 'Najsilnejšie slnko okolo 13:00');
    assert.match(today.body, /medzi 11:00 a 16:00/);
    assert.match(forecastDayMessage(pts, false).body, /~6\.0 kW/);
    assert.equal(forecastDayMessage([], true).title, 'Dnes bude slabo');
});

test('weekMessage: najsilnejší a najslabší deň', () => {
    const days = [
        { date: '2026-09-05', kwhTotal: 30 },
        { date: '2026-09-06', kwhTotal: 45 },
        { date: '2026-09-07', kwhTotal: 12 },
    ];
    const msg = weekMessage(days);
    assert.equal(msg.title, 'Najsilnejší deň: Zajtra');
    assert.match(msg.body, /Najslabšie bude po 7\.9\./);
    assert.doesNotMatch(weekMessage([days[0]]).body, /Najslabšie/);
});
