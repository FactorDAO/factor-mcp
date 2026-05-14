import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import type { SendTransactionParams } from '@factordao/sdk';
import { HYPEREVM_CHAIN_ID, assertHyperEvmChain } from './common.js';
import { buildHlVault } from './hl-vault-factory.js';

/// Builder dexes supported today. Only `xyz` is live on HL mainnet; this
/// schema gates on that explicitly to fail fast if a typo'd dex name slips
/// in. Widen when HL adds more HIP-3 dexes.
const dexEnum = z.enum(['xyz']);

export const hlTransferToBuilderDexSchema = z.object({
  vault: z.string(),
  dex: dexEnum,
  // Decimal string in USD (e.g. "1.50"). We accept either a number or a
  // string for ergonomics; the SDK requires a decimal string internally.
  usdcAmount: z.union([z.string().min(1), z.number().positive()]),
  password: z.string().optional(),
});

export type HlTransferToBuilderDexInput = z.infer<typeof hlTransferToBuilderDexSchema>;

export const hlTransferToBuilderDexTool = {
  name: 'factor_hl_transfer_to_builder_dex',
  description:
    'Move USDC from a Factor vault\'s main HL perp ledger to an HIP-3 builder-dex ledger (e.g. xyz). Required before trading xyz:GOLD / xyz:BRENTOIL / xyz:COPPER / ... HyperEVM (chain 999) only. Returns an on-chain executeByManager envelope (CoreWriter action 13).',
  inputSchema: {
    type: 'object',
    properties: {
      vault: { type: 'string', description: 'Vault contract address (HyperEVM).' },
      dex: {
        type: 'string',
        enum: ['xyz'],
        description: 'Destination builder dex. Currently only "xyz" is supported.',
      },
      usdcAmount: {
        type: ['string', 'number'],
        description: 'USDC amount to transfer in float dollars (e.g. "1.50" or 1.5).',
      },
      password: { type: 'string', description: 'Wallet password if encrypted.' },
    },
    required: ['vault', 'dex', 'usdcAmount'],
  },
  handler: async (input: HlTransferToBuilderDexInput) => {
    const validated = hlTransferToBuilderDexSchema.parse(input);
    if (!isAddress(validated.vault)) throw new VaultError('Invalid vault address');
    assertHyperEvmChain();

    const walletName = configManager.getWalletName();
    if (!walletName) throw new WalletError('No wallet configured. Use factor_wallet_setup first.');

    const vault = validated.vault as Address;
    const usdcAmount =
      typeof validated.usdcAmount === 'number'
        ? validated.usdcAmount.toString()
        : validated.usdcAmount;

    try {
      const hlVault = buildHlVault(vault, { password: validated.password });
      const sendTx: SendTransactionParams = hlVault.transferToBuilderDex({
        dex: validated.dex,
        usdcAmount,
      });

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
          action: 'hl_transfer_to_builder_dex',
          chainId: HYPEREVM_CHAIN_ID,
          vault,
          dex: validated.dex,
          usdcAmount,
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
        simulationMode: false,
        action: 'hl_transfer_to_builder_dex',
        chainId: HYPEREVM_CHAIN_ID,
        vault,
        dex: validated.dex,
        usdcAmount,
        transactionHash: result.hash,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to transfer USDC to HL builder dex', error);
    }
  },
};
