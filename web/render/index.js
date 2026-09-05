// Jediné miesto, ktoré prekresľuje UI: vždy hlavičku a viditeľné karty, nič iné.

import { PANELS } from '../dom.js';
import { renderHeader } from './header.js';
import { renderPredpoved } from './predpoved.js';
import { renderSedemdni } from './sedemdni.js';
import { renderSpotrebice } from './spotrebice.js';
import { renderZdielat } from './zdielat.js';

/** Na širokej obrazovke sú Spotrebiče a Predpoveď vedľa seba. @param {import('../state.js').AppState} state */
export function isForecastVisible(state) {
    return state.panel === 'predpoved' || (state.desktop && state.panel === 'spotrebice');
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderPanels(state, dom) {
    dom.page.dataset.panel = state.panel;
    for (const p of PANELS) {
        const visible = p === state.panel || (p === 'predpoved' && isForecastVisible(state));
        dom.panels[p].classList.toggle('hidden', !visible);
        dom.navs[p].classList.toggle('active', p === state.panel);
        if (p === state.panel) dom.navs[p].setAttribute('aria-current', 'page');
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
