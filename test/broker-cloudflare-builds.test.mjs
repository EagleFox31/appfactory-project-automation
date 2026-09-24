import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const wrangler = JSON.parse(
  fs.readFileSync(new URL('broker/wrangler.jsonc', root), 'utf8')
);
const brokerPackage = JSON.parse(
  fs.readFileSync(new URL('broker/package.json', root), 'utf8')
);

test('native Cloudflare broker config is production-bound without placeholders', () => {
  assert.equal(wrangler.name, 'appfactory-project-token-broker');
  assert.equal(
    wrangler.vars.PUBLIC_BASE_URL,
    'https://appfactory-project-token-broker.lawrynnjennifer.workers.dev'
  );
  assert.equal(wrangler.vars.GITHUB_AUTH_PROVIDER, 'oauth-app');
  assert.equal(wrangler.vars.BROKER_AUDIENCE, 'appfactory-project-automation');
  assert.doesNotMatch(JSON.stringify(wrangler), /REPLACE_AFTER_/);
});

test('native Cloudflare broker config binds the existing D1 database exactly', () => {
  assert.deepEqual(wrangler.d1_databases, [{
    binding: 'DB',
    database_name: 'appfactory-project-token-broker',
    database_id: '0ba78a3f-8fb6-4065-88b2-de1e5231dd13',
    migrations_dir: 'migrations'
  }]);
});

test('native Cloudflare broker config requires existing Worker secrets without storing values', () => {
  assert.deepEqual(
    [...wrangler.secrets.required].sort(),
    ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY'].sort()
  );
  assert.equal('GITHUB_CLIENT_ID' in wrangler.vars, false);
  assert.equal('GITHUB_CLIENT_SECRET' in wrangler.vars, false);
  assert.equal('TOKEN_ENCRYPTION_KEY' in wrangler.vars, false);
});

test('native Cloudflare broker config pins current OIDC trust boundaries', () => {
  assert.equal(
    wrangler.vars.ALLOWED_JOB_WORKFLOW_REFS,
    'EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml@7ff298087308d7ddcc8e507d8eb9adb56c2e2158'
  );
  assert.equal(
    wrangler.vars.DELEGATED_CALLER_WORKFLOW_REFS,
    'EagleFox31/AgenStart/.github/workflows/project-broker-event-validation.yml@refs/heads/main'
  );
});

test('Workers Builds deploy script applies D1 migrations before Worker deployment', () => {
  assert.equal(
    brokerPackage.scripts.deploy,
    'wrangler d1 migrations apply DB --remote && wrangler deploy'
  );
  assert.match(brokerPackage.devDependencies.wrangler, /^\^4\./);
});

test('token-based GitHub broker deployment workflow is retired', () => {
  assert.equal(
    fs.existsSync(new URL('.github/workflows/deploy-project-token-broker.yml', root)),
    false
  );
});
