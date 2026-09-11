// Tlačidlo Späť (mobil, tablet, aj šípka v prehliadači) vracia o krok v appke, nie rovno
// preč zo stránky. Každý krok navigácie - prepnutie karty, otvorenie detailu dňa - pridá
// položku do histórie prehliadača; Späť ju vyberie a appka sa vráti tam, kde bola.
//
// Appka pritom nemení adresu: položky histórie sú len značky s krokom navigácie, aby
// odkaz na appku ostal jeden (zdieľa sa na karte Zdieľať) a neťahal si za sebou, na
// ktorej karte kto naposledy stál.
//
// Zatvorenie appky sa nikde nevynucuje a ani nedá: stránka sa sama zavrieť nevie a
// dvojitý stlačok Späť je zvyk natívnych androidových appiek, nie webu. Vychádza to
// však narovnako - keď sa Späť vyčerpajú kroky v appke, ďalší stlačok ju opustí, čo je
// v nainštalovanej appke (PWA) jej zatvorenie.

import { effectivePanel } from './render/index.js';
import { navChange, navStep, navStepFrom, sameNavStep } from './state.js';

/** @param {import('./state.js').Store} store */
export function initHistory(store) {
    // Kým sa appka vracia späť, nesmie ten istý krok zapísať do histórie znovu - inak by
    // sa Späť zacyklilo na dvoch položkách a z appky by sa nedalo odísť.
    let vraciaSa = false;

    history.replaceState({ step: navStep(store.get()) }, '');
    store.subscribe((state, prev) => {
        if (vraciaSa || sameNavStep(navStep(state), navStep(prev))) return;
        history.pushState({ step: navStep(state) }, '');
    });

    window.addEventListener('popstate', (e) => {
        const step = navStepFrom(e.state);
        if (!step) return;
        vraciaSa = true;
        const state = store.get();
        // Rovnaká cesta ako pri kliku na navigáciu: jediný setState, jediné prekreslenie.
        store.setState(navChange(effectivePanel(state), step, state.desktop));
        vraciaSa = false;
    });
}
