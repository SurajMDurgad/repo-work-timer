const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { Tracker } = require('../src/tracker');
const { migrateLegacy } = require('../src/legacy');

test('legacy hours survive migration, overlapping live logs, restarts, and growing source files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = { id: 'example', name: 'Example', root: path.join(root, 'Example') };
  const legacy = path.join(root, 'legacy'), directory = path.join(legacy, repo.name);
  const storage = path.join(root, 'storage');
  const store = new Store(storage);
  assert.equal(migrateLegacy(store, repo, legacy), 0);
  fs.mkdirSync(directory, { recursive: true });
  const start = new Date(2026, 8, 5, 9).getTime(), hour = 3600000;
  const record = { repo: repo.root, start, end: start + 7 * hour, sources: ['Codex'], historical: true };
  const file = path.join(directory, '2026-09.jsonl');
  const original = JSON.stringify(record) + '\n';
  fs.writeFileSync(file, original);
  const previous = new Date(2026, 7, 5, 9).getTime();
  fs.writeFileSync(path.join(directory, '2026-08.jsonl'), JSON.stringify({ ...record, start: previous, end: previous + hour }) + '\n');
  store.append(repo, { start: record.end - 60000, end: record.end + 4 * 60000 });
  assert.equal(migrateLegacy(store, repo, legacy), 2);
  assert.equal(store.total(repo, '2026-09'), 7 * hour + 4 * 60000);
  assert.equal(store.total(repo, '2026-08'), hour);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  const restarted = new Store(storage);
  assert.equal(migrateLegacy(restarted, repo, legacy), 0);
  assert.equal(restarted.total(repo, '2026-09'), 7 * hour + 4 * 60000);
  const tracker = new Tracker(restarted), now = record.end + hour;
  tracker.update([repo], new Map([[repo.id, new Set(['Terminal'])]]), true, now);
  tracker.stop(now + 10000);
  assert.equal(new Store(storage).total(repo, '2026-09'), 7 * hour + 4 * 60000 + 10000);
  fs.appendFileSync(file, JSON.stringify({ ...record, start: record.end, end: record.end + 5 * 60000 }) + '\n');
  migrateLegacy(restarted, repo, legacy);
  assert.equal(restarted.total(repo, '2026-09'), 7 * hour + 5 * 60000 + 10000);
  assert.equal(migrateLegacy(new Store(storage), repo, legacy), 0);
});

test('migration rejects other repositories and invalid records, and clips records to their month', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = { id: 'example', root: path.join(root, 'Example') };
  const directory = path.join(root, 'legacy', 'Example');
  fs.mkdirSync(directory, { recursive: true });
  const start = new Date(2026, 8, 1).getTime();
  const record = { repo: repo.root, start: start - 60000, end: start + 60000 };
  fs.writeFileSync(path.join(directory, '2026-09.jsonl'), [
    record, { ...record, repo: path.join(root, 'other', 'Example'), end: start + 3600000 },
    { ...record, repo: undefined }, { ...record, start: 'invalid' }, { ...record, end: start - 120000 }
  ].map(JSON.stringify).join('\n') + '\n{"truncated":');
  const store = new Store(path.join(root, 'storage'));
  assert.equal(migrateLegacy(store, repo, path.join(root, 'legacy')), 1);
  assert.equal(store.total(repo, '2026-09'), 60000);
  assert.deepEqual(store.months(repo), ['2026-09']);
});
