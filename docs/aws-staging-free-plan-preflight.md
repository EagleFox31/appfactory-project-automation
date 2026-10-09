# AWS staging Free Plan preflight (issue #75)

**Status:** read-only preflight, **not a deployment**. Never interpret a successful
preflight as approval to provision a server or as a guaranteed cost cap.

The reusable workflow at `.github/workflows/reusable-aws-free-plan-preflight.yml`
checks the actual AWS account through its Free Tier API
`GetAccountPlanState` in `us-east-1` and independently via STS. It refuses:

- Any account other than **FREE / ACTIVE**, including PAID with unused credits.
- Wrong AWS account in the STS versus Free Tier results.
- Less than **$25 USD** of recorded remaining credit, or fewer than **14 days**
  before plan expiration.
- Missing or malformed API results, non-manual invocations and non-main branches.

It performs **no EC2 / SSM / IAM writes** and creates no AWS resources.
It requires an existing, separately established AWS OIDC IAM role that has
only the `freetier:GetAccountPlanState` permission on `*`.
The `sts:GetCallerIdentity` call needs no separately granted IAM permission.
The role trust policy must be restricted to the exact repository and
`staging` GitHub environment, with `aud=sts.amazonaws.com`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:EagleFox31/Pr-cis-Translation:environment:staging"
      }
    }
  }]
}
```

Readonly role policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["freetier:GetAccountPlanState"],
    "Resource": "*"
  }]
}
```

The GitHub `staging` environment should require reviewer approval.
Never add `freetier:UpgradeAccountPlan`, EC2 create/run permissions,
SSM SendCommand, or IAM write permissions to this role. Ensure the trusted
AWS GitHub OIDC provider exists; do not create a second provider.

The consumer repository should call the reusable workflow **only** from
a manual, main-branch `workflow_dispatch`. Keep the role ARN in GitHub
environment variables, not as an unreviewed workflow input.

**After successful read-only inspection:** independently establish that the
selected EC2 instance is permitted by the Free Plan, that the relevant services
are eligible for credits, that VPC/public IPv4/storage/egress have been priced,
that no paid-plan upgrade occurred and that host auto-stop/cleanup is ready.
A preflight is not proof of zero consumption; Free Plan credits can be consumed
even though the user pays nothing. A paid-plan account is explicitly blocked.

**No production server reuse:** Atelier Maître's EC2 instance, roles and data
are excluded. `appfactory-project-automation` issue #75 stays open until an
isolated host rehearsal passes.
