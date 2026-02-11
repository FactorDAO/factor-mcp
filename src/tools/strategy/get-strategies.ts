import { z } from 'zod';
import { isAddress } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

export const getStrategiesSchema = z.object({
  owner: z.string().optional(),
  chainId: z.number().optional(),
});

export type GetStrategiesInput = z.infer<typeof getStrategiesSchema>;

export const getStrategiesTool = {
  name: 'factor_get_strategies',
  description: 'Get all strategies by owner address from the Factor Studio Stats API. If no owner is provided, uses the active wallet address. No signature required.',
  inputSchema: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Owner address to get strategies for. If not provided, uses the active wallet.',
      },
      chainId: {
        type: 'number',
        description: 'Chain ID to filter strategies. If not provided, uses the current chain.',
      },
    },
  },
  handler: async (input: GetStrategiesInput) => {
    const validated = getStrategiesSchema.parse(input);

    let owner: string;

    if (validated.owner) {
      if (!isAddress(validated.owner)) {
        throw new VaultError('Invalid owner address');
      }
      owner = validated.owner;
    } else {
      const walletName = configManager.getWalletName();
      if (!walletName) {
        throw new WalletError('No wallet configured and no owner provided. Use factor_wallet_setup first or provide an owner address.');
      }
      owner = getWalletAddress(walletName);
    }

    const chainId = validated.chainId ?? configManager.getChainId();

    try {
      const response = await statsApiFetch(`/strategies/${chainId}/${owner}`, {
        method: 'GET',
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        throw new SdkError(data.message || `Stats API error: ${response.status}`, data);
      }

      return {
        success: true,
        owner,
        chainId,
        data,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError || error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to get strategies', error);
    }
  },
};
