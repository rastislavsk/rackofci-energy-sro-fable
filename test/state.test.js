import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, initialState, nextPanel, panelChange } from '../web/state.js';

test('setState zlúči zmenu a zavolá odberateľa presne raz', () => {
    const store = createStore(initialState(new Date('2026-09-05T11:00:00Z'), 'summer', { wide: false, desktop: false }));
    let calls = 0;
    store.subscribe(() => calls++);
    store.setState({ panel: '7dni', weekSelDay: 3 });
    assert.equal(calls, 1);
    assert.equal(store.get().panel, '7dni');
    assert.equal(store.get().weekSelDay, 3);
    assert.equal(store.get().season, 'summer');
    assert.equal(store.get().verdictPage, 0, 'verdikt začína na prvej stránke');
});

test('rovnaké hodnoty nespustia prekreslenie, odhlásenie funguje', () => {
    const store = createStore(initialState(new Date(), 'winter', { wide: true, desktop: true }));
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setState({ panel: 'terazky', wide: true });
    assert.equal(calls, 0);
    off();
    store.setState({ panel: 'zdielat' });
    assert.equal(calls, 0);
});

test('poradie kariet pri listovaní prstom: na kraji sa nezacyklí', () => {
    assert.equal(nextPanel('terazky', false, 1), 'predpoved');
    assert.equal(nextPanel('predpoved', false, 1), '7dni');
    assert.equal(nextPanel('7dni', false, 1), 'zdielat');
    assert.equal(nextPanel('zdielat', false, 1), null, 'za poslednou kartou už nič nie je');
    assert.equal(nextPanel('7dni', false, -1), 'predpoved');
    assert.equal(nextPanel('terazky', false, -1), null, 'pred prvou kartou už nič nie je');
});

test('poradie kariet na desktope preskočí Predpoveď, tá tam splýva so Spotrebičmi', () => {
    assert.equal(nextPanel('terazky', true, 1), '7dni');
    assert.equal(nextPanel('7dni', true, -1), 'terazky');
    assert.equal(nextPanel('zdielat', true, 1), null);
    // Stav môže na 'predpoved' ostať po rozšírení okna; swipe.js sem posiela effectivePanel,
    // takže samotná 'predpoved' na desktope je mimo poradia a nikam nevedie.
    assert.equal(nextPanel('predpoved', true, 1), null);
});

test('smer prechodu ide podľa poradia v navigácii, nie podľa toho, ako sa prepínalo', () => {
    assert.deepEqual(panelChange('terazky', '7dni', false), { panel: '7dni', panelDir: 1, weekDetail: false });
    assert.deepEqual(panelChange('zdielat', 'predpoved', false), { panel: 'predpoved', panelDir: -1, weekDetail: false });
    // Na desktope je Predpoveď mimo poradia, takže krok z nej sa počíta ako dopredu.
    assert.equal(panelChange('terazky', 'zdielat', true).panelDir, 1);
    assert.equal(panelChange('zdielat', 'terazky', true).panelDir, -1);
    assert.equal(panelChange('predpoved', 'terazky', true).panelDir, 1);
});
