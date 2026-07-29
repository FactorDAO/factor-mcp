import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const loanSchema = z.object({
  tokenAddress: z.string(),
  amount: z.string(),
});

const strategyStepSchema = z.object({
  adapter: z.string(),
  action: z.string(),
  params: z.record(z.unknown()),
});

export const flashloanSchema = z.object({
  vaultAddress: z.string(),
  provider: z.enum(['balancer']),
  loans: z.array(loanSchema).min(1),
  strategySteps: z.array(strategyStepSchema).min(1),
  password: z.string().optional(),
});

export type FlashloanInput = z.infer<typeof flashloanSchema>;

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
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const flashloanTool = {
  name: 'factor_flashloan',
  description: 'Execute a flash loan strategy through a Factor vault. Borrows tokens within a single transaction, executes strategy steps, then repays. Uses Balancer flash loan provider (deployed on Arbitrum, Base, and Ethereum). The strategy steps define what to do with the borrowed funds (e.g., swap, supply collateral, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      provider: {
        type: 'string',
        enum: ['balancer'],
        description: 'Flash loan provider: balancer',
      },
      loans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tokenAddress: {
              type: 'string',
              description: 'Address of the token to borrow',
            },
            amount: {
              type: 'string',
              description: 'Amount to borrow in base units (wei)',
            },
          },
          required: ['tokenAddress', 'amount'],
        },
        description: 'Array of tokens and amounts to flash borrow',
      },
      strategySteps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            adapter: {
              type: 'string',
              description: 'The adapter ID (e.g., "aave", "uniswap", "morpho")',
            },
            action: {
              type: 'string',
              description: 'The action method name (e.g., "supplyAll", "exactInputSingleAll")',
            },
            params: {
              type: 'object',
              description: 'Parameters for the action',
            },
          },
          required: ['adapter', 'action', 'params'],
        },
        description: 'Strategy steps to execute with the borrowed funds. These run inside the flash loan callback.',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'provider', 'loans', 'strategySteps'],
  },
  handler: async (input: FlashloanInput) => {
    const validated = flashloanSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) throw new VaultError('Invalid vault address');

    for (const loan of validated.loans) {
      if (!isAddress(loan.tokenAddress)) {
        throw new VaultError(`Invalid loan token address: ${loan.tokenAddress}`);
      }
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

      // Build the inner strategy steps (what happens during the flash loan)
      const innerBlocks: SendTransactionParams[] = [];

      for (const step of validated.strategySteps) {
        const adapter = (strategyBuilder.adapter as any)[step.adapter];
        if (!adapter) {
          throw new VaultError(`Unknown adapter: ${step.adapter}`);
        }

        const actionFn = adapter[step.action];
        if (!actionFn) {
          throw new VaultError(`Unknown action "${step.action}" on adapter "${step.adapter}"`);
        }

        const block = actionFn.call(adapter, step.params);
        innerBlocks.push(block);
      }

      // Build flash loan wrapper
      const flAdapter = (strategyBuilder.adapter as any).balancerFL;

      if (!flAdapter) {
        throw new VaultError('Flash loan adapter "balancerFL" not available');
      }

      // Get the inner strategy blocks as transaction data for the flash loan callback
      const innerBlocksData = strategyBuilder.getTransactions();

      const flBlock: SendTransactionParams = flAdapter.executeFL({
        tokens: validated.loans.map(l => l.tokenAddress),
        amounts: validated.loans.map(l => l.amount),
        innerBlocks: innerBlocksData,
      });

      const executeData = proVault.executeByManager([flBlock]);

      const txParams: TransactionParams = {
        to: executeData.to as Address,
        data: executeData.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams);

        return {
          success: true,
          simulationMode: true,
          action: 'flashloan',
          provider: validated.provider,
          vaultAddress,
          loans: validated.loans,
          strategySteps: validated.strategySteps.length,
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
        action: 'flashloan',
        provider: validated.provider,
        vaultAddress,
        loans: validated.loans,
        strategySteps: validated.strategySteps.length,
        transactionHash: result.hash,
        chain,
        note: 'Flash loan transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to execute flash loan strategy', error);
    }
  },
};
