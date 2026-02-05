import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { SdkError } from '../../utils/errors.js';
import { StudioProVaultStats, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const getFactoryAddressesSchema = z.object({});

export type GetFactoryAddressesInput = z.infer<typeof getFactoryAddressesSchema>;

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

export const getFactoryAddressesTool = {
  name: 'factor_get_factory_addresses',
  description: 'Get all whitelisted assets, adapters, and their accounting addresses from the factory. Use this to find the correct accounting adapter for an asset before creating a vault.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input: GetFactoryAddressesInput) => {
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    try {
      const proVaultStats = new StudioProVaultStats({
        chainId,
        environment,
      });

      const sb = new StrategyBuilder({
        chainId,
        isProAdapter: true,
        environment,
      });

      const activeAddresses = await proVaultStats.getFactoryActiveAddresses();

      // Process manager adapters with names
      const managerAdapters = activeAddresses.managerAdapters.map((adapter: { id: string }) => {
        try {
          const a = sb.adapter.getAdapterByAddress(adapter.id);
          return { address: adapter.id, name: a.adapterName };
        } catch {
          return { address: adapter.id, name: 'UNKNOWN' };
        }
      });

      // Process owner adapters with names
      const ownerAdapters = activeAddresses.ownerAdapters.map((adapter: { id: string }) => {
        try {
          const a = sb.adapter.getAdapterByAddress(adapter.id);
          return { address: adapter.id, name: a.adapterName };
        } catch {
          return { address: adapter.id, name: 'UNKNOWN' };
        }
      });

      // Process assets with accounting
      const assets = activeAddresses.assets.map((asset: { asset: string; accounting: string }) => ({
        asset: asset.asset,
        accounting: asset.accounting,
      }));

      // Process debts with accounting
      const debts = activeAddresses.debts.map((debt: { asset: string; accounting: string }) => ({
        asset: debt.asset,
        accounting: debt.accounting,
      }));

      return {
        success: true,
        chain,
        environment,
        managerAdapters,
        ownerAdapters,
        assets,
        debts,
        note: 'Use the accounting address that matches your asset when creating a vault.',
      };
    } catch (error) {
      throw new SdkError('Failed to get factory addresses', error);
    }
  },
};
