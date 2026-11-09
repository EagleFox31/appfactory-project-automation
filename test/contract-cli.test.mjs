// Regression: the deployment contracts must run as CLI entrypoints when invoked with an absolute path
// (Linux runners pass "/home/runner/..."). A silent no-op skipped every deployment step without failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contracts = ['scripts/firebase-deploy/contract.mjs', 'scripts/pages-deploy/contract.mjs'];

for (const rel of contracts) {
  test(`${rel} executes its entrypoint when called with an absolute path`, () => {
    // An invalid mode makes buildPlan throw: a non-zero exit proves the entrypoint ran.
    const env = { PATH: process.env.PATH, FIREBASE_MODE: 'not-a-mode', PAGES_MODE: 'not-a-mode' };
    const run = spawnSync(process.execPath, [path.join(root, rel)], { env, encoding: 'utf8' });
    assert.notEqual(run.status, 0, `entrypoint did not run (exit ${run.status}, stderr: ${run.stderr})`);
  });
}

test('no script derives its entrypoint URL by string concatenation', () => {
  const scripts = path.join(root, 'scripts');
  for (const dir of readdirSync(scripts)) {
    const file = path.join(scripts, dir, 'contract.mjs');
    if (!existsSync(file)) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /new URL\(`file:\/\/\/\$\{process\.argv/, file);
  }
});

test('reusable deployment workflows fail when the contract emits no plan outputs', () => {
  for (const wf of ['reusable-firebase-deploy.yml', 'reusable-pages-deploy.yml']) {
    const text = readFileSync(path.join(root, '.github/workflows', wf), 'utf8');
    assert.match(text, /grep -q "\^deploy=" "\$GITHUB_OUTPUT" \|\| \{/, wf);
  }
});
