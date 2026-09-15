// Hlavička: čas, stavová bodka (tarifa × výkon), riadok o aktuálnosti dát a farba tarify
// pre pozadie celej stránky (vrátane náhľadu iného času).

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
    // Bodka je vždy o stave teraz, preto ju náhľad iného času nezaujíma. Pozadie naopak
    // sleduje aj bežca na prstenci, takže pri jeho posúvaní vidno farbu okna, na ktoré sa
    // práve pozeráš. Bez náhľadu je to ten istý model, netreba ho rátať dvakrát.
    const live = heroModel({ ...state, previewMinutes: null });
    const shown = state.previewMinutes === null ? live : heroModel(state);
    const accent = live.accent;
    dom.headerStatusDot.className = `live-dot${accent === 'red' ? ' status-red' : accent === 'amber' ? ' status-amber' : ''}`;
    // Pozadie drží farbu tarifného okna (tier), nie "smart" farbu bodky (accent, tá počíta
    // aj so slnkom) - hovorí teda to isté, čo segment pod bežcom na dennom prstenci.
    dom.root.dataset.tier = shown.tier || '';
}
