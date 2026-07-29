import { z } from 'zod';
import { type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { SdkError } from '../../utils/errors.js';
import { StudioProFactory, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const validateVaultConfigSchema = z.object({
  managerAdapters: z.array(z.string()).optional(),
  ownerAdapters: z.array(z.string()).optional(),
  withdrawAdapters: z.array(z.string()).optional(),
  assetAddresses: z.array(z.string()).optional(),
  depositAssetAddresses: z.array(z.string()).optional(),
  withdrawAssetAddresses: z.array(z.string()).optional(),
  assetAccountingAddresses: z.array(z.string()).optional(),
  debtAddresses: z.array(z.string()).optional(),
  debtAccountingAddresses: z.array(z.string()).optional(),
});

export type ValidateVaultConfigInput = z.infer<typeof validateVaultConfigSchema>;

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

export const validateVaultConfigTool = {
  name: 'factor_validate_vault_config',
  description: 'Validate vault configuration before deployment. Checks if all adapters, assets, and accounting addresses are whitelisted in the factory.',
  inputSchema: {
    type: 'object',
    properties: {
      managerAdapters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Manager adapter addresses to validate',
      },
      ownerAdapters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Owner adapter addresses to validate',
      },
      withdrawAdapters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Withdraw adapter addresses to validate',
      },
      assetAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Asset addresses to validate',
      },
      depositAssetAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Deposit asset addresses to validate',
      },
      withdrawAssetAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Withdraw asset addresses to validate',
      },
      assetAccountingAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Asset accounting adapter addresses to validate (must match assetAddresses length)',
      },
      debtAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Debt token addresses to validate',
      },
      debtAccountingAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Debt accounting adapter addresses to validate (must match debtAddresses length)',
      },
    },
  },
  handler: async (input: ValidateVaultConfigInput) => {
    const validated = validateVaultConfigSchema.parse(input);
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    try {
      const proFactory = new StudioProFactory({
        chainId,
        environment,
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const sb = new StrategyBuilder({
        chainId,
        isProAdapter: true,
        environment,
      });

      const validationResult = await proFactory.validateStrategy({
        managerAdapters: (validated.managerAdapters || []) as Address[],
        ownerAdapters: (validated.ownerAdapters || []) as Address[],
        withdrawAdapters: (validated.withdrawAdapters || []) as Address[],
        assetAddresses: (validated.assetAddresses || []) as Address[],
        depositAssetAddresses: (validated.depositAssetAddresses || []) as Address[],
        withdrawAssetAddresses: (validated.withdrawAssetAddresses || []) as Address[],
        assetAccountingAddresses: (validated.assetAccountingAddresses || []) as Address[],
        debtAddresses: (validated.debtAddresses || []) as Address[],
        debtAccountingAddresses: (validated.debtAccountingAddresses || []) as Address[],
      });

      // Process results with adapter names where possible
      const processAdapters = (adapters: { address: Address; isValid: boolean }[]) => {
        return adapters.map((adapter) => {
          try {
            const a = sb.adapter.getAdapterByAddress(adapter.address);
            return { address: adapter.address, name: a.adapterName, isValid: adapter.isValid };
          } catch {
            return { address: adapter.address, name: 'UNKNOWN', isValid: adapter.isValid };
          }
        });
      };

      const processAssets = (assets: { address: Address; isValid: boolean }[]) => {
        return assets.map((asset) => ({
          address: asset.address,
          isValid: asset.isValid,
        }));
      };

      // Soft warnings for footguns the factory's `isValid` flag does NOT
      // catch. Empty `withdrawAssetAddresses` ships an unredeemable vault —
      // the factory accepts it but Smart Withdraw later reverts on
      // `withdrawAsset(asset)` because the asset isn't whitelisted. Surface
      // it explicitly so callers can either set the field or rely on
      // factor_create_vault's auto-mirror.
      const warnings: string[] = [];
      const hasDeposits = (validated.depositAssetAddresses || []).length > 0;
      const hasWithdraws = (validated.withdrawAssetAddresses || []).length > 0;
      if (hasDeposits && !hasWithdraws) {
        warnings.push(
          'withdrawAssetAddresses is empty while depositAssetAddresses is not — the deployed vault will be unredeemable. ' +
          'factor_create_vault auto-mirrors deposits when this field is omitted; pass it explicitly only if you intentionally want a deposit-only vault.'
        );
      }

      return {
        success: true,
        isValid: validationResult.isValid,
        chain,
        environment,
        managerAdapters: processAdapters(validationResult.managerAdapters),
        ownerAdapters: processAdapters(validationResult.ownerAdapters),
        withdrawAdapters: processAdapters(validationResult.withdrawAdapters),
        assetAddresses: processAssets(validationResult.assetAddresses),
        depositAssetAddresses: processAssets(validationResult.depositAssetAddresses),
        withdrawAssetAddresses: processAssets(validationResult.withdrawAssetAddresses),
        assetAccountingAddresses: processAssets(validationResult.assetAccountingAddresses),
        debtAddresses: processAssets(validationResult.debtAddresses),
        debtAccountingAddresses: processAssets(validationResult.debtAccountingAddresses),
        warnings,
        note: validationResult.isValid
          ? 'All addresses are valid and whitelisted in the factory.'
          : 'Some addresses are not whitelisted. Check isValid: false entries above.',
      };
    } catch (error) {
      throw new SdkError('Failed to validate vault config', error);
    }
  },
};
