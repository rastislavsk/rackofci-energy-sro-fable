import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    escapeHtml,
    fmt1,
    formatGridKw,
    hourFloatToTimeStr,
    minutesToTimeStr,
    timeStrToMinutes,
    weekDayLabel,
    weekDayShort,
} from '../shared/format.js';

test('čas', () => {
    assert.equal(minutesToTimeStr(0), '00:00');
    assert.equal(minutesToTimeStr(1445), '00:05');
    assert.equal(minutesToTimeStr(-5), '23:55');
    assert.equal(timeStrToMinutes('23:30'), 1410);
    assert.equal(hourFloatToTimeStr(13.5), '13:30');
});

test('čísla a popisky', () => {
    assert.equal(fmt1(3.14), '3,1');
    assert.equal(formatGridKw(2), '2');
    assert.equal(formatGridKw(0.25), '0,25');
    assert.equal(formatGridKw(0.5), '0,5');
    assert.equal(weekDayShort('2026-09-05', 0), 'Dnes');
    assert.equal(weekDayShort('2026-09-06', 1), 'Zajtra');
    assert.equal(weekDayShort('2026-09-07', 2), 'Po');
    assert.equal(weekDayLabel('2026-09-09', 4), 'St 9.9.');
    assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
