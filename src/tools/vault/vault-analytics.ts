import { z } from 'zod';
import { isAddress } from 'viem';
import { configManager } from '../../config/index.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import { FactorVaultAnalytics } from '@factordao/vault-analytics';
import { ChainId as TokenlistChainId } from '@factordao/tokenlist';

export const vaultAnalyticsSchema = z.object({
  vaultAddress: z.string(),
});

export type VaultAnalyticsInput = z.infer<typeof vaultAnalyticsSchema>;

const CHAIN_MAP: Record<string, number> = {
  ARBITRUM_ONE: TokenlistChainId.ARBITRUM_ONE,
  BASE: TokenlistChainId.BASE,
  MAINNET: TokenlistChainId.ETHEREUM,
  OPTIMISM: TokenlistChainId.OPTIMISM,
};

export const vaultAnalyticsTool = {
  name: 'factor_vault_analytics',
  description: 'Get detailed vault position breakdown with per-token balances, USD values, APY/APR by protocol (Aave, Compound, Morpho, Pendle, idle tokens), and aggregate stats (weighted APY, TVL breakdown, net return). Reads directly from on-chain — always up to date.',
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
  handler: async (input: VaultAnalyticsInput) => {
    const validated = vaultAnalyticsSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const vaultAddress = validated.vaultAddress as `0x${string}`;
    const chain = configManager.getConfig().chain;
    const chainId = CHAIN_MAP[chain];
    if (!chainId) throw new VaultError(`Unsupported chain for analytics: ${chain}`);

    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyApiKey) throw new VaultError('ALCHEMY_API_KEY required for vault analytics');

    try {
      const analytics = new FactorVaultAnalytics(chainId, alchemyApiKey);

      // Retry-on-empty guard: under concurrent load @factordao/vault-analytics
      // occasionally returns an empty deposits object (one of its internal
      // parallel eth_call/eth_getLogs requests times out silently against the
      // Alchemy RPC instead of throwing). The handler would then format
      // positions=[]/tvl=0/stats all zero as a "successful" response and the
      // client treats a live vault as empty. Re-run the fetch once with a
      // small backoff when deposits is unexpectedly empty — a legitimately
      // empty vault is rare in the fleet and costs at most ~200ms extra on
      // that edge case, while the bug is frequent under parallel load.
      let deposits: Awaited<ReturnType<typeof analytics.getVaultDeposits>> = {} as any;
      let tvlUsd = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        [deposits, tvlUsd] = await Promise.all([
          analytics.getVaultDeposits(vaultAddress),
          analytics.getVaultTVL(vaultAddress, configManager.getEnvironment() as any).catch(() => 0),
        ]);
        const isEmpty = !deposits || Object.keys(deposits).length === 0;
        if (!isEmpty) break;
        if (attempt === 0) await new Promise(r => setTimeout(r, 200));
      }

      const stats = await analytics.calculateVaultStats(deposits, tvlUsd);

      const positions = Object.entries(deposits).map(([address, token]) => ({
        address,
        symbol: token.metadata.symbol,
        name: token.metadata.name,
        type: token.type,
        protocol: token.protocol,
        balance: token.balance_fmt,
        valueUsd: Math.round(token.value_usd * 100) / 100,
        apy: Math.round(token.apy * 100) / 100,
        apr: Math.round(token.apr * 100) / 100,
        underlying: token.metadata.underlying,
      }));

      const typeOrder: Record<string, number> = { credit: 0, supply: 1, idle: 2, unknown: 3, debt: 4 };
      positions.sort((a, b) => (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3));

      return {
        success: true,
        vaultAddress,
        chain,
        tvlUsd: Math.round(tvlUsd * 100) / 100,
        positions,
        stats: {
          totalIdleUsd: Math.round(stats.total_idle_usd * 100) / 100,
          totalCreditUsd: Math.round(stats.total_credit_usd * 100) / 100,
          totalDebtUsd: Math.round(stats.total_debt_usd * 100) / 100,
          weightedApyCredit: Math.round(stats.weighted_apy_credit * 100) / 100,
          weightedApyDebt: Math.round(stats.weighted_apy_debt * 100) / 100,
          netReturn: Math.round(stats.net_return * 100) / 100,
          calculatedApy: Math.round(stats.calculated_apy * 100) / 100,
        },
        positionCount: positions.length,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      const details = error instanceof Error ? error.message : String(error);
      throw new SdkError(`Failed to get vault analytics: ${details}`, error);
    }
  },
};
