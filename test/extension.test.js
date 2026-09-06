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
  const otherRepo = { id: 'other', name: 'Other', root: path.join(root, 'other') };
  const listeners = {}, commands = new Map(), errors = [];
  let now = new Date(2026, 8, 6, 12).getTime(), heartbeat, live = true, pick, input;
  const disposable = { dispose() {} };
  const status = { show() {}, hide() {}, dispose() {} };
  const window = {
    state: { focused: false },
    createOutputChannel: () => ({ appendLine: line => errors.push(line), show() {}, dispose() {} }),
    createStatusBarItem: (id, alignment, priority) => { assert.equal(alignment, 2); assert.equal(priority, -10000); return status; },
    showQuickPick: async () => pick,
    showInputBox: async () => input,
    showErrorMessage: async text => errors.push(text),
    showInformationMessage: async () => undefined
  };
  for (const name of ['onDidChangeActiveTextEditor', 'onDidStartTerminalShellExecution', 'onDidEndTerminalShellExecution', 'onDidCloseTerminal']) window[name] = fn => { listeners[name] = fn; return disposable; };
  const vscode = {
    window, env: {}, StatusBarAlignment: { Right: 2 }, ThemeColor: class { constructor(id) { this.id = id; } },
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
      if (name === './repositories') return { discoverRepositories: async () => [repo, otherRepo], repoForPath: cwd => [repo, otherRepo].find(r => r.root === cwd) };
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
  assert.equal(commands.size, 6);
  pick = { repo }; input = '1'; await commands.get('repoWorkTimer.setLimit')();
  assert.equal(store.limitHours(repo), 1);
  input = undefined; await commands.get('repoWorkTimer.setLimit')();
  assert.equal(store.limitHours(repo), 1);
  const start = new Date(2026, 8, 1).getTime();
  store.append(repo, { start, end: start + 0.8 * 3600000 });
  heartbeat(); await settle();
  assert.equal(status.backgroundColor.id, 'statusBarItem.warningBackground');
  assert.match(status.text, /arrow-right.*Approaching limit/);
  store.append(repo, { start, end: start + 0.95 * 3600000 });
  heartbeat(); await settle();
  assert.equal(status.backgroundColor.id, 'statusBarItem.errorBackground');
  assert.equal(status.color.id, 'statusBarItem.errorForeground');
  assert.match(status.accessibilityInformation.label, /Almost at limit/);
  listeners.onDidChangeActiveTextEditor({ document: { uri: { scheme: 'file', fsPath: otherRepo.root } } });
  assert.equal(status.backgroundColor, undefined);
  assert.equal(status.color, undefined);
  assert.match(status.text, /Other/);
  listeners.onDidChangeActiveTextEditor({ document: { uri: { scheme: 'file', fsPath: repo.root } } });
  assert.equal(status.backgroundColor.id, 'statusBarItem.errorBackground');
  input = '0'; await commands.get('repoWorkTimer.setLimit')();
  assert.equal(status.backgroundColor, undefined);
  input = '1'; await commands.get('repoWorkTimer.setLimit')();
  assert.equal(status.backgroundColor.id, 'statusBarItem.errorBackground');
  now = new Date(2026, 9, 1, 12).getTime(); heartbeat(); await settle();
  assert.equal(status.backgroundColor, undefined);
  assert.equal(store.limitHours(repo), 1);
  input = '0'; await commands.get('repoWorkTimer.setLimit')();
  assert.equal(status.color, undefined);
  assert.doesNotMatch(status.text, /%/);
  sandbox.module.exports.deactivate();
  assert.equal(errors.some(line => /error/i.test(line)), false);
});
