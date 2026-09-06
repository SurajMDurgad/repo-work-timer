'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseRecords, monthBounds } = require('./core');

// The original local extension stored monthly files outside globalStorage.
// Keep those files intact and publish deterministic snapshots atomically.
function migrateLegacy(store, repo, legacyRoot) {
  const directory = path.join(legacyRoot, path.basename(repo.root));
  let files;
  try { files = fs.readdirSync(directory).filter(name => /^\d{4}-(0[1-9]|1[0-2])\.jsonl$/.test(name)); }
  catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
  let added = 0;
  for (const name of files) {
    const month = name.slice(0, 7), [start, end] = monthBounds(month);
    const records = parseRecords(fs.readFileSync(path.join(directory, name), 'utf8')).filter(record => {
      if (typeof record.repo !== 'string' || !path.isAbsolute(record.repo)) return false;
      let root = path.resolve(record.repo);
      try { root = fs.realpathSync(root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return root === repo.root && Number.isFinite(record.start) && Number.isFinite(record.end);
    }).map(record => ({
      version: 1, month, start: Math.max(start, record.start), end: Math.min(end, record.end),
      sources: Array.isArray(record.sources) ? record.sources.filter(source => typeof source === 'string') : [],
      historical: record.historical === true, method: 'legacy-log-migration'
    })).filter(record => record.end > record.start);
    if (!records.length) continue;
    const content = records.map(record => JSON.stringify(record) + '\n').join('');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    store.initialize(repo);
    const targetDirectory = path.join(store.directory(repo), month);
    fs.mkdirSync(targetDirectory, { recursive: true });
    const target = path.join(targetDirectory, `legacy-${hash}.jsonl`);
    if (fs.existsSync(target)) continue;
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, target);
      added += records.length;
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  return added;
}
module.exports = { migrateLegacy };
