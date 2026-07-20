import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { VaultError, SdkError } from '../../utils/errors.js';
import { StudioProVaultStats } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const getExecutionsSchema = z.object({
  vaultAddress: z.string(),
  limit: z.number().optional(),
});

export type GetExecutionsInput = z.infer<typeof getExecutionsSchema>;

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

export const getExecutionsTool = {
  name: 'factor_get_executions',
  description: 'Get the execution history of a vault, showing all manager transactions with decoded adapter calls.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of executions to return (default: 20)',
      },
    },
    required: ['vaultAddress'],
  },
  handler: async (input: GetExecutionsInput) => {
    const validated = getExecutionsSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const limit = validated.limit || 20;

    try {
      const proVaultStats = new StudioProVaultStats({
        chainId,
        vaultAddress,
        environment: configManager.getEnvironment(),
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const executions = await proVaultStats.getVaultExecutions();

      // Limit results
      const limitedExecutions = executions.slice(0, limit);

      return {
        vaultAddress,
        chain,
        executions: limitedExecutions.map(exec => ({
          transactionHash: exec.transactionHash,
          blockNumber: exec.blockNumber,
          timestamp: exec.timestamp,
          status: exec.status,
          adapters: exec.adapters.map(adapter => ({
            protocol: adapter.protocol,
            buildingBlock: adapter.buildingBlock,
            adapterName: adapter.adapterName,
            functionName: adapter.functionName,
            args: adapter.args,
          })),
        })),
        totalExecutions: executions.length,
        showing: limitedExecutions.length,
      };
    } catch (error) {
      throw new SdkError('Failed to get vault executions', error);
    }
  },
};
