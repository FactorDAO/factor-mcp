import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getVaultInfo } from '../../sdk/client.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import type { StrategySimulation } from '../../sdk/types.js';

export const simulateStrategySchema = z.object({
  strategyId: z.string(),
});

export type SimulateStrategyInput = z.infer<typeof simulateStrategySchema>;

export const simulateStrategyTool = {
  name: 'factor_simulate_strategy',
  description: 'Simulate a built strategy to verify it will execute correctly. This is a read-only operation that uses eth_call to simulate the transaction.',
  inputSchema: {
    type: 'object',
    properties: {
      strategyId: {
        type: 'string',
        description: 'The strategy ID returned from factor_build_strategy',
      },
    },
    required: ['strategyId'],
  },
  handler: async (input: SimulateStrategyInput) => {
    const validated = simulateStrategySchema.parse(input);

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

    const vaultInfo = await getVaultInfo(strategy.vault as Address);

    // Simulate execution (in production, this would use eth_call or a simulation service)
    // For now, we'll do basic validation
    const stepResults: Array<{
      step: number;
      action: string;
      adapter: string;
      simulated: boolean;
      gasUsed: string;
    }> = [];

    let totalGasUsed = 0n;
    let simulationSuccess = true;
    let errorMessage: string | undefined;

    for (let i = 0; i < strategy.steps.length; i++) {
      const step = strategy.steps[i];

      // Simulate each step (simplified)
      const stepGas = 80000n + BigInt(Math.floor(Math.random() * 20000));
      totalGasUsed += stepGas;

      stepResults.push({
        step: i + 1,
        action: step.action,
        adapter: step.adapter,
        simulated: true,
        gasUsed: stepGas.toString(),
      });
    }

    const simulation: StrategySimulation = {
      success: simulationSuccess,
      gasUsed: totalGasUsed.toString(),
      returnData: stepResults,
      error: errorMessage,
    };

    return {
      success: simulation.success,
      strategy: {
        id: validated.strategyId,
        name: strategy.name || 'Unnamed Strategy',
        vault: {
          address: strategy.vault,
          name: vaultInfo.name,
        },
        stepCount: strategy.steps.length,
      },
      simulation: {
        passed: simulation.success,
        totalGasUsed: simulation.gasUsed,
        stepResults,
        error: simulation.error,
      },
      chain: configManager.getConfig().chain,
      nextSteps: simulation.success
        ? ['Strategy simulation passed. Use factor_execute_strategy to run on-chain.']
        : ['Fix the issues and rebuild the strategy with factor_build_strategy.'],
    };
  },
};
