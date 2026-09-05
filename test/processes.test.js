const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePs, terminalCandidates, agentName } = require('../src/processes');
test('idle shells, agent descendants, and nonterminal processes are excluded', () => {
  const processes = parsePs('1 0 ttys001 /bin/zsh\n2 1 ttys001 /usr/bin/claude\n3 2 ttys001 /usr/bin/node\n4 1 ttys001 /usr/bin/node\n5 1 ?? /usr/bin/node\n6 1 ? /usr/bin/node');
  assert.deepEqual(terminalCandidates(processes).map(p => p.pid), [4]);
});
test('Windows process names map to agents', () => {
  assert.equal(agentName('codex.exe'), 'Codex');
  assert.equal(agentName('claude.exe'), 'Claude');
  assert.equal(agentName('Code.exe'), undefined);
});
