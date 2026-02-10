import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError, InsufficientBalanceError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';
import { generateExecuteManagerScript } from '../../templates/index.js';
import { saveForgeScript } from '../foundry/run-forge-script.js';

const strategyStepSchema = z.object({
  protocol: z.string(),
  action: z.string(),
  params: z.record(z.unknown()),
});

export const executeManagerSchema = z.object({
  vaultAddress: z.string(),
  steps: z.array(strategyStepSchema).min(1),
  password: z.string().optional(),
});

export type ExecuteManagerInput = z.infer<typeof executeManagerSchema>;

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

export const executeManagerTool = {
  name: 'factor_execute_manager',
  description: 'Execute a strategy on a vault as a manager. This allows swapping, lending, borrowing and other DeFi operations within the vault.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            protocol: {
              type: 'string',
              description: 'The protocol adapter (e.g., uniswap, aave, morpho)',
            },
            action: {
              type: 'string',
              description: 'The action to perform (e.g., exactInputSingleAll, deposit, borrow)',
            },
            params: {
              type: 'object',
              description: 'Parameters for the action',
            },
          },
          required: ['protocol', 'action', 'params'],
        },
        description: 'Array of strategy steps to execute',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'steps'],
  },
  handler: async (input: ExecuteManagerInput) => {
    const validated = executeManagerSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
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
      // Initialize SDK classes
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

      // Build strategy steps using StrategyBuilder
      const blocks: SendTransactionParams[] = [];

      for (const step of validated.steps) {
        const adapter = (strategyBuilder.adapter as any)[step.protocol];
        if (!adapter) {
          throw new VaultError(`Unknown protocol adapter: ${step.protocol}`);
        }

        const actionFn = adapter[step.action];
        if (!actionFn) {
          throw new VaultError(`Unknown action "${step.action}" for protocol "${step.protocol}"`);
        }

        const block = actionFn.call(adapter, step.params);
        blocks.push(block);
      }

      // Build the executeByManager transaction
      const executeData = proVault.executeByManager(blocks);

      const txParams: TransactionParams = {
        to: executeData.to as Address,
        data: executeData.data as `0x${string}`,
      };

      // Build a description of the steps for the forge script
      const stepsDescription = validated.steps
        .map((s) => `${s.protocol}.${s.action}`)
        .join(' → ');

      if (configManager.isSimulationMode()) {
        try {
          const gasEstimate = await estimateGas(txParams);

          return {
            success: true,
            simulationMode: true,
            vaultAddress,
            steps: validated.steps,
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
        } catch (error) {
          // If gas estimation fails (e.g. insufficient balance), include a forge script
          const forgeScript = generateExecuteManagerScript({
            vaultAddress: validated.vaultAddress,
            calldata: txParams.data as string,
            description: stepsDescription,
          });
          const scriptRef = saveForgeScript(forgeScript, 'execute');

          if (error instanceof InsufficientBalanceError) {
            return {
              success: false,
              error: 'INSUFFICIENT_BALANCE',
              message: `Insufficient balance to estimate gas. Call factor_run_forge_script with the scriptRef below to simulate the strategy.`,
              vaultAddress,
              steps: validated.steps,
              simulationHint: {
                tool: 'factor_run_forge_script',
                params: { scriptRef },
              },
              note: 'Call factor_run_forge_script with the scriptRef above to simulate the strategy on a forked network.',
            };
          }
          throw error;
        }
      }

      const result = await sendTransaction(txParams, validated.password);

      return {
        success: true,
        simulationMode: false,
        vaultAddress,
        steps: validated.steps,
        transactionHash: result.hash,
        chain,
        note: 'Strategy execution submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute manager strategy', error);
    }
  },
};
