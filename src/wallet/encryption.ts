import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from 'crypto';
import { EncryptionError } from '../utils/errors.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

export interface EncryptedData {
  encrypted: string; // Base64 encoded ciphertext
  iv: string; // Base64 encoded IV
  salt: string; // Base64 encoded salt
  authTag: string; // Base64 encoded auth tag
  version: number; // Encryption version for future upgrades
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

export function encrypt(plaintext: string, password: string): EncryptedData {
  try {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(password, salt);

    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      authTag: authTag.toString('base64'),
      version: 1,
    };
  } catch (error) {
    throw new EncryptionError('Failed to encrypt data', error);
  }
}

export function decrypt(data: EncryptedData, password: string): string {
  try {
    if (data.version !== 1) {
      throw new EncryptionError(`Unsupported encryption version: ${data.version}`);
    }

    const salt = Buffer.from(data.salt, 'base64');
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const key = deriveKey(password, salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(data.encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    if (error instanceof EncryptionError) {
      throw error;
    }
    throw new EncryptionError('Failed to decrypt data - invalid password or corrupted data', error);
  }
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export function isEncrypted(data: unknown): data is EncryptedData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;
  return (
    typeof obj.encrypted === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.salt === 'string' &&
    typeof obj.authTag === 'string' &&
    typeof obj.version === 'number'
  );
}

export function clearSensitiveData(buffer: Buffer): void {
  buffer.fill(0);
}
