import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const action = fs.readFileSync(new URL('../action.yml', import.meta.url), 'utf8');

test('public Action keeps project auth and governance auth as separate inputs', () => {
  assert.match(action, /^  token:\n    description:/m);
  assert.match(action, /^  governance-token:\n    description:/m);
  assert.match(action, /governance-token:[\s\S]*?required: false[\s\S]*?default: ""/);
});
