import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVaultMetrics } from './hl-vault-factory.js';

export const hlVaultFillsSchema = z.object({
  vault: z.string(),
  startTime: z.number().int().nonnegative().optional(),
  endTime: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export type HlVaultFillsInput = z.infer<typeof hlVaultFillsSchema>;

export interface HlFillView {
  time: number;
  coin: string;
  dex: string;
  side: 'buy' | 'sell';
  px: number;
  sz: number;
  closedPnlUsd: number;
  feeUsd: number;
  feeToken: string;
  hash?: string;
  oid?: number;
}

export interface HlVaultFillsResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  startTime?: number;
  endTime?: number;
  fills: HlFillView[];
  truncated: boolean;  // true if limit was hit
}

export const hlVaultFillsTool = {
  name: 'factor_hl_vault_fills',
  description:
    'Historical trade fills for a HyperLiquid FACTOR vault (HL userFills / userFillsByTime). Each fill: time, coin, dex (main / builder), side, price, size, realized PnL closed, fee. Optional startTime/endTime in unix ms; without a window the call returns recent fills. Optional `limit` (default unbounded, max 2000 per HL). HyperEVM (chain 999) only. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      startTime: { type: 'number', description: 'Unix ms — earliest fill to include (optional).' },
      endTime: { type: 'number', description: 'Unix ms — latest fill to include (optional).' },
      limit: { type: 'number', description: 'Max number of fills to return (1–2000).' },
    },
    required: ['vault'],
  },
  handler: async (input: HlVaultFillsInput): Promise<HlVaultFillsResult> => {
    const validated = hlVaultFillsSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      const { metrics } = buildHlVaultMetrics(validated.vault as Address);
      const all = await metrics.getFills({
        startTime: validated.startTime,
        endTime: validated.endTime,
      });
      const sorted = all.sort((a, b) => b.time - a.time);
      const limit = validated.limit ?? sorted.length;
      const fills = sorted.slice(0, limit);
      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        startTime: validated.startTime,
        endTime: validated.endTime,
        fills,
        truncated: fills.length < sorted.length,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL vault fills', error);
    }
  },
};
