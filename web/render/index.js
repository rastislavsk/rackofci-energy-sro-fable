// Jediné miesto, ktoré prekresľuje UI: vždy hlavičku a viditeľné karty, nič iné.

import { PANELS } from '../dom.js';
import { renderHeader } from './header.js';
import { renderPredpoved } from './predpoved.js';
import { renderSedemdni } from './sedemdni.js';
import { renderSpotrebice } from './spotrebice.js';
import { renderZdielat } from './zdielat.js';

/** Na desktope Predpoveď nemá vlastnú navigáciu (viď .nav-item-predpoved v style.css) a
 * splynie so Spotrebičmi - aj keby sa stav dostal na 'predpoved' inak (napr. cez dial-hero),
 * ktorý má data-panel="predpoved" na každej šírke. @param {import('../state.js').AppState} state */
function effectivePanel(state) {
    return state.desktop && state.panel === 'predpoved' ? 'spotrebice' : state.panel;
}

/** Na širokej obrazovke sú Spotrebiče a Predpoveď vedľa seba. @param {import('../state.js').AppState} state */
export function isForecastVisible(state) {
    const panel = effectivePanel(state);
    return panel === 'predpoved' || (state.desktop && panel === 'spotrebice');
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderPanels(state, dom) {
    const panel = effectivePanel(state);
    dom.page.dataset.panel = panel;
    for (const p of PANELS) {
        const visible = p === panel || (p === 'predpoved' && isForecastVisible(state));
        dom.panels[p].classList.toggle('hidden', !visible);
        dom.navs[p].classList.toggle('active', p === panel);
        if (p === panel) dom.navs[p].setAttribute('aria-current', 'page');
        else dom.navs[p].removeAttribute('aria-current');
    }
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function render(state, dom) {
    renderHeader(state, dom);
    renderPanels(state, dom);
    if (state.panel === 'spotrebice' || state.desktop) renderSpotrebice(state, dom);
    if (isForecastVisible(state)) renderPredpoved(state, dom);
    if (state.panel === '7dni') renderSedemdni(state, dom);
    if (state.panel === 'zdielat') renderZdielat(state, dom);
}
