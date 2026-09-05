import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, initialState } from '../web/state.js';

test('setState zlúči zmenu a zavolá odberateľa presne raz', () => {
    const store = createStore(initialState(new Date('2026-09-05T11:00:00Z'), 'summer', { wide: false, desktop: false }));
    let calls = 0;
    store.subscribe(() => calls++);
    store.setState({ panel: '7dni', weekSelDay: 3 });
    assert.equal(calls, 1);
    assert.equal(store.get().panel, '7dni');
    assert.equal(store.get().weekSelDay, 3);
    assert.equal(store.get().season, 'summer');
});

test('rovnaké hodnoty nespustia prekreslenie, odhlásenie funguje', () => {
    const store = createStore(initialState(new Date(), 'winter', { wide: true, desktop: true }));
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setState({ panel: 'spotrebice', wide: true });
    assert.equal(calls, 0);
    off();
    store.setState({ panel: 'zdielat' });
    assert.equal(calls, 0);
});
