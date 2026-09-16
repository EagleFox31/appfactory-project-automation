# RAIDER Contract Test Strategy

Repository Governance is accepted only when its own behavior and AppFactory's established capabilities pass the same `npm test` command. A feature-specific green suite cannot override a Project or release regression.

## Executable contract

The representative consumer matrix lives in `test/fixtures/raider-consumers.json`. It deliberately varies:

- personal and organization ownership;
- `main`, `master`, `trunk` and an arbitrary default-branch name;
- repositories with no CI, one custom check and multiple custom checks;
- repository identities unrelated to AppFactory's maintainer or product repositories.

`test/governance-raider-contract.test.mjs` applies the same public governance execution path to every fixture. It proves that plan and apply calculate the same payload, symbolic default-branch targeting remains repository-agnostic, the first apply performs one write and every converged apply performs zero writes.

The brownfield fixture combines classic branch protection, an unrelated manual Ruleset and a drifted AppFactory Ruleset. Only the AppFactory Ruleset ID may receive an update. Manual state must remain byte-for-byte equivalent, and the second apply must be a no-op.

The legacy fixture proves that an existing `project-config.json` without Repository Governance still validates unchanged and normalizes governance to disabled. Policy V1 also rejects a silently substituted future contract version.

## Coverage map

- **Reusable and agnostic:** consumer matrix in `governance-raider-contract.test.mjs`.
- **Idempotent:** explicit write-count assertions in the RAIDER suite and retry coverage in `governance-ruleset.test.mjs`.
- **Durable / non-regressive:** legacy fixture, `lib.test.mjs`, `action-contract.test.mjs`, `reusable-release-workflows.test.mjs` and `self-release-workflow.test.mjs`.
- **Engineering-grade:** independent policy, REST transport, preflight, planning, reconciliation and execution suites; credential failures are covered by `governance-preflight.test.mjs`.
- **Retroactive:** brownfield contract tests plus manual-protection diagnostics in `governance-execution.test.mjs`.
- **Failure memory:** prevention tests derived from lessons in `docs/engineering/lessons-learned.md` run through the same suite.

## CI gate

The repository's existing CI workflow runs `npm test` on every pull request and push to `main`. New tests are discovered automatically by Node's test runner; no separate governance-only command exists that could pass while legacy behavior is broken.

An intentional incompatible governance change must increment the policy contract version and update its fixtures explicitly. Changing fixture expectations without a documented version transition is not an acceptable way to make a regression green.
