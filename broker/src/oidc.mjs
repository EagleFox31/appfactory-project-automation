import { base64UrlDecode, utf8Decode, utf8Encode } from './encoding.mjs';
import { BrokerError } from './errors.mjs';

const ISSUER = 'https://token.actions.githubusercontent.com';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

let cachedDiscovery;
let cachedJwks;

function parseJsonSegment(value, label) {
  try {
    return JSON.parse(utf8Decode(base64UrlDecode(value)));
  } catch {
    throw new BrokerError(401, 'invalid_oidc', `Invalid OIDC ${label}.`);
  }
}

export function parseJwt(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new BrokerError(401, 'invalid_oidc', 'Malformed OIDC token.');
  }
  return {
    header: parseJsonSegment(parts[0], 'header'),
    claims: parseJsonSegment(parts[1], 'claims'),
    signature: base64UrlDecode(parts[2]),
    signed: utf8Encode(`${parts[0]}.${parts[1]}`)
  };
}

function audienceMatches(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

function integerClaim(value, name) {
  const normalized = String(value ?? '');
  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new BrokerError(403, 'invalid_claims', `OIDC claim ${name} is missing or invalid.`);
  }
  return normalized;
}

export function validateWorkflowClaims({
  claims,
  audience,
  allowedWorkflowRefs,
  allowedDelegatedWorkflowRefs = [],
  organizationAuthorizationActors = {},
  repository,
  nowSeconds = Math.floor(Date.now() / 1000),
  clockSkewSeconds = 30
}) {
  if (claims.iss !== ISSUER) {
    throw new BrokerError(401, 'invalid_issuer', 'OIDC issuer is not GitHub Actions.');
  }
  if (!audienceMatches(claims.aud, audience)) {
    throw new BrokerError(403, 'invalid_audience', 'OIDC audience is not authorized.');
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds - clockSkewSeconds) {
    throw new BrokerError(401, 'expired_oidc', 'OIDC token has expired.');
  }
  if (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds + clockSkewSeconds) {
    throw new BrokerError(401, 'invalid_oidc_time', 'OIDC token is not valid yet.');
  }
  if (Number.isFinite(claims.iat) && claims.iat > nowSeconds + clockSkewSeconds) {
    throw new BrokerError(401, 'invalid_oidc_time', 'OIDC token was issued in the future.');
  }

  const normalizedRepository = String(claims.repository ?? '').trim();
  if (!/^[^/\s]+\/[^/\s]+$/u.test(normalizedRepository)) {
    throw new BrokerError(403, 'invalid_claims', 'OIDC repository identity is missing.');
  }
  if (repository && normalizedRepository.toLowerCase() !== String(repository).toLowerCase()) {
    throw new BrokerError(403, 'repository_mismatch', 'Request repository does not match OIDC identity.');
  }

  const workflowRef = String(claims.job_workflow_ref ?? '').trim();
  const allowed = [...new Set((allowedWorkflowRefs ?? []).map((value) => String(value).trim()).filter(Boolean))];
  if (!allowed.length || !allowed.includes(workflowRef)) {
    throw new BrokerError(403, 'workflow_not_allowed', 'Reusable workflow identity is not authorized.');
  }

  const repositoryId = integerClaim(claims.repository_id, 'repository_id');
  const repositoryOwnerId = integerClaim(claims.repository_owner_id, 'repository_owner_id');
  const actorId = integerClaim(claims.actor_id, 'actor_id');
  const actor = String(claims.actor ?? '').trim();
  const repositoryOwner = String(
    claims.repository_owner ?? normalizedRepository.split('/')[0]
  ).trim();
  const repositoryVisibility = String(claims.repository_visibility ?? 'public').trim() || 'public';
  const mappedOrganizationActor = String(
    organizationAuthorizationActors?.[repositoryOwner.toLowerCase()] ?? ''
  ).trim();

  let authorizationUserId;
  if (repositoryOwnerId === actorId) {
    authorizationUserId = repositoryOwnerId;
  } else if (mappedOrganizationActor) {
    if (mappedOrganizationActor.toLowerCase() !== actor.toLowerCase()) {
      throw new BrokerError(403, 'personal_owner_required',
        'This organization repository requires its explicitly authorized owner actor.');
    }
    authorizationUserId = actorId;
  } else {
    const callerRef = String(claims.workflow_ref ?? '').trim();
    const ref = String(claims.ref ?? '').trim();
    const eventName = String(claims.event_name ?? '').trim();
    const delegated = (allowedDelegatedWorkflowRefs ?? []).includes(callerRef);
    const trustedCaller = callerRef.startsWith(`${normalizedRepository}/.github/workflows/`)
      && ref.startsWith('refs/heads/') && callerRef.endsWith(`@${ref}`);
    if (!delegated || !trustedCaller || !['issues', 'pull_request_target'].includes(eventName)
        || repositoryVisibility !== 'public') {
      throw new BrokerError(403, 'personal_owner_required',
        'Only an authorized repository owner or trusted public default-branch workflow may use the owner authorization.');
    }
    authorizationUserId = repositoryOwnerId;
  }

  return {
    actorId,
    actor,
    repository: normalizedRepository,
    repositoryId,
    repositoryOwnerId,
    repositoryVisibility,
    authorizationUserId,
    workflowRef,
    runId: String(claims.run_id ?? '').trim()
  };
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AppFactory-Project-Token-Broker'
    }
  });
  if (!response.ok) {
    throw new BrokerError(503, 'oidc_metadata_unavailable', 'GitHub OIDC metadata is unavailable.');
  }
  return response.json();
}

