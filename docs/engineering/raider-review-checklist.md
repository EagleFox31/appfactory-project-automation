# RAIDER review checklist

Use this checklist for AppFactory automation, shared workflow and platform changes.

- [ ] **Reusable:** the capability serves multiple consumers without copy/paste, forks or repository-specific branches.
- [ ] **Agnostic:** owner, repository, default branch, stack, workflow and environment assumptions are discovered or configured.
- [ ] **Idempotent:** repeated execution converges; canonical normalizers accept canonical output; retries do not duplicate resources.
- [ ] **Durable / non-regressive:** established Project and release contracts remain covered and green.
- [ ] **Failure memory:** significant failures or near misses have a root cause, prevention and generalized lesson when applicable.
- [ ] **Engineering-grade:** transport, policy and reconciliation responsibilities are separated; permissions are minimal; errors are actionable; secrets are not logged.
- [ ] **Reuse-first:** relevant packages, Actions, repositories, standards and platform APIs were evaluated and the Adopt / Adapt / Learn / Build decision is visible.
- [ ] **Retroactive:** existing repositories and user-managed state are preserved; greenfield-only assumptions are rejected.
- [ ] Any justified RAIDER exception is explicit in the issue, ADR or pull request.
