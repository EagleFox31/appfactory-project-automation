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
  'utf8');
const template = JSON.parse(fs.readFileSync(
  new URL('../broker/wrangler.jsonc', import.meta.url),
  'utf8'));

test('broker deployment is manual, serialized and least-privileged', () => {
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /group: appfactory-project-token-broker-production/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('broker deployment converges D1 before deploying with the official action', () => {
  assert.match(workflow, /wrangler@4 d1 list --json/);
  assert.match(workflow, /wrangler@4 d1 create/);
  assert.match(workflow, /--update-config/);
  assert.match(workflow, /wrangler@4 d1 execute DB/);
  assert.match(workflow, /uses: cloudflare\/wrangler-action@v4/);
  assert.match(workflow, /curl --fail --silent --show-error/);
});

test('broker deployment does not publish an AppFactory release', () => {
  assert.doesNotMatch(workflow, /release-please|gh release|npm publish/);
});

test('broker deployment receives secrets only from protected GitHub configuration', () => {
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /vars\.BROKER_GITHUB_CLIENT_ID/);
  assert.match(workflow, /secrets\.BROKER_GITHUB_CLIENT_SECRET/);
  assert.match(workflow, /secrets\.BROKER_TOKEN_ENCRYPTION_KEY/);
  assert.doesNotMatch(workflow, /Iv23|BEGIN (RSA )?PRIVATE KEY/);
});

test('deployment config replaces placeholders and can attach an existing D1 database', () => {
  const prepared = prepareDeploymentConfig(template, {
    publicBaseUrl: 'https://broker.example.test/',
    allowedJobWorkflowRefs: 'EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml@abc123'
  });

  assert.equal(prepared.vars.PUBLIC_BASE_URL, 'https://broker.example.test');
  assert.equal(prepared.vars.ALLOWED_JOB_WORKFLOW_REFS.endsWith('@abc123'), true);
  assert.equal('d1_databases' in prepared, false);

  const bound = bindD1Database(prepared, '00000000-0000-0000-0000-000000000001');
  assert.deepEqual(bound.d1_databases, [{
    binding: 'DB',
    database_name: 'appfactory-project-token-broker',
    database_id: '00000000-0000-0000-0000-000000000001'
  }]);
});

test('deployment config accepts a discovered Worker origin and rejects unsafe URLs', () => {
  const configured = setPublicBaseUrl(template, 'https://broker.example.workers.dev/');
  assert.equal(configured.vars.PUBLIC_BASE_URL, 'https://broker.example.workers.dev');

  assert.throws(
    () => setPublicBaseUrl(template, 'http://broker.example.test'),
    /valid HTTPS origin/
  );
  assert.throws(
    () => setPublicBaseUrl(template, 'https://broker.example.test/callback'),
    /must not contain a path/
  );
});
