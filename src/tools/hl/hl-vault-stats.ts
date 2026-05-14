import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVaultMetrics } from './hl-vault-factory.js';

export const hlVaultStatsSchema = z.object({
  vault: z.string(),
});

export type HlVaultStatsInput = z.infer<typeof hlVaultStatsSchema>;

export interface HlVaultStatsResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  asOf: string;
  nav: {
    evmUsdc: number;
    spotUsdc: number;
    perpEquityUsdc: number;
    totalUsdc: number;
  };
  share: {
    sharePriceUsdc: number;
    totalSupply: string;
    totalAssetsUsdc: number;
  };
  positions: {
    count: number;
    longCount: number;
    shortCount: number;
    totalNotionalUsd: number;
    netDirectionalNotionalUsd: number;
    totalUnrealizedPnlUsd: number;
    totalMarginUsedUsd: number;
    totalCumulativeFundingUsd: number;
    byDex: Record<string, { count: number; notionalUsd: number; unrealizedPnlUsd: number }>;
  };
  marginSummaries: Array<{
    dex: string;
    accountValueUsd: number;
    marginUsedUsd: number;
    withdrawableUsd: number;
    totalNotionalUsd: number;
  }>;
}

export const hlVaultStatsTool = {
  name: 'factor_hl_vault_stats',
  description:
    'Aggregate analytics snapshot for a HyperLiquid-enabled FACTOR vault: tri-ledger NAV, ERC-4626 share price, open-position aggregates (count, notional, uPnL, margin used, funding accrued), and per-dex margin summary (main + builder dexes). Single dashboard-ready response. HyperEVM (chain 999) only. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
    },
    required: ['vault'],
  },
  handler: async (input: HlVaultStatsInput): Promise<HlVaultStatsResult> => {
    const validated = hlVaultStatsSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      const { metrics } = buildHlVaultMetrics(validated.vault as Address);
      const stats = await metrics.getStats();

      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        asOf: stats.asOf,
        nav: {
          evmUsdc: Number(stats.nav.evmUsdc) / 1e6,
          spotUsdc: Number(stats.nav.spotUsdc) / 1e6,
          perpEquityUsdc: Number(stats.nav.perpEquity) / 1e6,
          totalUsdc: Number(stats.nav.totalUsdc) / 1e6,
        },
        share: {
          sharePriceUsdc: stats.share.sharePriceUsdc,
          totalSupply: stats.share.totalSupply.toString(),
          totalAssetsUsdc: stats.share.totalAssetsUsdc,
        },
        positions: stats.positions,
        marginSummaries: stats.marginSummaries,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL vault stats', error);
    }
  },
};
