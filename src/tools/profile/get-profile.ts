import { z } from 'zod';
import { isAddress } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

export const getProfileSchema = z.object({
  address: z.string().optional(),
});

export type GetProfileInput = z.infer<typeof getProfileSchema>;

export const getProfileTool = {
  name: 'factor_get_profile',
  description: 'Get a profile for an address from the Factor Studio Stats API. If no address is provided, uses the active wallet address. No wallet or signature required.',
  inputSchema: {
    type: 'object',
    properties: {
      address: {
        type: 'string',
        description: 'Ethereum address to get profile for. If not provided, uses the active wallet.',
      },
    },
  },
  handler: async (input: GetProfileInput) => {
    const validated = getProfileSchema.parse(input);

    let address: string;

    if (validated.address) {
      if (!isAddress(validated.address)) {
        throw new VaultError('Invalid address');
      }
      address = validated.address;
    } else {
      const walletName = configManager.getWalletName();
      if (!walletName) {
        throw new WalletError('No wallet configured and no address provided. Use factor_wallet_setup first or provide an address.');
      }
      address = getWalletAddress(walletName);
    }

    try {
      const response = await statsApiFetch(`/profiles/${address}`, {
        method: 'GET',
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        throw new SdkError(data.message || `Stats API error: ${response.status}`, data);
      }

      return {
        success: true,
        address,
        data,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError || error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to get profile', error);
    }
  },
};
