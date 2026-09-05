// Jediný zdroj pravdy pre doménové konštanty appky (lokalita, elektráreň, tarify,
// hranice výkonu, spotrebiče). Používa ho prehliadač, Cloudflare Worker aj testy.
// Žiadne z týchto čísel sa nesmie objaviť natvrdo inde v kóde.

/** @typedef {'summer' | 'winter'} Season */
/** @typedef {'red' | 'amber' | 'green'} Tier */

export const SITE = {
    name: 'Dvorany nad Nitrou',
    lat: 48.48,
    lon: 18.12,
    elevationM: 180,
    timezone: 'Europe/Bratislava',
};

// Zostava fotovoltiky: dve skupiny stringov (juh + východ), rovnaký sklon.
export const PLANT = {
    strings: [
        { panels: 16, azimuthDeg: 180, tiltDeg: 40 },
        { panels: 8, azimuthDeg: 90, tiltDeg: 40 },
    ],
    panelWp: 435,
    acLimitKw: 10,
    systemEfficiency: 0.88,
    tempCoefPctPerC: -0.41,
    noctC: 45,
    albedo: 0.2,
};

/** Inštalovaný výkon v kWp odvodený zo zostavy (24 × 435 Wp = 10,44 kWp, zaokrúhlené na desatinu). */
export const INSTALLED_PV_KW = Math.round((PLANT.strings.reduce((sum, s) => sum + s.panels, 0) * PLANT.panelWp) / 100) / 10;

// Bezoblačný model (Meinel + Laueho výšková korekcia) - horný strop výroby.
export const CLEAR_SKY = { tau: 0.8, dhiFraction: 0.12 };

// Hranice výkonu FV, na ktorých stojí farba aj text odporúčaní.
export const POWER_LOW_KW = 2; // pod touto hodnotou panely "nedávajú veľa"
export const POWER_HIGH_KW = 4; // od tejto hodnoty je výroba "vysoká"
export const STRONGER_WINDOW_MARGIN_KW = 1.5; // o koľko musí byť budúce okno lepšie než teraz

// Predpoveď: koľko dní z Open-Meteo (9 = rezerva, aby 7 miestnych dní bolo úplných aj s posunom UTC).
export const FORECAST_API_DAYS = 9;
export const FORECAST_DAYS_SHOWN = 7;
export const OPEN_METEO_URL =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${SITE.lat}&longitude=${SITE.lon}` +
    '&hourly=shortwave_radiation,direct_normal_irradiance,diffuse_radiation,temperature_2m,cloud_cover' +
    `&forecast_days=${FORECAST_API_DAYS}&timezone=UTC`;

/**
 * Tarifné okná dňa. Poradie je chronologické, nočné okno prechádza cez polnoc.
 * `seasons` hovorí, v ktorej sezóne okno platí; `devices` sú odporúčané spotrebiče
 * v jedinom zelenom okne. `night` označuje slot, kde text neprepisuje predpoveď.
 * @type {Array<{start: string, end: string, status: Tier, seasons: Season[], title: string, sub: string, devices?: string[], night?: boolean}>}
 */
export const TARIFF_WINDOWS = [
    {
        start: '23:30',
        end: '07:30',
        status: 'amber',
        seasons: ['summer', 'winter'],
        night: true,
        title: 'Lacný nočný prúd',
        sub: 'Slnko nesvieti, no sieť je lacná. Vhodné na bojler a nabíjanie auta.',
    },
    {
        start: '07:30',
        end: '08:30',
        status: 'red',
        seasons: ['summer', 'winter'],
        title: 'Najdrahšia sieť',
        sub: 'Nezapínať veľké spotrebiče',
    },
    { start: '08:30', end: '09:30', status: 'amber', seasons: ['summer', 'winter'], title: 'Menšie spotrebiče', sub: '' },
    { start: '09:30', end: '10:30', status: 'red', seasons: ['summer', 'winter'], title: 'Najdrahšia sieť', sub: 'Ešte chvíľu vydržať' },
    {
        start: '10:30',
        end: '17:30',
        status: 'green',
        seasons: ['summer'],
        devices: ['Práčka', 'Sušička', 'Umývačka', 'Auto', 'Bojler'],
        title: 'Ideálne okno',
        sub: 'Silné slnko, plný výkon zadarmo. Zapni práčku, umývačku, čo potrebuješ.',
    },
    {
        start: '10:30',
        end: '14:30',
        status: 'green',
        seasons: ['winter'],
        devices: ['Práčka', 'Auto', 'Bojler'],
        title: 'Krátke okno',
        sub: 'Opatrne — nepúšťať všetko naraz.',
    },
    {
        start: '17:30',
        end: '20:30',
        status: 'amber',
        seasons: ['summer'],
        title: 'Bežná prevádzka',
        sub: 'Slnko klesá, už iba malé spotrebiče',
    },
    { start: '14:30', end: '20:30', status: 'amber', seasons: ['winter'], title: 'Skorá tma', sub: 'Lacná sieť bez slnka' },
    { start: '20:30', end: '21:30', status: 'red', seasons: ['summer', 'winter'], title: 'Najdrahšia sieť', sub: '' },
    { start: '21:30', end: '22:30', status: 'amber', seasons: ['summer', 'winter'], title: 'OK (Lacná)', sub: '' },
    { start: '22:30', end: '23:30', status: 'red', seasons: ['summer', 'winter'], title: 'Najdrahšia sieť', sub: '' },
];

// Leto = marec až október, zima = november až február.
export const SUMMER_MONTHS = { from: 3, to: 10 };

// Nočná NT sadzba pre auto bez ohľadu na výkon FV.
export const AUTO_NIGHT_WINDOW = { start: '23:30', end: '06:00' };

/** Spotrebiče v pevnom poradí (riadky v karte nepreskakujú) s typickým príkonom v kW. */
export const DEVICES = [
    { name: 'Práčka', powerKw: 2 },
    { name: 'Sušička', powerKw: 1.5 },
    { name: 'Umývačka', powerKw: 1.5 },
    { name: 'Auto', powerKw: 11 },
    { name: 'Bojler', powerKw: 2 },
];

// Auto má vlastný (vyšší) prah výkonu FV, pri ktorom sa oplatí nabíjať zo slnka.
export const AUTO_MIN_PV_KW = POWER_HIGH_KW;

// Kde appka beží a odkiaľ číta dáta.
export const APP_URL = 'https://rastislavsk.github.io/rackofci-energy-sro-fable/';
export const WORKER_URL = 'https://rackofci-energy-sro-fable.rastislav-racek.workers.dev/';
// Dočasný záložný zdroj, kým nový Worker nebeží: dáta pôvodnej appky (rovnaký formát).
export const LEGACY_SOURCES = {
    pv: 'https://pv-proxy.rastislav-racek.workers.dev/',
    forecast: 'https://rastislavsk.github.io/Kedy-zapinat-spotrebice-Claude/data/forecast.json',
};

// Ako často sa čo obnovuje (ms).
export const REFRESH = {
    clockMs: 30 * 1000,
    dataMs: 60 * 1000,
};

// Ako dlho ostáva tooltip po ťuknutí zobrazený (ms).
export const TOOLTIP_HOLD_MS = 1600;

// Dáta staršie než toto sú "zastarané" a appka to ukáže.
export const STALE_PV_MS = 20 * 60 * 1000;
export const STALE_FORECAST_MS = 3 * 60 * 60 * 1000;
