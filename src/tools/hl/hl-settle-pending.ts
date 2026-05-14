import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

/**
 * Reconciliation — `factor_hl_settle_pending`
 *
 * Wraps `HyperLiquidPerpAdapter.settlePending(uint128 cloid)`. Clears a
 * pending action entry from the adapter's `pendingActions` storage map
 * AFTER HyperLiquid has had time to process the corresponding order /
 * cancel. Used by keepers and for manual reconciliation.
 *
 * **Permissionless on-chain**: any caller can submit — the signer does
 * NOT need to be the vault manager. The MCP tool still requires a wallet
 * because it broadcasts an EVM transaction.
 *
 * **Gated by `MIN_SETTLE_DELAY_BLOCKS = 5`**: the vault contract reverts
 * with `HL__SettleTooEarly` if invoked before 5 HyperEVM blocks have
 * elapsed since the pending action was registered. This tool just
 * submits — the on-chain gate is what enforces the delay.
 *
 * **Cannot move funds**: only deletes an entry from `pendingActions`.
 * USDC stays in the vault.
 */
const CLOID_HEX_REGEX = /^0x[0-9a-fA-F]{32}$/;

export const hlSettlePendingSchema = z.object({
  vault: z.string(),
  cloid: z
    .string()
    .regex(CLOID_HEX_REGEX)
    .describe('Pending cloid to settle (uint128 as 16-byte hex)'),
  password: z.string().optional(),
});

export type HlSettlePendingInput = z.infer<typeof hlSettlePendingSchema>;

export const hlSettlePendingTool = {
  name: 'factor_hl_settle_pending',
  description:
    'Clear a pending HyperLiquid cloid from the vault adapter\'s pendingActions map. Permissionless on-chain (signer does NOT need to be the vault manager), but gated by MIN_SETTLE_DELAY_BLOCKS=5 — the on-chain call reverts with HL__SettleTooEarly if too few blocks have passed since the action was registered. Cannot move funds. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      cloid: {
        type: 'string',
        description:
          'Pending cloid to settle — uint128 encoded as 16-byte hex (0x + 32 hex chars).',
        pattern: '^0x[0-9a-fA-F]{32}$',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'cloid'],
  },
  handler: async (input: HlSettlePendingInput) => {
    const validated = hlSettlePendingSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;
    const cloid = BigInt(validated.cloid);

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      const sendTx: SendTransactionParams = hlVault.settlePending(cloid);

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
        value: sendTx.value,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({ gasLimit: 0n, totalCostEth: '0' }));
        return {
          submitted: true,
          success: true,
          simulationMode: true,
          action: 'hl_settle_pending',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          cloid: validated.cloid,
          txCalldata: { to: sendTx.to, data: sendTx.data, value: sendTx.value?.toString() ?? '0' },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast. Gated by MIN_SETTLE_DELAY_BLOCKS=5 on-chain.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        submitted: true,
        success: true,
        simulationMode: false,
        action: 'hl_settle_pending',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        cloid: validated.cloid,
        txCalldata: { to: sendTx.to, data: sendTx.data, value: sendTx.value?.toString() ?? '0' },
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to settle pending HL cloid', error);
    }
  },
};
