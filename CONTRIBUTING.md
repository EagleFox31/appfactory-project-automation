# Contributing to AppFactory Project Automation

Thanks for taking the time to contribute.

AppFactory Project Automation is a zero-dependency GitHub Action for bootstrapping and synchronizing GitHub Projects. Contributions should keep the Action predictable, non-destructive and safe to run from repository automation.

## Before opening a pull request

- Search existing Issues and pull requests first.
- For a bug, include the event that triggered the Action, the relevant configuration and the expected/actual behaviour.
- For a behaviour change or new capability, open an Issue first when the change affects configuration, lifecycle transitions or Project schema semantics.
- Never include real tokens, private Project IDs, customer data or production secrets in examples, logs or tests.

## Development

Requirements:

- Node.js 24 or later
- npm

Install and run the test suite:

```bash
npm install
npm test
```

The Action intentionally has no runtime dependencies. Please avoid adding dependencies unless there is a strong maintenance or security reason.

## Pull requests

Keep changes focused and reviewable. A pull request should:

- explain the problem being solved;
- include tests for new or changed behaviour;
- preserve backwards compatibility for existing v1 consumer configuration unless the change is explicitly breaking;
- update documentation when configuration or user-facing behaviour changes;
- avoid hard-coded Project, field or option IDs.

Use Conventional Commit-style titles where practical (`feat:`, `fix:`, `docs:`, `refactor:`, etc.). Release Please uses those changes to build release notes and versions.

## Security-sensitive changes

Changes involving `pull_request_target`, token handling, repository checkout behaviour, GraphQL mutations or user-controlled input deserve extra care. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
