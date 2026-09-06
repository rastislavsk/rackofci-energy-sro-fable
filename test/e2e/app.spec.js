// E2E: appka s pevným časom a dátami z fixtures. Očakávané texty sa počítajú tou istou
// doménovou logikou (shared/), takže test chytí rozdiel medzi modelom a tým, čo je v DOM.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { APP_URL, LEGACY_SOURCES, WORKER_URL } from '../../shared/config.js';
import { heroModel } from '../../shared/hero-model.js';
import { FIXED_NOW, fixtureData } from '../helpers.js';

const { pv, forecast } = fixtureData();

// Testy bežia bez siete: externé zdroje (fonty, QR knižnica) sa odpovedia prázdnym telom,
// zdroje dát podľa scenára. Zlyhanie zámerne zablokovaného zdroja nie je chyba appky,
// preto sa z konzoly zbierajú len skutočné výnimky a chyby, nie hlásenia o nenačítaní zdroja.
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;

/** @param {import('@playwright/test').Page} page @param {{ time?: Date, workerDown?: boolean, forecastOverride?: typeof forecast }} [opts] */
async function openApp(page, { time = FIXED_NOW, workerDown = false, forecastOverride = forecast } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/, (route) =>
        route.fulfill({ status: 200, body: '', contentType: 'text/plain' }),
    );
    await page.route(WORKER_URL, (route) =>
        workerDown ? route.abort() : route.fulfill({ json: { pv, forecast: forecastOverride, servedAt: time.toISOString() } }),
    );
    await page.route(LEGACY_SOURCES.pv, (route) => route.abort());
    await page.route(LEGACY_SOURCES.forecast, (route) => route.abort());
    await page.clock.setFixedTime(time);
    await page.goto('/');
    await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
    return errors;
}

/**
 * Prehliadač beží v Europe/Bratislava, testovací proces v ľubovoľnej zóne. Preto sa pre
 * prehliadač používa presný okamih (`instant`) a pre model dátum s rovnakým nástenným časom
 * v zóne procesu (`wall`) - výsledok tak nezávisí od toho, kde sa testy spustia.
 * @param {string} hm
 */
function atTime(hm) {
    const [h, m] = hm.split(':').map(Number);
    return { instant: new Date(`2026-09-05T${hm}:00+02:00`), wall: new Date(2026, 8, 5, h, m, 0, 0) };
}

/** @param {Date} wall */
const modelAt = (wall) => heroModel({ now: wall, season: 'summer', pv, forecast, previewMinutes: null });

test('hlavná karta o 13:00 zodpovedá modelu', async ({ page }) => {
    const errors = await openApp(page);
    const expected = modelAt(atTime('13:00').wall);
    await expect(page.locator('#current-time-display')).toHaveText('13:00');
    await expect(page.locator('#verdict-headline')).toHaveText(expected.message.headline);
    await expect(page.locator('#verdict-body')).toHaveText(expected.message.body);
    await expect(page.locator('#verdict-eyebrow')).toHaveText(expected.eyebrow);
    await expect(page.locator('#pv-power')).toHaveText('6.41');
    await expect(page.locator('#verdict-go-row .go-chip')).toHaveCount(5);
    await expect(page.locator('#pv-updated')).toContainText('aktualizované 13:00');
    // Spotrebiče sú druhá stránka vždy - bodky sú vidno, no tretia (Lepšie bude) nie je.
    await expect(page.locator('#verdict-dots')).toBeVisible();
    await expect(page.locator('#verdict-dot-wait')).toBeHidden();
    await expect(page.locator('#verdict-page-wait')).toBeHidden();
    expect(errors).toEqual([]);
});

