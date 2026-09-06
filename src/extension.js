'use strict';
const vscode = require('vscode');
const os = require('node:os');
const path = require('node:path');
const { discoverRepositories, repoForPath } = require('./repositories');
const { AgentScanner, historicalIntervals } = require('./agents');
const { snapshot } = require('./processes');
const { Store } = require('./store');
const { migrateLegacy } = require('./legacy');
const { Tracker } = require('./tracker');
const { monthKey, monthBounds, duration, formatDuration, dailyTotals } = require('./core');
const { validateLimit, limitState } = require('./limits');
let stop;

function activate(context) {
  const output = vscode.window.createOutputChannel('Repo Work Timer');
  const status = vscode.window.createStatusBarItem('repoWorkTimer.monthly', vscode.StatusBarAlignment.Right, -10000);
  status.name = 'Monthly Repo Work Timer';
  status.command = 'repoWorkTimer.menu';
  const store = new Store(path.join(context.globalStorageUri.fsPath, 'logs'));
  const tracker = new Tracker(store);
  const scanner = new AgentScanner();
  const terminals = new Map();
  const migrated = new Set(), migrationIssues = new Map();
  let repos = [], selectedId, agentSources = new Map(), processTerminals = new Set();
  let polling = false, disposed = false, issue = '', importing = false;
  const config = () => vscode.workspace.getConfiguration('repoWorkTimer');
  const expand = value => value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  const homes = () => ({
    codex: expand(config().get('codexHome') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex')),
    claude: expand(config().get('claudeHome') || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))
  });
  function selected() { return repos.find(r => r.id === selectedId) || repos[0]; }
  function currentSources() {
    const result = new Map(repos.map(r => [r.id, new Set(agentSources.get(r.id) || [])]));
    for (const id of processTerminals) result.get(id)?.add('Terminal');
    for (const { repoId } of terminals.values()) result.get(repoId)?.add('Terminal');
    return result;
  }
  function render() {
    const repo = selected();
    if (!repo) { status.hide(); return; }
    const migrationIssue = migrationIssues.get(repo.id);
    if (migrationIssue) {
      status.backgroundColor = undefined; status.color = undefined;
      status.text = `$(warning) ${repo.name} · History recovery pending`;
      status.tooltip = `${repo.root}\nSaved history could not be recovered yet. Retrying automatically.\n${migrationIssue}\nCurrent work continues to be saved. Click for Diagnostics.`;
      status.accessibilityInformation = { label: `${repo.name}, history recovery pending, retrying automatically` };
      status.show();
      return;
    }
    const month = monthKey(Date.now());
    const enabled = config().get('enabled', true);
    const sources = [...(currentSources().get(repo.id) || [])];
    const paused = store.paused(repo) || !enabled;
    const running = !paused && sources.length > 0;
    const label = paused ? 'Paused' : sources.length ? `Running: ${sources.join(', ')}` : 'Waiting for Claude, Codex, or terminal work';
    const total = store.total(repo, month);
    const limit = limitState(total, store.limitHours(repo));
    status.backgroundColor = limit?.severity ? new vscode.ThemeColor(`statusBarItem.${limit.severity}Background`) : undefined;
    status.color = limit?.severity ? new vscode.ThemeColor(`statusBarItem.${limit.severity}Foreground`) : undefined;
    status.text = `$(${limit?.icon || (issue ? 'warning' : running ? 'clock' : 'debug-pause')}) ${repo.name} · ${month} · ${limit?.text || formatDuration(total)}`;
    status.tooltip = `${repo.root}\n${label}\n${limit ? limit.detail + '\n' : ''}${issue ? issue + '\n' : ''}Counts background runtime, not keyboard activity.\nClick for controls, history import, and logs.`;
    status.accessibilityInformation = { label: `${repo.name}, ${month}, ${label}, ${formatDuration(total)}${limit ? `, ${limit.label}, ${limit.percent} percent of monthly limit` : ''}` };
    status.show();
  }
  function reconcile() {
    if (disposed) return;
    try { tracker.update(repos, currentSources(), config().get('enabled', true)); render(); }
    catch (e) { report(e); }
  }
  function report(e) {
    issue = e.message;
    status.backgroundColor = undefined; status.color = undefined;
    status.accessibilityInformation = { label: `Repo timer: ${e.message}` };
    output.appendLine(`${new Date().toISOString()} ${e.message}`);
    status.text = '$(warning) Repo timer'; status.tooltip = e.message; status.show();
  }
  async function poll() {
    if (polling || disposed) return;
    polling = true;
    try {
      for (const repo of repos) {
        if (process.platform !== 'darwin' || migrated.has(repo.id)) continue;
        try {
          const added = migrateLegacy(store, repo, path.join(os.homedir(), 'Library', 'Application Support', 'Repo Work Timer'));
          if (added) output.appendLine(`Migrated ${added} legacy records for ${repo.name}; original logs preserved.`);
          migrated.add(repo.id);
          migrationIssues.delete(repo.id);
        } catch (e) {
          if (migrationIssues.get(repo.id) !== e.message) output.appendLine(`History recovery failed for ${repo.name}: ${e.message}. Retrying automatically.`);
          migrationIssues.set(repo.id, e.message);
        }
      }
      if (repos.length && config().get('enabled', true)) {
        const state = await snapshot(repos, config().get('externalTerminals', true));
        agentSources = await scanner.sample(repos, homes(), state.alive, config().get('staleAgentMinutes', 30) * 60000);
        processTerminals = state.terminals;
      } else { agentSources = new Map(); processTerminals = new Set(); }
      issue = '';
    } catch (e) {
      agentSources = new Map(); processTerminals = new Set(); report(e);
    } finally { polling = false; reconcile(); }
  }
  async function refresh() {
    try {
      repos = await discoverRepositories(vscode.workspace.workspaceFolders || []);
      for (const repo of repos) store.initialize(repo);
      await poll();
    } catch (e) { report(e); }
  }
  async function chooseRepo() {
    if (!repos.length) { await vscode.window.showInformationMessage('Open a trusted Git repository to use Repo Work Timer.'); return; }
    if (repos.length === 1) return repos[0];
    const choice = await vscode.window.showQuickPick(repos.map(repo => ({ label: repo.name, description: repo.root, repo })), { title: 'Choose a repository' });
    if (choice) { selectedId = choice.repo.id; render(); return choice.repo; }
  }
  async function history(repo = selected()) {
    if (!repo) return chooseRepo();
    const lines = [`# ${repo.name} — monthly runtime`, '', '| Month | Runtime |', '|---|---:|', ...store.months(repo).map(month => `| ${month} | ${formatDuration(store.total(repo, month))} |`), '', 'Counts Claude Code, Codex, and terminal commands. Simultaneous activity counts once. A persistent dev server counts until stopped or paused.', '', `Logs: ${store.directory(repo)}`];
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') }));
  }
  async function setLimit(repo) {
    if (!repo) return;
    const value = await vscode.window.showInputBox({
      title: `${repo.name}: monthly runtime limit`,
      prompt: 'Hours per calendar month. Yellow at 80%, red at 95%. Use 0 to remove. Tracking continues past the limit.',
      value: String(store.limitHours(repo)), validateInput: validateLimit
    });
    if (value === undefined) return;
    const error = validateLimit(value); if (error) throw new Error(error);
    store.setLimitHours(repo, Number(value));
    render();
  }
  function previewLimits() {
    const panel = vscode.window.createWebviewPanel('repoWorkTimer.limitPreview', 'Repo Work Timer: Limit Preview', vscode.ViewColumn.One, {});
    panel.webview.html = require('node:fs').readFileSync(path.join(context.extensionPath, 'media', 'limit-preview.html'), 'utf8');
  }
  async function importHistory(repo = selected()) {
    if (!repo) return chooseRepo();
    if (importing) return;
    const month = await vscode.window.showInputBox({ title: 'Import agent history', prompt: 'Month to reconstruct from local Claude Code and Codex logs (YYYY-MM).', value: monthKey(Date.now()), validateInput: value => { try { monthBounds(value); } catch (e) { return e.message; } } });
    if (!month) return;
    importing = true;
    try {
      const [start, end] = monthBounds(month);
      const intervals = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Reading local agent history…' }, () => historicalIntervals(repo, homes(), start, Math.min(end, Date.now())));
      const previous = store.records(repo, month);
      const added = duration([...previous, ...intervals]) - duration(previous);
      const choice = await vscode.window.showInformationMessage(`Add ${formatDuration(added)} to ${repo.name} for ${month}? Overlaps are removed. Terminal history is not imported because it rarely records reliable durations.`, { modal: true }, 'Import');
      if (choice === 'Import') { store.import(repo, month, intervals); render(); await vscode.window.showInformationMessage(`Imported ${month}. Total: ${formatDuration(store.total(repo, month))}.`); }
    } finally { importing = false; }
  }
  async function exportCsv(repo = selected()) {
    if (!repo) return chooseRepo();
    const months = store.months(repo);
    const month = await vscode.window.showQuickPick(months.reverse(), { title: 'Export which month?' });
    if (!month) return;
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(os.homedir(), `${repo.name}-${month}.csv`)), filters: { CSV: ['csv'] } });
    if (!uri) return;
    const lines = ['date,seconds,hours', ...dailyTotals(store.records(repo, month)).map(([day, ms]) => `${day},${(ms / 1000).toFixed(3)},${(ms / 3600000).toFixed(4)}`)];
    await vscode.workspace.fs.writeFile(uri, Buffer.from(lines.join('\n') + '\n'));
    await vscode.window.showInformationMessage('Monthly CSV exported.');
  }
  const command = (name, fn) => vscode.commands.registerCommand(name, async () => { try { await fn(); } catch (e) { report(e); await vscode.window.showErrorMessage(`Repo Work Timer: ${e.message}`); } });
  context.subscriptions.push(output, status,
    command('repoWorkTimer.history', () => history()),
    command('repoWorkTimer.importHistory', () => importHistory()),
    command('repoWorkTimer.export', () => exportCsv()),
    command('repoWorkTimer.setLimit', async () => setLimit(await chooseRepo())),
    command('repoWorkTimer.previewLimits', previewLimits),
    command('repoWorkTimer.menu', async () => {
      const repo = selected() || await chooseRepo(); if (!repo) return;
      const choice = await vscode.window.showQuickPick([store.paused(repo) ? 'Resume timer' : 'Pause timer', 'Set monthly limit', 'Preview limit colors', 'Monthly history', 'Import agent history', 'Export monthly CSV', 'Open log folder', 'Choose repository', 'Settings', 'Diagnostics'], { title: `${repo.name} work timer` });
      if (choice === 'Set monthly limit') await setLimit(repo);
      if (choice === 'Preview limit colors') previewLimits();
      if (choice === 'Pause timer' || choice === 'Resume timer') { reconcile(); store.setPaused(repo, choice === 'Pause timer'); reconcile(); }
      if (choice === 'Monthly history') await history(repo);
      if (choice === 'Import agent history') await importHistory(repo);
      if (choice === 'Export monthly CSV') await exportCsv(repo);
      if (choice === 'Open log folder') {
        const uri = vscode.Uri.file(store.directory(repo));
        if (vscode.env.remoteName) await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
        else await vscode.commands.executeCommand('revealFileInOS', uri);
      }
      if (choice === 'Choose repository') await chooseRepo();
      if (choice === 'Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'repoWorkTimer');
      if (choice === 'Diagnostics') output.show();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('repoWorkTimer')) { reconcile(); void poll(); } }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      const repo = editor?.document.uri.scheme === 'file' && repoForPath(editor.document.uri.fsPath, repos);
      if (repo) { selectedId = repo.id; reconcile(); }
    }),
    vscode.window.onDidStartTerminalShellExecution(event => {
      const cwd = event.execution.cwd || event.shellIntegration.cwd;
      const repo = cwd?.scheme === 'file' && repoForPath(cwd.fsPath, repos);
      const value = event.execution.commandLine.value.trim();
      // Open interactive agent sessions are measured by agent turns, not shell lifetime.
      if (repo && value && !/^(?:\S*[/\\])?(?:claude|codex)(?:\.exe)?(?:\s|$)/i.test(value)) {
        terminals.set(event.execution, { terminal: event.terminal, repoId: repo.id }); reconcile();
      }
    }),
    vscode.window.onDidEndTerminalShellExecution(event => { terminals.delete(event.execution); reconcile(); }),
    vscode.window.onDidCloseTerminal(terminal => {
      for (const [key, value] of terminals) if (value.terminal === terminal) terminals.delete(key);
      reconcile();
    })
  );
  const timer = setInterval(() => void poll(), 10000);
  stop = () => { if (disposed) return; try { tracker.stop(); } catch (e) { output.appendLine(e.message); } disposed = true; clearInterval(timer); };
  context.subscriptions.push({ dispose: stop });
  output.appendLine(`Logs: ${store.root}. Tracking agent/terminal runtime with 10-second sampling.`);
  return refresh();
}
function deactivate() { if (stop) stop(); }
module.exports = { activate, deactivate };
