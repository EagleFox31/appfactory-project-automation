import { BrokerError } from './errors.mjs';

export async function createOAuthState(db, {
  stateHash,
  expiresAt,
  codeVerifier = null,
  repositoryAccess = 'public'
}) {
  await db.prepare(
    `INSERT INTO oauth_states (
       state_hash, expires_at, created_at, code_verifier, repository_access
     ) VALUES (?1, ?2, unixepoch(), ?3, ?4)`
  ).bind(stateHash, expiresAt, codeVerifier, repositoryAccess).run();
}

export async function consumeOAuthState(db, { stateHash, nowSeconds }) {
  const row = await db.prepare(
    `DELETE FROM oauth_states
     WHERE state_hash = ?1 AND expires_at >= ?2
     RETURNING state_hash, code_verifier, repository_access`
  ).bind(stateHash, nowSeconds).first();
  if (!row) throw new BrokerError(400, 'invalid_oauth_state', 'OAuth state is invalid or expired.');
  return {
    codeVerifier: row.code_verifier,
    repositoryAccess: String(row.repository_access ?? 'public')
  };
}

export async function acquireRefreshLease(db, { key, leaseId, nowSeconds }) {
  const row = await db.prepare(
    `INSERT INTO authorization_refresh_locks (auth_key, lease_id, expires_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(auth_key) DO UPDATE SET lease_id = excluded.lease_id,
       expires_at = excluded.expires_at
     WHERE authorization_refresh_locks.expires_at <= ?4
     RETURNING lease_id`
  ).bind(key, leaseId, nowSeconds + 90, nowSeconds).first();
  return row?.lease_id === leaseId;
}

export async function releaseRefreshLease(db, { key, leaseId }) {
  await db.prepare('DELETE FROM authorization_refresh_locks WHERE auth_key = ?1 AND lease_id = ?2')
    .bind(key, leaseId).run();
}

export async function saveAuthorization(db, {
  userId,
  login,
  encryptedTokens,
  accessExpiresAt,
  refreshExpiresAt
}) {
  await db.prepare(
    `INSERT INTO user_authorizations (
       user_id, login, encrypted_tokens, access_expires_at,
       refresh_expires_at, version, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, 1, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       login = excluded.login,
       encrypted_tokens = excluded.encrypted_tokens,
       access_expires_at = excluded.access_expires_at,
       refresh_expires_at = excluded.refresh_expires_at,
       version = user_authorizations.version + 1,
       updated_at = unixepoch()`
  ).bind(
    userId,
    login,
    encryptedTokens,
    accessExpiresAt,
    refreshExpiresAt
  ).run();
}

export async function loadAuthorization(db, userId) {
  const row = await db.prepare(
    `SELECT user_id, login, encrypted_tokens, access_expires_at,
            refresh_expires_at, version
     FROM user_authorizations
     WHERE user_id = ?1`
  ).bind(userId).first();
  if (!row) {
    throw new BrokerError(
      401,
      'user_authorization_required',
      'Authorize the AppFactory GitHub App before running Project automation.'
    );
  }
  return {
    userId: String(row.user_id),
    login: String(row.login),
    encryptedTokens: String(row.encrypted_tokens),
    accessExpiresAt: Number(row.access_expires_at),
    refreshExpiresAt: Number(row.refresh_expires_at),
    version: Number(row.version)
  };
}

export async function replaceAuthorization(db, {
  userId,
  expectedVersion,
  encryptedTokens,
  accessExpiresAt,
  refreshExpiresAt
}) {
  const result = await db.prepare(
    `UPDATE user_authorizations
     SET encrypted_tokens = ?1,
         access_expires_at = ?2,
         refresh_expires_at = ?3,
         version = version + 1,
         updated_at = unixepoch()
     WHERE user_id = ?4 AND version = ?5`
  ).bind(
    encryptedTokens,
    accessExpiresAt,
    refreshExpiresAt,
    userId,
    expectedVersion
  ).run();
  return Number(result?.meta?.changes ?? 0) === 1;
}

export async function enforceExchangeRateLimit(db, {
  key,
  nowSeconds,
  windowSeconds = 60,
  maximum = 30
}) {
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const row = await db.prepare(
    `INSERT INTO exchange_rate_limits (rate_key, window_start, request_count)
     VALUES (?1, ?2, 1)
     ON CONFLICT(rate_key) DO UPDATE SET
       window_start = CASE
         WHEN exchange_rate_limits.window_start = excluded.window_start
         THEN exchange_rate_limits.window_start ELSE excluded.window_start END,
       request_count = CASE
         WHEN exchange_rate_limits.window_start = excluded.window_start
         THEN exchange_rate_limits.request_count + 1 ELSE 1 END
     RETURNING request_count`
  ).bind(key, windowStart).first();
  if (Number(row?.request_count ?? 0) > maximum) {
    throw new BrokerError(429, 'rate_limited', 'Too many token exchanges. Retry later.');
  }
}

export async function recordSecurityEvent(db, {
  eventType,
  userId = null,
  repositoryId = null,
  runId = null,
  outcome
}) {
  await db.prepare(
    `INSERT INTO security_events (
       occurred_at, event_type, user_id, repository_id, run_id, outcome
     ) VALUES (unixepoch(), ?1, ?2, ?3, ?4, ?5)`
  ).bind(eventType, userId, repositoryId, runId, outcome).run();
}
