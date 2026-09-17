# Repository Governance architecture

Repository Governance extends AppFactory with declarative, convergent protection for a repository's default branch. It follows the cross-project RAIDER Engineering Standard through the local [RAIDER review checklist](../engineering/raider-review-checklist.md) and [failure memory](../engineering/lessons-learned.md).

## Status

The configuration, policy normalization, GitHub REST transport, permission preflight and explicit plan/apply orchestration are implemented as independent modules. Governance execution is off by default; plan performs zero mutation and apply reconciles only the AppFactory-owned Ruleset.

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
- `src/governance/plan.mjs` — read-only discovery, create/update/no-op planning and human-readable diff output;
- `src/governance/reconcile.mjs` — application of an already calculated plan against an injected client;
- `src/governance/preflight.mjs` — dedicated credential validation, repository visibility and effective admin-capability checks;
- `src/governance/execution.mjs` — safe `off`, `plan` and `apply` runtime orchestration;
- `src/github/rest-client.mjs` — paginated GitHub Rulesets REST transport.

The transport pins GitHub REST API version `2026-03-10`, injects authentication and `fetch`, paginates repository rulesets, and returns actionable HTTP errors without including token material.

This separation keeps PAT, GitHub App or other authentication mechanisms replaceable without changing governance policy. The reusable workflow may mint a short-lived GitHub App installation token, but the engine and REST transport continue to receive only an opaque token.

## Contract and versioning boundaries

Repository Governance exposes a small public contract and keeps GitHub payload details internal:

- **Public Action contract:** `governance-token`, `governance-mode` and `config-path` in `action.yml`. Existing inputs remain backward compatible within the `v1` major line.
- **Public configuration contract:** the declarative `repository.governance` object. `policyVersion` identifies its normalized behavior; V1 rejects unsupported versions before any remote operation.
- **Public operational contract:** `off`, `plan` and `apply`. `plan` is read-only, while `apply` consumes the exact desired payload calculated by the same planner.
- **Private implementation contract:** REST paths, GitHub response shapes and module layout under `src/`. Consumers never configure or depend on them.

Authentication is injected into the transport factory. Replacing a fine-grained PAT with a GitHub App token does not change policy normalization, planning or reconciliation. Internal modules may evolve inside the major version as long as the public Action, configuration and operational contracts remain compatible.

The executable architecture contract in `test/governance-architecture-contract.test.mjs` prevents pure policy modules from acquiring network or environment dependencies, prevents governance from importing Project automation internals, and keeps credential handling inside the injected REST transport.

## Credential and preflight contract

Project automation and repository governance have separate credentials:

- `token` remains the existing Project-capable credential and is required only when `governance-mode` is `off` and Project automation runs;
- `governance-token` is optional while governance is omitted or disabled;
- once governance is enabled, `governance-token` is required and never falls back to the Project token;
- the governance credential must select the target repository and grant repository **Administration: write** permission.

The public Action performs a read-only governance preflight before any governance discovery or mutation when `governance-mode` is explicitly set to `plan` or `apply`. It verifies that the credential resolves the exact runtime repository, that administrative capability is established by the provider boundary or GitHub repository metadata, and that repository rulesets can be enumerated. Missing, expired, forbidden and repository-selection failures produce separate remediation messages. The token is injected into the REST transport only; it is never returned, logged or added to diagnostic output.

GitHub's list/get Rulesets endpoints require only Metadata read permission, so their success alone is not accepted as proof of administrative capability. PAT-backed runs check the authenticated repository permission exposed by GitHub. GitHub App installation tokens do not expose that user-role-shaped `permissions.admin` signal consistently; for those runs, `actions/create-github-app-token` proves the capability by successfully narrowing the repository-scoped token to `permission-administration: write`, and the reusable workflow passes a non-secret capability attestation to the Action. Create/update endpoints remain the final authority for the token's fine-grained write scope; any later authorization failure must still be translated into the same actionable permission guidance rather than exposed as a raw API error.

Example consumer mapping:

```yaml
- uses: EagleFox31/appfactory-project-automation@v1
  with:
    governance-token: ${{ secrets.APPFACTORY_GOVERNANCE_TOKEN }}
    governance-mode: plan
```

Consumers that also run Project automation continue to pass `token` in their separate Project workflow. Governance never falls back to that credential.

The reusable workflow adds a provider boundary above the Action:

