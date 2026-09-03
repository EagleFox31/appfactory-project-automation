# AppFactory Project Automation

Reusable GitHub Action for synchronizing Issues and linked pull requests with GitHub Projects v2.

It centralizes the Project automation logic used by AppFactory products while keeping product-specific workflow rules in each consuming repository.

## What it automates

- add Issues to a GitHub Project v2 board;
- resolve user-owned or organization-owned Projects dynamically;
- discover Project fields and single-select options dynamically;
- map Issue title prefixes to work types;
- apply Priority, Work type, Phase and Size metadata;
- move newly opened/reopened Issues to Backlog;
- move draft-linked work to In Progress;
- move ready pull requests to Review;
- move merged/closed work to Done;
- manually resync an Issue;
- preserve repository-specific overrides through a local JSON config.

No Project IDs, field IDs or option IDs are hard-coded.

## Architecture

```text
Consumer repository
├── .github/project-config.json
└── .github/workflows/project-automation.yml
              │
              ▼
EagleFox31/appfactory-project-automation@v1
              │
              ├── event normalization
              ├── config validation
              ├── GitHub GraphQL Projects v2
              ├── Issue metadata resolution
              └── lifecycle transitions
```

The consuming repository owns its Project policy. This Action owns the reusable execution engine.

## Quick start

1. Copy `examples/project-config.json` to `.github/project-config.json` in the consuming repository.
2. Adjust the Project owner/title, field names, status transitions and title-prefix mappings.
3. Copy `examples/project-automation.yml` to `.github/workflows/project-automation.yml`.
4. Create a repository Actions secret named `PROJECT_TOKEN` with access to the target GitHub Project.
5. Pin the Action to a released major version such as `@v1`.

Example step:

```yaml
- name: Sync GitHub Project
  uses: EagleFox31/appfactory-project-automation@v1
  with:
    token: ${{ secrets.PROJECT_TOKEN }}
    config-path: .github/project-config.json
    issue-number: ${{ inputs.issue_number }}
```

For `pull_request_target`, always checkout the trusted default branch rather than untrusted PR code before invoking the Action.

## Configuration

The Action expects a JSON file shaped like:

```json
{
  "project": {
    "owner": "EagleFox31",
    "title": "Product Development"
  },
  "metadataCommentKey": "appfactory-project",
  "fields": {
    "status": "Status",
    "priority": "Priority",
    "workType": "Work type",
    "phase": "Phase",
    "size": "Size"
  },
  "statusTransitions": {
    "issueOpened": "Backlog",
    "issueReopened": "Backlog",
    "issueClosed": "Done",
    "draftPullRequest": "In Progress",
    "pullRequestReady": "Review",
    "pullRequestMerged": "Done"
  }
}
```

Additional optional keys:

- `workTypeByTitlePrefix`
- `issueOverrides`
- `metadataCommentKey`

## Embedded Issue metadata

A repository may optionally keep structured metadata inside an Issue body:

```html
<!-- appfactory-project
priority: P1
workType: Security
phase: Foundation
size: L
-->
```

The marker is configurable so existing products can retain a legacy marker during migration.

Metadata precedence is:

```text
title inference < issueOverrides < embedded Issue metadata
```

## Manual resync

The Action accepts these forms:

```text
15
#15
issue_number = 15
```

Manual resync is convergent: an open Issue is moved to the configured open status and a closed Issue to the configured closed status, even when the Project item already exists.

## Security model

- the Action never executes code from a pull request;
- consumers should use `pull_request_target` only with a checkout of the trusted default branch;
- the Project token is passed explicitly as an Action input;
- built-in `GITHUB_TOKEN` permissions can stay read-only;
- Project/field/option IDs are discovered at runtime rather than copied into source;
- malformed manual inputs fail before GraphQL execution.

## Development

The Action is zero-dependency and uses Node 24.

```bash
npm test
```

Tests cover manual input normalization, metadata parsing and precedence, title mapping, config validation and pull-request lifecycle transitions.

## Versioning

Consumers should pin to a major release:

```yaml
uses: EagleFox31/appfactory-project-automation@v1
```

Breaking behavior changes require a new major version. `main` is development, not a stable integration target.

## AppFactory

This Action is an AppFactory infrastructure brick: product repositories retain their domain-specific Project configuration while the automation engine is maintained once and reused everywhere.
