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

The production broker is deployed through **Cloudflare Workers Builds** using Cloudflare's GitHub App integration. GitHub does not store a Cloudflare API token for this path.

The repository-owned deployment contract lives in `broker/wrangler.jsonc`:

- Worker name: `appfactory-project-token-broker`;
- public origin: `https://appfactory-project-token-broker.lawrynnjennifer.workers.dev`;
- D1 binding: `DB` → `appfactory-project-token-broker`;
- D1 database ID: `0ba78a3f-8fb6-4065-88b2-de1e5231dd13`;
- Project auth provider: `oauth-app`;
- OIDC audience: `appfactory-project-automation`;
- reusable workflow allowlist: the currently validated immutable AppFactory runtime;
- delegated caller allowlist: the isolated AgenStart `[broker-test]` workflow.

The following values remain **Cloudflare Worker secrets** and are never committed to GitHub:

- `GITHUB_CLIENT_ID`;
- `GITHUB_CLIENT_SECRET`;
- `TOKEN_ENCRYPTION_KEY`.

They are declared through Wrangler's `secrets.required` contract. A deployment fails if one is missing, while their values stay managed by Cloudflare.

## Cloudflare Workers Builds deployment

Production deployments are triggered by pushes to `main` that affect the broker project. Cloudflare runs from the `/broker` root and executes `npm run deploy`.

Connect the existing Worker to GitHub in Cloudflare:

1. open **Workers & Pages → appfactory-project-token-broker → Settings → Builds**;
2. choose **Connect** and authorize the Cloudflare GitHub App;
3. select repository `EagleFox31/appfactory-project-automation`;
4. set production branch to `main`;
5. set root directory to `broker`;
6. leave the build command empty;
7. set the deploy command to `npm run deploy`.

The `broker/package.json` deploy script runs:

```bash
wrangler d1 migrations apply DB --remote && wrangler deploy
```

That makes D1 migration and Worker deployment one convergent Cloudflare-owned operation. Cloudflare authenticates its own build environment; no `CLOUDFLARE_API_TOKEN` is stored in GitHub.

The old GitHub Actions broker deployment workflow and its temporary config renderer were removed to avoid maintaining two competing deployment paths.

`schema.sql` remains a current-schema reference for tests. Production upgrades use the versioned files under `broker/migrations/`.

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
