// Štart appky: DOM, stav, prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { seasonFor } from './shared/tariff.js';
import { collectDom } from './web/dom.js';
import { initInteractions } from './web/interactions.js';
import { render } from './web/render/index.js';
import { createStore, initialState } from './web/state.js';

const mq = { wide: window.matchMedia('(min-width: 768px)'), desktop: window.matchMedia('(min-width: 1024px)') };
const dom = collectDom();
const now = new Date();
const store = createStore(initialState(now, seasonFor(now), { wide: mq.wide.matches, desktop: mq.desktop.matches }));

store.subscribe((state) => render(state, dom));
const refresh = initInteractions(store, dom, mq);
render(store.get(), dom);
refresh();
