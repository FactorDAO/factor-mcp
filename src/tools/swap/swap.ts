import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, TransactionError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

export const swapSchema = z.object({
  vaultAddress: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  fee: z.string().optional(),
  amount: z.string(),
  slippage: z.number().optional(),
  password: z.string().optional(),
});

export type SwapInput = z.infer<typeof swapSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const swapTool = {
  name: 'factor_swap',
  description: 'Swap tokens through Uniswap V3 via a Factor vault. Supports "all" to swap entire balance, percentage amounts like "50%", or exact amounts in base units (wei). Fee tiers: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%).',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      tokenIn: {
        type: 'string',
        description: 'Address of the input token to swap from',
      },
      tokenOut: {
        type: 'string',
        description: 'Address of the output token to swap to',
      },
      fee: {
        type: 'string',
        enum: ['100', '500', '3000', '10000'],
        description: 'Uniswap V3 fee tier: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%). Default: 3000',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei), or "all" to swap entire vault balance, or "50%" for percentage',
      },
      slippage: {
        type: 'number',
        description: 'Slippage tolerance as a percentage (e.g., 0.5 for 0.5%). Default: 1',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'tokenIn', 'tokenOut', 'amount'],
  },
  handler: async (input: SwapInput) => {
    const validated = swapSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }
    if (!isAddress(validated.tokenIn)) {
      throw new VaultError('Invalid tokenIn address');
    }
    if (!isAddress(validated.tokenOut)) {
      throw new VaultError('Invalid tokenOut address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();
    const fee = parseInt(validated.fee || '3000');
    const slippage = validated.slippage || 1;
    const isAll = validated.amount.toLowerCase() === 'all';
    const percentageMatch = validated.amount.match(/^(\d+(?:\.\d+)?)%$/);
    const isPercentage = !!percentageMatch;
    const percentage = isPercentage ? parseFloat(percentageMatch![1]) : 0;

    if (isPercentage && (percentage <= 0 || percentage > 100)) {
      throw new VaultError('Percentage must be between 0 and 100');
    }

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment,
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const strategyBuilder = new StrategyBuilder({
        chainId,
        isProAdapter: true,
        environment,
      });

      let block: SendTransactionParams;

      const swapParams = {
        tokenInAddress: validated.tokenIn,
        tokenOutAddress: validated.tokenOut,
        fee,
      };

      if (isAll) {
        block = (strategyBuilder.adapter as any).uniswap.exactInputSingleAll(swapParams);
      } else if (isPercentage) {
        block = (strategyBuilder.adapter as any).uniswap.exactInputSingleByPercentage({ ...swapParams, percentage });
      } else {
        block = (strategyBuilder.adapter as any).uniswap.exactInputSingleBN({ ...swapParams, amountInBN: validated.amount });
      }

      const executeData = proVault.executeByManager([block]);

      const txParams: TransactionParams = {
        to: executeData.to as Address,
        data: executeData.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams);

        return {
          success: true,
          simulationMode: true,
          action: 'swap',
          protocol: 'uniswap',
          vaultAddress,
          tokenIn: validated.tokenIn,
          tokenOut: validated.tokenOut,
          fee,
          amount: validated.amount,
          transaction: {
            to: executeData.to,
            data: executeData.data,
          },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast. Set SIMULATION_MODE=false to execute.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);

      return {
        success: true,
        simulationMode: false,
        action: 'swap',
        protocol: 'uniswap',
        vaultAddress,
        tokenIn: validated.tokenIn,
        tokenOut: validated.tokenOut,
        fee,
        amount: validated.amount,
        transactionHash: result.hash,
        chain,
        note: 'Swap transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError || error instanceof TransactionError) {
        throw error;
      }
      throw new SdkError('Failed to execute swap', error);
    }
  },
};
