# AppFactory Project Automation

Reusable GitHub Action for bootstrapping and synchronizing GitHub Projects v2 with repository Issues and linked pull requests.

It centralizes the Project automation logic used by AppFactory products while keeping product-specific phases and overrides in each consuming repository.

## What it automates

- create the configured GitHub Project v2 when it does not exist;
- optionally link the Project to the consuming repository;
- create/reconcile the AppFactory Project fields and options;
- create an `AppFactory Board` board view;
- import existing open Issues into the Project backlog;
- add newly opened/reopened Issues to `Backlog`;
- map Issue title prefixes to work types;
- apply Priority, Work type, Phase and Size metadata;
- move draft-linked work to `In Progress`;
- move ready pull requests to `Review`;
- move merged/closed work to `Done`;
- manually resync one Issue;
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
              ├── optional Project bootstrap
              ├── schema reconciliation
              ├── backlog import
              ├── event normalization
              ├── GitHub GraphQL Projects v2
              ├── Issue metadata resolution
              └── lifecycle transitions
```

The consuming repository owns its product-specific Project policy. This Action owns the reusable execution engine.

## Quick start with automatic bootstrap

Create `.github/project-config.json`:

```json
{
  "project": {
    "owner": "YOUR_GITHUB_LOGIN_OR_ORG",
    "title": "Your Product Development",
    "bootstrap": true,
    "template": "appfactory-product",
    "linkRepository": true,
    "importOpenIssues": true,
    "createBoardView": true
  },
  "bootstrap": {
    "boardViewName": "AppFactory Board",
    "phases": ["Foundation", "MVP", "Release"]
  }
}
```

Then use the workflow from `examples/project-automation.yml` and create a repository Actions secret named `PROJECT_TOKEN` with Projects v2 access to the configured owner.

Run the workflow manually once with `issue_number` left empty. The Action will:

1. resolve the configured Project owner and repository;
2. create the Project if it does not exist;
3. link it to the repository when enabled;
4. create/reconcile the AppFactory fields;
5. create the board view;
6. import all open Issues and place them in `Backlog`;
7. apply any metadata that can be inferred from titles, overrides or embedded metadata.

After bootstrap, normal Issue and pull-request events keep the board synchronized.

## `appfactory-product` template

The built-in template supplies the standard AppFactory policy so a new repository does not need to repeat it.

### Status

```text
Backlog → Ready → In Progress → Review → Validation → Done
```

### Priority

```text
P0, P1, P2, P3
```

### Work type

```text
Product, Feature, Engineering, UX, Security, Quality, Documentation, Bug
```

### Size

```text
XS, S, M, L, XL
```

### Phase

Set product-specific phases with `bootstrap.phases`. If omitted, the AppFactory lifecycle is used:

```text
Discover, Specify, Design, Build, Verify, Ship, Observe, Iterate
```

The template also supplies default field names, lifecycle transitions and title-prefix mappings. Any explicit values in the repository config override the template defaults.

## Non-destructive reconciliation

Bootstrap is designed to be convergent rather than destructive.

For an existing Project, the Action:

- reuses fields with the configured names;
- adds missing options while preserving existing option IDs and values;
- does not delete repository-specific options;
- refuses to replace a same-named field when its type is incompatible;
- reuses existing Project items instead of duplicating Issues.

For a newly created Project, the initial Status options are normalized to the AppFactory workflow before backlog import because the Project has no user data to preserve yet.

## Configuration

A bootstrap-enabled config can stay minimal because the template supplies defaults:

```json
{
  "project": {
    "owner": "EagleFox31",
    "title": "Product Development",
    "bootstrap": true,
    "template": "appfactory-product"
  },
  "bootstrap": {
    "phases": ["Foundation", "MVP", "Release"]
  }
}
```

Project bootstrap settings:

- `project.bootstrap`: allow automatic Project creation and manual bootstrap/reconciliation;
- `project.template`: currently `appfactory-product`;
- `project.linkRepository`: link the Project to the consuming repository; defaults to `true` for the template;
- `project.importOpenIssues`: import/synchronize all open Issues during bootstrap; defaults to `true`;
- `project.createBoardView`: create the AppFactory board view; defaults to `true`;
- `bootstrap.boardViewName`: board view name; defaults to `AppFactory Board`;
- `bootstrap.phases`: product-specific Phase options.

Advanced/legacy configs may still explicitly define:

- `fields`
- `statusTransitions`
- `workTypeByTitlePrefix`
- `issueOverrides`
- `metadataCommentKey`

Existing v1 configs without bootstrap remain supported.

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

During bootstrap, metadata found in open Issues and `issueOverrides` can also extend Phase, Work type, Priority or Size options when required.

## Manual execution

With bootstrap enabled:

- leave `issue_number` empty to create/reconcile the Project and synchronize the open backlog;
- provide `issue_number` to resync only one Issue.

Supported Issue forms:

```text
15
#15
issue_number = 15
```

Without bootstrap enabled, a manual run still requires an Issue number, preserving the v1 behavior.

## Security model

- the Action never executes code from a pull request;
- consumers using `pull_request_target` must checkout the trusted default branch rather than untrusted PR code;
- the Project token is passed explicitly as an Action input and is never printed;
- built-in `GITHUB_TOKEN` permissions can stay read-only;
- Project/field/option IDs are discovered at runtime rather than copied into source;
- bootstrap only mutates the explicitly configured Project owner/title and consuming repository;
- existing field options are preserved during reconciliation;
- malformed manual inputs and incompatible field types fail before silently changing Project semantics.

## Workflow example

```yaml
name: Project automation

on:
  issues:
    types: [opened, reopened, edited, closed]
  pull_request_target:
    types: [opened, reopened, ready_for_review, closed]
  workflow_dispatch:
    inputs:
      issue_number:
        description: "Optional Issue to resync; leave empty to bootstrap"
        required: false
        type: string

permissions:
  contents: read
  issues: read
  pull-requests: read

jobs:
  sync-project:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.repository.default_branch }}
          persist-credentials: false

      - uses: EagleFox31/appfactory-project-automation@v1
        with:
          token: ${{ secrets.PROJECT_TOKEN }}
          config-path: .github/project-config.json
          issue-number: ${{ inputs.issue_number }}
```

## Development

The Action is zero-dependency and uses Node 24.

```bash
npm test
```

Tests cover manual input normalization, metadata parsing and precedence, title mapping, config compatibility, AppFactory template hydration, bootstrap field generation, option reconciliation and pull-request lifecycle transitions.

## Versioning

Consumers should pin to a major release:

```yaml
uses: EagleFox31/appfactory-project-automation@v1
```

Breaking behavior changes require a new major version. `main` is development, not a stable integration target.

## AppFactory

This Action is an AppFactory infrastructure brick: product repositories retain their domain-specific phases and metadata while Project creation, backlog setup and lifecycle automation are maintained once and reused everywhere.
