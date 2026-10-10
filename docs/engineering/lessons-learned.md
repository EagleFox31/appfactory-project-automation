# Engineering Lessons Learned

This is AppFactory's RAIDER failure memory. Record failures and near misses that expose a reusable engineering lesson, meaningful risk or likely source of recurrence. Do not record secrets or sensitive repository data.

Before related work, search this file for known failure modes. If a documented failure repeats, strengthen the prevention instead of copying the previous fix.

## Lessons

### LESSON-2026-014 — GitHub GITHUB_ENV is not available in the same step

- **Date:** 2026-10-10
- **Category:** CI/CD / AWS IaC orchestration / idempotence
- **Status:** prevention-added
- **Related:** issue #75, Précis IAM approval PR #112 and failed AWS run #38008163231

**Context**

The first user-approved, GitOps-triggered IAM-only Précis staging workflow
successfully authenticated using the central OIDC role and created a valid
CloudFormation CREATE change set, then rejected it before execution.

**Failure / near miss**

The workflow set `CHANGESET=...` in `$GITHUB_ENV` and immediately called its
Node validator in the **same step**. The validator refused to run because
`process.env.CHANGESET` was missing. This left the tenant CloudFormation
stack in `REVIEW_IN_PROGRESS` with an unexecuted change set.

**Root cause**

GitHub Actions exposes `$GITHUB_ENV` changes only to **subsequent steps**.
The shell process must also `export CHANGESET=...` for any child process
spawned in the current step. Treating these two channels as interchangeable
created a partial-state failure.

**Resolution**

Export the value for the current step, separately publish it to
`$GITHUB_ENV`, detect the pending exact previously approved change set on
a retry, and validate that its account, IAM service role, permissions
boundary, named IAM capability and **single read-only role ADD** match the
approved template before executing. Never blindly recreate or overwrite
an existing CloudFormation stack.

**Prevention**

Add explicit validator contract tests for both current-run and approved
resume-run execution, wrong account, wrong role, missing boundary and unexpected
stack transitions. Extend workflow tests to assert both `export CHANGESET`
and `echo ... >> "$GITHUB_ENV"`. Full AWS read/write proof remains required:
green unit tests alone are not a proof of actual provisioning.

**Follow-up real AWS evidence, 2026-10-10**

AWS `DescribeChangeSet.RoleARN` was actually `null` for the approved
CREATE change set even though the original GitHub step specified
`create-change-set --role-arn`. The authoritative pending
`DescribeStacks.RoleARN` was the exact approved
`appfactory-staging-iam-cfn-execution` role. A strict guard that checked only
the optional change-set field correctly blocked the run but created an
unnecessary reapproval cycle. The validator must read and require the actual
stack-bound service role; a non-null conflicting change-set role is also
rejected. Tests cover this real platform nullability and keep the
check fail-closed.

**Generalized RAIDER lesson**

Idempotence must cover intermediate IaC states (including
`REVIEW_IN_PROGRESS`), and GitHub Actions' same-step/next-step environment
interfaces must be tested separately. Record and reconcile partial
CloudFormation state, rather than consuming another user authorization or
opening a competing stack.

### LESSON-2026-001 — A canonical normalizer must accept its own output

- **Date:** 2026-09-16
- **Category:** architecture
- **Status:** prevention-added
- **Related:** issue #16

**Context**

The first Repository Governance policy normalizer produced deterministic output from consumer configuration.

**Failure / near miss**

The initial design rejected that canonical output when it was passed through the normalizer again. Two calls with the same raw input matched, but the function was not mathematically idempotent and could fail if normalized policy crossed a module boundary and was normalized defensively.

**Root cause**

Determinism was treated as equivalent to idempotence. Internal canonical fields were not included in the accepted contract.

**Resolution**

The normalizer now recognizes its versioned canonical contract, verifies the fixed enforcement and symbolic default-branch target, and returns equivalent output.

**Prevention**

The governance policy suite asserts `normalize(normalize(input)) === normalize(input)` and rejects partial or altered internal contract fields.

