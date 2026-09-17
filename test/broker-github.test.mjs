import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizationUrl,
  fetchAuthorizedUser,
  refreshUserAccessToken,
  verifyRepositoryAccess
} from '../broker/src/github.mjs';

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('GitHub authorization URL binds client, callback and CSRF state', () => {
  const url = new URL(authorizationUrl({
    clientId: 'Iv23client',
    redirectUri: 'https://auth.example/callback',
    state: 'random-state'
  }));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'Iv23client');
  assert.equal(url.searchParams.get('state'), 'random-state');
});

test('refresh rotates both GitHub App user tokens with absolute expiry', async () => {
  let observed;
  const tokens = await refreshUserAccessToken({
    clientId: 'Iv23client',
    clientSecret: 'client-secret',
    refreshToken: 'ghr_old',
    nowSeconds: 1_000,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response({
        access_token: 'ghu_new',
        expires_in: 28_800,
        refresh_token: 'ghr_new',
        refresh_token_expires_in: 15_897_600
      });
    }
  });
  assert.equal(String(observed.url), 'https://github.com/login/oauth/access_token');
  assert.match(String(observed.options.body), /grant_type=refresh_token/);
  assert.deepEqual(tokens, {
    accessToken: 'ghu_new',
    refreshToken: 'ghr_new',
    accessExpiresAt: 29_800,
    refreshExpiresAt: 15_898_600
  });
});

test('GitHub identity and repository checks bind numeric ids', async () => {
  const fetchImpl = async (url) => String(url).endsWith('/user')
    ? response({ id: 42, login: 'octocat' })
    : response({ id: 99, owner: { id: 42 }, full_name: 'octocat/repo' });
  assert.deepEqual(await fetchAuthorizedUser({ token: 'ghu_token', fetchImpl }), {
    id: '42', login: 'octocat'
  });
  await verifyRepositoryAccess({
    token: 'ghu_token',
    repository: 'octocat/repo',
    repositoryId: '99',
    repositoryOwnerId: '42',
    fetchImpl
  });
  await assert.rejects(
    verifyRepositoryAccess({
      token: 'ghu_token',
      repository: 'octocat/repo',
      repositoryId: '100',
      repositoryOwnerId: '42',
      fetchImpl
    }),
    (error) => error.code === 'repository_identity_changed'
  );
});
