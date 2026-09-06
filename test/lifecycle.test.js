const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Store } = require('../src/store');
const { Tracker } = require('../src/tracker');
const { repoId } = require('../src/core');
const { migrateLegacy } = require('../src/legacy');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'Example');
  return { root, repo: { id: repoId(repoRoot), root: repoRoot, name: 'Example' }, now: new Date(2026, 8, 6, 12).getTime() };
}

// A fresh module, Store, Tracker, and scanner on every activation. No real
// VS Code APIs, user directories, agent logs, or background timers are used.
async function launch(f, options = {}) {
  let now = f.now, heartbeat;
  const status = { show() {}, hide() {}, dispose() {} }, output = [];
  const disposable = { dispose() {} };
  const event = () => disposable;
  class Clock extends Date { static now() { return now; } }
  class TestTracker extends Tracker {
    update(repos, sources, enabled) { return super.update(repos, sources, enabled, now); }
    stop() { return super.stop(now); }
  }
  const vscode = {
    StatusBarAlignment: { Right: 2 }, ThemeColor: class { constructor(id) { this.id = id; } },
    window: {
      createStatusBarItem: () => status,
      createOutputChannel: () => ({ appendLine: line => output.push(line), dispose() {} }),
      onDidChangeActiveTextEditor: event, onDidStartTerminalShellExecution: event,
      onDidEndTerminalShellExecution: event, onDidCloseTerminal: event
    },
    workspace: {
      workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => fallback }),
      onDidChangeWorkspaceFolders: event, onDidChangeConfiguration: event
    },
    commands: { registerCommand: () => disposable }
  };
  const sandbox = {
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === 'node:os') return { homedir: () => f.root };
      if (name === './repositories') return { discoverRepositories: async () => [f.repo] };
      if (name === './agents') return { AgentScanner: class { async sample() { return new Map(); } } };
      if (name === './processes') return { snapshot: async () => ({ alive: new Set(), terminals: new Set([f.repo.id]) }) };
      if (name === './tracker') return { Tracker: TestTracker };
      if (name === './legacy' && options.migrate) return { migrateLegacy: options.migrate };
      return name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name);
    },
    module: { exports: {} }, process: { platform: options.platform || process.platform, env: {} },
    Date: Clock, Buffer, setInterval: fn => { heartbeat = fn; return 1; }, clearInterval() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), sandbox);
  await sandbox.module.exports.activate({ globalStorageUri: { fsPath: path.join(f.root, 'storage') }, subscriptions: [] });
  return {
    status, output,
    async tick(ms = 10000) { now += ms; heartbeat(); await new Promise(resolve => setImmediate(resolve)); },
    stop: () => sandbox.module.exports.deactivate()
  };
}

test('released extension identity and repository keys stay compatible', () => {
  const manifest = require('../package.json');
  assert.equal(`${manifest.publisher}.${manifest.name}`, 'SurajMDurgad.repo-work-timer', 'Changing identity requires a migration plan');
  // Fixed synthetic input catches accidental changes to the persisted hash format.
  assert.equal(repoId('/synthetic/Example'), '107251e8cfbc944054cc');
});

test('activation retains version-1 history, shutdown/crash checkpoints, limits, pause and prior months', async t => {
  const f = fixture(t), store = new Store(path.join(f.root, 'storage', 'logs'));
  // Write the released schema directly so this fixture cannot silently change
  // with Store.append. Package/extension directories are intentionally absent.
  const monthDir = path.join(store.directory(f.repo), '2026-09');
  fs.mkdirSync(monthDir, { recursive: true });
  const start = new Date(2026, 8, 5, 9).getTime();
  fs.writeFileSync(path.join(monthDir, 'previous-release.jsonl'), JSON.stringify({
    version: 1, month: '2026-09', start, end: start + 7 * 3600000, sources: ['Terminal']
  }) + '\n');
  const august = new Date(2026, 7, 5, 9).getTime();
  store.append(f.repo, { start: august, end: august + 3600000 });
  store.setLimitHours(f.repo, 20);
  let host = await launch(f);
  assert.match(host.status.text, /7h 00m/);
  await host.tick();
  host.stop();
  f.now += 3600000;
  host = await launch(f);
  assert.equal(store.total(f.repo, '2026-09'), 7 * 3600000 + 10000);
  await host.tick();
  // Discard this host without deactivate(), as after an extension-host crash.
  f.now += 3600000;
  host = await launch(f);
  assert.equal(store.total(f.repo, '2026-09'), 7 * 3600000 + 20000);
  assert.equal(store.limitHours(f.repo), 20);
  host.stop();
  store.setPaused(f.repo, true);
  host = await launch(f);
  assert.match(host.status.tooltip, /Paused/);
  await host.tick();
  host.stop();
  assert.equal(store.total(f.repo, '2026-09'), 7 * 3600000 + 20000);
  f.now = new Date(2026, 9, 1, 12).getTime();
  host = await launch(f);
  assert.match(host.status.text, /2026-10.*0h 00m/);
  assert.equal(store.total(f.repo, '2026-08'), 3600000);
  assert.equal(store.total(f.repo, '2026-09'), 7 * 3600000 + 20000);
  assert.equal(store.limitHours(f.repo), 20);
  host.stop();
});

test('startup migration failures stay visible, retry, and preserve ongoing runtime', async t => {
  const f = fixture(t);
  const directory = path.join(f.root, 'Library', 'Application Support', 'Repo Work Timer', f.repo.name);
  fs.mkdirSync(directory, { recursive: true });
  const start = new Date(2026, 8, 5, 9).getTime();
  fs.writeFileSync(path.join(directory, '2026-09.jsonl'), JSON.stringify({
    repo: f.repo.root, start, end: start + 7 * 3600000, sources: ['Codex']
  }) + '\n');
  let attempts = 0;
  const host = await launch(f, { platform: 'darwin', migrate: (...args) => {
    if (++attempts <= 2) throw new Error('Synthetic read failure');
    return migrateLegacy(...args);
  } });
  assert.match(host.status.text, /History recovery pending/);
  await host.tick();
  assert.match(host.status.text, /History recovery pending/);
  const store = new Store(path.join(f.root, 'storage', 'logs'));
  assert.equal(store.total(f.repo, '2026-09'), 10000);
  await host.tick();
  assert.match(host.status.text, /7h 00m/);
  assert.equal(store.total(f.repo, '2026-09'), 7 * 3600000 + 20000);
  assert.equal(host.output.filter(line => /History recovery failed/.test(line)).length, 1);
  host.stop();
  const restarted = await launch(f, { platform: 'darwin' });
  assert.match(restarted.status.text, /7h 00m/);
  assert.equal(store.total(f.repo, '2026-09'), 7 * 3600000 + 20000);
  restarted.stop();
});
