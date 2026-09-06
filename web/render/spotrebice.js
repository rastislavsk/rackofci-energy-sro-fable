// Karta Spotrebiče: ciferník, verdikt, spotrebiče a pás dňa. Čistý zápis modelu do DOM.

import { dayStripModel, stripCurveY, STRIP, visibleHours } from '../../shared/chart-model.js';
import { escapeHtml, fmt1 } from '../../shared/format.js';
import { heroModel, minutesOfDay } from '../../shared/hero-model.js';
import { EMPTY_MESSAGES, forecastDayMessage } from '../../shared/messages.js';
import { DEVICE_ICONS } from '../icons.js';
import { changedKeys, sameKeys, writeHtml } from '../memo.js';
import { dayStripSvg } from '../svg.js';

const DIAL_CIRCUMFERENCE = 2 * Math.PI * 92;

/** @param {import('../../shared/config.js').Tier | null} tier */
export const tierVar = (tier) => (tier ? `var(--${tier})` : 'var(--ink-20)');

/** @param {ReturnType<typeof heroModel>['devices']} devices */
function devicesHtml(devices) {
    return (devices || [])
        .map((d) => {
            const power = `${fmt1(d.powerKw)} kW`;
            const tierCls = d.state !== 'no' && d.tier ? ` tier-${d.tier}` : '';
            return (
                `<button type="button" class="go-chip state-${d.state}${tierCls}"${d.state === 'no' ? ' disabled' : ''} data-device="${escapeHtml(d.name)}" data-power="${power}" aria-label="${escapeHtml(d.name)}, ${power}">` +
                (DEVICE_ICONS[d.name] || '') +
                `<span class="go-name">${escapeHtml(d.name)}</span><span class="go-power">${power}</span></button>`
            );
        })
        .join('');
}

/** Listovanie verdiktu: prvé štyri stránky (tarifa a slnko - defaultne prvá, teraz, spotrebiče,
 * predpoveď dňa) sú vždy, piata ("lepšie bude") len keď model pozná čas čakania. Pozíciu posunu
 * drží prehliadač; sem sa zapisuje obsah a bodky. @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} m @param {import('../dom.js').Dom} dom */
function renderVerdictPager(state, m, dom) {
    const pages = m.waitTime ? 5 : 4;
    const page = Math.min(state.verdictPage, pages - 1);
    dom.verdictWaitTime.textContent = m.waitTime || '--:--';
    dom.verdictPageWait.classList.toggle('hidden', !m.waitTime);
    dom.verdictDotWait.classList.toggle('hidden', !m.waitTime);
    dom.verdictDotButtons.forEach((dot, i) => dot.classList.toggle('active', i === page));
}

/** Odznak s tarifou žije len vo vlastnej stránke pageru (na žiadnej šírke sa neduplikuje
 * nad ciferníkom). @param {ReturnType<typeof heroModel>} m @param {import('../dom.js').Dom} dom */
function renderEyebrowBadge(m, dom) {
    dom.verdictEyebrowPage.textContent = m.eyebrow;
}

/** Správa o dnešnej predpovedi - tá istá, čo je v karte Predpoveď, len vždy pre dnešok
 * bez ohľadu na tam zvolený deň. @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderForecastPage(state, dom) {
    const visible = state.forecast ? visibleHours(state.forecast.hourlyToday) : [];
    const msg = visible.length ? forecastDayMessage(visible, true) : EMPTY_MESSAGES.forecast;
    dom.verdictForecastTitle.textContent = msg.title;
    dom.verdictForecastBody.textContent = msg.body;
}

/** Kolotoč: klon poslednej/prvej reálnej stránky vernou kópiou (cloneNode), aj keď sa mení,
 * ktorá stránka je posledná (predpoveď dňa/lepšie bude) - odstránené id v klone predídu
 * duplicitám. @param {HTMLElement} source @param {HTMLElement} target */
function mirrorPage(source, target) {
    target.className = source.className;
    target.replaceChildren(...source.cloneNode(true).childNodes);
    target.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
}

/** @param {import('../dom.js').Dom} dom */
function syncPagerClones(dom) {
    const lastPage = dom.verdictPageWait.classList.contains('hidden') ? dom.verdictPageForecast : dom.verdictPageWait;
    // Do kľúča patrí aj trieda, lebo mirrorPage kopíruje oboje - inak by zmena samotnej
    // triedy zdroja klon nedobehla.
    if (changedKeys('clone-start', [lastPage.className, lastPage.innerHTML])) mirrorPage(lastPage, dom.verdictPageCloneStart);
    const eyebrow = dom.verdictPageEyebrow;
    if (changedKeys('clone-end', [eyebrow.className, eyebrow.innerHTML])) mirrorPage(eyebrow, dom.verdictPageCloneEnd);
}

