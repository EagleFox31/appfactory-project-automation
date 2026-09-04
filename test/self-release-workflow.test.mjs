import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8');

test('self release can use a dedicated token while retaining github token fallback', () => {
  assert.match(workflow, /secrets\.APPFACTORY_RELEASE_TOKEN \|\| github\.token/);
});

test('missing manifest release repair refuses to guess the target commit', () => {
  assert.match(workflow, /git log --first-parent/);
  assert.match(workflow, /parent_version/);
  assert.match(workflow, /refusing to guess a release target/);
});

test('missing GitHub release is repaired from the manifest version before Release Please runs', () => {
  const repairIndex = workflow.indexOf('Repair a merged release whose GitHub Release is missing');
  const releasePleaseIndex = workflow.indexOf('Prepare or publish release');

  assert.ok(repairIndex >= 0);
  assert.ok(releasePleaseIndex > repairIndex);
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--target "\$\{repair_sha\}"/);
});

test('stable major and minor aliases still resolve from the latest published release', () => {
  assert.match(workflow, /releases\/latest/);
  assert.match(workflow, /for alias in "v\$\{major\}" "v\$\{major\}\.\$\{minor\}"/);
});
