import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, SdkError } from '../../utils/errors.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain, type OffChainHlResult } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlAddIsolatedMarginSchema = z.object({
  vault: z.string(),
  perp: z.string().min(1),
  isLong: z.boolean(),
  deltaUsd: z.number(),
  password: z.string().optional(),
});

export type HlAddIsolatedMarginInput = z.infer<typeof hlAddIsolatedMarginSchema>;

export const hlAddIsolatedMarginTool = {
  name: 'factor_hl_add_isolated_margin',
  description:
    'Adjust isolated margin (positive = add, negative = withdraw) on a HL perp position via an off-chain EIP-712 action signed by the vault agent. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      perp: { type: 'string', description: 'Perp symbol.' },
      isLong: { type: 'boolean', description: 'Direction of the position to top up.' },
      deltaUsd: {
        type: 'number',
        description: 'USD margin delta — positive to add, negative to withdraw.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp', 'isLong', 'deltaUsd'],
  },
  handler: async (input: HlAddIsolatedMarginInput): Promise<OffChainHlResult> => {
    const validated = hlAddIsolatedMarginSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    if (validated.deltaUsd === 0) throw new VaultError('deltaUsd must be non-zero');
    assertHyperEvmChain();

    try {
      const hlVault = buildHlVault(validated.vault as Address, {
        password: validated.password,
      });
      const exchangeResponse = await hlVault.addIsolatedMargin(
        validated.perp,
        validated.isLong,
        validated.deltaUsd,
      );
      return {
        submitted: true,
        txHash: 'off-chain-hl-action',
        action: 'hl_add_isolated_margin',
        chainId: HYPEREVM_CHAIN_ID,
        vault: validated.vault,
        details: {
          perp: validated.perp,
          isLong: validated.isLong,
          deltaUsd: validated.deltaUsd,
          exchangeResponse: exchangeResponse as unknown as Record<string, unknown>,
        },
      };
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new SdkError('Failed to submit HL addIsolatedMargin action', error);
    }
  },
};
