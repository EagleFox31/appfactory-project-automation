# RAIDER audit — Précis AWS staging (full application)

**Epic:** #120. **Parent:** #75. **Consumer:** `EagleFox31/Pr-cis-Translation`.
**Decision:** use existing AppFactory GHCR + SSM orchestrator, a generic
parameterized CloudFormation host blueprint, and a Précis-specific declarative
manifest. No copy of Atelier Maître's production IAM credentials, runtime data
or CloudFormation stack.

## Proven state (10 October 2026)

- **Already provisioned:** central `appfactory-staging-iam-bootstrap` and the
  bounded Free Plan tenant reader `precis-staging-iam-readonly`. IAM creation
  evidence: GitHub Actions run `38009042233`, succeeded after verified
  `REVIEW_IN_PROGRESS` recovery with unchanged reviewed change set.
- **Already live-tested:** GitHub OIDC -> AWS STS -> Free Tier; account is FREE
  / ACTIVE with recorded credits. There is no evidence of AWS EC2 staging.
- **Already validated without AWS compute:** Précis full Compose frontend,
  FastAPI/LibreOffice backend, PostgreSQL 16, volumes, synthetic DB/translation
  recovery and simulated broken-image rollback on ephemeral GitHub CI.
- **Current permission boundary:** central GitHub OIDC role may only read AWS
  Free Tier/selected CloudFormation operations and create the one dedicated
  bounded IAM reader. It has **no authority** to deploy EC2, EBS, networking or
  arbitrary SSM commands. This boundary is a security feature, not an AWS bug.

## RAIDER review

| Principle | Implementation / gate |
| --- | --- |
| **Reusable** | `infra/aws/blueprints/reusable-compose-staging-host.yml` is project-neutral, parameterized by slug/region-independent network/AMI/size and uses the existing AppFactory host SSM/GHCR delivery engine. |
| **Agnostic** | Précis has a JSON manifest and explicit AWS adapter. Never hide project-specific paths in the generic core. A non-AWS deploy adapter can implement the same deploy/probe/rollback contract. |
| **Idempotent** | Identify existing stack and resources before changes. Use reviewed CloudFormation change sets and no-op on convergence; test retry after change-set creation and repeated apply. |
| **Durable** | Preserve PostgreSQL `pgdata` and translated document `translations` volumes across container restart. EBS persists over reboot, **not** over EC2 termination: backups and restore must be proven before staging apply. |
| **Engineering-grade** | Separate OIDC runner/service/instance roles and permission boundaries, no inbound SG, IMDSv2, encrypted EBS, digest pinning, SSM execution receipts, bounded polling, health probes and rollback, cost gate. |
| **Retroactive** | Do not touch `atelier-maitre-prod`. Detect existing tenant IAM reader, existing VPCs, instances or EBS volumes before create. Ignore unowned resources and report conflicts. |

## Exact reference architecture — *unapplied*

GitHub PR -> impact-aware CI -> lint/contract tests -> immutable image digest
-> AppFactory cost + OIDC/plan review -> isolated CloudFormation EC2 host
-> SSM managed host -> Docker Compose (db, backend, web) -> health checks
-> synthetic backup/restore -> release/rollback.

Blueprint's default network posture: existing approved public-routed subnet,
auto-assigned public IPv4 **for outbound HTTPS only** so SSM and public GHCR
can work without an expensive NAT Gateway; **zero inbound security group
rules**, no SSH, and no exposed PostgreSQL. Public IPv4 has its own
hourly fee even when no ingress is allowed. Confirm network route, subnet,
availability zone and actual region-specific pricing; no VPC ID, subnet ID
or AMI ID is guessed.

Host candidate: **x86_64 t3.medium, 40 GiB encrypted gp3** for LibreOffice
conversion, to be confirmed by load test and AWS Pricing/Cost Explorer.
The configuration is **not** a cost commitment. The image is an explicitly
reviewed, pinned Amazon Linux 2023 AMI. SSM instance profile requires a
separate narrow boundary; the existing Free Plan reader boundary is not
appropriate for an EC2 instance. No application or secret is installed by
merging the template.

## Blocking safety conditions (all required for first EC2 apply)

1. Live cost estimate including hourly EC2, gp3 disk, public IPv4, snapshots,
   data transfer and any optional SSM/bandwidth. Estimate must stay within
   explicitly approved credits with a safety reserve and automatic stop/delete.
   Free Plan remaining credits are not a guarantee of service eligibility.
2. Dedicated AppFactory **EC2 staging provisioner** (NOT Atelier production,
   NOT the Free Plan reader), IAM permission boundaries and exact
   project/environment resource tags. AWS administrator authorization to
   expand beyond the already-approved reader-only policy is still required.
3. Existing network, reviewed AMI and region/AZ, versioned instance profile
   policy and SSM agent validated in plan.
4. Secrets delivered encrypted, never committed, embedded into user data or
   echoed in logs. `FRONTEND_API_KEY` in Vite is inherently public; never
   treat it as backend authorization for sensitive capabilities.
5. PostgreSQL + translated-file backup, restore, snapshot retention, failure
   injection and rollback verified **on a disposable host using synthetic data**.
6. Automatic TTL teardown/cost alert **implemented and tested**, not simply
   a tag, schedule description or aspiration. Root disk is deleted on
   termination; backup procedure must account for that.
7. User authorizes the **specific EC2/network/storage resource plan and
   credit use** before the write-capable workflow runs. No cloud writes in
   the present PR.

## Incremental Proof of Done

- **M1 — blueprint/contract:** AppFactory CI, static security checks and
  real AWS `ValidateTemplate` are green, `lifecycle: PLAN_ONLY`.
- **M2 — provisioner:** scoped IAM boundary & OIDC policy approved and
  inspected; still no compute allocated.
- **M3 — AWS instance:** `plan -> approval -> apply -> no-op`, exact EC2
  instance + SSM online; cost and TTL verified.
- **M4 — Précis release:** API + web + Postgres + documents healthy,
  backup/restore, digest-based rollback and no retained secrets in image.
- **M5 — cleanup & retroactive:** stop/delete, cost reconciliation, brownfield
  adoption and Failure Memory documented.

The read-only workflow may safely validate the template while no expensive
resources are approved. **Do not call the resulting template-only CI run
"staging deployed."**
