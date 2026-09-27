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
  assert.ok(workflow.includes('wix = @{'));
  assert.ok(workflow.includes('version = $wixVersion'));
  assert.ok(workflow.includes('$revision = 65535'));
  assert.ok(workflow.includes('Prerelease counter must be between 0 and 65534'));
  assert.match(workflow, /msiexec\.exe \/i/);
  assert.match(workflow, /msiexec\.exe \/x/);
  assert.match(workflow, /Get-FileHash .* -Algorithm SHA256/);
  assert.match(workflow, /build-provenance\.txt/);
  assert.match(workflow, /gh release upload/);
  assert.equal((workflow.match(/- name: Locate generated MSI/g) ?? []).length, 1);
  assert.equal((workflow.match(/- name: Package checksum and provenance/g) ?? []).length, 1);
  assert.equal((workflow.match(/- name: Attach validated assets to GitHub Release/g) ?? []).length, 1);
  assert.ok(workflow.includes("(?<prerelease>[0-9A-Za-z.-]+)"));
  assert.doesNotMatch(workflow, /extra-args|build-args|shell-args/);
  assert.doesNotMatch(workflow, /\\\$\{\{/);
});

test('Tauri release workflow prefers lockfiles but supports legacy consumers', async () => {
  const workflow = await readFile(tauriWorkflowPath, 'utf8');

  assert.ok(workflow.includes("hashFiles(format('{0}/package-lock.json', inputs.working-directory)) != ''"));
  assert.ok(workflow.includes("hashFiles(format('{0}/package-lock.json', inputs.working-directory)) == ''"));
  assert.ok(workflow.includes('run: npm ci --no-audit --no-fund'));
  assert.ok(workflow.includes('npm install --no-audit --no-fund'));
  assert.ok(workflow.includes('No package-lock.json found. Falling back to npm install'));
  assert.ok(!workflow.includes('currently requires package-lock.json'));
});

test('Reusable semantic release supports manifest-config prerelease consumers', async () => {
  const workflow = await readFile(reusableReleasePath, 'utf8');

  assert.match(workflow, /config-file:/);
  assert.match(workflow, /manifest-file:/);
  assert.match(workflow, /id: release-manifest/);
  assert.match(workflow, /googleapis\/release-please-action@v4/);
});

test('MSI version mapping keeps stable newer than beta for the same SemVer base', () => {
  const derive = (version) => {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    assert.ok(match);
    const [, major, minor, patch, prerelease = ''] = match;
    const tail = prerelease.match(/(?:^|\.)(\d+)$/);
    const revision = prerelease ? Number(tail?.[1] ?? 0) : 65535;
    assert.ok(revision >= 0 && revision <= 65535);
    return `${major}.${minor}.${patch}.${revision}`;
  };

  assert.equal(derive('0.1.0-beta.1'), '0.1.0.1');
  assert.equal(derive('0.1.0-beta.2'), '0.1.0.2');
  assert.equal(derive('0.1.0-beta'), '0.1.0.0');
  assert.equal(derive('0.1.0'), '0.1.0.65535');
});
