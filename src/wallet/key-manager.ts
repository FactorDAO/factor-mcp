import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encrypt, decrypt, isEncrypted, type EncryptedData } from './encryption.js';
import { WalletError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { configManager } from '../config/index.js';
import { decryptKeystoreV3 } from './keystore-crypto.js';
import {
  foundryWalletExists,
  readFoundryKeystore,
  getFoundryWalletAddress,
  listFoundryWallets,
  importToFoundryKeystore,
} from './foundry-keystore.js';

const CONFIG_DIR = join(homedir(), '.factor-mcp');
const WALLETS_DIR = join(CONFIG_DIR, 'wallets');

export type WalletStorageType = 'factor-mcp' | 'foundry-keystore';

export interface WalletData {
  name: string;
  address: string;
  encrypted: boolean;
  privateKey?: string; // Only present if unencrypted
  encryptedKey?: EncryptedData; // Only present if encrypted
  createdAt: string;
}

export interface WalletInfo {
  name: string;
  address: string;
  encrypted: boolean;
  createdAt: string;
  storageType: WalletStorageType;
}

function ensureDirectories(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(WALLETS_DIR)) {
    mkdirSync(WALLETS_DIR, { recursive: true, mode: 0o700 });
  }
}

function getWalletPath(name: string): string {
  // Sanitize name to prevent path traversal
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (sanitized !== name || !sanitized) {
    throw new WalletError('Invalid wallet name - use only alphanumeric characters, hyphens, and underscores');
  }
  return join(WALLETS_DIR, `${sanitized}.json`);
}

/**
 * Detect where a wallet is stored.
 * Checks factor-mcp location first, then Foundry keystore.
 */
export function getWalletStorageType(name: string): WalletStorageType | null {
  ensureDirectories();
  if (existsSync(getWalletPath(name))) {
    return 'factor-mcp';
  }
  if (foundryWalletExists(name)) {
    return 'foundry-keystore';
  }
  return null;
}

/**
 * Check if a wallet exists in either storage location
 */
export function walletExists(name: string): boolean {
  return getWalletStorageType(name) !== null;
}

/**
 * List wallets from the factor-mcp storage only (legacy)
 */
export function listWallets(): WalletInfo[] {
  ensureDirectories();

  if (!existsSync(WALLETS_DIR)) {
    return [];
  }

  const files = readdirSync(WALLETS_DIR).filter(f => f.endsWith('.json'));
  const wallets: WalletInfo[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(WALLETS_DIR, file), 'utf8')) as WalletData;
      wallets.push({
        name: data.name,
        address: data.address,
        encrypted: data.encrypted,
        createdAt: data.createdAt,
        storageType: 'factor-mcp',
      });
    } catch {
      // Skip invalid wallet files
      logger.warn(`Skipping invalid wallet file: ${file}`);
    }
  }

  return wallets;
}

/**
 * List wallets from both factor-mcp and Foundry keystore locations
 */
export function listAllWallets(): WalletInfo[] {
  const factorWallets = listWallets();

  const foundryWallets: WalletInfo[] = listFoundryWallets().map(fw => ({
    name: fw.name,
    address: fw.address,
    encrypted: true, // Foundry keystores are always encrypted
    createdAt: '', // Not available from keystore format
    storageType: 'foundry-keystore' as WalletStorageType,
  }));

  return [...factorWallets, ...foundryWallets];
}

