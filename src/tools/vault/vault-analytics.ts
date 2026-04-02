import { z } from 'zod';
import { isAddress } from 'viem';
import { configManager } from '../../config/index.js';
import { VaultError, SdkError } from '../../utils/errors.js';

export const vaultAnalyticsSchema = z.object({
  vaultAddress: z.string(),
});

export type VaultAnalyticsInput = z.infer<typeof vaultAnalyticsSchema>;

const STATS_API_URLS: Record<string, string> = {
  production: 'https://factor-studio-stats-api.fly.dev',
  staging: 'https://factor-studio-stats-api.fly.dev',
  testing: 'https://factor-studio-stats-api-staging.fly.dev',
};

const CHAIN_IDS: Record<string, number> = {
  ARBITRUM_ONE: 42161,
  BASE: 8453,
  MAINNET: 1,
  OPTIMISM: 10,
};

async function fetchFromStatsApi(
  vaultAddress: string,
  chain: string,
  environment: string,
): Promise<Record<string, unknown> | null> {
  const baseUrl = STATS_API_URLS[environment] || STATS_API_URLS.production;
  const chainId = CHAIN_IDS[chain];
  if (!chainId) return null;

  const url = `${baseUrl}/utils/pro-vaults/${chainId}?vaultAddress=${vaultAddress}`;
  const res = await fetch(url, {
    headers: { Origin: 'https://studio.factor.fi' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;
  const data = await res.json() as Record<string, unknown>;
  if (!data || data.error) return null;
  return data;
}

function formatStatsApiResponse(data: Record<string, unknown>, vaultAddress: string, chain: string) {
  const balances = data.balances as Record<string, { token: string; balance: string }> | undefined;
  const positions = balances
    ? Object.entries(balances).map(([, b]) => ({
        token: b.token,
        balance: b.balance,
      }))
    : [];

  const performance = {
    '24h': (data.performance24h as Record<string, string>)?.pnl || 'N/A',
    '7d': (data.performance7d as Record<string, string>)?.pnl || 'N/A',
    '30d': (data.performance30d as Record<string, string>)?.pnl || 'N/A',
    '90d': (data.performance90d as Record<string, string>)?.pnl || 'N/A',
  };

  return {
    success: true,
    source: 'stats-api',
    vaultAddress,
    chain,
    name: data.name,
    symbol: data.symbol,
    tvlUsd: data.tvlUsd,
    totalSupply: data.totalSupply,
    pricePerShare: data.pricePerShare,
    pricePerShareUsd: data.pricePerShareUsd,
    netVaultValue: data.netVaultValue,
    denominator: data.denominator,
    assets: data.assets,
    debts: data.debts,
    managers: data.managers,
    managerAdapters: data.managerAdapters,
    balances: positions,
    performance,
    fees: {
      deposit: data.depositFee,
      withdraw: data.withdrawFee,
      management: data.managementFee,
      performance: data.performanceFee,
      receiver: data.feesReceiver,
    },
  };
}

export const vaultAnalyticsTool = {
  name: 'factor_vault_analytics',
  description: 'Get detailed vault analytics from the Stats API: balances per token, USD values, performance (24h/7d/30d/90d), TVL, managers, adapters, and fees. More detailed than factor_get_vault_info. Use this for reports and deep analysis.',
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

    const chain = configManager.getConfig().chain;
    const environment = configManager.getEnvironment();

    // Primary: Stats API (cached, fast, rich data)
    try {
      const statsData = await fetchFromStatsApi(validated.vaultAddress, chain, environment);
      if (statsData) {
        return formatStatsApiResponse(statsData, validated.vaultAddress, chain);
      }
    } catch {
      // Stats API unavailable, fall through to fallback
    }

    // Fallback: vault-analytics package (direct on-chain)
    try {
      const { FactorVaultAnalytics } = await import('@factordao/vault-analytics');
      const { ChainId } = await import('@factordao/tokenlist');

      const chainIdMap: Record<string, number> = {
        ARBITRUM_ONE: ChainId.ARBITRUM_ONE,
        BASE: ChainId.BASE,
        MAINNET: ChainId.ETHEREUM,
      };
      const tokenlistChainId = chainIdMap[chain];
      if (!tokenlistChainId) throw new VaultError(`Unsupported chain for analytics: ${chain}`);

      const alchemyApiKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyApiKey) throw new VaultError('ALCHEMY_API_KEY required for fallback analytics');

      const analytics = new FactorVaultAnalytics(tokenlistChainId, alchemyApiKey);
      const vaultAddr = validated.vaultAddress as `0x${string}`;

      const [deposits, tvlUsd] = await Promise.all([
        analytics.getVaultDeposits(vaultAddr),
        analytics.getVaultTVL(vaultAddr, environment as any).catch(() => 0),
      ]);

      const stats = await analytics.calculateVaultStats(deposits, tvlUsd);

      const positions = Object.entries(deposits).map(([address, token]) => ({
        address,
        symbol: token.metadata.symbol,
        type: token.type,
        protocol: token.protocol,
        balance: token.balance_fmt,
        valueUsd: Math.round(token.value_usd * 100) / 100,
        apy: Math.round(token.apy * 100) / 100,
      }));

      return {
        success: true,
        source: 'vault-analytics',
        vaultAddress: validated.vaultAddress,
        chain,
        tvlUsd: Math.round(tvlUsd * 100) / 100,
        positions,
        stats: {
          totalIdleUsd: Math.round(stats.total_idle_usd * 100) / 100,
          totalCreditUsd: Math.round(stats.total_credit_usd * 100) / 100,
          totalDebtUsd: Math.round(stats.total_debt_usd * 100) / 100,
          weightedApyCredit: Math.round(stats.weighted_apy_credit * 100) / 100,
          weightedApyDebt: Math.round(stats.weighted_apy_debt * 100) / 100,
          calculatedApy: Math.round(stats.calculated_apy * 100) / 100,
        },
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      const details = error instanceof Error ? error.message : String(error);
      throw new SdkError(`Failed to get vault analytics (both sources failed): ${details}`, error);
    }
  },
};
