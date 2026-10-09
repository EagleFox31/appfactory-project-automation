# AWS OIDC bootstrap: why one administrator action remains

Infrastructure-as-code should provision project roles automatically, not
require repeated CloudFormation console clicks.

However, the **first AWS management authority cannot bootstrap itself**.
Before AppFactory can assume AWS roles, a trusted AWS administrator must grant
a narrowly-scoped GitHub OIDC identity the ability to read the account or
manage an approved infrastructure stack.

## Pilot: Précis Free Plan reader

Verified prerequisites in the Trigenys account:
- AWS account: `458018461157`, target application region `eu-west-3`.
- Existing GitHub OIDC identity provider `token.actions.githubusercontent.com`
  with audience `sts.amazonaws.com` (visually confirmed from AWS console).
- GitHub fork: `EagleFox31/Pr-cis-Translation` (owner ID `86088743`,
  repository ID `1411758415`, required for immutable GitHub OIDC trust).

The reviewed reusable CloudFormation template at
`infra/aws/appfactory-free-plan-reader.yml` creates **only** an IAM role for
`freetier:GetAccountPlanState`, never EC2/SSM access.

The script `scripts/deployment/bootstrap-aws-free-plan-reader.sh` validates
the exact AWS account and the preexisting OIDC audience before any changes.
It is **dry-run by default**. It must be run by a human from AWS CloudShell
or another already-authenticated AWS session with CloudFormation and IAM
privileges, from a **reviewed and pinned AppFactory checkout**:

```bash
bash scripts/deployment/bootstrap-aws-free-plan-reader.sh
# Review output and CloudFormation template, then explicitly opt in:
bash scripts/deployment/bootstrap-aws-free-plan-reader.sh --apply
```

This one-time bootstrap action is not scheduled, triggered by CI or performed
as part of this PR. No access keys are ever copied to GitHub. The role ARN is a
non-secret and is pinned in Précis' read-only workflow.

After the account trust is established, AppFactory should be able to automate
onboarding **per project**. To make that fully hands-off, separately provision
and audit a dedicated **platform provisioning role**, restricting its rights
to named, tagged, tenant-specific stacks and permission-boundary-constrained
IAM roles. Production or stateful resources must still require explicit
approval, cost ceilings and independently verified backup/drain readiness.
Do NOT give the Free Plan reader role `iam:CreateRole`,
`cloudformation:CreateStack`, `ec2:RunInstances` or `ssm:SendCommand`.

The current script is intentionally scoped to **one verified pilot**; the
CloudFormation template is reusable, while the next project should be added
through a reviewed Project Registry entry rather than accepting arbitrary
user-supplied AWS account IDs or role names.

**No new resources have been created by committing this code.**
