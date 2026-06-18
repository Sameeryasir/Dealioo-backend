import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function getEncryptionKey(): string | undefined {
  return process.env.TOKEN_ENCRYPTION_KEY?.trim();
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    return plaintext;
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(key), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(stored: string): string {
  const trimmed = stored?.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (!trimmed.startsWith('enc:v1:')) {
    return trimmed;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is required to decrypt stored tokens.',
    );
  }

  const parts = trimmed.split(':');
  if (parts.length !== 5) {
    throw new Error('Invalid encrypted token format.');
  }

  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const ciphertext = Buffer.from(parts[4], 'base64url');

  const decipher = createDecipheriv(ALGORITHM, deriveKey(key), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
