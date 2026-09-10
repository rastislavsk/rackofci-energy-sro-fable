// E2E: appka s pevným časom a dátami z fixtures. Očakávané texty sa počítajú tou istou
// doménovou logikou (shared/), takže test chytí rozdiel medzi modelom a tým, čo je v DOM.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { usePct, visibleHours } from '../../shared/chart-model.js';
import { LEGACY_SOURCES, WORKER_URL } from '../../shared/config.js';
import { heroModel } from '../../shared/hero-model.js';
import { fmt1, hourLabel, weekDayLong } from '../../shared/format.js';
import { useTier } from '../../web/render/sedemdni.js';
import { forecastDayMessage } from '../../shared/messages.js';
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

test('hlavná karta o 13:00 zodpovedá modelu', async ({ page }) => {
    const errors = await openApp(page);
    const expected = modelAt(atTime('13:00').wall);
    await expect(page.locator('#current-time-display')).toHaveText('13:00');
    await expect(page.locator('#verdict-headline')).toHaveText(expected.message.headline);
    await expect(page.locator('#verdict-body')).toHaveText(expected.message.body);
    await expect(page.locator('#pv-power')).toHaveText('6.41');
    await expect(page.locator('#verdict-go-row .go-chip')).toHaveCount(5);
    await expect(page.locator('#pv-updated')).toContainText('aktualizované 13:00');
    // Spotrebiče, Tarifa a slnko a Predpoveď dňa sú tam vždy - bodky sú vidno, no piata
    // (Lepšie bude) nie je.
    await expect(page.locator('#verdict-dots .pager-dot')).toHaveCount(5);
    await expect(page.locator('#verdict-dots')).toBeVisible();
    await expect(page.locator('#verdict-dot-wait')).toBeHidden();
    await expect(page.locator('#verdict-page-wait')).toBeHidden();
    // Defaultne otvorená prvá stránka je "Tarifa a slnko".
    const dots = page.locator('#verdict-dots .pager-dot');
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-page-eyebrow')).toBeInViewport();
    // Odznak s tarifou nie je nad ciferníkom, žije len vo vlastnej stránke pageru.
    await expect(page.locator('#verdict-page-eyebrow')).toContainText(expected.eyebrow);
    // Správa o predpovedi dňa je tu v pageri (karta Predpoveď je na mobile teraz skrytá).
    await expect(page.locator('#verdict-forecast-title')).toHaveText(todayForecastMsg.title);
    await expect(page.locator('#verdict-forecast-body')).toHaveText(todayForecastMsg.body);
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

test('verdikt sa listuje do strán: tarifa a slnko (defaultne prvá), teraz, spotrebiče, predpoveď dňa, kedy bude lepšie', async ({
    page,
}) => {
    const { instant, wall } = atTime('09:00');
    // Fixtures nemajú pred sebou silnejšie okno, bez tejto úpravy by čakací čas nikdy nevznikol.
    const sunnier = { ...forecast, strongerWindowAhead: true, hoursAhead: 3, windowDaypart: 'poobede' };
    const errors = await openApp(page, { time: instant, forecastOverride: sunnier });
    const expected = heroModel({ now: wall, season: 'summer', pv, forecast: sunnier, previewMinutes: null });

    const dots = page.locator('#verdict-dots .pager-dot');
    await expect(page.locator('#verdict-dots')).toBeVisible();
    await expect(dots.nth(4)).toBeVisible();
    await expect(page.locator('#verdict-wait-time')).toHaveText(String(expected.waitTime));
    await expect(page.locator('#verdict-pager')).toHaveAttribute('tabindex', '0');
    // Defaultne otvorená prvá stránka je "Tarifa a slnko".
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-page-eyebrow')).toHaveText(expected.eyebrow);
    await expect(page.locator('#verdict-page-eyebrow')).toBeInViewport();

    // Posun do strán nad pásom = to isté gesto ako prst; stránku dopočíta scroll-snap.
    const pager = page.locator('#verdict-pager');
    await pager.hover();
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.nth(0)).not.toHaveClass(/active/);
    await expect(page.locator('#verdict-headline')).toHaveText(expected.message.headline);
    await expect(page.locator('#verdict-headline')).toBeInViewport();

    // Ešte jeden posun na tretiu stránku "Spotrebiče".
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(2)).toHaveClass(/active/);
    await expect(page.locator('#verdict-go-row .go-chip')).toHaveCount(5);
    await expect(page.locator('#verdict-go-row')).toBeInViewport();

    // Ešte jeden posun na štvrtú stránku "Predpoveď dňa".
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(3)).toHaveClass(/active/);
    await expect(page.locator('#verdict-forecast-title')).toHaveText(todayForecastMsg.title);
    await expect(page.locator('#verdict-page-forecast')).toBeInViewport();

    // Posledný posun na piatu stránku "Lepšie bude".
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(4)).toHaveClass(/active/);
    await expect(page.locator('#verdict-wait-chip')).toBeInViewport();

    // Pás je kolotoč: posun za poslednú stránku sa zacyklí na prvú.
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-page-eyebrow')).toBeInViewport();

    // A opačným smerom z prvej stránky sa zacyklí na poslednú.
    await page.mouse.wheel(-400, 0);
    await expect(dots.nth(4)).toHaveClass(/active/);
    await expect(page.locator('#verdict-wait-chip')).toBeInViewport();

    // Bodka posunie pás späť na prvú stránku.
    await dots.nth(0).click();
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator('#verdict-page-eyebrow')).toBeInViewport();

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
        await expect(page.locator('#verdict-page-eyebrow')).toContainText(expected.eyebrow);
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

