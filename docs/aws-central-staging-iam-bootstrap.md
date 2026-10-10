# AppFactory central AWS IAM trust: first-install-only bootstrap

## Purpose

The public AppFactory repository manages **one central deployment authority**
for future isolated staging onboarding. The operator authorizes the platform
**once** through AWS CloudFormation; GitHub Actions handles the per-project
work afterwards. **This is not a claim of zero-touch initial IAM authorization.**

The bootstrapping template is:
`infra/aws/appfactory-central-staging-iam-bootstrap.yml`.

**Scope currently restricted to the first pilot:** Précis Translation's
read-only Free Plan IAM role. This is **not** a general EC2 provisioner.
Expansion to compute, storage, budgets, more tenants, or production requires
another reviewed least-privilege change. Never reuse Atelier Maître's production
OIDC/CloudFormation IAM identities.

## First-time operator approval: AWS CloudFormation UI only

After code review and green CI, in the intended Trigenys AWS account
`458018461157`, region `eu-west-3`:

1. Open **CloudFormation → Create stack** in the AWS console.
2. Upload the exact checked-in central YAML, named
   `appfactory-central-staging-iam-bootstrap.yml`.
3. Choose stack name **`appfactory-staging-iam-bootstrap`**. Review the
   change set and IAM acknowledgement for named roles.
4. Approve **only** this three-resource trust bootstrap if its resource
   list is: `StagingReaderBoundary` (managed policy),
   `StagingIamCloudFormationRole` (IAM role),
   `AppFactoryStagingIamDeployerRole` (IAM role).

No CloudShell or access-key copy is necessary. The bootstrap does not create
EC2, SSM, VPC, storage, passwords, or a billed compute resource.
This AWS administrator authorization cannot be self-created from GitHub
without an existing trusted AWS role. CloudFormation may have normal
account-level service costs, but this template itself provisions only IAM.

## Privilege boundaries

- GitHub OIDC trust is restricted to the immutable account/repository IDs
  `EagleFox31@86088743/appfactory-project-automation@1355997933`,
  audience `sts.amazonaws.com`, environment `staging`.
- OIDC runner role `appfactory-staging-iam-deployer` may only operate
  CloudFormation stack `precis-staging-iam-readonly` and narrowly prefixed
  change sets in Paris, read current Free Plan state, and pass exactly one
  isolated service role to CloudFormation.
- CloudFormation execution role
  `appfactory-staging-iam-cfn-execution` can create or maintain exactly
  `precis-translation-staging-free-plan-read`. Creation requires
  project/staging tags and the bounded `appfactory-staging-free-plan-boundary`
  IAM managed policy.
- Tenant IAM permissions boundary permits only
  `freetier:GetAccountPlanState`, regardless of any additional policy
  an attacker attempts to attach within the bounded tenant role.
- IAM roles are separated from all existing Atelier Maître production roles.

## After central bootstrap — no CloudShell

The GitHub workflow
`.github/workflows/appfactory-precis-staging-iam.yml` runs from **AppFactory**
under GitHub's `staging` environment. Protect the environment with required
reviewers and restrict it to `main` **before any Apply**.

A manual run with `apply=false` (the default) checks the precise reviewed
consumer template Git blob, live AWS account/credits/expiration and syntax,
without modifying AWS resources.

An independently approved run with `apply=true` and confirmation
`APPLY_PRECIS_STAGING_READER` additionally creates a named CloudFormation
change set, verifies exactly **one new IAM reader role** before execution,
and creates only the isolated Précis role. The workflow fails on an existing
stack rather than silently updating it. AppFactory pins the reviewed public Précis main-branch commit directly as
`PRECIS_REVIEWED_SHA` (currently `18618e5ca8b76a3a6b62278e16e0c6fd2fd078fd`),
so no commit SHA needs to be copied into the manual workflow run. A future
consumer template change requires a reviewed AppFactory PR updating this pin.
AppFactory also pins the exact approved template Git blob.

The role created for Précis is referenced by its known non-secret ARN in the
Précis read-only Free Plan workflow. No per-project AWS key or ARN manual
variable is required.

**Not yet implemented:** safe automation of creating an EC2 staging instance,
network/storage cost caps, isolated SSM command permissions, drain/backup and
end-to-end digest rollback. These require separate reviewed templates,
permission boundaries and explicit approvals. No AWS creation happens merely
because these files merge.

## Migration note

The old `scripts/deployment/bootstrap-aws-free-plan-reader.sh` is a
*legacy pilot* CloudShell script and must **not** be used in the central
deployment path: it writes the same consumer stack directly, bypasses the
new centralized change-set approval and omits the required permission boundary.
Use the new central CloudFormation UI bootstrap **once**, then the AppFactory
GitHub Actions workflow.
