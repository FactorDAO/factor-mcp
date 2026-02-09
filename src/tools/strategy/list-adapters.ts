import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { getKnownAdapters } from '../../sdk/client.js';

export const listAdaptersSchema = z.object({
  protocol: z.string().optional(),
});

export type ListAdaptersInput = z.infer<typeof listAdaptersSchema>;

export const listAdaptersTool = {
  name: 'factor_list_adapters',
  description: 'List available protocol adapters for building strategies. Adapters connect to DeFi protocols like Aave, Morpho, Uniswap, etc. Results are filtered by the current chain. Use adapter IDs with factor_build_strategy or factor_execute_manager.',
  inputSchema: {
    type: 'object',
    properties: {
      protocol: {
        type: 'string',
        description: 'Filter by protocol name (optional). Examples: Aave, Morpho, Uniswap, GMX, Pendle, Silo',
      },
    },
  },
  handler: async (input: ListAdaptersInput) => {
    const validated = listAdaptersSchema.parse(input);
    const chain = configManager.getConfig().chain;

    let adapters = getKnownAdapters();

    // Filter by current chain
    adapters = adapters.filter(a => a.chains.includes(chain as any));

    if (validated.protocol) {
      const protocol = validated.protocol.toLowerCase();
      adapters = adapters.filter(
        a => a.protocol.toLowerCase().includes(protocol) ||
             a.name.toLowerCase().includes(protocol) ||
             a.id.toLowerCase().includes(protocol) ||
             a.category.toLowerCase().includes(protocol)
      );
    }

    return {
      adapters,
      total: adapters.length,
      chain,
      note: 'Use adapter IDs (the "id" field) with factor_build_strategy or factor_execute_manager. Actions listed are the method names to use.',
    };
  },
};
