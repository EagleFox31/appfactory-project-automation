import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tauriWorkflowPath = new URL('../.github/workflows/release-tauri-desktop.yml', import.meta.url);
const reusableReleasePath = new URL('../.github/workflows/reusable-release.yml', import.meta.url);

test('Tauri release workflow preserves release integrity boundaries', async () => {
  const workflow = await readFile(tauriWorkflowPath, 'utf8');

  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/reusable-release\.yml/);
  assert.match(workflow, /ref: \$\{\{ needs\.release\.outputs\.release_sha \}\}/);
  assert.match(workflow, /npx --no-install tauri build --bundles msi/);
  assert.match(workflow, /msiexec\.exe \/i/);
  assert.match(workflow, /msiexec\.exe \/x/);
  assert.match(workflow, /Get-FileHash .* -Algorithm SHA256/);
  assert.match(workflow, /build-provenance\.txt/);
  assert.match(workflow, /gh release upload/);
  assert.doesNotMatch(workflow, /extra-args|build-args|shell-args/);
});

test('Reusable semantic release supports manifest-config prerelease consumers', async () => {
  const workflow = await readFile(reusableReleasePath, 'utf8');

  assert.match(workflow, /config-file:/);
  assert.match(workflow, /manifest-file:/);
  assert.match(workflow, /id: release-manifest/);
  assert.match(workflow, /googleapis\/release-please-action@v4/);
});
