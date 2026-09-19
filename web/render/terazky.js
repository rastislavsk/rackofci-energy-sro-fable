// Karta Spotrebiče: ciferník s denným prstencom, verdikt a spotrebiče. Čistý zápis modelu do DOM.

import { MINUTES_PER_DAY } from '../../shared/config.js';
import { dayRingModel, RING, ringPercent, visibleHours } from '../../shared/chart-model.js';
import { escapeHtml, fmt1, minutesToTimeStr } from '../../shared/format.js';
import { heroModel, minutesOfDay } from '../../shared/hero-model.js';
import { EMPTY_MESSAGES, forecastDayMessage } from '../../shared/messages.js';
import { DEVICE_ICONS } from '../icons.js';
import { writeHtml } from '../memo.js';
import { dayRingSvg } from '../svg.js';

const DIAL_CIRCUMFERENCE = 2 * Math.PI * RING.rPower;

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

/** Listovanie verdiktu: prvé tri stránky (teraz - defaultne prvá, spotrebiče, predpoveď dňa)
 * sú vždy, štvrtá ("lepšie bude") len keď model pozná čas čakania. Pozíciu posunu drží
 * prehliadač; sem sa zapisuje obsah a bodky. @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} m @param {import('../dom.js').Dom} dom */
function renderVerdictPager(state, m, dom) {
    const pages = m.waitTime ? 4 : 3;
    const page = Math.min(state.verdictPage, pages - 1);
    dom.verdictWaitTime.textContent = m.waitTime || '--:--';
    dom.verdictPageWait.classList.toggle('hidden', !m.waitTime);
    dom.verdictDotWait.classList.toggle('hidden', !m.waitTime);
    dom.verdictDotButtons.forEach((dot, i) => dot.classList.toggle('active', i === page));
}

/** Správa o dnešnej predpovedi - tá istá, čo je v karte Predpoveď, len vždy pre dnešok
 * bez ohľadu na tam zvolený deň. @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderForecastPage(state, dom) {
    const visible = state.forecast ? visibleHours(state.forecast.hourlyToday) : [];
    const msg = visible.length ? forecastDayMessage(visible, true) : EMPTY_MESSAGES.forecast;
    dom.verdictForecastTitle.textContent = msg.title;
    dom.verdictForecastBody.textContent = msg.body;
}

/** @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} m @param {import('../dom.js').Dom} dom */
function renderHero(state, m, dom) {
    const panel = dom.panels.terazky;
    panel.style.setProperty('--accent', tierVar(m.accent));
    dom.pvPower.textContent = m.powerText;
    dom.pvPower.style.color = Number.isFinite(m.power) ? tierVar(m.accent) : 'var(--ink)';
    dom.pvPowerUnit.textContent = m.unitText;
    dom.dialRing.style.strokeDasharray = String(DIAL_CIRCUMFERENCE);
    dom.dialRing.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - m.dial.fraction));
    dom.dialRing.style.stroke = tierVar(m.dial.tier);
    // Pri nulovej výrobe by guľatý koniec oblúka nechal na vrchu prstenca bodku, hoci
    // nie je čo ukázať. Trieda ho na ten čas zrovná (viď .dial-ring.empty v style.css).
    dom.dialRing.classList.toggle('empty', !(m.dial.fraction > 0));
    dom.verdictHeadline.textContent = m.message.headline;
    dom.verdictBody.textContent = m.message.body;
    writeHtml(dom.verdictGoRow, devicesHtml(m.devices), 'devices');
    renderForecastPage(state, dom);
    renderVerdictPager(state, m, dom);
}

/** Poloha na dennom prstenci. Obal je štvorec zhodný s ciferníkom, takže percentá platia
 * pri akejkoľvek jeho veľkosti. @param {HTMLElement} el @param {number} minutes */
function placeOnRing(el, minutes) {
    const { left, top } = ringPercent(minutes);
    el.style.left = `${left}%`;
    el.style.top = `${top}%`;
}

/** Denný prstenec závisí len na sezóne, takže sa prekresľuje iba pri jej zmene - o to sa
 * stará writeHtml sám. Druhá stráž navyše tu byť nesmie: memo.js si pamätá podľa názvu,
 * takže dve stráže s rovnakým názvom by si pamäť prepisovali a prstenec by sa prekresľoval
 * pri každom pohybe prsta po jazdci.
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderDayRing(state, dom) {
    writeHtml(dom.dayRing, dayRingSvg(dayRingModel(state.season)), 'day-ring');
}

/** Jazdec na dennom prstenci. Je v stránke stále, aj keď náhľad nebeží - v pokoji je
 * značkou "teraz" a zároveň jedinou cestou, ako sa k náhľadu dostať z klávesnice. Počas
 * náhľadu sa mení na objímku a značku "teraz" preberie samostatná bodka.
 * @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} hero @param {import('../dom.js').Dom} dom */
function renderRingMarks(state, hero, dom) {
    const nowMinutes = minutesOfDay(state.now);
    placeOnRing(dom.dialNow, nowMinutes);
    dom.dialNow.classList.toggle('hidden', !hero.preview);

    placeOnRing(dom.dialGrip, hero.minutes);
    dom.dialGrip.classList.toggle('at-now', !hero.preview);
    // Otočenie o uhol času: dlhá os objímky tak leží po obvode prstenca.
    dom.dialGrip.style.transform = `translate(-50%, -50%) rotate(${(hero.minutes / MINUTES_PER_DAY) * 360}deg)`;
    dom.dialGrip.setAttribute('aria-valuenow', String(hero.minutes));
    dom.dialGrip.setAttribute('aria-valuetext', `${hero.preview ? 'Náhľad' : 'Teraz'} ${minutesToTimeStr(hero.minutes)}`);
}

/** @param {import('../state.js').AppState} state @param {ReturnType<typeof heroModel>} hero @param {import('../dom.js').Dom} dom */
function renderPreviewUi(state, hero, dom) {
    dom.dialWhen.textContent = minutesToTimeStr(hero.minutes);
    dom.dialWhen.classList.toggle('preview', hero.preview);
    dom.previewReset.classList.toggle('hidden', !hero.preview);
    // Počas ťahania nesmie oblúk výkonu dobiehať prst s oneskorením - prechod ide bokom.
    dom.panels.terazky.classList.toggle('dragging', state.isDragging);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderTerazky(state, dom) {
    const hero = heroModel(state);
    renderHero(state, hero, dom);
    renderDayRing(state, dom);
    renderRingMarks(state, hero, dom);
    renderPreviewUi(state, hero, dom);
}
