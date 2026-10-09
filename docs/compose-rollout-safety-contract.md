# Image rollout/rollback safety contract — issue #75, phase 2b design

This code generates a **dry-run-only** Docker Compose override plan using **immutable GHCR digests**. It is a prerequisite for a future SSM execution adapter, **not** a deployment workflow, does not send any AWS commands and never mutates a server.

## Preconditions

The caller is responsible for obtaining a trusted manifest from the GitHub Actions [authenticated provenance verification workflow](reusable-container-build.md). It must provide:

1. The versioned consumer configuration (\`.github/appfactory-deploy.json\`), including the explicit per-service \`deployment.imageServices\` mapping, \`backupKinds\` and a loopback-only \`healthUrl\`.
2. Target inspection output proving that the AWS account, EC2 instance, SSM state, exact repository/project/environment tags and CPU architecture match this application.
3. A previous **successful** deployed state with the same repository, project and environment and immutable GHCR digest references. Initial installation requires a **separate explicit bootstrap**; it is not a normal rollback-capable upgrade.
4. Fresh backup-and-quiescence evidence linked to the upcoming SHA. The evidence must include all backup kinds required by the consumer, artifact paths in the dedicated application backup directory, SHA-256 hashes, non-zero file sizes and a timestamp from the last 15 minutes.
5. An exact checksum of the Compose definition. If it has changed since the previous successful deploy, an automatic image-only rollback is **not safe** and the plan sets \`rollbackEligible=false\`.

## Example consumer deployment addition

The base fields \`transport\`, \`roleArn\`, \`instanceId\`, \`region\`, \`ssmParameterPrefix\`, \`composeProject\`, \`healthPath\` and \`serviceNames\` from [SSM preflight](ssm-readonly-preflight.md) remain required.

\`\`\`json
{
  "imageServices": {
    "api": "backend",
    "web": "web"
  },
  "backupKinds": ["database", "documents"],
  "healthUrl": "http://127.0.0.1/health"
}
\`\`\`

Above is an **excerpt inside \`deployment\`**, not a complete file. The map keys correspond to image names; values are specific services in \`deployment.serviceNames\`. Database, Redis and MongoDB service names cannot be targeted by the generic image rollout. \`healthUrl\` is restricted to host loopback; no arbitrary external endpoint is permitted.

The planner outputs two OCI reference overrides, which can be provided to Compose as JSON (a YAML-compatible Compose syntax):

\`\`\`json
{
  "services": {
    "backend": {
      "image": "ghcr.io/eaglefox31/pr-cis-translation-api@sha256:<verified-64-character-digest>"
    }
  }
}
\`\`\`

The rollback override contains the *previously deployed* digest and is only declared automatically eligible if the old and new Compose checksums match. All operations must target only the mapped services with \`docker compose up --no-deps --no-build\`; do **not** use \`down -v\`, restart the DB service, delete named volumes, prune stateful images, or overwrite files.

## Critical distinction: declared backup evidence versus verified recovery

The **current module validates evidence structure**, ownership, freshness, expected artifact kinds and claimed hashes. It **does not have a remote host and cannot verify backup bytes or the ability to restore**. Before implementation of SSM \`SendCommand\`, a separate host-side predeploy hook MUST:

- Drain/stop accepting new translations and confirm active translation jobs = 0; Précis uses an in-memory scheduler and SSE streams, so a restart can lose jobs.
- Perform \`pg_dump\`/equivalent for the database, archive its translated-document volume, and write an evidence file **only after** the snapshots are fully flushed to durable storage.
- Rehash the **actual files on disk** and compare with evidence. Paths may not escape \`/opt/appfactory/<projectId>/<environment>/backups/\`; do not follow symlinks to another application's storage.
- Regularly rehearse restores on an isolated environment.
- Fail before any Compose changes if the hook is absent or the proof is stale.

An image rollback **does not reverse Alembic or any other database migration**. A failed health check must return a non-successful job and make manual recovery instructions available; never claim full recovery when schema compatibility is unproven.

## Rollout gating

This is planning and testing code only. Future opt-in deployment must be triggered through a manually dispatched consumer workflow protected by GitHub Environments, with a per-repository IAM/OIDC trust and per-environment EC2 resources. **Atelier Maître production is never a default target**, and there is no approved existing staging target for Précis.
