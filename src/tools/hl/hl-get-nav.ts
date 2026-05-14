import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

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
      // Read-only tool: don't force a wallet just to read NAV.
      const hlVault = buildHlVault(validated.vault as Address, {
        requireSigner: false,
      });
      const nav = await hlVault.getNav();

      return {
        vault: validated.vault,
        chainId: HYPEREVM_CHAIN_ID,
        evmUsdc: nav.evmUsdc.toString(),
        spotUsdc: nav.spotUsdc.toString(),
        perpAccountValue: nav.perpEquity.toString(),
        totalUsd: nav.totalUsdc.toString(),
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to read HL NAV', error);
    }
  },
};
