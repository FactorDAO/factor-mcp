import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const protocolEnum = z.enum(['aave', 'compoundV3', 'morpho']);

export const lendRepaySchema = z.object({
  vaultAddress: z.string(),
  protocol: protocolEnum,
  debtAddress: z.string().optional(),
  marketAddress: z.string().optional(),
  marketId: z.string().optional(),
  amount: z.string(),
  password: z.string().optional(),
});

export type LendRepayInput = z.infer<typeof lendRepaySchema>;

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

export const lendRepayTool = {
  name: 'factor_lend_repay',
  description: 'Repay borrowed assets to a lending protocol (Aave, Compound V3, or Morpho) through a Factor vault. Use amount "all" to repay the entire debt.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      protocol: {
        type: 'string',
        enum: ['aave', 'compoundV3', 'morpho'],
        description: 'The lending protocol to repay to',
      },
      debtAddress: {
        type: 'string',
        description: 'Token address of the debt to repay (required for aave and compoundV3)',
      },
      marketAddress: {
        type: 'string',
        description: 'Compound V3 market address (required for compoundV3)',
      },
      marketId: {
        type: 'string',
        description: 'Morpho market ID (required for morpho)',
      },
      amount: {
        type: 'string',
        description: 'Amount to repay in base units (wei), or "all" to repay the entire debt, or a percentage like "50%" to repay that percentage of the debt',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'protocol', 'amount'],
  },
  handler: async (input: LendRepayInput) => {
    const validated = lendRepaySchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    if (validated.protocol === 'aave' && !validated.debtAddress) {
      throw new VaultError('debtAddress is required for Aave');
    }
    if (validated.protocol === 'compoundV3') {
      if (!validated.marketAddress) throw new VaultError('marketAddress is required for Compound V3');
      if (!validated.debtAddress) throw new VaultError('debtAddress is required for Compound V3');
    }
    if (validated.protocol === 'morpho' && !validated.marketId) {
      throw new VaultError('marketId is required for Morpho');
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

      switch (validated.protocol) {
        case 'aave':
          block = isAll
            ? (strategyBuilder.adapter as any).aave.repayAll({ debtAddress: validated.debtAddress })
            : isPercentage
            ? (strategyBuilder.adapter as any).aave.repayByPercentage({ debtAddress: validated.debtAddress, percentage })
            : (strategyBuilder.adapter as any).aave.repayBN({ debtAddress: validated.debtAddress, amountBN: validated.amount });
          break;
        case 'compoundV3':
          block = isAll
            ? (strategyBuilder.adapter as any).compoundV3.repayAll({ marketAddress: validated.marketAddress, debtAddress: validated.debtAddress })
            : isPercentage
            ? (strategyBuilder.adapter as any).compoundV3.repayByPercentage({ marketAddress: validated.marketAddress, debtAddress: validated.debtAddress, percentage })
            : (strategyBuilder.adapter as any).compoundV3.repayBN({ marketAddress: validated.marketAddress, debtAddress: validated.debtAddress, amountBN: validated.amount });
          break;
        case 'morpho':
          block = isAll
            ? (strategyBuilder.adapter as any).morpho.repayAll({ marketId: validated.marketId })
            : isPercentage
            ? (strategyBuilder.adapter as any).morpho.repayByPercentage({ marketId: validated.marketId, percentage })
            : (strategyBuilder.adapter as any).morpho.repayBN({ marketId: validated.marketId, amountBN: validated.amount });
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
          action: 'repay',
          protocol: validated.protocol,
          vaultAddress,
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
        action: 'repay',
        protocol: validated.protocol,
        vaultAddress,
        amount: validated.amount,
        transactionHash: result.hash,
        chain,
        note: 'Repay transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute lending repay', error);
    }
  },
};