- `authentication: token` passes the existing dedicated PAT secret;
- `authentication: github-app` creates a repository-scoped installation token with `Administration: write`, passes that token to the same Action input and attests that GitHub validated the requested capability.

The GitHub App client ID and private key are workflow-layer concerns. They must not enter configuration JSON, the REST client, policy normalization or reconciliation. This preserves authentication-provider agnosticity while allowing PAT-backed repositories to migrate without changing desired state or managed resource identity. See [GitHub App onboarding](../github-app-onboarding.md).

For a user-owned repository, the token owner must have admin access to that repository. For an organization-owned repository, the token owner must have an admin-capable organization/repository role, the organization must approve the credential when its policy requires approval, and the repository must be selected for the fine-grained token.

## Execution contract

Governance execution is explicit and isolated from normal Project synchronization:

- `governance-mode: off` is the backward-compatible default and runs only existing Project automation;
- `governance-mode: plan` performs credential preflight and repository discovery, then prints the intended `create`, `update` or `no-op` decision without calling a write endpoint;
- `governance-mode: apply` performs the same preflight and calculates the same plan, then applies that exact desired payload;
- plan/apply invocations do not run Project bootstrap or Issue/PR lifecycle mutations in the same Action execution.

The plan names the target repository, the AppFactory-managed Ruleset, the symbolic default-branch target, relevant setting changes and the number of unrelated Rulesets that will be preserved. A converged repository reports `No changes`.

```yaml
- uses: EagleFox31/appfactory-project-automation@v1
  with:
    governance-token: ${{ secrets.APPFACTORY_GOVERNANCE_TOKEN }}
    governance-mode: ${{ inputs.governance_mode }}
```

A safe operating sequence is: run `plan`, review the output, then run `apply`. After any failed apply, running `plan` again recalculates current state before another write attempt.

### Continuous reconciliation contract

Continuous governance is a trigger-layer opt-in, not a hidden change to the Action default. Existing consumers remain on `governance-mode: off` or their manual workflow until they deliberately install the continuous caller.

- `.github/workflows/reusable-repository-governance.yml` owns trusted default-branch checkout, dedicated secret injection, timeout and repository-scoped concurrency. It defaults the runtime to `v1` and accepts an immutable `appfactory_ref` solely so pre-release candidates can be validated without publishing first.
- `examples/repository-governance-continuous.yml` owns the consumer's explicit events: manual diagnostics, default-branch configuration changes and a UTC schedule.
- non-manual events pass `apply`; manual dispatch preserves the `plan` / `apply` choice.
- a push job proceeds only when `github.ref_name` equals the repository's reported default branch, preventing feature-branch workflow changes from receiving the governance secret.
- the Action's existing mutually exclusive execution routing guarantees that an automatic governance call cannot enter Project automation or release workflows.

The scheduled path is intentionally convergent: healthy repositories report a no-op, while drift in the AppFactory-owned Ruleset is repaired in place. Unrelated Rulesets and classic protection remain read-only inventory. Workflow failures are surfaced by GitHub Actions and never trigger a merge or release.

## Configuration contract

Governance is opt-in. Omitting the section, or setting `enabled` to `false`, normalizes to a disabled no-op and preserves existing consumers. In `plan` or `apply` mode, a governance-only config may contain only the `repository.governance` object. Project fields and the Project credential remain mandatory when `governance-mode` is `off` and the existing Project automation path runs.

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

### Required status checks

Required checks are entirely consumer-defined. The `solo` preset defaults to an empty `requiredStatusChecks` array, so repositories without CI remain governable and AppFactory does not add a `required_status_checks` rule.

Each entry must be the exact check context reported on a commit. Do not use the workflow filename or guess a generic name such as `CI` or `test`. To discover the contexts already produced by a repository:

1. Run the relevant workflow on a pull request at least once.
2. Open the pull request's **Checks** tab and note the exact check-run names.
3. When verification through the API is useful, replace `OWNER`, `REPO` and `SHA` below and inspect both Checks and legacy commit-status contexts:

   ```bash
   gh api repos/OWNER/REPO/commits/SHA/check-runs \
     --jq '.check_runs[].name'
   gh api repos/OWNER/REPO/commits/SHA/status \
     --jq '.statuses[].context'
   ```

4. Copy only the contexts that must block merging into `requiredStatusChecks`, then run governance in `plan` mode before applying it.

