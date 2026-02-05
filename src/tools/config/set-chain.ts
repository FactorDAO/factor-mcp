import { z } from 'zod';
import { configManager, isValidChainName, type SupportedChainName } from '../../config/index.js';
import { ConfigurationError } from '../../utils/errors.js';
import { clearCachedClients } from '../../wallet/signer.js';

export const setChainSchema = z.object({
  chain: z.enum(['ARBITRUM_ONE', 'BASE', 'MAINNET']),
});

export type SetChainInput = z.infer<typeof setChainSchema>;

export const setChainTool = {
  name: 'factor_set_chain',
  description: 'Set the active blockchain network for Factor Protocol operations. Supported chains: ARBITRUM_ONE (default), BASE, MAINNET (Ethereum).',
  inputSchema: {
    type: 'object',
    properties: {
      chain: {
        type: 'string',
        enum: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
        description: 'The chain to switch to',
      },
    },
    required: ['chain'],
  },
  handler: async (input: SetChainInput) => {
    const validated = setChainSchema.parse(input);

    if (!isValidChainName(validated.chain)) {
      throw new ConfigurationError(`Invalid chain: ${validated.chain}`);
    }

    const previousChain = configManager.getConfig().chain;
    configManager.setChain(validated.chain as SupportedChainName);
    clearCachedClients();

    const newConfig = configManager.getConfig();

    return {
      success: true,
      previousChain,
      currentChain: newConfig.chain,
      chainId: configManager.getChainId(),
      rpcUrl: newConfig.rpcUrl,
    };
  },
};
