import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const reusable = fs.readFileSync(new URL('.github/workflows/reusable-project-automation.yml', root), 'utf8');
const example = fs.readFileSync(new URL('examples/project-automation.yml', root), 'utf8');
const brokerExample = fs.readFileSync(new URL('examples/project-automation-github-app-user.yml', root), 'utf8');
const legacyPatExample = fs.readFileSync(new URL('examples/project-automation-pat.yml', root), 'utf8');
const guide = fs.readFileSync(new URL('docs/project-github-app-user-onboarding.md', root), 'utf8');

test('reusable Project workflow keeps token and broker providers explicit', () => {
  assert.match(reusable, /^      authentication:/m);
  assert.match(reusable, /github-app-user|broker-user/);
  assert.match(reusable, /Mixed Project authentication/);
  assert.match(reusable, /^  sync-token:/m);
  assert.match(reusable, /^  sync-github-app-user:/m);
});

test('OIDC permission is isolated to the brokered Project job', () => {
  const tokenJob = reusable.match(/^  sync-token:[\s\S]*?(?=^  sync-github-app-user:)/m)?.[0] ?? '';
  const brokerJob = reusable.match(/^  sync-github-app-user:[\s\S]*$/m)?.[0] ?? '';
  assert.doesNotMatch(tokenJob, /id-token: write/);
  assert.match(brokerJob, /id-token: write/);
  assert.match(brokerJob, /project-authentication: github-app-user/);
  assert.doesNotMatch(brokerJob, /project_token|PROJECT_TOKEN/);
});

test('default consumer example is zero-PAT and uses the production broker contract', () => {
  assert.match(example, /id-token: write/);
  assert.match(example, /appfactory-project-token-broker\.lawrynnjennifer\.workers\.dev\/v1\/github\/user-token/);
  assert.match(example, /authentication: github-app-user/);
  assert.doesNotMatch(example, /secrets:|PROJECT_TOKEN|APP_PRIVATE_KEY|CLIENT_SECRET/);
  assert.equal(example, brokerExample);
});

test('PAT setup remains available only as an explicit legacy example', () => {
  assert.match(legacyPatExample, /PROJECT_TOKEN/);
  assert.match(legacyPatExample, /legacy PAT/i);
  assert.doesNotMatch(example, /PROJECT_TOKEN/);
});

test('onboarding explains the trust boundary and retroactive migration', () => {
  assert.match(guide, /job_workflow_ref/);
  assert.match(guide, /encrypted at rest/i);
  assert.match(guide, /must never trust the body/i);
  assert.match(guide, /existing Project is resolved rather than recreated/i);
  assert.match(guide, /Remove `PROJECT_TOKEN` from Project workflows/i);
  assert.match(guide, /non-owner contributor\/bot handling explicitly unsupported/i);
});
