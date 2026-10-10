# Impact-Aware CI

AppFactory Impact-Aware CI implements the RAIDER **Change-Impact-Driven CI/CD** principle:

```text
changed paths → impacted surfaces → required gates → selective execution
```

The goal is to keep the execution radius of CI/CD proportional to the actual impact radius of a change. A landing-only change should not rebuild a desktop binary; a documentation-only change should not publish a release; a shared contract change may legitimately fan out to several dependent surfaces.

## Consumer contract

A repository owns one declarative file, normally:

```text
.github/appfactory-impact.json
```

The reusable AppFactory workflow reads that file and exposes JSON outputs that downstream jobs can use.

Example:

```json
{
  "version": 1,
  "fallback": "all",
  "ignorePaths": ["README.md", "docs/**"],
  "surfaces": {
    "shared-contracts": {
      "paths": ["packages/contracts/**"],
      "gates": []
    },
    "landing": {
      "paths": ["apps/landing/**"],
      "gates": ["landing-ci", "pages"]
    },
    "desktop": {
      "paths": ["src/**", "src-tauri/**"],
      "gates": ["frontend", "rust", "security", "windows-installer"],
      "dependsOn": ["shared-contracts"]
    },
    "release": {
      "paths": [".release-please-manifest.json", "scripts/release/**"],
      "gates": ["product-release"],
      "dependsOn": ["desktop"]
    }
  }
}
```

### Fields

- `version`: currently `1`.
- `fallback`: `all` or `none`. The recommended default is `all` so an unknown path fails safe by running every configured surface instead of silently skipping validation.
- `ignorePaths`: paths intentionally allowed to produce no product gates when they do not match a surface.
- `surfaces.<name>.paths`: glob patterns owned by that surface.
- `surfaces.<name>.gates`: logical gate names consumed by the repository workflow.
- `surfaces.<name>.dependsOn`: other surfaces whose changes can affect this surface.

Dependencies are propagated transitively. If `desktop` depends on `shared-contracts`, a shared contract change impacts both surfaces.

## Reusable workflow

Call:

```yaml
jobs:
  impact:
    uses: EagleFox31/appfactory-project-automation/.github/workflows/reusable-impact-analysis.yml@<reviewed-sha>
    with:
      appfactory_ref: <same-reviewed-sha>
      config_path: .github/appfactory-impact.json
      checkout_ref: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || '' }}
```

The workflow exposes:

- `surfaces`: JSON array of impacted surfaces;
- `gates`: JSON array of required logical gates;
- `changed_files_count`: number of changed files in the computed diff;
- `fallback_applied`: whether safe fallback-to-all was used;
- `analysis`: full compact JSON payload for diagnostics.

A downstream job can then use:

```yaml
if: ${{ contains(fromJSON(needs.impact.outputs.gates), 'rust') }}
```

The workflow computes pull-request and push ranges from the GitHub event. When a reliable range is unavailable, it deliberately fans out to all configured surfaces. Manual runs should normally set `mode: all`.

For chained workflows such as `workflow_run`, pass `checkout_ref` when the impact policy itself must come from the same immutable revision that was validated. A typical deployment caller passes the completed CI run's `head_sha` as both `checkout_ref` and `head_sha`, together with the matching comparison `base_sha`. When `checkout_ref` is omitted, existing event-based checkout behavior is unchanged.

## Why a dispatcher instead of copied path filters

GitHub `paths:` filters remain useful as a coarse first barrier, but duplicating them across many workflows causes configuration drift. The AppFactory pattern keeps the product-impact policy in one file and makes jobs depend on one analysis result.

A repository can still retain separate reusable workflows for implementation details. The dispatcher decides **which** gates are required; each gate keeps responsibility for **how** its work is performed.

## Security boundary

The reusable workflow needs only `contents: read`. It checks out the consumer repository and a reviewed AppFactory runtime.

Do not run untrusted pull-request code with privileged secrets merely because an impact gate selected a job. Impact analysis decides relevance; it does not relax the normal GitHub Actions trust boundary. Workflows using `pull_request_target` must keep configuration and executable code on a trusted ref.

## Brownfield adoption

For an existing repository:

1. inventory current workflows and deployable surfaces;
2. create `.github/appfactory-impact.json`;
3. give every existing expensive job a logical gate;
4. add one impact-analysis job;
5. guard heavy jobs with the returned gates;
6. keep current path filters during migration if they provide a useful coarse barrier;
7. validate one narrow change and one cross-surface change before removing redundant triggers.

The first consumer should be validated against a real repository before the capability is promoted to a stable AppFactory major alias.

## RAIDER Proof of Done

- a surface-only change does not wake unrelated gates;
- shared dependencies propagate to every declared dependent surface;
- unmatched changes fail safe by default;
- intentional no-op paths are explicit;
- manual full validation remains possible;
- the impact engine is deterministic and zero-dependency;
- existing consumer build/test/deploy logic remains owned by the consumer or its reusable workflow.

## Rendered frontend QA integration

A consumer can add `visual-qa` to the frontend surface's gate list and call `reusable-visual-qa.yml` only when the existing impact-analysis output includes that gate. This is **selective execution**, not a second path-analysis engine. See [the Visual QA runbook](reusable-visual-qa.md), [impact configuration](../examples/visual-qa-impact.json) and [caller workflow](../examples/visual-qa-impact-aware-ci.yml). This unprivileged job renders local desktop/mobile screenshots and checks axe, keyboard, reduced motion, media errors and Lighthouse budgets without deploying a product.
