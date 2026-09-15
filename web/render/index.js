// Jediné miesto, ktoré prekresľuje UI: vždy hlavičku a viditeľné karty, nič iné.

import { PANELS } from '../dom.js';
import { renderHeader } from './header.js';
import { renderSedemdni } from './sedemdni.js';
import { renderTerazky } from './terazky.js';
import { renderZdielat } from './zdielat.js';

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderPanels(state, dom) {
    dom.page.dataset.panel = state.panel;
    // Smer posledného prechodu; z neho si CSS vyberie, z ktorej strany kartu prisunie.
    dom.page.dataset.dir = state.panelDir > 0 ? 'next' : 'prev';
    for (const p of PANELS) {
        dom.panels[p].classList.toggle('hidden', p !== state.panel);
        dom.navs[p].classList.toggle('active', p === state.panel);
        if (p === state.panel) dom.navs[p].setAttribute('aria-current', 'page');
        else dom.navs[p].removeAttribute('aria-current');
    }
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function render(state, dom) {
    renderHeader(state, dom);
    renderPanels(state, dom);
    if (state.panel === 'terazky') renderTerazky(state, dom);
    if (state.panel === '7dni') renderSedemdni(state, dom);
    if (state.panel === 'zdielat') renderZdielat(state, dom);
}
