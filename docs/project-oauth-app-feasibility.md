# Personal Projects: OAuth App broker

Rollout status: 2026-09-19. OAuth support is implemented and deployed. GitHub
user consent completed, and two owner-triggered AgenStart workflow runs passed
without `PROJECT_TOKEN` (runs 35433489255 and 35433548102). The first run
resolved personal Project #2 and synchronized one open Issue with no new item.

PR #44 is merged at `7ff298087308d7ddcc8e507d8eb9adb56c2e2158`; its CI passed.
AgenStart still uses `PROJECT_TOKEN` for its personal Project owned by EagleFox31.
The GitHub App settings inspected do not offer an account-level Projects permission.
The earlier instruction to grant that permission is incorrect. Issuing a GitHub App
user token does not prove access to this Project.

The selected approach keeps the personal Project and uses a separate OAuth App
for Project access. Repository governance keeps its existing GitHub App.
GitHub supports expiring OAuth App tokens with `offline_access`: access tokens
last eight hours and refresh tokens expire after six months without use.

For public AgenStart, evaluate `project public_repo offline_access`. Resource
scopes cover more than one Project/repository and require explicit user consent.
Do not silently request `repo` for private repositories.

Before rollout:

- Add an explicit OAuth provider, retaining GitHub App and PAT compatibility.
- Request and verify resource scopes; reject non-expiring token responses.
- Add browser-bound OAuth state and PKCE, consumed once.
- Bind encrypted credentials to provider/client and immutable user identity.
- Serialize remote refresh; a database version comparison alone does not serialize
  consumption of the upstream refresh token.
- Preserve exact reusable-workflow and immutable repository identity checks.
- Use versioned D1 migrations if the schema changes.
- Test a manual owner-triggered workflow without PAT against the existing Project
  twice, compare Project/item identities, and verify refresh without logging tokens.
- Retain production event workflows and PROJECT_TOKEN until all actors and secret
  references are supported. The current broker rejects contributor/bot actors.

Local validation: 132 tests pass on Node 24.19.0 with
`node --test --test-isolation=none`. This includes SQLite-backed storage tests
and mocked OAuth/OIDC exchange and refresh; it does not prove a real Project update.

Cloudflare Worker and D1 are deployed and both migrations applied. The Worker
health endpoint returns 200, while a request without an OIDC proof returns 401.
The OAuth App `AppFactory Projects` is created. Its client ID and secret are
configured on the Worker; the secret is stored as a Cloudflare secret, never in
the repository. The live workflow test proves OIDC exchange and Project access
for the owner, including a second idempotent run. A production event migration
and upstream refresh after token expiry are not yet verified. The first attempt
failed with HTTP 404 because the test workflow used the Worker origin instead
of `/v1/github/user-token`; correcting that URL produced the two passing runs.

References:

- https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions
- https://docs.github.com/en/rest/projects/projects
- https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
