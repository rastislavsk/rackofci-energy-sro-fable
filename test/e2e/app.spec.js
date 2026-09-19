// E2E: appka s pevným časom a dátami z fixtures. Očakávané texty sa počítajú tou istou
// doménovou logikou (shared/), takže test chytí rozdiel medzi modelom a tým, čo je v DOM.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ringPercent, usePct, visibleHours, weekDayTiers, weekListModel, WEEK_HOURS } from '../../shared/chart-model.js';
import { LEGACY_SOURCES, PREVIEW, SWIPE, TOOLTIP_FADE_MS, TOOLTIP_HOLD_MS, WEEK_MSG_MIN_H, WORKER_URL } from '../../shared/config.js';
import { heroModel } from '../../shared/hero-model.js';
import { fmt1, hourLabel, weekDayLong } from '../../shared/format.js';
import { useTier } from '../../web/render/sedemdni.js';
import { dayDetailMessage, forecastDayMessage, weekMessage } from '../../shared/messages.js';
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

const todayForecastMsg = forecastDayMessage(visibleHours(forecast.hourlyToday), true);

/** Nástenný čas FIXED_NOW v zóne prehliadača, nie procesu - z rovnakého dôvodu, aký
 * popisuje atTime nižšie. Testy ho potrebujú v oboch podobách: ako text v ciferníku
 * a ako minútu dňa pre polohu na prstenci. */
const APP_NOW = (() => {
    const hm = FIXED_NOW.toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Bratislava',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const [h, m] = hm.split(':').map(Number);
    return { hm, minutes: h * 60 + m };
})();

test('hlavná karta o 13:00 zodpovedá modelu', async ({ page }) => {
    const errors = await openApp(page);
    const expected = modelAt(atTime('13:00').wall);
    await expect(page.locator('#current-time-display')).toHaveText('13:00');
    await expect(page.locator('#verdict-headline')).toHaveText(expected.message.headline);
    await expect(page.locator('#verdict-body')).toHaveText(expected.message.body);
    await expect(page.locator('#pv-power')).toHaveText('6.41');
    await expect(page.locator('#verdict-go-row .go-chip')).toHaveCount(5);
    await expect(page.locator('#pv-updated')).toContainText('aktualizované 13:00');
    // Teraz, Spotrebiče a Predpoveď dňa sú tam vždy - bodky sú vidno, no štvrtá
    // (Lepšie bude) nie je.
    await expect(page.locator('#verdict-dots .pager-dot')).toHaveCount(4);
    await expect(page.locator('#verdict-dots')).toBeVisible();
    await expect(page.locator('#verdict-dot-wait')).toBeHidden();
    await expect(page.locator('#verdict-page-wait')).toBeHidden();
    // Defaultne otvorená prvá stránka je "Čo robiť teraz".
    const dots = page.locator('#verdict-dots .pager-dot');
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-headline')).toBeInViewport();
    // Odznak s tarifou zanikol - nie je nad ciferníkom ani v pageri.
    await expect(page.locator('#verdict-page-eyebrow')).toHaveCount(0);
    await expect(page.locator('#panel-terazky')).not.toContainText('Suntime');
    // Správa o predpovedi dňa žije už len tu, v pageri.
    await expect(page.locator('#verdict-forecast-title')).toHaveText(todayForecastMsg.title);
    await expect(page.locator('#verdict-forecast-body')).toHaveText(todayForecastMsg.body);
    // Zelené okno prefarbí pozadie celej stránky dozelena.
    await expect(page.locator('html')).toHaveAttribute('data-tier', 'green');
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

test('verdikt sa listuje do strán: teraz (defaultne prvá), spotrebiče, predpoveď dňa, kedy bude lepšie', async ({ page }) => {
    const { instant, wall } = atTime('09:00');
    // Fixtures nemajú pred sebou silnejšie okno, bez tejto úpravy by čakací čas nikdy nevznikol.
    const sunnier = { ...forecast, strongerWindowAhead: true, hoursAhead: 3, windowDaypart: 'poobede' };
    const errors = await openApp(page, { time: instant, forecastOverride: sunnier });
    const expected = heroModel({ now: wall, season: 'summer', pv, forecast: sunnier, previewMinutes: null });

    const dots = page.locator('#verdict-dots .pager-dot');
    await expect(page.locator('#verdict-dots')).toBeVisible();
    await expect(dots.nth(3)).toBeVisible();
    await expect(page.locator('#verdict-wait-time')).toHaveText(String(expected.waitTime));
    await expect(page.locator('#verdict-pager')).toHaveAttribute('tabindex', '0');
    // Defaultne otvorená prvá stránka je "Čo robiť teraz".
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-headline')).toHaveText(expected.message.headline);
    await expect(page.locator('#verdict-headline')).toBeInViewport();

    // Posun do strán nad pásom = to isté gesto ako prst; stránku dopočíta scroll-snap.
    const pager = page.locator('#verdict-pager');
    await pager.hover();
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.nth(0)).not.toHaveClass(/active/);
    await expect(page.locator('#verdict-go-row .go-chip')).toHaveCount(5);
    await expect(page.locator('#verdict-go-row')).toBeInViewport();

    // Ešte jeden posun na tretiu stránku "Predpoveď dňa".
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(2)).toHaveClass(/active/);
    await expect(page.locator('#verdict-forecast-title')).toHaveText(todayForecastMsg.title);
    await expect(page.locator('#verdict-page-forecast')).toBeInViewport();

    // Posledný posun na štvrtú stránku "Lepšie bude".
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(3)).toHaveClass(/active/);
    await expect(page.locator('#verdict-wait-chip')).toBeInViewport();

    // Poradie má koniec: posun za poslednú stránku sa nezacyklí, ostáva na nej.
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(3)).toHaveClass(/active/);
    await expect(page.locator('#verdict-wait-chip')).toBeInViewport();

    // Bodka posunie pás späť na prvú stránku.
    await dots.nth(0).click();
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-headline')).toBeInViewport();

    // A ten istý koniec na druhej strane: z prvej stránky sa naspäť nedá.
    await page.mouse.wheel(-400, 0);
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-headline')).toBeInViewport();

    // Posuvná oblasť bez prístupu z klávesnice je vážny nález axe - preto sa kontroluje tu.
    const results = await new AxeBuilder({ page }).include('#panel-terazky').analyze();
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
        // Pozadie stránky drží farbu tarifného okna. Tieto tri časy pokryjú všetky tri
        // farby (08:00 červená, 19:30 aj 02:00 oranžová), 13:00 zelenú v teste vyššie.
        await expect(page.locator('html')).toHaveAttribute('data-tier', expected.tier || '');
        expect(errors).toEqual([]);
    });
}

for (const [hm, label] of [
    ['13:00', 'zelená'],
    ['08:00', 'červená'],
    ['02:00', 'oranžová'],
]) {
    test(`podsvietenie ikony aktívnej karty má rovnakú farbu ako stavová bodka (${hm}, ${label})`, async ({ page }) => {
        const { instant, wall } = atTime(hm);
        await openApp(page, { time: instant });
        await expect(page.locator('html')).toHaveAttribute('data-accent', modelAt(wall).accent || '');
        const dot = await page.locator('.appbar-clock .live-dot').evaluate((el) => getComputedStyle(el).backgroundColor);
        const glow = await page.locator('.nav-item.active').evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
        expect(dot).toMatch(/^rgb\(/);
        expect(glow).toBe(dot);
    });
}

/** Bod na dennom prstenci ciferníka pre danú minútu dňa - ten istý výpočet, aký appka
 * používa na umiestnenie jazdca. @param {{x: number, y: number, width: number, height: number}} box @param {number} minutes */
function ringXY(box, minutes) {
    const { left, top } = ringPercent(minutes);
    return { x: box.x + (box.width * left) / 100, y: box.y + (box.height * top) / 100 };
}

test('náhľad iného času ťuknutím na prstenec a návrat na teraz', async ({ page }) => {
    await openApp(page);
    const box = await page.locator('#dial-wrap').boundingBox();
    if (!box) throw new Error('ciferník nemá rozmer');
    const six = ringXY(box, 6 * 60);
    await page.mouse.click(six.x, six.y);
    await expect(page.locator('#dial-grip')).not.toHaveClass(/at-now/);
    // Presná minúta závisí od zaokrúhlenia pixelov, preto rozsah okolo 06:00.
    await expect(page.locator('#dial-when')).toHaveText(/^0[56]:\d{2}$/);
    await expect(page.locator('#pv-power-unit')).toContainText('kW (');
    await expect(page.locator('#preview-reset')).toBeVisible();
    // Pozadie sleduje bežca: o 06:00 beží lacný nočný prúd, teda oranžová namiesto zelenej.
    await expect(page.locator('html')).toHaveAttribute('data-tier', 'amber');
    await page.locator('#preview-reset').click();
    await expect(page.locator('#dial-grip')).toHaveClass(/at-now/);
    await expect(page.locator('#preview-reset')).toBeHidden();
    await expect(page.locator('#pv-power-unit')).toHaveText('kW teraz');
    await expect(page.locator('#dial-when')).toHaveText(APP_NOW.hm);
    // Zrušenie náhľadu vráti pozadie do farby okna, ktoré beží teraz.
    await expect(page.locator('html')).toHaveAttribute('data-tier', 'green');
});

test('ťahanie jazdca: denný prstenec sa nemení, dotiahnutie na "teraz" náhľad zruší', async ({ page }) => {
    const errors = await openApp(page);
    const box = await page.locator('#dial-wrap').boundingBox();
    if (!box) throw new Error('ciferník nemá rozmer');
    const ring = page.locator('#day-ring');

    // Denný prstenec závisí len na sezóne - ťahanie jazdca ním nesmie pohnúť.
    await page.mouse.click(ringXY(box, 6 * 60).x, ringXY(box, 6 * 60).y);
    const beforeDrag = await ring.innerHTML();

    // Ťahanie musí začať na samotnom jazdci - poslucháče sedia na ňom, nie na ciferníku.
    const grip = await page.locator('#dial-grip').boundingBox();
    if (!grip) throw new Error('jazdec nemá rozmer');
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    for (const m of [8 * 60, 10 * 60, 12 * 60, 14 * 60]) {
        const p = ringXY(box, m);
        await page.mouse.move(p.x, p.y);
    }
    await page.mouse.up();
    await expect(page.locator('#dial-when')).toHaveText(/^1[34]:\d{2}$/);
    expect(await ring.innerHTML()).toBe(beforeDrag);

    // Dotiahnutie jazdca na značku "teraz" je skratka späť do živého stavu.
    const grip2 = await page.locator('#dial-grip').boundingBox();
    if (!grip2) throw new Error('jazdec nemá rozmer');
    await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + grip2.height / 2);
    await page.mouse.down();
    const now = ringXY(box, APP_NOW.minutes);
    await page.mouse.move(now.x, now.y);
    await page.mouse.up();
    await expect(page.locator('#dial-grip')).toHaveClass(/at-now/);
    await expect(page.locator('#pv-power-unit')).toHaveText('kW teraz');
    expect(errors).toEqual([]);
});

