/**
 * Foundry Keystore Integration
 *
 * File I/O operations for Foundry's keystore directory (~/.foundry/keystores/).
 * Foundry uses Ethereum Web3 Secret Storage V3 format.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { WalletError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { type KeystoreV3, isKeystoreV3, encryptToKeystoreV3 } from './keystore-crypto.js';

const FOUNDRY_DIR = join(homedir(), '.foundry');
const FOUNDRY_KEYSTORES_DIR = join(FOUNDRY_DIR, 'keystores');

/**
 * Returns the path to Foundry's keystore directory
 */
export function getFoundryKeystorePath(): string {
  return FOUNDRY_KEYSTORES_DIR;
}

function ensureFoundryKeystoreDir(): void {
  if (!existsSync(FOUNDRY_DIR)) {
    mkdirSync(FOUNDRY_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(FOUNDRY_KEYSTORES_DIR)) {
    mkdirSync(FOUNDRY_KEYSTORES_DIR, { recursive: true, mode: 0o700 });
  }
}

function sanitizeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized !== name || !sanitized) {
    throw new WalletError('Invalid wallet name - use only alphanumeric characters, hyphens, and underscores');
  }
  return sanitized;
}

function getFoundryKeystoreFilePath(name: string): string {
  return join(FOUNDRY_KEYSTORES_DIR, sanitizeName(name));
}

/**
 * Check if a Foundry keystore wallet exists
 */
export function foundryWalletExists(name: string): boolean {
  return existsSync(getFoundryKeystoreFilePath(name));
}

/**
 * Read and parse a Foundry keystore JSON file
 */
export function readFoundryKeystore(name: string): KeystoreV3 {
  const filePath = getFoundryKeystoreFilePath(name);

  if (!existsSync(filePath)) {
    throw new WalletError(`Foundry keystore "${name}" not found at ${filePath}`);
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    if (!isKeystoreV3(data)) {
      throw new WalletError(`File "${name}" is not a valid V3 keystore`);
    }

    return data;
  } catch (error) {
    if (error instanceof WalletError) {
      throw error;
    }
    throw new WalletError(`Failed to read Foundry keystore "${name}"`, error);
  }
}

/**
 * Get the Ethereum address from a Foundry keystore file
 */
export function getFoundryWalletAddress(name: string): string {
  const keystore = readFoundryKeystore(name);
  const address = keystore.address.startsWith('0x')
    ? keystore.address
    : `0x${keystore.address}`;
  return address;
}

export interface FoundryWalletInfo {
  name: string;
  address: string;
  path: string;
}

/**
 * List all Foundry keystore wallets with their addresses
 */
export function listFoundryWallets(): FoundryWalletInfo[] {
  if (!existsSync(FOUNDRY_KEYSTORES_DIR)) {
    return [];
  }

  const entries = readdirSync(FOUNDRY_KEYSTORES_DIR);
  const wallets: FoundryWalletInfo[] = [];

  for (const entry of entries) {
    const filePath = join(FOUNDRY_KEYSTORES_DIR, entry);

    // Skip directories
    try {
      if (statSync(filePath).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      if (isKeystoreV3(data)) {
        const address = data.address.startsWith('0x')
          ? data.address
          : `0x${data.address}`;

        wallets.push({
          name: entry,
          address,
          path: filePath,
        });
      }
    } catch {
      logger.warn(`Skipping non-keystore file in Foundry keystores: ${entry}`);
    }
  }

  return wallets;
}

/**
 * Import a private key into Foundry's keystore directory as a V3 keystore
 *
 * @param privateKey - The private key (hex, with or without 0x prefix)
 * @param name - The keystore file name
 * @param password - The encryption password
 * @param address - The Ethereum address for the keystore
 * @returns The path to the created keystore file
 */
export function importToFoundryKeystore(
  privateKey: string,
  name: string,
  password: string,
  address: string,
): string {
  ensureFoundryKeystoreDir();

  const filePath = getFoundryKeystoreFilePath(name);

  if (existsSync(filePath)) {
    throw new WalletError(`Foundry keystore "${name}" already exists at ${filePath}`);
  }

  const keystore = encryptToKeystoreV3(privateKey, password, address);

  writeFileSync(filePath, JSON.stringify(keystore, null, 2), { mode: 0o600 });
  chmodSync(filePath, 0o600);

  logger.info(`Foundry keystore created: ${name} (${address}) at ${filePath}`);

  return filePath;
}
