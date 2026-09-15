// Karta 7 dní: súhrn, mapa výroby, denné stĺpce, priebeh vybraného dňa, tabuľka, správa.
// Na mobile je to rozdelené na dve obrazovky - prehľad dní a detail vybraného dňa (weekDetail
// v stave); na širokej obrazovke je miesta dosť a vidno všetko naraz.

import { chartDims, fillDims, forecastChartModel, usePct, weekBarsModel, weekHeatModel, weekStatsModel } from '../../shared/chart-model.js';
import { INSTALLED_PV_KW, SITE } from '../../shared/config.js';
import { escapeHtml, fmt1, hourLabel, pad2, weekDateLabel, weekDayLong, weekDayShort } from '../../shared/format.js';
import { EMPTY_MESSAGES, weekMessage } from '../../shared/messages.js';
import { ICON_CLOUD, ICON_PARTLY, ICON_SUN } from '../icons.js';
import { forecastChartSvg, weekBarsSvg, weekHeatSvg } from '../svg.js';

/** @typedef {import('../../shared/solar.js').ForecastDay} ForecastDay */

/**
 * Plátno grafu: keď poznáme skutočný rozmer karty, kreslíme presne naň (viewBox potom sedí
 * s pixelmi 1:1, takže sa nič neskresľuje ani nezostáva prázdne). Kým rozmer nepoznáme,
 * platí pevné plátno podľa šírky okna.
 * @param {import('../state.js').AppState} state @param {string} key
 */
function dimsFor(state, key) {
    // Len na širokej karte: fillDims berie okraje zo širokého plátna (os Y, väčšie odsadenie),
    // na mobile by tým prepísalo úmyselne úspornejšie rozloženie z chartDims(false).
    const size = state.wide ? state.chartSizes[key] : null;
    return size ? fillDims(size.w, size.h) : chartDims(state.wide);
}

/** Vstup grafu priebehu vybraného dňa - zdieľaný s tooltipom. Dnešok tu ukazuje nameranú
 * krivku rovnako ako graf na karte Dnes-Zajtra; ostatné dni zatiaľ merané nemajú.
 * @param {import('../state.js').AppState} state */
export function weekCurveModel(state) {
    const days = state.forecast ? state.forecast.days : [];
    const day = days[state.weekSelDay];
    if (!day) return null;
    const isToday = state.weekSelDay === 0;
    return forecastChartModel({
        pts: day.hourly,
        realPts: isToday && state.pv ? state.pv.realCurveToday : [],
        nowHour: isToday ? state.now.getHours() + state.now.getMinutes() / 60 : null,
        dims: dimsFor(state, 'weekCurve'),
    });
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

/** @param {ReturnType<typeof weekStatsModel>} s @param {import('../dom.js').Dom} dom @param {boolean} detail */
function renderStats(s, dom, detail) {
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
    // Najsilnejší deň hovorí o celom týždni - na detaile dňa ho už povedala správa pod
    // prehľadom dní, tam by bol druhýkrát.
    dom.weekBarsStat.innerHTML =
        `<span>Spolu za 7 dní <b>${fmt1(s.totalKwh)} kWh</b></span><span>Priemer <b>${fmt1(s.avgKwh)} kWh/deň</b></span>` +
        (detail ? '' : `<span>Najsilnejší deň <b>${escapeHtml(s.best.fullLabel)} · ${fmt1(s.best.kwh)} kWh</b></span>`);
}

/** @param {number | null} cloudPct */
function skyCell(cloudPct) {
    if (cloudPct == null) return '–';
    if (cloudPct < 30) return `<span class="cloud-cell sun" title="slnečno">${ICON_SUN}</span>`;
    if (cloudPct < 70) return `<span class="cloud-cell partly" title="polooblačno">${ICON_PARTLY}</span>`;
    return `<span class="cloud-cell cloud" title="zamračené">${ICON_CLOUD}</span>`;
}

/**
 * Odtieň percenta využitia: silný deň (od 80 % stropu jasnej oblohy) svieti, slabý (pod
 * 50 %) stmavne. Ide o to, aby sa dobrý deň dal v tabuľke nájsť očami bez čítania čísel.
 * @param {number | null} pct
 */
export function useTier(pct) {
    if (pct == null) return '';
    if (pct >= 80) return ' use-hi';
    return pct < 50 ? ' use-lo' : '';
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
                `<td>${d.kwhTotal.toFixed(1)} kWh</td><td class="mid">${skyCell(d.cloudAvgPct)}</td><td class="mid${useTier(pct)}">${pct == null ? '–' : `${pct} %`}</td>` +
                `<td>${d.peakKw.toFixed(1)} kW<span class="sub">${peakAt}</span></td></tr>`
            );
        })
        .join('');
}

