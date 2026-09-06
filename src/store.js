'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { splitInterval, parseRecords, duration, monthBounds } = require('./core');

class Store {
  constructor(root, writer = crypto.randomUUID()) { this.root = root; this.writer = writer; this.cache = new Map(); }
  directory(repo) { return path.join(this.root, repo.id); }
  initialize(repo) {
    const dir = this.directory(repo);
    fs.mkdirSync(dir, { recursive: true });
    const metadata = path.join(dir, 'repository.json');
    if (!fs.existsSync(metadata)) fs.writeFileSync(metadata, JSON.stringify({ name: repo.name, root: repo.root }, null, 2), { mode: 0o600 });
  }
  append(repo, interval, extra = {}) {
    this.initialize(repo);
    for (const part of splitInterval(interval.start, interval.end)) {
      const dir = path.join(this.directory(repo), part.month);
      fs.mkdirSync(dir, { recursive: true });
      const record = { version: 1, ...part, durationMs: part.end - part.start, sources: interval.sources || [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...extra };
      fs.appendFileSync(path.join(dir, `${this.writer}.jsonl`), JSON.stringify(record) + '\n', { mode: 0o600 });
    }
  }
  records(repo, month) {
    monthBounds(month);
    const dir = path.join(this.directory(repo), month);
    let files;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return files.flatMap(name => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      let cached = this.cache.get(file);
      if (!cached || cached.size !== stat.size || cached.mtime !== stat.mtimeMs) {
        cached = { size: stat.size, mtime: stat.mtimeMs, records: parseRecords(fs.readFileSync(file, 'utf8')) };
        this.cache.set(file, cached);
      }
      const [start, end] = monthBounds(month);
      return cached.records.filter(r => Number.isFinite(r.start) && Number.isFinite(r.end)).map(r => ({ ...r, start: Math.max(start, r.start), end: Math.min(end, r.end) })).filter(r => r.end > r.start);
    });
  }
  months(repo) {
    try { return fs.readdirSync(this.directory(repo)).filter(f => /^\d{4}-(0[1-9]|1[0-2])$/.test(f)).sort(); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  total(repo, month) { return duration(this.records(repo, month)); }
  limitHours(repo) {
    try { return JSON.parse(fs.readFileSync(path.join(this.directory(repo), 'limit.json'), 'utf8')).hours; }
    catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
  }
  setLimitHours(repo, hours) {
    if (!Number.isFinite(hours) || hours < 0 || hours > 744) throw new Error('Monthly limit must be between 0 and 744 hours.');
    this.initialize(repo);
    const file = path.join(this.directory(repo), 'limit.json');
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ hours }) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  paused(repo) { return fs.existsSync(path.join(this.directory(repo), 'paused')); }
  setPaused(repo, value) {
    this.initialize(repo);
    const file = path.join(this.directory(repo), 'paused');
    if (value) fs.writeFileSync(file, '', { mode: 0o600 });
    else fs.rmSync(file, { force: true });
  }
  import(repo, month, intervals) {
    this.initialize(repo);
    const [start, end] = monthBounds(month);
    let added = 0;
    for (const interval of intervals) {
      const r = { start: Math.max(start, interval.start), end: Math.min(end, interval.end), sources: [...interval.sources].sort() };
      if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start) continue;
      const hash = crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0, 32);
      const dir = path.join(this.directory(repo), month);
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.writeFileSync(path.join(dir, `import-${hash}.jsonl`), JSON.stringify({ version: 1, month, ...r, historical: true, method: 'agent-turn-boundaries' }) + '\n', { flag: 'wx', mode: 0o600 });
        added++;
      } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    return added;
  }
}
module.exports = { Store };
