import {
  base64UrlDecode,
  base64UrlEncode,
  utf8Decode,
  utf8Encode
} from './encoding.mjs';

const FORMAT_VERSION = 'v1';

async function encryptionKey(keyMaterial, cryptoImpl) {
  const bytes = base64UrlDecode(keyMaterial);
  if (bytes.byteLength !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return cryptoImpl.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptTokenBundle({
  bundle,
  context,
  keyMaterial,
  cryptoImpl = crypto
}) {
  const nonce = cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(keyMaterial, cryptoImpl);
  const ciphertext = await cryptoImpl.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: utf8Encode(context)
    },
    key,
    utf8Encode(JSON.stringify(bundle))
  );
  return [
    FORMAT_VERSION,
    base64UrlEncode(nonce),
    base64UrlEncode(new Uint8Array(ciphertext))
  ].join('.');
}

export async function decryptTokenBundle({
  ciphertext,
  context,
  keyMaterial,
  cryptoImpl = crypto
}) {
  const [version, encodedNonce, encodedCiphertext, ...extras] = String(ciphertext ?? '').split('.');
  if (version !== FORMAT_VERSION || !encodedNonce || !encodedCiphertext || extras.length) {
    throw new Error('Unsupported encrypted token format.');
  }
  const key = await encryptionKey(keyMaterial, cryptoImpl);
  const plaintext = await cryptoImpl.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlDecode(encodedNonce),
      additionalData: utf8Encode(context)
    },
    key,
    base64UrlDecode(encodedCiphertext)
  );
  return JSON.parse(utf8Decode(new Uint8Array(plaintext)));
}

export async function sha256(value, cryptoImpl = crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', utf8Encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export function randomState(cryptoImpl = crypto) {
  return base64UrlEncode(cryptoImpl.getRandomValues(new Uint8Array(32)));
}
