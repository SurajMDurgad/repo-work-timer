process.env.TZ = 'Asia/Kolkata';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/core');
test('month rollover splits local calendar months, including December', () => {
  for (const [date, expected] of [['2026-09-30', ['2026-09', '2026-10']], ['2026-12-31', ['2026-12', '2027-01']]]) {
    const start = Date.parse(`${date}T23:59:55+05:30`);
    const parts = c.splitInterval(start, start + 10000);
    assert.deepEqual(parts.map(p => p.month), expected);
    assert.deepEqual(parts.map(p => p.end - p.start), [5000, 5000]);
  }
});
test('overlapping sources, nested intervals, duplicates, and malformed records', () => {
  assert.equal(c.duration([{ start: 0, end: 100 }, { start: 5, end: 20 }, { start: 90, end: 150 }, { start: 0, end: 100 }, { start: NaN, end: 500 }, { start: 200, end: 190 }]), 150);
  assert.equal(c.duration(c.parseRecords('{"start":0,"end":100}\n{"start":')), 100);
});
test('daily export merges overlaps and splits midnight', () => {
  const start = Date.parse('2026-09-05T23:59:50+05:30');
  assert.deepEqual(c.dailyTotals([{ start, end: start + 20000 }, { start, end: start + 5000 }]), [['2026-09-05', 10000], ['2026-09-06', 10000]]);
});
test('paths use directory boundaries, not string prefixes', () => {
  const path = require('node:path');
  const root = path.resolve('workspace', 'project');
  assert.equal(c.inside(path.join(root, 'src'), root), true);
  assert.equal(c.inside(root + '-other', root), false);
  assert.equal(c.inside(undefined, root), false);
});
test('duration formatting and month validation', () => {
  assert.equal(c.formatDuration(40 * 3600000 + 35 * 60000), '40h 35m');
  assert.throws(() => c.monthBounds('../2026-09'));
  assert.throws(() => c.monthBounds('2026-13'));
  assert.ok(c.monthBounds('2026-09')[1] > c.monthBounds('2026-09')[0]);
});
