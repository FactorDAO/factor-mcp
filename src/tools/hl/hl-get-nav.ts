import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVaultMetrics } from './hl-vault-factory.js';

export const hlGetNavSchema = z.object({
  vault: z.string(),
});

export type HlGetNavInput = z.infer<typeof hlGetNavSchema>;

export interface HlNavResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  evmUsdc: string;       // USDC 6-dec on HyperEVM (as string for big-int safety)
  spotUsdc: string;      // HL spot ledger USDC, normalized to 6-dec
  /** Main-dex perp account equity (USDC 6-dec). Precompile read.
   *  For the FULL perp leg INCLUDING builder dexes, sum `perpEquityByDex`. */
  perpAccountValue: string;
  /** Total NAV USDC (6-dec) across EVM USDC + HL spot + every perp dex
   *  (main + builder dexes). Aggregates builder-dex sub-accounts that
   *  the precompile `nav.perpEquity` silently drops. */
  totalUsd: string;
  /** Per-dex perp account equity attribution (USD float, NOT 6-dec). Always
   *  includes `'main'`; additional keys (e.g. `'xyz'`) appear when the
   *  vault has equity on HIP-3 builder dexes. */
  perpEquityByDex: Record<string, number>;
}

export const hlGetNavTool = {
  name: 'factor_hl_get_nav',
  description:
    "Read a HyperLiquid-enabled vault's tri-ledger NAV: HyperEVM USDC balance + HL spot USDC + per-dex HL perp account equity (main + every builder dex the vault has equity on). HyperEVM (chain 999) only.",
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
    },
    required: ['vault'],
  },
  handler: async (input: HlGetNavInput): Promise<HlNavResult> => {
    const validated = hlGetNavSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      // We go through `HLVaultMetrics.getStats()` (not `HLVault.getNav()`)
      // because the latter's precompile read is hardcoded to `perpDex=0`
      // and silently drops every HIP-3 builder-dex sub-account. Stats
      // aggregates main + builder dexes by reading HL Info's
      // `clearinghouseState.marginSummary.accountValue` per dex and
      // surfaces them as `perpEquityByDex`. Until that landed, a vault
      // with $48 on xyz appeared as a $15 NAV here.
      const { metrics } = buildHlVaultMetrics(validated.vault as Address);
      const stats = await metrics.getStats();

      // `stats.navUsdc` already aggregates the multi-dex perp leg; rebuild
      // the 6-dec totalUsd from it so this tool stays string/bigint-safe.
      const totalUsd6 = Math.round(stats.navUsdc * 1e6);

      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        evmUsdc: stats.nav.evmUsdc.toString(),
        spotUsdc: stats.nav.spotUsdc.toString(),
        perpAccountValue: stats.nav.perpEquity.toString(),
        totalUsd: totalUsd6.toString(),
        perpEquityByDex: stats.perpEquityByDex,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL NAV', error);
    }
  },
};
