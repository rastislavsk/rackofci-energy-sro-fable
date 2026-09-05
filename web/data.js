// Načítanie dát: primárne Worker (jeden request pre pv aj predpoveď), pri zlyhaní
// dočasne záložné zdroje pôvodnej appky. Neplatné dáta sa správajú ako chýbajúce.

import { LEGACY_SOURCES, WORKER_URL } from '../shared/config.js';
import { validateForecast, validatePv } from '../shared/schema.js';

/** @typedef {{ pv: import('../shared/kiosk.js').PvData | null, forecast: import('../shared/solar.js').Forecast | null, source: 'worker' | 'legacy' | null }} DataResult */

/** @param {string} url @param {typeof fetch} fetchImpl */
async function getJson(url, fetchImpl) {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
}

/** @param {unknown} pv */
const validPv = (pv) => (pv && validatePv(pv).length === 0 ? /** @type {import('../shared/kiosk.js').PvData} */ (pv) : null);
/** @param {unknown} f */
const validForecast = (f) => (f && validateForecast(f).length === 0 ? /** @type {import('../shared/solar.js').Forecast} */ (f) : null);

/** @param {typeof fetch} fetchImpl @returns {Promise<DataResult>} */
async function fromWorker(fetchImpl) {
    const body = await getJson(WORKER_URL, fetchImpl);
    const pv = validPv(body.pv);
    const forecast = validForecast(body.forecast);
    if (!pv && !forecast) throw new Error('Worker nevrátil žiadne platné dáta');
    return { pv, forecast, source: 'worker' };
}

/** @param {typeof fetch} fetchImpl @returns {Promise<DataResult>} */
async function fromLegacy(fetchImpl) {
    const [pvRes, forecastRes] = await Promise.allSettled([
        getJson(LEGACY_SOURCES.pv, fetchImpl),
        getJson(LEGACY_SOURCES.forecast, fetchImpl),
    ]);
    const pv = pvRes.status === 'fulfilled' ? validPv(pvRes.value) : null;
    const forecast = forecastRes.status === 'fulfilled' ? validForecast(forecastRes.value) : null;
    if (!pv && !forecast) throw new Error('Záložné zdroje nedostupné');
    return { pv, forecast, source: 'legacy' };
}

/**
 * Vráti dáta z prvého zdroja, ktorý funguje. Pri úplnom zlyhaní vráti prázdny výsledok,
 * nikdy nehádže - appka ukáže "dáta nedostupné".
 * @param {typeof fetch} [fetchImpl] @returns {Promise<DataResult>}
 */
export async function loadData(fetchImpl = fetch) {
    try {
        return await fromWorker(fetchImpl);
    } catch {
        try {
            return await fromLegacy(fetchImpl);
        } catch {
            return { pv: null, forecast: null, source: null };
        }
    }
}
