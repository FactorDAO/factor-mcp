import { z } from 'zod';
import { isAddress, type Address, keccak256, toHex } from 'viem';
import { configManager } from '../../config/index.js';
import { getVaultInfo, getKnownAdapters, getKnownBuildingBlocks } from '../../sdk/client.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import type { StrategyStep, BuiltStrategy } from '../../sdk/types.js';

const strategyStepSchema = z.object({
  adapter: z.string(),
  action: z.string(),
  params: z.record(z.unknown()),
});

export const buildStrategySchema = z.object({
  vaultAddress: z.string(),
  steps: z.array(strategyStepSchema).min(1),
  name: z.string().optional(),
});

export type BuildStrategyInput = z.infer<typeof buildStrategySchema>;

export const buildStrategyTool = {
  name: 'factor_build_strategy',
  description: 'Build a multi-step DeFi strategy for a vault. Combine building blocks like LEND, BORROW, SWAP to create complex strategies. Returns a strategy ID that can be simulated or executed.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault to execute the strategy on',
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            adapter: {
              type: 'string',
              description: 'The adapter ID (e.g., aave-v3, uniswap-v3)',
            },
            action: {
              type: 'string',
              description: 'The action to perform (e.g., LEND, BORROW, SWAP)',
            },
            params: {
              type: 'object',
              description: 'Parameters for the action',
            },
          },
          required: ['adapter', 'action', 'params'],
        },
        description: 'Array of strategy steps to execute in order',
      },
      name: {
        type: 'string',
        description: 'Optional name for the strategy',
      },
    },
    required: ['vaultAddress', 'steps'],
  },
  handler: async (input: BuildStrategyInput) => {
    const validated = buildStrategySchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const vaultInfo = await getVaultInfo(vaultAddress);

    // Validate adapters and actions
    const adapters = getKnownAdapters();
    const blocks = getKnownBuildingBlocks();
    const adapterIds = new Set(adapters.map(a => a.id));
    const actionTypes = new Set(blocks.map(b => b.type));

    const validationErrors: string[] = [];

    for (let i = 0; i < validated.steps.length; i++) {
      const step = validated.steps[i];

      if (!adapterIds.has(step.adapter)) {
        validationErrors.push(`Step ${i + 1}: Unknown adapter "${step.adapter}"`);
      }

      if (!actionTypes.has(step.action as any)) {
        validationErrors.push(`Step ${i + 1}: Unknown action "${step.action}"`);
      }

      // Validate adapter supports the action
      const adapter = adapters.find(a => a.id === step.adapter);
      if (adapter && !adapter.supportedActions.includes(step.action)) {
        validationErrors.push(
          `Step ${i + 1}: Adapter "${step.adapter}" does not support action "${step.action}"`
        );
      }
    }

    if (validationErrors.length > 0) {
      throw new SdkError('Strategy validation failed', validationErrors);
    }

    // Generate strategy ID
    const strategyData = JSON.stringify({
      vault: vaultAddress,
      steps: validated.steps,
      timestamp: Date.now(),
    });
    const strategyId = keccak256(toHex(strategyData)).slice(0, 18);

    // Build encoded calldata (simplified - in production this would use the actual SDK)
    const encodedSteps = validated.steps.map((step, i) => ({
      index: i,
      adapter: step.adapter,
      action: step.action,
      params: step.params,
      // In production, this would be actual encoded calldata
      encodedParams: `0x${Buffer.from(JSON.stringify(step.params)).toString('hex')}`,
    }));

    // Estimate gas (simplified)
    const baseGas = 50000n;
    const gasPerStep = 100000n;
    const estimatedGas = baseGas + (gasPerStep * BigInt(validated.steps.length));

    const strategy: BuiltStrategy = {
      id: strategyId,
      steps: validated.steps as StrategyStep[],
      estimatedGas: estimatedGas.toString(),
      encodedCalldata: `0x${strategyId.slice(2)}`,
    };

    // Store strategy in memory for later execution (in production, use a proper store)
    // @ts-ignore - using global for demo
    global.__factorStrategies = global.__factorStrategies || {};
    // @ts-ignore
    global.__factorStrategies[strategyId] = {
      ...strategy,
      vault: vaultAddress,
      name: validated.name,
      createdAt: new Date().toISOString(),
    };

    return {
      success: true,
      strategy: {
        id: strategyId,
        name: validated.name || 'Unnamed Strategy',
        vault: {
          address: vaultAddress,
          name: vaultInfo.name,
        },
        steps: encodedSteps,
        estimatedGas: strategy.estimatedGas,
      },
      chain: configManager.getConfig().chain,
      nextSteps: [
        'Use factor_simulate_strategy to test the strategy',
        'Use factor_execute_strategy to run the strategy on-chain',
      ],
    };
  },
};
