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
// Accept any 0x-prefixed hex up to 32 bytes (64 hex chars). The on-chain
// gate is `settlePending(uint128 cloid)` so we only care about the low
// 16 bytes (32 hex chars). HL Exchange API returns 32-byte cloids
// (uint256 hashes from EIP-712 signing) for L1-signed orders, and our
// CoreWriter dispatch path generates 16-byte cloids. Both should
// round-trip through the same tool — we truncate to the low 128 bits
// inside the handler (BigInt masks the high bits automatically).
const CLOID_HEX_REGEX = /^0x[0-9a-fA-F]{1,64}$/;

export const hlSettlePendingSchema = z.object({
  vault: z.string(),
  cloid: z
    .string()
    .regex(CLOID_HEX_REGEX)
    .describe('Pending cloid to settle (uint128, accepts 16- or 32-byte hex)'),
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
          'Pending cloid to settle — uint128 hex. Accepts 16-byte (0x + 32 hex) for CoreWriter-dispatched orders OR 32-byte (0x + 64 hex) for L1-signed orders; only the low 128 bits are used on-chain.',
        pattern: '^0x[0-9a-fA-F]{1,64}$',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'cloid'],
  },
  handler: async (input: HlSettlePendingInput) => {
    const validated = hlSettlePendingSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    // Stateless mode: don't enforce a wallet. settle_pending is
    // permissionless on-chain — anyone can call it; agent-executor
    // routes the calldata through the sponsor relay.
    const stateless = configManager.isStateless();
    if (!stateless) {
      const walletName = configManager.getWalletName();
      if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vault = validated.vault as Address;
    // Truncate to uint128 (low 128 bits) — the on-chain settlePending
    // takes a uint128, but the LLM often passes 256-bit hashes from
    // HL Exchange responses (orderId, etc). Masking here avoids "value
    // out of range for uint128" reverts at the contract layer.
    const UINT128_MASK = (1n << 128n) - 1n;
    const cloid = BigInt(validated.cloid) & UINT128_MASK;

    try {
      // Stateless path: build calldata without a signer. settlePending is
      // permissionless on-chain — agent-executor routes via the sponsor
      // relay (executeAsAgent), same pattern as the open/close paths.
      if (stateless) {
        const hlVaultStateless = buildHlVault(vault, {
          password: validated.password,
          requireSigner: false,
        });
        const sendTxNoSig: SendTransactionParams = hlVaultStateless.settlePending(cloid);
        return {
          success: true,
          simulationMode: false,
          action: 'hl_settle_pending',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          cloid: validated.cloid,
          transaction: {
            to: sendTxNoSig.to,
            data: sendTxNoSig.data,
            value: typeof sendTxNoSig.value === 'bigint'
              ? sendTxNoSig.value.toString()
              : sendTxNoSig.value,
          },
        };
      }

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
