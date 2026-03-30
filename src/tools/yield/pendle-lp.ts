import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const actionEnum = z.enum(['addLiquidity', 'removeLiquidity', 'collectFees']);

export const pendleLpSchema = z.object({
  vaultAddress: z.string(),
  action: actionEnum,
  marketAddress: z.string(),
  tokenAddress: z.string().optional(),
  amount: z.string().optional(),
  minLpOut: z.string().optional(),
  minTokenOut: z.string().optional(),
  approxParams: z.object({
    guessMin: z.string(),
    guessMax: z.string(),
    guessOffchain: z.string(),
    maxIteration: z.number(),
    eps: z.string(),
  }).optional(),
  password: z.string().optional(),
});

export type PendleLpInput = z.infer<typeof pendleLpSchema>;

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

export const pendleLpTool = {
  name: 'factor_pendle_lp',
  description: 'Pendle LP operations through a Factor vault. Add/remove liquidity to Pendle markets and collect fees. Available on Arbitrum and Ethereum.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      action: {
        type: 'string',
        enum: ['addLiquidity', 'removeLiquidity', 'collectFees'],
        description: 'Pendle LP action',
      },
      marketAddress: {
        type: 'string',
        description: 'The Pendle market address',
      },
      tokenAddress: {
        type: 'string',
        description: 'Token address for add/remove liquidity',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei) or "all". Required for addLiquidity and removeLiquidity.',
      },
      minLpOut: {
        type: 'string',
        description: 'Minimum LP tokens out for addLiquidity (slippage). Default: "0"',
      },
      minTokenOut: {
        type: 'string',
        description: 'Minimum tokens out for removeLiquidity (slippage). Default: "0"',
      },
      approxParams: {
        type: 'object',
        properties: {
          guessMin: { type: 'string' },
          guessMax: { type: 'string' },
          guessOffchain: { type: 'string' },
          maxIteration: { type: 'number' },
          eps: { type: 'string' },
        },
        description: 'Approximation parameters from the Pendle API. Required for addLiquidity.',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'action', 'marketAddress'],
  },
  handler: async (input: PendleLpInput) => {
    const validated = pendleLpSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) throw new VaultError('Invalid vault address');
    if (!isAddress(validated.marketAddress)) throw new VaultError('Invalid market address');

    if (validated.action !== 'collectFees' && !validated.amount) {
      throw new VaultError(`amount is required for ${validated.action}`);
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

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

      const adapter = (strategyBuilder.adapter as any).pendle;
      let block: SendTransactionParams;

      switch (validated.action) {
        case 'addLiquidity':
          block = adapter.addLiquidity({
            marketAddress: validated.marketAddress,
            tokenInAddress: validated.tokenAddress,
            amountInBN: validated.amount,
            minLpOutBN: validated.minLpOut || '0',
            approxParams: validated.approxParams,
          });
          break;
        case 'removeLiquidity':
          block = adapter.removeLiquidity({
            marketAddress: validated.marketAddress,
            tokenOutAddress: validated.tokenAddress,
            amountLpBN: validated.amount,
            minTokenOutBN: validated.minTokenOut || '0',
          });
          break;
        case 'collectFees':
          block = adapter.collectFees({
            marketAddress: validated.marketAddress,
          });
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
          action: validated.action,
          protocol: 'pendle',
          vaultAddress,
          marketAddress: validated.marketAddress,
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
        action: validated.action,
        protocol: 'pendle',
        vaultAddress,
        marketAddress: validated.marketAddress,
        transactionHash: result.hash,
        chain,
        note: `Pendle ${validated.action} transaction submitted. Use factor_get_transaction_status to monitor progress.`,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to execute Pendle LP operation', error);
    }
  },
};
