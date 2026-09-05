// Hlavička: čas, stavová bodka (tarifa × výkon), riadok o aktuálnosti dát.

import { STALE_PV_MS } from '../../shared/config.js';
import { pad2 } from '../../shared/format.js';
import { heroModel } from '../../shared/hero-model.js';

/** @param {import('../state.js').AppState} state */
export function updatedLine(state) {
    if (state.dataError || (!state.pv && !state.forecast)) return 'dáta nedostupné';
    if (!state.pv) return 'živý výkon nedostupný';
    const updated = new Date(state.pv.updatedAt);
    const label = `aktualizované ${pad2(updated.getHours())}:${pad2(updated.getMinutes())}`;
    const stale = state.now.getTime() - updated.getTime() > STALE_PV_MS;
    const suffix = state.source === 'legacy' ? ' · záložný zdroj' : '';
    return stale ? `${label} · zastarané${suffix}` : `${label}${suffix}`;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    dom.currentTimeDisplay.textContent = `${pad2(state.now.getHours())}:${pad2(state.now.getMinutes())}`;
    dom.pvUpdated.textContent = updatedLine(state);
    const tier = heroModel({ ...state, previewMinutes: null }).accent;
    dom.headerStatusDot.className = `live-dot${tier === 'red' ? ' status-red' : tier === 'amber' ? ' status-amber' : ''}`;
}
