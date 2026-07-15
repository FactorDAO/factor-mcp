import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

const dexEnum = z.enum(['xyz']);

export const hlTransferFromBuilderDexSchema = z.object({
  vault: z.string(),
  dex: dexEnum,
  usdcAmount: z.union([z.string().min(1), z.number().positive()]),
  password: z.string().optional(),
});

export type HlTransferFromBuilderDexInput = z.infer<typeof hlTransferFromBuilderDexSchema>;

export const hlTransferFromBuilderDexTool = {
  name: 'factor_hl_transfer_from_builder_dex',
  description:
    'Sweep USDC from an HIP-3 builder-dex ledger (e.g. xyz) back to the vault\'s main HL perp ledger. Inverse of factor_hl_transfer_to_builder_dex. HyperEVM (chain 999) only. Returns an on-chain executeByManager envelope (CoreWriter action 13).',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      dex: {
        type: 'string',
        enum: ['xyz'],
        description: 'Source builder dex. Currently only "xyz" is supported.',
      },
      usdcAmount: {
        type: ['string', 'number'],
        description: 'USDC amount to transfer back in float dollars (e.g. "1.50" or 1.5).',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'dex', 'usdcAmount'],
  },
  handler: async (input: HlTransferFromBuilderDexInput) => {
    const validated = hlTransferFromBuilderDexSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const stateless = configManager.isStateless();
    if (!stateless) {
      const walletName = configManager.getWalletName();
      if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vault = validated.vault as Address;
    const usdcAmount =
      typeof validated.usdcAmount === 'number'
        ? validated.usdcAmount.toString()
        : validated.usdcAmount;

    try {
      const hlVault = buildHlVault(vault, {
        password: validated.password,
        requireSigner: !stateless,
      });
      const sendTx: SendTransactionParams = hlVault.transferFromBuilderDex({
        dex: validated.dex,
        usdcAmount,
      });

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
          action: 'hl_transfer_from_builder_dex',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          dex: validated.dex,
          usdcAmount,
          transaction: { to: sendTx.to, data: sendTx.data, value: sendTx.value != null ? sendTx.value.toString() : "0", chainId: HYPEREVM_CHAIN_ID },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: stateless ? 'Stateless mode — returning calldata for agent-executor sign_and_send.' : 'Simulation mode - transaction was not broadcast.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);
      return {
        success: true,
        simulationMode: false,
        action: 'hl_transfer_from_builder_dex',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        dex: validated.dex,
        usdcAmount,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to transfer USDC from HL builder dex', error);
    }
  },
};
