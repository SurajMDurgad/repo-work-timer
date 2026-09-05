'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const run = require('node:util').promisify(require('node:child_process').execFile);
const { repoId, inside } = require('./core');

async function discoverRepositories(folders) {
  const repos = new Map();
  for (const folder of folders) {
    if (folder.uri.scheme !== 'file') continue;
    let root;
    try {
      const { stdout } = await run('git', ['-C', folder.uri.fsPath, 'rev-parse', '--show-toplevel'], { timeout: 3000 });
      root = await fs.realpath(stdout.trim());
    } catch { continue; }
    if (!repos.has(root)) repos.set(root, { id: repoId(root), root, name: path.basename(root) });
  }
  return [...repos.values()];
}
function repoForPath(cwd, repos) {
  return repos.filter(repo => inside(cwd, repo.root)).sort((a, b) => b.root.length - a.root.length)[0];
}
module.exports = { discoverRepositories, repoForPath };
