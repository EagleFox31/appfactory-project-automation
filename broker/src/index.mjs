import { decryptTokenBundle, encryptTokenBundle, randomState, sha256 } from './crypto.mjs';
import { boundedError, BrokerError } from './errors.mjs';
import {
  authorizationUrl,
  exchangeAuthorizationCode,
  fetchAuthorizedUser,
  refreshUserAccessToken,
  verifyRepositoryAccess
} from './github.mjs';
import { verifyGitHubActionsOidc } from './oidc.mjs';
import {
  consumeOAuthState,
  createOAuthState,
  enforceExchangeRateLimit,
  loadAuthorization,
  recordSecurityEvent,
  replaceAuthorization,
  saveAuthorization
} from './storage.mjs';

const ACCESS_TOKEN_REFRESH_MARGIN = 300;

function configured(env, name) {
  const value = String(env?.[name] ?? '').trim();
  if (!value) throw new BrokerError(500, 'broker_misconfigured', `${name} is not configured.`);
  return value;
}

function baseUrl(env) {
  let url;
  try {
    url = new URL(configured(env, 'PUBLIC_BASE_URL'));
  } catch {
    throw new BrokerError(500, 'broker_misconfigured', 'PUBLIC_BASE_URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new BrokerError(500, 'broker_misconfigured', 'PUBLIC_BASE_URL must be an HTTPS origin.');
  }
  return url;
}

function callbackUrl(env) {
  return new URL('/callback', baseUrl(env)).toString();
}

function allowedWorkflowRefs(env) {
  const values = configured(env, 'ALLOWED_JOB_WORKFLOW_REFS')
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) throw new BrokerError(500, 'broker_misconfigured', 'No workflow is authorized.');
  return values;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function html(body, status = 200) {
  return new Response(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AppFactory authorization</title></head>
  <body><main><h1>${body}</h1><p>You can close this window.</p></main></body>
</html>`, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    }
  });
}

function bearerToken(request) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/u);
  if (!match) throw new BrokerError(401, 'oidc_required', 'GitHub Actions OIDC proof is required.');
  return match[1];
}

function encryptionContext(userId) {
  return `appfactory:github-user:${userId}`;
}

async function decryptedAuthorization(env, authorization) {
  const bundle = await decryptTokenBundle({
    ciphertext: authorization.encryptedTokens,
    context: encryptionContext(authorization.userId),
    keyMaterial: configured(env, 'TOKEN_ENCRYPTION_KEY')
  });
  if (!bundle?.accessToken || !bundle?.refreshToken) {
    throw new BrokerError(500, 'stored_authorization_invalid', 'Stored authorization is invalid.');
  }
  return bundle;
}

async function refreshAuthorization({ env, authorization, fetchImpl, nowSeconds }) {
  if (authorization.refreshExpiresAt <= nowSeconds + ACCESS_TOKEN_REFRESH_MARGIN) {
    throw new BrokerError(401, 'user_reauthorization_required', 'GitHub user authorization has expired.');
  }
  const current = await decryptedAuthorization(env, authorization);
  const refreshed = await refreshUserAccessToken({
    clientId: configured(env, 'GITHUB_CLIENT_ID'),
    clientSecret: configured(env, 'GITHUB_CLIENT_SECRET'),
    refreshToken: current.refreshToken,
    fetchImpl,
    nowSeconds
  });
  const encryptedTokens = await encryptTokenBundle({
    bundle: refreshed,
    context: encryptionContext(authorization.userId),
    keyMaterial: configured(env, 'TOKEN_ENCRYPTION_KEY')
  });
  const replaced = await replaceAuthorization(env.DB, {
    userId: authorization.userId,
    expectedVersion: authorization.version,
    encryptedTokens,
    accessExpiresAt: refreshed.accessExpiresAt,
    refreshExpiresAt: refreshed.refreshExpiresAt
  });
  if (replaced) return refreshed;

  const winner = await loadAuthorization(env.DB, authorization.userId);
  if (winner.accessExpiresAt <= nowSeconds + ACCESS_TOKEN_REFRESH_MARGIN) {
    throw new BrokerError(409, 'authorization_refresh_conflict', 'Concurrent token refresh did not converge.');
  }
  return decryptedAuthorization(env, winner);
}

async function usableAuthorization({ env, userId, fetchImpl, nowSeconds, forceRefresh = false }) {
  const authorization = await loadAuthorization(env.DB, userId);
  if (!forceRefresh && authorization.accessExpiresAt > nowSeconds + ACCESS_TOKEN_REFRESH_MARGIN) {
    return decryptedAuthorization(env, authorization);
  }
  return refreshAuthorization({ env, authorization, fetchImpl, nowSeconds });
}

async function authorize(env, nowSeconds) {
  const state = randomState();
  await createOAuthState(env.DB, {
    stateHash: await sha256(state),
    expiresAt: nowSeconds + 600
  });
  return Response.redirect(authorizationUrl({
    clientId: configured(env, 'GITHUB_CLIENT_ID'),
    redirectUri: callbackUrl(env),
    state
  }), 302);
}

async function oauthCallback(request, env, fetchImpl, nowSeconds) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') ?? '').trim();
  const state = String(url.searchParams.get('state') ?? '').trim();
  if (!code || !state) throw new BrokerError(400, 'oauth_callback_invalid', 'OAuth callback is incomplete.');
  await consumeOAuthState(env.DB, { stateHash: await sha256(state), nowSeconds });

  const tokens = await exchangeAuthorizationCode({
    clientId: configured(env, 'GITHUB_CLIENT_ID'),
    clientSecret: configured(env, 'GITHUB_CLIENT_SECRET'),
    code,
    redirectUri: callbackUrl(env),
    fetchImpl,
    nowSeconds
  });
  const user = await fetchAuthorizedUser({ token: tokens.accessToken, fetchImpl });
  const encryptedTokens = await encryptTokenBundle({
    bundle: tokens,
    context: encryptionContext(user.id),
    keyMaterial: configured(env, 'TOKEN_ENCRYPTION_KEY')
  });
  await saveAuthorization(env.DB, {
    userId: user.id,
    login: user.login,
    encryptedTokens,
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt
  });
  await recordSecurityEvent(env.DB, {
    eventType: 'user_authorized',
    userId: user.id,
    outcome: 'success'
  });
  return html('AppFactory authorization complete');
}

async function projectToken(request, env, fetchImpl, nowSeconds) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new BrokerError(400, 'invalid_json', 'Request body must be JSON.');
  }
  const repository = String(body?.repository ?? '').trim();
  const identity = await verifyGitHubActionsOidc({
    token: bearerToken(request),
    audience: configured(env, 'BROKER_AUDIENCE'),
    allowedWorkflowRefs: allowedWorkflowRefs(env),
    repository,
    fetchImpl,
    nowSeconds
  });
  await enforceExchangeRateLimit(env.DB, {
    key: `${identity.actorId}:${identity.repositoryId}`,
    nowSeconds
  });

  let tokens = await usableAuthorization({
    env,
    userId: identity.actorId,
    fetchImpl,
    nowSeconds
  });
  try {
    await verifyRepositoryAccess({
      token: tokens.accessToken,
      repository: identity.repository,
      repositoryId: identity.repositoryId,
      repositoryOwnerId: identity.repositoryOwnerId,
      fetchImpl
    });
  } catch (error) {
    if (!(error instanceof BrokerError) || error.code !== 'github_user_token_invalid') throw error;
    tokens = await usableAuthorization({
      env,
      userId: identity.actorId,
      fetchImpl,
      nowSeconds,
      forceRefresh: true
    });
    await verifyRepositoryAccess({
      token: tokens.accessToken,
      repository: identity.repository,
      repositoryId: identity.repositoryId,
      repositoryOwnerId: identity.repositoryOwnerId,
      fetchImpl
    });
  }

  await recordSecurityEvent(env.DB, {
    eventType: 'project_token_exchanged',
    userId: identity.actorId,
    repositoryId: identity.repositoryId,
    runId: identity.runId,
    outcome: 'success'
  });
  return json({
    token: tokens.accessToken,
    expires_at: new Date(tokens.accessExpiresAt * 1000).toISOString()
  });
}

export function createBroker({ fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) } = {}) {
  return {
    async fetch(request, env) {
      try {
        if (!env?.DB) throw new BrokerError(500, 'broker_misconfigured', 'D1 binding DB is unavailable.');
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/healthz') {
          return json({ status: 'ok' });
        }
        if (request.method === 'GET' && url.pathname === '/authorize') {
          return await authorize(env, now());
        }
        if (request.method === 'GET' && url.pathname === '/callback') {
          return await oauthCallback(request, env, fetchImpl, now());
        }
        if (request.method === 'POST' && url.pathname === '/v1/github/user-token') {
          return await projectToken(request, env, fetchImpl, now());
        }
        return json({ error: 'not_found' }, 404);
      } catch (cause) {
        const error = boundedError(cause);
        return json({ error: error.code }, error.status);
      }
    }
  };
}

export default createBroker();
