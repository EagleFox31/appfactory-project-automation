import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroker } from '../broker/src/index.mjs';

function stateDb() {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              writes.push({ sql, values });
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

test('broker health response is cache-safe and secret-free', async () => {
  const response = await createBroker().fetch(
    new Request('https://auth.example/healthz'),
    { DB: {} }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('authorization creates a one-time hashed state and redirects only to GitHub', async () => {
  const DB = stateDb();
  const response = await createBroker({ now: () => 1_000 }).fetch(
    new Request('https://auth.example/authorize'),
    {
      DB,
      GITHUB_CLIENT_ID: 'Iv23client',
      PUBLIC_BASE_URL: 'https://auth.example'
    }
  );
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get('location'));
  assert.equal(redirect.origin, 'https://github.com');
  assert.equal(redirect.pathname, '/login/oauth/authorize');
  assert.equal(redirect.searchParams.get('redirect_uri'), 'https://auth.example/callback');
  assert.equal(DB.writes.length, 1);
  assert.equal(DB.writes[0].values[1], 1_600);
  assert.notEqual(DB.writes[0].values[0], redirect.searchParams.get('state'));
});

test('private repository authorization is explicit and requests repo scope', async () => {
  const DB = stateDb();
  const response = await createBroker({ now: () => 1_000 }).fetch(
    new Request('https://auth.example/authorize?repository_access=private'),
    {
      DB,
      GITHUB_AUTH_PROVIDER: 'oauth-app',
      GITHUB_CLIENT_ID: 'Iv23client',
      PUBLIC_BASE_URL: 'https://auth.example'
    }
  );
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get('location'));
  assert.equal(redirect.searchParams.get('scope'), 'project repo offline_access');
  assert.equal(DB.writes[0].values[3], 'private');

  const invalid = await createBroker({ now: () => 1_000 }).fetch(
    new Request('https://auth.example/authorize?repository_access=everything'),
    {
      DB: stateDb(),
      GITHUB_AUTH_PROVIDER: 'oauth-app',
      GITHUB_CLIENT_ID: 'Iv23client',
      PUBLIC_BASE_URL: 'https://auth.example'
    }
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'invalid_repository_access' });
});

test('token exchange fails closed before remote calls when OIDC proof is missing', async () => {
  let remoteCalls = 0;
  const response = await createBroker({
    fetchImpl: async () => {
      remoteCalls += 1;
      throw new Error('must not run');
    }
  }).fetch(
    new Request('https://auth.example/v1/github/user-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'octocat/repo' })
    }),
    {
      DB: {},
      BROKER_AUDIENCE: 'appfactory-project-automation',
      ALLOWED_JOB_WORKFLOW_REFS: 'octocat/app/.github/workflows/reusable.yml@v1'
    }
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'oidc_required' });
  assert.equal(remoteCalls, 0);
});

test('unknown routes do not reveal broker configuration', async () => {
  const response = await createBroker().fetch(
    new Request('https://auth.example/secrets'),
    { DB: {} }
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});
