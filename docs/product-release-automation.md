# Reusable product release automation

AppFactory exposes release workflows that consumer repositories can call directly. The goal is to keep semantic versioning, Release Please, deterministic release builds and release-asset publishing in one reusable place instead of copying the same pipeline into every product.

## Architecture

```text
Consumer repository
└── .github/workflows/release.yml
           │
           ▼
EagleFox31/appfactory-project-automation@v1
├── reusable-release.yml
│   └── Release Please → Release PR → SemVer tag → GitHub Release
└── release-dotnet-desktop.yml
    ├── reusable-release.yml
    ├── checkout exact release SHA
    ├── dotnet publish
    ├── versioned ZIP
    ├── SHA-256 checksum
    ├── Actions artifact
    └── GitHub Release assets
```

The release workflows are separate from the existing GitHub Projects action. A product can use Project automation, release automation, both, or neither.

## Standard semantic release workflow

Use `.github/workflows/reusable-release.yml` for a product that only needs Release Please orchestration.

The default strategy is Release Please `simple`:

- Conventional Commits determine the next semantic version;
- Release Please maintains a Release PR;
- the Release PR contains `CHANGELOG.md` and `version.txt` updates;
- merging the Release PR creates a `vX.Y.Z` Git tag and GitHub Release.

Important Conventional Commit prefixes:

- `fix:` → patch release;
- `feat:` → feature release;
- `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer → breaking release.

The workflow supports `release-as` for a one-time initial version override. For example, a new pre-1.0 product can manually run the caller workflow once with `release_as=0.1.0`, then leave the input empty for later releases.

## .NET desktop release workflow

Use `.github/workflows/release-dotnet-desktop.yml` for Avalonia, WPF, WinUI or another publishable .NET desktop project.

When Release Please only updates a Release PR, no binary is built.

When merging the Release PR creates a GitHub Release, the workflow:

1. checks out the exact SHA tagged by Release Please;
2. installs the configured .NET SDK;
3. validates the consumer-provided project path, product name, runtime and configuration;
4. runs `dotnet publish` with `ContinuousIntegrationBuild=true` and the semantic release version;
5. creates `<Product>-v<Version>-<RID>.zip`;
6. creates `<Product>-v<Version>-<RID>.sha256.txt`;
7. uploads both files as a GitHub Actions artifact;
8. attaches both files to the GitHub Release.

The workflow does not accept arbitrary extra command-line arguments. Product-specific build customization should live in the product's MSBuild project/props rather than being passed as untrusted shell text.

### Supported inputs

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `project-path` | yes | — | Relative `.csproj` path inside the consumer repository |
| `product-name` | yes | — | Safe release asset prefix |
| `runtime` | no | `win-x64` | .NET Runtime Identifier |
| `dotnet-version` | no | `10.0.x` | SDK installed on the release runner |
| `configuration` | no | `Release` | MSBuild configuration |
| `self-contained` | no | `true` | Include the .NET runtime in the published application |
| `target-branch` | no | `main` | Release Please target branch |
| `release-as` | no | empty | One-time semantic version override |

## Consumer workflow

A consumer only needs a thin wrapper:

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      release_as:
        required: false
        type: string

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  release:
    uses: EagleFox31/appfactory-project-automation/.github/workflows/release-dotnet-desktop.yml@v1
    with:
      project-path: src/MyProduct.Desktop/MyProduct.Desktop.csproj
      product-name: MyProduct
      runtime: win-x64
      dotnet-version: 10.0.x
      release-as: ${{ inputs.release_as }}
    secrets:
      release_token: ${{ secrets.APPFACTORY_RELEASE_TOKEN }}
```

See `examples/product-release.yml` and `examples/dotnet-desktop-release.yml` for complete examples.

## Token behavior

`release_token` is optional. If it is omitted, AppFactory falls back to the caller repository's `GITHUB_TOKEN`.

The fallback is enough to create Release Please PRs and GitHub Releases when the repository grants the required workflow permissions. However, GitHub intentionally prevents events created with `GITHUB_TOKEN` from recursively triggering most new workflow runs. This means CI may not automatically run on a Release Please PR created with the fallback token.

For product repositories where the Release PR must run normal CI, configure a repository secret such as `APPFACTORY_RELEASE_TOKEN` using a narrowly scoped token that can write repository contents and pull requests, then map it to the reusable workflow's `release_token` secret.

Never commit that token to a workflow or configuration file.

## Required permissions

The caller workflow must allow:

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
```

Permissions can only be maintained or reduced through a reusable-workflow chain; a called workflow cannot elevate a token beyond what the caller permits.

## Release integrity

The .NET desktop workflow deliberately builds from `release-sha`, not from the latest state of `main`. This ties every uploaded binary to the exact commit that Release Please tagged.

The generated SHA-256 file lets users or later installer tooling verify the downloaded ZIP before execution.

## Current scope

The first artifact builder targets .NET desktop products on a Windows runner. The release orchestration itself is language-agnostic. Future AppFactory builders can add Node/Electron, Tauri, macOS notarization, MSIX/MSI/EXE packaging and code signing without changing the product-side release contract.
