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

test('release repair only runs after Release Please fails', () => {
  const releasePleaseIndex = workflow.indexOf('Prepare or publish release');
  const repairIndex = workflow.indexOf('Repair a failed semantic release if the GitHub Release is missing');

  assert.ok(releasePleaseIndex >= 0);
  assert.ok(repairIndex > releasePleaseIndex);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /if: steps\.release\.outcome == 'failure'/);
  assert.match(workflow, /gh release view/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--target "\$\{repair_sha\}"/);
});

test('stable major and minor aliases still resolve from the latest published release', () => {
  assert.match(workflow, /releases\/latest/);
  assert.match(workflow, /for alias in "v\$\{major\}" "v\$\{major\}\.\$\{minor\}"/);
});
