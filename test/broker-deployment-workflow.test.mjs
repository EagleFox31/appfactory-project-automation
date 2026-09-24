import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  bindD1Database,
  prepareDeploymentConfig,
  setPublicBaseUrl
} from '../broker/scripts/render-wrangler-config.mjs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/deploy-project-token-broker.yml', import.meta.url),
  'utf8'
);
const template = JSON.parse(fs.readFileSync(
  new URL('../broker/wrangler.jsonc', import.meta.url),
  'utf8'
));

test('broker deployment is manual, serialized and read-only to GitHub contents', () => {
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /group: appfactory-project-token-broker-production/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('broker deployment uses versioned D1 migrations rather than schema.sql', () => {
  assert.match(workflow, /wrangler@4 d1 migrations list DB/);
  assert.match(workflow, /wrangler@4 d1 migrations apply DB/);
  assert.doesNotMatch(workflow, /schema\.sql/);
  assert.match(workflow, /Unmanaged D1 schema detected/);
  assert.match(workflow, /d1_migrations/);
});

test('broker deployment converges the named D1 database and official Worker action', () => {
  assert.match(workflow, /wrangler@4 d1 list --json/);
  assert.match(workflow, /wrangler@4 d1 create/);
  assert.match(workflow, /--update-config/);
  assert.match(workflow, /uses: cloudflare\/wrangler-action@v4/);
  assert.match(workflow, /curl --fail --silent --show-error/);
});

test('broker deployment does not publish an AppFactory release', () => {
  assert.doesNotMatch(workflow, /release-please|gh release|npm publish/);
});

test('broker deployment receives credentials only from protected GitHub configuration', () => {
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /vars\.BROKER_GITHUB_CLIENT_ID/);
  assert.match(workflow, /secrets\.BROKER_GITHUB_CLIENT_SECRET/);
  assert.match(workflow, /secrets\.BROKER_TOKEN_ENCRYPTION_KEY/);
  assert.match(workflow, /sync_worker_secrets:/);
  assert.match(workflow, /default: false/);
  assert.match(workflow, /preserve existing Worker secrets/i);
  assert.doesNotMatch(workflow, /BEGIN (RSA )?PRIVATE KEY|Iv23/);
});

test('deployment config renders the OAuth broker contract and D1 binding', () => {
  const prepared = prepareDeploymentConfig(template, {
    publicBaseUrl: 'https://broker.example.test/',
    allowedJobWorkflowRefs: [
      'EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml@abc123',
      'EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml@abc123'
    ].join('\n'),
    delegatedCallerWorkflowRefs: 'EagleFox31/AgenStart/.github/workflows/project-automation.yml@refs/heads/main',
    githubAuthProvider: 'oauth-app'
  });

  assert.equal(prepared.vars.PUBLIC_BASE_URL, 'https://broker.example.test');
  assert.equal(prepared.vars.GITHUB_AUTH_PROVIDER, 'oauth-app');
  assert.equal(
    prepared.vars.ALLOWED_JOB_WORKFLOW_REFS,
    'EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml@abc123'
  );
  assert.equal(
    prepared.vars.DELEGATED_CALLER_WORKFLOW_REFS,
    'EagleFox31/AgenStart/.github/workflows/project-automation.yml@refs/heads/main'
  );
  assert.equal('d1_databases' in prepared, false);

  const bound = bindD1Database(prepared, '00000000-0000-0000-0000-000000000001');
  assert.deepEqual(bound.d1_databases, [{
    binding: 'DB',
    database_name: 'appfactory-project-token-broker',
    database_id: '00000000-0000-0000-0000-000000000001',
    migrations_dir: 'migrations'
  }]);
});

test('deployment config accepts only HTTPS origins and valid workflow identities', () => {
  const configured = setPublicBaseUrl(template, 'https://broker.example.workers.dev/');
  assert.equal(configured.vars.PUBLIC_BASE_URL, 'https://broker.example.workers.dev');

  assert.throws(
    () => setPublicBaseUrl(template, 'http://broker.example.test'),
    /valid HTTPS origin/
  );
  assert.throws(
    () => setPublicBaseUrl(template, 'https://broker.example.test/callback'),
    /without a path/
  );
  assert.throws(
    () => prepareDeploymentConfig(template, {
      publicBaseUrl: 'https://broker.example.test',
      allowedJobWorkflowRefs: 'not-a-workflow-ref'
    }),
    /invalid workflow identity/
  );
});
