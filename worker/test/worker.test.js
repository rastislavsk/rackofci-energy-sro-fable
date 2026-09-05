import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStatus, handleRequest, refreshForecastIfStale, refreshPv, runScheduled } from '../src/index.js';
import { OPEN_METEO_URL } from '../../shared/config.js';

const fixture = (/** @type {string} */ name) => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-09-05T11:00:00Z');

function memoryKv(/** @type {Record<string, string>} */ initial = {}) {
    const store = { ...initial };
    return {
        store,
        async get(/** @type {string} */ key) {
            return key in store ? JSON.parse(store[key]) : null;
        },
        async put(/** @type {string} */ key, /** @type {string} */ value) {
            store[key] = value;
        },
    };
}

/** @param {Record<string, string | null>} routes */
function fakeFetch(routes) {
    return async (/** @type {string} */ url) => {
        const body = routes[url];
        if (body === undefined) return new Response('not found', { status: 404 });
        if (body === null) return new Response('boom', { status: 500 });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
}

const env = () => ({ PV_DATA: memoryKv(), KIOSK_URL: 'https://kiosk.test/' });

test('refreshPv uloží parsované pv do KV', async () => {
    const e = env();
    const pv = await refreshPv(e, NOW, fakeFetch({ 'https://kiosk.test/': fixture('kiosk.json') }));
    assert.equal(typeof pv.realTimePowerKw, 'number');
    assert.equal(JSON.parse(e.PV_DATA.store.pv).updatedAt, NOW.toISOString());
});

test('refreshForecastIfStale prepočíta iba keď je predpoveď stará', async () => {
    const e = env();
    const f = fakeFetch({ [OPEN_METEO_URL]: fixture('open-meteo.json') });
    const first = await refreshForecastIfStale(e, NOW, f);
    assert.equal(first.days.length, 7);
    let calls = 0;
    const counting = async (/** @type {string} */ url) => {
        calls++;
        return f(url);
    };
    await refreshForecastIfStale(e, new Date(NOW.getTime() + 10 * 60 * 1000), counting);
    assert.equal(calls, 0, 'čerstvá predpoveď sa nesťahuje znova');
    await refreshForecastIfStale(e, new Date(NOW.getTime() + 60 * 60 * 1000), counting);
    assert.equal(calls, 1, 'po hodine sa prepočíta');
});

test('runScheduled: chyba kiosku nezhodí predpoveď a KV si drží staré pv', async () => {
    const e = env();
    await e.PV_DATA.put('pv', JSON.stringify({ realTimePowerKw: 1.5 }));
    const results = await runScheduled(e, NOW, fakeFetch({ 'https://kiosk.test/': null, [OPEN_METEO_URL]: fixture('open-meteo.json') }));
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(JSON.parse(e.PV_DATA.store.pv).realTimePowerKw, 1.5);
});

test('GET / vráti pv aj forecast s CORS hlavičkami, chýbajúce ako null', async () => {
    const e = env();
    await e.PV_DATA.put('pv', JSON.stringify({ realTimePowerKw: 2 }));
    const res = await handleRequest(new Request('https://w.test/'), e, NOW);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.equal(body.pv.realTimePowerKw, 2);
    assert.equal(body.forecast, null);
    assert.equal(body.servedAt, NOW.toISOString());
});

test('iné cesty a metódy sú odmietnuté', async () => {
    const e = env();
    assert.equal((await handleRequest(new Request('https://w.test/x'), e, NOW)).status, 404);
    assert.equal((await handleRequest(new Request('https://w.test/', { method: 'POST' }), e, NOW)).status, 405);
    assert.equal((await handleRequest(new Request('https://w.test/', { method: 'OPTIONS' }), e, NOW)).status, 204);
});

test('runScheduled zapíše do KV stav oboch obnov s dôvodom zlyhania', async () => {
    const e = env();
    await runScheduled(e, NOW, fakeFetch({ 'https://kiosk.test/': null, [OPEN_METEO_URL]: fixture('open-meteo.json') }));
    const status = JSON.parse(e.PV_DATA.store.status);
    assert.equal(status.pv.ok, false);
    assert.match(status.pv.error, /HTTP 500/);
    assert.equal(status.pv.at, NOW.toISOString());
    assert.equal(status.forecast.ok, true);
    assert.equal(status.forecast.error, undefined);
});

test('chýbajúci secret KIOSK_URL sa prejaví ako zrozumiteľný dôvod v stave', async () => {
    const e = { PV_DATA: memoryKv(), KIOSK_URL: '' };
    await runScheduled(e, NOW, fakeFetch({ [OPEN_METEO_URL]: fixture('open-meteo.json') }));
    assert.match(JSON.parse(e.PV_DATA.store.status).pv.error, /KIOSK_URL/);
});

test('GET / vráti aj stav posledného behu cronu', async () => {
    const e = env();
    await runScheduled(e, NOW, fakeFetch({ 'https://kiosk.test/': fixture('kiosk.json'), [OPEN_METEO_URL]: fixture('open-meteo.json') }));
    const body = await (await handleRequest(new Request('https://w.test/'), e, NOW)).json();
    assert.equal(body.status.pv.ok, true);
    assert.equal(body.status.forecast.ok, true);
    assert.ok(body.pv && body.forecast);
});

test('bez behu cronu je stav null, nie chyba', async () => {
    const body = await (await handleRequest(new Request('https://w.test/'), env(), NOW)).json();
    assert.equal(body.status, null);
});

test('zlyhaný zápis stavu nezhodí cron ani neprepíše uložené dáta', async () => {
    const e = env();
    const kv = e.PV_DATA;
    const origPut = kv.put.bind(kv);
    kv.put = async (key, value) => {
        if (key === 'status') throw new Error('KV nedostupné');
        return origPut(key, value);
    };
    const results = await runScheduled(
        e,
        NOW,
        fakeFetch({ 'https://kiosk.test/': fixture('kiosk.json'), [OPEN_METEO_URL]: fixture('open-meteo.json') }),
    );
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(JSON.parse(kv.store.pv).realTimePowerKw, 6.412);
});

test('GET /status: po úspešnom crone je ok true a dáta sú čerstvé', async () => {
    const e = env();
    await runScheduled(e, NOW, fakeFetch({ 'https://kiosk.test/': fixture('kiosk.json'), [OPEN_METEO_URL]: fixture('open-meteo.json') }));
    const res = await handleRequest(new Request('https://w.test/status'), e, NOW);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const s = await res.json();
    assert.equal(s.ok, true);
    assert.equal(s.pv.ok, true);
    assert.equal(s.pv.ageMinutes, 0);
    assert.equal(s.pv.updatedAt, NOW.toISOString());
    assert.equal(s.pv.lastRun.ok, true);
    assert.equal(s.forecast.ok, true);
});

test('GET /status: zlyhaný kiosk dá ok false a dôvod, predpoveď zostáva v poriadku', async () => {
    const e = env();
    await runScheduled(e, NOW, fakeFetch({ 'https://kiosk.test/': null, [OPEN_METEO_URL]: fixture('open-meteo.json') }));
    const s = await (await handleRequest(new Request('https://w.test/status'), e, NOW)).json();
    assert.equal(s.ok, false);
    assert.equal(s.pv.ok, false);
    assert.equal(s.pv.updatedAt, null);
    assert.match(s.pv.lastRun.error, /HTTP 500/);
    assert.equal(s.forecast.ok, true);
});

test('GET /status na prázdnom KV nespadne, len ohlási, že dáta nie sú', async () => {
    const s = await (await handleRequest(new Request('https://w.test/status'), env(), NOW)).json();
    assert.equal(s.ok, false);
    assert.deepEqual(s.pv, { ok: false, updatedAt: null, ageMinutes: null, lastRun: null });
    assert.equal(s.servedAt, NOW.toISOString());
});

test('buildStatus označí zastarané dáta za nie v poriadku', () => {
    const old = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const s = buildStatus({ pv: { updatedAt: old }, forecast: { updatedAt: NOW.toISOString() }, status: null }, NOW);
    assert.equal(s.pv.ok, false, 'hodinu staré pv je zastarané');
    assert.equal(s.pv.ageMinutes, 60);
    assert.equal(s.forecast.ok, true);
    assert.equal(s.ok, false);
});

test('neznáme cesty ostávajú 404 aj po pridaní /status', async () => {
    assert.equal((await handleRequest(new Request('https://w.test/statuss'), env(), NOW)).status, 404);
    assert.equal((await handleRequest(new Request('https://w.test/status/x'), env(), NOW)).status, 404);
});
