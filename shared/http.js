// Spoločný retry pre sieťové volania (Worker). Jeden prechodný výpadok nemá zhodiť celý beh.

/**
 * @param {string} url @param {RequestInit} [options]
 * @param {{ attempts?: number, delayMs?: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export async function fetchWithRetry(url, options = {}, opts = {}) {
    const { attempts = 3, delayMs = 2000, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
    /** @type {unknown} */ let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetchImpl(url, options);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) await sleep(delayMs * 2 ** i);
        }
    }
    throw lastErr;
}
