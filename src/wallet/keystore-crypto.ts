/**
 * Web3 Secret Storage V3 Keystore Decryption
 *
 * Implements Ethereum keystore decryption supporting both scrypt and PBKDF2 KDFs.
 * Based on: https://github.com/ethereum/wiki/wiki/Web3-Secret-Storage-Definition
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  scryptSync,
} from 'crypto';
import { EncryptionError } from '../utils/errors.js';

/**
 * Keystore V3 JSON structure (Ethereum Web3 Secret Storage)
 */
export interface KeystoreV3 {
  version: 3;
  id: string;
  address: string;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: {
      iv: string;
    };
    kdf: 'scrypt' | 'pbkdf2';
    kdfparams: ScryptParams | Pbkdf2Params;
    mac: string;
  };
}

export interface ScryptParams {
  dklen: number;
  n: number;
  p: number;
  r: number;
  salt: string;
}

export interface Pbkdf2Params {
  dklen: number;
  c: number;
  prf: string;
  salt: string;
}

function isScryptParams(params: ScryptParams | Pbkdf2Params): params is ScryptParams {
  return 'n' in params && 'r' in params && 'p' in params;
}

function isPbkdf2Params(params: ScryptParams | Pbkdf2Params): params is Pbkdf2Params {
  return 'c' in params && 'prf' in params;
}

/**
 * Derive key using scrypt KDF
 */
function deriveKeyScrypt(password: string, params: ScryptParams): Buffer {
  const salt = Buffer.from(params.salt, 'hex');
  return scryptSync(password, salt, params.dklen, {
    N: params.n,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.n * params.r * 2, // Allow enough memory for large N values
  });
}

/**
 * Derive key using PBKDF2 KDF
 */
function deriveKeyPbkdf2(password: string, params: Pbkdf2Params): Buffer {
  const salt = Buffer.from(params.salt, 'hex');

  // Map PRF to digest algorithm
  let digest: string;
  switch (params.prf) {
    case 'hmac-sha256':
      digest = 'sha256';
      break;
    case 'hmac-sha512':
      digest = 'sha512';
      break;
    default:
      throw new EncryptionError(`Unsupported PBKDF2 PRF: ${params.prf}`);
  }

  return pbkdf2Sync(password, salt, params.c, params.dklen, digest);
}

/**
 * Calculate MAC for keystore verification
 */
function calculateMac(derivedKey: Buffer, ciphertext: Buffer): string {
  // MAC = keccak256(last 16 bytes of derived key + ciphertext)
  const macContent = Buffer.concat([
    derivedKey.subarray(16, 32),
    ciphertext,
  ]);
  return createHash('sha3-256').update(macContent).digest('hex');
}

/**
 * Validate keystore JSON structure
 */
export function isKeystoreV3(data: unknown): data is KeystoreV3 {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 3) {
    return false;
  }

  if (typeof obj.crypto !== 'object' || obj.crypto === null) {
    return false;
  }

  const crypto = obj.crypto as Record<string, unknown>;

  return (
    typeof crypto.cipher === 'string' &&
    typeof crypto.ciphertext === 'string' &&
    typeof crypto.cipherparams === 'object' &&
    typeof crypto.kdf === 'string' &&
    typeof crypto.kdfparams === 'object' &&
    typeof crypto.mac === 'string'
  );
}

/**
 * Decrypt a Web3 Secret Storage V3 keystore to retrieve the private key
 *
 * @param keystore - The keystore JSON object
 * @param password - The password to decrypt with
 * @returns The private key as a hex string with 0x prefix
 */
export function decryptKeystoreV3(keystore: KeystoreV3, password: string): string {
  try {
    const { crypto } = keystore;

    // Derive key based on KDF
    let derivedKey: Buffer;

    if (crypto.kdf === 'scrypt') {
      if (!isScryptParams(crypto.kdfparams)) {
        throw new EncryptionError('Invalid scrypt parameters');
      }
      derivedKey = deriveKeyScrypt(password, crypto.kdfparams);
    } else if (crypto.kdf === 'pbkdf2') {
      if (!isPbkdf2Params(crypto.kdfparams)) {
        throw new EncryptionError('Invalid PBKDF2 parameters');
      }
      derivedKey = deriveKeyPbkdf2(password, crypto.kdfparams);
    } else {
      throw new EncryptionError(`Unsupported KDF: ${crypto.kdf}`);
    }

    // Verify MAC
    const ciphertext = Buffer.from(crypto.ciphertext, 'hex');
    const calculatedMac = calculateMac(derivedKey, ciphertext);

    if (calculatedMac.toLowerCase() !== crypto.mac.toLowerCase()) {
      throw new EncryptionError('MAC verification failed - invalid password');
    }

    // Decrypt ciphertext
    if (crypto.cipher !== 'aes-128-ctr') {
      throw new EncryptionError(`Unsupported cipher: ${crypto.cipher}`);
    }

    const iv = Buffer.from(crypto.cipherparams.iv, 'hex');
    const encryptionKey = derivedKey.subarray(0, 16); // First 16 bytes for AES-128

    const decipher = createDecipheriv('aes-128-ctr', encryptionKey, iv);
    const privateKey = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    // Clear sensitive data
    derivedKey.fill(0);
    encryptionKey.fill(0);

    return `0x${privateKey.toString('hex')}`;
  } catch (error) {
    if (error instanceof EncryptionError) {
      throw error;
    }
    throw new EncryptionError('Failed to decrypt keystore', error);
  }
}

/**
 * Encrypt a private key to Web3 Secret Storage V3 format using scrypt KDF
 *
 * @param privateKey - The private key (hex string with or without 0x prefix)
 * @param password - The password to encrypt with
 * @param address - The Ethereum address for the keystore
 * @returns KeystoreV3 JSON object
 */
export function encryptToKeystoreV3(
  privateKey: string,
  password: string,
  address: string
): KeystoreV3 {
  // Normalize private key
  const normalizedKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const privateKeyBuffer = Buffer.from(normalizedKey, 'hex');

  // Generate random salt and IV
  const salt = randomBytes(32);
  const iv = randomBytes(16);

  // Scrypt parameters (Foundry defaults)
  const scryptParams: ScryptParams = {
    n: 262144, // 2^18 - Foundry default
    r: 8,
    p: 1,
    dklen: 32,
    salt: salt.toString('hex'),
  };

  // Derive key using scrypt
  const derivedKey = scryptSync(password, salt, scryptParams.dklen, {
    N: scryptParams.n,
    r: scryptParams.r,
    p: scryptParams.p,
    maxmem: 128 * scryptParams.n * scryptParams.r * 2,
  });

  // Encrypt with AES-128-CTR
  const encryptionKey = derivedKey.subarray(0, 16);
  const cipher = createCipheriv('aes-128-ctr', encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKeyBuffer),
    cipher.final(),
  ]);

  // Calculate MAC
  const mac = calculateMac(derivedKey, ciphertext);

  // Clear sensitive data
  privateKeyBuffer.fill(0);
  derivedKey.fill(0);
  encryptionKey.fill(0);

  // Normalize address
  const normalizedAddress = address.startsWith('0x') ? address.slice(2).toLowerCase() : address.toLowerCase();

  return {
    version: 3,
    id: randomUUID(),
    address: normalizedAddress,
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: ciphertext.toString('hex'),
      cipherparams: {
        iv: iv.toString('hex'),
      },
      kdf: 'scrypt',
      kdfparams: scryptParams,
      mac,
    },
  };
}