**Generalized lesson**

Every function described as a normalizer should be closed over its canonical output unless a deliberately one-way parser contract is documented.

**Derived principle / standard change**

RAIDER idempotence tests should cover canonical-output re-entry, not only repeated execution with identical raw input.

### LESSON-2026-002 — Read access is not governance authority

- **Date:** 2026-09-16
- **Category:** security
- **Status:** prevention-added
- **Related:** issue #18

**Context**

Repository Governance needs to verify its credential before any Rulesets mutation.

**Failure / near miss**

A successful `GET /repos/{owner}/{repo}/rulesets` looked like a suitable permission probe, but GitHub allows repository Rulesets list/get calls with Metadata read access. A public repository can therefore appear inspectable even when the credential cannot administer it.

**Root cause**

Resource visibility and mutation authority were treated as the same capability.

**Resolution**

Preflight now verifies exact repository identity, effective repository admin capability and Rulesets visibility separately. The dedicated governance credential requires Administration write access, and authorization failures are translated into actionable remediation without exposing the token.

**Prevention**

Tests prove that a readable repository with `permissions.admin !== true` fails before any create/update call, while disabled governance performs no credential or transport work.

**Generalized lesson**

Never use the success of a read endpoint as proof that a credential can perform a related write unless the platform explicitly gives both operations the same permission contract.

**Derived principle / standard change**

RAIDER security preflights must distinguish identity, visibility, effective role and operation-specific permission, and document any platform limit on non-mutating write-scope introspection.

### LESSON-2026-003 — A read-only plan must isolate unrelated mutators

- **Date:** 2026-09-16
- **Category:** safety
- **Status:** prevention-added
- **Related:** issue #19

**Context**

Repository Governance plan mode was added to the same public Action that already manages GitHub Projects.

**Failure / near miss**

Running a governance plan and then continuing through the existing Project bootstrap path would make the overall Action invocation capable of mutation even though the requested governance operation was described as read-only.

**Root cause**

Read-only semantics were initially considered only inside the new Governance module instead of across the complete Action execution boundary.

**Resolution**

Governance execution now has an explicit, backward-compatible `off` default. `plan` and `apply` are isolated from Project bootstrap and lifecycle handling, and plan never calls a Rulesets write endpoint.

**Prevention**

Execution tests assert zero write calls in plan mode, while the Action entry point routes normal Project automation and governance execution through mutually exclusive branches.

**Generalized lesson**

A dry-run guarantee applies to the whole command or workflow invocation, not merely to the newest subsystem inside it.

**Derived principle / standard change**

RAIDER plan modes must inventory and isolate every possible mutator reachable from the public entry point.

### LESSON-2026-004 — Managed-state convergence is not brownfield safety

- **Date:** 2026-09-16
- **Category:** architecture
- **Status:** prevention-added
- **Related:** issue #21

**Context**

Repository Governance already reconciled one named AppFactory Ruleset and preserved every differently named Ruleset.

**Failure / near miss**

That ownership boundary prevented destructive writes, but the plan could still call a brownfield repository safe without inspecting classic protection on its real default branch. GitHub layers both mechanisms, so reviews, checks or locks outside the managed Ruleset could silently make the effective policy stricter than the plan appeared to describe.

**Root cause**

Write isolation was treated as sufficient evidence of adoption safety. Effective platform behavior depends on every protection layer, not only the object AppFactory owns.

**Resolution**

Preflight now discovers the actual default branch, repository-owned Rulesets and classic default-branch protection. The plan identifies preserved state and reports layered differences before apply. Only the AppFactory Ruleset remains writable.

**Prevention**

Fixtures cover greenfield, manually protected and previously AppFactory-managed repositories. Tests verify zero brownfield mutation during plan and in-place convergence after drift.

**Generalized lesson**

Safe brownfield automation requires both a strict write boundary and an inventory of external state that changes the effective outcome.

**Derived principle / standard change**

RAIDER retroactive features must report platform-native layering and conflicts before claiming that adoption is non-destructive.

