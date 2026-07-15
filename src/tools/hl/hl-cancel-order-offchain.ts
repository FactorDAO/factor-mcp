import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { configManager } from '../../config/index.js';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

/**
 * factor_hl_cancel_order_offchain
 *
 * Cancel a HyperLiquid perp order by cloid via the off-chain HL Exchange
 * API. Required for HIP-3 builder-dex orders (xyz:GOLD, xyz:BRENTOIL,
 * etc) — those don't route through CoreWriter so the on-chain
 * `factor_hl_cancel_order` can't cancel them.
 *
 * SAFETY (no-third-party-transfer invariant): this tool ONLY kills a
 * resting order. It does NOT move funds to any third party — neither
 * the vault's positions nor its EVM/perp balances are touched.
 *
 * Returns the raw HL Exchange response (`{status, response}`); no on-chain
 * tx is produced.
 */
export const hlCancelOrderOffchainSchema = z.object({
  vault: z.string(),
  perp: z
    .string()
    .min(1)
    .describe(
      'Qualified builder-dex symbol ("xyz:GOLD", "xyz:BRENTOIL", ...) OR main-dex symbol ("ETH", "BTC", ...). Presence of ":" routes via builder-dex asset resolution.',
    ),
  cloid: z
    .string()
    .regex(/^0x[0-9a-fA-F]{32}$/)
    .describe('Client order id — 0x + 32 hex chars (128 bits).'),
  password: z.string().optional(),
});

export type HlCancelOrderOffchainInput = z.infer<typeof hlCancelOrderOffchainSchema>;

export const hlCancelOrderOffchainTool = {
  name: 'factor_hl_cancel_order_offchain',
  description:
    'Cancel a HyperLiquid perp order by cloid via the off-chain HL Exchange API. Required for HIP-3 builder-dex orders (xyz:GOLD, etc) which CoreWriter does not route. Does NOT move funds — only kills the resting order. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      perp: {
        type: 'string',
        description:
          'Qualified symbol. Builder dex: "xyz:GOLD", "xyz:BRENTOIL", ... Main dex: "ETH", "BTC", or numeric index as string.',
      },
      cloid: {
        type: 'string',
        description: 'Client order id — 0x + 32 hex chars (128 bits).',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp', 'cloid'],
  },
  handler: async (input: HlCancelOrderOffchainInput) => {
    const validated = hlCancelOrderOffchainSchema.parse(input);

    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    try {
      const hlVault = buildHlVault(validated.vault as Address, {
        password: validated.password,
      });

      // Numeric-string main-dex perps are passed as numbers (e.g. "0" -> 0)
      // so the SDK uses the index fast-path. Anything else (symbol like
      // "ETH" or qualified "xyz:GOLD") flows through resolvePerp /
      // resolveBuilderDex.
      const numericPerp = /^\d+$/.test(validated.perp) ? Number(validated.perp) : validated.perp;

      const response = await hlVault.cancelOrderOffChain({
        perp: numericPerp,
        cloid: validated.cloid,
      });

      return {
        submitted: true,
        action: 'hl_cancel_order_offchain',
        chainId: HYPEREVM_CHAIN_ID,
        vault: validated.vault,
        perp: validated.perp,
        cloid: validated.cloid,
        status: (response as { status?: string }).status,
        response: response as unknown as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to cancel HL perp order off-chain', error);
    }
  },
};
