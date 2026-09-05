import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRequest, refreshForecastIfStale, refreshPv, runScheduled } from '../src/index.js';
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