test('náhľad času sa dá celý ovládať z klávesnice, nielen prstom', async ({ page }) => {
    await openApp(page);
    const grip = page.locator('#dial-grip');

    // V pokoji je jazdec značkou "teraz" - ale ostáva tlačidlom, takže sa naň dá prejsť
    // tabulátorom. Bez toho by sa k náhľadu času z klávesnice nedalo dostať vôbec.
    await expect(grip).toBeVisible();
    await expect(grip).toHaveClass(/at-now/);
    await expect(grip).toHaveAttribute('aria-valuetext', `Teraz ${APP_NOW.hm}`);
    await grip.focus();
    await expect(grip).toBeFocused();

    // Šípka náhľad rovno otvorí, od aktuálneho času.
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await grip.getAttribute('aria-valuenow'))).toBe(APP_NOW.minutes + PREVIEW.keyStepMin);
    await expect(grip).not.toHaveClass(/at-now/);
    await expect(page.locator('#pv-power-unit')).toContainText('kW (');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Number(await grip.getAttribute('aria-valuenow'))).toBe(APP_NOW.minutes);
    // Popis pre čítačku obrazovky musí sedieť s tým, čo je v ciferníku napísané.
    await expect(grip).toHaveAttribute('aria-valuetext', `Náhľad ${await page.locator('#dial-when').textContent()}`);

    // Esc sa vráti do živého stavu, Enter náhľad zase otvorí.
    await page.keyboard.press('Escape');
    await expect(page.locator('#pv-power-unit')).toHaveText('kW teraz');
    await expect(grip).toHaveClass(/at-now/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#pv-power-unit')).toContainText('kW (');
});

test('pri nulovej výrobe neostane na prstenci bodka', async ({ page }) => {
    await openApp(page);
    const box = await page.locator('#dial-wrap').boundingBox();
    if (!box) throw new Error('ciferník nemá rozmer');
    const ring = page.locator('#dial-ring');

    // Cez deň oblúk niečo ukazuje a guľatý koniec je v poriadku.
    await expect(ring).not.toHaveClass(/empty/);

    // V noci panely nedávajú nič. Guľatý koniec by aj z nulového oblúka nakreslil bodku,
    // preto sa na ten čas zrovná - inak by prstenec tvrdil, že sa niečo vyrába.
    const noc = ringXY(box, 2 * 60);
    await page.mouse.click(noc.x, noc.y);
    await expect(page.locator('#pv-power')).toHaveText('0.00');
    await expect(ring).toHaveClass(/empty/);
    await expect(ring).toHaveCSS('stroke-linecap', 'butt');
});

/** Poradie viditeľných blokov karty 7 dní zhora nadol - tak, ako ich vidí používateľ
 * (CSS `order` mení poradie oproti HTML). @param {import('@playwright/test').Page} page */
function viditelneBloky(page) {
    return page.evaluate(() =>
        [...document.querySelectorAll('#panel-7dni .week-block')]
            .filter((b) => b.getBoundingClientRect().height > 0)
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
            .map((b) => b.id),
    );
}

/**
 * Karta 7 dní je na mobile rozdelená na dve obrazovky: prehľad (rebríček dní) a detail dňa,
 * ktorý sa otvorí klikom na riadok rebríčka. V detaile ide Denná výroba, Priebeh výroby
 * a až potom Heatmapa so zvýrazneným dňom.
 *
 * Prehľad je na mobile rebríček, nie bubliny s tabuľkou - tie patria širokej obrazovke.
 * Údaje, ktoré z neho odišli (využitie, špička), sú o ťuknutie ďalej v detaile dňa.
 */
