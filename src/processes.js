'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const run = require('node:util').promisify(require('node:child_process').execFile);
const { repoForPath } = require('./repositories');
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'login', 'ps', 'lsof']);
function agentName(name) {
  const base = name.toLowerCase().replace(/\.exe$/, '');
  if (base === 'codex') return 'Codex';
  if (['claude', 'claude-code'].includes(base)) return 'Claude';
  return undefined;
}
function parsePs(text) {
  return text.split('\n').flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), tty: m[3], name: path.basename(m[4]) }] : [];
  });
}
function terminalCandidates(processes) {
  const map = new Map(processes.map(p => [p.pid, p]));
  return processes.filter(p => {
    if (['??', '?', '-'].includes(p.tty) || SHELLS.has(p.name) || agentName(p.name) || p.name.startsWith('codex-')) return false;
    const seen = new Set();
    let parent = map.get(p.ppid);
    while (parent && !seen.has(parent.pid)) {
      if (agentName(parent.name)) return false;
      seen.add(parent.pid); parent = map.get(parent.ppid);
    }
    return true;
  });
}
async function snapshot(repos, externalTerminals, platform = process.platform) {
  const options = { timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  if (platform === 'win32') {
    const { stdout } = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], options);
    const alive = new Set(stdout.split('\n').map(line => agentName(line.match(/^"([^"]+)"/)?.[1] || '')).filter(Boolean));
    return { alive, terminals: new Set() };
  }
  const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,tty=,comm='], options);
  const processes = parsePs(stdout);
  const alive = new Set(processes.map(p => agentName(p.name)).filter(Boolean));
  const terminals = new Set();
  const candidates = externalTerminals ? terminalCandidates(processes) : [];
  const cwdByPid = new Map();
  if (platform === 'darwin' && candidates.length) {
    let text;
    try { text = (await run('/usr/sbin/lsof', ['-a', '-p', candidates.map(p => p.pid).join(','), '-d', 'cwd', '-Fpn'], options)).stdout; }
    catch (e) { if (e.code !== 1) throw e; text = e.stdout || ''; }
    let pid;
    for (const line of text.split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1));
      if (line[0] === 'n') cwdByPid.set(pid, line.slice(1));
    }
  } else if (platform === 'linux') {
    await Promise.all(candidates.map(async p => {
      try { cwdByPid.set(p.pid, await fs.readlink(`/proc/${p.pid}/cwd`)); } catch { /* Process exited or is inaccessible. */ }
    }));
  }
  for (const cwd of cwdByPid.values()) {
    const repo = repoForPath(cwd, repos);
    if (repo) terminals.add(repo.id);
  }
  return { alive, terminals };
}
module.exports = { agentName, parsePs, terminalCandidates, snapshot };
