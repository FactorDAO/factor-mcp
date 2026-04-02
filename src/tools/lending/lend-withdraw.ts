import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';
import { checkAdapterRegistered, AdapterNotRegisteredError } from '../../utils/adapter-check.js';

const protocolEnum = z.enum(['aave', 'compoundV3', 'morpho', 'siloV2']);

export const lendWithdrawSchema = z.object({
  vaultAddress: z.string(),
  protocol: protocolEnum,
  assetAddress: z.string().optional(),
  marketAddress: z.string().optional(),
  marketId: z.string().optional(),
  collateral: z.boolean().optional(),
  amount: z.string(),
  password: z.string().optional(),
});

export type LendWithdrawInput = z.infer<typeof lendWithdrawSchema>;

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

export const lendWithdrawTool = {
  name: 'factor_lend_withdraw',
  description: 'Withdraw supplied assets from a lending protocol (Aave, Compound V3, Morpho, or Silo V2) through a Factor vault. Use amount "all" to withdraw the entire supplied balance. For Morpho, set collateral=true to withdraw collateral.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      protocol: {
        type: 'string',
        enum: ['aave', 'compoundV3', 'morpho', 'siloV2'],
        description: 'The lending protocol to withdraw from',
      },
      assetAddress: {
        type: 'string',
        description: 'Token address to withdraw (required for aave, compoundV3, siloV2)',
      },
      marketAddress: {
        type: 'string',
        description: 'Compound V3 market address (required for compoundV3)',
      },
      marketId: {
        type: 'string',
        description: 'Morpho market ID (required for morpho)',
      },
      collateral: {
        type: 'boolean',
        description: 'For Morpho: withdraw collateral instead of supplied assets. Default: false',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei), or "all" to withdraw the entire supplied balance, or a percentage like "50%" to withdraw that percentage of the supplied balance',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'protocol', 'amount'],
  },
  handler: async (input: LendWithdrawInput) => {
    const validated = lendWithdrawSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    if (validated.protocol === 'aave' && !validated.assetAddress) {
      throw new VaultError('assetAddress is required for Aave');
    }
    if (validated.protocol === 'compoundV3') {
      if (!validated.marketAddress) throw new VaultError('marketAddress is required for Compound V3');
      if (!validated.assetAddress) throw new VaultError('assetAddress is required for Compound V3');
    }
    if (validated.protocol === 'morpho' && !validated.marketId) {
      throw new VaultError('marketId is required for Morpho');
    }
    if (validated.protocol === 'siloV2') {
      if (!validated.assetAddress) throw new VaultError('assetAddress is required for Silo V2');
      if (!validated.marketAddress) throw new VaultError('marketAddress is required for Silo V2');
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

      const adapter = (strategyBuilder.adapter as any)[validated.protocol];
      await checkAdapterRegistered(vaultAddress, adapter.adapterAddress as Address, validated.protocol);

      let block: SendTransactionParams;

      switch (validated.protocol) {
        case 'aave':
          block = isAll
            ? (strategyBuilder.adapter as any).aave.withdrawAll({ assetAddress: validated.assetAddress })
            : isPercentage
            ? (strategyBuilder.adapter as any).aave.withdrawByPercentage({ assetAddress: validated.assetAddress, percentage })
            : (strategyBuilder.adapter as any).aave.withdrawBN({ assetAddress: validated.assetAddress, amountBN: validated.amount });
          break;
        case 'compoundV3':
          block = isAll
            ? (strategyBuilder.adapter as any).compoundV3.withdrawAll({ marketAddress: validated.marketAddress, assetAddress: validated.assetAddress })
            : isPercentage
            ? (strategyBuilder.adapter as any).compoundV3.withdrawByPercentage({ marketAddress: validated.marketAddress, assetAddress: validated.assetAddress, percentage })
            : (strategyBuilder.adapter as any).compoundV3.withdrawBN({ marketAddress: validated.marketAddress, assetAddress: validated.assetAddress, amountBN: validated.amount });
          break;
        case 'morpho':
          if (validated.collateral) {
            block = isAll
              ? (strategyBuilder.adapter as any).morpho.withdrawCollateral({ marketId: validated.marketId })
              : (strategyBuilder.adapter as any).morpho.withdrawCollateralBN({ marketId: validated.marketId, amountBN: validated.amount });
          } else {
            block = isAll
              ? (strategyBuilder.adapter as any).morpho.withdrawAll({ marketId: validated.marketId })
              : isPercentage
              ? (strategyBuilder.adapter as any).morpho.withdrawByPercentage({ marketId: validated.marketId, percentage })
              : (strategyBuilder.adapter as any).morpho.withdrawBN({ marketId: validated.marketId, amountBN: validated.amount });
          }
          break;
        case 'siloV2':
          block = isAll
            ? (strategyBuilder.adapter as any).siloV2.withdrawAll({ marketAddress: validated.marketAddress, assetAddress: validated.assetAddress })
            : (strategyBuilder.adapter as any).siloV2.withdrawBN({ marketAddress: validated.marketAddress, assetAddress: validated.assetAddress, amountBN: validated.amount });
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
          action: 'withdraw',
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
        action: 'withdraw',
        protocol: validated.protocol,
        vaultAddress,
        amount: validated.amount,
        transactionHash: result.hash,
        chain,
        note: 'Withdraw transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof AdapterNotRegisteredError) {
        return {
          success: false,
          error: 'ADAPTER_NOT_REGISTERED',
          message: error.message,
          adapterAddress: error.adapterAddress,
          adapterName: error.adapterName,
          fix: `Call factor_add_adapter with vaultAddress "${vaultAddress}" and adapterAddress "${error.adapterAddress}", then sign_and_send. After that, retry this withdraw.`,
        };
      }
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute lending withdraw', error);
    }
  },
};
