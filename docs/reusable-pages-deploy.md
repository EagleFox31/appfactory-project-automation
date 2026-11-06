# AppFactory Cloudflare Pages deployment — reusable static site publisher

`reusable-pages-deploy.yml` builds a static site in the consumer repository, validates the output against a
reviewed contract, and uploads it to an **existing** Cloudflare Pages project with Direct Upload. Nothing is
provisioned: the project, its custom domains and the DNS stay owned by the account administrator.

## Purpose

- One publication path for every AppFactory static site (corporate pages, documentation, landing pages).
- The decision to publish stays human: consumers call it from `workflow_dispatch` or after their own gates.
- `plan` mode gives the same build and validation on pull requests without reading a secret.

## Consumer adoption (once, versioned as code)

1. An account admin creates the project once: `npx wrangler pages project create <slug> --production-branch <default-branch>`.
2. Repository secrets (or environment secrets on `preview` / `production`): `CLOUDFLARE_API_TOKEN` scoped to
   "Cloudflare Pages - Edit" only, and `CLOUDFLARE_ACCOUNT_ID`. Protect the `production` environment with a reviewer.
3. Copy [`examples/pages-deploy.yml`](../examples/pages-deploy.yml), replace `REVIEWED_APPFACTORY_SHA` by the reviewed
   commit and set `project_name`, `dist_dir`, `working_directory`, `build_command`.

| Input | Default | Role |
|---|---|---|
| `mode` | `plan` | `plan` (no secret, no upload), `preview` (branch alias), `production` (production branch) |
| `project_name` | required | Cloudflare Pages slug, 1–58 lowercase letters, digits, hyphens |
| `dist_dir` | required | Built output, uploaded as-is (`_headers` and `_redirects` honoured by Pages) |
| `build_command`, `install_command`, `working_directory` | — | Consumer build, executed without secrets |
| `production_branch` | consumer default branch | Discovered, never assumed to be `main` |
| `github_environment` | mode name | Where secrets and approvals live |
| `checkout_ref` | triggering ref | Exact consumer revision to deploy |

Outputs: `deployment_url`, `alias_url`, `branch`.

## Contract

`scripts/pages-deploy/contract.mjs` runs after the build and before any secret is read. It rejects an invalid slug,
a missing or empty `dist_dir`, a root without `index.html`, more than 20 000 files, and an unknown mode. It computes
the Pages branch: the production branch in `production` mode, otherwise a sanitised ref name that never equals the
production branch (`preview-main` for a preview of `main`). The upload step only runs when the contract says so.

## Evidence and failure semantics

- The job summary lists project, branch, file count, bytes and the deployment / alias URLs.
- Build or contract failures stop before upload with an actionable message; the upload step never runs in `plan`.
- Uploads are content-addressed by Cloudflare: redeploying an identical `dist_dir` uploads nothing new.

## RAIDER and boundaries

- **Reusable / Agnostic**: no repository, branch, stack or package manager assumed; everything is an input.
- **Idempotent**: same build → same hashes; re-running converges. Rollback = redeploy a previous reviewed revision.
- **Engineering-grade**: `contents: read` only, credentials never persisted, action pinned by commit SHA, secrets read
  by one step only, `plan → review → apply` through `mode`.
- **Reuse-first**: Adopt `cloudflare/wrangler-action` (official, pinned) rather than scripting the Pages API; Cloudflare's
  Git integration was rejected because it bypasses the consumer's CI gates and installs a third-party app on the repository.
- **Retroactive**: existing projects, custom domains and DNS are never created or modified here.
- Out of scope: project creation, custom domains, zone or DNS changes, Workers.
