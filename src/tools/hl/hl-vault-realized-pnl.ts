import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVaultMetrics } from './hl-vault-factory.js';

export const hlVaultRealizedPnlSchema = z.object({
  vault: z.string(),
  startTime: z.number().int().nonnegative().optional(),
  endTime: z.number().int().nonnegative().optional(),
});

export type HlVaultRealizedPnlInput = z.infer<typeof hlVaultRealizedPnlSchema>;

export interface HlVaultRealizedPnlResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  startTime?: number;
  endTime?: number;
  /// Gross realized PnL (sum of `closedPnl` over closing fills) — USD.
  totalUsd: number;
  /// Total fees paid in window (USD).
  totalFeesUsd: number;
  /// Net realized PnL (totalUsd - totalFeesUsd) — USD.
  netUsd: number;
  /// Number of fills that closed a position (closedPnl != 0).
  closeFillCount: number;
  /// Total number of fills considered (open + close).
  totalFillCount: number;
  /// PnL attribution by coin (bare ticker on main, qualified 'xyz:GOLD' on builder).
  byCoin: Record<string, number>;
  /// PnL attribution by dex name (e.g. 'main', 'xyz').
  byDex: Record<string, number>;
}

export const hlVaultRealizedPnlTool = {
  name: 'factor_hl_vault_realized_pnl',
  description:
    'Realized PnL aggregation over a time window for a HyperLiquid FACTOR vault. Sums `closedPnl` across closing fills (gross + net of fees), with attribution by coin and by dex. Optional startTime/endTime in unix ms — without a window the call considers all recent fills. HyperEVM (chain 999) only. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      startTime: { type: 'number', description: 'Unix ms — earliest fill to include (optional).' },
      endTime: { type: 'number', description: 'Unix ms — latest fill to include (optional).' },
    },
    required: ['vault'],
  },
  handler: async (input: HlVaultRealizedPnlInput): Promise<HlVaultRealizedPnlResult> => {
    const validated = hlVaultRealizedPnlSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      const { metrics } = buildHlVaultMetrics(validated.vault as Address);
      const agg = await metrics.getRealizedPnl({
        startTime: validated.startTime,
        endTime: validated.endTime,
      });
      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        startTime: validated.startTime,
        endTime: validated.endTime,
        ...agg,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to compute HL realized PnL', error);
    }
  },
};
