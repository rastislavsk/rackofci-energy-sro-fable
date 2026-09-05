// Všetky DOM referencie na jednom mieste, načítané raz po naparsovaní stránky.
// Render funkcie dostávajú tento objekt a nikdy nevolajú querySelector samy.

const byId = (/** @type {string} */ id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Chýba element #${id}`);
    return el;
};

export const PANELS = /** @type {const} */ (['spotrebice', 'predpoved', '7dni', 'zdielat']);

function headerDom() {
    return {
        page: byId('page'),
        headerStatusDot: byId('header-status-dot'),
        currentTimeDisplay: byId('current-time-display'),
        pvUpdated: byId('pv-updated'),
        panels: /** @type {Record<(typeof PANELS)[number], HTMLElement>} */ (
            Object.fromEntries(PANELS.map((p) => [p, byId(`panel-${p}`)]))
        ),
        navs: /** @type {Record<(typeof PANELS)[number], HTMLElement>} */ (Object.fromEntries(PANELS.map((p) => [p, byId(`nav-${p}`)]))),
    };
}

function spotrebiceDom() {
    return {
        previewBanner: byId('preview-banner'),
        previewPill: byId('preview-pill'),
        previewTimeLabel: byId('preview-time-label'),
        previewReset: byId('preview-reset'),
        verdictEyebrow: byId('verdict-eyebrow'),
        dialRing: byId('dial-ring'),
        pvPower: byId('pv-power'),
        pvPowerUnit: byId('pv-power-unit'),
        verdictHeadline: byId('verdict-headline'),
        verdictBody: byId('verdict-body'),
        verdictGoRow: byId('verdict-go-row'),
        verdictWaitChip: byId('verdict-wait-chip'),
        verdictWaitTime: byId('verdict-wait-time'),
        stripLegend: byId('strip-legend'),
        stripLegendReal: byId('strip-legend-real'),
        seasonIndicator: byId('season-indicator'),
        daystripWrap: byId('daystrip-wrap'),
        daystrip: byId('daystrip'),
        stripNowGhost: byId('strip-now-ghost'),
        stripNowMarker: byId('strip-now-marker'),
        dragTooltip: byId('drag-tooltip'),
        stripMarkerHandle: byId('strip-marker-handle'),
    };
}

function predpovedDom() {
    return {
        forecastSub: byId('forecast-sub'),
        dayBtnToday: byId('day-btn-today'),
        dayBtnTomorrow: byId('day-btn-tomorrow'),
        forecastPeak: byId('forecast-peak'),
        forecastPeakTime: byId('forecast-peak-time'),
        forecastPeakRealCol: byId('forecast-peak-real-col'),
        forecastPeakReal: byId('forecast-peak-real'),
        forecastPeakRealTime: byId('forecast-peak-real-time'),
        forecastTotal: byId('forecast-total'),
        forecastTotalRealCol: byId('forecast-total-real-col'),
        forecastTotalReal: byId('forecast-total-real'),
        forecastNowBadge: byId('forecast-now-badge'),
        forecastNowTime: byId('forecast-now-time'),
        forecastChartWrap: byId('forecast-chart-wrap'),
        forecastChart: byId('forecast-chart'),
        forecastTooltip: byId('forecast-tooltip'),
        forecastLiveLegend: byId('forecast-live-legend'),
        forecastMessageTitle: byId('forecast-message-title'),
        forecastMessageBody: byId('forecast-message-body'),
    };
}

function sedemdniDom() {
    return {
        weekSub: byId('week-sub'),
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
        weekHeatScale: byId('week-heat-scale'),
        weekHeatWrap: byId('week-heat-wrap'),
        weekHeat: byId('week-heat'),
        weekHeatTooltip: byId('week-heat-tooltip'),
        weekBarsStat: byId('week-bars-stat'),
        weekBarsWrap: byId('week-bars-wrap'),
        weekBars: byId('week-bars'),
        weekBarsTooltip: byId('week-bars-tooltip'),
        weekDayTabs: byId('week-day-tabs'),
        weekCurveStat: byId('week-curve-stat'),
        weekCurveWrap: byId('week-curve-wrap'),
        weekCurve: byId('week-curve'),
        weekCurveTooltip: byId('week-curve-tooltip'),
        weekTbody: byId('week-tbody'),
        weekMsgTitle: byId('week-msg-title'),
        weekMsgBody: byId('week-msg-body'),
    };
}

function zdielatDom() {
    return {
        qrcode: byId('qrcode'),
        shareWhatsapp: /** @type {HTMLAnchorElement} */ (byId('share-whatsapp')),
        shareUrl: byId('share-url'),
    };
}

export function collectDom() {
    return { ...headerDom(), ...spotrebiceDom(), ...predpovedDom(), ...sedemdniDom(), ...zdielatDom() };
}

/** @typedef {ReturnType<typeof collectDom>} Dom */
