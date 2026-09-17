import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const action = fs.readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
const entrypoint = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');

test('public Action keeps project auth and governance auth as separate inputs', () => {
  assert.match(action, /^  token:\n    description:/m);
  assert.match(action, /token:[\s\S]*?required: false[\s\S]*?default: ""/);
  assert.match(action, /^  governance-token:\n    description:/m);
  assert.match(action, /governance-token:[\s\S]*?required: false[\s\S]*?default: ""/);
  assert.match(action, /^  governance-administration-verified:\n    description:/m);
  assert.match(action, /governance-administration-verified:[\s\S]*?default: "false"/);
});

test('governance execution is explicit and off by default', () => {
  assert.match(action, /^  governance-mode:/m);
  assert.match(action, /governance-mode:[\s\S]*?default: "off"/);
});

test('governance plan or apply does not continue into Project automation', () => {
  assert.match(entrypoint, /if \(governanceMode === 'off'\) \{\n  await runProjectAutomation\(\);\n\} else \{/);
  assert.match(entrypoint, /executeRepositoryGovernance\(\{/);
});

test('governance-only execution does not require the unrelated Project credential', () => {
  assert.match(entrypoint, /if \(governanceMode === 'off' && !token\)/);
  assert.match(entrypoint, /requireProject: governanceMode === 'off'/);
});

test('entrypoint resolves hyphenated Action inputs through the shared adapter', () => {
  assert.match(entrypoint, /readActionInput\('governance-token'\)/);
  assert.match(entrypoint, /readActionInput\('governance-administration-verified'\)/);
  assert.match(entrypoint, /readActionInput\('governance-mode'\)/);
  assert.match(entrypoint, /readActionInput\('config-path'\)/);
  assert.match(entrypoint, /readActionInput\('issue-number'\)/);
  assert.doesNotMatch(entrypoint, /process\.env\.INPUT_GOVERNANCE_MODE/);
});
