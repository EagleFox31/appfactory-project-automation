import test from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlDecode, base64UrlEncode } from '../broker/src/encoding.mjs';
import { decryptTokenBundle, encryptTokenBundle, sha256 } from '../broker/src/crypto.mjs';

const keyMaterial = base64UrlEncode(Uint8Array.from({ length: 32 }, (_, index) => index + 1));

test('broker token encryption round-trips with user-bound authenticated data', async () => {
  const bundle = {
    accessToken: 'ghu_access',
    refreshToken: 'ghr_refresh',
    accessExpiresAt: 2_000,
    refreshExpiresAt: 3_000
  };
  const ciphertext = await encryptTokenBundle({
    bundle,
    context: 'appfactory:github-user:42',
    keyMaterial
  });

  assert.match(ciphertext, /^v1\.[^.]+\.[^.]+$/u);
  assert.doesNotMatch(ciphertext, /ghu_access|ghr_refresh/u);
  assert.deepEqual(await decryptTokenBundle({
    ciphertext,
    context: 'appfactory:github-user:42',
    keyMaterial
  }), bundle);
});

test('broker token encryption rejects another user context and tampering', async () => {
  const ciphertext = await encryptTokenBundle({
    bundle: { accessToken: 'ghu_access', refreshToken: 'ghr_refresh' },
    context: 'appfactory:github-user:42',
    keyMaterial
  });
  await assert.rejects(
    decryptTokenBundle({
      ciphertext,
      context: 'appfactory:github-user:43',
      keyMaterial
    })
  );
  const [version, nonce, payload] = ciphertext.split('.');
  const changed = base64UrlDecode(payload);
  changed[0] ^= 1;
  const tampered = `${version}.${nonce}.${base64UrlEncode(changed)}`;
  await assert.rejects(
    decryptTokenBundle({
      ciphertext: tampered,
      context: 'appfactory:github-user:42',
      keyMaterial
    })
  );
});

test('OAuth state hashes are deterministic and do not retain the raw state', async () => {
  const digest = await sha256('secret-state');
  assert.equal(digest, await sha256('secret-state'));
  assert.notEqual(digest, 'secret-state');
});
