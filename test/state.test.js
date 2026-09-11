import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, initialState, navChange, navStep, navStepFrom, nextPanel, panelChange, sameNavStep } from '../web/state.js';

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

test('krok navigácie pre tlačidlo Späť je karta a detail dňa, nič iné', () => {
    const state = initialState(new Date(), 'summer', { wide: false, desktop: false });
    assert.deepEqual(navStep(state), { panel: 'terazky', weekDetail: false });
    // Vybraný deň ani stránka verdiktu nie sú miesto v appke - Späť sa na ne nevracia.
    assert.ok(sameNavStep(navStep(state), navStep({ ...state, weekSelDay: 4, verdictPage: 2 })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, panel: '7dni' })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, weekDetail: true })));
});

test('Späť obnoví kartu aj detail dňa, smer prechodu ide podľa poradia', () => {
    assert.deepEqual(navChange('zdielat', { panel: '7dni', weekDetail: true }, false), {
        panel: '7dni',
        panelDir: -1,
        weekDetail: true,
    });
    // Na rozdiel od panelChange sa detail dňa nezatvára, ale nastavuje na to, čo v kroku bolo.
    assert.deepEqual(navChange('terazky', { panel: '7dni', weekDetail: false }, false), {
        panel: '7dni',
        panelDir: 1,
        weekDetail: false,
    });
});

test('položka histórie sa číta len ak naozaj nesie krok navigácie', () => {
    assert.deepEqual(navStepFrom({ step: { panel: '7dni', weekDetail: true } }), { panel: '7dni', weekDetail: true });
    assert.equal(navStepFrom(null), null, 'cudzia položka bez stavu');
    assert.equal(navStepFrom({ scrollTop: 10 }), null, 'položka od niekoho iného');
    assert.equal(navStepFrom({ step: { panel: 'neznama', weekDetail: false } }), null, 'karta, ktorá už neexistuje');
    assert.equal(navStepFrom({ step: { panel: '7dni' } }), null, 'neúplný krok');
});
