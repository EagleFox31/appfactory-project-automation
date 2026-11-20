import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reusable = readFileSync(new URL('../.github/workflows/reusable-repository-governance.yml', import.meta.url), 'utf8');
const example = readFileSync(new URL('../examples/repository-governance-broker-app.yml', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../docs/github-app-onboarding.md', import.meta.url), 'utf8');
const quickStart = readFileSync(new URL('../docs/repository-governance-quick-start.md', import.meta.url), 'utf8');

test('reusable governance workflow accepts broker-app as a third provider', () => {
  assert.match(reusable, /Expected token, github-app or broker-app/);
  assert.match(reusable, /^\s+broker-app\)$/m);
  assert.match(reusable, /authentication=broker-app requires the broker_url input/);
  assert.match(reusable, /broker_url must use https/);
  assert.match(reusable, /authentication=broker-app must not receive app_private_key or governance_token/);
  assert.match(reusable, /^      broker_url:$/m);
  assert.match(reusable, /default: appfactory-governance/);
});

test('broker-app exchange runs only in broker mode, masks tokens and reuses the governance-token input', () => {
  assert.match(reusable, /if: \$\{\{ inputs\.authentication == 'broker-app' \}\}\r?\n\s+id: broker-token/);
  assert.match(reusable, /id-token: write/);
  assert.match(reusable, /ACTIONS_ID_TOKEN_REQUEST_URL\}&audience=\$\{BROKER_AUDIENCE\}/);
  assert.match(reusable, /::add-mask::\$\{oidc_token\}/);
  assert.match(reusable, /::add-mask::\$\{governance_token\}/);
  assert.match(reusable, /"\$repository" != "\$GITHUB_REPOSITORY"/);
  assert.match(
    reusable,
    /inputs\.authentication == 'broker-app' && steps\.broker-token\.outputs\.token \|\| inputs\.authentication == 'github-app' && steps\.app-token\.outputs\.token \|\| secrets\.governance_token/
  );
  assert.match(
    reusable,
    /governance-administration-verified: \$\{\{ inputs\.authentication == 'github-app' \|\| inputs\.authentication == 'broker-app' \}\}/
  );
});

test('brokered token is revoked at job end even when governance fails', () => {
  assert.match(
    reusable,
    /if: \$\{\{ always\(\) && inputs\.authentication == 'broker-app' && steps\.broker-token\.outputs\.token != '' \}\}/
  );
  assert.match(reusable, /--request DELETE[\s\S]*https:\/\/api\.github\.com\/installation\/token/);
});

test('token and github-app providers keep their contract', () => {
  assert.match(reusable, /authentication=token requires the governance_token secret/);
  assert.match(reusable, /authentication=github-app requires the app_private_key secret/);
  assert.match(reusable, /uses: actions\/create-github-app-token@v3/);
  assert.match(reusable, /default: token/);
});

test('broker-app consumer example stores no secret and grants id-token', () => {
  assert.match(example, /authentication: broker-app/);
  assert.match(example, /broker_url: \$\{\{ vars\.APPFACTORY_GOVERNANCE_BROKER_URL \}\}/);
  assert.match(example, /id-token: write/);
  assert.doesNotMatch(example, /secrets\./);
  assert.doesNotMatch(example, /app_private_key|app_client_id|governance_token/);
});

test('documentation explains the brokered path and its trust boundaries', () => {
  assert.match(onboarding, /supports three providers/);
  assert.match(onboarding, /authentication: broker-app/);
  assert.match(onboarding, /APPFACTORY_GOVERNANCE_BROKER_URL/);
  assert.match(onboarding, /job_workflow_ref/);
  assert.match(onboarding, /GITHUB_APP_NOT_INSTALLED/);
  assert.match(onboarding, /DELETE \/installation\/token/);
  assert.match(quickStart, /broker-app/);
  assert.match(quickStart, /GOVERNANCE_WORKFLOW_FORBIDDEN/);
});
