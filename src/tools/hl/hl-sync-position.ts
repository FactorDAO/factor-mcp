import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

/**
 * Reconciliation — `factor_hl_sync_position`
 *
 * Wraps `HyperLiquidPerpAdapter.syncPosition(uint32 perp)`. The adapter
 * reads the LIVE HyperLiquid position via the L1-read precompile and
 * adds / removes the perp index from the vault's on-chain
 * `activePerpIndices` mapping to match HL truth.
 *
 * **Permissionless on-chain**: any caller can submit this — the signer
 * does NOT need to be the vault manager. The MCP tool still requires a
 * wallet because it broadcasts an EVM transaction.
 *
 * **Cannot move funds**: this method only mutates the adapter's internal
 * `activePerpIndices` registry. USDC stays in the vault / perp account.
 * Use this after an HL settlement to converge stored state with reality.
 */
export const hlSyncPositionSchema = z.object({
  vault: z.string(),
  perp: z.union([
    z.string().describe('Symbol like "BTC", "ETH"'),
    z.number().int().min(0).describe('Numeric perp index'),
  ]),
  password: z.string().optional(),
});

export type HlSyncPositionInput = z.infer<typeof hlSyncPositionSchema>;

export const hlSyncPositionTool = {
  name: 'factor_hl_sync_position',
  description:
    'Reconcile a vault\'s on-chain activePerpIndices for a single perp against the live HyperLiquid position (read via precompile). Permissionless: the signer does NOT need to be the vault manager. Cannot move funds — only mutates the adapter\'s internal registry. Use after settlement to converge stored state with HL truth. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      perp: {
        // JSON Schema doesn't support union types directly; mirror the zod schema
        // by accepting either a symbol string or a numeric index.
        type: ['string', 'number'],
        description: 'Perp symbol like "BTC", "ETH" — or the numeric HL perp index.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp'],
  },
  handler: async (input: HlSyncPositionInput) => {
    const validated = hlSyncPositionSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      const sendTx: SendTransactionParams = await hlVault.syncPosition(validated.perp);

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
          action: 'hl_sync_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          txCalldata: { to: sendTx.to, data: sendTx.data, value: sendTx.value?.toString() ?? '0' },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        submitted: true,
        success: true,
        simulationMode: false,
        action: 'hl_sync_position',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        perp: validated.perp,
        txCalldata: { to: sendTx.to, data: sendTx.data, value: sendTx.value?.toString() ?? '0' },
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to sync HL perp position', error);
    }
  },
};
