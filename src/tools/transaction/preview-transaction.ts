import { z } from 'zod';
import { isAddress, isHex, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { TransactionError, WalletError } from '../../utils/errors.js';

export const previewTransactionSchema = z.object({
  to: z.string(),
  data: z.string().optional(),
  value: z.string().optional(),
});

export type PreviewTransactionInput = z.infer<typeof previewTransactionSchema>;

export const previewTransactionTool = {
  name: 'factor_preview_transaction',
  description: 'Preview a transaction with gas estimates before execution. This is a read-only operation.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'The recipient address',
      },
      data: {
        type: 'string',
        description: 'The transaction calldata (hex string)',
      },
      value: {
        type: 'string',
        description: 'The value to send in wei (optional)',
      },
    },
    required: ['to'],
  },
  handler: async (input: PreviewTransactionInput) => {
    const validated = previewTransactionSchema.parse(input);

    if (!isAddress(validated.to)) {
      throw new TransactionError('Invalid recipient address');
    }

    if (validated.data && !isHex(validated.data)) {
      throw new TransactionError('Invalid calldata - must be a hex string');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const from = getWalletAddress(walletName);

    let value: bigint | undefined;
    if (validated.value) {
      try {
        value = BigInt(validated.value);
      } catch {
        throw new TransactionError('Invalid value - must be an integer string');
      }
    }

    const txParams: TransactionParams = {
      to: validated.to as Address,
      data: validated.data as `0x${string}` | undefined,
      value,
    };

    const gasEstimate = await estimateGas(txParams);

    return {
      preview: {
        from,
        to: validated.to,
        data: validated.data || '0x',
        value: (value || 0n).toString(),
      },
      gasEstimate: {
        gasLimit: gasEstimate.gasLimit.toString(),
        maxFeePerGas: gasEstimate.maxFeePerGas.toString(),
        maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas.toString(),
        totalCostWei: gasEstimate.totalCostWei.toString(),
        totalCostEth: gasEstimate.totalCostEth,
      },
      chain: configManager.getConfig().chain,
      chainId: configManager.getChainId(),
      simulationMode: configManager.isSimulationMode(),
    };
  },
};
