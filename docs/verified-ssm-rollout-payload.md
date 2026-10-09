# Attested SSM host payload — issue #75 (phase 2c, **plan only**)

**Status: reviewed-code candidate; no live AWS target, rollout, GHCR publication or server changes in this PR.**

The new reusable workflow `.github/workflows/reusable-container-ssm-rollout-plan.yml` joins three existing proofs without carrying out a deployment:

1. Authentic GitHub Actions image digest manifest, downloaded from an explicitly named successful publisher run. Checks the checksum and calls GitHub's authenticated REST API to verify the exact successful upstream CI/publisher runs, their paths, source SHA, repository, branch and event types.
2. Explicit owner/repository/project/environment identity. Reads a consumer's versioned container config at the exact release commit, including mandatory `deployment.imageServices`, `deployment.backupKinds`, `deployment.healthUrl`, `deployment.runtimeEnvTarget` and `deployment.predeployHook`.
3. Real **read-only** EC2/SSM inspection using per-tenant OIDC credentials: checks the AWS account, instance ID, EC2 tenant/repository tags, Linux target architecture and online managed-instance status.

Only after those checks does it create `appfactory-host-rollout-payload.json` as a short-retention, **secret-free** GitHub Actions artifact. It contains only the fields accepted by the host-side Python `ssm-host-rollout.py` executor, including **immutable** GHCR `@sha256:` references and an exact non-stateful Compose service allowlist.

**The payload is not an authorization by itself.** It cannot be posted unverified to the host. A future reviewed runner gateway must repeat proof checks at execution time, bind the identical target, authenticate SSM independently and reject stale/replayed plans.

## Consumer configuration

The consumer's existing `.github/appfactory-deploy.json` gains these three opt-in deployment fields, in addition to the existing inspected target and service list:

```json
{
  "deployment": {
    "imageServices": {
      "api": "backend",
      "web": "web"
    },
    "backupKinds": ["database", "documents"],
    "runtimeEnvTarget": "backend/.env",
    "predeployHook": "scripts/appfactory-predeploy.sh",
    "healthUrl": "http://127.0.0.1/health"
  }
}
```

This is an excerpt, **not** a complete config. `healthUrl` must resolve to the configured `healthPath` on loopback, not an external domain. `predeployHook` must exist inside the pinned consumer checkout. It must actually stop new work, drain ongoing translations, create and verify backups and prove migration/rollback compatibility. A stub which reports success is **not sufficient** for production.

## Manual consumer caller (not enabled automatically)

Replace `REVIEWED_SHA` with an immutable AppFactory commit on both lines, *after* review. The caller's repository must already have a trusted GitHub environment and a dedicated role trusted only for the exact owner/repo/environment GitHub Actions OIDC identity.

```yaml
name: Attested SSM payload (no deploy)
on:
  workflow_dispatch:
    inputs:
      source_sha:
        required: true
        type: string
      build_run_id:
        required: true
        type: string

permissions:
  contents: read
  actions: read
  id-token: write

jobs:
  plan:
    uses: EagleFox31/appfactory-project-automation/.github/workflows/reusable-container-ssm-rollout-plan.yml@REVIEWED_SHA
    with:
      appfactory_ref: REVIEWED_SHA
      environment: staging
      source_sha: ${{ inputs.source_sha }}
      build_run_id: ${{ inputs.build_run_id }}
      ci_workflow: .github/workflows/ci.yml
      publish_workflow: .github/workflows/container-publish.yml
```

**No consumer workflow is added in this PR**: Précis currently has no approved staging EC2/SSM target, no safely implemented translation drain/backup hook and no authorized GHCR publish configuration for its browser-public Vite values. Atelier Maître has a separate active deployment pipeline, untouched by this work.

## Exit conditions before connecting live SendCommand

- Explicit staging server selection, dedicated OIDC role and cost approval.
- Source commit, build run and GHCR manifest actually produced by an approved consumer release.
- Review of predeploy drain/backup and repeatable restore on an isolated machine; for Précis, do not restart the single in-memory translation worker while jobs are active.
- Host bootstrapped with isolated checkout/runtime.env, correctly privileged GHCR access, Docker Compose, a previous digest-based baseline and adequate RAM/disk.
- Separate, **manual** deployment PR whose runner gateway rechecks proofs and invokes exactly the pinned, reviewed host executor through SSM, captures/validates the command status, and leaves production disabled until explicit authorization.
- No cross-use of Atelier's CloudFormation stack, EC2, role, Parameter Store prefix or Docker volumes.

This PR adds the generation and verification stage only. It doesn't bill AWS or create AWS resources.
