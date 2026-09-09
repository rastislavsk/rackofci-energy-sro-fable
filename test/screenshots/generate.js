// Obrázky kariet do README. Dáta sú tie isté fixtures a ten istý pevný čas ako v testoch,
// takže sa obrázky pri opakovanom spustení nemenia bez zmeny appky. Spusti: npm run screenshots
//
// Prehliadač berie skript ten, ktorý má nainštalovaný Playwright. Keď treba iný (napr. keď
// je v systéme len staršia verzia), dá sa podstrčiť cez CHROMIUM_PATH=/cesta/k/chromium.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { LEGACY_SOURCES, WORKER_URL } from '../../shared/config.js';
import { FIXED_NOW, fixtureData } from '../helpers.js';

const PORT = 8123;
const SIRKA = 390;
const VYSKA = 844;
// Karta Zdieľať tu zámerne nie je: jej QR kód kreslí knižnica z CDN, takže bez prístupu
// naň by z nej bol prázdny biely rámik. Je to aj tak len QR kód a odkaz.
const KARTY = [
    { subor: 'terazky.png', nav: 'nav-terazky' },
    { subor: 'dnes-zajtra.png', nav: 'nav-predpoved' },
    { subor: '7dni.png', nav: 'nav-7dni' },
];

/** Počká, kým server odpovie, aby sa prvý pokus o snímku netrafil do prázdna. */
async function pockajNaServer(url, pokusy = 40) {
    for (let i = 0; i < pokusy; i++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            /* server ešte nebeží */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Server na ${url} nenaskočil`);
}

const server = spawn('npx', ['http-server', '-p', String(PORT), '-c-1', '-s', '.'], { stdio: 'ignore' });
try {
    const url = `http://127.0.0.1:${PORT}/`;
    await pockajNaServer(url);
    const { pv, forecast } = fixtureData();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: SIRKA, height: VYSKA }, locale: 'sk-SK', timezoneId: 'Europe/Bratislava' });
    // Živé zdroje sa nahradia fixtures, zvyšok (písma) sa načíta ako v appke.
    await page.route(WORKER_URL, (r) => r.fulfill({ json: { pv, forecast, servedAt: FIXED_NOW.toISOString() } }));
    await page.route(LEGACY_SOURCES.pv, (r) => r.abort());
    await page.route(LEGACY_SOURCES.forecast, (r) => r.abort());
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(url);
    await page.locator('#pv-updated').filter({ hasNotText: 'načítavam…' }).waitFor();

    for (const { subor, nav } of KARTY) {
        await page.locator(`#${nav}`).click();
        // Písma z CDN a prvé prekreslenie po prepnutí karty.
        await page.waitForTimeout(400);
        await page.screenshot({ path: new URL(`../../docs/img/${subor}`, import.meta.url).pathname });
        console.log(`hotovo: docs/img/${subor}`);
    }
    await browser.close();
} finally {
    server.kill();
}