test('klik na spotrebič (mobil) ukáže tooltip s príkonom, nie je orezaný pagerom', async ({ page }) => {
    await openApp(page);
    const chip = page.locator('#verdict-go-row .go-chip').first();
    const tooltip = page.locator('#verdict-chip-tooltip');
    await expect(tooltip).not.toHaveClass(/visible/);
    await chip.click();
    await expect(tooltip).toHaveClass(/visible/);
    await expect(tooltip).toHaveText(await chip.getAttribute('data-power'));
    await expect(tooltip).toBeInViewport();
    // Druhý klik na ten istý chip tooltip zavrie.
    await chip.click();
    await expect(tooltip).not.toHaveClass(/visible/);
});

test('verdikt sa listuje do strán: teraz, spotrebiče, kedy bude lepšie', async ({ page }) => {
    const { instant, wall } = atTime('09:00');
    // Fixtures nemajú pred sebou silnejšie okno, bez tejto úpravy by čakací čas nikdy nevznikol.
    const sunnier = { ...forecast, strongerWindowAhead: true, hoursAhead: 3, windowDaypart: 'poobede' };
    const errors = await openApp(page, { time: instant, forecastOverride: sunnier });
    const expected = heroModel({ now: wall, season: 'summer', pv, forecast: sunnier, previewMinutes: null });

    const dots = page.locator('#verdict-dots .pager-dot');
    await expect(page.locator('#verdict-dots')).toBeVisible();
    await expect(dots.nth(2)).toBeVisible();
    await expect(page.locator('#verdict-wait-time')).toHaveText(String(expected.waitTime));
    await expect(page.locator('#verdict-headline')).toHaveText(expected.message.headline);
    await expect(page.locator('#verdict-pager')).toHaveAttribute('tabindex', '0');
    await expect(dots.nth(0)).toHaveClass(/active/);

    // Posun do strán nad pásom = to isté gesto ako prst; stránku dopočíta scroll-snap.
    const pager = page.locator('#verdict-pager');
    await pager.hover();
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.nth(0)).not.toHaveClass(/active/);
    await expect(page.locator('#verdict-go-row .go-chip')).toHaveCount(5);
    await expect(page.locator('#verdict-go-row')).toBeInViewport();

    // Ešte jeden posun na tretiu stránku "Lepšie bude".
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(2)).toHaveClass(/active/);
    await expect(page.locator('#verdict-wait-chip')).toBeInViewport();

    // Bodka posunie pás späť na prvú stránku.
    await dots.nth(0).click();
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(pager).toHaveJSProperty('scrollLeft', 0);

    // Posuvná oblasť bez prístupu z klávesnice je vážny nález axe - preto sa kontroluje tu.
    const results = await new AxeBuilder({ page }).include('#panel-spotrebice').analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => v.id)).toEqual([]);
    expect(errors).toEqual([]);
});

for (const [hm, label] of [
    ['08:00', 'drahý slot'],
    ['19:30', 'lacný podvečer'],
    ['02:00', 'noc'],
]) {
    test(`verdikt o ${hm} (${label}) sedí s modelom`, async ({ page }) => {
        const { instant, wall } = atTime(hm);
        const errors = await openApp(page, { time: instant });
        const expected = modelAt(wall);
        await expect(page.locator('#verdict-headline')).toHaveText(expected.message.headline);
        await expect(page.locator('#verdict-eyebrow')).toHaveText(expected.eyebrow);
        expect(errors).toEqual([]);
    });
}

test('náhľad iného času klikom na pás a návrat na teraz', async ({ page }) => {
    await openApp(page);
    const strip = page.locator('#daystrip');
    const box = await strip.boundingBox();
    if (!box) throw new Error('pás dňa nemá rozmer');
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
    await expect(page.locator('#preview-banner')).toBeVisible();
    // Štvrtina šírky pásu je 06:00; presná minúta závisí od zaokrúhlenia pixelov.
    await expect(page.locator('#preview-time-label')).toHaveText(/^Náhľad · 0[56]:\d{2}$/);
    await expect(page.locator('#pv-power-unit')).toContainText('kW (');
    await page.locator('#preview-reset').click();
    await expect(page.locator('#preview-banner')).toBeHidden();
    await expect(page.locator('#pv-power-unit')).toHaveText('kW teraz');
});

