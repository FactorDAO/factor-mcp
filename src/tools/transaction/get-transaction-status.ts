import { z } from 'zod';
import { isHex, type Hash } from 'viem';
import { configManager } from '../../config/index.js';
import { getTransactionStatus } from '../../wallet/signer.js';
import { TransactionError } from '../../utils/errors.js';

export const getTransactionStatusSchema = z.object({
  hash: z.string(),
});

export type GetTransactionStatusInput = z.infer<typeof getTransactionStatusSchema>;

export const getTransactionStatusTool = {
  name: 'factor_get_transaction_status',
  description: 'Check the status of a transaction by its hash. Returns pending, success, or failed status along with block and gas information.',
  inputSchema: {
    type: 'object',
    properties: {
      hash: {
        type: 'string',
        description: 'The transaction hash (66 character hex string starting with 0x)',
      },
    },
    required: ['hash'],
  },
  handler: async (input: GetTransactionStatusInput) => {
    const validated = getTransactionStatusSchema.parse(input);

    if (!isHex(validated.hash) || validated.hash.length !== 66) {
      throw new TransactionError('Invalid transaction hash - must be a 66 character hex string');
    }

    const status = await getTransactionStatus(validated.hash as Hash);

    return {
      hash: validated.hash,
      status: status.status,
      confirmed: status.status !== 'pending',
      ...(status.blockNumber && { blockNumber: status.blockNumber.toString() }),
      ...(status.gasUsed && { gasUsed: status.gasUsed.toString() }),
      ...(status.effectiveGasPrice && {
        effectiveGasPrice: status.effectiveGasPrice.toString(),
      }),
      chain: configManager.getConfig().chain,
      chainId: configManager.getChainId(),
    };
  },
};
