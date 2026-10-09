import { existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\$)(?!.*[\r\n])[A-Za-z0-9_./-]+$/;
const PLATFORMS = new Set(['linux/amd64', 'linux/arm64']);
function fail(field, reason) { throw new Error(field + ': ' + reason); }
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'must be an object');
  return value;
}
function onlyKeys(value, allowed, field) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(field, 'unknown key: ' + key);
}
function string(value, field, re, max = 200) {
  if (typeof value !== 'string' || !value || value.length > max || !re.test(value)) fail(field, 'invalid');
  return value;
}
function unique(values, field) { if (new Set(values).size !== values.length) fail(field, 'duplicates'); }
function repoPath(value, root, field, kind = 'file') {
  string(value, field, PATH, 240);
  if (value.startsWith('./') || value.includes('//') || value.includes('/./')) fail(field, 'noncanonical');
  const destination = resolve(root, value);
  if (!existsSync(destination)) fail(field, 'does not exist');
  const actual = realpathSync(destination), base = realpathSync(root);
  if (actual !== base && !actual.startsWith(base + sep)) fail(field, 'traverses checkout');
  if (actual === base && kind !== 'directory') fail(field, 'cannot use checkout root as file');
  const stat = statSync(destination);
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) fail(field, 'incorrect file type');
  return value;
}
function platforms(value, field) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2
      || value.some(x => !PLATFORMS.has(x))) fail(field, 'unsupported architecture');
  unique(value, field);
  return value;
}
function deployment(value, projectId, environment, images) {
  object(value, 'deployment');
  onlyKeys(value, ['transport', 'region', 'roleArn', 'instanceId',
    'ssmParameterPrefix', 'healthPath', 'composeProject', 'serviceNames',
    'imageServices', 'backupKinds', 'healthUrl',
    'runtimeEnvTarget', 'predeployHook'], 'deployment');
  if (value.transport !== 'aws-ssm') fail('deployment.transport', 'only aws-ssm supported');
  string(value.region, 'deployment.region', /^[a-z]{2}(?:-[a-z]+)+-\d+$/);
  string(value.roleArn, 'deployment.roleArn', /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/);
  string(value.instanceId, 'deployment.instanceId', /^i-(?:[a-f0-9]{8}|[a-f0-9]{17})$/);
  if (value.ssmParameterPrefix !== '/appfactory/' + projectId + '/' + environment + '/')
    fail('deployment.ssmParameterPrefix', 'wrong application/environment');
  if (value.composeProject !== projectId + '-' + environment)
    fail('deployment.composeProject', 'wrong application/environment');
  string(value.healthPath, 'deployment.healthPath', /^\/[A-Za-z0-9_./-]*$/, 120);
  if (value.healthPath.includes('..') || value.healthPath.includes('//')) fail('deployment.healthPath', 'invalid');
  if (!Array.isArray(value.serviceNames) || value.serviceNames.length < 1) fail('deployment.serviceNames', 'required');
  value.serviceNames.forEach((n,i) => string(n, 'deployment.serviceNames[' + i + ']', SLUG));
  unique(value.serviceNames, 'deployment.serviceNames');
  if (value.imageServices !== undefined) {
    object(value.imageServices, 'deployment.imageServices');
    const imageNames = images.map(image => image.name).sort();
    if (Object.keys(value.imageServices).sort().join('|') !== imageNames.join('|'))
      fail('deployment.imageServices', 'must map every release image exactly once');
    const selected = Object.entries(value.imageServices).map(([image, service]) => {
      string(service, 'deployment.imageServices.' + image, SLUG);
      if (!value.serviceNames.includes(service))
        fail('deployment.imageServices', 'service must be in deployment.serviceNames');
      if (['db','postgres','database','redis','mongo','mongodb'].includes(service))
        fail('deployment.imageServices', 'cannot replace a stateful service directly');
      return service;
    });
    unique(selected, 'deployment.imageServices');
  }
  if (value.backupKinds !== undefined) {
    if (!Array.isArray(value.backupKinds) || !value.backupKinds.length
        || value.backupKinds.length > 8) fail('deployment.backupKinds', 'invalid');
    value.backupKinds.forEach((kind,i) => string(kind, 'deployment.backupKinds['+i+']', SLUG));
    unique(value.backupKinds, 'deployment.backupKinds');
  }
  for (const field of ['runtimeEnvTarget', 'predeployHook']) {
    if (value[field] !== undefined) {
      string(value[field], 'deployment.' + field, PATH, 240);
      if (value[field].startsWith('./') || value[field].includes('//')
          || value[field].includes('/./')) fail('deployment.' + field, 'unsafe path');
    }
  }
  if (value.runtimeEnvTarget !== undefined
      && !value.runtimeEnvTarget.split('/').at(-1).startsWith('.env'))
    fail('deployment.runtimeEnvTarget', 'must be a dedicated .env file');
  if (value.healthUrl !== undefined) {
    string(value.healthUrl, 'deployment.healthUrl',
      /^http:\/\/127\.0\.0\.1(?::[1-9][0-9]{1,4})?\/[A-Za-z0-9_./-]*$/, 200);
    if (value.healthUrl.includes('..') || value.healthUrl.includes('//', 8))
      fail('deployment.healthUrl', 'unsafe localhost health path');
  }
  return value;
}
export function validateSourceSha(value) {
  return string(value, 'source_sha', /^[a-fA-F0-9]{40}$/, 40).toLowerCase();
}
export function validateContainerConfig(raw, { repository, root = process.cwd() } = {}) {
  object(raw, 'config');
  onlyKeys(raw, ['schemaVersion', 'projectId', 'environment', 'releaseBranch', 'releaseMarker',
    'composePath', 'platforms', 'images', 'deployment'], 'config');
  if (raw.schemaVersion !== 1) fail('schemaVersion', 'must equal 1');
  string(repository, 'repository', REPO);
  const projectId = string(raw.projectId, 'projectId', SLUG, 64);
  const environment = string(raw.environment, 'environment', SLUG, 32);
  const releaseBranch = string(raw.releaseBranch, 'releaseBranch', /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/, 120);
  if (releaseBranch.includes('..') || releaseBranch.includes('//') || releaseBranch.endsWith('/'))
    fail('releaseBranch', 'unsafe');
  const releaseMarker = repoPath(raw.releaseMarker, root, 'releaseMarker');
  const composePath = repoPath(raw.composePath, root, 'composePath');
  const defaults = platforms(raw.platforms, 'platforms');
  if (!Array.isArray(raw.images) || raw.images.length < 1 || raw.images.length > 6)
    fail('images', 'must contain 1-6 images');
  const images = raw.images.map((row, index) => {
    const field = 'images[' + index + ']';
    object(row, field);
    onlyKeys(row, ['name', 'dockerfile', 'context', 'platforms'], field);
    const name = string(row.name, field + '.name', SLUG, 40);
    const dockerfile = repoPath(row.dockerfile, root, field + '.dockerfile');
    const context = repoPath(row.context, root, field + '.context', 'directory');
    const acceptedPlatforms = platforms(row.platforms ?? defaults, field + '.platforms');
    const image = 'ghcr.io/' + repository.toLowerCase() + '-' + name;
    return { name, dockerfile, context, platforms: acceptedPlatforms.join(','), image };
  });
  unique(images.map(x => x.name), 'images');
  return { schemaVersion: 1, projectId, environment, releaseBranch, releaseMarker,
    composePath, platforms: defaults, images,
    deployment: raw.deployment === undefined ? null : deployment(raw.deployment, projectId, environment, images) };
}
export function publishEligibility({ mode, eventName, event, repository, sha, config, markerChanged }) {
  if (mode !== 'plan' && mode !== 'publish') fail('mode', 'expected plan or publish');
  if (mode === 'plan') return { eligible: false, reason: 'plan-only: no publishing or cloud changes' };
  if (eventName !== 'workflow_run') fail('publish', 'requires CI workflow_run event');
  const run = event?.workflow_run;
  if (run?.conclusion !== 'success' || run?.event !== 'push')
    fail('publish', 'successful push-based CI required');
  if (run?.head_repository?.full_name !== repository) fail('publish', 'repository mismatch');
  if (run?.head_branch !== config.releaseBranch) fail('publish', 'branch mismatch');
  if (run?.head_sha?.toLowerCase() !== sha) fail('publish', 'source SHA mismatch');
  if (!markerChanged) return { eligible: false, reason: 'not a release: ' + config.releaseMarker + ' unchanged' };
  return { eligible: true, reason: 'CI and release marker validated' };
}
export function createImageMatrix(config, sha) {
  const immutableSha = validateSourceSha(sha);
  return { include: config.images.map(row => ({
    ...row, sha: immutableSha, tag: row.image + ':sha-' + immutableSha
  })) };
}
