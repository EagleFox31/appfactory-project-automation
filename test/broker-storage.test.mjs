import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createBroker } from '../broker/src/index.mjs';
import { resetOidcMetadataCacheForTests } from '../broker/src/oidc.mjs';
import {
  createOAuthState, consumeOAuthState, saveAuthorization, loadAuthorization,
  replaceAuthorization, enforceExchangeRateLimit, recordSecurityEvent
  , acquireRefreshLease, releaseRefreshLease
} from '../broker/src/storage.mjs';

const schema = readFileSync(new URL('../broker/schema.sql', import.meta.url), 'utf8');

// Execute production SQL with SQLite, adapting only the D1 result interface.
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(schema);
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return {
            async first() { return statement.get(...values) ?? null; },
            async run() { return { meta: statement.run(...values) }; }
          };
        }
      };
    }
  };
}

test('broker schema can be reapplied without removing existing authorizations', async (t) => {
  const db = database(t);
  await saveAuthorization(db, {
    userId: '42', login: 'owner', encryptedTokens: 'ciphertext',
    accessExpiresAt: 2000, refreshExpiresAt: 5000
  });
  db.sqlite.exec(schema);
  assert.equal((await loadAuthorization(db, '42')).encryptedTokens, 'ciphertext');
});

test('OAuth state is consumed once and expired states cannot authorize', async (t) => {
  const db = database(t);
  await createOAuthState(db, { stateHash: 'valid-hash', expiresAt: 1600 });
  await consumeOAuthState(db, { stateHash: 'valid-hash', nowSeconds: 1000 });
  await assert.rejects(consumeOAuthState(db, { stateHash: 'valid-hash', nowSeconds: 1000 }),
    { code: 'invalid_oauth_state' });
  await createOAuthState(db, { stateHash: 'expired-hash', expiresAt: 999 });
  await assert.rejects(consumeOAuthState(db, { stateHash: 'expired-hash', nowSeconds: 1000 }),
    { code: 'invalid_oauth_state' });
});

test('stale authorization updates cannot overwrite a newer token bundle', async (t) => {
  const db = database(t);
  await saveAuthorization(db, {
    userId: '42', login: 'owner', encryptedTokens: 'initial',
    accessExpiresAt: 2000, refreshExpiresAt: 5000
  });
  const update = {
    userId: '42', expectedVersion: 1, encryptedTokens: 'rotated',
    accessExpiresAt: 3000, refreshExpiresAt: 6000
  };
  assert.equal(await replaceAuthorization(db, update), true);
  assert.equal(await replaceAuthorization(db, { ...update, encryptedTokens: 'stale' }), false);
  assert.equal((await loadAuthorization(db, '42')).encryptedTokens, 'rotated');
  assert.equal((await loadAuthorization(db, '42')).version, 2);
  await assert.rejects(loadAuthorization(db, '43'), { code: 'user_authorization_required' });
});

test('exchange limits isolate repositories and reset at the next window', async (t) => {
  const db = database(t);
  const request = { key: '42:100', nowSeconds: 120, maximum: 2 };
  await enforceExchangeRateLimit(db, request);
  await enforceExchangeRateLimit(db, request);
  await assert.rejects(enforceExchangeRateLimit(db, request), { code: 'rate_limited' });
  await enforceExchangeRateLimit(db, { ...request, key: '42:101' });
  await enforceExchangeRateLimit(db, { ...request, nowSeconds: 180 });
});

test('audit events persist only the explicit identity and outcome fields', async (t) => {
  const db = database(t);
  await recordSecurityEvent(db, {
    eventType: 'project_token_exchanged', userId: '42', repositoryId: '100',
    runId: '123', outcome: 'success', token: 'must-not-be-stored'
  });
  const row = db.sqlite.prepare('SELECT * FROM security_events').get();
  assert.equal(row.user_id, '42');
  assert.equal(row.repository_id, '100');
  assert.equal(row.run_id, '123');
  assert.equal(row.outcome, 'success');
  assert.ok(!JSON.stringify(row).includes('must-not-be-stored'));
});

