'use strict';
const path = require('node:path');
const crypto = require('node:crypto');

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Use YYYY-MM, for example 2026-09.');
  const [y, m] = month.split('-').map(Number);
  return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
}
function splitInterval(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const result = [];
  while (start < end) {
    const d = new Date(start);
    const stop = Math.min(end, new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime());
    result.push({ month: monthKey(start), start, end: stop });
    start = stop;
  }
  return result;
}
function mergeIntervals(intervals) {
  const sorted = intervals.filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start).sort((a, b) => a.start - b.start);
  const result = [];
  for (const r of sorted) {
    const last = result.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else result.push({ start: r.start, end: r.end });
  }
  return result;
}
function duration(intervals) { return mergeIntervals(intervals).reduce((sum, x) => sum + x.end - x.start, 0); }
function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
function repoId(root) { return crypto.createHash('sha256').update(root).digest('hex').slice(0, 20); }
function inside(cwd, root) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
  const relative = path.relative(root, cwd);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function parseRecords(text) {
  return text.split('\n').flatMap(line => {
    try { const r = JSON.parse(line); return r && typeof r === 'object' ? [r] : []; }
    catch { return []; }
  });
}
function dailyTotals(records) {
  const days = new Map();
  for (const interval of mergeIntervals(records)) {
    let start = interval.start;
    while (start < interval.end) {
      const d = new Date(start);
      const key = `${monthKey(start)}-${String(d.getDate()).padStart(2, '0')}`;
      const end = Math.min(interval.end, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
      days.set(key, (days.get(key) || 0) + end - start);
      start = end;
    }
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b));
}
module.exports = { monthKey, monthBounds, splitInterval, mergeIntervals, duration, formatDuration, repoId, inside, parseRecords, dailyTotals };