/** @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} m @param {import('../dom.js').Dom} dom */
function renderHero(state, m, dom) {
    const panel = dom.panels.spotrebice;
    panel.style.setProperty('--accent', tierVar(m.accent));
    dom.pvPower.textContent = m.powerText;
    dom.pvPower.style.color = Number.isFinite(m.power) ? tierVar(m.accent) : 'var(--ink)';
    dom.pvPowerUnit.textContent = m.unitText;
    dom.dialRing.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - m.dial.fraction));
    dom.dialRing.style.stroke = tierVar(m.dial.tier);
    renderEyebrowBadge(m, dom);
    dom.verdictHeadline.textContent = m.message.headline;
    dom.verdictBody.textContent = m.message.body;
    writeHtml(dom.verdictGoRow, devicesHtml(m.devices), 'devices');
    renderForecastPage(state, dom);
    renderVerdictPager(state, m, dom);
    syncPagerClones(dom);
}

/** Marker na krivke: X podľa minúty, výška bodky podľa krivky. @param {HTMLElement} el @param {number} minutes @param {{x: number, y: number}[]} points */
function positionMarker(el, minutes, points) {
    el.style.left = `${(minutes / STRIP.w) * 100}%`;
    const dot = el.querySelector('.strip-marker-dot, .strip-now-ghost-dot');
    if (dot instanceof HTMLElement) dot.style.top = `${(stripCurveY(points, minutes) / STRIP.h) * 100}%`;
}

/** Pás dňa závisí len na sezóne, dátach a aktuálnej minúte. Pri ťahaní bežca sa nemení ani
 * jedno z toho - mení sa iba poloha bežca - preto sa model aj SVG počítajú znovu len vtedy,
 * keď sa naozaj zmenil vstup. Zbytočný zápis by ušpinil layout a účet zaň zaplatí až ďalší
 * krok gesta, keď si appka pýta rozmery pásu.
 * @type {{ keys: unknown[], model: ReturnType<typeof dayStripModel> } | null} */
let stripCache = null;

/** @param {import('../state.js').AppState} state @param {number} nowMinutes */
function stripModel(state, nowMinutes) {
    const keys = [state.season, state.forecast, state.pv, nowMinutes];
    if (stripCache && sameKeys(stripCache.keys, keys)) return { model: stripCache.model, rebuilt: false };
    const model = dayStripModel({
        season: state.season,
        hourlyToday: state.forecast ? state.forecast.hourlyToday : null,
        realCurve: state.pv ? state.pv.realCurveToday : null,
        nowMinutes,
    });
    stripCache = { keys, model };
    return { model, rebuilt: true };
}

/** @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} hero @param {import('../dom.js').Dom} dom */
function renderStrip(state, hero, dom) {
    const nowMinutes = minutesOfDay(state.now);
    const { model, rebuilt } = stripModel(state, nowMinutes);
    if (rebuilt) dom.daystrip.innerHTML = dayStripSvg(model);
    dom.stripLegend.classList.toggle('hidden', !model.hasData);
    dom.stripLegendReal.classList.toggle('hidden', !model.boundary);
    dom.seasonIndicator.textContent = state.season === 'summer' ? 'Leto' : 'Zima';

    positionMarker(dom.stripNowMarker, hero.preview ? hero.minutes : nowMinutes, model.points);
    dom.stripNowGhost.classList.toggle('hidden', !hero.preview);
    if (hero.preview) positionMarker(dom.stripNowGhost, nowMinutes, model.points);
}

/** @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} hero @param {import('../dom.js').Dom} dom */
function renderPreviewUi(state, hero, dom) {
    const pinned = hero.preview && !state.isDragging;
    dom.panels.spotrebice.classList.toggle('preview-dim', state.isDragging);
    dom.previewBanner.classList.toggle('hidden', !pinned);
    dom.previewTimeLabel.textContent = hero.previewLabel || 'Náhľad · --:--';
    dom.previewPill.style.setProperty('--preview-accent', tierVar(hero.accent));
    dom.dragTooltip.classList.toggle('hidden', !state.isDragging);
    dom.dragTooltip.textContent = hero.preview ? (hero.previewLabel || '').replace('Náhľad · ', '') : '--:--';
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderSpotrebice(state, dom) {
    const hero = heroModel(state);
    renderHero(state, hero, dom);
    renderStrip(state, hero, dom);
    renderPreviewUi(state, hero, dom);
}
