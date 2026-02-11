import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { importWallet, generateWallet, listAllWallets, walletExists, type WalletStorageType } from '../../wallet/key-manager.js';
import { foundryWalletExists, getFoundryWalletAddress } from '../../wallet/foundry-keystore.js';
import { WalletError } from '../../utils/errors.js';

export const walletSetupSchema = z.object({
  privateKey: z.string().optional(),
  name: z.string().default('default'),
  password: z.string().optional(),
  generateNew: z.preprocess(v => v === 'true' || v === true, z.boolean()).default(false),
  setActive: z.preprocess(v => v === 'true' || v === true, z.boolean()).default(true),
  skipPasswordProtection: z.preprocess(v => v === 'true' || v === true, z.boolean()).default(false),
  storageType: z.enum(['factor-mcp', 'foundry-keystore']).default('factor-mcp'),
  useExistingFoundryKeystore: z.preprocess(v => v === 'true' || v === true, z.boolean()).default(false),
  model_name: z.string(),
});

export type WalletSetupInput = z.infer<typeof walletSetupSchema>;

export const walletSetupTool = {
  name: 'factor_wallet_setup',
  description: 'Import or generate a wallet. REQUIRES model_name (your LLM model ID, e.g. "claude-opus-4-6", "gpt-4o"). Optionally encrypt with a password. Stored securely in ~/.factor-mcp/wallets/',
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
      storageType: {
        type: 'string',
        enum: ['factor-mcp', 'foundry-keystore'],
        description: 'Storage backend for the wallet. "factor-mcp" (default) stores in ~/.factor-mcp/wallets/. "foundry-keystore" stores in ~/.foundry/keystores/ using Web3 V3 format (compatible with cast, geth).',
        default: 'factor-mcp',
      },
      useExistingFoundryKeystore: {
        type: 'boolean',
        description: 'Use an existing Foundry keystore wallet (from ~/.foundry/keystores/) instead of importing or generating. Set name to the keystore file name.',
        default: false,
      },
      model_name: {
        type: 'string',
        description: 'IMPORTANT: You MUST provide your own LLM model name here (e.g., "grok-4.1", "claude-sonnet-4-5-20250929", "gpt-4o"). This is used to track which AI model generated strategies and profiles.',
      },
    },
    required: ['model_name'],
  },
  handler: async (input: WalletSetupInput) => {
    const validated = walletSetupSchema.parse(input);

    // Persist model name
    configManager.setModelName(validated.model_name);

    // Handle using an existing Foundry keystore
    if (validated.useExistingFoundryKeystore) {
      if (!foundryWalletExists(validated.name)) {
        throw new WalletError(
          `Foundry keystore "${validated.name}" not found in ~/.foundry/keystores/. ` +
          'Create one with: cast wallet import <name> --interactive'
        );
      }

      const address = getFoundryWalletAddress(validated.name);

      if (validated.setActive) {
        configManager.setWalletName(validated.name);
      }

      return {
        success: true,
        wallet: {
          name: validated.name,
          address,
          encrypted: true,
          storageType: 'foundry-keystore',
          isActive: validated.setActive,
        },
        securityNote: 'Using existing Foundry keystore. Password will be required for all write operations.',
        allWallets: listAllWallets().map(w => ({
          name: w.name,
          address: w.address,
          encrypted: w.encrypted,
          storageType: w.storageType,
          isActive: w.name === configManager.getWalletName(),
        })),
      };
    }

    // For foundry-keystore, password is always required
    if (validated.storageType === 'foundry-keystore') {
      if (!validated.password) {
        throw new WalletError(
          'Password is required for Foundry keystore wallets. ' +
          'Provide a "password" to encrypt the wallet, or use storageType: "factor-mcp" with skipPasswordProtection for unencrypted storage.'
        );
      }
    } else {
      // factor-mcp: require explicit decision about password protection
      if (!validated.password && !validated.skipPasswordProtection) {
        throw new WalletError(
          'Password protection decision required. Either provide a "password" to encrypt the wallet, ' +
          'or set "skipPasswordProtection: true" to explicitly store the key unencrypted (not recommended for production).'
        );
      }
    }

    // Check if wallet already exists
    if (walletExists(validated.name)) {
      throw new WalletError(`Wallet "${validated.name}" already exists. Choose a different name or delete the existing wallet.`);
    }

    let walletInfo;
    const storageType = validated.storageType as WalletStorageType;

    if (validated.generateNew) {
      walletInfo = generateWallet(validated.name, validated.password, storageType);
    } else if (validated.privateKey) {
      walletInfo = importWallet(validated.privateKey, validated.name, validated.password, storageType);
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
        storageType: walletInfo.storageType,
        createdAt: walletInfo.createdAt,
        isActive: validated.setActive,
      },
      securityNote: walletInfo.encrypted
        ? 'Private key is encrypted. You will need the password for all write operations.'
        : 'WARNING: Private key is stored unencrypted. Consider using a password for production.',
      allWallets: listAllWallets().map(w => ({
        name: w.name,
        address: w.address,
        encrypted: w.encrypted,
        storageType: w.storageType,
        isActive: w.name === configManager.getWalletName(),
      })),
    };
  },
};
