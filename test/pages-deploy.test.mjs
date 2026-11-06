import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertProjectName, resolveBranch, inspectDist, buildPlan } from '../scripts/pages-deploy/contract.mjs';

const workflow = readFileSync(new URL('../.github/workflows/reusable-pages-deploy.yml', import.meta.url), 'utf8').replace(/
/g, '
');

test('reusable Pages deployment stays read-only, pinned and secret-free in plan mode', () => {
  assert.match(workflow, /^permissions:\n  contents: read/m);
  assert.doesNotMatch(workflow, /contents: write|id-token: write|pull_request_target|workflow_run:/);
  assert.match(workflow, /cloudflare\/wrangler-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /if: \$\{\{ steps\.plan\.outputs\.deploy == 'true' \}\}\n\s+id: upload/);
  assert.match(workflow, /default: plan/);
  assert.ok(workflow.indexOf('secrets.cloudflare_api_token') > workflow.indexOf('id: upload'), 'secrets are only read by the upload step');
  assert.doesNotMatch(workflow, /echo .*secrets\./);
});

test('project names follow the Cloudflare Pages slug contract', () => {
  assert.equal(assertProjectName('trigenys-website'), 'trigenys-website');
  for (const bad of ['', 'Trigenys', '-x', 'a_b', 'a'.repeat(59)]) assert.throws(() => assertProjectName(bad), /project_name/);
});

test('branch resolution: production uses the production branch, previews never collide with it', () => {
  assert.equal(resolveBranch({ mode: 'production', productionBranch: 'main', refName: 'main' }), 'main');
  assert.equal(resolveBranch({ mode: 'preview', productionBranch: 'main', refName: 'main' }), 'preview-main');
  assert.equal(resolveBranch({ mode: 'preview', productionBranch: 'main', refName: 'feat/site v2' }), 'feat-site-v2');
  assert.equal(resolveBranch({ mode: 'plan', productionBranch: 'trunk', refName: 'trunk' }), 'preview-trunk');
  assert.throws(() => resolveBranch({ mode: 'production', productionBranch: '', refName: 'main' }), /production_branch/);
});

test('dist inspection requires a built directory with index.html and reports headers files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pages-'));
  assert.throws(() => inspectDist(dir), /index\.html/);
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'a.css'), 'body{}');
  writeFileSync(path.join(dir, '_headers'), '/*\n  X-Frame-Options: DENY\n');
  const d = inspectDist(dir);
  assert.deepEqual([d.files, d.headers, d.redirects], [3, true, false]);
  assert.ok(d.bytes > 0);
  assert.throws(() => inspectDist(path.join(dir, 'missing')), /not a directory/);
});

test('plan mode never deploys; preview and production do', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pages-'));
  writeFileSync(path.join(dir, 'index.html'), 'x');
  const base = { PAGES_PROJECT_NAME: 'site', PAGES_DIST_DIR: dir, PAGES_PRODUCTION_BRANCH: 'main', PAGES_REF_NAME: 'main' };
  assert.equal(buildPlan({ ...base, PAGES_MODE: 'plan' }).deploy, false);
  assert.equal(buildPlan({ ...base, PAGES_MODE: 'preview' }).branch, 'preview-main');
  assert.equal(buildPlan({ ...base, PAGES_MODE: 'production' }).branch, 'main');
  assert.throws(() => buildPlan({ ...base, PAGES_MODE: 'deploy' }), /mode/);
});
