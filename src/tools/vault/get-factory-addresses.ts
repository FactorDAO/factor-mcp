import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { SdkError } from '../../utils/errors.js';
import { StudioProVaultStats, StrategyBuilder, getContractAddressesForChainOrThrow } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const getFactoryAddressesSchema = z.object({
  search: z.string().optional(),
});

export type GetFactoryAddressesInput = z.infer<typeof getFactoryAddressesSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    case 'ROBINHOOD':
      return 4663 as ChainId;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const getFactoryAddressesTool = {
  name: 'factor_get_factory_addresses',
  description: 'Get whitelisted assets, adapters, and their accounting addresses from the factory. Use this to find the correct accounting adapter for an asset before creating a vault. TIP: Pass a "search" address to filter results and get only the matching asset/adapter instead of the full list.',
  inputSchema: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: 'Optional address to search for. Filters assets, debts, and adapters to only return entries matching this address (case-insensitive). Returns much smaller response.',
      },
    },
  },
  handler: async (input: GetFactoryAddressesInput) => {
    const validated = getFactoryAddressesSchema.parse(input);
    const searchAddr = validated.search?.toLowerCase();
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
      let managerAdapters = activeAddresses.managerAdapters.map((adapter: { id: string }) => {
        try {
          const a = sb.adapter.getAdapterByAddress(adapter.id);
          return { address: adapter.id, name: a.adapterName };
        } catch {
          return { address: adapter.id, name: 'UNKNOWN' };
        }
      });

      // Process owner adapters with names
      let ownerAdapters = activeAddresses.ownerAdapters.map((adapter: { id: string }) => {
        try {
          const a = sb.adapter.getAdapterByAddress(adapter.id);
          return { address: adapter.id, name: a.adapterName };
        } catch {
          return { address: adapter.id, name: 'UNKNOWN' };
        }
      });

      // Build set of current accounting addresses from the address book
      const currentAccounting = new Set<string>();
      try {
        const contracts = getContractAddressesForChainOrThrow(chainId, environment);
        for (const [key, value] of Object.entries(contracts as unknown as Record<string, unknown>)) {
          if (key.includes('accounting') && typeof value === 'string' && value !== '') {
            currentAccounting.add(value.toLowerCase());
          }
        }
      } catch {
        // Address book unavailable — return all (no filtering)
      }

      // Process assets — filter out stale accounting adapters
      let assets = activeAddresses.assets
        .filter((asset: { asset: string; accounting: string }) =>
          currentAccounting.size === 0 || currentAccounting.has(asset.accounting.toLowerCase())
        )
        .map((asset: { asset: string; accounting: string }) => ({
          asset: asset.asset,
          accounting: asset.accounting,
        }));

      // Process debts — filter out stale accounting adapters
      let debts = activeAddresses.debts
        .filter((debt: { asset: string; accounting: string }) =>
          currentAccounting.size === 0 || currentAccounting.has(debt.accounting.toLowerCase())
        )
        .map((debt: { asset: string; accounting: string }) => ({
          asset: debt.asset,
          accounting: debt.accounting,
        }));

      // Filter by search address if provided
      if (searchAddr) {
        managerAdapters = managerAdapters.filter(
          (a: { address: string }) => a.address.toLowerCase() === searchAddr
        );
        ownerAdapters = ownerAdapters.filter(
          (a: { address: string }) => a.address.toLowerCase() === searchAddr
        );
        assets = assets.filter(
          (a: { asset: string; accounting: string }) =>
            a.asset.toLowerCase() === searchAddr || a.accounting.toLowerCase() === searchAddr
        );
        debts = debts.filter(
          (d: { asset: string; accounting: string }) =>
            d.asset.toLowerCase() === searchAddr || d.accounting.toLowerCase() === searchAddr
        );
      }

      return {
        success: true,
        chain,
        environment,
        ...(searchAddr ? { search: validated.search } : {}),
        managerAdapters,
        ownerAdapters,
        assets,
        debts,
        note: searchAddr
          ? `Filtered results for address ${validated.search}. If the asset does not appear in the results, it has no valid accounting adapter and cannot be used.`
          : 'Only assets with a valid accounting adapter are listed. If a token does not appear here, it cannot be used. TIP: Pass a "search" address to filter results.',
      };
    } catch (error) {
      throw new SdkError('Failed to get factory addresses', error);
    }
  },
};
