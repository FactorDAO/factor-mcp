import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getVaultInfo } from '../../sdk/client.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';

export const executeStrategySchema = z.object({
  strategyId: z.string(),
  password: z.string().optional(),
});

export type ExecuteStrategyInput = z.infer<typeof executeStrategySchema>;

export const executeStrategyTool = {
  name: 'factor_execute_strategy',
  description: 'Execute a built strategy on-chain. The strategy must have been built with factor_build_strategy first. Requires a configured wallet.',
  inputSchema: {
    type: 'object',
    properties: {
      strategyId: {
        type: 'string',
        description: 'The strategy ID returned from factor_build_strategy',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['strategyId'],
  },
  handler: async (input: ExecuteStrategyInput) => {
    const validated = executeStrategySchema.parse(input);

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    // Retrieve stored strategy
    // @ts-ignore
    const strategies = global.__factorStrategies || {};
    // @ts-ignore
    const strategy = strategies[validated.strategyId];

    if (!strategy) {
      throw new SdkError(
        `Strategy not found: ${validated.strategyId}. Build a strategy first with factor_build_strategy.`
      );
    }

    const vaultAddress = strategy.vault as Address;
    const vaultInfo = await getVaultInfo(vaultAddress);
    const userAddress = getWalletAddress(walletName) as Address;

    // Verify user is vault owner (for strategy execution)
    if (vaultInfo.owner.toLowerCase() !== userAddress.toLowerCase()) {
      throw new VaultError(
        `Only the vault owner can execute strategies. Owner: ${vaultInfo.owner}, Your address: ${userAddress}`
      );
    }

    // Build the strategy execution transaction
    // In production, this would encode the actual strategy calldata
    const txParams: TransactionParams = {
      to: vaultAddress,
      data: strategy.encodedCalldata as `0x${string}`,
    };

    if (configManager.isSimulationMode()) {
      const gasEstimate = await estimateGas(txParams);

      return {
        success: true,
        simulationMode: true,
        strategy: {
          id: validated.strategyId,
          name: strategy.name || 'Unnamed Strategy',
          vault: {
            address: vaultAddress,
            name: vaultInfo.name,
          },
          stepCount: strategy.steps.length,
        },
        executor: userAddress,
        gasEstimate: {
          gasLimit: gasEstimate.gasLimit.toString(),
          totalCostEth: gasEstimate.totalCostEth,
        },
        note: 'Simulation mode - strategy was not executed. Set SIMULATION_MODE=false to execute.',
      };
    }

    const result = await sendTransaction(txParams, validated.password);

    // Remove strategy from memory after execution
    // @ts-ignore
    delete global.__factorStrategies[validated.strategyId];

    return {
      success: true,
      simulationMode: false,
      strategy: {
        id: validated.strategyId,
        name: strategy.name || 'Unnamed Strategy',
        vault: {
          address: vaultAddress,
          name: vaultInfo.name,
        },
        stepCount: strategy.steps.length,
      },
      execution: {
        transactionHash: result.hash,
        executor: userAddress,
      },
      chain: configManager.getConfig().chain,
      note: 'Strategy execution submitted. Use factor_get_transaction_status to monitor progress.',
    };
  },
};