export function importWallet(
  privateKey: string,
  name: string = 'default',
  password?: string,
  storageType: WalletStorageType = 'factor-mcp',
): WalletInfo {
  // Validate private key
  let normalizedKey = privateKey;
  if (!normalizedKey.startsWith('0x')) {
    normalizedKey = `0x${normalizedKey}`;
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedKey)) {
    throw new WalletError('Invalid private key format');
  }

  // Get address from private key
  const account = privateKeyToAccount(normalizedKey as `0x${string}`);
  const address = account.address;

  if (storageType === 'foundry-keystore') {
    if (!password) {
      throw new WalletError('Password is required for Foundry keystore wallets');
    }

    if (foundryWalletExists(name)) {
      throw new WalletError(`Foundry keystore "${name}" already exists`);
    }

    importToFoundryKeystore(normalizedKey, name, password, address);

    return {
      name,
      address,
      encrypted: true,
      createdAt: new Date().toISOString(),
      storageType: 'foundry-keystore',
    };
  }

  // Legacy factor-mcp storage
  ensureDirectories();

  const walletPath = getWalletPath(name);

  if (existsSync(walletPath)) {
    throw new WalletError(`Wallet with name "${name}" already exists`);
  }

  const walletData: WalletData = {
    name,
    address,
    encrypted: !!password,
    createdAt: new Date().toISOString(),
  };

  if (password) {
    walletData.encryptedKey = encrypt(normalizedKey, password);
  } else {
    walletData.privateKey = normalizedKey;
  }

  writeFileSync(walletPath, JSON.stringify(walletData, null, 2), { mode: 0o600 });
  chmodSync(walletPath, 0o600);

  logger.info(`Wallet imported: ${name} (${address})`);

  return {
    name: walletData.name,
    address: walletData.address,
    encrypted: walletData.encrypted,
    createdAt: walletData.createdAt,
    storageType: 'factor-mcp',
  };
}

export function generateWallet(
  name: string = 'default',
  password?: string,
  storageType: WalletStorageType = 'factor-mcp',
): WalletInfo {
  const privateKey = generatePrivateKey();
  return importWallet(privateKey, name, password, storageType);
}

export function getWallet(name: string): WalletData {
  ensureDirectories();
  const walletPath = getWalletPath(name);

  if (!existsSync(walletPath)) {
    throw new WalletError(`Wallet "${name}" not found`);
  }

  const data = JSON.parse(readFileSync(walletPath, 'utf8')) as WalletData;
  return data;
}

/**
 * Get the private key for a wallet, detecting storage type automatically.
 *
 * Flow:
 * 1. Check ~/.factor-mcp/wallets/{name}.json
 * 2. Check ~/.foundry/keystores/{name}
 * 3. Decrypt using the appropriate method
 */
export function getPrivateKey(name: string, password?: string): string {
  if (name === '__stateless__') {
    throw new WalletError('Cannot access private key in stateless mode');
  }

  const storage = getWalletStorageType(name);

  if (!storage) {
    throw new WalletError(`Wallet "${name}" not found in factor-mcp or Foundry keystore`);
  }

  // Fall back to WALLET_PASSWORD env var when no explicit password is provided
  const effectivePassword = password || configManager.getWalletPassword();

  if (storage === 'foundry-keystore') {
    if (!effectivePassword) {
      throw new WalletError('Password required for Foundry keystore wallet');
    }
    const keystore = readFoundryKeystore(name);
    return decryptKeystoreV3(keystore, effectivePassword);
  }

  // factor-mcp storage
  const wallet = getWallet(name);

  if (wallet.encrypted) {
    if (!effectivePassword) {
      throw new WalletError('Password required for encrypted wallet');
    }
    if (!wallet.encryptedKey) {
      throw new WalletError('Encrypted wallet is missing key data');
    }
    return decrypt(wallet.encryptedKey, effectivePassword);
  }

  if (!wallet.privateKey) {
    throw new WalletError('Wallet is missing private key data');
  }
  return wallet.privateKey;
}

export function deleteWallet(name: string): void {
  ensureDirectories();
  const walletPath = getWalletPath(name);

  if (!existsSync(walletPath)) {
    throw new WalletError(`Wallet "${name}" not found`);
  }

  const { unlinkSync } = require('fs');
  unlinkSync(walletPath);
  logger.info(`Wallet deleted: ${name}`);
}

/**
 * Get the address for a wallet, detecting storage type automatically.
 */
export function getWalletAddress(name: string): string {
  // Stateless mode: return placeholder address
  if (name === '__stateless__') {
    return '0x0000000000000000000000000000000000000001';
  }

  const storage = getWalletStorageType(name);

  if (!storage) {
    throw new WalletError(`Wallet "${name}" not found in factor-mcp or Foundry keystore`);
  }

  if (storage === 'foundry-keystore') {
    return getFoundryWalletAddress(name);
  }

  const wallet = getWallet(name);
  return wallet.address;
}
