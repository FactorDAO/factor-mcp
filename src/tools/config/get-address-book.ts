import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { SdkError } from '../../utils/errors.js';
import { getContractAddressesForChainOrThrow } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const getAddressBookSchema = z.object({});

export type GetAddressBookInput = z.infer<typeof getAddressBookSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const getAddressBookTool = {
  name: 'factor_get_address_book',
  description: 'Get the SDK address book (Pro adapters only) for the current chain and environment. Returns all known Pro contract addresses including adapters, accounting adapters, factory, and protocol addresses. Use this to find the correct adapter address before adding it to a vault.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input: GetAddressBookInput) => {
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    try {
      const addresses = getContractAddressesForChainOrThrow(chainId, environment);

      // Filter: only "pro" addresses, skip empty strings and complex objects
      const filtered: Record<string, string> = {};
      for (const [key, value] of Object.entries(addresses)) {
        if (typeof value === 'string' && value !== '' && key.includes('_pro')) {
          filtered[key] = value;
        }
      }

      return {
        success: true,
        chain,
        environment,
        addresses: filtered,
        total: Object.keys(filtered).length,
      };
    } catch (error) {
      throw new SdkError('Failed to get address book', error);
    }
  },
};
