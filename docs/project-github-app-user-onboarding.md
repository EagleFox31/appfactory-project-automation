# Zero-PAT authentication for user-owned GitHub Projects

AppFactory can exchange a GitHub Actions OpenID Connect (OIDC) identity for a short-lived GitHub App user access token. This removes the repository `PROJECT_TOKEN` secret without distributing the App private key or a refresh token to consumer repositories.

This flow is separate from Repository Governance:

- governance uses a repository-scoped **installation token**;
- a Project owned by a personal GitHub account requires a **user access token**;
- the broker is the only component allowed to hold encrypted refresh tokens and the GitHub App client secret;
- consumer workflows hold no reusable GitHub credential.

GitHub requires the user to authorize the App before it can act on their behalf. User access is limited to the intersection of the user's own access, the App permissions and the accounts where the App is installed.

## Trust flow

1. The user authorizes the App once through the broker's web flow.
2. The broker stores the rotated refresh token encrypted at rest.
3. A consumer calls the AppFactory reusable workflow with `id-token: write`.
4. GitHub issues a job-specific OIDC token with repository, actor and reusable-workflow claims.
5. AppFactory sends that signed proof to the configured HTTPS broker endpoint.
6. The broker validates signature, issuer, audience, expiry, repository ownership and the pinned `job_workflow_ref` allowlist.
7. The broker refreshes the authorized user's GitHub App token when necessary and returns only the short-lived access token.
8. The Action masks the token before using it for Project GraphQL operations.

The repository value included in the request body is only a routing hint. A conforming broker must derive authorization from the verified OIDC claims and must never trust the body by itself.

## Consumer setup

Create the Actions variable `APPFACTORY_PROJECT_BROKER_URL` with the broker's complete HTTPS exchange endpoint. Do not create `PROJECT_TOKEN`, a client secret or a refresh-token secret in the consumer repository.

Copy [`examples/project-automation-github-app-user.yml`](../examples/project-automation-github-app-user.yml) to `.github/workflows/project-automation.yml` through the protected pull-request flow.

The calling job grants `id-token: write` because GitHub requires that permission to mint the job identity. AppFactory's reusable workflow keeps that permission out of the legacy PAT job and does not grant `contents: write`.

## Migration from `PROJECT_TOKEN`

1. Complete the broker authorization flow for the Project owner.
2. Add `APPFACTORY_PROJECT_BROKER_URL` as a repository variable.
3. Replace the consumer workflow with the brokered example.
4. Trigger a manual synchronization and verify that the existing Project is resolved rather than recreated.
5. Open or resync one Issue and verify its existing Project item is updated idempotently.
6. Delete `PROJECT_TOKEN` only after every Project workflow in the repository uses `github-app-user`.

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
