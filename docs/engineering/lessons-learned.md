# Engineering Lessons Learned

This is AppFactory's RAIDER failure memory. Record failures and near misses that expose a reusable engineering lesson, meaningful risk or likely source of recurrence. Do not record secrets or sensitive repository data.

Before related work, search this file for known failure modes. If a documented failure repeats, strengthen the prevention instead of copying the previous fix.

## Lessons

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
