# Zero-PAT authentication for user-owned GitHub Projects

**Rollout status (2026-09-19):** personal Projects require the separate OAuth App
provider. The original GitHub App account-Projects permission assumption was
incorrect. Use `GITHUB_AUTH_PROVIDER=oauth-app` on the broker and `broker-user`
on consumers; `github-app-user` remains a transport-compatible alias. See the
[provider assessment](project-oauth-app-feasibility.md) and [broker setup](../broker/README.md).
Two owner-triggered AgenStart runs reconciled the personal Project without PAT.
Keep `PROJECT_TOKEN` for production events until contributor and bot paths pass.

AppFactory can exchange a GitHub Actions OpenID Connect (OIDC) identity for an expiring user access token. The OAuth App provider requests `project public_repo offline_access` for the public-repository rollout. The owner-triggered workflow has resolved and reconciled AgenStart's existing Project twice.

This flow is separate from Repository Governance:

- governance uses a repository-scoped **installation token**;
- a Project owned by a personal GitHub account requires a **user access token**;
- the broker is the only component allowed to hold encrypted refresh tokens and the OAuth App client secret;
- consumer workflows hold no reusable GitHub credential.

GitHub requires the user to authorize the OAuth App before it can act on their behalf. The `project` and `public_repo` scopes are broader than one Project or repository; GitHub's consent screen shows that access.

## Trust flow

1. The user authorizes the App once through the broker's web flow.
2. The broker stores the rotated refresh token encrypted at rest.
3. A consumer calls the AppFactory reusable workflow with `id-token: write`.
4. GitHub issues a job-specific OIDC token with repository, actor and reusable-workflow claims.
5. AppFactory sends that signed proof to the configured HTTPS broker endpoint.
6. The broker validates signature, issuer, audience, expiry, repository ownership and the pinned `job_workflow_ref` allowlist.
7. The broker refreshes the authorized user's OAuth App token when necessary and returns only the short-lived access token.
8. The Action masks the token before using it for Project GraphQL operations.

The repository value included in the request body is only a routing hint. A conforming broker must derive authorization from the verified OIDC claims and must never trust the body by itself.

## Consumer setup

Create the Actions variable `APPFACTORY_PROJECT_BROKER_URL` with the broker's complete HTTPS exchange endpoint. Do not create `PROJECT_TOKEN`, a client secret or a refresh-token secret in the consumer repository.

Copy [`examples/project-automation-github-app-user.yml`](../examples/project-automation-github-app-user.yml) to `.github/workflows/project-automation.yml` through the protected pull-request flow.

The calling job grants `id-token: write` because GitHub requires that permission to mint the job identity. AppFactory's reusable workflow keeps that permission out of the legacy PAT job and does not grant `contents: write`.

## Migration from `PROJECT_TOKEN`

The bundled broker currently accepts only personal repositories where the workflow
actor is the repository owner. Issue and pull-request events from contributors or
bots are rejected with `personal_owner_required`. A successful owner-triggered
manual run does not prove those existing event-driven workflows can be migrated.
Keep their current authentication until an explicit delegation policy is implemented
and validated; do not silently skip contributor events to claim a zero-PAT rollout.

Start with a separate manual workflow, leaving the existing workflow in place.
The [manual validation example](../examples/project-broker-validation.yml) pins both
the reusable workflow and its runtime to the merged broker implementation. Allow
that exact `job_workflow_ref` in the broker. It passes no `PROJECT_TOKEN` and therefore
cannot hide a broker failure behind a PAT fallback. Run it twice and compare the
existing Project identity and item count before changing the production workflow.

1. Complete the broker authorization flow for the Project owner.
2. Add `APPFACTORY_PROJECT_BROKER_URL` as a repository variable.
3. Validate the separate manual workflow, then replace compatible consumer workflows with the brokered example.
4. Trigger a manual synchronization and verify that the existing Project is resolved rather than recreated.
5. Open or resync one Issue and verify its existing Project item is updated idempotently.
6. Delete `PROJECT_TOKEN` only after every Project workflow in the repository uses `github-app-user`, all supported actors/events have passed, and no other workflow or script references the secret.

The `.github/project-config.json` contract does not change. Existing Projects, fields, views, items and repository links remain the source of current state and are reconciled in place.

## Broker security contract

A compatible broker must:

- accept only HTTPS requests;
- verify GitHub's OIDC JWT against the official issuer and signing keys;
- require the configured audience;
- reject expired or not-yet-valid proofs;
- bind access to immutable repository and owner identifiers;
- allow only the pinned AppFactory reusable workflow identity;
- match the workflow actor to the authorized GitHub user;
- encrypt refresh tokens at rest and rotate them atomically;
- return bounded error codes without credential material;
- rate-limit exchanges and retain auditable, secret-free security events.

If the broker is unavailable or rejects a proof, AppFactory fails closed before any Project GraphQL request.

Official references:

- [Authenticating with a GitHub App on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user)
- [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect)