for (const authProvider of ['github-app', 'oauth-app']) {
test(`${authProvider} broker authorizes, exchanges a signed OIDC proof, and persists refreshed credentials`, async (t) => {
  resetOidcMetadataCacheForTests();
  t.after(resetOidcMetadataCacheForTests);
  const db = database(t);
  let now = 1000;
  let refreshes = 0;
  let authorizationChallenge;
  const workflowRef = 'owner/automation/.github/workflows/reusable.yml@0123456789';
  const keys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key' };
  const env = {
    DB: db, PUBLIC_BASE_URL: 'https://auth.example',
    GITHUB_AUTH_PROVIDER: authProvider,
    GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    BROKER_AUDIENCE: 'appfactory-project-automation', ALLOWED_JOB_WORKFLOW_REFS: workflowRef,
    DELEGATED_CALLER_WORKFLOW_REFS: 'owner/repo/.github/workflows/project.yml@refs/heads/main'
  };
  const broker = createBroker({
    now: () => now,
    fetchImpl: async (input, options = {}) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        if (options.body.get('grant_type') === 'refresh_token') {
          assert.equal(options.body.get('refresh_token'), 'test-refresh-initial');
          refreshes++;
        } else {
          const challenge = Buffer.from(await crypto.subtle.digest('SHA-256',
            Buffer.from(options.body.get('code_verifier')))).toString('base64url');
          assert.equal(challenge, authorizationChallenge);
        }
        return Response.json({
          scope: 'project,public_repo',
          access_token: refreshes ? 'test-access-refreshed' : 'test-access-initial',
          refresh_token: refreshes ? 'test-refresh-rotated' : 'test-refresh-initial',
          expires_in: 600, refresh_token_expires_in: 10000
        });
      }
      if (url === 'https://api.github.com/user') return Response.json({ id: 42, login: 'owner' });
      if (url === 'https://api.github.com/repos/owner/repo') {
        assert.equal(options.headers.Authorization,
          `Bearer ${refreshes ? 'test-access-refreshed' : 'test-access-initial'}`);
        return Response.json({ id: 100, owner: { id: 42 } });
      }
      if (url === 'https://token.actions.githubusercontent.com/.well-known/openid-configuration') {
        return Response.json({ issuer: 'https://token.actions.githubusercontent.com',
          jwks_uri: 'https://token.actions.githubusercontent.com/test-jwks' });
      }
      if (url === 'https://token.actions.githubusercontent.com/test-jwks') return Response.json({ keys: [jwk] });
      throw new Error(`Unexpected test request: ${url}`);
    }
  });
  const redirect = await broker.fetch(new Request('https://auth.example/authorize'), env);
  const authorizationUrl = new URL(redirect.headers.get('location'));
  const state = authorizationUrl.searchParams.get('state');
  authorizationChallenge = authorizationUrl.searchParams.get('code_challenge');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorizationUrl.searchParams.get('scope'), authProvider === 'oauth-app'
    ? 'project public_repo offline_access' : null);
  const cookie = redirect.headers.get('set-cookie').split(';')[0];
  const callbackUrl = `https://auth.example/callback?code=test-code&state=${state}`;
  assert.equal((await broker.fetch(new Request(callbackUrl), env)).status, 400);
  const callback = new Request(callbackUrl, { headers: { cookie } });
  assert.equal((await broker.fetch(callback, env)).status, 200);
  assert.equal((await broker.fetch(callback, env)).status, 400);
  const key = authProvider === 'oauth-app' ? 'oauth-app:test-client:42' : '42';
  assert.ok(!(await loadAuthorization(db, key)).encryptedTokens.includes('test-access-initial'));
  if (authProvider === 'oauth-app') {
    await assert.rejects(loadAuthorization(db, '42'), { code: 'user_authorization_required' });
  }

  async function exchange(overrides = {}) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({
      iss: 'https://token.actions.githubusercontent.com', aud: env.BROKER_AUDIENCE,
      exp: now + 60, iat: now, nbf: now, repository: 'owner/repo', repository_id: '100',
      repository_owner_id: '42', actor_id: '42', actor: 'owner', job_workflow_ref: workflowRef,
      run_id: '123', ...overrides
    })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, Buffer.from(unsigned));
    return broker.fetch(new Request('https://auth.example/v1/github/user-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${unsigned}.${Buffer.from(signature).toString('base64url')}` },
      body: JSON.stringify({ repository: 'owner/repo' })
    }), env);
  }
  const first = await exchange();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { token: 'test-access-initial', expires_at: new Date(1600 * 1000).toISOString() });
  now = 1400;
  const second = await exchange();
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { token: 'test-access-refreshed', expires_at: new Date(2000 * 1000).toISOString() });
  assert.equal(refreshes, 1);
  assert.equal((await loadAuthorization(db, key)).version, 2);
  if (authProvider === 'oauth-app') {
    const delegated = await exchange({ actor_id: '77', actor: 'contributor',
      event_name: 'issues', ref: 'refs/heads/main', repository_visibility: 'public',
      workflow_ref: env.DELEGATED_CALLER_WORKFLOW_REFS });
    assert.equal(delegated.status, 200);
    assert.equal((await delegated.json()).token, 'test-access-refreshed');
  }
  const events = db.sqlite.prepare('SELECT event_type FROM security_events ORDER BY id').all();
  assert.deepEqual(events.map((row) => row.event_type), [
    'user_authorized', 'project_token_exchanged', 'project_token_exchanged',
    ...(authProvider === 'oauth-app' ? ['project_token_exchanged'] : [])
  ]);
  if (authProvider === 'oauth-app') {
    assert.equal(db.sqlite.prepare('SELECT user_id FROM security_events ORDER BY id DESC LIMIT 1').get().user_id, '77');
  }
});
}

test('refresh leases exclude concurrent refresh and stale releases cannot remove a successor', async (t) => {
  const db = database(t);
  const lease = { key: 'oauth-app:client:42', leaseId: 'first', nowSeconds: 1000 };
  assert.equal(await acquireRefreshLease(db, lease), true);
  assert.equal(await acquireRefreshLease(db, { ...lease, leaseId: 'second' }), false);
  assert.equal(await acquireRefreshLease(db, { ...lease, leaseId: 'second', nowSeconds: 1090 }), true);
  await releaseRefreshLease(db, lease);
  assert.equal(await acquireRefreshLease(db, { ...lease, nowSeconds: 1091 }), false);
  await releaseRefreshLease(db, { ...lease, leaseId: 'second' });
  assert.equal(await acquireRefreshLease(db, { ...lease, nowSeconds: 1091 }), true);
});

test('versioned migrations preserve legacy authorizations and produce the current schema', (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../broker/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO user_authorizations VALUES ('42', 'owner', 'legacy-ciphertext', 2000, 5000, 1, 1000)");
  sqlite.exec(readFileSync(new URL('../broker/migrations/0002_oauth_pkce_refresh.sql', import.meta.url), 'utf8'));
  assert.equal(sqlite.prepare('SELECT encrypted_tokens FROM user_authorizations').get().encrypted_tokens, 'legacy-ciphertext');
  assert.ok(sqlite.prepare('PRAGMA table_info(oauth_states)').all().some((column) => column.name === 'code_verifier'));
  assert.doesNotThrow(() => sqlite.prepare('SELECT * FROM authorization_refresh_locks').all());
});
