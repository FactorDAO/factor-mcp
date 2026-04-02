import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';
import { checkAdapterRegistered, AdapterNotRegisteredError } from '../../utils/adapter-check.js';

const directionEnum = z.enum(['tokenToPT', 'tokenToYT', 'ptToToken', 'ytToToken']);

export const swapPendleSchema = z.object({
  vaultAddress: z.string(),
  marketAddress: z.string(),
  direction: directionEnum,
  tokenAddress: z.string(),
  amount: z.string(),
  approxParams: z.object({
    guessMin: z.string().optional(),
    guessMax: z.string().optional(),
    guessOffchain: z.string().optional(),
    maxIteration: z.number().optional(),
    eps: z.string().optional(),
  }).optional(),
  password: z.string().optional(),
});

export type SwapPendleInput = z.infer<typeof swapPendleSchema>;

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

export const swapPendleTool = {
  name: 'factor_swap_pendle',
  description: 'Swap between tokens and Pendle Principal Tokens (PT) or Yield Tokens (YT) via a Factor vault. Directions: tokenToPT, tokenToYT, ptToToken, ytToToken. For tokenToPT and tokenToYT, "all" swaps entire vault balance.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      marketAddress: {
        type: 'string',
        description: 'The Pendle market address',
      },
      direction: {
        type: 'string',
        enum: ['tokenToPT', 'tokenToYT', 'ptToToken', 'ytToToken'],
        description: 'Swap direction: tokenToPT, tokenToYT, ptToToken, ytToToken',
      },
      tokenAddress: {
        type: 'string',
        description: 'The token address (input token for tokenToPT/tokenToYT, output token for ptToToken/ytToToken)',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei), or "all" for tokenToPT/tokenToYT to swap entire balance',
      },
      approxParams: {
        type: 'object',
        description: 'Optional approximation parameters from Pendle API for better execution',
        properties: {
          guessMin: { type: 'string' },
          guessMax: { type: 'string' },
          guessOffchain: { type: 'string' },
          maxIteration: { type: 'number' },
          eps: { type: 'string' },
        },
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'marketAddress', 'direction', 'tokenAddress', 'amount'],
  },
  handler: async (input: SwapPendleInput) => {
    const validated = swapPendleSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }
    if (!isAddress(validated.marketAddress)) {
      throw new VaultError('Invalid market address');
    }
    if (!isAddress(validated.tokenAddress)) {
      throw new VaultError('Invalid token address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();
    const isAll = validated.amount.toLowerCase() === 'all';

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

      const adapterAddress = (strategyBuilder.adapter as any).pendlePy.adapterAddress;
      await checkAdapterRegistered(vaultAddress, adapterAddress as Address, 'Pendle');

      let block: SendTransactionParams;

      const baseParams: Record<string, unknown> = {
        marketAddress: validated.marketAddress,
        tokenInAddress: validated.tokenAddress,
        tokenOutAddress: validated.tokenAddress,
      };

      if (validated.approxParams) {
        baseParams.approxParams = validated.approxParams;
      }

      switch (validated.direction) {
        case 'tokenToPT':
          block = isAll
            ? (strategyBuilder.adapter as any).pendlePy.swapExactTokenForPTAll({ ...baseParams, minAmountOutBN: '0' })
            : (strategyBuilder.adapter as any).pendlePy.swapExactTokenForPT({ ...baseParams, amountInBN: validated.amount, minAmountOutBN: '0' });
          break;
        case 'tokenToYT':
          block = isAll
            ? (strategyBuilder.adapter as any).pendlePy.swapExactTokenForYtAll({ ...baseParams, minAmountOutBN: '0' })
            : (strategyBuilder.adapter as any).pendlePy.swapExactTokenForYt({ ...baseParams, amountInBN: validated.amount, minAmountOutBN: '0' });
          break;
        case 'ptToToken':
          block = isAll
            ? (strategyBuilder.adapter as any).pendlePy.swapExactPtForTokenAll({ ...baseParams, minAmountOutBN: '0' })
            : (strategyBuilder.adapter as any).pendlePy.swapExactPTForToken({ ...baseParams, amountInBN: validated.amount, minAmountOutBN: '0' });
          break;
        case 'ytToToken':
          block = isAll
            ? (strategyBuilder.adapter as any).pendlePy.swapExactYtForTokenAll({ ...baseParams, minAmountOutBN: '0' })
            : (strategyBuilder.adapter as any).pendlePy.swapExactYtForToken({ ...baseParams, amountInBN: validated.amount, minAmountOutBN: '0' });
          break;
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
          protocol: 'pendlePy',
          direction: validated.direction,
          vaultAddress,
          marketAddress: validated.marketAddress,
          tokenAddress: validated.tokenAddress,
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
        protocol: 'pendlePy',
        direction: validated.direction,
        vaultAddress,
        marketAddress: validated.marketAddress,
        tokenAddress: validated.tokenAddress,
        amount: validated.amount,
        transactionHash: result.hash,
        chain,
        note: 'Pendle swap transaction submitted. Use factor_get_transaction_status to monitor progress.',
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
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute Pendle swap', error);
    }
  },
};
