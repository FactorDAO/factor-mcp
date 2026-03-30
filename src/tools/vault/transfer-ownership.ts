import { z } from 'zod';
import { encodeFunctionData, parseAbi } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, type TransactionParams } from '../../wallet/signer.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { logger } from '../../utils/logger.js';

const OWNABLE_ABI = parseAbi([
  'function transferOwnership(address newOwner)',
]);

export const transferOwnershipTool = {
  name: 'factor_transfer_ownership',
  description: 'Transfer ownership of a Factor Pro vault to a new address. The new owner will have full control (fees, managers, risk settings, upgrades). Only callable by the current vault owner. WARNING: This is irreversible.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      newOwnerAddress: {
        type: 'string',
        description: 'The address of the new vault owner',
      },
      password: {
        type: 'string',
        description: 'Wallet password (required for encrypted wallets)',
      },
    },
    required: ['vaultAddress', 'newOwnerAddress'],
  },
  handler: async (input: Record<string, unknown>) => {
    const validated = z.object({
      vaultAddress: z.string(),
      newOwnerAddress: z.string(),
      password: z.string().optional(),
    }).parse(input);

    const walletName = configManager.getWalletName();
    if (!walletName) throw new Error('No wallet configured');

    const from = getWalletAddress(walletName);

    const data = encodeFunctionData({
      abi: OWNABLE_ABI,
      functionName: 'transferOwnership',
      args: [validated.newOwnerAddress as `0x${string}`],
    });

    const txParams: TransactionParams = {
      to: validated.vaultAddress as `0x${string}`,
      data,
    };

    logger.info(`Transferring ownership of ${validated.vaultAddress} to ${validated.newOwnerAddress}`);

    const result = await sendTransaction(txParams, validated.password);

    return {
      success: true,
      txHash: result.hash,
      from,
      vault: validated.vaultAddress,
      newOwner: validated.newOwnerAddress,
      simulationMode: result.simulationMode,
    };
  },
};
