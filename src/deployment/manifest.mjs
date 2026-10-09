import { validateSourceSha, createImageMatrix } from './contract.mjs';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/;
function fail(reason) { throw new Error('Container release manifest: ' + reason); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + ' must be an object');
  return value;
}
function exactKeys(obj, allowed, label) {
  if (Object.keys(obj).sort().join(',') !== [...allowed].sort().join(','))
    fail(label + ' has missing or unexpected fields');
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(label + ' must be a positive integer');
  return value;
}
export function validateImageReceipt(raw, expected) {
  const receipt = object(raw, 'receipt');
  exactKeys(receipt, ['name', 'image', 'sourceSha', 'digest'], 'receipt');
  if (receipt.name !== expected.name || receipt.image !== expected.image
      || receipt.sourceSha !== expected.sha) fail('receipt does not match the trusted build matrix');
  if (typeof receipt.digest !== 'string' || !DIGEST.test(receipt.digest))
    fail('image digest is missing or mutable');
  return { name: expected.name, image: expected.image, digest: receipt.digest,
    ref: expected.image + '@' + receipt.digest, platforms: expected.platforms.split(',') };
}
export function assembleReleaseManifest({ config, repository, sourceSha,
  ciRunId, buildRunId, receipts, createdAt }) {
  validateSourceSha(sourceSha);
  if (!REPOSITORY.test(repository.toLowerCase())) fail('invalid repository');
  positiveInteger(ciRunId, 'CI run ID');
  positiveInteger(buildRunId, 'build run ID');
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)))
    fail('invalid creation time');
  if (!Array.isArray(receipts)) fail('receipts must be a list');
  const matrix = createImageMatrix(config, sourceSha).include;
  if (receipts.length !== matrix.length) fail('image receipt count mismatch');
  const seen = new Set();
  const images = [];
  for (const entry of receipts) {
    const name = entry?.name;
    if (seen.has(name)) fail('duplicate image receipt: ' + name);
    seen.add(name);
    const expected = matrix.find(row => row.name === name);
    if (!expected) fail('unknown image receipt: ' + name);
    images.push(validateImageReceipt(entry, expected));
  }
  images.sort((a,b) => a.name.localeCompare(b.name));
  return {
    schemaVersion: 1,
    repository,
    projectId: config.projectId,
    environment: config.environment,
    sourceSha,
    ciRunId,
    buildRunId,
    createdAt,
    images
  };
}
export function validateReleaseManifest(raw, { config, repository, sourceSha,
  ciRunId, buildRunId } = {}) {
  const manifest = object(raw, 'manifest');
  exactKeys(manifest, ['schemaVersion', 'repository', 'projectId', 'environment',
    'sourceSha', 'ciRunId', 'buildRunId', 'createdAt', 'images'], 'manifest');
  if (manifest.schemaVersion !== 1) fail('unsupported schema');
  const expected = assembleReleaseManifest({
    config, repository, sourceSha, ciRunId, buildRunId,
    receipts: objectReceipts(manifest.images, sourceSha), createdAt: manifest.createdAt
  });
  if (manifest.repository !== expected.repository
      || manifest.projectId !== expected.projectId
      || manifest.environment !== expected.environment
      || manifest.sourceSha !== expected.sourceSha
      || manifest.ciRunId !== expected.ciRunId
      || manifest.buildRunId !== expected.buildRunId) fail('release identity mismatch');
  const expectedRows = new Map(expected.images.map(item => [item.name,item]));
  for (const image of manifest.images) {
    const actual = object(image,'image');
    exactKeys(actual, ['name','image','digest','ref','platforms'], 'image');
    const signed = expectedRows.get(actual.name);
    if (!signed || actual.image !== signed.image || actual.digest !== signed.digest
        || actual.ref !== signed.ref
        || JSON.stringify(actual.platforms) !== JSON.stringify(signed.platforms))
      fail('image reference/platform mismatch: ' + actual.name);
  }
  return expected;
}
function objectReceipts(images, sourceSha) {
  if (!Array.isArray(images)) fail('manifest images must be an array');
  return images.map(row => ({
    name: row?.name, image: row?.image,
    sourceSha, digest: row?.digest
  }));
}
