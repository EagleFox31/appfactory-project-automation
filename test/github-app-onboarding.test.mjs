import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, root), 'utf8');
}

const reusable = source('.github/workflows/reusable-repository-governance.yml');
const example = source('examples/repository-governance-github-app.yml');
const guide = source('docs/github-app-onboarding.md');

test('reusable governance supports explicit PAT and GitHub App authentication providers', () => {
  assert.match(reusable, /^      authentication:/m);
  assert.match(reusable, /default: token/);
  assert.match(reusable, /^      app_client_id:/m);
  assert.match(reusable, /^      governance_token:[\s\S]*?required: false/m);
  assert.match(reusable, /^      app_private_key:[\s\S]*?required: false/m);
  assert.match(reusable, /Expected token or github-app/);
});

test('GitHub App token is short-lived, least-privilege and repository-scoped', () => {
  assert.match(reusable, /uses: actions\/create-github-app-token@v3/);
  assert.match(reusable, /permission-administration: write/);
  assert.doesNotMatch(reusable, /^          owner:/m);
  assert.doesNotMatch(reusable, /^          repositories:/m);
  assert.match(
    reusable,
    /inputs\.authentication == 'github-app' && steps\.app-token\.outputs\.token \|\| secrets\.governance_token/
  );
});

test('zero-PAT example uses a GitHub App variable and private-key secret', () => {
  assert.match(example, /authentication: github-app/);
  assert.match(example, /vars\.APPFACTORY_APP_CLIENT_ID/);
  assert.match(example, /secrets\.APPFACTORY_APP_PRIVATE_KEY/);
  assert.doesNotMatch(example, /APPFACTORY_GOVERNANCE_TOKEN|PROJECT_TOKEN/);
});

test('onboarding documents permissions, migration and trust boundaries', () => {
  assert.match(guide, /Administration: Read and write/);
  assert.match(guide, /PAT-backed/);
  assert.match(guide, /does not recreate/i);
  assert.match(guide, /uninstall/i);
  assert.match(guide, /private key/i);
  assert.match(guide, /organization-owned Projects/i);
  assert.match(guide, /user-owned Projects/i);
});

test('core governance modules stay authentication-provider agnostic', () => {
  for (const relativePath of [
    'src/governance/policy.mjs',
    'src/governance/plan.mjs',
    'src/governance/reconcile.mjs',
    'src/governance/execution.mjs',
    'src/github/rest-client.mjs'
  ]) {
    const contents = source(relativePath);
    assert.doesNotMatch(contents, /create-github-app-token|app_private_key|APPFACTORY_APP_CLIENT_ID/, relativePath);
  }
});
