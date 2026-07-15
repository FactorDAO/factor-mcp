import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVaultMetrics } from './hl-vault-factory.js';

export const hlVaultPositionsDetailSchema = z.object({
  vault: z.string(),
});

export type HlVaultPositionsDetailInput = z.infer<typeof hlVaultPositionsDetailSchema>;

export interface HlPositionDetailView {
  dex: string;
  perp: string;
  side: 'long' | 'short';
  sizeReal: number;
  entryPxReal: number;
  markPxReal: number;
  liquidationPxReal: number | null;
  notionalUsd: number;
  entryNotionalUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  roeOnMarginPct: number;
  marginUsedUsd: number;
  cumulativeFundingUsd: number;
  leverage: number;
  marginMode: 'cross' | 'isolated';
}

export interface HlVaultPositionsDetailResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  positions: HlPositionDetailView[];
}

export const hlVaultPositionsDetailTool = {
  name: 'factor_hl_vault_positions_detail',
  description:
    'Detailed open positions for a HyperLiquid FACTOR vault — across main HL dex AND every HIP-3 builder dex the vault has equity on. Each position includes side, leverage, margin mode, entry/mark/liquidation prices, notional USD, unrealized PnL (USD + %), ROE on margin %, margin used, and cumulative funding accrued. HyperEVM (chain 999) only. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
    },
    required: ['vault'],
  },
  handler: async (input: HlVaultPositionsDetailInput): Promise<HlVaultPositionsDetailResult> => {
    const validated = hlVaultPositionsDetailSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      const { metrics } = buildHlVaultMetrics(validated.vault as Address);
      const positions = await metrics.getOpenPositions();
      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        positions,
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL position details', error);
    }
  },
};
