import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertMode, assertProjectId, parseTargets, assertExactVersion, assertIdentity, resolveChannel, assertProductionGuard,
  readHostingConfig, inspectPublicDir, inspectFirestore, assertCommitConsistency, assertCredentialsDir, buildPlan, KNOWN_BROKEN,
} from '../scripts/firebase-deploy/contract.mjs';

const workflow = readFileSync(new URL('../.github/workflows/reusable-firebase-deploy.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PROVIDER = 'projects/123456789012/locations/global/workloadIdentityPools/github/providers/github-actions';
const SA = 'github-deploy@love-ink.iam.gserviceaccount.com';

function site({ publicDir = 'public', ignore, hosting, firestore, extraFiles = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fb-'));
  const h = hosting ?? { public: publicDir, ...(ignore ? { ignore } : {}) };
  writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({ hosting: h, ...(firestore ? { firestore } : {}) }));
  const pub = path.join(dir, publicDir);
  mkdirSync(pub, { recursive: true });
  writeFileSync(path.join(pub, 'index.html'), '<!doctype html>');
  for (const [rel, content] of extraFiles) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function env(dir, overrides = {}) {
  return {
    FIREBASE_MODE: 'plan', FIREBASE_PROJECT_ID: 'love-ink', FIREBASE_TARGETS: 'hosting', FIREBASE_TOOLS_VERSION: '15.35.0',
    FIREBASE_NODE_VERSION: '24.18.0', FIREBASE_SITE_DIR: dir, FIREBASE_WORKSPACE: dir, FIREBASE_REF: 'refs/heads/main',
    FIREBASE_REF_NAME: 'main', FIREBASE_EVENT_NAME: 'push', FIREBASE_PRODUCTION_BRANCH: 'main', FIREBASE_REPOSITORY: 'Trigenys/loveink',
    FIREBASE_HEAD_REPOSITORY: 'Trigenys/loveink', FIREBASE_CREDENTIALS_DIR: path.join(tmpdir(), 'creds-' + path.basename(dir)),
    FIREBASE_WORKLOAD_IDENTITY_PROVIDER: PROVIDER, FIREBASE_SERVICE_ACCOUNT: SA, ...overrides,
  };
}

// --- workflow contract -------------------------------------------------------------------------------------

test('reusable Firebase workflow: minimal permissions, OIDC only, no secret input, SHA-pinned actions', () => {
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.match(workflow, /permissions:\n      contents: read\n      id-token: write/);
  assert.doesNotMatch(workflow, /contents: write|pull_request_target|workflow_run:|\n    secrets:/);
  assert.doesNotMatch(workflow, /secrets\.|FIREBASE_TOKEN|firebaseServiceAccount|action-hosting-deploy/);
  for (const m of workflow.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} must be pinned by commit SHA`);
  assert.match(workflow, /google-github-actions\/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3\.0\.0/);
  assert.match(workflow, /default: plan/);
  assert.match(workflow, /default: "15\.35\.0"/);
  assert.match(workflow, /default: "24\.18\.0"/);
  assert.match(workflow, /persist-credentials: false/);
});

test('reusable Firebase workflow: plan mode never authenticates; contract runs before auth', () => {
  const contractAt = workflow.indexOf('scripts/firebase-deploy/contract.mjs');
  const authAt = workflow.indexOf('id: auth');
  assert.ok(contractAt > 0 && authAt > contractAt, 'contract step precedes the auth step');
  assert.match(workflow, /if: \$\{\{ steps\.plan\.outputs\.deploy == 'true' \}\}\n\s+id: auth/);
  assert.match(workflow, /build consumer \(no credential\)/);
  assert.ok(workflow.indexOf('Install and build consumer') < authAt, 'build precedes authentication');
});

test('reusable Firebase workflow: credentials file is written outside the workspace and removed', () => {
  assert.doesNotMatch(workflow, /^\s+FIREBASE_CREDENTIALS_DIR: \$\{\{ runner\.temp \}\}/m, 'runner context is not available in job-level env');
  assert.match(workflow, /echo "FIREBASE_CREDENTIALS_DIR=\$RUNNER_TEMP\/appfactory-firebase-credentials" >> "\$GITHUB_ENV"/);
  assert.match(workflow, /id: auth[\s\S]*?env:\n\s+#[^\n]*\n\s+#[^\n]*\n\s+GITHUB_WORKSPACE: \$\{\{ env\.FIREBASE_CREDENTIALS_DIR \}\}/);
  assert.match(workflow, /cleanup_credentials: true/);
  assert.match(workflow, /Verify credentials file location[\s\S]*?find "\$GITHUB_WORKSPACE" -name 'gha-creds-\*\.json'/);
  assert.match(workflow, /Remove credentials \(always\)\n\s+if: always\(\)[\s\S]*?rm -rf "\$FIREBASE_CREDENTIALS_DIR"/);
  assert.ok(workflow.indexOf('Verify credentials file location') < workflow.indexOf('Deploy preview channel'), 'location verified before any deploy');
});

test('reusable Firebase workflow: production is guarded twice and serialized per project', () => {
  assert.match(workflow, /Production guard \(workflow-level[\s\S]*?if: \$\{\{ inputs\.mode == 'production' \}\}/);
  assert.match(workflow, /refs\/heads\/\$FIREBASE_PRODUCTION_BRANCH/);
  assert.match(workflow, /FIREBASE_PRODUCTION_BRANCH: \$\{\{ inputs\.production_branch \|\| github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /group: appfactory-firebase-\$\{\{ inputs\.firebase_project_id \}\}-/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: \$\{\{ inputs\.mode != 'plan' && \(inputs\.github_environment \|\| inputs\.mode\) \|\| '' \}\}/);
  assert.match(workflow, /--message "\$\{\{ github\.repository \}\}@\$\{\{ steps\.head\.outputs\.sha \}\}"/, 'release message records the deployed commit');
  assert.match(workflow, /deployed_sha:/);
});

// --- pure validators -----------------------------------------------------------------------------------------

test('modes, project ids, targets and exact versions', () => {
  assert.equal(assertMode('preview'), 'preview');
  assert.throws(() => assertMode('deploy'), /mode/);
  assert.equal(assertProjectId('love-ink'), 'love-ink');
  for (const bad of ['', 'Love-Ink', '1abc', 'ab', 'a'.repeat(31), 'love_ink']) assert.throws(() => assertProjectId(bad), /firebase_project_id/);
  assert.deepEqual(parseTargets('hosting, firestore:rules,hosting'), ['hosting', 'firestore:rules']);
  assert.deepEqual(parseTargets(''), ['hosting']);
  assert.throws(() => parseTargets('functions'), /unknown entries functions/);
  assert.throws(() => parseTargets(' , '), /empty/);
  assert.equal(assertExactVersion('firebase_tools_version', '15.35.0', KNOWN_BROKEN.firebaseTools), '15.35.0');
  for (const bad of ['15', '^15.35.0', 'latest', '15.35']) assert.throws(() => assertExactVersion('x', bad), /exact version/);
  assert.throws(() => assertExactVersion('firebase_tools_version', '15.22.2', KNOWN_BROKEN.firebaseTools), /known broken.*15\.22\.3/);
  assert.throws(() => assertExactVersion('node_version', '22.23.0', KNOWN_BROKEN.node), /known broken/);
  assert.throws(() => assertExactVersion('node_version', '24.17.0', KNOWN_BROKEN.node), /known broken/);
});

test('identity inputs are shape-checked only, and optional in plan mode', () => {
  assert.deepEqual(assertIdentity({ mode: 'plan', provider: '', serviceAccount: '' }), { provider: '', serviceAccount: '' });
  assert.deepEqual(assertIdentity({ mode: 'preview', provider: PROVIDER, serviceAccount: SA }), { provider: PROVIDER, serviceAccount: SA });
  assert.throws(() => assertIdentity({ mode: 'preview', provider: '', serviceAccount: SA }), /workload_identity_provider/);
  assert.throws(() => assertIdentity({ mode: 'production', provider: 'projects/love-ink/locations/global/workloadIdentityPools/github/providers/x', serviceAccount: SA }), /workload_identity_provider/);
  assert.throws(() => assertIdentity({ mode: 'production', provider: PROVIDER, serviceAccount: 'me@gmail.com' }), /service_account/);
  assert.throws(() => assertIdentity({ mode: 'production', provider: PROVIDER, serviceAccount: '{"type":"service_account"}' }), /service_account/);
});

test('preview channels never target live and are normalized to Firebase-safe ids', () => {
  assert.equal(resolveChannel({ mode: 'production', channel: 'anything', refName: 'main' }), 'live');
  assert.equal(resolveChannel({ mode: 'plan', channel: '', refName: 'main' }), 'live');
  assert.equal(resolveChannel({ mode: 'preview', channel: '', refName: 'feat/Site v2' }), 'feat-site-v2');
  assert.equal(resolveChannel({ mode: 'preview', channel: 'pr-42', refName: 'main' }), 'pr-42');
  assert.equal(resolveChannel({ mode: 'preview', channel: '', refName: 'x'.repeat(80) }).length, 63);
  assert.throws(() => resolveChannel({ mode: 'preview', channel: 'live', refName: 'main' }), /live/);
  assert.throws(() => resolveChannel({ mode: 'preview', channel: 'LIVE', refName: 'main' }), /live/);
  assert.throws(() => resolveChannel({ mode: 'preview', channel: '///', refName: '' }), /empty/);
});

test('production guard: only the production branch of the consumer itself, never pull requests or forks', () => {
  const ok = { mode: 'production', eventName: 'push', ref: 'refs/heads/main', productionBranch: 'main', repository: 'o/r', headRepository: 'o/r' };
  assert.equal(assertProductionGuard(ok).allowed, true);
  assert.equal(assertProductionGuard({ ...ok, eventName: 'workflow_dispatch' }).allowed, true);
  assert.equal(assertProductionGuard({ ...ok, eventName: 'schedule' }).allowed, true);
  assert.throws(() => assertProductionGuard({ ...ok, ref: 'refs/heads/feat' }), /expected refs\/heads\/main/);
  assert.throws(() => assertProductionGuard({ ...ok, ref: 'refs/tags/v1' }), /expected refs\/heads\/main/);
  assert.throws(() => assertProductionGuard({ ...ok, ref: 'refs/pull/7/merge', eventName: 'pull_request' }), /pull_request/);
  assert.throws(() => assertProductionGuard({ ...ok, eventName: 'pull_request_target' }), /pull_request_target/);
  assert.throws(() => assertProductionGuard({ ...ok, eventName: 'workflow_run' }), /workflow_run/);
  assert.throws(() => assertProductionGuard({ ...ok, headRepository: 'evil/r' }), /fork/);
  assert.throws(() => assertProductionGuard({ ...ok, productionBranch: '' }), /production_branch/);
  assert.equal(assertProductionGuard({ ...ok, mode: 'preview', ref: 'refs/pull/7/merge', eventName: 'pull_request' }).allowed, true);
  assert.equal(assertProductionGuard({ ...ok, mode: 'plan', ref: 'refs/pull/7/merge', eventName: 'pull_request' }).allowed, false);
});

// --- firebase.json and public directory --------------------------------------------------------------------

test('firebase.json: missing, invalid, single or multi-site hosting', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'fb-'));
  assert.throws(() => readHostingConfig(empty), /firebase\.json not found/);
  writeFileSync(path.join(empty, 'firebase.json'), '{');
  assert.throws(() => readHostingConfig(empty), /not valid JSON/);
  const single = site();
  assert.equal(readHostingConfig(single).hosting.public, 'public');
  const multi = site({ hosting: [{ target: 'www', public: 'public' }, { target: 'docs', public: 'docs' }] });
  assert.throws(() => readHostingConfig(multi), /hosting_target/);
  assert.equal(readHostingConfig(multi, 'docs').hosting.public, 'docs');
  const one = site({ hosting: [{ site: 'only', public: 'public' }] });
  assert.equal(readHostingConfig(one).hosting.site, 'only');
});

test('public directory must exist with index.html and is measured', () => {
  const dir = site({ extraFiles: [['public/css/a.css', 'body{}']] });
  const { hosting } = readHostingConfig(dir);
  const r = inspectPublicDir({ siteDir: dir, hosting, workspace: dir });
  assert.deepEqual([r.files, r.publishesCheckout, r.publicRel], [2, false, 'public']);
  assert.ok(r.bytes > 0);
  assert.throws(() => inspectPublicDir({ siteDir: dir, hosting: { public: 'dist' }, workspace: dir }), /not a directory/);
  assert.throws(() => inspectPublicDir({ siteDir: dir, hosting: null, workspace: dir }), /no "hosting"/);
  const noIndex = site({ publicDir: 'dist' });
  writeFileSync(path.join(noIndex, 'dist', 'index.html'), '');
  mkdirSync(path.join(noIndex, 'out'));
  assert.throws(() => inspectPublicDir({ siteDir: noIndex, hosting: { public: 'out' }, workspace: noIndex }), /no index\.html/);
});

test('security: credential-looking files in the public directory fail the contract in every mode', () => {
  const cases = [
    ['public/gha-creds-abc123.json', '{"type":"external_account"}'],
    ['public/assets/gha-creds-x.json', '{}'],
    ['public/love-ink-service-account.json', '{}'],
    ['public/config.json', '{"type": "service_account", "private_key": "-----BEGIN"}'],
    ['public/adc.json', '{"refresh_token": "1//x", "type":"authorized_user"}'],
    ['public/.env', 'FIREBASE_TOKEN=x'],
    ['public/.env.production', 'FIREBASE_TOKEN=x'],
    ['public/server/.env.local', 'FIREBASE_TOKEN=x'],
    ['public/application_default_credentials.json', '{}'],
  ];
  for (const [rel, content] of cases) {
    const dir = site({ extraFiles: [[rel, content]] });
    const { hosting } = readHostingConfig(dir);
    assert.throws(() => inspectPublicDir({ siteDir: dir, hosting, workspace: dir }), /credential-looking files/, rel);
    assert.throws(() => buildPlan(env(dir)), /credential-looking files/, `${rel} in plan mode`);
  }
  const harmless = site({ extraFiles: [['public/data/site.json', '{"name":"Love Ink","type":"website"}'], ['public/manifest.json', '{"icons":[]}']] });
  assert.equal(buildPlan(env(harmless)).files, 3);
  // Committed templates hold placeholders: they must not block a deployment.
  for (const name of ['.env.example', '.env.sample', '.env.template', '.env.dist']) {
    const tpl = site({ extraFiles: [[`public/server/mailer/${name}`, 'SMTP_PASS=']] });
    assert.equal(buildPlan(env(tpl)).files, 2, name);
  }
});

test('security: publishing the checkout (hosting.public ".") requires hosting.ignore to exclude credentials and dotfiles', () => {
  const noIgnore = site({ publicDir: '.' });
  assert.throws(() => buildPlan(env(noIgnore)), /hosting\.ignore must contain "\*\*\/gha-creds-\*\.json"/);
  const onlyCreds = site({ publicDir: '.', ignore: ['**/gha-creds-*.json'] });
  assert.throws(() => buildPlan(env(onlyCreds)), /must contain "\*\*\/\.\*"/);
  const good = site({ publicDir: '.', ignore: ['firebase.json', '**/.*', '**/node_modules/**', '**/gha-creds-*.json'], extraFiles: [['.git/HEAD', 'ref'], ['node_modules/x/index.js', '']] });
  const plan = buildPlan(env(good));
  assert.equal(plan.publishesCheckout, true);
  assert.equal(plan.files, 2, '.git and node_modules are not counted when publishing the checkout');
  assert.deepEqual(plan.warnings, []);
  const subdir = site({ publicDir: 'public' });
  assert.match(buildPlan(env(subdir)).warnings[0], /recommended defense in depth/);
});

test('firestore targets need firebase.json entries and existing files, and are refused in preview', () => {
  const noFs = site();
  assert.throws(() => inspectFirestore({ siteDir: noFs, config: {}, targets: ['hosting', 'firestore:rules'] }), /no "firestore"/);
  const dir = site({ firestore: { rules: 'firestore.rules' }, extraFiles: [['firestore.rules', 'rules_version = "2";']] });
  const { config } = readHostingConfig(dir);
  assert.deepEqual(inspectFirestore({ siteDir: dir, config, targets: ['hosting'] }), { rules: '', indexes: '' });
  assert.deepEqual(inspectFirestore({ siteDir: dir, config, targets: ['firestore:rules'] }), { rules: 'firestore.rules', indexes: '' });
  assert.throws(() => inspectFirestore({ siteDir: dir, config, targets: ['firestore:indexes'] }), /firestore\.indexes is not set/);
  const missing = site({ firestore: { indexes: 'firestore.indexes.json' } });
  assert.throws(() => buildPlan(env(missing, { FIREBASE_TARGETS: 'firestore:indexes' })), /not found in site_dir/);
  assert.throws(() => buildPlan(env(dir, { FIREBASE_MODE: 'preview', FIREBASE_TARGETS: 'hosting,firestore:rules' })), /preview mode only supports the hosting target/);
  assert.equal(buildPlan(env(dir, { FIREBASE_MODE: 'production', FIREBASE_TARGETS: 'hosting,firestore:rules' })).only, 'hosting,firestore:rules');
});

test('commit consistency: a pinned checkout_ref must be the checked out commit', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(assertCommitConsistency({ expectedSha: sha, headSha: sha }), { pinned: true });
  assert.deepEqual(assertCommitConsistency({ expectedSha: '', headSha: sha }), { pinned: false });
  assert.deepEqual(assertCommitConsistency({ expectedSha: 'main', headSha: sha }), { pinned: false });
  assert.throws(() => assertCommitConsistency({ expectedSha: sha, headSha: 'b'.repeat(40) }), /does not match/);
});

test('credentials directory must be outside the workspace and the public directory', () => {
  const ws = mkdtempSync(path.join(tmpdir(), 'ws-'));
  assert.equal(assertCredentialsDir({ credentialsDir: path.join(tmpdir(), 'creds'), workspace: ws, publicDir: ws }), path.join(tmpdir(), 'creds'));
  assert.throws(() => assertCredentialsDir({ credentialsDir: path.join(ws, 'creds'), workspace: ws }), /inside the workspace/);
  assert.throws(() => assertCredentialsDir({ credentialsDir: ws, workspace: ws }), /inside the workspace/);
  assert.throws(() => assertCredentialsDir({ credentialsDir: '', workspace: ws }), /empty/);
});

// --- end-to-end plan --------------------------------------------------------------------------------------------

test('buildPlan: plan mode runs without any identity input and never deploys', () => {
  const dir = site();
  const plan = buildPlan(env(dir, { FIREBASE_WORKLOAD_IDENTITY_PROVIDER: '', FIREBASE_SERVICE_ACCOUNT: '', FIREBASE_CREDENTIALS_DIR: '' }));
  assert.deepEqual([plan.deploy, plan.channel, plan.only, plan.credentialsDir], [false, 'live', 'hosting', '']);
});

test('buildPlan: preview derives the channel, production uses live and the production branch', () => {
  const dir = site();
  const preview = buildPlan(env(dir, { FIREBASE_MODE: 'preview', FIREBASE_REF: 'refs/pull/3/merge', FIREBASE_REF_NAME: '3/merge', FIREBASE_EVENT_NAME: 'pull_request' }));
  assert.deepEqual([preview.deploy, preview.channel], [true, '3-merge']);
  const prod = buildPlan(env(dir, { FIREBASE_MODE: 'production', FIREBASE_HOSTING_TARGET: '' }));
  assert.deepEqual([prod.deploy, prod.channel, prod.guard.reason], [true, 'live', 'push on refs/heads/main']);
  assert.throws(() => buildPlan(env(dir, { FIREBASE_MODE: 'production', FIREBASE_REF: 'refs/heads/develop' })), /production deployment refused/);
  assert.throws(() => buildPlan(env(dir, { FIREBASE_MODE: 'production', FIREBASE_WORKLOAD_IDENTITY_PROVIDER: '' })), /workload_identity_provider/);
  assert.throws(() => buildPlan(env(dir, { FIREBASE_MODE: 'production', FIREBASE_CREDENTIALS_DIR: path.join(dir, 'c') })), /inside the workspace/);
});

test('buildPlan: multi-site hosting target is carried into --only', () => {
  const dir = site({ hosting: [{ target: 'www', public: 'public' }, { target: 'docs', public: 'public' }] });
  assert.equal(buildPlan(env(dir, { FIREBASE_MODE: 'production', FIREBASE_HOSTING_TARGET: 'www', FIREBASE_TARGETS: 'hosting' })).only, 'hosting:www');
});
