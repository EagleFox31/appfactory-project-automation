# AppFactory AWS Free Plan preflight — automatic (no console steps)

The central AWS IAM bootstrap stack `appfactory-staging-iam-bootstrap`
was verified as `CREATE_COMPLETE` by the operator on 2026-10-09 in
account `458018461157` / region `eu-west-3`.

## Trigger

`.github/workflows/auto-aws-free-plan-preflight.yml` runs automatically on
a trusted **push to main** that changes the workflow, central IAM template or
Free Plan guard. It can also be dispatched on demand.

This is the same high-level architecture already used by the Atelier Maître
production workflow: GitHub Actions -> OIDC -> AWS role -> scoped AWS APIs.
Unlike Atelier Maître's production releases, this workflow is **read-only**:

- Assumes the new AppFactory staging OIDC role, not Atelier production roles.
- Reads STS identity and Free Tier account plan state from AWS.
- Rejects wrong AWS accounts, Paid plans, insufficient credits (< $25 USD)
  or fewer than 14 remaining Free Plan days.
- Reports status in the GitHub Actions step summary and cleans snapshots.
- **Never** calls CloudFormation create/deploy, IAM modifications, SSM,
  EC2, or AWS account-plan upgrades.

This is intended to verify live GitHub OIDC authentication without making
another AWS console or CloudShell operation necessary.

## Environment security

On the first workflow run, GitHub can automatically create its `staging`
environment if absent. **Auto-created environments have no protection
rules.** This is acceptable only for the read-only preflight.

It is **NOT** sufficient to authorize the separate manual IAM change-set
workflow. Before `apply=true`, a repository administrator must configure
deployment restriction to `main` and reviewer approval for `staging`.
GitHub's default environment creation does not apply these protections.

When the central IAM reader actually works in AWS, the remaining deployment
steps are a separate review: bounded tenant IAM role, independent staging
server cost approval, safe EC2/SSM provisioning and rollback tests.
**Do not touch Atelier Maître production.**
