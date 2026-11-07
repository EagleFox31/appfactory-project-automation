import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A fix in the reusable workflow reaches consumers only through the immutable
// runtime they pin. These checks keep every documented or dogfooded pin on a
// runtime that is (1) consistent between `uses:` and `appfactory_ref`,
// (2) free of known scheduler/concurrency defects and (3) accepted by the broker.

const root = fileURLToPath(new URL('../', import.meta.url));
const workflowIdentity = 'EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml';

// Runtimes that must never be recommended again, with the incident they caused.
const KNOWN_DEFECTIVE_RUNTIMES = new Map([
  ['14d51168311c25f41d89df370c5e2ad2d5f42e83',
    'repository-wide concurrency group cancels pending Issue runs during bursts (LESSON-2026-017)'],
  ['b1deb7b1069739879d7a4acb9cd3521bca835049',
    'Project bootstrap is not serialized and can create duplicate Projects (LESSON-2026-011)']
]);

// Manual broker validation pins a historical broker build on purpose and runs
// only on workflow_dispatch; it is not a consumer template.
const VALIDATION_ONLY = new Set(['examples/project-broker-validation.yml']);

function listFiles(dir, extensions) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(relative, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [relative] : [];
  });
}

function collectPins() {
  const files = [
    'README.md',
    ...listFiles('docs', ['.md']),
    ...listFiles('examples', ['.yml', '.yaml']),
    ...listFiles('.github/workflows', ['.yml', '.yaml'])
  ];
  return files.flatMap((file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const uses = [...text.matchAll(/reusable-project-automation\.yml@([0-9a-f]{40})\b/g)].map((m) => m[1]);
    if (!uses.length) return [];
    const runtimes = [...text.matchAll(/appfactory_ref:\s*([0-9a-f]{40})\b/g)].map((m) => m[1]);
    return [{ file, uses, runtimes }];
  });
}

const wrangler = JSON.parse(fs.readFileSync(path.join(root, 'broker/wrangler.jsonc'), 'utf8'));
const allowedRefs = new Set(
  String(wrangler.vars.ALLOWED_JOB_WORKFLOW_REFS).split(',').map((value) => value.trim()).filter(Boolean)
);
const pins = collectPins();

test('consumer templates and dogfood workflows pin the reusable workflow by SHA', () => {
  const pinnedFiles = pins.map((pin) => pin.file);
  for (const required of [
    'README.md',
    'examples/project-automation.yml',
    'examples/project-automation-github-app-user.yml',
    '.github/workflows/project-automation.yml'
  ]) {
    assert.ok(pinnedFiles.includes(required), `${required} must pin reusable-project-automation.yml by SHA`);
  }
});

test('reusable workflow and Action runtime are pinned to the same SHA', () => {
  for (const { file, uses, runtimes } of pins) {
    const all = new Set([...uses, ...runtimes]);
    assert.equal(all.size, 1, `${file} pins mixed runtimes: ${[...all].join(', ')}`);
    assert.ok(runtimes.length > 0, `${file} must set appfactory_ref to the pinned SHA`);
  }
});

test('no pin recommends a runtime with a known concurrency defect', () => {
  for (const { file, uses } of pins) {
    for (const sha of uses) {
      assert.ok(
        !KNOWN_DEFECTIVE_RUNTIMES.has(sha),
        `${file} pins ${sha}: ${KNOWN_DEFECTIVE_RUNTIMES.get(sha)}. Re-pin uses: and appfactory_ref.`
      );
    }
  }
});

test('every consumer pin is accepted by the broker OIDC allowlist', () => {
  for (const { file, uses } of pins) {
    if (VALIDATION_ONLY.has(file)) continue;
    for (const sha of uses) {
      assert.ok(
        allowedRefs.has(`${workflowIdentity}@${sha}`),
        `${file} pins ${sha}, which broker/wrangler.jsonc ALLOWED_JOB_WORKFLOW_REFS does not accept`
      );
    }
  }
});
