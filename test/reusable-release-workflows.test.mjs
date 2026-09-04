import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reusableRelease = fs.readFileSync(
  new URL('../.github/workflows/reusable-release.yml', import.meta.url),
  'utf8');
const dotnetRelease = fs.readFileSync(
  new URL('../.github/workflows/release-dotnet-desktop.yml', import.meta.url),
  'utf8');
const genericExample = fs.readFileSync(
  new URL('../examples/product-release.yml', import.meta.url),
  'utf8');
const dotnetExample = fs.readFileSync(
  new URL('../examples/dotnet-desktop-release.yml', import.meta.url),
  'utf8');

test('generic release workflow is reusable and delegates semantic versioning to Release Please', () => {
  assert.match(reusableRelease, /workflow_call:/);
  assert.match(reusableRelease, /googleapis\/release-please-action@v4/);
  assert.match(reusableRelease, /default: simple/);
  assert.match(reusableRelease, /release-as:/);
  assert.match(reusableRelease, /secrets\.release_token \|\| github\.token/);
});

test('generic release workflow exposes release identity outputs', () => {
  assert.match(reusableRelease, /release_created:/);
  assert.match(reusableRelease, /tag_name:/);
  assert.match(reusableRelease, /version:/);
  assert.match(reusableRelease, /release_sha:/);
});

test('Release Please v4 step does not receive removed action inputs', () => {
  const releasePleaseStep = reusableRelease.split('uses: googleapis/release-please-action@v4')[1] ?? '';
  assert.doesNotMatch(releasePleaseStep, /include-v-in-tag:/);
  assert.doesNotMatch(dotnetRelease, /include-v-in-tag: true/);
});

test('dotnet release composes the release workflow from the same AppFactory commit', () => {
  assert.match(dotnetRelease, /uses: \$\/\.github\/workflows\/reusable-release\.yml/);
  assert.match(dotnetRelease, /if: needs\.release\.outputs\.release_created == 'true'/);
});

test('dotnet release builds the exact tagged commit with deterministic version metadata', () => {
  assert.match(dotnetRelease, /ref: \$\{\{ needs\.release\.outputs\.release_sha \}\}/);
  assert.match(dotnetRelease, /-p:ContinuousIntegrationBuild=true/);
  assert.match(dotnetRelease, /-p:Version=\$env:VERSION/);
});

test('dotnet release creates a versioned zip, checksum and GitHub release assets', () => {
  assert.match(dotnetRelease, /\.zip"/);
  assert.match(dotnetRelease, /\.sha256\.txt"/);
  assert.match(dotnetRelease, /Get-FileHash -LiteralPath \$assetPath -Algorithm SHA256/);
  assert.match(dotnetRelease, /actions\/upload-artifact@v4/);
  assert.match(dotnetRelease, /gh release upload/);
});

test('dotnet release does not expose arbitrary command argument inputs', () => {
  assert.doesNotMatch(dotnetRelease, /extra-args/);
  assert.doesNotMatch(dotnetRelease, /publish-args/);
  assert.match(dotnetRelease, /project-path must be a relative \.csproj path/);
});

test('consumer examples pin the reusable workflows to the stable major alias', () => {
  assert.match(genericExample, /reusable-release\.yml@v1/);
  assert.match(dotnetExample, /release-dotnet-desktop\.yml@v1/);
  assert.match(dotnetExample, /APPFACTORY_RELEASE_TOKEN/);
});