### LESSON-2026-005 — A separate execution path needs a separate minimum contract

- **Date:** 2026-09-16
- **Category:** usability
- **Status:** prevention-added
- **Related:** issue #23

**Context**

Repository Governance and Project automation already used separate credentials and mutually exclusive runtime paths.

**Failure / near miss**

The public entry point still required a Project token and complete Project configuration before a governance-only `plan` or `apply`, even though that path never used either dependency. A beginner guide would therefore have documented fake prerequisites or produced an example that failed validation.

**Root cause**

Authentication and execution were separated, but input validation still enforced the original product's global minimum contract before selecting the capability being run.

**Resolution**

Project mode retains its existing required token and configuration. Governance `plan`/`apply` accepts a minimal `repository.governance` config and requires only the dedicated governance credential.

**Prevention**

Tests execute the published beginner JSON and workflow contracts, assert that Project mode still requires its credential, and assert that governance-only mode does not.

**Generalized lesson**

When one entry point hosts independent capabilities, validate only the prerequisites reachable from the selected execution path.

**Derived principle / standard change**

RAIDER reusable actions must test capability-specific minimum inputs; documentation must not compensate for accidental cross-capability coupling.

### LESSON-2026-006 — Test the platform's generated input boundary

- **Date:** 2026-09-16
- **Category:** integration
- **Status:** prevention-added
- **Related:** issue #24

**Context**

The first real AgenStart governance `plan` invoked the pre-release AppFactory Action with `governance-mode` and `governance-token` inputs.

**Failure / near miss**

Unit and contract tests passed, but the live Action interpreted the requested mode as `off` and required the unrelated Project token. GitHub exposes a hyphenated input such as `governance-mode` as `INPUT_GOVERNANCE-MODE`; the entry point incorrectly read `INPUT_GOVERNANCE_MODE`.

**Root cause**

Tests modeled a hand-written environment convention instead of the exact environment boundary generated by GitHub Actions. Input access was also duplicated in the entry point, allowing the naming assumption to spread across every hyphenated input.

**Resolution**

All Action inputs now pass through one adapter that prefers GitHub's canonical hyphen-preserving environment name and retains underscore compatibility for local tooling.

**Prevention**

Dedicated tests exercise the real `INPUT_GOVERNANCE-MODE`, `INPUT_GOVERNANCE-TOKEN`, `INPUT_CONFIG-PATH` and `INPUT_ISSUE-NUMBER` names, canonical precedence and compatibility behavior. The public entry-point contract rejects direct use of the incorrect governance environment name.

**Generalized lesson**

An integration boundary is not covered when tests reproduce a convenient approximation of the platform contract. Test the exact names and shapes emitted by the host platform.

**Derived principle / standard change**

RAIDER adapters must centralize platform-generated inputs and include at least one contract test built from the platform's literal runtime representation.

### LESSON-2026-007 — Convergence is not continuous enforcement

- **Date:** 2026-09-17
- **Category:** operations
- **Status:** prevention-added
- **Related:** issue #37

**Context**

Live validation on AgenStart and AgenFetch proved that Repository Governance could detect drift, repair only the AppFactory-owned Ruleset and converge to a no-op.

**Failure / near miss**

Every repair still required an operator to launch `apply`. The reconciliation engine was idempotent, but the operating model was not self-healing and could leave direct GitHub/UI/API drift active indefinitely.

**Root cause**

Engine convergence was treated as equivalent to durable enforcement. No trusted event layer was responsible for deciding when an already approved policy should be reapplied.

**Resolution**

AppFactory now provides an opt-in continuous caller plus a reusable governance workflow. Approved config changes on the default branch reconcile immediately, a scheduled run repairs out-of-band drift, manual plan/apply remains available, and repository-scoped concurrency prevents write races.

**Prevention**

Workflow contract tests assert trusted default-branch gating, scheduled apply, explicit secret flow and isolation from Project automation, pull-request merging and release automation.

**Generalized lesson**

