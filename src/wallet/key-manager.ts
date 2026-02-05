import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encrypt, decrypt, isEncrypted, type EncryptedData } from './encryption.js';
import { WalletError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const CONFIG_DIR = join(homedir(), '.factor-mcp');
const WALLETS_DIR = join(CONFIG_DIR, 'wallets');

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

export function walletExists(name: string): boolean {
  ensureDirectories();
  return existsSync(getWalletPath(name));
}

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
      });
    } catch {
      // Skip invalid wallet files
      logger.warn(`Skipping invalid wallet file: ${file}`);
    }
  }

  return wallets;
}

export function importWallet(
  privateKey: string,
  name: string = 'default',
  password?: string
): WalletInfo {
  ensureDirectories();

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
  };
}

export function generateWallet(name: string = 'default', password?: string): WalletInfo {
  const privateKey = generatePrivateKey();
  return importWallet(privateKey, name, password);
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

export function getPrivateKey(name: string, password?: string): string {
  const wallet = getWallet(name);

  if (wallet.encrypted) {
    if (!password) {
      throw new WalletError('Password required for encrypted wallet');
    }
    if (!wallet.encryptedKey) {
      throw new WalletError('Encrypted wallet is missing key data');
    }
    return decrypt(wallet.encryptedKey, password);
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

export function getWalletAddress(name: string): string {
  const wallet = getWallet(name);
  return wallet.address;
}