test('7 dní na mobile: prehľad dní, detail dňa a návrat späť', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    // Prehľad: rebríček so siedmimi dňami, grafy sú až v detaile.
    await expect(page.locator('#week-list .wday')).toHaveCount(7);
    await expect(page.locator('#week-list-total')).toHaveText(String(Math.round(forecast.days.reduce((a, d) => a + d.kwhTotal, 0))));
    // Bubliny a tabuľka na mobile nie sú vôbec - prehľad je práve jeden.
    await expect(page.locator('#week-trio')).toBeHidden();
    await expect(page.locator('#week-block-table')).toBeHidden();
    // Správa je v prehľade len na dosť vysokom okne (WEEK_MSG_MIN_H). Predvolené plátno
    // testov je nižšie, takže tu ostáva skrytá; obe strany hranice preveruje vlastná skupina nižšie.
    await expect(page.locator('#week-msg-block')).toBeHidden();
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-list']);

    // Dĺžka pásika je výroba dňa voči najsilnejšiemu dňu - očakávanie sa počíta tou istou
    // funkciou ako v appke, takže test chytí rozdiel medzi modelom a tým, čo je v DOM.
    for (const r of weekListModel(forecast.days, 0))
        await expect(page.locator(`#week-list [data-day-index="${r.dayIndex}"] .wday-bar i`)).toHaveAttribute(
            'style',
            `width:${r.barPct}%`,
        );

    // Pásmo dňa (farba heatmapy) nesie pásik aj číslo. Očakávanie sa počíta tou istou
    // funkciou ako v appke, takže test chytí rozdiel medzi mierkou modelu a farbou v DOM.
    for (const [i, tier] of weekDayTiers(forecast.days).entries()) {
        const riadok = page.locator(`#week-list [data-day-index="${i}"]`);
        await expect(riadok.locator('.wday-bar i')).toHaveClass(tier ? `tier-${tier}` : '');
        await expect(riadok.locator('.wday-kwh')).toHaveClass(tier ? `wday-kwh tier-${tier}` : 'wday-kwh');
    }

    // Klik na deň otvorí jeho detail: priebeh toho dňa a jeho riadok z heatmapy.
    await page.locator('#week-list [data-day-index="5"]').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[5].date, 5));
    await expect(page.locator('#week-block-list')).toBeHidden();
    await expect(page.locator('#week-day-tabs')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-curve', 'week-block-heat']);

    // Oba ukazujú ten istý deň: jeho krivka a jediný riadok mapy, ktorý mu patrí, a pod nimi
    // správa o tom dni - očakávanie sa počíta tou istou funkciou ako v appke.
    await expect(page.locator('#week-msg-title')).toHaveText(dayDetailMessage(visibleHours(forecast.days[5].hourly)).title);
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(forecast.days[5].kwhTotal)} kWh`);
    // Jediný riadok mapy patrí vybranému dňu; skratka dňa v ňom nie je, deň hovorí hlavička.
    await expect(page.locator('#week-heat .day-label')).toHaveCount(0);
    await expect(page.locator('#week-heat .heat-cell:not([data-day-index="5"])')).toHaveCount(0);
    await expect(page.locator('#week-heat .heat-cell')).toHaveCount(WEEK_HOURS.length);

    // Z detailu vedie späť jedine šípka vľavo hore. Atribút data-panel nesie aj #page, takže
    // klik kdekoľvek v stránke sa kedysi tváril ako prepnutie karty a detail zavrel.
    await page.locator('#week-curve-stat').click();
    await page.locator('#week-block-heat .chart-top').click();
    await expect(page.locator('#week-day-head')).toBeVisible();
    expect(await viditelneBloky(page)).toEqual(['week-block-curve', 'week-block-heat']);

    // Späť sa vraciame na prehľad, výber dňa v ňom ostáva.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    await expect(page.locator('#week-list .wday.sel')).toHaveAttribute('data-day-index', '5');
    expect(await viditelneBloky(page)).toEqual(['week-block-list']);

    // Odchod na inú kartu a návrat začína zase na prehľade.
    await page.locator('#nav-terazky').click();
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(errors).toEqual([]);
});

/**
 * Dnes a Zajtra sú v rebríčku prvé dva riadky a majú robiť presne to, čo ktorýkoľvek iný
 * deň - meno navrchu ich nerobí výnimkou. Kým to boli bubliny nad tabuľkou, bola to druhá
 * cesta do detailu; teraz je jedna.
 */
test('7 dní na mobile: riadky Dnes a Zajtra otvárajú detail toho dňa', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    await page.locator('#week-list [data-day-index="0"]').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[0].date, 0));
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(forecast.days[0].kwhTotal)} kWh`);
    await page.locator('#week-day-back').click();

    await page.locator('#week-list [data-day-index="1"]').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[1].date, 1));
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(forecast.days[1].kwhTotal)} kWh`);
    // Výber sa prenáša do celej karty rovnako ako z ktoréhokoľvek iného riadka.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-list .wday.sel')).toHaveAttribute('data-day-index', '1');

    expect(errors).toEqual([]);
});

/**
 * Bublina so súčtom ("Spolu za 7 dní") nepatrí k dňu, ale k celému týždňu - otvára preto
 * detail týždňa: dennú výrobu a mapu výroby, bez krivky jedného dňa. Je to tá istá cesta,
 * akou na širokej obrazovke vedie bublina "7 dní spolu".
 */
test('7 dní na mobile: bublina so súčtom otvára detail týždňa', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await page.locator('.week-list-hero').click();

    await expect(page.locator('#week-day-title')).toHaveText('Celý týždeň');
    expect(await viditelneBloky(page)).toEqual(['week-block-bars', 'week-block-heat']);
    // Mapa ukazuje celý týždeň, nie jeden riadok, a pod ňou je správa o najsilnejšom dni.
    await expect(page.locator('#week-heat .day-label')).toHaveCount(7);
    await expect(page.locator('#week-msg-title')).toContainText('Najsilnejší deň');
    await expect(page.locator('#week-bars-stat')).toContainText(`${fmt1(forecast.days.reduce((a, d) => a + d.kwhTotal, 0))} kWh`);

    // Späť vedie na prehľad dní rovnako ako z detailu dňa.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-list']);
    expect(errors).toEqual([]);
});

/**
 * Priebeh výroby na karte 7 dní ukazuje dnešok rovnako ako graf na karte Dnes-Zajtra:
 * nameraná krivka a položka v legende. Iný deň nameraný nie je, takže z neho musí
 * zmiznúť aj krivka, aj legenda.
 */
test('7 dní: priebeh dnešného dňa ukazuje nameranú výrobu', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await page.locator('#week-list [data-day-index="0"]').click();
    await expect(page.locator('#week-curve path.line-real')).toHaveCount(1);
    await expect(page.locator('#week-curve circle.dot-real')).toHaveCount(1);
    await expect(page.locator('#week-curve-live-legend')).toBeVisible();

    await page.locator('#week-day-back').click();
    await page.locator('#week-list [data-day-index="3"]').click();
    await expect(page.locator('#week-curve path.line-real')).toHaveCount(0);
    await expect(page.locator('#week-curve-live-legend')).toBeHidden();
    expect(errors).toEqual([]);
});

/**
 * Správa týždňa pod rebríčkom dní je vec miesta, nie obsahu: ukáže sa len vtedy, keď sa celý
 * prehľad aj s ňou zmestí na obrazovku. Hranicu drží WEEK_MSG_MIN_H a testujú sa obe jej strany -
 * v oboch prípadoch musí platiť to hlavné, že prehľad nescrolluje.
 */
test.describe('správa týždňa v prehľade dní', () => {
    /** @param {import('@playwright/test').Page} page */
    const scrollujeSa = (page) => page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight);

    test('na vysokom okne je správa vidno a prehľad sa nescrolluje', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H + 40 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-msg-block')).toBeVisible();
        await expect(page.locator('#week-msg-title')).toHaveText(weekMessage(forecast.days).title);
        expect(await scrollujeSa(page)).toBe(false);
        expect(errors).toEqual([]);
    });

    test('na nízkom okne správa nie je a prehľad sa nescrolluje', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H - 40 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-msg-block')).toBeHidden();
        expect(await scrollujeSa(page)).toBe(false);
        // V detaile dňa správa patrí k obsahu, nie k miestu - tam je aj na nízkom okne.
        await page.locator('#week-list [data-day-index="2"]').click();
        await expect(page.locator('#week-msg-block')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('zmenšenie okna správu odoberie, zväčšenie vráti', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H + 40 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-msg-block')).toBeVisible();
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H - 40 });
        await expect(page.locator('#week-msg-block')).toBeHidden();
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H + 40 });
        await expect(page.locator('#week-msg-block')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

/** Na širokej obrazovke je na celú kartu miesto naraz - detail dňa sa tam neotvára a klik
 * v tabuľke, v prepínači dní aj v grafoch len prepína vybraný deň, ako doteraz. */
test('7 dní na desktope: karta ostáva celá, výber dňa naprieč komponentmi', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    // Tabuľka je len tu - na mobile ju nahradil rebríček, takže odtieň percenta využitia
    // patrí do desktopového testu. Očakávanie sa počíta tou istou funkciou ako v appke.
    // Štvrtý stĺpec tabuľky je Využitie.
    for (const [i, day] of forecast.days.entries())
        await expect(page.locator(`#week-tbody tr[data-day-index="${i}"] td:nth-child(4)`)).toHaveClass(`mid${useTier(usePct(day))}`);

    // Druhý stĺpec tabuľky je Výroba - nesie to isté pásmo dňa ako stĺpce grafu vedľa nej.
    for (const [i, tier] of weekDayTiers(forecast.days).entries()) {
        await expect(page.locator(`#week-tbody tr[data-day-index="${i}"] td:nth-child(2)`)).toHaveClass(tier ? `tier-${tier}` : '');
        await expect(page.locator('#week-bars rect.bar').nth(i)).toHaveClass(tier ? new RegExp(`\\btier-${tier}\\b`) : /^bar$/);
    }

    await page.locator('#week-day-tabs [data-day-index="3"]').click();
    await expect(page.locator('#week-day-tabs .utab.active')).toHaveAttribute('data-day-index', '3');
    await expect(page.locator('#week-tbody tr.sel')).toHaveAttribute('data-day-index', '3');
    await expect(page.locator('#week-bars rect.bar.sel')).toHaveCount(1);
    await page.locator('#week-tbody tr[data-day-index="5"]').click();
    await expect(page.locator('#week-day-tabs .utab.active')).toHaveAttribute('data-day-index', '5');
    await expect(page.locator('#week-day-head')).toBeHidden();
    await expect(page.locator('#week-block-table')).toBeVisible();
    await expect(page.locator('#week-block-heat')).toBeVisible();
    expect(errors).toEqual([]);
});

/**
 * Bubliny sú od zavedenia rebríčka len na širokej obrazovke, kde majú všetky tri meta riadok
 * so špičkou a využitím. Na mobile to, čo v ňom stálo, hovorí detail dňa.
 */
test('7 dní na desktope: bubliny majú meta riadok so špičkou a využitím', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    const today = forecast.days[0];
    const pct = usePct(today);
    const expectedMeta =
        `⚡ ${today.peakKw.toFixed(1)} kW o ${hourLabel(today.peakHour)}` + (pct == null ? '' : `${pct} % z jasnej oblohy`);
    await expect(page.locator('#week-today-meta')).toBeVisible();
    await expect(page.locator('#week-today-meta')).toHaveText(expectedMeta);
    await expect(page.locator('#week-tomorrow-meta')).toBeVisible();
    await expect(page.locator('#week-total-meta')).toBeVisible();
    expect(errors).toEqual([]);
});

test('zdieľať: odkaz na appku', async ({ page }) => {
    await openApp(page);
    await page.locator('#nav-zdielat').click();
    await expect(page.locator('#share-whatsapp')).toHaveAttribute('href', /wa\.me/);
});

test('info: karta vysvetľuje všetky štyri časti ciferníka', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-info').click();
    await expect(page.locator('#panel-info')).toBeVisible();
    await expect(page.locator('#info-title')).toHaveText('Ako čítať ciferník');
    // Ilustračný ciferník aj štyri vysvetlivky: prstenec, bodka "teraz", oblúk výkonu, jazdec.
    await expect(page.locator('#panel-info .info-dial')).toBeVisible();
    await expect(page.locator('#panel-info .info-row')).toHaveCount(4);
    // Tri tarifné pásma sú rozpísané po riadkoch, nie schované do jednej vety.
    await expect(page.locator('#panel-info .info-tiers li')).toHaveCount(3);
    expect(errors).toEqual([]);
});

test('bez dát: appka neukáže chybu, iba stav "dáta nedostupné"', async ({ page }) => {
    const errors = await openApp(page, { workerDown: true });
    await expect(page.locator('#pv-updated')).toHaveText('dáta nedostupné');
    await expect(page.locator('#pv-power')).toHaveText('–');
    await expect(page.locator('#verdict-headline')).not.toHaveText('Načítavam…');
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-msg-title')).toHaveText('Predpoveď sa pripravuje');
    expect(errors).toEqual([]);
});

