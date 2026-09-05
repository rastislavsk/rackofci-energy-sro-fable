import { readFileSync } from 'node:fs';
import { parseKiosk } from '../shared/kiosk.js';
import { buildForecast } from '../shared/solar.js';

/** Pevný čas testov: 5. 9. 2026 13:00 miestneho (11:00 UTC), rovnaký deň ako fixtures. */
export const FIXED_NOW = new Date('2026-09-05T11:00:00Z');

export const fixture = (/** @type {string} */ name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

export function fixtureData(now = FIXED_NOW) {
    return { pv: parseKiosk(fixture('kiosk.json'), now), forecast: buildForecast(fixture('open-meteo.json'), now) };
}
