import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { signMessage } from '../../wallet/signer.js';
import { WalletError, SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

export const saveProfileSchema = z.object({
  username: z.string().optional(),
  profile: z.record(z.unknown()).optional(),
  password: z.string().optional(),
});

export type SaveProfileInput = z.infer<typeof saveProfileSchema>;

export const saveProfileTool = {
  name: 'factor_save_profile',
  description: 'Save a profile for the active wallet address to the Factor Studio Stats API. Requires a configured wallet for signing.',
  inputSchema: {
    type: 'object',
    properties: {
      username: {
        type: 'string',
        description: 'Username for the profile',
      },
      profile: {
        type: 'object',
        description: 'Profile data object with arbitrary key-value pairs',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
  },
  handler: async (input: SaveProfileInput) => {
    const validated = saveProfileSchema.parse(input);

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const address = getWalletAddress(walletName);
    const message = `Save profile for: ${address.toLowerCase()}`;
    const signature = await signMessage(message, validated.password);
    const chainId = configManager.getChainId();

    try {
      const response = await statsApiFetch('/profiles', {
        method: 'POST',
        body: JSON.stringify({
          address,
          username: validated.username,
          profile: validated.profile,
          signature,
          chainId,
        }),
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        throw new SdkError(data.message || `Stats API error: ${response.status}`, data);
      }

      return {
        success: true,
        address,
        chainId,
        data,
      };
    } catch (error) {
      if (error instanceof WalletError || error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to save profile', error);
    }
  },
};
