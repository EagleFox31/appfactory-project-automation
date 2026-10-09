import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plan = readFileSync(new URL('../.github/workflows/reusable-container-plan.yml', import.meta.url), 'utf8');
const publish = readFileSync(new URL('../.github/workflows/reusable-container-build.yml', import.meta.url), 'utf8');

test('PR-safe reusable plan never declares write permissions, GHCR or AWS actions',()=>{
  assert.match(plan,/name: Reusable container plan \(read-only\)/);
  assert.match(plan,/APPFACTORY_DEPLOY_MODE: plan/);
  assert.match(plan,/contents: read/);
  assert.doesNotMatch(plan,/packages: write|id-token: write|docker\/build-push|docker\/login-action|aws-actions|configure-aws/);
  assert.doesNotMatch(plan,/secrets\.|workflow_run:/);
});
test('GHCR publisher only accepts trusted publish mode and never handles PR plan mode',()=>{
  assert.match(publish,/APPFACTORY_DEPLOY_MODE: publish/);
  assert.match(publish,/packages: write/);
  assert.match(publish,/docker\/build-push-action@v6/);
  assert.doesNotMatch(publish,/default: plan|mode: plan|APPFACTORY_DEPLOY_MODE: \$\{\{ inputs\.mode \}\}/);
});
