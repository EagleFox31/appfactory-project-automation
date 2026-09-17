import { BrokerError } from './errors.mjs';

const API_VERSION = '2022-11-28';

function required(value, code, message) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new BrokerError(502, code, message);
  return normalized;
}

function expiry(nowSeconds, expiresIn, label) {
  const seconds = Number(expiresIn);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new BrokerError(502, 'invalid_github_token_response', `${label} expiry is invalid.`);
  }
  return nowSeconds + seconds;
}

function normalizeTokenResponse(payload, nowSeconds) {
  if (payload?.error) {
    throw new BrokerError(401, 'github_authorization_failed', 'GitHub rejected the user authorization.');
  }
  const accessToken = required(
    payload?.access_token,
    'invalid_github_token_response',
    'GitHub did not return a user access token.'
  );
  const refreshToken = required(
    payload?.refresh_token,
    'token_expiration_required',
    'GitHub App user-token expiration must be enabled.'
  );
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: expiry(nowSeconds, payload.expires_in, 'Access token'),
    refreshExpiresAt: expiry(nowSeconds, payload.refresh_token_expires_in, 'Refresh token')
  };
}

async function oauthTokenRequest(parameters, fetchImpl, nowSeconds) {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'AppFactory-Project-Token-Broker'
    },
    body: new URLSearchParams(parameters)
  });
  if (!response.ok) {
    throw new BrokerError(502, 'github_oauth_unavailable', 'GitHub OAuth exchange is unavailable.');
  }
  return normalizeTokenResponse(await response.json(), nowSeconds);
}

export function authorizationUrl({ clientId, redirectUri, state }) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  return oauthTokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  }, fetchImpl, nowSeconds);
}

export function refreshUserAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  return oauthTokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }, fetchImpl, nowSeconds);
}

async function githubApi(path, token, fetchImpl) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'AppFactory-Project-Token-Broker',
      'X-GitHub-Api-Version': API_VERSION
    }
  });
  if (response.status === 401) {
    throw new BrokerError(401, 'github_user_token_invalid', 'GitHub user authorization is invalid.');
  }
  if (response.status === 403 || response.status === 404) {
    throw new BrokerError(403, 'github_resource_not_authorized', 'GitHub App access is not authorized.');
  }
  if (!response.ok) {
    throw new BrokerError(502, 'github_api_unavailable', 'GitHub API is unavailable.');
  }
  return response.json();
}

export async function fetchAuthorizedUser({ token, fetchImpl = fetch }) {
  const user = await githubApi('/user', token, fetchImpl);
  if (!Number.isSafeInteger(user?.id) || !user?.login) {
    throw new BrokerError(502, 'invalid_github_user', 'GitHub returned an invalid user identity.');
  }
  return { id: String(user.id), login: String(user.login) };
}

export async function verifyRepositoryAccess({
  token,
  repository,
  repositoryId,
  repositoryOwnerId,
  fetchImpl = fetch
}) {
  const [owner, name, ...extras] = String(repository ?? '').split('/');
  if (!owner || !name || extras.length) {
    throw new BrokerError(403, 'invalid_repository', 'Repository identity is invalid.');
  }
  const repo = await githubApi(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    token,
    fetchImpl
  );
  if (String(repo?.id) !== String(repositoryId) || String(repo?.owner?.id) !== String(repositoryOwnerId)) {
    throw new BrokerError(403, 'repository_identity_changed', 'Repository identity does not match OIDC claims.');
  }
  return repo;
}
