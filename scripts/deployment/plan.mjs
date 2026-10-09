#!/usr/bin/env node
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateContainerConfig, validateSourceSha, createImageMatrix, publishEligibility } from '../../src/deployment/contract.mjs';

const root = process.cwd();
const configPath = process.env.APPFACTORY_DEPLOY_CONFIG || '.github/appfactory-deploy.json';
const sha = validateSourceSha(process.env.APPFACTORY_SOURCE_SHA);
const repository = process.env.GITHUB_REPOSITORY;
const mode = process.env.APPFACTORY_DEPLOY_MODE || 'plan';
const config = validateContainerConfig(JSON.parse(await readFile(resolve(root, configPath), 'utf8')),
  { root, repository });
const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
function releaseMarkerChanged() {
  const parent = spawnSync('git', ['rev-parse', sha + '^'], { cwd: root, encoding: 'utf8' });
  if (parent.status !== 0) throw new Error('Cannot publish root commit without release history');
  const diff = spawnSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r',
    sha, '--', config.releaseMarker], { cwd: root, encoding: 'utf8' });
  if (diff.status !== 0) throw new Error('Failed to inspect exact release SHA: ' + diff.stderr);
  return diff.stdout.split(/\r?\n/).includes(config.releaseMarker);
}
const eligibility = publishEligibility({ mode, eventName: process.env.GITHUB_EVENT_NAME,
  event, repository, sha, config, markerChanged: mode === 'publish' ? releaseMarkerChanged() : false });
const matrix = createImageMatrix(config, sha);
const lines = [
  '## AppFactory container build',
  '- Repository: `' + repository + '`',
  '- Application: `' + config.projectId + '` (' + config.environment + ')',
  '- Exact SHA: `' + sha + '`',
  '- Mode: **' + mode + '** — ' + eligibility.reason,
  '- Compose: `' + config.composePath + '` (validated, not executed)',
  '- AWS / server deployment: **not performed**',
  '',
  '| Image | Dockerfile | Immutable tag | Platforms |',
  '|---|---|---|---|',
  ...matrix.include.map(i => '| ' + i.name + ' | ' + i.dockerfile + ' | `' + i.tag + '` | ' + i.platforms + ' |'),
  ''
];
const summary = lines.join('\n').replaceAll('`','`');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, [
  'matrix=' + JSON.stringify(matrix), 'eligible=' + eligibility.eligible,
  'source_sha=' + sha, 'reason=' + eligibility.reason, ''
].join('\n'));
