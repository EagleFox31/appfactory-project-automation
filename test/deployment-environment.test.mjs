import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDeploymentEnvironment} from '../scripts/deployment/deployment-environment.mjs';

test('existing staging consumers keep their default and lifecycle', () => {
  assert.equal(validateDeploymentEnvironment({lifecycle: 'ephemeral'}).environment, 'staging');
  assert.equal(validateDeploymentEnvironment({lifecycle: 'persistent'}).environment, 'staging');
});
test('production needs a persistent, exactly identified existing host and HTTPS origin', () => {
  const valid = {environment: 'production', lifecycle: 'persistent',
    instanceId: 'i-0ce97ff971dd343b2', publicOrigin: 'https://precis-translator.trigenys.com'};
  assert.deepEqual(validateDeploymentEnvironment(valid), valid);
  for (const patch of [
    {environment: 'prod'}, {lifecycle: 'ephemeral'}, {instanceId: ''},
    {instanceId: 'i-*'}, {publicOrigin: 'http://example.test'},
    {publicOrigin: 'https://user:secret@example.test'}, {publicOrigin: 'https://localhost'},
    {publicOrigin: 'https://example.test/path'}, {publicOrigin: 'https://example.test/?token=secret'}
  ]) assert.throws(() => validateDeploymentEnvironment({...valid, ...patch}));
});
