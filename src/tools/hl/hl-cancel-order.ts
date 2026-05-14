import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

/**
 * factor_hl_cancel_order
 *
 * On-chain cancel of an open perp order via CoreWriter. Wraps
 * `HLVault.cancelOrder({perp, cloid})` which encodes
 * `HyperLiquidPerpAdapter.cancelOrder(uint32, uint128)` and submits it
 * through `executeByManager`.
 *
 * SAFETY (no-third-party-transfer invariant): this tool ONLY kills a
 * resting order. It does NOT move funds to any third party — neither
 * the vault's positions nor its EVM/perp balances are touched.
 *
 * Use this for main-dex perps (BTC, ETH, ...). For builder-dex perps
 * (xyz:GOLD, etc), use `factor_hl_cancel_order_offchain` instead.
 */
export const hlCancelOrderSchema = z.object({
  vault: z.string(),
  perp: z.number().int().min(0).describe('Perp asset index (main dex; 0=BTC, 1=ETH, ...)'),
  cloid: z
    .string()
    .regex(/^0x[0-9a-fA-F]{32}$/)
    .describe('Client order id from open/place — 0x + 32 hex chars (128 bits)'),
  password: z.string().optional(),
});

export type HlCancelOrderInput = z.infer<typeof hlCancelOrderSchema>;

export const hlCancelOrderTool = {
  name: 'factor_hl_cancel_order',
  description:
    'Cancel a HyperLiquid main-dex perp order by cloid via CoreWriter (on-chain). HyperEVM (chain 999) only. Does NOT move funds — only kills the resting order. For HIP-3 builder-dex orders (xyz:GOLD, ...), use factor_hl_cancel_order_offchain.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      perp: {
        type: 'number',
        description: 'Main-dex perp asset index (0=BTC, 1=ETH, ...). Use factor_hl_list_perps to look up.',
      },
      cloid: {
        type: 'string',
        description: 'Client order id from open/place — 0x + 32 hex chars (128 bits).',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp', 'cloid'],
  },
  handler: async (input: HlCancelOrderInput) => {
    const validated = hlCancelOrderSchema.parse(input);

    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vault = validated.vault as Address;
    // 0x + 32 hex chars = 128 bits — fits in uint128.
    const cloidBigInt = BigInt(validated.cloid);

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });

      const sendTx: SendTransactionParams = await hlVault.cancelOrder({
        perp: validated.perp,
        cloid: cloidBigInt,
      });

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
        value: sendTx.value,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({
          gasLimit: 0n,
          totalCostEth: '0',
        }));
        return {
          success: true,
          submitted: true,
          simulationMode: true,
          action: 'hl_cancel_order',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          cloid: validated.cloid,
          txCalldata: { to: sendTx.to, data: sendTx.data, value: sendTx.value?.toString() ?? '0' },
          transaction: { to: sendTx.to, data: sendTx.data },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);

      return {
        success: true,
        submitted: true,
        simulationMode: false,
        action: 'hl_cancel_order',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        perp: validated.perp,
        cloid: validated.cloid,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to cancel HL perp order', error);
    }
  },
};
