# AppFactory Project token broker

This Cloudflare Worker is the hosted trust boundary for AppFactory's zero-PAT automation of user-owned GitHub Projects.

Consumer repositories never receive the GitHub App client secret, private key or refresh token. A workflow presents a job-specific GitHub Actions OIDC proof; the broker validates its signature and immutable identity claims, resolves the previously authorized GitHub user, rotates the encrypted user token when needed, verifies repository access and returns only the short-lived access token.

## Runtime components

- Cloudflare Worker — OAuth and OIDC endpoints;
- D1 — one-time OAuth states, encrypted authorization records, rate windows and secret-free audit events;
- GitHub App — user authorization with expiring user access tokens and account **Projects: Read and write** permission;
- GitHub Actions OIDC — consumer job identity without repository credentials.

## Required configuration

Create a D1 database and replace the placeholders in `wrangler.jsonc`.

Variables:

- `PUBLIC_BASE_URL` — deployed Worker HTTPS origin;
- `BROKER_AUDIENCE` — keep `appfactory-project-automation` unless every caller and broker setting changes together;
- `ALLOWED_JOB_WORKFLOW_REFS` — comma/newline-separated exact `job_workflow_ref` identities. Use immutable AppFactory commit refs during pre-release validation, then the protected `v1` tag.

Secrets:

- `GITHUB_CLIENT_ID`;
- `GITHUB_CLIENT_SECRET`;
- `TOKEN_ENCRYPTION_KEY` — 32 random bytes encoded as base64url.

The App private key is not required by this broker. Repository Governance continues to mint installation tokens through its separate workflow.

## Deployment sequence

```bash
cd broker
npx wrangler d1 create appfactory-project-token-broker
npx wrangler d1 execute appfactory-project-token-broker --remote --file=schema.sql
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler deploy
```

After deployment:

1. set the GitHub App callback URL to `<PUBLIC_BASE_URL>/callback`;
2. enable expiring user-to-server tokens in the App optional features;
3. grant account **Projects: Read and write** and install the App on the selected repositories;
4. visit `<PUBLIC_BASE_URL>/authorize` and approve once;
5. set consumer variable `APPFACTORY_PROJECT_BROKER_URL` to `<PUBLIC_BASE_URL>/v1/github/user-token`;
6. migrate one consumer and validate existing Project resolution before deleting `PROJECT_TOKEN`.

## Endpoints

- `GET /healthz` — liveness only; returns no configuration;
- `GET /authorize` — starts GitHub user authorization with one-time state;
- `GET /callback` — consumes the OAuth state and stores rotated tokens encrypted;
- `POST /v1/github/user-token` — OIDC exchange used by AppFactory workflows.

The first release supports repositories owned by the authorized personal account and requires the workflow actor to be that owner. Organization/member delegation is intentionally rejected until its separate policy and audit model are specified.