/**
 * Utilita .hidden je jediná trieda (špecificita 0,1,0) a nepoužíva !important, takže ju
 * prebije akékoľvek pravidlo s `display` a vyššou špecificitou - ID selektor (#panel-x),
 * ale rovnako aj potomkovský (.chart-legend span). Appka by potom prvok "skryla" a on by
 * ostal na obrazovke. Test preto neberie zoznam prvkov, ktorý by sa dal zabudnúť doplniť,
 * ale prejde všetky prvky v stránke a overí, že .hidden na každom z nich naozaj zaberie.
 */
test('.hidden skryje každý prvok v stránke, nič ju neprebíja', async ({ page }) => {
    const errors = await openApp(page);
    // Karty sa vykresľujú až po otvorení, aby test videl aj ich obsah.
    for (const nav of ['#nav-7dni', '#nav-zdielat', '#nav-info', '#nav-terazky']) await page.locator(nav).click();

    const broken = await page.evaluate(() => {
        const out = [];
        for (const el of document.body.querySelectorAll('*')) {
            if (el.closest('script, style, template')) continue;
            const had = el.classList.contains('hidden');
            el.classList.add('hidden');
            const display = getComputedStyle(el).display;
            if (!had) el.classList.remove('hidden');
            if (display !== 'none') {
                const where = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.className}`;
                out.push(`${where} -> display: ${display}`);
            }
        }
        return out;
    });
    expect(broken, 'tieto prvky .hidden neskryje - niečo s vyššou špecificitou nastavuje display').toEqual([]);
    expect(errors).toEqual([]);
});

/** Počká, kým dobehne prisunutie novej karty. Axe musí posudzovať ustálenú kartu: uprostred
 * prechodu je ešte priehľadná a hlásilo by to nedostatočný kontrast textu.
 * @param {import('@playwright/test').Page} page */
const pockajNaPrechod = (page) =>
    page.evaluate(() =>
        Promise.all(
            document
                .getAnimations()
                .filter((a) => 'animationName' in a && String(a.animationName).startsWith('panel-in'))
                .map((a) => a.finished),
        ).then(() => undefined),
    );

test('prístupnosť: žiadne závažné nálezy axe na žiadnej karte', async ({ page }) => {
    await openApp(page);
    for (const panel of ['terazky', '7dni', 'zdielat', 'info']) {
        await page.locator(`#nav-${panel}`).click();
        await pockajNaPrechod(page);
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
    // Detail dňa je vlastná obrazovka s vlastným ovládaním (šípka späť), preto sa kontroluje zvlášť.
    await page.locator('#nav-7dni').click();
    await pockajNaPrechod(page);
    await page.locator('#week-list [data-day-index="5"]').click();
    const detail = await new AxeBuilder({ page }).analyze();
    const vazne = detail.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(vazne.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

/**
 * Karta Spotrebiče má na širokej obrazovke celú šírku stránky - kým existovala karta
 * Dnes-Zajtra, delili si ju na polovicu. Stránka je tu položkou zvislého flexu a vystredenie
 * cez `margin: 0 auto` jej vypína naťahovanie na šírku; karta pritom vlastnú šírku nemá
 * (ciferník sa počíta z percent, odporúčanie je `container-type: inline-size`), takže bez
 * `width: 100%` by sa stránka scvrkla na svoje okraje. Práve to test stráži.
 */
test('široká obrazovka: Spotrebiče majú celú šírku stránky', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await expect(page.locator('#panel-terazky')).toBeVisible();

    const rozlozenie = await page.evaluate(() => {
        const stranka = document.getElementById('page');
        const style = getComputedStyle(stranka);
        const obsah = stranka.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return {
            stranka: Math.round(stranka.getBoundingClientRect().width),
            obsah: Math.round(obsah),
            panel: Math.round(document.getElementById('panel-terazky').getBoundingClientRect().width),
            pager: Math.round(document.getElementById('verdict-pager').getBoundingClientRect().width),
        };
    });
    // Stránka je široká na maximum, ktoré jej dáva --page-max (1120 px na desktope).
    expect(rozlozenie.stranka, 'stránka sa scvrkla, karta nedostala celú šírku').toBe(1120);
    expect(Math.abs(rozlozenie.panel - rozlozenie.obsah), 'karta nevyplní celú šírku stránky').toBeLessThanOrEqual(1);
    expect(Math.abs(rozlozenie.pager - rozlozenie.obsah), 'pager odporúčaní nevyplní celú šírku karty').toBeLessThanOrEqual(1);

    // Defaultná prvá stránka pageru (Čo robiť teraz) nesmie ostať prázdna ani na desktope.
    const expectedNow = modelAt(atTime('13:00').wall).message;
    await expect(page.locator('#verdict-dots .pager-dot').first()).toHaveClass(/active/);
    await expect(page.locator('#verdict-headline')).toBeVisible();
    await expect(page.locator('#verdict-headline')).toHaveText(expectedNow.headline);
    await expect(page.locator('#verdict-forecast-title')).toHaveText(todayForecastMsg.title);
    expect(errors).toEqual([]);
});

/**
 * Plátno grafu sa na širokej karte kreslí na jej skutočný rozmer (fillDims), nie na pevné
 * 680x420 - viewBox preto musí sedieť s pixelmi 1:1, inak by sa graf naťahoval a popisky
 * skresľovali. Zároveň mu musí ostať kladná plocha pod okrajmi plátna.
 */
test('široká obrazovka: plátno grafu sedí s rozmerom karty 1:1', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    const chart = await page.evaluate(() => {
        const el = document.getElementById('week-curve');
        const [, , vw, vh] = (el.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const r = el.getBoundingClientRect();
        return { vw, vh, w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(Math.abs(chart.vw - chart.w), `šírka plátna ${chart.vw} nesedí s kartou ${chart.w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(chart.vh - chart.h), `výška plátna ${chart.vh} nesedí s kartou ${chart.h}`).toBeLessThanOrEqual(1);
    // padT (18) + padB (34) z chartDims; pod tým by graf kreslil do zápornej plochy.
    expect(chart.vh, 'plátno grafu je nižšie než jeho vlastné okraje').toBeGreaterThan(18 + 34);
    expect(errors).toEqual([]);
});

/**
 * Na desktope má appka sadnúť na obrazovku bez scrollovania - grafy sa prispôsobia výške
 * okna. Najtesnejší bežný prípad je notebook 1366x768; tam sa to buď zmestí, alebo nikde.
 * Tabuľka sa kontroluje zvlášť: jej riadky sa na rozdiel od grafov zmenšiť nedajú, tak má
 * vlastný stĺpec cez obe rady mriežky.
 */
test('desktop: appka sa zmestí na obrazovku bez scrollovania', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);

    for (const [nav, panel] of [
        ['#nav-terazky', '#panel-terazky'],
        ['#nav-7dni', '#panel-7dni'],
        ['#nav-zdielat', '#panel-zdielat'],
        ['#nav-info', '#panel-info'],
    ]) {
        await page.locator(nav).click();
        await expect(page.locator(panel)).toBeVisible();
        const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        expect(scroll, `karta ${panel} preteká cez výšku obrazovky o ${scroll} px`).toBeLessThanOrEqual(0);
    }

    // Na karte 7 dní musia byť vidno všetky dni naraz, nie po scrollovaní v tabuľke.
    await page.locator('#nav-7dni').click();
    const tabulka = await page.evaluate(() => {
        const wrap = document.querySelector('.week-tbl-wrap');
        const spodok = wrap.getBoundingClientRect().bottom;
        const riadky = [...document.querySelectorAll('#week-tbody tr')];
        return {
            spolu: riadky.length,
            vidno: riadky.filter((tr) => tr.getBoundingClientRect().bottom <= spodok + 1).length,
        };
    });
    expect(tabulka.vidno, 'v tabuľke 7 dní nie je vidno všetky riadky naraz').toBe(tabulka.spolu);
    expect(errors).toEqual([]);
});

/**
 * Na mobile a tablete (do 1023px) a od 620px výšky sa karta Terazky správa ako obrazovka,
 * nie dokument (rovnaký princíp ako desktop vyššie): ciferník ustupuje podľa výšky okna
 * (clamp s dvh), aby pod ním vždy ostalo miesto na pás dňa. Testuje sa naprieč bežnými
 * výškami mobilov, od veľkého telefónu (844px) po malý (667px, iPhone SE) až po spodnú
 * hranicu režimu (620px) - všade musí byť vidno naraz ciferník, odporúčanie aj celý pás
 * dňa (vrátane časovej osi 00-24), bez scrollovania a bez toho, aby čokoľvek zapadlo pod
 * spodnú navigáciu. Čo sa deje pod 620px, hovorí test hneď za týmto.
 */
test('mobil: karta Terazky sa od 620px výšky zmestí na obrazovku bez scrollovania', async ({ page }) => {
    for (const height of [844, 740, 667, 620]) {
        await page.setViewportSize({ width: 390, height });
        const errors = await openApp(page);

        const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        expect(scroll, `výška ${height}px: appka preteká o ${scroll} px`).toBeLessThanOrEqual(0);

        const geometria = await page.evaluate(() => ({
            kartaSpodok: document.querySelector('.verdict').getBoundingClientRect().bottom,
            navVrch: document.querySelector('.bottomnav').getBoundingClientRect().top,
        }));
        expect(geometria.kartaSpodok, `výška ${height}px: odporúčanie zapadá pod spodnú navigáciu`).toBeLessThanOrEqual(geometria.navVrch);

        // Ciferník je jediné, čo tu ustupuje - musí ostať viditeľný aj na najnižšej výške,
        // a s ním aj jeho denný prstenec, ktorý je jedinou cestou k náhľadu iného času.
        await expect(page.locator('.dial-svg'), `výška ${height}px`).toBeVisible();
        await expect(page.locator('#day-ring path').first(), `výška ${height}px`).toBeVisible();
        await expect(page.locator('#verdict-dots'), `výška ${height}px`).toBeVisible();
        expect(errors).toEqual([]);
    }
});

/**
 * Pod 620px výšky sa režim obrazovky nezapne a karta je bežný dokument. Je to zámer:
 * v režime obrazovky sa pretečený obsah odstrihne (.page { overflow: hidden }), a odstrihnúť
 * odporúčanie pod ciferníkom je horšie než dovoliť scroll. Podmienka je na výšku, nie na
 * orientáciu, preto sa skúša aj nízka výška na výšku (390x520), aj telefón na šírku
 * (740x360). Po doscrollovaní nadol musí byť celé odporúčanie nad spodnou navigáciou -
 * teda dostupné, nie odstrihnuté ani zakryté.
 */
test('mobil: pod 620px výšky sa karta Terazky odomkne a dá sa doscrollovať', async ({ page }) => {
    for (const { width, height } of [
        { width: 390, height: 520 },
        { width: 740, height: 360 },
    ]) {
        await page.setViewportSize({ width, height });
        const errors = await openApp(page);
        const rozmer = `${width}x${height}`;

        const zamknute = await page.evaluate(() =>
            ['body', '.page', '#panel-terazky']
                .map((sel) => `${sel}: ${getComputedStyle(document.querySelector(sel)).overflowY}`)
                .filter((s) => s.endsWith('hidden') || s.endsWith('clip')),
        );
        expect(zamknute, `${rozmer}: karta ostala zamknutá, obsah sa odstrihne namiesto scrollovania`).toEqual([]);

        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const geometria = await page.evaluate(() => ({
            kartaSpodok: document.querySelector('.verdict').getBoundingClientRect().bottom,
            navVrch: document.querySelector('.bottomnav').getBoundingClientRect().top,
        }));
        expect(geometria.kartaSpodok, `${rozmer}: odporúčanie sa ani po doscrollovaní nedostane nad spodnú navigáciu`).toBeLessThanOrEqual(
            geometria.navVrch,
        );

        await expect(page.locator('.dial-svg'), rozmer).toBeVisible();
        expect(errors).toEqual([]);
    }
});

/**
 * Obnovu ťahom nadol (pull to refresh) robí prehliadač sám: ponúkne ju, keď je stránka na
 * vrchu a dá sa potiahnuť nadol. Stačí jedno overflow: hidden na <body> - prenáša sa na
 * výrez okna - a gesto ticho zmizne. Presne to sa stalo karte Terazky, ktorá si telo
 * zamykala kvôli garancii bez scrollovania (viď test vyššie). Garanciu drží .page, telo
 * musí ostať voľné, inak karta stratí obnovu, ktorú ostatné karty majú.
 */
test('mobil: ťahom nadol sa dá obnoviť každá karta', async ({ page }) => {
    const errors = await openApp(page);
    for (const panel of ['terazky', '7dni', 'zdielat', 'info']) {
        await page.locator(`#nav-${panel}`).click();
        await expect(page.locator(`#panel-${panel}`)).toBeVisible();
        const zamknute = await page.evaluate(() =>
            [document.documentElement, document.body]
                .map((el) => `${el.tagName.toLowerCase()}: ${getComputedStyle(el).overflowY}`)
                .filter((s) => s.endsWith('hidden') || s.endsWith('clip')),
        );
        expect(zamknute, `karta ${panel}: telo stránky je zamknuté, prehliadač neponúkne obnovu ťahom`).toEqual([]);
    }
    expect(errors).toEqual([]);
});

test('široká obrazovka: prepnutie na 7 dní skryje kartu Spotrebiče', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#panel-7dni')).toBeVisible();
    await expect(page.locator('#panel-terazky')).toBeHidden();
    await page.locator('#nav-zdielat').click();
    await expect(page.locator('#panel-terazky')).toBeHidden();
    expect(errors).toEqual([]);
});

/**
 * Strop jasnej oblohy (bodkovaná čiara nad stĺpcom) na širokej karte prechádzal cez
 * číslo výroby nad stĺpcom. Na desktope sa preto nekreslí - a keďže sa nekreslí, ani
 * legenda k nemu nesmie zostať vidno (rovnaký prípad ako živá krivka v Predpovedi).
 */
test('7 dní - strop jasnej oblohy: na desktope zmizne aj s legendou, na mobile ostáva', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-bars .clear-cap')).toHaveCount(0);
    await expect(page.locator('#week-bars-clear-legend')).toBeHidden();

    // Na mobile žijú stĺpce v detaile dňa - strop aj jeho legenda sa kontrolujú tam.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.week-list-hero').click();
    await expect(page.locator('#week-bars .clear-cap')).toHaveCount(7);
    await expect(page.locator('#week-bars-clear-legend')).toBeVisible();
    expect(errors).toEqual([]);
});

/**
 * Správa "Najsilnejší deň" (.msg-block) je v HTML posledným potomkom .week-grid, hneď za
 * kartou tabuľky. Na desktope zdieľa s kartou tabuľky (.week-block:nth-child(4)) tú istú
 * bunku a align-self ju zospodu zasunie do voľného miesta pod siedmimi riadkami - nesmie
 * prekryť ani posunúť samotnú tabuľku. Na mobile patrí k detailu týždňa a ide v ňom
 * posledná, až za mapou výroby.
 */
test('7 dní - správa "Najsilnejší deň": na desktope pod tabuľkou, na mobile v detaile týždňa', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    const desktop = await page.evaluate(() => {
        const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
        const rows = [...document.querySelectorAll('#week-tbody tr')];
        return {
            msg: rect('#panel-7dni .msg-block'),
            table: rect('#panel-7dni .week-block:nth-child(4)'),
            lastRowBottom: rows[rows.length - 1].getBoundingClientRect().bottom,
            rowCount: rows.length,
        };
    });
    // Zdieľa kartu s tabuľkou - rovnaký ľavý aj pravý okraj, žiadny vlastný rám navyše.
    expect(Math.abs(desktop.msg.left - desktop.table.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(desktop.msg.right - desktop.table.right)).toBeLessThanOrEqual(1);
    // Pod posledným riadkom tabuľky, nie cez neho.
    expect(desktop.msg.top).toBeGreaterThanOrEqual(desktop.lastRowBottom - 1);
    // Zasunutá dolu, k päte tej istej karty.
    expect(Math.abs(desktop.msg.bottom - desktop.table.bottom)).toBeLessThanOrEqual(2);
    // Tabuľku to neovplyvnilo - všetkých 7 riadkov je stále vidno.
    expect(desktop.rowCount).toBe(7);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#week-msg-block')).toBeHidden();
    await page.locator('.week-list-hero').click();
    const mobile = await page.evaluate(() => ({
        msgTop: document.querySelector('#panel-7dni .msg-block').getBoundingClientRect().top,
        heatBottom: document.querySelector('#week-block-heat').getBoundingClientRect().bottom,
    }));
    expect(mobile.msgTop, 'správa nie je až za mapou výroby').toBeGreaterThanOrEqual(mobile.heatBottom - 1);
    expect(errors).toEqual([]);
});

/** Potiahnutie prstom naprieč prvkom. Dotyk ide cez CDP, teda ako naozajstný prst - test tak
 * vidí aj to, čo po geste urobí prehliadač sám (kompatibilný klik tam, kde prst skončil).
 * @param {import('@playwright/test').Page} page @param {string} sel prvok, ponad ktorý sa ťahá
 * @param {{ dx: number, dy?: number, ms?: number }} gesto posun prsta v pixeloch a jeho trvanie */
async function swipe(page, sel, { dx, dy = 0, ms = 0 }) {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error(`Prvok ${sel} nie je vidno`);
    const x = box.x + box.width / 2 - dx / 2;
    const y = box.y + box.height / 2 - dy / 2;
    const kroky = [0.5, 1];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const t of kroky) {
        if (ms) await page.waitForTimeout(ms / kroky.length);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * t, y: y + dy * t }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

/** Ťahanie prstom od stredu prvku, nie ponad neho: gesto musí začať presne na ňom. Bežec na
 * páse dňa je široký 34 px, takže `swipe` (ten začína o pol ťahu skôr) by sa naň netrafil.
 * @param {import('@playwright/test').Page} page @param {string} sel @param {{ dx: number, dy?: number, ms?: number }} opts */
async function tahajOdStredu(page, sel, { dx, dy = 0, ms = 300 }) {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error(`Prvok ${sel} nie je vidno`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const t of [0.34, 0.67, 1]) {
        await page.waitForTimeout(ms / 3);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * t, y: y + dy * t }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

/** Ťuknutie prstom: krátke podržanie a mikropohyb, ako pri skutočnej ruke. @param {import('@playwright/test').Page} page @param {number} x @param {number} y */
async function tuknutie(page, x, y) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(SWIPE.flickMs + 50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 2, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

/** Ťuknutie úplne bez pohybu: prst sa nepohol ani o pixel, takže neprišiel žiadny touchmove
 * a appka má na rozhodnutie len touchstart a touchend. @param {import('@playwright/test').Page} page @param {number} x @param {number} y */
async function tuknutieBezPohybu(page, x, y) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

/** Preblikol tooltip niekedy počas gesta? Stav po geste nestačí: appka tooltip po prepnutí
 * karty aj tak zatvára a sám sa zatvára po TOOLTIP_HOLD_MS, takže kontrola „potom" by
 * preblikutie nikdy nechytila. Preto sa trieda sleduje cez MutationObserver od začiatku gesta.
 * @param {import('@playwright/test').Page} page @param {string} id */
async function sledujTooltip(page, id) {
    await page.evaluate((id) => {
        const el = /** @type {HTMLElement} */ (document.getElementById(id));
        window.tooltipBolVidno = el.classList.contains('visible');
        new MutationObserver(() => {
            if (el.classList.contains('visible')) window.tooltipBolVidno = true;
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    }, id);
}

/** @param {import('@playwright/test').Page} page */
function boloVidno(page) {
    return page.evaluate(() => window.tooltipBolVidno);
}

/** Animácia trvá 200 ms, takže na pohľad po geste už môže byť preč - test preto zbiera
 * `animationstart` rovnako, ako sledujTooltip zbiera preblikanie tooltipu.
 * @param {import('@playwright/test').Page} page */
async function sledujAnimacie(page) {
    await page.evaluate(() => {
        // Poslucháč sa vešia raz za stránku; ďalšie volania len vynulujú zoznam. Druhý
        // poslucháč by do toho istého poľa zapisoval každú animáciu dvakrát.
        if (!window.spusteneAnimacie)
            document.addEventListener('animationstart', (e) => window.spusteneAnimacie.push(e.animationName), true);
        window.spusteneAnimacie = [];
    });
}

/** Mená animácií prisunutia dňa, ktoré odvtedy naskočili. @param {import('@playwright/test').Page} page */
async function animacieDna(page) {
    const mena = await page.evaluate(() => window.spusteneAnimacie);
    return mena.filter((/** @type {string} */ n) => n.startsWith('day-in'));
}

/** @param {import('@playwright/test').Page} page @param {string} panel */
async function ocakavajKartu(page, panel) {
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
}

/** Graf priebehu dňa je na mobile až v detaile vybraného dňa - otvára sa klikom na riadok
 * rebríčka. @param {import('@playwright/test').Page} page @param {number} [den] */
async function otvorDetailDna(page, den = 0) {
    await page.locator('#nav-7dni').click();
    await page.locator(`#week-list [data-day-index="${den}"]`).click();
    await expect(page.locator('#week-curve-wrap')).toBeVisible();
}

test('prechod medzi kartami: smer podľa poradia a nič nepretečie do strán', async ({ page }) => {
    const errors = await openApp(page);

    // Smer prechodu si CSS berie z #page[data-dir]; karta sa podľa neho prisunie zľava alebo sprava.
    const smerAAnimacia = () =>
        page.evaluate(() => ({
            dir: document.getElementById('page')?.dataset.dir,
            animacia: getComputedStyle(/** @type {Element} */ (document.querySelector('.panel:not(.hidden)'))).animationName,
        }));

    await page.locator('#nav-7dni').click();
    expect(await smerAAnimacia()).toEqual({ dir: 'next', animacia: 'panel-in-next' });
    await page.locator('#nav-terazky').click();
    expect(await smerAAnimacia()).toEqual({ dir: 'prev', animacia: 'panel-in-prev' });

    // Posunutá karta na okamih presiahne stránku do strany. Meria sa to počas celého prechodu,
    // nie až po ňom: vodorovný scroll, ktorý sa objaví na 200 ms, je aj tak chyba.
    const sledujPretecenie = page.evaluate(
        () =>
            new Promise((resolve) => {
                let max = 0;
                const zaciatok = performance.now();
                const krok = () => {
                    const el = document.documentElement;
                    max = Math.max(max, el.scrollWidth - el.clientWidth);
                    if (performance.now() - zaciatok < 500) requestAnimationFrame(krok);
                    else resolve(max);
                };
                requestAnimationFrame(krok);
            }),
    );
    await page.locator('#nav-zdielat').click();
    expect(await sledujPretecenie, 'stránku sa dalo počas prechodu poscrollovať do strán').toBe(0);
    expect(errors).toEqual([]);
});

/**
 * Tlačidlo Späť na telefóne a tablete (a šípka v prehliadači) je jediná vec, ktorá sa
 * v appke dá „vrátiť": kroky navigácie - prepnutie karty a otvorenie detailu dňa.
 * Adresa sa pritom nemení, položky histórie nesú len krok navigácie.
 */
test('tlačidlo Späť vracia o krok v appke, dopredu ide zase tam', async ({ page }) => {
    const errors = await openApp(page);
    const adresa = page.url();

    await page.locator('#nav-zdielat').click();
    await page.locator('#nav-7dni').click();
    await page.locator('#week-list [data-day-index="5"]').click();
    await expect(page.locator('#week-day-head')).toBeVisible();
    expect(page.url(), 'appka nemení adresu, odkaz na ňu ostáva jeden').toBe(adresa);

    // Späť najprv zavrie detail dňa, potom sa vracia po kartách - v opačnom poradí, než sa šlo.
    await page.goBack();
    await expect(page.locator('#week-day-head')).toBeHidden();
    await ocakavajKartu(page, '7dni');
    await page.goBack();
    await ocakavajKartu(page, 'zdielat');
    await page.goBack();
    await ocakavajKartu(page, 'terazky');

    // Dopredu vedie tá istá cesta naspäť, vrátane otvoreného detailu dňa.
    await page.goForward();
    await ocakavajKartu(page, 'zdielat');
    await page.goForward();
    await ocakavajKartu(page, '7dni');
    await page.goForward();
    await expect(page.locator('#week-day-head')).toBeVisible();
    expect(errors).toEqual([]);
});

/** Krokom navigácie je karta a detail dňa, nič iné. Listovanie odporúčaní či výber dňa sa
 * deje vnútri karty, takže Späť ich nepočíta - inak by sa z appky nedalo odísť. */
test('Späť nepočíta výber vnútri karty, po vyčerpaní krokov opustí appku', async ({ page }) => {
    const errors = await openApp(page);
    const zaciatok = await page.evaluate(() => history.length);

    // Prelistovanie odporúčaní na tretiu stránku je výber vnútri karty, nie krok navigácie.
    await page.locator('#verdict-dots .pager-dot').nth(2).click();
    await expect(page.locator('#verdict-dots .pager-dot').nth(2)).toHaveClass(/active/);
    await page.locator('#nav-7dni').click();
    expect(await page.evaluate(() => history.length), 'do histórie pribudlo len prepnutie karty').toBe(zaciatok + 1);

    // Jediný krok späť je teda návrat na prvú kartu; ďalší už z appky odchádza (v nainštalovanej
    // appke je odchod z prvej karty jej zatvorením - zavrieť sa sama nevie a ani nemá).
    await page.goBack();
    await ocakavajKartu(page, 'terazky');
    expect(await page.evaluate(() => history.state), 'na prvej karte už appka v histórii nič nedrží').toEqual({
        step: { panel: 'terazky', weekDetail: null },
    });
    expect(errors).toEqual([]);
});

test.describe('listovanie kariet prstom', () => {
    test.use({ hasTouch: true });

    /** Detail dňa je otvorený na `den`. @param {import('@playwright/test').Page} page @param {number} den */
    async function ocakavajDetailDna(page, den) {
        await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[den].date, den));
        await expect(page.locator('#week-day-head')).toBeVisible();
        await ocakavajKartu(page, '7dni');
    }

    test('ťah do strán prepína karty v poradí navigácie, na kraji sa zastaví', async ({ page }) => {
        const errors = await openApp(page);
        await ocakavajKartu(page, 'terazky');

        // Doľava sa ide dopredu v poradí navigácie, doprava späť.
        await swipe(page, '#dial-hero', { dx: -120 });
        await ocakavajKartu(page, '7dni');
        await swipe(page, '#week-sub', { dx: -120 });
        await ocakavajKartu(page, 'zdielat');
        await swipe(page, '#qrcode', { dx: 120 });
        await ocakavajKartu(page, '7dni');
        await swipe(page, '#week-sub', { dx: 120 });
        await ocakavajKartu(page, 'terazky');

        // Pred prvou kartou už nič nie je - listovanie sa nezacyklí.
        await swipe(page, '#dial-hero', { dx: 120 });
        await ocakavajKartu(page, 'terazky');

        // Šikmý ťah je posúvanie po stránke, nie listovanie.
        await swipe(page, '#dial-hero', { dx: -120, dy: 120 });
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('pás odporúčaní si ťahanie necháva pre seba aj na krajnej stránke', async ({ page }) => {
        const errors = await openApp(page);
        const dots = page.locator('#verdict-dots .pager-dot');

        // Pás pod ciferníkom sa listuje sám, takže gesto nad ním patrí jemu a karta ostáva -
        // aj na prvej stránke, z ktorej naspäť nevedie nič.
        await swipe(page, '#verdict-pager', { dx: 120 });
        await ocakavajKartu(page, 'terazky');
        await swipe(page, '#verdict-pager', { dx: -120 });
        await ocakavajKartu(page, 'terazky');

        // To isté na poslednej stránke - bez času čakania je ňou predpoveď dňa.
        await dots.nth(2).click();
        await expect(dots.nth(2)).toHaveClass(/active/);
        await swipe(page, '#verdict-pager', { dx: -120 });
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('nad grafom listuje švihnutie, pomalé sledovanie krivky nie', async ({ page }) => {
        const errors = await openApp(page);
        await otvorDetailDna(page);

        // Ťahaním po krivke sa graf prezerá (tooltip ide za prstom) - to nie je listovanie.
        await swipe(page, '#week-curve-wrap', { dx: -120, ms: 500 });
        await ocakavajDetailDna(page, 0);
        await expect(page.locator('#week-curve-tooltip')).toHaveClass(/visible/);

        // Rýchle švihnutie ponad ten istý graf prelistuje na ďalší deň a tooltip po sebe
        // upratá - hodnota pod prstom už patrí inej krivke.
        await swipe(page, '#week-curve-wrap', { dx: -120 });
        await ocakavajDetailDna(page, 1);
        await expect(page.locator('#week-curve-tooltip')).not.toHaveClass(/visible/);
        expect(errors).toEqual([]);
    });

    test('pri švihnutí ponad graf tooltip ani neprebliskne, ťuknutie ho ukáže', async ({ page }) => {
        const errors = await openApp(page);
        await otvorDetailDna(page);

        await sledujTooltip(page, 'week-curve-tooltip');
        await swipe(page, '#week-curve-wrap', { dx: -120 });
        await ocakavajDetailDna(page, 1);
        expect(await boloVidno(page), 'tooltip preblikol počas švihnutia').toBe(false);

        // Ťuknutie na graf ho naopak ukázať musí - inak by sa hodnota nedala prečítať.
        // Aj tu sa pozerá na sledovanú triedu, nie na stav po chvíli: tooltip sa sám zatvára
        // po TOOLTIP_HOLD_MS a na zaťaženom stroji by sa kontrola trafila až za ten čas.
        await otvorDetailDna(page);
        await sledujTooltip(page, 'week-curve-tooltip');
        await swipe(page, '#week-curve-wrap', { dx: 0 });
        expect(await boloVidno(page), 'ťuknutie na graf neukázalo tooltip').toBe(true);
        await ocakavajDetailDna(page, 0);
        expect(errors).toEqual([]);
    });

    /** Grafy sa čítajú po vodorovnej osi, takže zvislý ťah nie je ich prezeranie, ale posúvanie
     * stránky - a to patrí prehliadaču (`.chart-wrap { touch-action: pan-y }`). Test drží obe
     * polovice: že sa stránka cez graf naozaj posunie, aj že pritom tooltip ani nepreblikne.
     * Ide cez detail týždňa: tam sú dva grafy pod sebou, takže je kam scrollovať (v detaile
     * dňa sa obsah na displej zmestí a test by nemeral nič). */
    test('zvislý ťah cez graf posúva stránku a tooltip neukáže', async ({ page }) => {
        // Nižší displej (375x667, veľkosť menšieho telefónu): na tom, z ktorého sú ostatné
        // testy, sa karta zmestí celá.
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('.week-list-hero').click();
        await expect(page.locator('#week-bars-wrap')).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
            'karta sa celá zmestí na displej, nie je kam scrollovať - test by nič nemeral',
        ).toBeGreaterThan(0);

        await sledujTooltip(page, 'week-bars-tooltip');
        await swipe(page, '#week-bars-wrap', { dx: 0, dy: -120, ms: 400 });
        expect(await boloVidno(page), 'tooltip preblikol pri posúvaní stránky').toBe(false);
        expect(await page.evaluate(() => window.scrollY), 'stránka sa cez graf neposunula').toBeGreaterThan(0);

        // Aj krátky scroll je scroll: prst prešiel menej, než je hranica švihnutia, takže na
        // dĺžku vyzerá ako ťuknutie - rozhoduje to, že sa stránka posunula.
        await page.evaluate(() => window.scrollTo(0, 0));
        await sledujTooltip(page, 'week-bars-tooltip');
        await swipe(page, '#week-bars-wrap', { dx: 0, dy: -40, ms: 400 });
        expect(await boloVidno(page), 'tooltip sa ukázal po krátkom posunutí stránky').toBe(false);
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });

    /** Ťuknutie, pri ktorom sa prst ani nepohne, nepošle jediný touchmove - appka má na
     * rozhodnutie len začiatok a koniec gesta. Aj tak musí hodnotu ukázať, a nechať ju na
     * displeji: prehliadač po ťuknutí dopošle kurzorové udalosti a tooltip z nich kedysi
     * zhasol do 15 ms, takže z neho ostalo bliknutie. Test preto kontroluje aj to, že tam
     * po chvíli ešte stále je. */
    test('ťuknutie na graf bez pohybu prsta ukáže tooltip a ten ostane', async ({ page }) => {
        const errors = await openApp(page);
        await otvorDetailDna(page);
        const graf = await page.locator('#week-curve-wrap').boundingBox();
        if (!graf) throw new Error('graf priebehu dňa nie je vidno');

        await sledujTooltip(page, 'week-curve-tooltip');
        await tuknutieBezPohybu(page, graf.x + graf.width / 2, graf.y + graf.height / 2);
        expect(await boloVidno(page), 'ťuknutie bez pohybu prsta neukázalo tooltip').toBe(true);
        // Polovica času, po ktorom sa tooltip zatvára sám - dovtedy musí byť vidno.
        await page.waitForTimeout(TOOLTIP_HOLD_MS / 2);
        expect(
            await page.evaluate(() => document.getElementById('week-curve-tooltip')?.classList.contains('visible')),
            'tooltip po ťuknutí hneď zhasol',
        ).toBe(true);
        expect(errors).toEqual([]);
    });

    test('ťah ponad rebríček dní prepne kartu a neotvorí detail dňa', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();

        // Rebríček sa nemá kam posúvať do strán, gesto teda patrí karte. Klik, ktorý by po
        // ťahu otvoril detail dňa, appka zruší.
        await swipe(page, '#week-list', { dx: -120 });
        await ocakavajKartu(page, 'zdielat');
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-day-head')).toBeHidden();
        expect(errors).toEqual([]);
    });

    /**
     * Prehľad dní sa na mobile nesmie dať posunúť do strán. Kým tu stála tabuľka s piatimi
     * stĺpcami, na úzkom displeji pretekala a prvý ťah posunul ju - kartu prelistoval až ten
     * druhý, z pohľadu človeka "swipe nefunguje". Rebríček sa vojde do každej šírky, lebo
     * pásik je pružný stĺpec mriežky (`1fr` v .wday) a zvyšok má pevné šírky.
     *
     * Testujú sa obe hranice naraz: bežný úzky telefón (360 px, Galaxy S22 a spol.) aj
     * vonkajší displej skladačky (280 px), kde tabuľka pretekala vždy.
     */
    test('rebríček dní sa zmestí aj na 280 px a ťah rovno prepne kartu', async ({ page }) => {
        for (const width of [360, 280]) {
            await page.setViewportSize({ width, height: 844 });
            const errors = await openApp(page);
            await page.locator('#nav-7dni').click();

            const pretecenie = await page.locator('#week-block-list').evaluate((el) => {
                const pasy = [el, ...el.querySelectorAll('*')].map((n) => n.scrollWidth - n.clientWidth);
                return Math.max(...pasy);
            });
            expect(pretecenie, `šírka ${width}px: prehľad dní pretekal do strán`).toBeLessThanOrEqual(0);

            await swipe(page, '#week-list', { dx: -120 });
            await ocakavajKartu(page, 'zdielat');
            expect(errors).toEqual([]);
        }
    });

    /** Značka "teraz" je na prstenci a okolo 06:00 stojí na pravom okraji ciferníka, kde jej
     * 44 px široký štvorec presiahne kartu o necelé dva pixely. Karta má overflow-x: hidden,
     * takže vidno to nie je - ale swipe.js to kedysi čítal ako vnútorný posuvný pás pod prstom
     * a gesto mu odovzdal. Listovanie tak bolo v tú hodinu mŕtve. Test ide presne na ten čas;
     * hranicu (vnútorný pás sa musí dať naozaj posúvať) drží pravidlo, nie zoznam výnimiek. */
    test('ťah ponad ciferník prepne kartu aj o 06:00, keď značka "teraz" trčí cez okraj', async ({ page }) => {
        const errors = await openApp(page, { time: atTime('06:00').instant });
        await ocakavajKartu(page, 'terazky');

        await swipe(page, '#dial-hero', { dx: -120 });
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });

    test('ťah ponad ciferník prepne kartu a nenastaví náhľad iného času', async ({ page }) => {
        const errors = await openApp(page);

        // Ciferník je na mobile najväčšia plocha karty, listovať sa cez ňu dá. Ťuknutie naň
        // ale nastavuje náhľad iného času - po geste ho preto appka potlačí, aj keď gesto
        // narazí na kraj poradia.
        await swipe(page, '#dial-wrap', { dx: 120 });
        await ocakavajKartu(page, 'terazky');
        await expect(page.locator('#dial-grip')).toHaveClass(/at-now/);

        await swipe(page, '#dial-wrap', { dx: -120 });
        await ocakavajKartu(page, '7dni');
        await page.locator('#nav-terazky').click();
        await expect(page.locator('#dial-grip')).toHaveClass(/at-now/);

        // Obyčajné ťuknutie na prstenec náhľad nastaví.
        const box = await page.locator('#dial-wrap').boundingBox();
        if (!box) throw new Error('ciferník nemá rozmer');
        const six = ringXY(box, 6 * 60);
        await page.locator('#dial-wrap').click({ position: { x: six.x - box.x, y: six.y - box.y } });
        await expect(page.locator('#dial-grip')).not.toHaveClass(/at-now/);
        expect(errors).toEqual([]);
    });

    /** Jazdec je jediná výnimka z pravidla o ťahaní: gesto, ktoré by inde prelistovalo kartu,
     * na ňom posúva náhľad času (výnimka DRAG_HANDLE vo `swipe.js`). Preto sa ťahá doľava
     * a dosť ďaleko - kratší ťah než SWIPE.minDistPx by za listovanie neprešiel ani bez tej
     * výnimky a test by nekontroloval nič. */
    test('ťahanie jazdca prstom posúva náhľad času a kartu neprepne', async ({ page }) => {
        const errors = await openApp(page);
        const box = await page.locator('#dial-wrap').boundingBox();
        if (!box) throw new Error('ciferník nemá rozmer');

        // Náhľad treba najprv zapnúť - bez neho jazdec na prstenci nie je.
        const start = ringXY(box, 5 * 60);
        await page.locator('#dial-wrap').click({ position: { x: start.x - box.x, y: start.y - box.y } });
        const grip = await page.locator('#dial-grip').boundingBox();
        if (!grip) throw new Error('jazdec nie je vidno');

        // Ťah doľava cez vrchol ciferníka: z 05:00 smerom k 20:00 po ľavej strane.
        const ciel = ringXY(box, 20 * 60);
        const dx = ciel.x - (grip.x + grip.width / 2);
        expect(Math.abs(dx), 'ťah je kratší než hranica listovania, test by nič nekontroloval').toBeGreaterThan(SWIPE.minDistPx);
        await tahajOdStredu(page, '#dial-grip', { dx, dy: ciel.y - (grip.y + grip.height / 2) });
        await expect(page.locator('#dial-when')).toHaveText(/^(19|20|21):\d{2}$/);
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('v detaile dňa listuje ťah dni, za posledným sa zastaví a z prvého vedie do prehľadu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#week-list [data-day-index="3"]').click();
        await ocakavajDetailDna(page, 3);

        // Doľava sa ide na ďalší deň, doprava na predchádzajúci - ako inde na karty, len
        // vnútri detailu. Karta ostáva tá istá a detail otvorený.
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 4);
        await swipe(page, '#week-day-head', { dx: 120 });
        await ocakavajDetailDna(page, 3);

        // Posledný deň týždňa: doľava už nie je kam ísť a ťah nesmie prepnúť kartu.
        await page.locator('#week-day-back').click();
        await page.locator('#week-list [data-day-index="6"]').click();
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 6);

        // Prvý deň: doprava už nie je kam listovať, tak ťah zavrie detail - to isté, čo šípka
        // späť v jeho hlavičke. Karta pod ním ostáva 7 dní.
        await page.locator('#week-day-back').click();
        await page.locator('#week-list [data-day-index="0"]').click();
        await ocakavajDetailDna(page, 0);
        await swipe(page, '#week-day-head', { dx: 120 });
        await expect(page.locator('#week-day-head')).toBeHidden();
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });

    /** Prisunutie je jediné, čo o prelistovaní dňa povie oko - bez neho sa obsah len prepne.
     * Test drží obe polovice: že animácia naskočí, aj že naskočí znovu pri druhom ťahu tým
     * istým smerom (vtedy sa karta neprekresľuje z display:none a bez striedania dvoch
     * rovnakých animácií by prehliadač druhýkrát nespustil nič). */
    test('prelistovanie dňa prisunie detail z tej strany, ktorou sa ťahalo', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#week-list [data-day-index="2"]').click();
        await ocakavajDetailDna(page, 2);

        // Ťah doľava: nový deň príde sprava (bez triedy day-in-prev), na hlavičke aj na mriežke.
        await sledujAnimacie(page);
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 3);
        expect(await animacieDna(page), 'prisunutie nenaskočilo').toHaveLength(2);
        await expect(page.locator('#week-grid')).not.toHaveClass(/day-in-prev/);

        // Druhý ťah tým istým smerom musí animáciu spustiť znovu.
        await sledujAnimacie(page);
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 4);
        expect(await animacieDna(page), 'druhé prelistovanie nič nespustilo').toHaveLength(2);

        // Ťah doprava prisunie deň zľava.
        await sledujAnimacie(page);
        await swipe(page, '#week-day-head', { dx: 120 });
        await ocakavajDetailDna(page, 3);
        expect(await animacieDna(page), 'prisunutie späť nenaskočilo').toHaveLength(2);
        await expect(page.locator('#week-grid')).toHaveClass(/day-in-prev/);

        // Otvorenie detailu z prehľadu nie je listovanie - tam sa neprisúva nič.
        await page.locator('#week-day-back').click();
        await sledujAnimacie(page);
        await page.locator('#week-list [data-day-index="5"]').click();
        await ocakavajDetailDna(page, 5);
        expect(await animacieDna(page), 'otvorenie detailu sa tvárilo ako listovanie').toHaveLength(0);
        expect(errors).toEqual([]);
    });

    test('v detaile týždňa ťah doľava neurobí nič, doprava sa vráti do prehľadu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('.week-list-hero').click();
        await expect(page.locator('#week-day-title')).toHaveText('Celý týždeň');

        // Doľava nie je kam ísť - je tam jediná obrazovka a vpred z detailu cesta nevedie.
        await swipe(page, '#week-day-head', { dx: -120 });
        await expect(page.locator('#week-day-title')).toHaveText('Celý týždeň');
        await ocakavajKartu(page, '7dni');

        // Doprava je krok späť: detail sa zavrie a ostane prehľad dní.
        await swipe(page, '#week-day-head', { dx: 120 });
        await expect(page.locator('#week-day-head')).toBeHidden();
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });
});

/**
 * Nič v stránke nesmie pretiecť do strán. Mobilné prehliadače na to reagujú tak, že rozšíria
 * layout viewport - appka sa potom kreslí širšia než displej a dá sa zoomovať "von" pod 100 %.
 * Chytilo nás to už trikrát: tabuľka 7 dní bez `min-width: 0`, tooltip pri okraji grafu bez
 * orezania, a naposledy tooltip, ktorý si po otočení displeja niesol pixelové súradnice zo
 * širokej obrazovky. Preto to stráži test celej triedy chýb, nie jednej príčiny.
 */
test.describe('otočenie displeja', () => {
    test.use({ hasTouch: true });

    test('po otočení na výšku stránka nepretečie do strán', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        const errors = await openApp(page);
        // Na šírku je displej široký (768 px a viac), takže karta 7 dní ukazuje všetky bloky
        // naraz a graf priebehu je vidno bez otvárania detailu dňa.
        await page.locator('#nav-7dni').click();
        const wrap = page.locator('#week-curve-wrap');
        await wrap.scrollIntoViewIfNeeded();
        const graf = await wrap.boundingBox();
        if (!graf) throw new Error('graf priebehu dňa nie je vidno');

        // Ťuknutie čo najbližšie k pravému okraju grafu - tam má tooltip najväčšie súradnice.
        await tuknutie(page, Math.min(graf.x + graf.width - 3, 842), Math.min(Math.max(graf.y + graf.height / 2, 2), 388));
        await expect(page.locator('#week-curve-tooltip')).toHaveClass(/visible/);
        await page.waitForTimeout(TOOLTIP_HOLD_MS + TOOLTIP_FADE_MS + 100);

        await page.setViewportSize({ width: 390, height: 844 });
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
                message: 'po otočení na výšku stránka trčí do strán',
            })
            .toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
    });
});

/**
 * iPhone s výrezom: po pridaní na plochu beží appka bez lišty prehliadača a jej stránka
 * začína až pod stavovým riadkom systému, teda pod hodinami a batériou (viewport-fit=cover
 * a black-translucent v index.html). Prehliadač o tejto zóne povie len cez
 * env(safe-area-inset-top), ktoré sa v teste nastaviť nedá - appka ju preto číta cez
 * premennú --safe-top a test si do nej dosadí výšku stavového riadku iPhonu.
 * Celá hlavička musí ostať pod ňou: inak sa názov firmy schová za systémové hodiny
 * a vykukne len na okamih pri ťahaní prstom nadol (presne to sa dialo).
 */
test('mobil: hlavička ostane pod stavovým riadkom telefónu', async ({ page }) => {
    const SAFE_TOP = 59;
    const errors = await openApp(page);
    await page.addStyleTag({ content: `:root { --safe-top: ${SAFE_TOP}px; }` });

    for (const panel of ['terazky', '7dni', 'zdielat']) {
        await page.locator(`#nav-${panel}`).click();
        const vrch = await page.evaluate(() => document.querySelector('.appbar-inner').getBoundingClientRect().top);
        expect(vrch, `karta ${panel}: hlavička zasahuje do stavového riadku`).toBeGreaterThanOrEqual(SAFE_TOP);
    }

    // Karta Terazky je obrazovka bez scrollovania (viď test vyššie) - bezpečná zóna jej
    // nesmie nič vytlačiť von.
    await page.locator('#nav-terazky').click();
    const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(scroll, `karta Terazky preteká o ${scroll} px`).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
});
