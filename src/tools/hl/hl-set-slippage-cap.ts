import { z } from 'zod';
import { VaultError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, HL_MAX_SLIPPAGE_BPS, assertHyperEvmChain } from './common.js';

export const hlSetSlippageCapSchema = z.object({
  // No inputs — purely informational. Reserved for forward-compat in case
  // the cap becomes adapter-configurable.
});

export type HlSetSlippageCapInput = z.infer<typeof hlSetSlippageCapSchema>;

export interface HlSlippageCapResult {
  chainId: typeof HYPEREVM_CHAIN_ID;
  maxSlippageBps: number;
  note: string;
}

export const hlSetSlippageCapTool = {
  name: 'factor_hl_set_slippage_cap',
  description:
    'View the HL adapter\'s MAX_SLIPPAGE_BPS constant (the hard upper bound any open/close order will accept). Read-only; no on-chain action. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (input: HlSetSlippageCapInput): Promise<HlSlippageCapResult> => {
    hlSetSlippageCapSchema.parse(input ?? {});
    try {
      assertHyperEvmChain();
    } catch (e) {
      if (e instanceof VaultError) throw e;
      throw e;
    }
    return {
      chainId: HYPEREVM_CHAIN_ID,
      maxSlippageBps: HL_MAX_SLIPPAGE_BPS,
      note: `Adapter rejects any open/close order whose slippageBps exceeds ${HL_MAX_SLIPPAGE_BPS}. Default per-call slippageBps is 1000 (10%).`,
    };
  },
};
