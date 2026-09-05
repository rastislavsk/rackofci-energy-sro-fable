// Karta 7 dní: súhrn, mapa výroby, denné stĺpce, priebeh vybraného dňa, tabuľka, správa.

import { chartDims, forecastChartModel, usePct, weekBarsModel, weekHeatModel, weekStatsModel } from '../../shared/chart-model.js';
import { INSTALLED_PV_KW, SITE } from '../../shared/config.js';
import { escapeHtml, fmt1, hourLabel, weekDateLabel, weekDayShort } from '../../shared/format.js';
import { EMPTY_MESSAGES, weekMessage } from '../../shared/messages.js';
import { ICON_CLOUD, ICON_PARTLY, ICON_SUN } from '../icons.js';
import { forecastChartSvg, weekBarsSvg, weekHeatSvg } from '../svg.js';

/** @typedef {import('../../shared/solar.js').ForecastDay} ForecastDay */

/** Vstup grafu priebehu vybraného dňa - zdieľaný s tooltipom. @param {import('../state.js').AppState} state */
export function weekCurveModel(state) {
    const days = state.forecast ? state.forecast.days : [];
    const day = days[state.weekSelDay];
    if (!day) return null;
    const nowHour = state.weekSelDay === 0 ? state.now.getHours() + state.now.getMinutes() / 60 : null;
    return forecastChartModel({ pts: day.hourly, nowHour, dims: chartDims(state.wide) });
}

/** @param {boolean} sunny @param {number | null} cloudPct */
function weatherBadge(sunny, cloudPct) {
    if (sunny) return `<span class="stat-badge sun">${ICON_SUN}slnečno</span>`;
    if (cloudPct == null) return '';
    return `<span class="stat-badge cloud">${ICON_CLOUD}${Math.round(cloudPct)} % oblačno</span>`;
}

/** @param {ForecastDay} day */
function peakMetaLine(day) {
    if (!Number.isFinite(day.peakKw) || day.peakHour == null) return '';
    const pct = usePct(day);
    let html = `<span>⚡ <b>${day.peakKw.toFixed(1)} kW</b> o ${hourLabel(day.peakHour)}</span>`;
    if (pct != null) html += `<span>${pct} % z jasnej oblohy</span>`;
    return html;
}

/** @param {number | null} pct */
function trendBadge(pct) {
    if (pct === null || pct === 0) return '';
    return pct > 0 ? `<span class="trend up">▲ ${pct} %</span>` : `<span class="trend down">▼ ${Math.abs(pct)} %</span>`;
}

/** @param {ReturnType<typeof weekStatsModel>} s @param {import('../dom.js').Dom} dom */
function renderStats(s, dom) {
    dom.weekToday.textContent = fmt1(s.today.kwhTotal);
    dom.weekTodayBadge.innerHTML = weatherBadge(false, s.today.cloudAvgPct);
    dom.weekTodayMeta.innerHTML = peakMetaLine(s.today);
    dom.weekTodayProgress.classList.toggle('has-data', !!s.progress);
    if (s.progress) {
        dom.weekTodayProgressFill.style.width = `${Math.max(0, Math.min(100, s.progress.pct))}%`;
        dom.weekTodayProgressTxt.innerHTML = `doteraz <b>${fmt1(s.progress.realKwh)} kWh</b>`;
        dom.weekTodayProgressPct.innerHTML = `<b>${s.progress.pct} %</b> z predpovede`;
    }
    dom.weekTomorrow.textContent = s.tomorrow ? fmt1(s.tomorrow.kwhTotal) : '–';
    dom.weekTomorrowBadge.innerHTML = s.tomorrow ? weatherBadge(s.tomorrowSunny, s.tomorrow.cloudAvgPct) : '';
    dom.weekTomorrowMeta.innerHTML = s.tomorrow ? peakMetaLine(s.tomorrow) : '';
    dom.weekTomorrowTrend.innerHTML = trendBadge(s.trendPct);
    dom.weekTotal.textContent = String(Math.round(s.totalKwh));
    dom.weekTotalMeta.innerHTML = `<span>ø <b>${fmt1(s.avgKwh)} kWh</b>/deň</span><span>najlepší: <b>${escapeHtml(s.best.label)}</b></span>`;
    dom.weekBarsStat.innerHTML =
        `<span>Spolu za 7 dní <b>${fmt1(s.totalKwh)} kWh</b></span><span>Priemer <b>${fmt1(s.avgKwh)} kWh/deň</b></span>` +
        `<span>Najsilnejší deň <b>${escapeHtml(s.best.fullLabel)} · ${fmt1(s.best.kwh)} kWh</b></span>`;
}

/** @param {number | null} cloudPct */
function skyCell(cloudPct) {
    if (cloudPct == null) return '–';
    if (cloudPct < 30) return `<span class="cloud-cell sun" title="slnečno">${ICON_SUN}</span>`;
    if (cloudPct < 70) return `<span class="cloud-cell partly" title="polooblačno">${ICON_PARTLY}</span>`;
    return `<span class="cloud-cell cloud" title="zamračené">${ICON_CLOUD}</span>`;
}

