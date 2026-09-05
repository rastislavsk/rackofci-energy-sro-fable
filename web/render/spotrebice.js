// Karta Spotrebiče: ciferník, verdikt, spotrebiče a pás dňa. Čistý zápis modelu do DOM.

import { dayStripModel, stripCurveY, STRIP } from '../../shared/chart-model.js';
import { escapeHtml, fmt1 } from '../../shared/format.js';
import { heroModel, minutesOfDay } from '../../shared/hero-model.js';
import { DEVICE_ICONS } from '../icons.js';
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
                `<button type="button" class="go-chip state-${d.state}${tierCls}"${d.state === 'no' ? ' disabled' : ''} data-device="${escapeHtml(d.name)}" aria-label="${escapeHtml(d.name)}, ${power}">` +
                (DEVICE_ICONS[d.name] || '') +
                `<span class="go-name">${escapeHtml(d.name)}</span><span class="go-power">${power}</span><span class="chip-tooltip">${power}</span></button>`
            );
        })
        .join('');
}

/** @param {ReturnType<typeof heroModel>} m @param {import('../dom.js').Dom} dom */
function renderHero(m, dom) {
    const panel = dom.panels.spotrebice;
    panel.style.setProperty('--accent', tierVar(m.accent));
    dom.pvPower.textContent = m.powerText;
    dom.pvPower.style.color = Number.isFinite(m.power) ? tierVar(m.accent) : 'var(--ink)';
    dom.pvPowerUnit.textContent = m.unitText;
    dom.dialRing.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - m.dial.fraction));
    dom.dialRing.style.stroke = tierVar(m.dial.tier);
    dom.verdictEyebrow.textContent = m.eyebrow;
    dom.verdictHeadline.textContent = m.message.headline;
    dom.verdictBody.textContent = m.message.body;
    dom.verdictGoRow.innerHTML = devicesHtml(m.devices);
    dom.verdictGoRow.classList.toggle('hidden', !m.devices.length);
    dom.verdictWaitChip.classList.toggle('hidden', !m.waitTime);
    dom.verdictWaitTime.textContent = m.waitTime || '--:--';
}

/** Marker na krivke: X podľa minúty, výška bodky podľa krivky. @param {HTMLElement} el @param {number} minutes @param {{x: number, y: number}[]} points */
function positionMarker(el, minutes, points) {
    el.style.left = `${(minutes / STRIP.w) * 100}%`;
    const dot = el.querySelector('.strip-marker-dot, .strip-now-ghost-dot');
    if (dot instanceof HTMLElement) dot.style.top = `${(stripCurveY(points, minutes) / STRIP.h) * 100}%`;
}

/** @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} hero @param {import('../dom.js').Dom} dom */
function renderStrip(state, hero, dom) {
    const nowMinutes = minutesOfDay(state.now);
    const model = dayStripModel({
        season: state.season,
        hourlyToday: state.forecast ? state.forecast.hourlyToday : null,
        realCurve: state.pv ? state.pv.realCurveToday : null,
        nowMinutes,
    });
    dom.daystrip.innerHTML = dayStripSvg(model);
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
    renderHero(hero, dom);
    renderStrip(state, hero, dom);
    renderPreviewUi(state, hero, dom);
}
