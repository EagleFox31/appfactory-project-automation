# Host-local SSM rollout executor (issue #75, inactive until staging approval)

**Status: implementation and synthetic tests only.** The host-side Python script
\`scripts/deployment/ssm-host-rollout.py\` is deliberately **not** wired to a GitHub Action or AWS SendCommand.
No AWS target, GHCR credential, server, deployment or infrastructure spend is added by merging it.

## Host prerequisites

This script is designed for an **already provisioned**, isolated Linux host, following successful, authenticated GitHub CI manifest verification and AWS/SSM target inspection.

Per tenant directory (replace identifiers):

\`\`\`
/opt/appfactory/<projectId>/<environment>/
  repo/                  # pre-provisioned authenticated checkout at exact CI SHA
  runtime.env            # pre-provisioned environment file, mode 0600
  current-release.json   # previous successful release state, explicit bootstrap
  backups/               # project-local backup artifacts
  overrides/             # generated Compose digest-only overrides
  .rollout.lock          # exclusive host lock
\`\`\`

- \`repo\` must be a real directory with an exact GitHub origin matching the tenant, already checked out at the proven SHA. The script **does not** fetch code or grant itself GitHub access.
- The Compose config, environment-file destination and mandatory backup hook must be declared as relative paths inside the repository and linked to the reviewed release commit.
- Host must already have authenticated GHCR pull access to the **private** images, Docker Compose installed, and enough persistent storage.
- \`current-release.json\` must exist from a separately audited initial bootstrap and contain the previous immutable digest refs. This script **refuses first installs** rather than pretending rollback is possible.
- Host's \`runtime.env\` must be mode 0600, never in GitHub. A copy is placed in the configured repository-local \`.env*\` path before Compose configuration, so Précis may use \`backend/.env\` and Atelier \`deploy/.env.aws\`.
- Incoming payload is JSON on stdin and contains no secrets. It must be assembled from the authenticated release artifact and the reviewed consumer configuration by a *future* runner-side gateway. Do not accept arbitrary user-submitted JSON as authorization.

## Backup/drain hook contract (mandatory)

A script such as \`deploy/appfactory-predeploy.sh\` is called from the exact pinned repository checkout with:

- \`APPFACTORY_PROJECT_ID\`, \`APPFACTORY_ENVIRONMENT\`, \`APPFACTORY_SOURCE_SHA\`
- \`APPFACTORY_BACKUP_DIR\`: unique empty backup destination under the tenant's \`backups/\`
- \`APPFACTORY_BACKUP_PROOF\`: unique path for the produced JSON proof

The hook must refuse until active translation jobs have drained and new jobs cannot be queued. In Précis this requires an application-level maintenance/quiescence feature: checking a different Python process's memory is **not** a substitute.

The hook must create all required archives (PostgreSQL dump + translated-file volume for Précis), flush to durable storage, and produce evidence similar to:

\`\`\`json
{
  "projectId": "precis-translation",
  "environment": "staging",
  "sourceSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "createdAt": 1791547380,
  "quiescent": true,
  "imageRollbackCompatible": true,
  "artifacts": [
    {
      "kind": "database",
      "path": "/opt/appfactory/precis-translation/staging/backups/<sha>/<unique>/database.sql.gz",
      "sha256": "sha256:<64 hex>",
      "bytes": 12582912
    },
    {
      "kind": "documents",
      "path": "/opt/appfactory/precis-translation/staging/backups/<sha>/<unique>/documents.tar.gz",
      "sha256": "sha256:<64 hex>",
      "bytes": 52428800
    }
  ]
}
\`\`\`

\`createdAt\` is a UTC **Unix timestamp in seconds**. The executor refuses stale evidence, missing kinds, symlinks outside tenant storage, wrong ownership, mismatched file size/hash, and unsupported rollback compatibility. These checks happen **before any container mutation**. Backup integrity does **not** prove that restoration will succeed; rehearse separate restore tests.

## Execution semantics

1. Assert exact tenant root, Git origin, checkout SHA, runtime env permissions, Compose checksum and previous rollback state.
2. Acquire an exclusive host lock; disallow concurrent releases.
3. Run the mandatory application-defined drain/backup hook, verify actual backup bytes and evidence.
4. Generate a new image override and previous-image rollback override, both referencing immutable \`@sha256:\` digests. Refuse foreign registries/tags.
5. Run \`docker compose config --quiet\` for both overrides; pull **application** images, not the DB.
6. Update only configured non-stateful services via \`docker compose up -d --no-deps --no-build <services>\`. Never execute \`down -v\`, delete named volumes, restart dependencies, run image pruning or recreate the database.
7. Poll a configured **127.0.0.1-only** health endpoint without following redirects.
8. If rollout fails, attempt image-only rollback using the **same exact Compose definition** and immutable previous image digests, verify health, return a failing result even if restored.
9. Only after healthy rollout, atomically replace \`current-release.json\`.

**Important:** neither image-only rollback nor backup integrity reverses schema migrations. The hook must refuse if a new migration could make old images incompatible with the upgraded DB. A manual data restore may be needed.

## Test coverage

\`test/test_ssm_host_rollout.py\` runs in GitHub CI via the Node test wrapper \`test/ssm-host-rollout.test.mjs\`. Synthetic scenarios check success, failed rollout+rollback, corrupt actual backup bytes, changed Compose checksum, missing bootstrap and invalid target/service inputs.

## Remaining work before real deployment

A separate, explicitly approved PR must create the **runner-side SSM gateway** to validate the complete GitHub release provenance, assume a per-tenant AWS OIDC role, re-inspect exact EC2+SSM identity, transport the reviewed Python script/payload through SendCommand, poll its output, and fail on host errors. Only run it via manually dispatched, reviewer-protected staging environment. **No shared use of Atelier Maître's instance or deployment roles.**
