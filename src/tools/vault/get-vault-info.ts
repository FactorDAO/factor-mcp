import { z } from 'zod';
import { isAddress, type Address, formatUnits } from 'viem';
import { configManager } from '../../config/index.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StudioProVaultStats } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const getVaultInfoSchema = z.object({
  vaultAddress: z.string(),
});

export type GetVaultInfoInput = z.infer<typeof getVaultInfoSchema>;

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

export const getVaultInfoTool = {
  name: 'factor_get_vault_info',
  description: 'Get detailed information about a Factor Pro vault including name, symbol, assets, fees, managers, and supported adapters.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
    },
    required: ['vaultAddress'],
  },
  handler: async (input: GetVaultInfoInput) => {
    const validated = getVaultInfoSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment: 'production',
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const proVaultStats = new StudioProVaultStats({
        chainId,
        vaultAddress,
        environment: 'production',
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Get vault data and subgraph data in parallel
      const [vaultData, vaultSubgraph, totalSupply, pricePerShare] = await Promise.all([
        proVault.getVaultData(),
        proVaultStats.getVaultSubgraph(),
        proVault.getTotalSupply(),
        proVault.getPricePerShare(),
      ]);

      return {
        vault: {
          address: vaultAddress,
          name: vaultData.metadata.name,
          symbol: vaultData.metadata.symbol,
          owner: vaultData.metadata.ownerAddress,
        },
        financial: {
          totalSupply: {
            raw: totalSupply.toString(),
            formatted: formatUnits(totalSupply, 18),
          },
          pricePerShare: {
            raw: pricePerShare.toString(),
            formatted: formatUnits(pricePerShare, 18),
          },
          netVaultValue: vaultSubgraph?.netVaultValue || '0',
          underlyingAssets: vaultData.financial.underlyingAssets,
          denominator: vaultSubgraph?.denominator,
        },
        config: {
          upgradeable: vaultData.config.upgradeable,
          upgradeTimelock: vaultData.config.timelockBN?.toString(),
          cooldownTime: vaultData.config.cooldownTime,
        },
        riskManagement: {
          maxCap: vaultData.riskManagement.maxCapBN?.toString(),
          maxDebtRatio: vaultData.riskManagement.maxDebtRatioBN?.toString(),
          cumulativePriceDeviationAllowance: vaultData.riskManagement.cumulativePriceDeviationAllowanceBN?.toString(),
        },
        fees: {
          receiver: vaultSubgraph?.feesReceiver,
          deposit: vaultData.fees.depositBN?.toString(),
          withdraw: vaultData.fees.withdrawBN?.toString(),
          management: vaultData.fees.managementBN?.toString(),
          performance: vaultData.fees.performanceBN?.toString(),
        },
        access: {
          managers: vaultSubgraph?.managers || [],
          riskManager: vaultSubgraph?.riskManager,
          depositWhitelistEnabled: vaultSubgraph?.depositWhitelistEnabled,
          depositorWhitelist: vaultSubgraph?.depositorWhitelist || [],
        },
        adapters: {
          manager: vaultSubgraph?.managerAdapters || [],
          owner: vaultSubgraph?.ownerAdapters || [],
          withdraw: vaultSubgraph?.withdrawAdapters || [],
        },
        assets: {
          supported: vaultSubgraph?.assets || [],
          debts: vaultSubgraph?.debts || [],
        },
        depositSettings: {
          minimum: vaultSubgraph?.depositMinimum,
          minimumEnabled: vaultSubgraph?.depositMinimumEnabled,
          netValueLimit: vaultSubgraph?.depositNetValueLimit,
          netValueLimitEnabled: vaultSubgraph?.depositNetValueLimitEnabled,
        },
        chain,
        chainId: configManager.getChainId(),
      };
    } catch (error) {
      throw new SdkError('Failed to get vault info', error);
    }
  },
};
