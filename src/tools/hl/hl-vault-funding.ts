import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVaultMetrics } from './hl-vault-factory.js';

export const hlVaultFundingSchema = z.object({
  vault: z.string(),
  startTime: z.number().int().nonnegative().optional(),
  endTime: z.number().int().nonnegative().optional(),
});

export type HlVaultFundingInput = z.infer<typeof hlVaultFundingSchema>;

export interface HlFundingView {
  time: number;
  coin: string;
  dex: string;
  /// Signed USDC — POSITIVE = paid out by vault, NEGATIVE = received.
  usdc: number;
  szi: number;
  fundingRate: number;
}

export interface HlVaultFundingResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  startTime?: number;
  endTime?: number;
  /// Sum of `usdc` across all events in window (matches sign convention).
  /// Positive = net funding paid by vault, negative = net received.
  netFundingUsd: number;
  events: HlFundingView[];
}

export const hlVaultFundingTool = {
  name: 'factor_hl_vault_funding',
  description:
    'Funding-payment history for a HyperLiquid FACTOR vault (HL userFunding). Each event: time, coin, dex, signed USDC (positive = vault paid funding, negative = vault received funding), position size at the accrual, hourly funding rate. Returns `netFundingUsd` as the sum over the window. Optional startTime/endTime in unix ms. HyperEVM (chain 999) only. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      startTime: { type: 'number', description: 'Unix ms — earliest event to include (optional).' },
      endTime: { type: 'number', description: 'Unix ms — latest event to include (optional).' },
    },
    required: ['vault'],
  },
  handler: async (input: HlVaultFundingInput): Promise<HlVaultFundingResult> => {
    const validated = hlVaultFundingSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      const { metrics } = buildHlVaultMetrics(validated.vault as Address);
      const events = await metrics.getFundingHistory({
        startTime: validated.startTime,
        endTime: validated.endTime,
      });
      const netFundingUsd = events.reduce((acc, e) => acc + e.usdc, 0);
      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        startTime: validated.startTime,
        endTime: validated.endTime,
        netFundingUsd,
        events: events.sort((a, b) => b.time - a.time),
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL vault funding history', error);
    }
  },
};
