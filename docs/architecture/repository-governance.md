# Repository Governance architecture

Repository Governance extends AppFactory with declarative, convergent protection for a repository's default branch. It follows the cross-project RAIDER Engineering Standard through the local [RAIDER review checklist](../engineering/raider-review-checklist.md) and [failure memory](../engineering/lessons-learned.md).

## Status

The configuration, policy-normalization, GitHub REST transport and idempotent reconciliation core are implemented as independent modules. Remote mutation remains disabled in the public Action entry point until permission preflight and plan/apply orchestration are complete and tested.

## Module boundaries

```text
consumer config
      |
      v
policy normalization (pure)
      |
      v
desired governance state
      |
      +----> plan / diff (pure)
      |
      v
reconciliation orchestration
      |
      v
GitHub REST transport (injected)
```

- **Policy** owns presets, validation, defaults and canonical desired state. It must not perform network calls.
- **Planning/reconciliation** compares desired and observed state and selects `create`, `update` or `no-op`. It must be testable with fixtures.
- **Transport** owns GitHub REST request/response details and authentication. It must not decide policy.
- **Orchestration** runs preflight before mutation and keeps `plan` and `apply` on the same desired-state calculation.

Current modules:

- `src/governance/policy.mjs` — consumer config validation and canonical policy;
- `src/governance/ruleset.mjs` — policy-to-GitHub projection, canonical comparison and ownership lookup;
- `src/governance/reconcile.mjs` — create/update/no-op orchestration against an injected client;
- `src/github/rest-client.mjs` — paginated GitHub Rulesets REST transport.

The transport pins GitHub REST API version `2026-03-10`, injects authentication and `fetch`, paginates repository rulesets, and returns actionable HTTP errors without including token material.

This separation keeps future PAT, GitHub App or other authentication mechanisms replaceable without changing governance policy.

## Configuration contract

Governance is opt-in. Omitting the section, or setting `enabled` to `false`, normalizes to a disabled no-op and preserves existing consumers.

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

The `solo` preset protects the symbolic GitHub default branch, never a hard-coded branch name. It prevents deletion and force pushes, requires changes to pass through a pull request, requires review threads to be resolved and allows zero approving reviews so a solo maintainer is not locked out.

Expert overrides refine the preset without copying it:

```json
{
  "repository": {
    "governance": {
      "enabled": true,
      "preset": "solo",
      "rulesetName": "Product default branch",
      "pullRequest": {
        "requiredApprovingReviewCount": 1,
        "dismissStaleReviewsOnPush": true
      },
      "requiredStatusChecks": ["build", "test"]
    }
  }
}
```

Supported pull-request overrides are:

- `required`
- `requiredApprovingReviewCount` from `0` to `6`
- `dismissStaleReviewsOnPush`
- `requireCodeOwnerReview`
- `requireLastPushApproval`
- `requiredReviewThreadResolution`

Unknown properties and unsafe values fail validation before any remote operation. Status-check names are trimmed, deduplicated and sorted into stable canonical order. AppFactory never invents a CI check name.

## Managed-state boundary

AppFactory will own only the repository ruleset whose configured stable name matches the normalized policy. It must not delete or rewrite unrelated rulesets or classic branch-protection settings. Existing protections layer with AppFactory governance according to GitHub's ruleset behavior.

The client requests repository-level branch rulesets with `includes_parents=false`. Reconciliation stops before mutation if more than one repository ruleset has the managed name, because guessing ownership could overwrite the wrong policy. A create response lost after GitHub accepts the request is safe to retry: the next inspection resolves the newly created ruleset by stable name and converges without a duplicate.

Disabling governance means AppFactory stops reconciling its policy. Destructive cleanup is not part of the V1 contract.

## Reuse-first decision

The ecosystem reconnaissance for V1 produced this decision:

- **Adopt:** GitHub's first-party Repository Rulesets model and symbolic `~DEFAULT_BRANCH` target.
- **Adapt:** use the platform-native `fetch` available to the Node 24 Action runtime instead of adding a client dependency for the small REST surface.
- **Learn:** follow GitHub's layered-rules behavior and read-before-write API model for brownfield adoption.
- **Build:** keep AppFactory's policy normalization, ownership rules, plan/apply output and reconciliation core local because these are product-specific guarantees not provided by the API itself.

References:

- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Creating rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)
- [Repository rules REST API](https://docs.github.com/en/rest/repos/rules)

## RAIDER verification

- **Reusable:** the policy contains no repository or product identity.
- **Agnostic:** the target is `~DEFAULT_BRANCH`; checks are consumer-supplied.
- **Idempotent:** normalization is canonical and closed over its own output.
- **Durable:** omitted governance remains a disabled no-op and the full legacy test suite stays green.
- **Engineering-grade:** policy is pure and separate from transport and reconciliation.
- **Retroactive:** current user-managed protections remain outside AppFactory ownership.

Implementation failures and near misses are recorded in [`../engineering/lessons-learned.md`](../engineering/lessons-learned.md).
