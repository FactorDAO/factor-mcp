import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { clearCachedClients } from '../../wallet/signer.js';

export const setRpcSchema = z.object({
  url: z.string().url(),
});

export type SetRpcInput = z.infer<typeof setRpcSchema>;

export const setRpcTool = {
  name: 'factor_set_rpc',
  description: 'Configure a custom RPC endpoint for blockchain interactions. Overrides the default Alchemy RPC.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The RPC URL to use (must be a valid URL)',
      },
    },
    required: ['url'],
  },
  handler: async (input: SetRpcInput) => {
    const validated = setRpcSchema.parse(input);

    const previousRpc = configManager.getRpcUrl();
    configManager.setRpcUrl(validated.url);
    clearCachedClients();

    return {
      success: true,
      previousRpcUrl: previousRpc,
      currentRpcUrl: validated.url,
      chain: configManager.getConfig().chain,
    };
  },
};
