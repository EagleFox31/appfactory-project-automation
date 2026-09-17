export function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function base64UrlDecode(value) {
  const normalized = String(value ?? '').replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Invalid base64url value.');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function utf8Encode(value) {
  return new TextEncoder().encode(String(value));
}

export function utf8Decode(value) {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}
