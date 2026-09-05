const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Store } = require('../src/store');
const { Tracker } = require('../src/tracker');
const { monthKey } = require('../src/core');

test('VS Code wiring: right-side timer, background runtime, terminal events, and controls', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-extension-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = { id: 'example', name: 'Example', root: path.join(root, 'example') };
  const listeners = {}, commands = new Map(), errors = [];
  let now = Date.now(), heartbeat, live = true, pick;
  const disposable = { dispose() {} };
  const status = { show() {}, hide() {}, dispose() {} };
  const window = {
    state: { focused: false },
    createOutputChannel: () => ({ appendLine: line => errors.push(line), show() {}, dispose() {} }),
    createStatusBarItem: (id, alignment, priority) => { assert.equal(alignment, 2); assert.equal(priority, -10000); return status; },
    showQuickPick: async () => pick,
    showErrorMessage: async text => errors.push(text),
    showInformationMessage: async () => undefined
  };
  for (const name of ['onDidChangeActiveTextEditor', 'onDidStartTerminalShellExecution', 'onDidEndTerminalShellExecution', 'onDidCloseTerminal']) window[name] = fn => { listeners[name] = fn; return disposable; };
  const vscode = {
    window, env: {}, StatusBarAlignment: { Right: 2 },
    workspace: {
      workspaceFolders: [], getConfiguration: () => ({ get: (name, fallback) => fallback }),
      onDidChangeWorkspaceFolders: () => disposable, onDidChangeConfiguration: () => disposable
    },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return disposable; } }
  };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  class TestTracker extends Tracker {
    update(repos, sources, enabled) { return super.update(repos, sources, enabled, now); }
    stop() { return super.stop(now); }
  }
  const sandbox = {
    require: name => {
      if (name === 'vscode') return vscode;
      if (name === './repositories') return { discoverRepositories: async () => [repo], repoForPath: cwd => cwd === repo.root ? repo : undefined };
      if (name === './agents') return { AgentScanner: class { async sample() { return new Map([[repo.id, new Set(live ? ['Claude', 'Codex'] : [])]]); } } };
      if (name === './processes') return { snapshot: async () => ({ alive: new Set(), terminals: new Set() }) };
      if (name === './tracker') return { Tracker: TestTracker };
      return name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name);
    },
    module: { exports: {} }, process, Buffer, Date: Clock,
    setInterval: fn => { heartbeat = fn; return 1; }, clearInterval() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), sandbox);
  await sandbox.module.exports.activate({ globalStorageUri: { fsPath: root }, subscriptions: [] });
  const store = new Store(path.join(root, 'logs')), month = monthKey(now);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  now += 10000; heartbeat(); await settle();
  assert.equal(store.total(repo, month), 10000);
  assert.match(status.text, /Example/);
  pick = 'Pause timer'; await commands.get('repoWorkTimer.menu')();
  now += 10000; heartbeat(); await settle();
  assert.equal(store.total(repo, month), 10000);
  live = false; pick = 'Resume timer'; await commands.get('repoWorkTimer.menu')();
  heartbeat(); await settle();
  const execution = { cwd: { scheme: 'file', fsPath: repo.root }, commandLine: { value: 'npm test' } }, terminal = {};
  listeners.onDidStartTerminalShellExecution({ execution, terminal, shellIntegration: {} });
  now += 500; listeners.onDidEndTerminalShellExecution({ execution });
  assert.equal(store.total(repo, month), 10500);
  assert.equal(commands.size, 4);
  sandbox.module.exports.deactivate();
  assert.equal(errors.some(line => /error/i.test(line)), false);
});
