/**
 * Cryptography & Key Separation Vault
 * Implements application-level envelope encryption, token hashing, and key separation.
 * Standardized on W3C Web Cryptography API (`crypto.subtle`) for cross-runtime support
 * (Cloudflare Workers / workerd, Node.js 22+, and modern browsers).
 */

export const KEY_DOMAINS = [
  'AUTH',
  'DATABASE',
  'PROVIDER',
  'ENCRYPTION',
  'SIGNING',
  'HONEYTOKEN',
  'WEBHOOK',
] as const;

export type KeyDomain = (typeof KEY_DOMAINS)[number];

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Derive a 256-bit AES-GCM Key Encryption Key using HKDF-SHA256 from a master key. */
async function deriveKey(masterSecret: string, salt: Uint8Array, contextInfo: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const rawKeyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterSecret),
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: enc.encode(`fatorati-vault:${contextInfo}`),
    },
    rawKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a sensitive secret string (e.g. provider refresh token) using AES-256-GCM.
 * Output format: `enc:v1:<salt-b64>:<iv-b64>:<ciphertext-b64>`
 */
export async function encryptSecret(
  plaintext: string,
  masterKey: string,
  contextDomain: KeyDomain = 'ENCRYPTION',
): Promise<string> {
  if (!plaintext) return '';
  if (!masterKey || masterKey.length < 16) {
    throw new Error('Master encryption key must contain at least 16 characters.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterKey, salt, contextDomain);

  const encodedPlaintext = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encodedPlaintext,
  );

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  return `enc:v1:${toBase64(salt)}:${toBase64(iv)}:${toBase64(ciphertextBytes)}`;
}

/**
 * Decrypt an AES-256-GCM encrypted secret string.
 */
export async function decryptSecret(
  encryptedPayload: string,
  masterKey: string,
  contextDomain: KeyDomain = 'ENCRYPTION',
): Promise<string> {
  if (!encryptedPayload) return '';
  if (!encryptedPayload.startsWith('enc:v1:')) {
    throw new Error('Unsupported encryption format.');
  }
  const parts = encryptedPayload.split(':');
  if (parts.length !== 5) {
    throw new Error('Malformed encrypted payload.');
  }

  const salt = fromBase64(parts[2]);
  const iv = fromBase64(parts[3]);
  const ciphertextBytes = fromBase64(parts[4]);

  const key = await deriveKey(masterKey, salt, contextDomain);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertextBytes as BufferSource,
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Compute an HMAC-SHA256 signature / keyed hash of an identifier or token.
 * Suitable for token comparison without storing plaintext tokens.
 */
export async function hmacSha256(data: string, secretKey: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
