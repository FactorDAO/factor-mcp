import { z } from 'zod';
import { isAddress } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';

export const hlGetPositionsSchema = z.object({
  vault: z.string(),
});

export type HlGetPositionsInput = z.infer<typeof hlGetPositionsSchema>;

export interface HlPositionView {
  perp: string;
  isLong: boolean;
  sizeWei: string;       // signed contract size, native HL szDecimals
  entryPrice: string;    // float price as string
  leverage: number;
  mode: 'cross' | 'isolated';
  unrealizedPnl: string; // USDC 6-dec
}

export interface HlPositionsResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  positions: HlPositionView[];
  todo?: string;
}

export const hlGetPositionsTool = {
  name: 'factor_hl_get_positions',
  description:
    'List all active HyperLiquid perp positions held by a Factor vault. Returns size, entry price, leverage, margin mode, and unrealized PnL. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
    },
    required: ['vault'],
  },
  handler: async (input: HlGetPositionsInput): Promise<HlPositionsResult> => {
    const validated = hlGetPositionsSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    try {
      // TODO: wire to HLVault.getPositions() — iterates active perps via the
      // HL info API and `HLPosition` precompile reads.
      const positions: HlPositionView[] = [];

      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        positions,
        todo: 'wire to HLVault.getPositions — SDK HL module not yet exported',
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL positions', error);
    }
  },
};
