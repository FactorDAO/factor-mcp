import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { getKnownAdapters } from '../../sdk/client.js';

export const listAdaptersSchema = z.object({
  protocol: z.string().optional(),
});

export type ListAdaptersInput = z.infer<typeof listAdaptersSchema>;

export const listAdaptersTool = {
  name: 'factor_list_adapters',
  description: 'List available protocol adapters for building strategies. Adapters connect to DeFi protocols like Aave, Morpho, Uniswap, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      protocol: {
        type: 'string',
        description: 'Filter by protocol name (optional). Examples: Aave, Morpho, Uniswap, GMX',
      },
    },
  },
  handler: async (input: ListAdaptersInput) => {
    const validated = listAdaptersSchema.parse(input);

    let adapters = getKnownAdapters();

    if (validated.protocol) {
      const protocol = validated.protocol.toLowerCase();
      adapters = adapters.filter(
        a => a.protocol.toLowerCase().includes(protocol) || a.name.toLowerCase().includes(protocol)
      );
    }

    return {
      adapters,
      total: adapters.length,
      chain: configManager.getConfig().chain,
      note: 'Use adapter IDs when building strategies with factor_build_strategy.',
    };
  },
};
