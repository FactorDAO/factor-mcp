import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, TransactionError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';
import { checkAdapterRegistered, AdapterNotRegisteredError } from '../../utils/adapter-check.js';

export const swapExactOutputSchema = z.object({
  vaultAddress: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  fee: z.string().optional(),
  amountOut: z.string(),
  amountInMax: z.string().optional(),
  password: z.string().optional(),
});

export type SwapExactOutputInput = z.infer<typeof swapExactOutputSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    case 'ROBINHOOD':
      return 4663 as ChainId;
    case 'GNOSIS':
      return 100 as ChainId;
    case 'GNOSIS': return 100 as ChainId;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const swapExactOutputTool = {
  name: 'factor_swap_uniswap_exact_output',
  description: 'Swap tokens through Uniswap V3 via a Factor vault, specifying the exact output amount desired. Use amountInMax to set the maximum input you are willing to spend, or use "all" to allow spending the entire vault balance of tokenIn. Fee tiers: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%).',
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
        description: 'Address of the output token to receive',
      },
      fee: {
        type: 'string',
        enum: ['100', '500', '3000', '10000'],
        description: 'Uniswap V3 fee tier: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%). Default: 3000',
      },
      amountOut: {
        type: 'string',
        description: 'Exact amount of output token desired in base units (wei)',
      },
      amountInMax: {
        type: 'string',
        description: 'Maximum amount of input token to spend in base units (wei), or "all" to use entire vault balance as maximum. If not provided when not using "all", defaults to "all".',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'tokenIn', 'tokenOut', 'amountOut'],
  },
  handler: async (input: SwapExactOutputInput) => {
    const validated = swapExactOutputSchema.parse(input);

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
    const amountInMax = validated.amountInMax?.toLowerCase() || 'all';
    const isAll = amountInMax === 'all' || !validated.amountInMax;

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

      const adapterAddress = (strategyBuilder.adapter as any).uniswap.adapterAddress;
      await checkAdapterRegistered(vaultAddress, adapterAddress as Address, 'Uniswap');

      let block: SendTransactionParams;

      const baseParams = {
        tokenInAddress: validated.tokenIn,
        tokenOutAddress: validated.tokenOut,
        amountOutBN: validated.amountOut,
        fee,
      };

      if (isAll) {
        block = (strategyBuilder.adapter as any).uniswap.exactOutputSingleAll(baseParams);
      } else {
        block = (strategyBuilder.adapter as any).uniswap.exactOutputSingleBN({
          ...baseParams,
          amountInMaxBN: amountInMax,
        });
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
          action: 'swap_exact_output',
          protocol: 'uniswap',
          vaultAddress,
          tokenIn: validated.tokenIn,
          tokenOut: validated.tokenOut,
          fee,
          amountOut: validated.amountOut,
          amountInMax: isAll ? 'all' : amountInMax,
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
        action: 'swap_exact_output',
        protocol: 'uniswap',
        vaultAddress,
        tokenIn: validated.tokenIn,
        tokenOut: validated.tokenOut,
        fee,
        amountOut: validated.amountOut,
        amountInMax: isAll ? 'all' : amountInMax,
        transactionHash: result.hash,
        chain,
        note: 'Exact output swap transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof AdapterNotRegisteredError) {
        return {
          success: false,
          error: 'ADAPTER_NOT_REGISTERED',
          message: error.message,
          adapterAddress: error.adapterAddress,
          adapterName: error.adapterName,
          fix: `Call factor_add_adapter with vaultAddress "${vaultAddress}" and adapterAddress "${error.adapterAddress}", then sign_and_send. After that, retry this swap.`,
        };
      }
      if (error instanceof VaultError || error instanceof WalletError || error instanceof TransactionError) {
        throw error;
      }
      throw new SdkError('Failed to execute exact output swap', error);
    }
  },
};
