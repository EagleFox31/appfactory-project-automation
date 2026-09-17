import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const reusable = fs.readFileSync(
  new URL('.github/workflows/reusable-repository-governance.yml', root),
  'utf8'
);
const continuous = fs.readFileSync(
  new URL('examples/repository-governance-continuous.yml', root),
  'utf8'
);
const guide = fs.readFileSync(
  new URL('docs/repository-governance-quick-start.md', root),
  'utf8'
);

test('continuous governance is an explicit consumer opt-in with trusted automatic triggers', () => {
  assert.match(continuous, /^  workflow_dispatch:/m);
  assert.match(continuous, /^  push:/m);
  assert.match(continuous, /^  schedule:/m);
  assert.match(continuous, /\.github\/project-config\.json/);
  assert.match(continuous, /\.github\/workflows\/repository-governance\.yml/);
  assert.match(continuous, /github\.ref_name == github\.event\.repository\.default_branch/);
  assert.match(continuous, /inputs\.governance_mode \|\| 'apply'/);
  assert.match(continuous, /reusable-repository-governance\.yml@v1/);
  assert.match(continuous, /APPFACTORY_GOVERNANCE_TOKEN/);
  assert.doesNotMatch(continuous, /pull_request_target|PROJECT_TOKEN|release-please|reusable-release/);
});

test('reusable governance execution is serialized and isolated from Project and release automation', () => {
  assert.match(reusable, /^  workflow_call:/m);
  assert.match(reusable, /group: repository-governance-\$\{\{ github\.repository \}\}/);
  assert.match(reusable, /cancel-in-progress: false/);
  assert.match(reusable, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(reusable, /persist-credentials: false/);
  assert.match(reusable, /repository: EagleFox31\/appfactory-project-automation/);
  assert.match(reusable, /ref: \$\{\{ inputs\.appfactory_ref \}\}/);
  assert.match(reusable, /uses: \.\/\.appfactory/);
  assert.match(reusable, /governance-mode: \$\{\{ inputs\.governance_mode \}\}/);
  assert.match(reusable, /governance-token: \$\{\{ secrets\.governance_token \}\}/);
  assert.doesNotMatch(reusable, /PROJECT_TOKEN|release-please|reusable-release|pull_request_target/);
});

test('continuous governance documentation separates approval, enforcement and safe disable behavior', () => {
  assert.match(guide, /Enable continuous reconciliation after approval/);
  assert.match(guide, /03:17 UTC/);
  assert.match(guide, /token expires or is revoked/);
  assert.match(guide, /does not delete the managed Ruleset/);
  assert.match(guide, /no pull request is merged and no release is created/);
});
