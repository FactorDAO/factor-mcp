import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';

export const hlWithdrawToEvmSchema = z.object({
  vault: z.string(),
  usdcAmountFloat: z.number().positive(),
  password: z.string().optional(),
});

export type HlWithdrawToEvmInput = z.infer<typeof hlWithdrawToEvmSchema>;

export const hlWithdrawToEvmTool = {
  name: 'factor_hl_withdraw_to_evm',
  description:
    'Withdraw USDC from a vault\'s HyperLiquid perp account back to HyperEVM in one composite batch (perp → spot → EVM bridge). HyperEVM (chain 999) only.',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address.' },
      usdcAmountFloat: {
        type: 'number',
        description: 'USDC amount in float dollars to withdraw end-to-end.',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'usdcAmountFloat'],
  },
  handler: async (input: HlWithdrawToEvmInput) => {
    const validated = hlWithdrawToEvmSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;

    try {
      // TODO: wire to HLVault.withdrawToEvm({ usdcAmountFloat }) — composite perp→spot→EVM batch.
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
          action: 'hl_withdraw_to_evm',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          usdcAmountFloat: validated.usdcAmountFloat,
          transaction: { to: sendTx.to, data: sendTx.data },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          todo: 'wire to HLVault.withdrawToEvm — SDK HL module not yet exported',
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        success: true,
        simulationMode: false,
        action: 'hl_withdraw_to_evm',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        usdcAmountFloat: validated.usdcAmountFloat,
        transactionHash: result.hash,
        todo: 'wire to HLVault.withdrawToEvm — SDK HL module not yet exported',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to withdraw HL → EVM', error);
    }
  },
};
