import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('../release-please-config.json', import.meta.url), 'utf8'));

test('release manifest starts from the currently published package version', () => {
  assert.equal(manifest['.'], packageJson.version);
});

test('release please uses semver v-tags without a component prefix', () => {
  assert.equal(config['include-v-in-tag'], true);
  assert.equal(config['include-component-in-tag'], false);
});

test('root package uses the Node release strategy', () => {
  assert.equal(config.packages['.']['release-type'], 'node');
  assert.equal(config.packages['.']['package-name'], 'appfactory-project-automation');
  assert.equal(config.packages['.']['changelog-path'], 'CHANGELOG.md');
});
