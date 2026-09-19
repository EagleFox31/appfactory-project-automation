const AUTHENTICATION_TOKEN = 'token';
const AUTHENTICATION_BROKER = 'github-app-user';

function required(value, message) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function httpsUrl(value, label) {
  const raw = required(value, `${label} is required.`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS.`);
  }
  return url;
}

export function normalizeProjectAuthentication(value) {
  const authentication = String(value ?? AUTHENTICATION_TOKEN).trim().toLowerCase();
  if (authentication === 'broker-user') return AUTHENTICATION_BROKER;
  if ([AUTHENTICATION_TOKEN, AUTHENTICATION_BROKER].includes(authentication)) {
    return authentication;
  }
  throw new Error(
    `Invalid project authentication mode "${value}". ` +
    `Expected ${AUTHENTICATION_TOKEN} or ${AUTHENTICATION_BROKER} (alias: broker-user).`
  );
}

export async function requestActionsOidcToken({
  audience,
  requestToken,
  requestUrl,
  fetchImpl = fetch
}) {
  const url = httpsUrl(requestUrl, 'GitHub Actions OIDC request URL');
  const bearer = required(requestToken, 'GitHub Actions OIDC request token is unavailable.');
  url.searchParams.set('audience', required(audience, 'Project broker audience'));

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
      'User-Agent': 'AppFactory-Project-Automation'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub Actions OIDC request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  return required(payload?.value, 'GitHub Actions OIDC response did not include a token.');
}

export async function exchangeOidcForProjectToken({
  brokerUrl,
  oidcToken,
  repository,
  fetchImpl = fetch
}) {
  const url = httpsUrl(brokerUrl, 'Project token broker URL');
  const bearer = required(oidcToken, 'GitHub Actions OIDC token is required.');
  const repositoryFullName = required(repository, 'GitHub repository identity is required.');

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'User-Agent': 'AppFactory-Project-Automation'
    },
    body: JSON.stringify({ repository: repositoryFullName })
  });

  if (!response.ok) {
    let code = '';
    try {
      const payload = await response.json();
      if (/^[a-z0-9_-]{1,80}$/i.test(String(payload?.error ?? ''))) {
        code = ` (${payload.error})`;
      }
    } catch {
      // Broker bodies are intentionally not echoed because they may contain sensitive data.
    }
    throw new Error(`Project token broker rejected the exchange with HTTP ${response.status}${code}.`);
  }

  const payload = await response.json();
  return {
    token: required(payload?.token, 'Project token broker response did not include a token.'),
    expiresAt: String(payload?.expires_at ?? '').trim() || null
  };
}

export async function resolveProjectToken({
  authentication,
  token,
  brokerUrl,
  brokerAudience,
  repository,
  env = process.env,
  fetchImpl = fetch,
  mask = (secret) => console.log(`::add-mask::${secret}`)
}) {
  const provider = normalizeProjectAuthentication(authentication);

  if (provider === AUTHENTICATION_TOKEN) {
    return required(token, 'A project-capable GitHub token is required through input "token".');
  }

  if (String(token ?? '').trim()) {
    throw new Error(
      'project-authentication=github-app-user cannot be combined with input "token".'
    );
  }

  const oidcToken = await requestActionsOidcToken({
    audience: brokerAudience,
    requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
    fetchImpl
  });
  const exchanged = await exchangeOidcForProjectToken({
    brokerUrl,
    oidcToken,
    repository,
    fetchImpl
  });
  mask(exchanged.token);
  return exchanged.token;
}
