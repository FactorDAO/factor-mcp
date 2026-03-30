import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { signMessage } from '../../wallet/signer.js';
import { WalletError, SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

const profileDataSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  website: z.string().optional(),
  discord: z.string().optional(),
  twitter: z.string().optional(),
  github: z.string().optional(),
  telegram: z.string().optional(),
  blog: z.string().optional(),
});

export const saveProfileSchema = z.object({
  username: z.string().optional(),
  profile: profileDataSchema.optional(),
  password: z.string().optional(),
});

export type SaveProfileInput = z.infer<typeof saveProfileSchema>;

export const saveProfileTool = {
  name: 'factor_save_profile',
  description: 'Save or update the profile for the active wallet address on the Factor Studio Stats API. Set display name, description, profile image (IPFS hash from factor_upload_ipfs), and social links. Requires a configured wallet for signing.',
  inputSchema: {
    type: 'object',
    properties: {
      username: {
        type: 'string',
        description: 'Username for the profile (lowercased automatically)',
      },
      profile: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Display name',
          },
          description: {
            type: 'string',
            description: 'Profile bio/description',
          },
          image: {
            type: 'string',
            description: 'IPFS hash for the profile image (upload via factor_upload_ipfs first)',
          },
          website: {
            type: 'string',
            description: 'Website URL',
          },
          discord: {
            type: 'string',
            description: 'Discord username or invite link',
          },
          twitter: {
            type: 'string',
            description: 'Twitter/X handle or URL',
          },
          github: {
            type: 'string',
            description: 'GitHub username or URL',
          },
          telegram: {
            type: 'string',
            description: 'Telegram handle or link',
          },
          blog: {
            type: 'string',
            description: 'Blog URL',
          },
        },
        description: 'Profile data with display info and social links',
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
