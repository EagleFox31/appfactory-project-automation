# AppFactory Firebase deployment — reusable Hosting / Firestore publisher without keys

`.github/workflows/reusable-firebase-deploy.yml` deploys a consumer repository to an **existing** Firebase
project (Hosting, optionally Firestore rules and indexes) using **GitHub OIDC + Workload Identity
Federation** to impersonate a dedicated service account. No service-account key, no JSON secret and no
legacy CLI token exist anywhere in GitHub. `mode: plan` runs the whole build and contract with no Google
credential at all.

## Position in AppFactory

AppFactory (`Trigenys/appfactory`) has no Firebase or Google Cloud primitive: its canonical hosting path is
Cloudflare Pages through the Git integration. This workflow is the Firebase counterpart of the Cloudflare
exception path (`reusable-pages-deploy.yml`): a reviewed, SHA-pinned reusable workflow plus a contract script,
consumed by repositories whose product already lives on Firebase (Hosting + Firestore + Auth). The Worker and
the broker are not involved; a second Firebase consumer should trigger an ADR before any Worker primitive is
added.

Reuse-first decision (recorded here): `FirebaseExtended/action-hosting-deploy` was evaluated and rejected
because it only accepts a service-account JSON (`firebaseServiceAccount`) and has no Workload Identity path
(open upstream issues #174 and #399). `firebase-tools` itself honours Application Default Credentials of type
`external_account` (verified locally with an isolated profile: the CLI reaches the STS token exchange), so the
chosen approach is **Adapt**: `google-github-actions/auth` (pinned by SHA) + `npx firebase-tools@<exact>`.

## Consumer adoption (once, versioned as code)

1. A project owner runs the one-time bootstrap in `docs/gcp-wif-one-time-bootstrap.md` (verification first,
   application only after review). It yields two **non-secret** values: the provider resource name and the
   service-account email. Store them as repository **variables**, never as secrets.
2. If `firebase.json` publishes the checkout (`hosting.public: "."`), add to `hosting.ignore` at least
   `"**/.*"` and `"**/gha-creds-*.json"` (the contract refuses to deploy otherwise).
3. Copy `examples/firebase-deploy.yml`, pin `appfactory_ref` and the `uses:` reference to the reviewed commit
   SHA of this repository, and set the inputs.
4. Protect the `production` GitHub environment: deployment branch policy limited to the default branch,
   required reviewers if a human gate is wanted. The workflow refuses production from any other ref anyway.

## Contract (`scripts/firebase-deploy/contract.mjs`)

Runs after the consumer build and **before** any credential exists. It fails the job when:

| Check | Why |
|---|---|
| `mode` not in `plan`, `preview`, `production` | explicit modes only |
| `firebase_project_id` not a Google Cloud project id | typo = deploy elsewhere |
| `targets` outside `hosting`, `firestore:rules`, `firestore:indexes`; Firestore targets in `preview` | Firestore has no preview channel; a preview must never change production rules |
| `firebase_tools_version` / `node_version` not exact `x.y.z`, or listed in `KNOWN_BROKEN` | reproducible runs; failures recorded in lessons-learned are not repeated |
| identity inputs malformed (shape only) in `preview` / `production`; optional in `plan` | no network call, no token read |
| preview channel `live`, or empty once normalized | `live` is production |
| production from `pull_request*`, `issue_comment`, `workflow_run`, a fork, or a ref other than `refs/heads/<production_branch>` | strict production identity; `production_branch` defaults to the consumer's default branch |
| `firebase.json` missing / invalid / ambiguous multi-site without `hosting_target` | no implicit site |
| `hosting.public` missing, or no `index.html` at its root | build not run |
| **any credential-looking file** in `hosting.public` (`gha-creds-*.json`, `*service-account*.json`, `.env*`, `application_default_credentials.json`, or any JSON with `"type": "service_account" / "external_account" / "authorized_user"`, `private_key`, `refresh_token`) in **every mode** | a published credential is a full compromise of the service account |
| `hosting.public` is the checkout and `hosting.ignore` lacks `**/gha-creds-*.json` or `**/.*` | defense in depth for `public: "."` |
| Firestore targets without matching `firebase.json` entries / files | explicit targets only |
| `checkout_ref` is a SHA that differs from the checked out commit | the deployed commit is the one the caller named |
| credentials directory inside the workspace or the public directory | credentials never live where a build or Hosting could read them |

Outputs: `deploy`, `only`, `channel`, `files`, `bytes`, `public_dir`, `credentials_dir`, `firebase_tools_version`.

## Credentials handling (the `gha-creds-*.json` risk)

`google-github-actions/auth` writes its credentials file into `$GITHUB_WORKSPACE`. With `hosting.public: "."`
that file would be uploaded to the website. The workflow therefore:

1. creates `$RUNNER_TEMP/appfactory-firebase-credentials` (mode 700) and runs the auth action with
   `GITHUB_WORKSPACE` overridden to that directory (the action reads the variable from its environment);
2. verifies that `GOOGLE_APPLICATION_CREDENTIALS` points under that directory and that no `gha-creds-*.json`
   exists under the real workspace, before any deploy step;
3. lets the action's own post-step delete the file (`cleanup_credentials: true`) and additionally removes the
   directory and any stray `gha-creds-*.json` in an `if: always()` step;
4. requires `hosting.ignore` to exclude `**/gha-creds-*.json` whenever the public directory is the checkout.

Tokens are never echoed; `debug: true` only adds `--debug` to firebase-tools, which prints request metadata,
not credentials.

## Evidence and failure semantics

- `plan` (pull requests, forks): build + contract, no `id-token` use, no network call to Google. Safe anywhere.
- `preview`: `hosting:channel:deploy <channel> --expires <preview_expires>`; channel derived from the branch
  name unless given; output `hosting_url` is the channel URL. Firestore targets refused.
- `production`: `firebase deploy --only <targets> --message "<repo>@<sha>" --force --non-interactive`; the
  release message records the deployed commit; output `deployed_sha` lets the caller chain further steps
  (sitemap diff, IndexNow) on exactly that commit.
- Serialization: concurrency group `appfactory-firebase-<project>-<live|preview|plan>`, `cancel-in-progress:
  false`, so two production deploys of the same project queue instead of racing.
- Idempotency: Hosting content-hashes files, so redeploying an identical tree uploads nothing new and
  converges to the same site; a release entry is still recorded (Firebase behaviour). Consumers that want
  "no change → no deploy" keep their own change detection before calling the workflow (as Love Ink's
  `seo-refresh` does) and pass `checkout_ref`.
- Failure messages name the input or file to fix. A `firebase-tools` authentication failure prints the generic
  "have you run firebase login?" hint: rerun with `debug: true` to see the STS / impersonation error.

## Production identity restriction (layers)

1. GitHub environment deployment branch policy (consumer side).
2. Workflow-level guard step: event, ref and fork checks, independent of the contract.
3. Contract guard: same checks, unit-tested.
4. Google side: the Workload Identity Provider's attribute condition (`assertion.repository_owner`) and the
   `principalSet` binding on `attribute.repository/<owner>/<repo>` limit which repository can impersonate the
   service account at all; an optional stricter binding on `attribute.ref` for `refs/heads/<default>` is
   described in the bootstrap document.

## RAIDER and boundaries

- **Reusable / Agnostic:** project id, provider, service account, targets, site directory, build command,
  versions and production branch are inputs; default branch is discovered; nothing is Love Ink-specific.
- **Idempotent:** contract is pure; repeated production deploys of the same commit converge.
- **Durable:** new files only; `reusable-pages-deploy.yml`, the Worker and the broker are untouched; the new
  tests are part of `npm test`.
- **Failure memory:** `docs/engineering/lessons-learned.md` records the rejected action, the broken
  `firebase-tools` / Node versions, the `attribute.repository` mapping requirement and the credentials-file
  exposure; the contract encodes them.
- **Engineering-grade:** `contents: read` + `id-token: write` only, no secret input at all, actions pinned by
  commit SHA, plan → review → apply in the bootstrap.
- **Retroactive:** an existing site committed in the repository works with an empty `build_command`.

Out of scope (deliberately): project creation, custom domains, DNS, Cloud Functions, Firestore data, Storage
rules, rollback (use the Firebase console release history), and any change to the consumer repository.
