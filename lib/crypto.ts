import { Buffer } from 'buffer';

/**
 * Symmetric encryption for config export/import.
 *
 * Current format: aes-gcm:<base64(iv(12) + ciphertext + auth tag)>
 * Legacy v2 imports still support the old base64(iv(16) + xor_encrypted_data) format.
 */

const APP_SALT = 's3man-config-v2-2026';
const AES_PREFIX = 'aes-gcm:';

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

function hasSubtleCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

async function deriveAesKey(): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(APP_SALT));
  return crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function decodeBase64(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, 'base64'));
}

function encryptLegacyConfig(plaintext: string): string {
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv);

  const key = deriveKey(APP_SALT, iv);
  const data = new TextEncoder().encode(plaintext);
  const encrypted = xorTransform(data, key);

  // Combine: iv + encrypted
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv, 0);
  combined.set(encrypted, iv.length);

  return encodeBase64(combined);
}

function decryptLegacyConfig(encoded: string): string {
  const combined = decodeBase64(encoded);

  if (combined.length < 17) {
    throw new Error('Invalid encrypted data');
  }

  const iv = combined.slice(0, 16);
  const encrypted = combined.slice(16);

  const key = deriveKey(APP_SALT, iv);
  const decrypted = xorTransform(encrypted, key);

  return new TextDecoder().decode(decrypted);
}

/** Encrypt a JSON string. AES-GCM is used when WebCrypto is available. */
export async function encryptConfig(plaintext: string): Promise<string> {
  if (!hasSubtleCrypto()) {
    return encryptLegacyConfig(plaintext);
  }

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await deriveAesKey();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return AES_PREFIX + encodeBase64(combined);
}

/** Decrypt an encrypted config string. Supports current AES-GCM and legacy v2 XOR. */
export async function decryptConfig(encoded: string): Promise<string> {
  if (!encoded.startsWith(AES_PREFIX)) {
    return decryptLegacyConfig(encoded);
  }

  if (!hasSubtleCrypto()) {
    throw new Error('AES-GCM decryption is unavailable in this runtime');
  }

  const combined = decodeBase64(encoded.slice(AES_PREFIX.length));
  if (combined.length < 13) {
    throw new Error('Invalid encrypted data');
  }

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await deriveAesKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
