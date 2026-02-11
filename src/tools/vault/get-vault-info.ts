import { z } from 'zod';
import { isAddress, type Address, formatUnits } from 'viem';
import { configManager } from '../../config/index.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StudioProVaultStats } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';
import { formatWei, formatBps, getTokenDecimals } from '../../utils/format.js';
import { getPublicClient } from '../../wallet/signer.js';

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
        environment: configManager.getEnvironment(),
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const proVaultStats = new StudioProVaultStats({
        chainId,
        vaultAddress,
        environment: configManager.getEnvironment(),
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Get vault data and subgraph data in parallel
      const [vaultData, vaultSubgraph, totalSupply, pricePerShare] = await Promise.all([
        proVault.getVaultData(),
        proVaultStats.getVaultSubgraph(),
        proVault.getTotalSupply(),
        proVault.getPricePerShare(),
      ]);

      // Read denominator decimals for formatting token amounts (maxCap, depositMinimum, etc.)
      let denominatorDecimals = 18;
      try {
        const denominatorAddress = vaultData.metadata.assetDenominatorAddress;
        if (denominatorAddress) {
          const publicClient = getPublicClient();
          denominatorDecimals = await getTokenDecimals(publicClient, denominatorAddress as Address);
        }
      } catch {
        // Fall back to 18 decimals
      }

      const maxCapRaw = vaultData.riskManagement.maxCapBN?.toString();
      const maxDebtRatioRaw = vaultData.riskManagement.maxDebtRatioBN?.toString();
      const cumulativePriceDeviationAllowanceRaw = vaultData.riskManagement.cumulativePriceDeviationAllowanceBN?.toString();
      const depositFeeRaw = vaultData.fees.depositBN?.toString();
      const withdrawFeeRaw = vaultData.fees.withdrawBN?.toString();
      const managementFeeRaw = vaultData.fees.managementBN?.toString();
      const performanceFeeRaw = vaultData.fees.performanceBN?.toString();

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
          netVaultValueFmt: formatWei(vaultSubgraph?.netVaultValue || '0', denominatorDecimals),
          underlyingAssets: vaultData.financial.underlyingAssets,
          denominator: vaultSubgraph?.denominator,
          denominatorDecimals,
        },
        config: {
          upgradeable: vaultData.config.upgradeable,
          upgradeTimelock: vaultData.config.timelockBN?.toString(),
          cooldownTime: vaultData.config.cooldownTime,
        },
        riskManagement: {
          maxCap: maxCapRaw,
          maxCapFmt: formatWei(maxCapRaw, denominatorDecimals),
          maxDebtRatio: maxDebtRatioRaw,
          maxDebtRatioFmt: formatBps(maxDebtRatioRaw),
          cumulativePriceDeviationAllowance: cumulativePriceDeviationAllowanceRaw,
          cumulativePriceDeviationAllowanceFmt: formatBps(cumulativePriceDeviationAllowanceRaw),
        },
        fees: {
          receiver: vaultSubgraph?.feesReceiver,
          deposit: depositFeeRaw,
          depositFmt: formatBps(depositFeeRaw),
          withdraw: withdrawFeeRaw,
          withdrawFmt: formatBps(withdrawFeeRaw),
          management: managementFeeRaw,
          managementFmt: formatBps(managementFeeRaw),
          performance: performanceFeeRaw,
          performanceFmt: formatBps(performanceFeeRaw),
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
          minimumFmt: typeof vaultSubgraph?.depositMinimum === 'string'
            ? formatWei(vaultSubgraph.depositMinimum, denominatorDecimals)
            : undefined,
          minimumEnabled: vaultSubgraph?.depositMinimumEnabled,
          netValueLimit: vaultSubgraph?.depositNetValueLimit,
          netValueLimitFmt: vaultSubgraph?.depositNetValueLimit != null
            ? formatWei(String(vaultSubgraph.depositNetValueLimit), denominatorDecimals)
            : undefined,
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
