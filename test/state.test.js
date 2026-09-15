import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, initialState, navChange, navStep, navStepFrom, nextPanel, panelChange, sameNavStep } from '../web/state.js';

test('setState zlúči zmenu a zavolá odberateľa presne raz', () => {
    const store = createStore(initialState(new Date('2026-09-05T11:00:00Z'), 'summer', { wide: false }));
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
    const store = createStore(initialState(new Date(), 'winter', { wide: true }));
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setState({ panel: 'terazky', wide: true });
    assert.equal(calls, 0);
    off();
    store.setState({ panel: 'zdielat' });
    assert.equal(calls, 0);
});

test('poradie kariet pri listovaní prstom: na kraji sa nezacyklí', () => {
    assert.equal(nextPanel('terazky', 1), '7dni');
    assert.equal(nextPanel('7dni', 1), 'zdielat');
    assert.equal(nextPanel('zdielat', 1), null, 'za poslednou kartou už nič nie je');
    assert.equal(nextPanel('7dni', -1), 'terazky');
    assert.equal(nextPanel('terazky', -1), null, 'pred prvou kartou už nič nie je');
});

test('smer prechodu ide podľa poradia v navigácii, nie podľa toho, ako sa prepínalo', () => {
    assert.deepEqual(panelChange('terazky', '7dni'), { panel: '7dni', panelDir: 1, weekDetail: null });
    assert.deepEqual(panelChange('zdielat', '7dni'), { panel: '7dni', panelDir: -1, weekDetail: null });
    assert.equal(panelChange('terazky', 'zdielat').panelDir, 1);
    assert.equal(panelChange('zdielat', 'terazky').panelDir, -1);
});

test('krok navigácie pre tlačidlo Späť je karta a otvorený detail, nič iné', () => {
    const state = initialState(new Date(), 'summer', { wide: false });
    assert.deepEqual(navStep(state), { panel: 'terazky', weekDetail: null });
    // Vybraný deň ani stránka verdiktu nie sú miesto v appke - Späť sa na ne nevracia.
    assert.ok(sameNavStep(navStep(state), navStep({ ...state, weekSelDay: 4, verdictPage: 2 })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, panel: '7dni' })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, weekDetail: 'day' })));
    // Detail dňa a detail týždňa sú dve rôzne miesta, nie jedno "otvorené".
    assert.ok(!sameNavStep(navStep({ ...state, weekDetail: 'day' }), navStep({ ...state, weekDetail: 'week' })));
});

test('Späť obnoví kartu aj otvorený detail, smer prechodu ide podľa poradia', () => {
    assert.deepEqual(navChange('zdielat', { panel: '7dni', weekDetail: 'day' }), {
        panel: '7dni',
        panelDir: -1,
        weekDetail: 'day',
    });
    // Na rozdiel od panelChange sa detail nezatvára, ale nastavuje na to, čo v kroku bolo.
    assert.deepEqual(navChange('terazky', { panel: '7dni', weekDetail: 'week' }), {
        panel: '7dni',
        panelDir: 1,
        weekDetail: 'week',
    });
});

test('položka histórie sa číta len ak naozaj nesie krok navigácie', () => {
    assert.deepEqual(navStepFrom({ step: { panel: '7dni', weekDetail: 'day' } }), { panel: '7dni', weekDetail: 'day' });
    assert.deepEqual(navStepFrom({ step: { panel: '7dni', weekDetail: 'week' } }), { panel: '7dni', weekDetail: 'week' });
    assert.deepEqual(navStepFrom({ step: { panel: '7dni', weekDetail: null } }), { panel: '7dni', weekDetail: null });
    assert.equal(navStepFrom(null), null, 'cudzia položka bez stavu');
    assert.equal(navStepFrom({ scrollTop: 10 }), null, 'položka od niekoho iného');
    assert.equal(navStepFrom({ step: { panel: 'neznama', weekDetail: null } }), null, 'karta, ktorá už neexistuje');
    assert.equal(navStepFrom({ step: { panel: '7dni' } }), null, 'neúplný krok');
    // Položka zo staršej verzie appky nesie true/false - tú už appka prečítať nevie.
    assert.equal(navStepFrom({ step: { panel: '7dni', weekDetail: true } }), null, 'krok zo staršej verzie');
});
