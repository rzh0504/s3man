import { Buffer } from 'buffer';

/**
 * Simple symmetric encryption for config export/import.
 * Uses XOR with a key derived from the app-specific salt + a random IV,
 * then encodes as base64. This prevents credentials from being readable
 * in the exported file while allowing seamless import.
 *
 * Format: base64(iv(16) + xor_encrypted_data)
 */

const APP_SALT = 's3man-config-v2-2026';

/** Derive a repeating key from salt + IV */
function deriveKey(salt: string, iv: Uint8Array): Uint8Array {
  const saltBytes = new TextEncoder().encode(salt);
  const key = new Uint8Array(256);
  for (let i = 0; i < key.length; i++) {
    key[i] = saltBytes[i % saltBytes.length] ^ iv[i % iv.length] ^ ((i * 7 + 13) & 0xff);
  }
  return key;
}

/** XOR data with a repeating key */
function xorTransform(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

/** Encrypt a JSON string → base64 encoded encrypted string */
export function encryptConfig(plaintext: string): string {
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv);

  const key = deriveKey(APP_SALT, iv);
  const data = new TextEncoder().encode(plaintext);
  const encrypted = xorTransform(data, key);

  // Combine: iv + encrypted
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv, 0);
  combined.set(encrypted, iv.length);

  return Buffer.from(combined).toString('base64');
}

/** Decrypt a base64 encrypted string → original JSON string */
export function decryptConfig(encoded: string): string {
  const combined = new Uint8Array(Buffer.from(encoded, 'base64'));

  if (combined.length < 17) {
    throw new Error('Invalid encrypted data');
  }

  const iv = combined.slice(0, 16);
  const encrypted = combined.slice(16);

  const key = deriveKey(APP_SALT, iv);
  const decrypted = xorTransform(encrypted, key);

  return new TextDecoder().decode(decrypted);
}