An idempotent reconciler becomes operationally durable only when a safe, observable and explicitly authorized trigger policy runs it.

**Derived principle / standard change**

RAIDER durability reviews must test both convergence behavior and the event model that detects future drift; automatic enforcement must remain opt-in and independently disableable.

### LESSON-2026-008 — Authentication providers belong outside the reconciliation core

- **Date:** 2026-09-17
- **Category:** architecture-security
- **Status:** prevention-added
- **Related:** issue #25

**Context**

Repository Governance originally accepted a dedicated fine-grained PAT. The next onboarding path needed short-lived GitHub App installation tokens without changing policy or managed Ruleset identity.

**Failure / near miss**

Adding App ID, installation lookup and private-key handling to the Action entry point or REST client would have coupled every governance module to one credential provider and made PAT migration a policy change.

**Root cause**

Credential acquisition and credential consumption are different responsibilities. Treating both as generic "authentication" hides the trust boundary and encourages provider-specific state inside the engine.

**Resolution**

The reusable workflow now selects the provider and creates a repository-scoped installation token when requested. The unchanged Action receives only an opaque `governance-token`; policy, planning, reconciliation and transport remain provider-agnostic.

**Prevention**

Contract tests verify explicit provider selection, least-privilege token generation, PAT compatibility and the absence of GitHub App secrets or action references from core modules.

**Generalized lesson**

Acquire credentials at the orchestration edge and inject the narrowest short-lived capability token into the core.

**Derived principle / standard change**

RAIDER agnosticity reviews must reject provider-specific credential material in policy and reconciliation modules; security reviews must verify both installation scope and per-token permission narrowing.

### LESSON-2026-009 — User-role metadata is not a universal token capability signal

- **Date:** 2026-09-17
- **Category:** integration-security
- **Status:** prevention-added
- **Related:** issue #25, AgenStart live validation

**Context**

AgenStart's first live zero-PAT governance run successfully created a repository-scoped GitHub App installation token with `Administration: write`, then failed during AppFactory preflight.

**Failure / near miss**

The workflow rejected a valid least-privilege installation token because `GET /repos/{owner}/{repo}` did not report `permissions.admin: true`. Token creation, repository checkout and authentication had all succeeded.

**Root cause**

The preflight treated user-role-shaped repository metadata as a universal proof of credential capability. GitHub App installation permissions are validated when the token is minted and are not represented consistently by the repository's user-role booleans.

**Resolution**

PAT-backed runs retain the repository admin-role check. The GitHub App workflow now passes a non-secret capability attestation only after `actions/create-github-app-token` successfully narrows the repository-scoped token to `permission-administration: write`; policy, reconciliation and the REST token remain provider-agnostic.

**Prevention**

A regression test models an installation token that can enumerate governance state while `permissions.admin` is false. Workflow contract tests require both the explicit Administration request and the matching capability attestation.

**Generalized lesson**

Authorization metadata shaped around one credential class must not be generalized to every credential provider.

**Derived principle / standard change**

RAIDER security preflights must establish capabilities at the boundary where the platform authoritatively validates them, then pass only a minimal non-secret proof into provider-agnostic execution.


## 2026-09-26 — Repository-wide concurrency dropped backlog events

**Context**  
Creating a burst of Issues in a newly bootstrapped consumer caused several Project Automation workflow runs to be cancelled before synchronization.

**Symptom / impact**  
The Issues existed in GitHub, but intermediate issue-event runs never reached the Project synchronization step. A consumer could therefore have an incomplete board even though the reusable workflow declared `cancel-in-progress: false`.

**Root cause**  
GitHub Actions concurrency keeps at most one running and one pending run per concurrency group. The reusable workflow used one repository-wide group, so each new Issue event replaced the previous pending run.

**Resolution**  
Scope the concurrency key to the manual issue number, Issue number, pull-request number, or a bootstrap lane. Independent work items no longer cancel each other's pending synchronization.

**Prevention**  
A workflow contract test rejects the old repository-wide concurrency key. Event handlers remain idempotent so repeated events for the same work item converge safely.