async function signingKeys(fetchImpl, { refresh = false } = {}) {
  cachedDiscovery ??= await fetchJson(DISCOVERY_URL, fetchImpl);
  if (cachedDiscovery.issuer !== ISSUER) {
    throw new BrokerError(503, 'oidc_metadata_invalid', 'GitHub OIDC discovery issuer is invalid.');
  }
  const jwksUrl = new URL(cachedDiscovery.jwks_uri);
  if (jwksUrl.protocol !== 'https:' || jwksUrl.origin !== ISSUER) {
    throw new BrokerError(503, 'oidc_metadata_invalid', 'GitHub OIDC signing-key URL is invalid.');
  }
  if (refresh) cachedJwks = undefined;
  cachedJwks ??= await fetchJson(jwksUrl, fetchImpl);
  return cachedJwks.keys ?? [];
}

export async function verifyGitHubActionsOidc({
  token,
  audience,
  allowedWorkflowRefs,
  allowedDelegatedWorkflowRefs = [],
  organizationAuthorizationActors = {},
  repository,
  fetchImpl = fetch,
  cryptoImpl = crypto,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  const parsed = parseJwt(token);
  if (parsed.header.alg !== 'RS256' || !parsed.header.kid) {
    throw new BrokerError(401, 'invalid_oidc_algorithm', 'OIDC signing algorithm is not allowed.');
  }

  let keys = await signingKeys(fetchImpl);
  let jwk = keys.find((candidate) => candidate.kid === parsed.header.kid && candidate.kty === 'RSA');
  if (!jwk) {
    keys = await signingKeys(fetchImpl, { refresh: true });
    jwk = keys.find((candidate) => candidate.kid === parsed.header.kid && candidate.kty === 'RSA');
    if (!jwk) throw new BrokerError(401, 'unknown_oidc_key', 'OIDC signing key is unknown.');
  }
  const key = await cryptoImpl.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await cryptoImpl.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    parsed.signature,
    parsed.signed
  );
  if (!valid) throw new BrokerError(401, 'invalid_oidc_signature', 'OIDC signature is invalid.');

  return validateWorkflowClaims({
    claims: parsed.claims,
    audience,
    allowedWorkflowRefs,
    allowedDelegatedWorkflowRefs,
    organizationAuthorizationActors,
    repository,
    nowSeconds
  });
}

export function resetOidcMetadataCacheForTests() {
  cachedDiscovery = undefined;
  cachedJwks = undefined;
}
