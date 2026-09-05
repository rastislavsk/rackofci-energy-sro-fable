// Karta Predpoveď: graf Dnes/Zajtra, štatistiky a správa dňa.

import { chartDims, forecastChartModel, realProductionSoFar } from '../../shared/chart-model.js';
import { INSTALLED_PV_KW, SITE } from '../../shared/config.js';
import { fmt1, hourFloatToTimeStr, hourLabel, pad2 } from '../../shared/format.js';
import { EMPTY_MESSAGES, forecastDayMessage } from '../../shared/messages.js';
import { forecastChartSvg } from '../svg.js';

/** Vstup grafu odvodený zo stavu - rovnaký pre render aj pre tooltip. @param {import('../state.js').AppState} state */
export function forecastChartInput(state) {
    const isToday = state.forecastDay === 'today';
    const pts = state.forecast ? (isToday ? state.forecast.hourlyToday : state.forecast.hourlyTomorrow) : [];
    return {
        pts,
        realPts: isToday && state.pv ? state.pv.realCurveToday : [],
        nowHour: isToday ? state.now.getHours() + state.now.getMinutes() / 60 : null,
        dims: chartDims(state.wide),
    };
}

/** @param {import('../state.js').AppState} state */
export function forecastModel(state) {
    return forecastChartModel(forecastChartInput(state));
}

/** Skutočná špička a výroba dnes doteraz (len na karte Dnes). @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderRealStats(state, dom) {
    const real = state.forecastDay === 'today' ? realProductionSoFar(state.pv) : null;
    const hasPeak = !!(real && Number.isFinite(real.peakKw) && Number.isFinite(real.peakHour));
    dom.forecastPeakRealCol.classList.toggle('hidden', !hasPeak);
    if (hasPeak && real) {
        dom.forecastPeakReal.textContent = /** @type {number} */ (real.peakKw).toFixed(1);
        dom.forecastPeakRealTime.textContent = `o ${hourFloatToTimeStr(/** @type {number} */ (real.peakHour))}`;
    }
    const hasTotal = !!(real && Number.isFinite(real.total));
    dom.forecastTotalRealCol.classList.toggle('hidden', !hasTotal);
    if (hasTotal && real) dom.forecastTotalReal.textContent = /** @type {number} */ (real.total).toFixed(1);
}

/** @param {import('../dom.js').Dom} dom */
function renderEmpty(dom) {
    dom.forecastChart.innerHTML = '';
    dom.forecastNowBadge.classList.add('hidden');
    dom.forecastLiveLegend.classList.add('hidden');
    dom.forecastPeak.textContent = '–';
    dom.forecastPeakTime.textContent = '–';
    dom.forecastTotal.textContent = '–';
    dom.forecastPeakRealCol.classList.add('hidden');
    dom.forecastTotalRealCol.classList.add('hidden');
    dom.forecastMessageTitle.textContent = EMPTY_MESSAGES.forecast.title;
    dom.forecastMessageBody.textContent = EMPTY_MESSAGES.forecast.body;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderPredpoved(state, dom) {
    dom.forecastSub.textContent = `${SITE.name} · ${fmt1(INSTALLED_PV_KW)} kWp`;
    const isToday = state.forecastDay === 'today';
    dom.dayBtnToday.classList.toggle('active', isToday);
    dom.dayBtnToday.setAttribute('aria-selected', String(isToday));
    dom.dayBtnTomorrow.classList.toggle('active', !isToday);
    dom.dayBtnTomorrow.setAttribute('aria-selected', String(!isToday));

    const m = forecastModel(state);
    if (!m) return renderEmpty(dom);

    dom.forecastChart.setAttribute('viewBox', `0 0 ${m.dims.w} ${m.dims.h}`);
    dom.forecastChart.innerHTML = forecastChartSvg(m);
    dom.forecastLiveLegend.classList.toggle('hidden', !m.real.length);
    dom.forecastNowBadge.classList.toggle('hidden', !isToday);
    dom.forecastNowTime.textContent = `teraz ${pad2(state.now.getHours())}:${pad2(state.now.getMinutes())}`;
    dom.forecastPeak.textContent = m.peak.kw.toFixed(1);
    dom.forecastPeakTime.textContent = `o ${hourLabel(m.peak.hour)}`;
    dom.forecastTotal.textContent = String(m.totalKwh);
    renderRealStats(state, dom);

    const msg = forecastDayMessage(m.pts, isToday);
    dom.forecastMessageTitle.textContent = msg.title;
    dom.forecastMessageBody.textContent = msg.body;
}
