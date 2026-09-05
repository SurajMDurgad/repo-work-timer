const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { consume, newState, LogReader, historicalIntervals, AgentScanner } = require('../src/agents');
const stamp = ms => new Date(ms).toISOString();
const codex = (ms, type) => ({ timestamp: stamp(ms), type: 'event_msg', payload: { type } });
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-agents-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const homes = { codex: path.join(base, 'codex'), claude: path.join(base, 'claude') };
  fs.mkdirSync(path.join(homes.codex, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(homes.claude, 'projects'), { recursive: true });
  const repo = { id: 'example', root: path.join(base, 'project'), name: 'Example' };
  return { base, homes, repo };
}
test('Codex interruption and Claude tool loop boundaries', () => {
  const state = newState(), collected = [];
  consume(state, 'Codex', codex(1000, 'task_started'), r => collected.push(r));
  consume(state, 'Codex', codex(2000, 'turn_aborted'), r => collected.push(r));
  assert.equal(state.active, false);
  assert.equal(collected[0].end - collected[0].start, 1000);
  const claude = newState();
  consume(claude, 'Claude', { timestamp: stamp(1000), type: 'user', message: { content: 'build' } });
  consume(claude, 'Claude', { timestamp: stamp(2000), type: 'assistant', message: { stop_reason: 'tool_use' } });
  assert.equal(claude.active, true);
  consume(claude, 'Claude', { timestamp: stamp(3000), type: 'assistant', message: { stop_reason: 'end_turn' } });
  assert.equal(claude.active, false);
  consume(claude, 'Claude', { timestamp: stamp(4000), type: 'user', message: { content: [{ type: 'tool_result' }] } });
  assert.equal(claude.active, false);
});
test('an abandoned turn does not span a long gap before the next prompt', () => {
  const state = newState(), intervals = [];
  for (const row of [codex(1000, 'task_started'), codex(2000, 'token_count'), codex(7200000, 'task_started'), codex(7201000, 'task_complete')]) consume(state, 'Codex', row, interval => intervals.push(interval));
  assert.deepEqual(intervals.map(r => [r.start, r.end]), [[1000, 2000], [7200000, 7201000]]);
});
test('incremental reader retains partial JSON and UTF-8 across appends', async t => {
  const { base } = fixture(t), file = path.join(base, 'partial.jsonl');
  const content = Buffer.from(JSON.stringify({ timestamp: stamp(1000), type: 'user', cwd: path.join(base, 'é'), message: { content: 'start' } }) + '\n');
  const split = content.indexOf(Buffer.from('é')) + 1;
  fs.writeFileSync(file, content.subarray(0, split));
  const reader = new LogReader();
  await reader.read(file, split, 'Claude');
  assert.equal(reader.state.active, false);
  fs.appendFileSync(file, content.subarray(split));
  await reader.read(file, content.length, 'Claude');
  assert.equal(reader.state.active, true);
  assert.equal(reader.state.cwd, path.join(base, 'é'));
});
test('history clips month bounds, ignores unrelated repos, and prefers original replay timestamps', async t => {
  const { homes, repo } = fixture(t);
  const meta = { type: 'session_meta', payload: { id: 'original', cwd: repo.root } };
  const rows = [meta, codex(1000, 'task_started'), codex(5000, 'task_complete')];
  fs.writeFileSync(path.join(homes.codex, 'sessions', 'rollout-original.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(homes.codex, 'sessions', 'rollout-copy.jsonl'), [meta, codex(10000, 'task_started'), codex(20000, 'task_complete')].map(JSON.stringify).join('\n') + '\n');
  const intervals = await historicalIntervals(repo, homes, 2000, 15000);
  assert.deepEqual(intervals, [{ start: 2000, end: 5000, sources: ['Codex'] }]);
  assert.deepEqual(await historicalIntervals({ ...repo, root: repo.root + '-other' }, homes, 0, 30000), []);
});
test('live scanner requires process presence and rejects stale unfinished turns', async t => {
  const { homes, repo } = fixture(t), now = Date.now();
  const rows = [{ type: 'session_meta', payload: { id: 'live', cwd: repo.root } }, codex(now - 1000, 'task_started')];
  fs.writeFileSync(path.join(homes.codex, 'sessions', 'live.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  const scanner = new AgentScanner();
  assert.deepEqual([...(await scanner.sample([repo], homes, new Set(['Codex']), 60000, now)).get(repo.id)], ['Codex']);
  assert.equal((await scanner.sample([repo], homes, new Set(), 60000, now)).get(repo.id).size, 0);
  assert.equal((await scanner.sample([repo], homes, new Set(['Codex']), 60000, now + 120000)).get(repo.id).size, 0);
});
