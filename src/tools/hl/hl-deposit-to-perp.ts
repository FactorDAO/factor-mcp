import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

export const hlDepositToPerpSchema = z.object({
  vault: z.string(),
  // Float dollars (e.g. 5.5 = $5.50). The SDK converts to 6-dec USDC internally.
  usdcAmountFloat: z.number().positive(),
  password: z.string().optional(),
});

export type HlDepositToPerpInput = z.infer<typeof hlDepositToPerpSchema>;

export const hlDepositToPerpTool = {
  name: 'factor_hl_deposit_to_perp',
  description:
    'Bridge USDC from a Factor vault on HyperEVM to its HyperLiquid perp account. Amount is in float dollars (e.g. 5.5 = $5.50). HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      usdcAmountFloat: {
        type: 'number',
        description: 'USDC amount in float dollars (e.g. 5.5 = $5.50).',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'usdcAmountFloat'],
  },
  handler: async (input: HlDepositToPerpInput) => {
    const validated = hlDepositToPerpSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      // SDK takes a decimal string (e.g. "5.50") and converts to 6-dec USDC.
      const sendTx: SendTransactionParams = hlVault.depositToPerp(
        validated.usdcAmountFloat.toString(),
      );

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
        value: sendTx.value,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams).catch(() => ({ gasLimit: 0n, totalCostEth: '0' }));
        return {
          success: true,
          simulationMode: true,
          action: 'hl_deposit_to_perp',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          usdcAmountFloat: validated.usdcAmountFloat,
          transaction: { to: sendTx.to, data: sendTx.data },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        success: true,
        simulationMode: false,
        action: 'hl_deposit_to_perp',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        usdcAmountFloat: validated.usdcAmountFloat,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to deposit USDC to HL perp account', error);
    }
  },
};
