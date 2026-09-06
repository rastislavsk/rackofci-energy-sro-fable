import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changed, changedKeys, sameKeys } from '../web/memo.js';

test('sameKeys: porovnáva identitu, nie obsah', () => {
    const obj = { a: 1 };
    assert.ok(sameKeys([1, 'x', obj], [1, 'x', obj]));
    assert.ok(sameKeys([], []));
    assert.ok(!sameKeys([1], [1, 2]), 'iná dĺžka');
    assert.ok(!sameKeys([{ a: 1 }], [{ a: 1 }]), 'rovnaký obsah, iný objekt = zmena');
    assert.ok(!sameKeys([1], ['1']), 'porovnáva sa bez pretypovania');
});

test('changedKeys: prvé volanie je zmena, potom až pri inom kľúči', () => {
    const data = { x: 1 };
    assert.ok(changedKeys('a', [data, 5]), 'prvé volanie');
    assert.ok(!changedKeys('a', [data, 5]), 'tie isté kľúče');
    assert.ok(changedKeys('a', [data, 6]), 'zmenená hodnota');
    assert.ok(changedKeys('a', [{ x: 1 }, 6]), 'nový objekt s rovnakým obsahom je zmena');
});

test('changedKeys: každý názov má vlastnú pamäť', () => {
    const data = { x: 1 };
    assert.ok(changedKeys('b', [data]));
    assert.ok(changedKeys('c', [data]), 'nový názov začína odznova');
    assert.ok(!changedKeys('b', [data]), 'zápis pod "c" nesmie prebiť pamäť "b"');
    assert.ok(!changedKeys('c', [data]));
});

test('changed: jediná hodnota, vrátane null a undefined', () => {
    assert.ok(changed('d', 'a'));
    assert.ok(!changed('d', 'a'));
    assert.ok(changed('d', null));
    assert.ok(!changed('d', null));
    assert.ok(changed('d', undefined));
    assert.ok(!changed('d', undefined), 'zapamätané undefined sa nesmie tváriť ako prázdna pamäť');
});
