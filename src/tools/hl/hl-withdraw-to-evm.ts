import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

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

    const stateless = configManager.isStateless();
    if (!stateless) {
      const walletName = configManager.getWalletName();
      if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vault = validated.vault as Address;

    try {
      const hlVault = buildHlVault(vault, {
        password: validated.password,
        requireSigner: !stateless,
      });
      const sendTx: SendTransactionParams = hlVault.withdrawToEvm(
        validated.usdcAmountFloat.toString(),
      );

      const txParams: TransactionParams = {
        to: sendTx.to as Address,
        data: sendTx.data as `0x${string}`,
        value: sendTx.value,
      };

      if (stateless || configManager.isSimulationMode()) {
        const gasEstimate = stateless
          ? { gasLimit: 0n, totalCostEth: '0' }
          : await estimateGas(txParams).catch(() => ({ gasLimit: 0n, totalCostEth: '0' }));
        return {
          success: true,
          simulationMode: !stateless,
          action: 'hl_withdraw_to_evm',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          usdcAmountFloat: validated.usdcAmountFloat,
          transaction: { to: sendTx.to, data: sendTx.data, value: sendTx.value, chainId: HYPEREVM_CHAIN_ID },
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
        action: 'hl_withdraw_to_evm',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        usdcAmountFloat: validated.usdcAmountFloat,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to withdraw HL → EVM', error);
    }
  },
};
