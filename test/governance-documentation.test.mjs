import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig } from '../src/lib.mjs';

const config = JSON.parse(fs.readFileSync(
  new URL('../examples/repository-governance-config.json', import.meta.url),
  'utf8'
));
const workflow = fs.readFileSync(
  new URL('../examples/repository-governance.yml', import.meta.url),
  'utf8'
);
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const guide = fs.readFileSync(
  new URL('../docs/repository-governance-quick-start.md', import.meta.url),
  'utf8'
);

test('beginner governance config is a valid governance-only consumer', () => {
  const validated = validateConfig(config, { requireProject: false });

  assert.equal(validated.project, undefined);
  assert.equal(validated.repository.governance.enabled, true);
  assert.equal(validated.repository.governance.preset, 'solo');
  assert.deepEqual(validated.repository.governance.requiredStatusChecks, []);
});

test('beginner workflow enforces manual plan-before-apply operation without branch assumptions', () => {
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /default: plan/);
  assert.match(workflow, /- plan\n\s+- apply/);
  assert.match(workflow, /governance-token: \$\{\{ secrets\.APPFACTORY_GOVERNANCE_TOKEN \}\}/);
  assert.match(workflow, /governance-mode: \$\{\{ inputs\.governance_mode \}\}/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /refs\/heads\/(main|master|trunk)/);
  assert.doesNotMatch(workflow, /PROJECT_TOKEN/);
});

test('README routes beginners to the tested onboarding guide', () => {
  assert.match(readme, /docs\/repository-governance-quick-start\.md/);
  assert.match(guide, /examples\/repository-governance-config\.json/);
  assert.match(guide, /examples\/repository-governance\.yml/);
  assert.match(guide, /Repeated runs are intentional and safe/);
  assert.match(guide, /AppFactory stops reconciling future state/);
});
