# Repository Governance Quick Start

This guide protects a repository's default branch with AppFactory without requiring knowledge of GitHub's Rulesets API. It works for new repositories and repositories that already contain code, pull requests or manual protection.

AppFactory manages one named GitHub Ruleset. It does not rename the default branch, edit workflows, close pull requests, replace classic branch protection or modify unrelated Rulesets.

## Five-minute setup

### 1. Add the minimal configuration

Create `.github/project-config.json` in the repository:

```json
{
  "repository": {
    "governance": {
      "enabled": true,
      "preset": "solo"
    }
  }
}
```

The tested copy is available at [`examples/repository-governance-config.json`](../examples/repository-governance-config.json). No GitHub Project configuration is required for a governance-only workflow.

### 2. Create the dedicated secret

The default setup below preserves the existing fine-grained PAT path. For short-lived, zero-PAT authentication, follow [GitHub App onboarding](github-app-onboarding.md) and use the dedicated GitHub App workflow example instead.

Create a fine-grained GitHub token for the account or organization that owns the target repository:

1. Select only the repository being governed.
2. Under **Repository permissions**, grant **Administration: Read and write**.
3. Complete organization approval if the owner requires it.
4. In the target repository, open **Settings → Secrets and variables → Actions**.
5. Create a repository secret named `APPFACTORY_GOVERNANCE_TOKEN` containing the token.

This credential is used only by governance. A separate Project token is not required for the governance-only workflow. Never put the token value in JSON, workflow YAML, logs or repository variables.

### 3. Add the workflow

Copy [`examples/repository-governance.yml`](../examples/repository-governance.yml) to `.github/workflows/repository-governance.yml`.

The workflow is manual by design. It checks out the repository's actual default branch, whether that branch is named `main`, `master`, `trunk` or something else.

### 4. Run `plan`

Open **Actions → Repository governance → Run workflow**, keep `governance_mode` set to `plan`, then run it.

`plan` is read-only. Review:

- whether AppFactory intends to create, update or leave its Ruleset unchanged;
- the detected default branch;
- existing classic branch protection;
- unrelated Rulesets that will be preserved;
- warnings about reviews, status checks or other layered requirements.

Do not continue to `apply` until the output matches the intended policy.

### 5. Run `apply`, then verify convergence

Run the workflow again with `governance_mode` set to `apply`. After it succeeds, run `plan` once more. The expected result is `NO-OP` / `No changes`.

Repeated runs are intentional and safe: AppFactory reads current state, creates or updates only its managed Ruleset, then converges to no additional write.

## Enable continuous reconciliation after approval

The manual workflow remains the onboarding and diagnostic path. After the first `plan`, reviewed `apply` and converged final `plan`, a consumer can explicitly opt into self-healing governance by replacing the manual example with [`examples/repository-governance-continuous.yml`](../examples/repository-governance-continuous.yml) at `.github/workflows/repository-governance.yml`.

The continuous workflow keeps manual `plan` / `apply` available and adds two trusted automatic paths:

- a merge that changes `.github/project-config.json` or the governance workflow on the default branch reconciles the approved policy immediately;
- a daily run at **03:17 UTC** repairs out-of-band drift made through GitHub settings or the API.

Pushes to non-default branches are skipped before the reusable workflow receives the governance secret. Scheduled and configuration-change runs always use `apply`; manual runs retain the explicit `plan` / `apply` choice. The shared reusable workflow checks out the trusted default branch and serializes execution with the same repository-scoped concurrency group, so two governance writes cannot race.

Continuous execution still enters only the governance path: Project automation is not called, no pull request is merged and no release is created. Policy changes must first pass through the repository's protected pull-request flow before the default-branch push can reconcile them.

The scheduled run also acts as credential monitoring. If the fine-grained token expires or is revoked, the workflow fails visibly in GitHub Actions without printing the credential. Rotate the token before its expiry and update only `APPFACTORY_GOVERNANCE_TOKEN`; the workflow and policy do not need to change.

With GitHub App authentication, each run creates a repository-scoped installation token that expires after one hour and is revoked when the job completes. The schedule then monitors App installation, permission and private-key validity instead of PAT expiry.

## What the `solo` preset means

In plain language, `solo`:

