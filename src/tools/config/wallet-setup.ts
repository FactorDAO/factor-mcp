import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { importWallet, generateWallet, listWallets, walletExists } from '../../wallet/key-manager.js';
import { WalletError } from '../../utils/errors.js';

export const walletSetupSchema = z.object({
  privateKey: z.string().optional(),
  name: z.string().default('default'),
  password: z.string().optional(),
  generateNew: z.boolean().default(false),
  setActive: z.boolean().default(true),
  skipPasswordProtection: z.boolean().default(false),
});

export type WalletSetupInput = z.infer<typeof walletSetupSchema>;

export const walletSetupTool = {
  name: 'factor_wallet_setup',
  description: 'Import an existing wallet from a private key or generate a new one. Optionally encrypt with a password. The wallet will be stored securely in ~/.factor-mcp/wallets/',
  inputSchema: {
    type: 'object',
    properties: {
      privateKey: {
        type: 'string',
        description: 'Private key to import (64 hex chars, with or without 0x prefix). Required unless generateNew is true.',
      },
      name: {
        type: 'string',
        description: 'Name for the wallet (default: "default"). Use alphanumeric characters, hyphens, and underscores only.',
        default: 'default',
      },
      password: {
        type: 'string',
        description: 'Password to encrypt the private key. If not provided, key is stored unencrypted (not recommended for production).',
      },
      generateNew: {
        type: 'boolean',
        description: 'Generate a new random wallet instead of importing',
        default: false,
      },
      setActive: {
        type: 'boolean',
        description: 'Set this wallet as the active wallet for transactions',
        default: true,
      },
      skipPasswordProtection: {
        type: 'boolean',
        description: 'Set to true to explicitly skip password protection. WARNING: This stores the private key unencrypted.',
        default: false,
      },
    },
  },
  handler: async (input: WalletSetupInput) => {
    const validated = walletSetupSchema.parse(input);

    // Require explicit decision about password protection
    if (!validated.password && !validated.skipPasswordProtection) {
      throw new WalletError(
        'Password protection decision required. Either provide a "password" to encrypt the wallet, ' +
        'or set "skipPasswordProtection: true" to explicitly store the key unencrypted (not recommended for production).'
      );
    }

    // Check if wallet already exists
    if (walletExists(validated.name)) {
      throw new WalletError(`Wallet "${validated.name}" already exists. Choose a different name or delete the existing wallet.`);
    }

    let walletInfo;

    if (validated.generateNew) {
      walletInfo = generateWallet(validated.name, validated.password);
    } else if (validated.privateKey) {
      walletInfo = importWallet(validated.privateKey, validated.name, validated.password);
    } else {
      throw new WalletError('Either privateKey or generateNew must be provided');
    }

    // Set as active wallet if requested
    if (validated.setActive) {
      configManager.setWalletName(validated.name);
    }

    return {
      success: true,
      wallet: {
        name: walletInfo.name,
        address: walletInfo.address,
        encrypted: walletInfo.encrypted,
        createdAt: walletInfo.createdAt,
        isActive: validated.setActive,
      },
      securityNote: walletInfo.encrypted
        ? 'Private key is encrypted. You will need the password for all write operations.'
        : 'WARNING: Private key is stored unencrypted. Consider using a password for production.',
      allWallets: listWallets().map(w => ({
        name: w.name,
        address: w.address,
        encrypted: w.encrypted,
        isActive: w.name === configManager.getWalletName(),
      })),
    };
  },
};
