# Reusable GHCR builds — issue #75, phase 1

This capability belongs in **AppFactory Project Automation**. It can validate a consumer's container configuration and publish source-SHA-tagged GHCR images **only** after a successful trusted CI release. It **does not deploy** to AWS, modify Atelier Maître production, create servers or incur AWS infrastructure charges.

## Configuration contract (v1)

Put the JSON at `.github/appfactory-deploy.json` in each consumer repository.

- `schemaVersion` must be `1`; unknown keys, traversal paths and secrets-as-build-args are rejected.
- `projectId` and `environment` are lowercase slugs, independent from another app's resources.
- `releaseBranch` is the only branch accepted for a successful publish from CI.
- `releaseMarker` must change in the **exact** CI commit: `version.txt` for Atelier, or a properly managed release file for another app.
- `composePath` must exist; phase 1 checks it but **never runs** Compose or touches persistent volumes.
- `platforms` supports `linux/amd64` and `linux/arm64`; individual images can override this list.
- `images` has 1–6 entries of `name`, `dockerfile`, `context` and optional `platforms`; filenames must resolve inside the checkout. Image naming is isolated to the consumer's GHCR repository and image service: `ghcr.io/owner/repo-service:sha-<40-digit-sha>`. Buildx exposes final **image digests** in the Actions summary.
- Optional `deployment` describes an **explicit** `aws-ssm` target, region, IAM role, instance, scoped SSM prefix, Compose project, health path and service names. It is **validated but never invoked** during this phase.

The release gate re-verifies `workflow_run.conclusion=success`, the triggering workflow event `push`, source repository, target branch, exact source SHA and changed release marker. Nonrelease merges are reported as **skipped**, not labeled as deployed.

No `build-args` are currently supported. Any consumer build requiring *public* Vite values (including Précis's `VITE_API_KEY`) must explicitly adapt its Dockerfile or add a reviewed public-input contract in a follow-up PR. A Vite-bundled key **is public by definition** and must never be used as an authorization boundary.

## Calling as a harmless PR plan

Use the SHA produced by an **approved AppFactory merge** as `APPFACTORY_REVIEWED_SHA` below: both the reusable workflow reference and `appfactory_ref` must be pinned to that **same** immutable 40-character commit.

```yaml
name: Container plan
on:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  plan:
    uses: EagleFox31/appfactory-project-automation/.github/workflows/reusable-container-plan.yml@APPFACTORY_REVIEWED_SHA
    with:
      config_path: .github/appfactory-deploy.json
      source_sha: ${{ github.event.pull_request.head.sha || github.sha }}
      appfactory_ref: APPFACTORY_REVIEWED_SHA
```

The separate **plan-only reusable workflow** has no GHCR write job and requires only `contents: read`. GitHub Actions forbids a read-only caller from invoking a reusable workflow that contains `packages: write`, even if that job would be skipped. It does not run consumer code, build an image, request an AWS token, install secrets or invoke a server.

## Calling after CI for an actual release image

```yaml
name: Build released images
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
permissions:
  contents: read
  packages: write
jobs:
  build:
    if: ${{ github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' }}
    uses: EagleFox31/appfactory-project-automation/.github/workflows/reusable-container-build.yml@APPFACTORY_REVIEWED_SHA
    with:
      source_sha: ${{ github.event.workflow_run.head_sha }}
      appfactory_ref: APPFACTORY_REVIEWED_SHA
```

**Never** call the image publishing workflow on `pull_request` or ordinary `push`. Its validation fails closed unless a successful trusted release CI event is supplied. Reviewed branch protection, release marker governance and GHCR visibility must be enforced by the consumer.

## Future work before live AWS/SSM

Phase 2 requires an independently reviewed SSM adapter with per-app OIDC trust, remote instance identity verification, explicit manual production approval, no mutable `latest` tags, verified digest-based rollout, backups, health checks and recoverable rollback.

Précis uses in-memory translation jobs and an SSE stream: a container restart interrupts active work. Until a durable queue exists, drain translations and take a PostgreSQL + translation-volume backup before *any* deployment. One Uvicorn worker is intentional. Never copy Atelier's EC2, CloudFormation stack, Parameter Store prefix, secrets or Docker Compose project across.

Source-of-truth reference examples: `examples/precis-container-build.config.json` and `examples/atelier-container-build.config.json`. No production activation is included.
