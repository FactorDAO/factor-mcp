import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';

export const hlClosePositionSchema = z.object({
  vault: z.string(),
  perp: z.string().min(1),
  sizeUsd: z.number().positive(),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
  password: z.string().optional(),
});

export type HlClosePositionInput = z.infer<typeof hlClosePositionSchema>;

export const hlClosePositionTool = {
  name: 'factor_hl_close_position',
  description:
    'Reduce / close a HyperLiquid perp position (reduce-only order) sized in USD through a Factor vault. HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      perp: { type: 'string', description: 'Perp symbol, e.g. "ETH".' },
      sizeUsd: { type: 'number', description: 'Notional USD to close (reduce-only).' },
      slippageBps: { type: 'number', description: 'Max slippage in bps. Default 1000.' },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'perp', 'sizeUsd'],
  },
  handler: async (input: HlClosePositionInput) => {
    const validated = hlClosePositionSchema.parse(input);

    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;
    const slippageBps = validated.slippageBps ?? 1000;

    try {
      // TODO: wire to HLVault.closePosition({ perp, sizeUsd, slippageBps, reduceOnly: true })
      const sendTx: SendTransactionParams = {
        to: vault,
        data: '0x' as `0x${string}`,
      };

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({ gasLimit: 0n, totalCostEth: '0' }));
        return {
          success: true,
          simulationMode: true,
          action: 'hl_close_position',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          perp: validated.perp,
          sizeUsd: validated.sizeUsd,
          slippageBps,
          transaction: { to: sendTx.to, data: sendTx.data },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          todo: 'wire to HLVault.closePosition — SDK HL module not yet exported',
          note: 'Simulation mode - transaction was not broadcast.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        success: true,
        simulationMode: false,
        action: 'hl_close_position',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        perp: validated.perp,
        sizeUsd: validated.sizeUsd,
        slippageBps,
        transactionHash: result.hash,
        todo: 'wire to HLVault.closePosition — SDK HL module not yet exported',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to close HL perp position', error);
    }
  },
};