**RAIDER lesson**  
Idempotency alone does not guarantee durability when the scheduler can discard work before execution. Queue/concurrency semantics are part of the automation contract and must be tested explicitly.

### LESSON-2026-010 — Managed runtime state must be reconciled after downstream deploys

- **Date:** 2026-09-29
- **Category:** architecture-operations
- **Status:** prevention-added
- **Related:** Trigenys/appfactory#77, Trigenys/appfactory#78, Trigenys/product-identity#45

**Context**

AppFactory centrally owns a Cloudflare Hyperdrive binding for a product Worker, while the product repository independently deploys Worker code through Wrangler. The product repository intentionally does not know the AppFactory-created Hyperdrive resource ID.

**Failure / near miss**

AppFactory could provision and verify the `HYPERDRIVE` binding successfully, then a later repository-driven Worker deployment could replace Worker settings and remove or drift that binding. A release gate that only checked readiness afterwards would detect the damage, but the same deployment path could recreate it on every release.

**Root cause**

Control-plane ownership and deployment-time source of truth were split across two writers without an explicit post-deploy reconciliation boundary. Provisioning was treated as durable state even though a downstream deploy could rewrite the same runtime configuration surface.

**Resolution**

The AppFactory release path now treats centrally managed runtime bindings as reconciled state: after the Worker deployment reaches success, AppFactory reasserts the marker-backed Hyperdrive binding, preserves unrelated bindings, verifies the expected resource identity, and only then runs application readiness.

**Prevention**

Post-deploy tests require missing and drifted managed bindings to converge before readiness. Product repositories remain unable to supply or persist centrally owned resource IDs, and release evidence records whether reconciliation was required.

**Generalized lesson**

When one system owns runtime configuration and another system can redeploy the workload, successful provisioning is not enough. The owner of each managed runtime surface must reassert and verify its state after every downstream operation capable of rewriting that surface.

**Derived principle / standard change**

RAIDER durability reviews must identify the authoritative writer for each mutable runtime surface, enumerate downstream operations that can overwrite it, and require post-operation reconciliation before readiness. Detection-only gates are insufficient when the automation already owns enough authority to repair the drift.



### LESSON-2026-011 — Item idempotence does not serialize shared bootstrap state

- **Date:** 2026-10-04
- **Category:** concurrency-architecture
- **Status:** prevention-added
- **Related:** issue #68

**Context**

A new consumer enabled Project bootstrap and opened 18 Issues in a short burst. Each Issue correctly had its own workflow concurrency lane, but every run still shared one mutable GitHub Project creation and schema surface.

**Failure / near miss**

Concurrent first-run workers observed that the configured Project did not exist, created competing Projects with the same title, and then hydrated fields/options against different snapshots. The burst produced duplicate Projects plus stale single-select option IDs.

**Root cause**

The previous fix protected durability of independent Issue events but treated Project creation, schema mutation and item synchronization as one concurrency domain. Item-scoped idempotence cannot make a shared bootstrap mutation atomic.

**Resolution**

Project Automation now uses two execution phases. A repository-scoped bootstrap phase serializes Project creation and schema reconciliation; item synchronization remains Issue/PR-scoped. Sync workers never create Projects, re-resolve the canonical Project after bootstrap, and refresh once when GitHub reports a stale option ID. The idempotent backlog import runs before the board marker so an interrupted bootstrap is retried rather than mistaken for a completed one.

**Prevention**

Contract tests model a 12-Issue burst and require one shared bootstrap lane alongside 12 independent item lanes. Tests also require the bootstrap-before-sync split, import-before-marker ordering, no Project creation from sync mode and stale-option refresh behavior.

**Generalized lesson**

Concurrency boundaries must follow the scope of the state being mutated. Idempotent item handlers do not protect repository- or project-scoped resources from first-run races.

**Derived principle / standard change**

RAIDER concurrency reviews must inventory each mutable resource, assign a serialization scope matching that resource, and prove that scheduler queue semantics cannot silently drop independent work while protecting shared critical sections.
