// Štart appky: DOM, stav, prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { seasonFor } from './shared/tariff.js';
import { collectDom } from './web/dom.js';
import { initInteractions } from './web/interactions.js';
import { render } from './web/render/index.js';
import { createStore, initialState } from './web/state.js';

// Jediná šírka, o ktorej appka vie: od 768 px kreslí grafy na skutočný rozmer karty.
// Zvyšok rozloženia (vrátane desktopu od 1024 px) rieši CSS samo.
const mq = { wide: window.matchMedia('(min-width: 768px)') };
const dom = collectDom();
const now = new Date();
const store = createStore(initialState(now, seasonFor(now), { wide: mq.wide.matches }));

store.subscribe((state) => render(state, dom));
const refresh = initInteractions(store, dom, mq);
render(store.get(), dom);
refresh();