test('ťahanie bežca: pás sa pri náhľade nemení, obnovené dáta ale dobehne', async ({ page }) => {
    const errors = await openApp(page);
    const strip = page.locator('#daystrip');
    const box = await strip.boundingBox();
    if (!box) throw new Error('pás dňa nemá rozmer');
    const y = box.y + box.height / 2;

    // Pás dňa nezávisí od náhľadu času - počas ťahania sa jeho obsah nesmie zmeniť.
    const beforeDrag = await strip.innerHTML();
    // Ťahanie musí začať na samotnom bežci - poslucháče sedia na ňom, nie na páse.
    const handle = await page.locator('#strip-marker-handle').boundingBox();
    if (!handle) throw new Error('bežec nemá rozmer');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    for (const frac of [0.4, 0.5, 0.6, 0.7]) await page.mouse.move(box.x + box.width * frac, y);
    await expect(page.locator('#drag-tooltip')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('#preview-banner')).toBeVisible();
    // 70 % šírky pásu je zhruba 16:48; presná minúta závisí od zaokrúhlenia pixelov.
    await expect(page.locator('#preview-time-label')).toHaveText(/^Náhľad · 1[67]:\d{2}$/);
    expect(await strip.innerHTML()).toBe(beforeDrag);

    // Nové dáta zo siete musia pás prekresliť aj vtedy, keď v ňom stojí náhľad.
    const halved = { ...forecast, hourlyToday: forecast.hourlyToday.map((h) => ({ ...h, kw: h.kw / 2 })) };
    await page.route(WORKER_URL, (route) => route.fulfill({ json: { pv, forecast: halved, servedAt: FIXED_NOW.toISOString() } }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => strip.innerHTML()).not.toBe(beforeDrag);
    expect(errors).toEqual([]);
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
    // Zajtra nemá nameranú výrobu, takže jej položka v legende musí zmiznúť - inak by
    // legenda ohlasovala krivku, ktorá sa v grafe nekreslí.
    await expect(page.locator('#forecast-live-legend')).toBeHidden();
    await expect(page.locator('#forecast-message-title')).not.toHaveText('Načítavam…');
    // Na mobile je tá istá správa duplicitne aj v karte Spotrebiče (v pageri) aj tu.
    await expect(page.locator('#forecast-msg-block')).toBeVisible();
    expect(errors).toEqual([]);
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
 * Karta 7 dní je na mobile rozdelená na dve obrazovky: prehľad (tri bubliny, tabuľka,
 * najsilnejší deň) a detail dňa, ktorý sa otvorí klikom na deň v tabuľke. V detaile ide
 * Denná výroba, Priebeh výroby a až potom Mapa výroby so zvýrazneným dňom.
 */
test('7 dní na mobile: prehľad dní, detail dňa a návrat späť', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    // Prehľad: bubliny a tabuľka, grafy sú až v detaile.
    await expect(page.locator('#week-tbody tr')).toHaveCount(7);
    await expect(page.locator('#week-today')).toHaveText(fmt1(forecast.days[0].kwhTotal));
    await expect(page.locator('#week-msg-title')).toContainText('Najsilnejší deň');
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-table']);

    // Percento využitia má odtieň podľa toho, aký silný deň je - očakávanie sa počíta tou
    // istou funkciou ako v appke. Štvrtý stĺpec tabuľky je Využitie.
    for (const [i, day] of forecast.days.entries())
        await expect(page.locator(`#week-tbody tr[data-day-index="${i}"] td:nth-child(4)`)).toHaveClass(`mid${useTier(usePct(day))}`);

    // Klik na deň otvorí jeho detail.
    await page.locator('#week-tbody tr[data-day-index="5"]').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[5].date, 5));
    await expect(page.locator('#week-trio')).toBeHidden();
    await expect(page.locator('#week-day-tabs')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-bars', 'week-block-curve', 'week-block-heat']);

    // Všetky tri grafy ukazujú ten istý deň: zvýraznený stĺpec, jeho krivka a riadok mapy.
    await expect(page.locator('#week-bars rect.bar.sel')).toHaveCount(1);
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(forecast.days[5].kwhTotal)} kWh`);
    await expect(page.locator('#week-heat .day-label.sel')).toHaveAttribute('data-day-index', '5');

    // Z detailu vedie späť jedine šípka vľavo hore. Atribút data-panel nesie aj #page, takže
    // klik kdekoľvek v stránke sa kedysi tváril ako prepnutie karty a detail zavrel.
    await page.locator('#week-curve-stat').click();
    await page.locator('#week-block-heat .chart-top').click();
    await expect(page.locator('#week-day-head')).toBeVisible();
    expect(await viditelneBloky(page)).toEqual(['week-block-bars', 'week-block-curve', 'week-block-heat']);

    // Späť sa vraciame na prehľad, výber dňa v ňom ostáva.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    await expect(page.locator('#week-tbody tr.sel')).toHaveAttribute('data-day-index', '5');
    expect(await viditelneBloky(page)).toEqual(['week-block-table']);

    // Odchod na inú kartu a návrat začína zase na prehľade.
    await page.locator('#nav-terazky').click();
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(errors).toEqual([]);
});

/** Na širokej obrazovke je na celú kartu miesto naraz - detail dňa sa tam neotvára a klik
 * v tabuľke, v prepínači dní aj v grafoch len prepína vybraný deň, ako doteraz. */
test('7 dní na desktope: karta ostáva celá, výber dňa naprieč komponentmi', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
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
 * Karta "Dnes" má najviac dát (odznak počasia, špičku, priebeh dňa), preto dostane na
 * mobile celú šírku (Zajtra a 7 dní spolu sú vedľa seba užšie) a s ňou aj meta riadok,
 * ktorý má inak (pre nedostatok miesta) zobrazený len desktop - inak by tam ostal
 * nevyužitý priestor.
 */
test('7 dní: karta "Dnes" má na mobile aj meta riadok z desktop verzie', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    const today = forecast.days[0];
    const pct = usePct(today);
    const expectedMeta =
        `⚡ ${today.peakKw.toFixed(1)} kW o ${hourLabel(today.peakHour)}` + (pct == null ? '' : `${pct} % z jasnej oblohy`);
    await expect(page.locator('#week-today-meta')).toBeVisible();
    await expect(page.locator('#week-today-meta')).toHaveText(expectedMeta);
    // Zajtra/7 dní spolu ostávajú na mobile bez meta riadku - na to majú príliš úzky stĺpec.
    await expect(page.locator('#week-tomorrow-meta')).toBeHidden();
    await expect(page.locator('#week-total-meta')).toBeHidden();
    expect(errors).toEqual([]);
});

test('zdieľať: odkaz na appku', async ({ page }) => {
    await openApp(page);
    await page.locator('#nav-zdielat').click();
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
    for (const nav of ['#nav-predpoved', '#nav-7dni', '#nav-zdielat', '#nav-terazky']) await page.locator(nav).click();

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

test('prístupnosť: žiadne závažné nálezy axe na žiadnej karte', async ({ page }) => {
    await openApp(page);
    for (const panel of ['terazky', 'predpoved', '7dni', 'zdielat']) {
        await page.locator(`#nav-${panel}`).click();
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
    // Detail dňa je vlastná obrazovka s vlastným ovládaním (šípka späť), preto sa kontroluje zvlášť.
    await page.locator('#nav-7dni').click();
    await page.locator('#week-tbody tr[data-day-index="5"]').click();
    const detail = await new AxeBuilder({ page }).analyze();
    const vazne = detail.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(vazne.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('široká obrazovka: Spotrebiče a Predpoveď vedľa seba', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await expect(page.locator('#panel-terazky')).toBeVisible();
    await expect(page.locator('#panel-predpoved')).toBeVisible();
    // Karta Predpoveď tu nemá vlastnú položku v navigácii - je vidno rovno vedľa Spotrebičov.
    await expect(page.locator('#nav-predpoved')).toBeHidden();
    // Plátno grafu sa na širokej karte kreslí na jej skutočný rozmer (fillDims), nie na pevné
    // 680x420 - viewBox preto musí sedieť s pixelmi 1:1, inak by sa graf naťahoval a popisky
    // skresľovali. Zároveň mu musí ostať kladná plocha pod okrajmi plátna.
    const chart = await page.evaluate(() => {
        const el = document.getElementById('forecast-chart');
        const [, , vw, vh] = (el.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const r = el.getBoundingClientRect();
        return { vw, vh, w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(Math.abs(chart.vw - chart.w), `šírka plátna ${chart.vw} nesedí s kartou ${chart.w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(chart.vh - chart.h), `výška plátna ${chart.vh} nesedí s kartou ${chart.h}`).toBeLessThanOrEqual(1);
    // padT (18) + padB (34) z chartDims; pod tým by graf kreslil do zápornej plochy.
    expect(chart.vh, 'plátno grafu je nižšie než jeho vlastné okraje').toBeGreaterThan(18 + 34);
    // Odznak s tarifou nikde nad ciferníkom nie je (ani na desktope) - žije len v defaultnej
    // prvej stránke pageru, tá preto nesmie ostať prázdna.
    const expectedEyebrow = modelAt(atTime('13:00').wall).eyebrow;
    await expect(page.locator('#verdict-dots .pager-dot').first()).toHaveClass(/active/);
    await expect(page.locator('#verdict-page-eyebrow')).toBeVisible();
    await expect(page.locator('#verdict-page-eyebrow')).toHaveText(expectedEyebrow);
    // Správa o predpovedi dňa je na desktope už len v pageri, v karte Predpoveď sa neduplikuje.
    await expect(page.locator('#verdict-forecast-title')).toHaveText(todayForecastMsg.title);
    await expect(page.locator('#forecast-msg-block')).toBeHidden();
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
            pasDnaSpodok: document.querySelector('.col-b').getBoundingClientRect().bottom,
            navVrch: document.querySelector('.bottomnav').getBoundingClientRect().top,
        }));
        expect(geometria.pasDnaSpodok, `výška ${height}px: pás dňa zapadá pod spodnú navigáciu`).toBeLessThanOrEqual(geometria.navVrch);

        await expect(page.locator('.dial-svg'), `výška ${height}px`).toBeVisible();
        await expect(page.locator('#verdict-dots'), `výška ${height}px`).toBeVisible();
        await expect(page.locator('.strip-ticks'), `výška ${height}px`).toBeVisible();
        expect(errors).toEqual([]);
    }
});

/**
 * Pod 620px výšky sa režim obrazovky nezapne a karta je bežný dokument. Je to zámer:
 * v režime obrazovky sa pretečený obsah odstrihne (.page { overflow: hidden }), a odstrihnúť
 * časovú os pása dňa je horšie než dovoliť scroll. Podmienka je na výšku, nie na
 * orientáciu, preto sa skúša aj nízka výška na výšku (390x520), aj telefón na šírku
 * (740x360). Po doscrollovaní nadol musí byť celý pás dňa nad spodnou navigáciou - teda
 * dostupný, nie odstrihnutý ani zakrytý.
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
            pasDnaSpodok: document.querySelector('.col-b').getBoundingClientRect().bottom,
            navVrch: document.querySelector('.bottomnav').getBoundingClientRect().top,
        }));
        expect(geometria.pasDnaSpodok, `${rozmer}: pás dňa sa ani po doscrollovaní nedostane nad spodnú navigáciu`).toBeLessThanOrEqual(
            geometria.navVrch,
        );

        await expect(page.locator('.dial-svg'), rozmer).toBeVisible();
        await expect(page.locator('.strip-ticks'), rozmer).toBeVisible();
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
    for (const panel of ['terazky', 'predpoved', '7dni', 'zdielat']) {
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
    await expect(page.locator('#panel-predpoved')).toBeHidden();
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
    await page.locator('#week-tbody tr[data-day-index="0"]').click();
    await expect(page.locator('#week-bars .clear-cap')).toHaveCount(7);
    await expect(page.locator('#week-bars-clear-legend')).toBeVisible();
    expect(errors).toEqual([]);
});

/**
 * Správa "Najsilnejší deň" (.msg-block) je v HTML naschvál posledným potomkom .week-grid,
 * hneď za kartou tabuľky - na mobile a tablete tak ostáva presne tam, kde bola predtým
 * (vlastná karta hneď za Prehľadom dní). Na desktope zdieľa s kartou tabuľky
 * (.week-block:nth-child(4)) tú istú bunku a align-self ju zospodu zasunie do voľného
 * miesta pod siedmimi riadkami - nesmie prekryť ani posunúť samotnú tabuľku.
 */
test('7 dní - správa "Najsilnejší deň": na desktope pod tabuľkou v tej istej karte, na mobile za ňou', async ({ page }) => {
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
    const mobile = await page.evaluate(() => ({
        msgTop: document.querySelector('#panel-7dni .msg-block').getBoundingClientRect().top,
        tableBottom: document.querySelector('#panel-7dni .week-block:nth-child(4)').getBoundingClientRect().bottom,
    }));
    expect(mobile.msgTop).toBeGreaterThanOrEqual(mobile.tableBottom - 1);
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

/** @param {import('@playwright/test').Page} page @param {string} panel */
async function ocakavajKartu(page, panel) {
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
}

test.describe('listovanie kariet prstom', () => {
    test.use({ hasTouch: true });

    test('ťah do strán prepína karty v poradí navigácie, na kraji sa zastaví', async ({ page }) => {
        const errors = await openApp(page);
        await ocakavajKartu(page, 'terazky');

        // Doľava sa ide dopredu v poradí navigácie, doprava späť.
        await swipe(page, '#dial-hero', { dx: -120 });
        await ocakavajKartu(page, 'predpoved');
        await swipe(page, '#forecast-sub', { dx: -120 });
        await ocakavajKartu(page, '7dni');
        await swipe(page, '#week-sub', { dx: 120 });
        await ocakavajKartu(page, 'predpoved');
        await swipe(page, '#forecast-sub', { dx: 120 });
        await ocakavajKartu(page, 'terazky');

        // Pred prvou kartou už nič nie je - listovanie sa nezacyklí.
        await swipe(page, '#dial-hero', { dx: 120 });
        await ocakavajKartu(page, 'terazky');

        // Šikmý ťah je posúvanie po stránke, nie listovanie.
        await swipe(page, '#dial-hero', { dx: -120, dy: 120 });
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('kolotoč odporúčaní si ťahanie necháva pre seba', async ({ page }) => {
        const errors = await openApp(page);

        // Swipe pole pod ciferníkom je vnútorný pás, ktorý sa má stále kam posunúť (pred prvou
        // a za poslednou stránkou má klony), takže gesto patrí jemu a karta ostáva.
        await swipe(page, '#verdict-pager', { dx: -120 });
        await ocakavajKartu(page, 'terazky');
        await swipe(page, '#verdict-pager', { dx: 120 });
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('nad grafom prepne kartu švihnutie, pomalé sledovanie krivky nie', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-predpoved').click();

        // Ťahaním po krivke sa graf prezerá (tooltip ide za prstom) - to nie je listovanie.
        await swipe(page, '#forecast-chart-wrap', { dx: -120, ms: 500 });
        await ocakavajKartu(page, 'predpoved');
        await expect(page.locator('#forecast-tooltip')).toHaveClass(/visible/);

        // Rýchle švihnutie ponad ten istý graf kartu prepne a tooltip po sebe upratá.
        await swipe(page, '#forecast-chart-wrap', { dx: -120 });
        await ocakavajKartu(page, '7dni');
        await expect(page.locator('#forecast-tooltip')).not.toHaveClass(/visible/);
        expect(errors).toEqual([]);
    });

    test('pri švihnutí ponad graf tooltip ani neprebliskne, ťuknutie ho ukáže', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-predpoved').click();

        // Kontrola na konci gesta nestačí - tooltip po prepnutí karty appka aj tak zatvára.
        // Preto sa sleduje trieda na tooltipe počas celého gesta.
        const sledujTooltip = () =>
            page.evaluate(() => {
                const el = /** @type {HTMLElement} */ (document.getElementById('forecast-tooltip'));
                window.tooltipBolVidno = el.classList.contains('visible');
                new MutationObserver(() => {
                    if (el.classList.contains('visible')) window.tooltipBolVidno = true;
                }).observe(el, { attributes: true, attributeFilter: ['class'] });
            });
        const boloVidno = () => page.evaluate(() => window.tooltipBolVidno);

        await sledujTooltip();
        await swipe(page, '#forecast-chart-wrap', { dx: -120 });
        await ocakavajKartu(page, '7dni');
        expect(await boloVidno(), 'tooltip preblikol počas švihnutia').toBe(false);

        // Ťuknutie na graf ho naopak ukázať musí - inak by sa hodnota nedala prečítať.
        // Aj tu sa pozerá na sledovanú triedu, nie na stav po chvíli: tooltip sa sám zatvára
        // po TOOLTIP_HOLD_MS a na zaťaženom stroji by sa kontrola trafila až za ten čas.
        await page.locator('#nav-predpoved').click();
        await sledujTooltip();
        await swipe(page, '#forecast-chart-wrap', { dx: 0 });
        expect(await boloVidno(), 'ťuknutie na graf neukázalo tooltip').toBe(true);
        await ocakavajKartu(page, 'predpoved');
        expect(errors).toEqual([]);
    });

    test('ťah ponad tabuľku 7 dní prepne kartu a neotvorí detail dňa', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();

        // Na tejto šírke sa tabuľka zmestí celá, nemá sa kam posúvať - gesto teda patrí karte.
        // Klik, ktorý by po ťahu otvoril detail dňa, appka zruší.
        await swipe(page, '#week-tbody', { dx: -120 });
        await ocakavajKartu(page, 'zdielat');
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-day-head')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('na úzkom displeji si posuvná tabuľka 7 dní ťahanie necháva', async ({ page }) => {
        // Do ~360 px tabuľka pretečie a dá sa posúvať do strán. Kým má kam ísť, patrí gesto
        // jej - inak by sa posledný stĺpec na takom telefóne nedal pozrieť.
        await page.setViewportSize({ width: 320, height: 844 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await swipe(page, '#week-tbody', { dx: -120 });
        await ocakavajKartu(page, '7dni');

        // Na ľavom kraji už tabuľka doprava nemá kam ísť, tam gesto prevezme karta.
        await page.evaluate(() => document.querySelector('.week-tbl-wrap')?.scrollTo({ left: 0 }));
        await swipe(page, '#week-tbody', { dx: 120 });
        await ocakavajKartu(page, 'predpoved');
        expect(errors).toEqual([]);
    });

    test('ťah ponad pás dňa prepne kartu a nenastaví náhľad iného času', async ({ page }) => {
        const errors = await openApp(page);

        // Pás dňa je na mobile veľká plocha, listovať sa cez ňu dá. Klik naň ale nastavuje
        // náhľad iného času - po geste ho preto appka potlačí, aj keď gesto narazí na kraj.
        await swipe(page, '#daystrip-wrap', { dx: 120 });
        await ocakavajKartu(page, 'terazky');
        await expect(page.locator('#preview-banner')).toBeHidden();

        await swipe(page, '#daystrip-wrap', { dx: -120 });
        await ocakavajKartu(page, 'predpoved');
        await page.locator('#nav-terazky').click();
        await expect(page.locator('#preview-banner')).toBeHidden();

        // Obyčajné ťuknutie na pás náhľad nastaví ako doteraz.
        await page.locator('#daystrip-wrap').click({ position: { x: 40, y: 20 } });
        await expect(page.locator('#preview-banner')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('v detaile dňa vedie ťah doprava späť na prehľad, doľava na ďalšiu kartu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#week-tbody tr[data-day-index="3"]').click();
        await expect(page.locator('#week-day-head')).toBeVisible();

        // Detail dňa je podobrazovka karty - doprava sa z neho ide späť na prehľad dní,
        // nie rovno na predchádzajúcu kartu.
        await swipe(page, '#week-day-head', { dx: 120 });
        await expect(page.locator('#week-day-head')).toBeHidden();
        await ocakavajKartu(page, '7dni');

        // Doľava sa z detailu ide na ďalšiu kartu, detail sa pritom zavrie.
        await page.locator('#week-tbody tr[data-day-index="3"]').click();
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajKartu(page, 'zdielat');
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-day-head')).toBeHidden();
        expect(errors).toEqual([]);
    });
});