Check contexts are case-sensitive operational identifiers. If a workflow job is renamed, update the consumer configuration before applying governance again; requiring a context that no workflow produces can leave pull requests waiting indefinitely. Adding or removing contexts updates the existing AppFactory-managed Ruleset in place. Reordering entries or repeating the same entry produces no drift because normalization trims, deduplicates and sorts the list.

V1 deliberately requires explicit configuration instead of automatic discovery. This keeps the engine independent of CI provider, workflow language and repository stack while leaving assisted discovery as a future enhancement.

## Managed-state boundary

AppFactory will own only the repository ruleset whose configured stable name matches the normalized policy. It must not delete or rewrite unrelated rulesets or classic branch-protection settings. Existing protections layer with AppFactory governance according to GitHub's ruleset behavior.

The client requests repository-level branch rulesets with `includes_parents=false`. Reconciliation stops before mutation if more than one repository ruleset has the managed name, because guessing ownership could overwrite the wrong policy. A create response lost after GitHub accepts the request is safe to retry: the next inspection resolves the newly created ruleset by stable name and converges without a duplicate.

Disabling governance means AppFactory stops reconciling its policy. Destructive cleanup is not part of the V1 contract.

## Brownfield adoption contract

Governance does not assume an empty repository. Before calculating a plan, AppFactory reads the repository's actual default branch, repository-owned branch Rulesets and classic protection for that default branch. A missing classic-protection resource is treated as an unprotected branch; other API failures stop execution before a write.

The discovered state is classified into three ownership zones:

- the Ruleset with the configured AppFactory name is managed and may be created or updated;
- every other repository Ruleset is named in the plan and preserved;
- classic branch protection is read-only to AppFactory V1 and is always preserved.

GitHub aggregates applicable Rulesets and classic branch protection. When the classic layer disagrees with AppFactory on approving reviews, required checks, force pushes or deletion, the plan reports the difference and states that the more restrictive effective policy wins. It also reports manual-only requirements such as signed commits, linear history, branch locks, push restrictions and administrator enforcement. These findings are diagnostics, not permission to rewrite the manual layer.

Brownfield adoption never renames or recreates the default branch, changes repository settings, edits workflows, or mutates open pull requests. Newly active GitHub protections can still affect whether an already-open pull request is mergeable, so existing repositories should always run `plan` and review the layered findings before `apply`.

Conflicts AppFactory will not reconcile automatically in V1 include:

- multiple repository Rulesets sharing the configured managed name — execution stops because ownership is ambiguous;
- stricter classic or unrelated Ruleset requirements — they remain effective and must be changed manually at their source if unwanted;
- classic required checks that no current workflow produces — AppFactory reports the contexts but does not remove them;
- organization-level Rulesets — they remain outside repository-owned state and continue to layer according to GitHub.

Re-enabling governance after manual drift updates only the existing AppFactory Ruleset by ID and preserves all other discovered state. Repeated adoption converges to `no-op`. Setting governance to disabled performs no discovery or cleanup: AppFactory simply stops managing future state, and every existing protection remains in GitHub.

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
- [Protected branches REST API](https://docs.github.com/en/rest/branches/branch-protection)

## RAIDER verification

- **Reusable:** the policy contains no repository or product identity.
- **Agnostic:** the target is `~DEFAULT_BRANCH`; checks are consumer-supplied.
- **Idempotent:** normalization is canonical and closed over its own output.
- **Durable:** omitted governance remains a disabled no-op and the full legacy test suite stays green.
- **Engineering-grade:** policy is pure and separate from transport and reconciliation.
- **Retroactive:** current user-managed protections remain outside AppFactory ownership.

The executable consumer matrix, brownfield fixture and non-regression coverage map are documented in [RAIDER Contract Test Strategy](../testing/raider-contract.md).

Implementation failures and near misses are recorded in [`../engineering/lessons-learned.md`](../engineering/lessons-learned.md).

## Issue #26 acceptance evidence

- transport, policy, discovery, planning, reconciliation, preflight and execution are separate modules;
- desired-state and canonical comparison functions run without live GitHub access;
- consumer configuration contains product intent rather than REST payload shapes;
- the RAIDER consumer fixture matrix exercises different owners, branches, stacks and check contexts without source changes;
- credentials and `fetch` are injected only through the REST client factory;
- Action inputs and configuration version behavior are covered by contract tests;
- credential, permission, visibility and ownership failures include remediation guidance;
- the shared RAIDER review checklist is mandatory for future AppFactory capability work.
