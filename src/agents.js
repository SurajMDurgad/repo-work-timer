'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { repoForPath } = require('./repositories');

async function logFiles(dir) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const files = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await logFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file);
  }
  return files;
}
function newState() { return { active: false, last: 0, cwd: '', id: '', openedAt: null, openedCwd: '' }; }

function transition(kind, row) {
  if (kind === 'Codex') {
    if (row.type !== 'event_msg') return undefined;
    const p = row.payload || {};
    if (['task_started', 'user_message'].includes(p.type)) return 'start';
    if (['task_complete', 'turn_aborted'].includes(p.type) || (p.type === 'agent_message' && p.phase === 'final')) return 'stop';
  } else {
    if (row.type === 'user') {
      const content = row.message?.content;
      if (typeof content === 'string' && content.startsWith('[Request interrupted by user')) return 'stop';
      // Tool results are not fresh user turns (including late results after cancellation).
      if (!row.toolUseResult && !(Array.isArray(content) && content.some(c => c.type === 'tool_result'))) return 'start';
    }
    if (row.type === 'assistant') {
      if (['end_turn', 'stop_sequence'].includes(row.message?.stop_reason)) return 'stop';
      return 'progress';
    }
    if (row.type === 'system' && row.subtype === 'stop_hook_summary' && !row.preventedContinuation) return 'stop';
  }
  return undefined;
}

function consume(state, kind, row, emit = () => {}) {
  const meta = row.type === 'session_meta' ? row.payload : row;
  state.cwd = meta?.cwd || row.payload?.cwd || state.cwd;
  state.id = meta?.session_id || meta?.sessionId || (row.type === 'session_meta' ? meta?.id : '') || state.id;
  const t = Date.parse(row.timestamp);
  if (!Number.isFinite(t)) return;
  // A resumed transcript can have an abandoned turn before a long gap.
  // Historical imports must not turn that gap into hours of invented runtime.
  if (state.active && state.last && t - state.last > 30 * 60000) {
    if (state.last > state.openedAt) emit({ start: state.openedAt, end: state.last, cwd: state.openedCwd, sources: [kind] });
    state.active = false;
    state.openedAt = null;
  }
  const event = transition(kind, row);
  if (event === 'start' && !state.active) {
    state.active = true;
    state.openedAt = t;
    state.openedCwd = state.cwd;
  }
  if (event === 'stop') {
    if (state.active && t > state.openedAt) emit({ start: state.openedAt, end: t, cwd: state.openedCwd, sources: [kind] });
    state.active = false;
    state.openedAt = null;
  }
  state.last = Math.max(state.last, t);
}

class LogReader {
  constructor() { this.offset = 0; this.rest = ''; this.decoder = new StringDecoder('utf8'); this.state = newState(); }
  async read(file, size, kind, emit) {
    if (size < this.offset) { this.offset = 0; this.rest = ''; this.decoder = new StringDecoder('utf8'); this.state = newState(); }
    if (size === this.offset) return;
    const stream = fs.createReadStream(file, { start: this.offset, end: size - 1 });
    for await (const chunk of stream) {
      this.rest += this.decoder.write(chunk);
      const lines = this.rest.split('\n');
      this.rest = lines.pop();
      for (const line of lines) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row && typeof row === 'object') consume(this.state, kind, row, emit);
      }
      this.offset += chunk.length;
    }
  }
}

function canonicalReaders(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const id = `${entry.kind}:${entry.reader.state.id || entry.file}`;
    const previous = groups.get(id);
    const isCanonical = entry.reader.state.id && path.basename(entry.file).includes(entry.reader.state.id);
    const previousCanonical = previous?.reader.state.id && path.basename(previous.file).includes(previous.reader.state.id);
    if (!previous || (isCanonical && !previousCanonical) || (isCanonical === previousCanonical && entry.reader.state.last > previous.reader.state.last)) groups.set(id, entry);
  }
  return [...groups.values()];
}

class AgentScanner {
  constructor() { this.readers = new Map(); }
  async sample(repos, homes, alive, staleMs, now = Date.now()) {
    const entries = [];
    for (const [kind, dir] of [['Codex', path.join(homes.codex, 'sessions')], ['Claude', path.join(homes.claude, 'projects')]]) {
      if (!alive.has(kind)) continue;
      for (const file of await logFiles(dir)) {
        let stat;
        try { stat = await fsp.stat(file); } catch { continue; }
        if (now - stat.mtimeMs > staleMs) continue;
        const reader = this.readers.get(file) || new LogReader();
        await reader.read(file, stat.size, kind);
        this.readers.set(file, reader);
        entries.push({ kind, file, reader });
      }
    }
    const result = new Map(repos.map(r => [r.id, new Set()]));
    for (const { kind, reader } of canonicalReaders(entries)) {
      const state = reader.state;
      const repo = repoForPath(state.cwd, repos);
      if (repo && state.active && state.last <= now + 1000 && now - state.last <= staleMs) result.get(repo.id).add(kind);
    }
    return result;
  }
}

async function historicalIntervals(repo, homes, start, end) {
  const entries = [];
  for (const [kind, dir] of [['Codex', path.join(homes.codex, 'sessions')], ['Codex', path.join(homes.codex, 'archived_sessions')], ['Claude', path.join(homes.claude, 'projects')]]) {
    for (const file of await logFiles(dir)) {
      const stat = await fsp.stat(file);
      if (stat.mtimeMs < start) continue;
      const intervals = [];
      const reader = new LogReader();
      await reader.read(file, stat.size, kind, interval => intervals.push(interval));
      // Missing completion is counted only up to the last recorded event.
      const state = reader.state;
      if (state.active && state.last > state.openedAt) intervals.push({ start: state.openedAt, end: state.last, cwd: state.openedCwd, sources: [kind] });
      entries.push({ file, kind, reader, intervals });
    }
  }
  return canonicalReaders(entries).flatMap(entry => entry.intervals)
    .filter(r => repoForPath(r.cwd, [repo]))
    .map(r => ({ start: Math.max(start, r.start), end: Math.min(end, r.end), sources: r.sources }))
    .filter(r => r.end > r.start);
}
module.exports = { logFiles, newState, transition, consume, LogReader, canonicalReaders, AgentScanner, historicalIntervals };