test('predpoveď: štatistiky, prepnutie na zajtra, správa dňa', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-predpoved').click();
    await expect(page.locator('#panel-predpoved')).toBeVisible();
    await expect(page.locator('#forecast-peak')).toHaveText(
        String(Math.max(...forecast.hourlyToday.filter((p) => p.hour >= 6 && p.hour <= 21).map((p) => p.kw)).toFixed(1)),
    );
    await expect(page.locator('#forecast-peak-real-col')).toBeVisible();
    await expect(page.locator('#forecast-chart path.line-real')).toHaveCount(1);
    await page.locator('#day-btn-tomorrow').click();
    await expect(page.locator('#forecast-now-badge')).toBeHidden();
    await expect(page.locator('#forecast-chart path.line-real')).toHaveCount(0);
    await expect(page.locator('#forecast-message-title')).not.toHaveText('Načítavam…');
    expect(errors).toEqual([]);
});

test('7 dní: tabuľka, výber dňa naprieč komponentmi', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-tbody tr')).toHaveCount(7);
    await expect(page.locator('#week-today')).toHaveText(forecast.days[0].kwhTotal.toFixed(1).replace('.', ','));
    await page.locator('#week-day-tabs [data-day-index="3"]').click();
    await expect(page.locator('#week-day-tabs .utab.active')).toHaveAttribute('data-day-index', '3');
    await expect(page.locator('#week-tbody tr.sel')).toHaveAttribute('data-day-index', '3');
    await expect(page.locator('#week-bars rect.bar.sel')).toHaveCount(1);
    await page.locator('#week-tbody tr[data-day-index="5"]').click();
    await expect(page.locator('#week-day-tabs .utab.active')).toHaveAttribute('data-day-index', '5');
    await expect(page.locator('#week-msg-title')).toContainText('Najsilnejší deň');
    expect(errors).toEqual([]);
});

test('zdieľať: odkaz na appku', async ({ page }) => {
    await openApp(page);
    await page.locator('#nav-zdielat').click();
    await expect(page.locator('#share-url')).toHaveText(APP_URL);
    await expect(page.locator('#share-whatsapp')).toHaveAttribute('href', /wa\.me/);
});

test('bez dát: appka neukáže chybu, iba stav "dáta nedostupné"', async ({ page }) => {
    const errors = await openApp(page, { workerDown: true });
    await expect(page.locator('#pv-updated')).toHaveText('dáta nedostupné');
    await expect(page.locator('#pv-power')).toHaveText('–');
    await expect(page.locator('#verdict-headline')).not.toHaveText('Načítavam…');
    await page.locator('#nav-predpoved').click();
    await expect(page.locator('#forecast-message-title')).toHaveText('Predpoveď sa pripravuje');
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-msg-title')).toHaveText('Predpoveď sa pripravuje');
    expect(errors).toEqual([]);
});

test('prístupnosť: žiadne závažné nálezy axe na žiadnej karte', async ({ page }) => {
    await openApp(page);
    for (const panel of ['spotrebice', 'predpoved', '7dni', 'zdielat']) {
        await page.locator(`#nav-${panel}`).click();
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
});

test('široká obrazovka: Spotrebiče a Predpoveď vedľa seba', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await expect(page.locator('#panel-spotrebice')).toBeVisible();
    await expect(page.locator('#panel-predpoved')).toBeVisible();
    await expect(page.locator('#forecast-chart')).toHaveAttribute('viewBox', '0 0 680 420');
    expect(errors).toEqual([]);
});

test('široká obrazovka: prepnutie na 7 dní skryje kartu Spotrebiče', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#panel-7dni')).toBeVisible();
    await expect(page.locator('#panel-spotrebice')).toBeHidden();
    await expect(page.locator('#panel-predpoved')).toBeHidden();
    await page.locator('#nav-zdielat').click();
    await expect(page.locator('#panel-spotrebice')).toBeHidden();
    expect(errors).toEqual([]);
});
