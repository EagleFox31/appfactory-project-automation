# One approval in chat -> GitOps IaC IAM role creation (Précis pilot)

## What is already done

- AWS account 458018461157 has the central
  `appfactory-staging-iam-bootstrap` CloudFormation stack (CREATE_COMPLETE).
- AppFactory's dedicated GitHub OIDC role has passed a **real** STS/Free Tier
  read-only test, with Free Plan active.
- AppFactory's automatic AWS CloudFormation validation accepts the corrected
  Précis reader-only template; the separate
  `precis-staging-iam-readonly` stack is not present.
- The tenant role IaC is pinned to validated Git blob
  `996be22806afb8fc1eecc11432d8b9ac64548dd2` at Précis commit
  `18618e5ca8b76a3a6b62278e16e0c6fd2fd078fd`.

## Future single user approval — no CloudShell, no console forms

After the owner explicitly approves the exact IAM-only creation, AppFactory's
GitHub automation will create one reviewed PR adding **only** this file:

`infra/aws/approvals/precis-staging-iam-reader.json`

It must contain exactly:

```json
{
  "decision": "APPROVE_CREATE_ONLY",
  "account": "458018461157",
  "repository": "EagleFox31/Pr-cis-Translation",
  "stack": "precis-staging-iam-readonly",
  "iamRole": "precis-translation-staging-free-plan-read",
  "consumerSha": "18618e5ca8b76a3a6b62278e16e0c6fd2fd078fd",
  "templateGitBlob": "996be22806afb8fc1eecc11432d8b9ac64548dd2",
  "approvedBy": "EagleFox31",
  "approvedAt": "<UTC time of approval>",
  "expiresAt": "<UTC time less than 24 hours after approval>"
}
```

**Do not commit this marker until explicit consent has been given**.
The timestamped, account-bound approval is short-lived and scoped to exactly
one IAM Free Plan read role. On merge into `main`, GitHub Actions triggers
`.github/workflows/approved-precis-iam-dispatch.yml`:

1. Fail closed unless the exact approval marker is the **only** file changed
   in the push range, and the push is owner-origin on AppFactory main.
2. Verify account/role/template identity and approval TTL (max 24 hours).
3. Use the short-lived repo `GITHUB_TOKEN` with Actions write permission
   to dispatch the existing `appfactory-precis-staging-iam.yml` workflow,
   passing its existing explicit apply flag and confirmation phrase.
4. The preexisting AWS workflow (not the dispatcher) independently checks
   actual STS/Free Plan account, pinned Précis template and CloudFormation
   validation, creates a change set with the isolated service role, verifies
   **exactly one IAM role addition** and executes.
5. Verify the resulting output ARN and record the GitHub Actions log.
   An existing stack is rejected by the first-install-only workflow.

Only the **repository-approved GitOps marker** starts this workflow.
Ordinary PRs, releases, CI pushes and AppFactory code changes cannot
accidentally dispatch an IAM creation. A later rerun remains safely blocked
by the existing-stack guard.

The central staging IAM role can **only** work with the bounded Précis reader
role, not EC2/SSM or Atelier Maître. This workflow does not deploy applications
or create any paid infrastructure. Further EC2/SSM planning will require a
different reviewed policy and approval.

## Security limitations

GitHub's auto-created `staging` environment may not have reviewer protection.
The current pilot GitOps gate therefore requires a precisely scoped owner push
and a one-file, short-lived approval commit instead of claiming an unconfigured
GitHub environment supplies independent approval. This does **not** replace a
long-term GitHub branch protection and review policy for more privileged AWS
provisioning. Before permitting an EC2/SSM deployer, require verified
environment/branch protection and a stronger separate approval mechanism.

The dispatcher itself makes **zero AWS API calls**. It only schedules a
separately reviewed and already-implemented IAM-only workflow. The approval
marker is deliberately absent until the user explicitly authorizes the IAM
creation.
