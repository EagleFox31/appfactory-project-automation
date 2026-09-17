# AgenStart Repository Governance V1 validation

**Status: PASS**  
**Consumer:** `EagleFox31/AgenStart`  
**AppFactory candidate:** `b1631349800f85a29dc2948391745e2fc67c1eb6`  
**Managed Ruleset:** `23570327` — `AppFactory default branch governance`

This report records the primary live-consumer validation required by issue #24. AgenStart remained a consumer rather than a design dependency: AppFactory core received no repository, owner, branch, workflow or product-specific conditional.

## Baseline

Before governance adoption, AgenStart used AppFactory Project automation and reusable release workflows, had no repository Ruleset, used `main` as its default branch and had `v0.3.0` as its latest published release. Existing Project, build and release runs were successful.

The governance workflow used the separate `APPFACTORY_GOVERNANCE_TOKEN`; existing `PROJECT_TOKEN` and `AGENSTART_RELEASE_TOKEN` responsibilities remained unchanged.

## Failure discovered by the live boundary

The first live plan exposed a platform-input defect that unit tests had approximated incorrectly. GitHub emitted `INPUT_GOVERNANCE-MODE`, while the entry point read `INPUT_GOVERNANCE_MODE`; execution therefore defaulted to Project mode and requested the unrelated Project token.

AppFactory PR #36 centralized Action input resolution, added literal GitHub runtime-name tests and recorded `LESSON-2026-006`. The failed attempts stopped before governance preflight and left AgenStart with zero Rulesets.

## Convergence evidence

- [Plan run `35164260192`](https://github.com/EagleFox31/AgenStart/actions/runs/35164260192) reported one `CREATE`, targeted `~DEFAULT_BRANCH`, preserved `main`, detected no classic protection and performed zero writes. The repository still exposed zero Rulesets afterward.
- [First apply run `35164480545`](https://github.com/EagleFox31/AgenStart/actions/runs/35164480545) created exactly one managed Ruleset with ID `23570327`.
- The Ruleset prevents deletion and non-fast-forward updates, requires pull requests and resolved review threads, requires zero approvals for the solo maintainer and retains merge, squash and rebase methods.
- [Second apply run `35164629329`](https://github.com/EagleFox31/AgenStart/actions/runs/35164629329) reported `NO-OP` and performed no write. The Ruleset ID and update timestamp remained unchanged.

## Non-regression evidence

- Controlled AgenStart issue #69 triggered Project automation successfully.
- Controlled AgenStart PR #70 merged through the protected default branch, closed issue #69 and triggered successful Project transitions for PR merge and issue close.
- The AgenStart release workflow remained successful after governance activation.
- Release Please continued to maintain its release PR without merging or publishing it automatically.
- The latest published release remained `v0.3.0`.

## Drift repair evidence

A controlled external edit changed only `required_approving_review_count` from `0` to `1` inside Ruleset `23570327`.

- [Repair run `35186267729`](https://github.com/EagleFox31/AgenStart/actions/runs/35186267729) reported `UPDATE`.
- The human-readable diff contained one change: `Required approving reviews: 1 -> 0`.
- Reconciliation updated Ruleset `23570327` in place; it did not create a second Ruleset.
- [Final plan run `35186516718`](https://github.com/EagleFox31/AgenStart/actions/runs/35186516718) reported `NO-OP` / `No changes`.

After convergence, AgenStart still had one managed Ruleset, default branch `main`, no classic protection, the pre-existing product issue, the unmerged release PR and the same published release baseline. Automatic merges remained disabled.

## Acceptance result

- first plan accurately described intended changes and wrote nothing;
- first apply created exactly one AppFactory-managed Ruleset;
- existing Project and release automation remained operational;
- the controlled issue/PR lifecycle completed successfully;
- the second apply was a no-op;
- controlled managed drift was repaired minimally without recreation;
- unrelated observed repository state remained intact;
- AppFactory core stayed consumer-agnostic;
- the discovered platform-boundary failure became a generic adapter, tests and failure-memory lesson.

Continuous self-healing triggers are tracked separately in issue #37. They do not change the V1 reconciliation result: manual and future scheduled invocations use the same convergent execution path.
