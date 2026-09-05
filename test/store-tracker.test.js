const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { Tracker } = require('../src/tracker');
const { monthKey } = require('../src/core');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-timer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, repo: { id: 'test-repo', name: 'Example', root: path.join(root, 'example') } };
}
test('background runtime, overlapping sources, pause/resume, and sleep', t => {
  const { root, repo } = fixture(t);
  const store = new Store(root);
  const tracker = new Tracker(store);
  let now = Date.now();
  const month = monthKey(now);
  const active = new Map([[repo.id, new Set(['Claude', 'Codex', 'Terminal'])]]);
  tracker.update([repo], active, true, now);
  tracker.update([repo], active, true, now += 10000);
  assert.equal(store.total(repo, month), 10000);
  store.setPaused(repo, true);
  tracker.update([repo], active, true, now);
  tracker.update([repo], active, true, now += 10000);
  assert.equal(store.total(repo, month), 10000);
  store.setPaused(repo, false);
  tracker.update([repo], active, true, now);
  tracker.update([repo], active, true, now += 600000);
  assert.equal(store.total(repo, month), 10000);
  tracker.update([repo], active, true, now += 10000);
  tracker.stop(now + 5000);
  assert.equal(store.total(repo, month), 25000);
});
test('separate windows merge once; imports are idempotent and survive restart', t => {
  const { root, repo } = fixture(t);
  const first = new Store(root, 'window-one');
  const second = new Store(root, 'window-two');
  const start = Date.now(), month = monthKey(start);
  first.append(repo, { start, end: start + 10000, sources: ['Codex'] });
  second.append(repo, { start: start + 5000, end: start + 15000, sources: ['Terminal'] });
  assert.equal(first.total(repo, month), 15000);
  const imported = [{ start: start - 5000, end: start + 15000, sources: ['Claude'] }];
  assert.equal(first.import(repo, month, imported), 1);
  assert.equal(second.import(repo, month, imported), 0);
  assert.equal(new Store(root).total(repo, month), 20000);
  first.setPaused(repo, true);
  assert.equal(second.paused(repo), true);
});
test('short terminal commands and disabling tracking keep only elapsed runtime', t => {
  const { root, repo } = fixture(t), store = new Store(root), tracker = new Tracker(store);
  const start = Date.now(), active = new Map([[repo.id, new Set(['Terminal'])]]);
  tracker.update([repo], active, true, start);
  tracker.update([repo], new Map(), true, start + 500);
  tracker.update([repo], active, false, start + 5000);
  tracker.update([repo], active, false, start + 10000);
  assert.equal(store.total(repo, monthKey(start)), 500);
});
