# Automated releases

AppFactory Project Automation uses Release Please to manage semantic versions, release pull requests, GitHub Releases and stable Action aliases.

## Release flow

```text
feature/fix PR
    ↓
CI + merge to main
    ↓
Release Please evaluates conventional commits
    ↓
automated release PR
    ↓
merge release PR
    ↓
version tag + GitHub Release + CHANGELOG
    ↓
vMAJOR and vMAJOR.MINOR aliases synchronized
```

The release workflow runs on every push to `main` and can also be started manually.

## Conventional commits

Release Please derives the next version from conventional commits:

- `fix: ...` -> patch release, for example `1.1.0` to `1.1.1`;
- `feat: ...` -> minor release, for example `1.1.0` to `1.2.0`;
- a breaking change (`feat!: ...` or a `BREAKING CHANGE:` footer) -> major release, for example `1.x` to `2.0.0`.

Documentation, CI, tests and chores are retained in history but do not independently force a release with the current configuration.

## Release Please state

- `release-please-config.json` defines the release strategy and changelog sections.
- `.release-please-manifest.json` records the last released version known to Release Please.
- `package.json` is versioned by the Node release strategy.
- `CHANGELOG.md` is generated/updated by the automated release PR.

The automation was seeded at `v1.1.0`, the last manually published release.

## Stable Action aliases

After Release Please runs, the workflow resolves the latest non-prerelease GitHub Release and synchronizes:

```text
v1.2.3  immutable release tag
v1.2    floating minor alias
v1      floating major alias
```

This allows consumers to choose between convenience and reproducibility:

```yaml
# Automatically receive backwards-compatible v1 updates.
uses: EagleFox31/appfactory-project-automation@v1

# Stay within one minor line.
uses: EagleFox31/appfactory-project-automation@v1.2

# Strongest reproducibility: pin a full commit SHA.
uses: EagleFox31/appfactory-project-automation@<full-commit-sha>
```

The repository historically used a `v1` branch as its floating major ref. The release workflow keeps that legacy branch synchronized while also maintaining the standard `v1` tag.

## Marketplace

The workflow automates semantic version calculation, the release PR, version tag creation, GitHub Release creation, release notes/CHANGELOG generation and major/minor Action aliases.

GitHub Marketplace publication metadata is managed by GitHub separately from the normal Releases API. The Action remains usable through its Git refs regardless of Marketplace presentation.
