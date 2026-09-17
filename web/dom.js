// Všetky DOM referencie na jednom mieste, načítané raz po naparsovaní stránky.
// Render funkcie dostávajú tento objekt a nikdy nevolajú querySelector samy.

const byId = (/** @type {string} */ id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Chýba element #${id}`);
    return el;
};

// Karty v poradí navigácie. Kódový názov a popiska v navigácii nie sú vždy to isté slovo,
// preto tu ostáva mapovanie: terazky = „Terazky", 7dni = „7 dní", zdielat = „Zdieľať".
// Popiska je text pre používateľa a mení sa podľa chuti; kódový názov drží HTML id,
// CSS selektory aj stav, tak nech ho popiska nemusí naháňať.
export const PANELS = /** @type {const} */ (['terazky', '7dni', 'zdielat']);

function headerDom() {
    return {
        // <html>, nie <body>: farba tarify sa zapisuje sem, lebo --bg-page je zložené
        // z --tint-rgb a obe musia byť na tom istom prvku (viď :root v style.css).
        root: document.documentElement,
        page: byId('page'),
        currentTimeDisplay: byId('current-time-display'),
        pvUpdated: byId('pv-updated'),
        panels: /** @type {Record<(typeof PANELS)[number], HTMLElement>} */ (
            Object.fromEntries(PANELS.map((p) => [p, byId(`panel-${p}`)]))
        ),
        navs: /** @type {Record<(typeof PANELS)[number], HTMLElement>} */ (Object.fromEntries(PANELS.map((p) => [p, byId(`nav-${p}`)]))),
    };
}

function terazkyDom() {
    return {
        previewReset: byId('preview-reset'),
        verdictPageForecast: byId('verdict-page-forecast'),
        verdictForecastTitle: byId('verdict-forecast-title'),
        verdictForecastBody: byId('verdict-forecast-body'),
        verdictPageCloneStart: byId('verdict-page-clone-start'),
        verdictPageCloneEnd: byId('verdict-page-clone-end'),
        dialRing: byId('dial-ring'),
        pvPower: byId('pv-power'),
        pvPowerUnit: byId('pv-power-unit'),
        verdictHeadline: byId('verdict-headline'),
        // Prvá reálna stránka pageru. Vlastné id nemá zámerne: appka ho smie vyžadovať až
        // nasadenie po tom, čo sa objaví v HTML (viď CLAUDE.md), a nadpis v nej je rovnako
        // spoľahlivá kotva. Klonuje sa za poslednú stránku, viď syncPagerClones v terazky.js.
        verdictPageNow: /** @type {HTMLElement} */ (byId('verdict-headline').closest('.pager-page')),
        verdictBody: byId('verdict-body'),
        verdictGoRow: byId('verdict-go-row'),
        verdictPager: byId('verdict-pager'),
        verdictPageWait: byId('verdict-page-wait'),
        verdictDotButtons: /** @type {HTMLElement[]} */ (Array.from(byId('verdict-dots').querySelectorAll('.pager-dot'))),
        verdictDotWait: byId('verdict-dot-wait'),
        verdictChipTooltip: byId('verdict-chip-tooltip'),
        verdictWaitTime: byId('verdict-wait-time'),
        dialWrap: byId('dial-wrap'),
        dayRing: byId('day-ring'),
        dialWhen: byId('dial-when'),
        dialNow: byId('dial-now'),
        dialGrip: byId('dial-grip'),
        infoOverlay: byId('info-overlay'),
    };
}

function sedemdniDom() {
    return {
        weekSub: byId('week-sub'),
        weekHead: byId('week-head'),
        weekTrio: byId('week-trio'),
        weekDayHead: byId('week-day-head'),
        weekDayBack: byId('week-day-back'),
        weekDayTitle: byId('week-day-title'),
        weekGrid: byId('week-grid'),
        weekBlockHeat: byId('week-block-heat'),
        weekBlockBars: byId('week-block-bars'),
        weekBlockCurve: byId('week-block-curve'),
        weekBlockTable: byId('week-block-table'),
        weekBlockList: byId('week-block-list'),
        weekMsgBlock: byId('week-msg-block'),
        weekToday: byId('week-today'),
        weekTodayBadge: byId('week-today-badge'),
        weekTodayMeta: byId('week-today-meta'),
        weekTodayProgress: byId('week-today-progress'),
        weekTodayProgressFill: byId('week-today-progress-fill'),
        weekTodayProgressTxt: byId('week-today-progress-txt'),
        weekTodayProgressPct: byId('week-today-progress-pct'),
        weekTomorrow: byId('week-tomorrow'),
        weekTomorrowBadge: byId('week-tomorrow-badge'),
        weekTomorrowTrend: byId('week-tomorrow-trend'),
        weekTomorrowMeta: byId('week-tomorrow-meta'),
        weekTotal: byId('week-total'),
        weekTotalMeta: byId('week-total-meta'),
        weekHeatLabel: byId('week-heat-label'),
        weekHeatScale: byId('week-heat-scale'),
        weekHeatWrap: byId('week-heat-wrap'),
        weekHeat: byId('week-heat'),
        weekHeatTooltip: byId('week-heat-tooltip'),
        weekBarsStat: byId('week-bars-stat'),
        weekBarsWrap: byId('week-bars-wrap'),
        weekBars: byId('week-bars'),
        weekBarsTooltip: byId('week-bars-tooltip'),
        weekBarsClearLegend: byId('week-bars-clear-legend'),
        weekDayTabs: byId('week-day-tabs'),
        weekCurveLiveLegend: byId('week-curve-live-legend'),
        weekCurveStat: byId('week-curve-stat'),
        weekCurveWrap: byId('week-curve-wrap'),
        weekCurve: byId('week-curve'),
        weekCurveTooltip: byId('week-curve-tooltip'),
        weekTbody: byId('week-tbody'),
        weekList: byId('week-list'),
        weekListTotal: byId('week-list-total'),
        weekListAvg: byId('week-list-avg'),
        weekMsgTitle: byId('week-msg-title'),
        weekMsgBody: byId('week-msg-body'),
    };
}

function zdielatDom() {
    return {
        qrcode: byId('qrcode'),
        shareWhatsapp: /** @type {HTMLAnchorElement} */ (byId('share-whatsapp')),
    };
}

export function collectDom() {
    return { ...headerDom(), ...terazkyDom(), ...sedemdniDom(), ...zdielatDom() };
}

/** @typedef {ReturnType<typeof collectDom>} Dom */
