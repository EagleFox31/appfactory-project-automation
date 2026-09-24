# AppFactory Project token broker

This Cloudflare Worker is the hosted trust boundary for AppFactory's zero-PAT Project automation. For personal Projects, use the separate OAuth App provider described below. The original assumption of an account-level GitHub App Projects permission was incorrect.

Consumer repositories never receive the GitHub App client secret, private key or refresh token. A workflow presents a job-specific GitHub Actions OIDC proof; the broker validates its signature and immutable identity claims, resolves the previously authorized GitHub user, rotates the encrypted user token when needed, verifies repository access and returns only the short-lived access token.

## Runtime components

- Cloudflare Worker — OAuth and OIDC endpoints;
- D1 — one-time OAuth states, encrypted authorization records, rate windows and secret-free audit events;
- OAuth App — personal Project authorization with `project public_repo offline_access`; the current OAuth provider targets public repositories;
- GitHub App — retained provider compatibility, used separately for repository governance; personal Project access is not established by issuing a GitHub App user token;
- GitHub Actions OIDC — consumer job identity without repository credentials.

## Required configuration

Create a D1 database and replace the placeholders in `wrangler.jsonc`.

Variables:

- `GITHUB_AUTH_PROVIDER` — `oauth-app` for the personal Project rollout; defaults to `github-app` for compatibility. OAuth credentials are stored in a separate client/user namespace.
- `PUBLIC_BASE_URL` — deployed Worker HTTPS origin;
- `BROKER_AUDIENCE` — keep `appfactory-project-automation` unless every caller and broker setting changes together;
- `ALLOWED_JOB_WORKFLOW_REFS` — comma/newline-separated exact `job_workflow_ref` identities. Use immutable AppFactory commit refs during pre-release validation, then the protected `v1` tag.
- `DELEGATED_CALLER_WORKFLOW_REFS` — optional, empty by default. For each public personal repository whose contributor events may use the owner's authorization, list the exact trusted caller `workflow_ref`, such as `EagleFox31/AgenStart/.github/workflows/project-automation.yml@refs/heads/main`. Only `issues` and `pull_request_target` runs from that same branch qualify. Review the caller before enabling this because its trusted code receives the owner's short-lived token.

Secrets:

- `GITHUB_CLIENT_ID`;
- `GITHUB_CLIENT_SECRET`;
- `TOKEN_ENCRYPTION_KEY` — 32 random bytes encoded as base64url.

The App private key is not required by this broker. Repository Governance continues to mint installation tokens through its separate workflow.

## Deployment sequence

```bash
cd broker
npx wrangler d1 create appfactory-project-token-broker
npx wrangler d1 migrations apply appfactory-project-token-broker --remote
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler deploy
```

Hosted production endpoint (current AppFactory deployment):

- exchange: `https://appfactory-project-token-broker.lawrynnjennifer.workers.dev/v1/github/user-token`
- authorization: `https://appfactory-project-token-broker.lawrynnjennifer.workers.dev/authorize`

After deployment:

1. register a separate OAuth App with the exact callback URL `<PUBLIC_BASE_URL>/callback`, without wildcard matching;
2. keep expiring access tokens enabled; the broker also requests `offline_access` and rejects non-expiring responses;
3. authorize `project` and `public_repo` through OAuth consent. These scopes are broader than one Project/repository; do not substitute private-repository `repo` access without a separate review;
4. visit `<PUBLIC_BASE_URL>/authorize` and approve once;
5. set consumer variable `APPFACTORY_PROJECT_BROKER_URL` to `<PUBLIC_BASE_URL>/v1/github/user-token`;
6. migrate one consumer and validate existing Project resolution before deleting `PROJECT_TOKEN`.

OAuth state uses a Secure, HttpOnly, SameSite=Lax host cookie and a one-use D1
record with PKCE. Old in-flight states without PKCE must restart authorization.
Refresh leases serialize remote refresh calls; busy callers receive a bounded 409
and can rerun after the other call completes. Apply migrations before this Worker
version. Existing authorization records remain unchanged.

Use migrations for both fresh D1 databases and databases initialized with the old
schema. `schema.sql` is a current-schema reference for tests, not an upgrade script.
If it has already been applied with the new PKCE column, inspect migration history
before applying `0002`; never blindly apply an ALTER twice.

## Endpoints

- `GET /healthz` — liveness only; returns no configuration;
- `GET /authorize` — starts GitHub user authorization with one-time state;
- `GET /callback` — consumes the OAuth state and stores rotated tokens encrypted;
- `POST /v1/github/user-token` — OIDC exchange used by AppFactory workflows.

By default the workflow actor must be the authorized personal account owner.
That owner path is production-validated for automatic `issues` events on
AgenStart and AgenFetch without `PROJECT_TOKEN`.

An explicit `DELEGATED_CALLER_WORKFLOW_REFS` allowlist can also permit
contributor actors on `issues` and `pull_request_target` in public,
owner-controlled repositories when the caller workflow and branch match exactly.
The exchange uses the owner's authorization but audits the triggering actor.
Other events, including Dependabot's `dynamic` OIDC event, remain rejected.
Do not enable delegated contributor/bot claims until a real non-owner event has
been validated. This limitation no longer requires owner-triggered workflows to
retain a PAT.