- targets GitHub's symbolic default branch rather than assuming a branch name;
- prevents deletion of that branch;
- prevents force pushes;
- requires changes to go through a pull request;
- requires review conversations to be resolved;
- requires zero approving reviewers, so a solo maintainer is not locked out;
- requires no CI check unless one is explicitly configured.

It does not automatically merge pull requests and never creates a release.

## Adopting an existing repository

Use the same five steps. Do not delete current protection first.

During `plan`, AppFactory inventories repository-owned Rulesets and classic protection on the actual default branch. GitHub layers all applicable protections and enforces the most restrictive result. For example, if classic protection already requires two approvals while `solo` requires zero, the effective repository policy still requires two approvals. AppFactory reports that difference and leaves the classic rule untouched.

An `apply` run may change whether existing open pull requests are mergeable because the new Ruleset becomes active. It does not edit those pull requests. Review the plan's required checks and review requirements before applying it to a busy repository.

If AppFactory finds two repository Rulesets with its configured managed name, it stops instead of guessing which one it owns. Rename or remove the duplicate manually, run `plan` again, and only then apply.

## Adding required CI checks

The beginner setup deliberately requires no CI. When the repository already has stable checks, add their exact GitHub check contexts:

```json
{
  "repository": {
    "governance": {
      "enabled": true,
      "preset": "solo",
      "requiredStatusChecks": [
        "quality / verify",
        "package (linux-x64)"
      ]
    }
  }
}
```

Copy the names from a completed pull request's **Checks** tab; do not guess from the workflow filename. A required name that no workflow produces can leave pull requests waiting forever. AppFactory trims, deduplicates and sorts configured names so repeated runs remain stable.

## Advanced overrides

Only add overrides after the minimal setup works:

```json
{
  "repository": {
    "governance": {
      "enabled": true,
      "preset": "solo",
      "rulesetName": "Product default branch",
      "pullRequest": {
        "requiredApprovingReviewCount": 1,
        "dismissStaleReviewsOnPush": true,
        "requireCodeOwnerReview": true
      },
      "requiredStatusChecks": ["quality / verify"]
    }
  }
}
```

All supported fields and the policy model are documented in [Repository Governance architecture](architecture/repository-governance.md).

## Safe disable behavior

Set `repository.governance.enabled` to `false` through the protected pull-request flow. With the manual workflow, run `plan` to confirm governance is disabled. With continuous reconciliation enabled, merging that config change triggers a disabled no-op; remove or disable the continuous workflow afterward if scheduled checks should also stop.

Disabling means **AppFactory stops reconciling future state**. It does not delete the managed Ruleset, classic branch protection or unrelated Rulesets. If the managed Ruleset itself must be removed, review and perform that separate destructive action manually in GitHub settings.

## Troubleshooting

### Missing governance token

Confirm that the secret is named exactly `APPFACTORY_GOVERNANCE_TOKEN` and that the workflow passes it to `governance-token`.

### Invalid or expired credential

Generate a replacement fine-grained token, update the Actions secret and rerun `plan`. AppFactory never prints the submitted token.

For GitHub App authentication, confirm that the App is still installed on the repository, `APPFACTORY_APP_CLIENT_ID` matches the App, and `APPFACTORY_APP_PRIVATE_KEY` contains an active complete PEM key.

### Repository not visible

Edit the token's repository access and select the target repository. For organization repositories, confirm that the organization approved the token.

### Administration permission required or forbidden

Grant **Administration: Read and write** on the target repository. Metadata or contents access alone is not enough to manage Rulesets.

### Pull request is waiting for a check that never runs

Compare `requiredStatusChecks` with the exact names shown on a recent pull request. Correct or remove stale contexts, run `plan`, review the diff, then run `apply`.

### Plan reports stricter existing protection

This is expected on a brownfield repository. AppFactory preserves manual protection and GitHub layers it with the managed Ruleset. Change the stricter rule manually at its source only if that is genuinely the desired policy; AppFactory will not silently weaken it.

### Plan reports duplicate managed Rulesets

AppFactory refuses to choose between identical managed names. Inspect the repository's Rulesets in GitHub settings, keep or rename the intended one, and rerun `plan`.

For platform-specific token and secret instructions, see GitHub's documentation for [fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) and [Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).