/** Info o vybranom dni pod grafom: čo sa čaká, koľko z toho je jasná obloha a - pri dnešku -
 * koľko už nabehlo. @param {import('../state.js').AppState} state @param {ForecastDay} day */
function dayInfo(state, day) {
    const parts = [];
    if (Number.isFinite(day.peakKw) && day.peakHour != null)
        parts.push(`<span>Špička <b>${day.peakKw.toFixed(1)} kW</b> o ${hourLabel(day.peakHour)}</span>`);
    parts.push(`<span>Výroba <b>${fmt1(day.kwhTotal)} kWh</b></span>`);
    const pct = usePct(day);
    if (pct != null) parts.push(`<span>Využitie <b>${pct} %</b> z jasnej oblohy</span>`);
    if (day.cloudAvgPct != null) parts.push(`<span>Oblačnosť <b>${Math.round(day.cloudAvgPct)} %</b></span>`);
    const realKwh =
        state.weekSelDay === 0 && state.pv && Number.isFinite(Number(state.pv.dailyEnergyKwh)) ? Number(state.pv.dailyEnergyKwh) : null;
    if (realKwh !== null && day.kwhTotal > 0)
        parts.push(`<span>Doteraz <b>${fmt1(realKwh)} kWh</b> · ${Math.round((100 * realKwh) / day.kwhTotal)} % z predpovede</span>`);
    return parts.join('');
}

/** @param {import('../state.js').AppState} state @param {ForecastDay} day @param {import('../dom.js').Dom} dom */
function renderCurve(state, day, dom) {
    const m = weekCurveModel(state);
    dom.weekCurve.innerHTML = m ? forecastChartSvg(m) : '';
    if (m) dom.weekCurve.setAttribute('viewBox', `0 0 ${m.dims.w} ${m.dims.h}`);
    // Značka "teraz" patrí k dnešku, položka legendy ku krivke - keď sa krivka nekreslí,
    // legenda by ohlasovala niečo, čo v grafe nie je.
    dom.weekCurveNowBadge.classList.toggle('hidden', state.weekSelDay !== 0);
    dom.weekCurveNowTime.textContent = `teraz ${pad2(state.now.getHours())}:${pad2(state.now.getMinutes())}`;
    dom.weekCurveLiveLegend.classList.toggle('hidden', !m || !m.real.length);
    dom.weekCurveStat.innerHTML = dayInfo(state, day);
}

/**
 * Prehľad a detaily sú na mobile obrazovky tej istej karty: prehľad má bubliny, tabuľku
 * a správu, detail dňa ukazuje priebeh vybraného dňa a detail týždňa dennú výrobu s mapou.
 * Na širokej obrazovke (`narrow` je false) sú detaily vypnuté a karta ostáva celá pokope.
 * @param {'day' | 'week' | null} detail @param {boolean} narrow @param {import('../dom.js').Dom} dom
 */
function renderView(detail, narrow, dom) {
    dom.panels['7dni'].classList.toggle('detail', !!detail);
    for (const el of [dom.weekHead, dom.weekTrio, dom.weekBlockTable, dom.weekMsgBlock]) el.classList.toggle('hidden', !!detail);
    const vidno = detail === 'day' ? ['weekBlockCurve', 'weekBlockHeat'] : detail === 'week' ? ['weekBlockBars', 'weekBlockHeat'] : [];
    for (const key of ['weekBlockHeat', 'weekBlockBars', 'weekBlockCurve'])
        dom[key].classList.toggle('hidden', detail ? !vidno.includes(key) : narrow);
    dom.weekDayHead.classList.toggle('hidden', !detail);
    // Deň si používateľ vybral klikom v prehľade, prepínač dní nad krivkou je tu navyše.
    dom.weekDayTabs.classList.toggle('hidden', !!detail);
}

