import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { signMessage } from '../../wallet/signer.js';
import { WalletError, SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

export const saveStrategySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  strategy: z.unknown().optional(),
  vault_address: z.string().optional(),
  hash: z.string().optional(),
  password: z.string().optional(),
});

export type SaveStrategyInput = z.infer<typeof saveStrategySchema>;

export const saveStrategyTool = {
  name: 'factor_save_strategy',
  description: 'Save or update a strategy on the Factor Studio Stats API. Requires a configured wallet for signing. The strategy field contains the strategy data (canvas array or steps array). If vault_address is provided, type defaults to "pro-vault" and position_address is set to the same vault_address. Include hash to update an existing strategy.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the strategy',
      },
      description: {
        type: 'string',
        description: 'Description of the strategy',
      },
      type: {
        type: 'string',
        description: 'Strategy type (e.g., "pro-vault", "swap"). Auto-set to "pro-vault" if vault_address is provided.',
      },
      status: {
        type: 'string',
        description: 'Strategy status (e.g., "draft"). Default: "draft".',
      },
      strategy: {
        type: 'object',
        description: 'Strategy data. Can be an object with a canvas array, or an array of strategy steps.',
      },
      vault_address: {
        type: 'string',
        description: 'Vault address to associate with the strategy. Also sets position_address to the same value.',
      },
      hash: {
        type: 'string',
        description: 'Strategy hash. Include this to update an existing strategy instead of creating a new one.',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
    required: ['name'],
  },
  handler: async (input: SaveStrategyInput) => {
    const validated = saveStrategySchema.parse(input);

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
      type: validated.type ?? (validated.vault_address ? 'pro-vault' : undefined),
      status: validated.status ?? 'draft',
      chain,
      owner: address,
      signature,
      strategy: validated.strategy,
      vault_address: validated.vault_address,
      position_address: validated.vault_address,
      hash: validated.hash,
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
        data,
      };
    } catch (error) {
      if (error instanceof WalletError || error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to save strategy', error);
    }
  },
};