/** @param {number | null} cloudPct */
function cloudCell(cloudPct) {
    if (cloudPct == null) return '–';
    const sunny = cloudPct < 50;
    return `<span class="cloud-cell ${sunny ? 'sun' : 'cloud'}">${sunny ? ICON_SUN : ICON_CLOUD}${Math.round(cloudPct)} %</span>`;
}

/** @param {ForecastDay[]} days @param {number} sel @param {import('../dom.js').Dom} dom */
function renderTableAndTabs(days, sel, dom) {
    dom.weekDayTabs.innerHTML = days
        .map(
            (d, i) =>
                `<button type="button" role="tab" class="utab${i === sel ? ' active' : ''}" aria-selected="${i === sel}" data-day-index="${i}">${weekDayShort(d.date, i)}</button>`,
        )
        .join('');
    dom.weekTbody.innerHTML = days
        .map((d, i) => {
            const pct = usePct(d);
            const dateSub = i > 1 ? `<span class="sub">${weekDateLabel(d.date)}</span>` : '';
            const peakAt = d.peakHour == null ? '–' : `o ${hourLabel(d.peakHour)}`;
            return (
                `<tr class="${i === 0 ? 'today' : ''}${i === sel ? ' sel' : ''}" data-day-index="${i}"><td>${weekDayShort(d.date, i)}${dateSub}</td>` +
                `<td>${d.kwhTotal.toFixed(1)} kWh</td><td>${skyCell(d.cloudAvgPct)}</td><td>${pct == null ? '–' : `${pct} %`}</td>` +
                `<td>${d.peakKw.toFixed(1)} kW<span class="sub">${peakAt}</span></td><td>${cloudCell(d.cloudAvgPct)}</td></tr>`
            );
        })
        .join('');
}

/** @param {import('../state.js').AppState} state @param {ForecastDay} day @param {import('../dom.js').Dom} dom */
function renderCurve(state, day, dom) {
    const m = weekCurveModel(state);
    dom.weekCurve.innerHTML = m ? forecastChartSvg(m) : '';
    if (m) dom.weekCurve.setAttribute('viewBox', `0 0 ${m.dims.w} ${m.dims.h}`);
    const parts = [];
    if (Number.isFinite(day.peakKw) && day.peakHour != null)
        parts.push(`<span>Špička <b>${day.peakKw.toFixed(1)} kW</b> o ${hourLabel(day.peakHour)}</span>`);
    parts.push(`<span>Výroba <b>${fmt1(day.kwhTotal)} kWh</b></span>`);
    if (day.cloudAvgPct != null) parts.push(`<span>Oblačnosť <b>${Math.round(day.cloudAvgPct)} %</b></span>`);
    dom.weekCurveStat.innerHTML = parts.join('');
}

/** @param {import('../dom.js').Dom} dom */
function renderEmpty(dom) {
    for (const el of [
        dom.weekHeat,
        dom.weekBars,
        dom.weekCurve,
        dom.weekBarsStat,
        dom.weekCurveStat,
        dom.weekDayTabs,
        dom.weekTbody,
        dom.weekHeatScale,
    ])
        el.innerHTML = '';
    for (const el of [dom.weekToday, dom.weekTomorrow, dom.weekTotal]) el.textContent = '–';
    for (const el of [
        dom.weekTodayBadge,
        dom.weekTodayMeta,
        dom.weekTomorrowBadge,
        dom.weekTomorrowMeta,
        dom.weekTomorrowTrend,
        dom.weekTotalMeta,
    ])
        el.innerHTML = '';
    dom.weekTodayProgress.classList.remove('has-data');
    dom.weekMsgTitle.textContent = EMPTY_MESSAGES.week.title;
    dom.weekMsgBody.textContent = EMPTY_MESSAGES.week.body;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderSedemdni(state, dom) {
    dom.weekSub.textContent = `${SITE.name} · ${fmt1(INSTALLED_PV_KW)} kWp`;
    const days = state.forecast && Array.isArray(state.forecast.days) ? state.forecast.days : [];
    if (!days.length) return renderEmpty(dom);
    const sel = Math.min(state.weekSelDay, days.length - 1);

    renderStats(weekStatsModel(days, state.pv, state.forecast ? state.forecast.tomorrowSunny : false), dom);

    const heat = weekHeatModel(days, sel);
    dom.weekHeat.setAttribute('viewBox', `0 0 ${heat.W} ${heat.H}`);
    dom.weekHeat.setAttribute('height', String(heat.H));
    dom.weekHeat.innerHTML = weekHeatSvg(heat);
    dom.weekHeatScale.innerHTML = `<span>0 kW</span><span class="sw">${heat.legendFracs.map((f) => `<i style="opacity:${(0.12 + f * 0.8).toFixed(2)}"></i>`).join('')}</span><span>${heat.max.toFixed(1)} kW</span>`;

    const bars = weekBarsModel(days, sel);
    dom.weekBars.setAttribute('viewBox', `0 0 ${bars.W} ${bars.H}`);
    dom.weekBars.setAttribute('height', String(bars.H));
    dom.weekBars.innerHTML = weekBarsSvg(bars);

    renderTableAndTabs(days, sel, dom);
    renderCurve(state, days[sel], dom);
    const msg = weekMessage(days);
    dom.weekMsgTitle.textContent = msg.title;
    dom.weekMsgBody.textContent = msg.body;
}