/** Hlavička obrazovky detailu: čo je otvorené a odkiaľ sa vraciame.
 * @param {'day' | 'week' | null} detail @param {ForecastDay} day @param {number} sel @param {import('../dom.js').Dom} dom */
function renderDayHead(detail, day, sel, dom) {
    dom.weekDayTitle.textContent = detail === 'week' ? 'Celý týždeň' : weekDayLong(day.date, sel);
    dom.weekDaySub.textContent = detail === 'week' ? 'Detail týždňa' : 'Detail dňa';
}

/** Mapa výroby: v prehľade a v detaile týždňa celý týždeň, v detaile dňa jediný riadok
 * vybraného dňa (mierka farieb ostáva z celého týždňa).
 * @param {import('../state.js').AppState} state @param {ForecastDay[]} days @param {number} sel
 * @param {'day' | 'week' | null} detail @param {import('../dom.js').Dom} dom */
function renderHeat(state, days, sel, detail, dom) {
    const jedenDen = detail === 'day';
    // Mapa dostane skutočný rozmer karty len na širokej obrazovke; na mobile a v jednom
    // riadku si plátno určí sama.
    const size = state.wide && !jedenDen ? state.chartSizes.weekHeat : null;
    const heat = weekHeatModel(days, sel, size ? { W: size.w, H: size.h } : null, jedenDen);
    dom.weekHeatLabel.textContent = jedenDen ? 'Mapa výroby dňa (kW)' : 'Mapa výroby (kW) · hodina × deň';
    dom.weekHeat.setAttribute('viewBox', `0 0 ${heat.W} ${heat.H}`);
    dom.weekHeat.setAttribute('height', String(heat.H));
    dom.weekHeat.innerHTML = weekHeatSvg(heat);
    dom.weekHeatScale.innerHTML = `<span>0 kW</span><span class="sw">${heat.legend.map((l) => `<i class="tier-${l.tier}" style="opacity:${(0.12 + l.frac * 0.8).toFixed(2)}"></i>`).join('')}</span><span>${heat.max.toFixed(1)} kW</span>`;
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
    dom.weekCurveNowBadge.classList.add('hidden');
    dom.weekCurveLiveLegend.classList.add('hidden');
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
    // Bez dát nie je čo otvárať - karta ostáva na prehľade so správou "Predpoveď sa pripravuje".
    const detail = !state.wide && days.length > 0 ? state.weekDetail : null;
    renderView(detail, !state.wide, dom);
    if (!days.length) return renderEmpty(dom);
    const sel = Math.min(state.weekSelDay, days.length - 1);

    renderDayHead(detail, days[sel], sel, dom);
    renderStats(weekStatsModel(days, state.pv, state.forecast ? state.forecast.tomorrowSunny : false), dom, !!detail);

    // Mapa a stĺpce dostanú skutočný rozmer karty len na širokej obrazovke; na mobile si
    // plátno určia samy, aby rozloženie ostalo také, aké bolo.
    renderHeat(state, days, sel, detail, dom);

    // Na desktope má karta dosť miesta na to, aby strop jasnej oblohy zbytočne
    // neprekrýval čísla nad stĺpcami - tam ho preto nekreslíme, na mobile ostáva.
    const barsSize = state.wide ? state.chartSizes.weekBars : null;
    const bars = weekBarsModel(days, sel, barsSize ? { W: barsSize.w, H: barsSize.h } : undefined, !state.wide);
    dom.weekBars.setAttribute('viewBox', `0 0 ${bars.W} ${bars.H}`);
    dom.weekBars.setAttribute('height', String(bars.H));
    dom.weekBars.innerHTML = weekBarsSvg(bars);
    dom.weekBarsClearLegend.classList.toggle('hidden', state.wide);

    renderTableAndTabs(days, sel, dom);
    renderCurve(state, days[sel], dom);
    const msg = weekMessage(days);
    dom.weekMsgTitle.textContent = msg.title;
    dom.weekMsgBody.textContent = msg.body;
}
