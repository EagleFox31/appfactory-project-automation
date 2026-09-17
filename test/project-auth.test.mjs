import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exchangeOidcForProjectToken,
  normalizeProjectAuthentication,
  requestActionsOidcToken,
  resolveProjectToken
} from '../src/project-auth.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('project authentication remains token-backed by default', async () => {
  assert.equal(normalizeProjectAuthentication(), 'token');
  assert.equal(await resolveProjectToken({ token: 'legacy-token' }), 'legacy-token');
});

test('project authentication rejects unknown and mixed providers', async () => {
  assert.throws(() => normalizeProjectAuthentication('magic'), /Expected token or github-app-user/);
  await assert.rejects(
    resolveProjectToken({
      authentication: 'github-app-user',
      token: 'must-not-win',
      repository: 'octo/repo'
    }),
    /cannot be combined/
  );
});

test('OIDC request uses HTTPS, bearer authentication and an explicit audience', async () => {
  let observed;
  const token = await requestActionsOidcToken({
    audience: 'appfactory-project-automation',
    requestToken: 'actions-request-token',
    requestUrl: 'https://token.actions.example.test?id=job-1',
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return jsonResponse({ value: 'signed-oidc-jwt' });
    }
  });

  assert.equal(token, 'signed-oidc-jwt');
  assert.match(observed.url, /audience=appfactory-project-automation/);
  assert.equal(observed.options.headers.Authorization, 'Bearer actions-request-token');
});

test('broker exchange sends only the OIDC proof and repository hint', async () => {
  let observed;
  const result = await exchangeOidcForProjectToken({
    brokerUrl: 'https://auth.appfactory.example/v1/github/user-token',
    oidcToken: 'signed-oidc-jwt',
    repository: 'octo/repo',
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return jsonResponse({ token: 'ghu_short_lived', expires_at: '2026-09-17T18:00:00Z' });
    }
  });

  assert.deepEqual(result, {
    token: 'ghu_short_lived',
    expiresAt: '2026-09-17T18:00:00Z'
  });
  assert.equal(observed.options.headers.Authorization, 'Bearer signed-oidc-jwt');
  assert.deepEqual(JSON.parse(observed.options.body), { repository: 'octo/repo' });
});

test('broker authentication resolves and masks the project token', async () => {
  const requests = [];
  const masked = [];
  const token = await resolveProjectToken({
    authentication: 'github-app-user',
    brokerAudience: 'appfactory-project-automation',
    brokerUrl: 'https://auth.appfactory.example/v1/github/user-token',
    repository: 'octo/repo',
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example.test?id=job-1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'actions-request-token'
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? jsonResponse({ value: 'signed-oidc-jwt' })
        : jsonResponse({ token: 'ghu_short_lived' });
    },
    mask: (secret) => masked.push(secret)
  });

  assert.equal(token, 'ghu_short_lived');
  assert.deepEqual(masked, ['ghu_short_lived']);
  assert.equal(requests.length, 2);
});

test('project authentication fails closed without OIDC capability or HTTPS', async () => {
  await assert.rejects(
    resolveProjectToken({
      authentication: 'github-app-user',
      brokerAudience: 'appfactory-project-automation',
      brokerUrl: 'http://auth.appfactory.example/v1/github/user-token',
      repository: 'octo/repo',
      env: {}
    }),
    /OIDC request URL is required/
  );

  await assert.rejects(
    exchangeOidcForProjectToken({
      brokerUrl: 'http://auth.appfactory.example/v1/github/user-token',
      oidcToken: 'signed-oidc-jwt',
      repository: 'octo/repo'
    }),
    /must use HTTPS/
  );
});

test('broker failures expose only a bounded error code', async () => {
  await assert.rejects(
    exchangeOidcForProjectToken({
      brokerUrl: 'https://auth.appfactory.example/v1/github/user-token',
      oidcToken: 'signed-oidc-jwt',
      repository: 'octo/repo',
      fetchImpl: async () => jsonResponse({
        error: 'repository_not_allowed',
        token: 'must-never-appear'
      }, 403)
    }),
    (error) => {
      assert.match(error.message, /HTTP 403 \(repository_not_allowed\)/);
      assert.doesNotMatch(error.message, /must-never-appear/);
      return true;
    }
  );
});
