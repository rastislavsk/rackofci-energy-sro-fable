// Karta Predpoveď: graf Dnes/Zajtra, štatistiky a správa dňa.

import { chartDims, fillDims, forecastChartModel, realProductionSoFar } from '../../shared/chart-model.js';
import { INSTALLED_PV_KW, SITE } from '../../shared/config.js';
import { fmt1, hourFloatToTimeStr, hourLabel, pad2 } from '../../shared/format.js';
import { EMPTY_MESSAGES, forecastDayMessage } from '../../shared/messages.js';
import { changedKeys } from '../memo.js';
import { forecastChartSvg } from '../svg.js';

/**
 * Plátno grafu: keď poznáme skutočný rozmer karty, kreslíme presne naň (viewBox potom sedí
 * s pixelmi 1:1, takže sa nič neskresľuje ani nezostáva prázdne). Kým rozmer nepoznáme,
 * platí pevné plátno podľa šírky okna.
 * @param {import('../state.js').AppState} state @param {string} key
 */
export function dimsFor(state, key) {
    // Len na širokej karte: fillDims berie okraje zo širokého plátna (os Y, väčšie odsadenie),
    // na mobile by tým prepísalo úmyselne úspornejšie rozloženie z chartDims(false).
    const size = state.wide ? state.chartSizes[key] : null;
    return size ? fillDims(size.w, size.h) : chartDims(state.wide);
}

/** Vstup grafu odvodený zo stavu - rovnaký pre render aj pre tooltip. @param {import('../state.js').AppState} state */
export function forecastChartInput(state) {
    const isToday = state.forecastDay === 'today';
    const pts = state.forecast ? (isToday ? state.forecast.hourlyToday : state.forecast.hourlyTomorrow) : [];
    return {
        pts,
        realPts: isToday && state.pv ? state.pv.realCurveToday : [],
        nowHour: isToday ? state.now.getHours() + state.now.getMinutes() / 60 : null,
        dims: dimsFor(state, 'forecast'),
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
    // Táto karta nezávisí od náhľadu času ani od ťahania bežca. Na desktope však stojí vedľa
    // Spotrebičov, takže sa pri každom pohybe prsta prekresľovala nadarmo - a hlavne špinila
    // layout, čo zdražilo ďalší krok gesta. Preto sa prekresľuje len pri zmene vlastných vstupov.
    const nowHour = state.now.getHours() + state.now.getMinutes() / 60;
    if (!changedKeys('predpoved', [state.forecast, state.pv, state.forecastDay, state.wide, state.desktop, nowHour, state.chartSizes]))
        return;

    // Tá istá správa je aj vlastnou stránkou v pageri karty Spotrebiče (vždy, aj na desktope) -
    // tu na desktope už nie je čo duplikovať, na mobile a tablete ostáva na oboch miestach.
    dom.forecastMsgBlock.classList.toggle('hidden', state.desktop);
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
