import { z } from 'zod';
import { isAddress } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { signMessage } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

export const saveVaultMetadataSchema = z.object({
  vaultAddress: z.string(),
  name: z.string(),
  description: z.string().optional(),
  logoCID: z.string().optional(),
  depositAssetAddressesVisibility: z.array(z.string()).optional(),
  withdrawAssetAddressesVisibility: z.array(z.string()).optional(),
  status: z.string().optional(),
  hash: z.string().optional(),
  password: z.string().optional(),
});

export type SaveVaultMetadataInput = z.infer<typeof saveVaultMetadataSchema>;

export const saveVaultMetadataTool = {
  name: 'factor_save_vault_metadata',
  description: 'Save or update vault display metadata (name, description, logo) on the Factor Studio Stats API. This information appears on the discover page. Upload a logo image first via factor_upload_ipfs, then pass the IPFS hash as logoCID. Include hash to update existing metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      name: {
        type: 'string',
        description: 'Display name for the vault (shown on discover page)',
      },
      description: {
        type: 'string',
        description: 'Vault description/strategy explanation',
      },
      logoCID: {
        type: 'string',
        description: 'IPFS hash for the vault logo (upload via factor_upload_ipfs first)',
      },
      depositAssetAddressesVisibility: {
        type: 'array',
        items: { type: 'string' },
        description: 'Token addresses visible as deposit options on the UI',
      },
      withdrawAssetAddressesVisibility: {
        type: 'array',
        items: { type: 'string' },
        description: 'Token addresses visible as withdraw options on the UI',
      },
      status: {
        type: 'string',
        description: 'Vault status: "draft", "live", or "deployed". Default: "live".',
      },
      hash: {
        type: 'string',
        description: 'Strategy hash from a previous save. Include this to update existing metadata instead of creating a new entry.',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
    required: ['vaultAddress', 'name'],
  },
  handler: async (input: SaveVaultMetadataInput) => {
    const validated = saveVaultMetadataSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const address = getWalletAddress(walletName);
    const message = `Save strategy: ${validated.name}`;
    const signature = await signMessage(message, validated.password);
    const chain = configManager.getChainId();

    const body: Record<string, unknown> = {
      name: validated.name,
      description: validated.description ?? '',
      type: 'pro-vault',
      status: validated.status ?? 'live',
      chain,
      owner: address,
      signature,
      vault_address: validated.vaultAddress,
      position_address: validated.vaultAddress,
      hash: validated.hash,
      strategy: {
        metadata: {
          logoCID: validated.logoCID,
          depositAssetAddressesVisibility: validated.depositAssetAddressesVisibility ?? [],
          withdrawAssetAddressesVisibility: validated.withdrawAssetAddressesVisibility ?? [],
        },
      },
    };

    try {
      const response = await statsApiFetch('/strategies/save', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        throw new SdkError(data.message || `Stats API error: ${response.status}`, data);
      }

      return {
        success: true,
        address,
        chain,
        vaultAddress: validated.vaultAddress,
        hash: data.strategy?.hash || data.hash,
        data,
        note: data.strategy?.hash
          ? `Vault metadata saved. Use hash "${data.strategy.hash}" to update it later.`
          : 'Vault metadata saved.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError || error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to save vault metadata', error);
    }
  },
};
