import { z } from 'zod';
import { isAddress } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';

export const hlGetNavSchema = z.object({
  vault: z.string(),
});

export type HlGetNavInput = z.infer<typeof hlGetNavSchema>;

export interface HlNavResult {
  vault: string;
  chainId: typeof HYPEREVM_CHAIN_ID;
  evmUsdc: string;       // USDC 6-dec on HyperEVM (as string for big-int safety)
  spotUsdc: string;      // HL spot ledger USDC, normalized to 6-dec
  perpAccountValue: string; // HL perp account equity, USDC 6-dec
  totalUsd: string;      // sum of all three, 6-dec
  todo?: string;
}

export const hlGetNavTool = {
  name: 'factor_hl_get_nav',
  description:
    'Read a HyperLiquid-enabled vault\'s tri-ledger NAV: HyperEVM USDC balance + HL spot USDC + HL perp account equity. HyperEVM (chain 999) only.',
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
      // TODO: wire to HLVault.getNav() — reads erc20 balance + HL precompiles
      // (spotBalance for token 0, accountMarginSummary.accountValue).
      const evmUsdc = 0n;
      const spotUsdc = 0n;
      const perpAccountValue = 0n;
      const totalUsd = evmUsdc + spotUsdc + perpAccountValue;

      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        evmUsdc: evmUsdc.toString(),
        spotUsdc: spotUsdc.toString(),
        perpAccountValue: perpAccountValue.toString(),
        totalUsd: totalUsd.toString(),
        todo: 'wire to HLVault.getNav — SDK HL module not yet exported',
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL NAV', error);
    }
  },
};
