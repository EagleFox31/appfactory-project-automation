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
