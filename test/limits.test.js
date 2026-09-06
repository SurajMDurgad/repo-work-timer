const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { limitState, validateLimit } = require('../src/limits');
const { Store } = require('../src/store');

test('limits change at exact thresholds and retain honest over-limit percentages', () => {
  const hour = 3600000;
  assert.equal(limitState(16 * hour - 1, 20).severity, undefined);
  assert.equal(limitState(16 * hour, 20).severity, 'warning');
  assert.equal(limitState(19 * hour - 1, 20).severity, 'warning');
  assert.equal(limitState(19 * hour, 20).severity, 'error');
  assert.equal(limitState(20 * hour, 20).label, 'Limit reached');
  assert.equal(limitState(22 * hour, 20).percent, 110);
  assert.match(limitState(22 * hour, 20).detail, /2h 00m over limit/);
  assert.equal(limitState(0, 20).severity, undefined);
  for (const hours of [0, -1, NaN, Infinity, '20', undefined, 745]) assert.equal(limitState(hour, hours), undefined);
});

test('limit input accepts decimal hours and removal, rejects invalid input', () => {
  for (const value of ['0', '20', '1.5', ' 2 ', '744']) assert.equal(validateLimit(value), undefined);
  for (const value of ['', ' ', '-1', 'NaN', 'Infinity', '1e2', '0x10', '745', 'twenty']) assert.ok(validateLimit(value));
});

test('limits persist independently per repo, propagate across stores, and preserve history', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-limit-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = { id: 'a', name: 'Example A', root: '/synthetic/a' };
  const b = { id: 'b', name: 'Example B', root: '/synthetic/b' };
  const store = new Store(root), other = new Store(root);
  store.append(a, { start: new Date(2026, 7, 1).getTime(), end: new Date(2026, 7, 1).getTime() + 1000 });
  assert.equal(store.limitHours(a), 0);
  store.setLimitHours(a, 20);
  store.setLimitHours(b, 5);
  assert.equal(other.limitHours(a), 20);
  assert.equal(other.limitHours(b), 5);
  store.setLimitHours(a, 0);
  assert.equal(other.limitHours(a), 0);
  assert.equal(other.limitHours(b), 5);
  assert.equal(store.total(a, '2026-08'), 1000);
  assert.equal(store.total(a, '2026-09'), 0);
  assert.throws(() => store.setLimitHours(a, Infinity));
});
