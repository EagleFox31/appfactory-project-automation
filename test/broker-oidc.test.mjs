import test from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlEncode, utf8Encode } from '../broker/src/encoding.mjs';
import {
  resetOidcMetadataCacheForTests,
  validateWorkflowClaims,
  verifyGitHubActionsOidc
} from '../broker/src/oidc.mjs';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'appfactory-project-automation';
const workflowRef = 'EagleFox31/appfactory-project-automation/.github/workflows/reusable-project-automation.yml@09f3337';

function claims(overrides = {}) {
  return {
    iss: issuer,
    aud: audience,
    exp: 2_000,
    nbf: 900,
    iat: 1_000,
    repository: 'EagleFox31/AgenStart',
    repository_id: '1355701149',
    repository_owner_id: '86088743',
    actor_id: '86088743',
    actor: 'EagleFox31',
    run_id: '35207656246',
    job_workflow_ref: workflowRef,
    ...overrides
  };
}

async function signedJwt(payload, kid = 'test-key') {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  Object.assign(publicJwk, { kid, alg: 'RS256', use: 'sig' });
  const header = base64UrlEncode(utf8Encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const body = base64UrlEncode(utf8Encode(JSON.stringify(payload)));
  const signed = `${header}.${body}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, utf8Encode(signed));
  return { token: `${signed}.${base64UrlEncode(new Uint8Array(signature))}`, publicJwk };
}

test('OIDC verification checks GitHub signature and returns immutable workflow identity', async () => {
  resetOidcMetadataCacheForTests();
  const jwt = await signedJwt(claims());
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    return new Response(JSON.stringify(requested.length === 1
      ? { issuer, jwks_uri: `${issuer}/.well-known/jwks` }
      : { keys: [jwt.publicJwk] }), { status: 200 });
  };

  const identity = await verifyGitHubActionsOidc({
    token: jwt.token,
    audience,
    allowedWorkflowRefs: [workflowRef],
    repository: 'EagleFox31/AgenStart',
    fetchImpl,
    nowSeconds: 1_100
  });

  assert.deepEqual(identity, {
    actorId: '86088743',
    actor: 'EagleFox31',
    repository: 'EagleFox31/AgenStart',
    repositoryId: '1355701149',
    repositoryOwnerId: '86088743',
    authorizationUserId: '86088743',
    workflowRef,
    runId: '35207656246'
  });
  assert.equal(requested.length, 2);
});

test('OIDC verification refreshes cached GitHub signing keys after rotation', async () => {
  resetOidcMetadataCacheForTests();
  const oldJwt = await signedJwt(claims(), 'old-key');
  const newJwt = await signedJwt(claims(), 'new-key');
  let jwksRequests = 0;
  const fetchImpl = async (url) => {
    if (String(url) === `${issuer}/.well-known/openid-configuration`) {
      return new Response(JSON.stringify({ issuer, jwks_uri: `${issuer}/.well-known/jwks` }));
    }
    jwksRequests += 1;
    return new Response(JSON.stringify({
      keys: jwksRequests === 1 ? [oldJwt.publicJwk] : [newJwt.publicJwk]
    }));
  };

  await verifyGitHubActionsOidc({
    token: oldJwt.token,
    audience,
    allowedWorkflowRefs: [workflowRef],
    repository: 'EagleFox31/AgenStart',
    fetchImpl,
    nowSeconds: 1_100
  });
  await verifyGitHubActionsOidc({
    token: newJwt.token,
    audience,
    allowedWorkflowRefs: [workflowRef],
    repository: 'EagleFox31/AgenStart',
    fetchImpl,
    nowSeconds: 1_100
  });

  assert.equal(jwksRequests, 2);
});

test('OIDC claims reject another audience, workflow, repository or actor', () => {
  const base = {
    claims: claims(),
    audience,
    allowedWorkflowRefs: [workflowRef],
    repository: 'EagleFox31/AgenStart',
    nowSeconds: 1_100
  };
  assert.throws(
    () => validateWorkflowClaims({ ...base, audience: 'other' }),
    (error) => error.code === 'invalid_audience'
  );
  assert.throws(
    () => validateWorkflowClaims({ ...base, allowedWorkflowRefs: ['other/workflow@ref'] }),
    (error) => error.code === 'workflow_not_allowed'
  );
  assert.throws(
    () => validateWorkflowClaims({ ...base, repository: 'EagleFox31/AgenFetch' }),
    (error) => error.code === 'repository_mismatch'
  );
  assert.throws(
    () => validateWorkflowClaims({ ...base, claims: claims({ actor_id: '7' }) }),
    (error) => error.code === 'personal_owner_required'
  );
});

test('non-owner actors require a public repository and exact trusted event caller', () => {
  const caller = 'EagleFox31/AgenStart/.github/workflows/project-automation.yml@refs/heads/main';
  const base = {
    claims: claims({ actor_id: '77', actor: 'contributor', event_name: 'issues',
      workflow_ref: caller, ref: 'refs/heads/main', repository_visibility: 'public' }),
    audience, allowedWorkflowRefs: [workflowRef], repository: 'EagleFox31/AgenStart',
    nowSeconds: 1_100
  };
  assert.throws(() => validateWorkflowClaims(base), { code: 'personal_owner_required' });
  const delegated = { ...base, allowedDelegatedWorkflowRefs: [caller] };
  assert.equal(validateWorkflowClaims(delegated).authorizationUserId, '86088743');
  assert.equal(validateWorkflowClaims({ ...delegated, claims: {
    ...base.claims, event_name: 'pull_request_target'
  } }).actorId, '77');
  for (const change of [
    { event_name: 'workflow_dispatch' }, { event_name: 'pull_request' },
    { event_name: 'dynamic' }, { ref: 'refs/heads/feature' },
    { repository_visibility: 'private' },
    { workflow_ref: 'EagleFox31/AgenStart/.github/workflows/other.yml@refs/heads/main' },
    { workflow_ref: 'another/repo/.github/workflows/project-automation.yml@refs/heads/main' }
  ]) {
    assert.throws(() => validateWorkflowClaims({ ...delegated,
      claims: { ...base.claims, ...change }
    }), { code: 'personal_owner_required' });
  }
});

test('OIDC claims reject expired proofs before repository authorization', () => {
  assert.throws(
    () => validateWorkflowClaims({
      claims: claims({ exp: 1_000 }),
      audience,
      allowedWorkflowRefs: [workflowRef],
      repository: 'EagleFox31/AgenStart',
      nowSeconds: 1_100,
      clockSkewSeconds: 0
    }),
    (error) => error.code === 'expired_oidc'
  );
});
