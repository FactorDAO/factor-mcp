import { z } from 'zod';
import { configManager } from '../../config/index.js';
import { getKnownBuildingBlocks } from '../../sdk/client.js';

export const listBuildingBlocksSchema = z.object({
  adapter: z.string().optional(),
  type: z.string().optional(),
});

export type ListBuildingBlocksInput = z.infer<typeof listBuildingBlocksSchema>;

export const listBuildingBlocksTool = {
  name: 'factor_list_building_blocks',
  description: 'List available building blocks for composing strategies. Building blocks are actions like LEND, BORROW, SWAP, STAKE, LP, HARVEST, FLASH_LOAN.',
  inputSchema: {
    type: 'object',
    properties: {
      adapter: {
        type: 'string',
        description: 'Filter by adapter ID (optional)',
      },
      type: {
        type: 'string',
        description: 'Filter by block type (optional). Examples: LEND, BORROW, SWAP, STAKE, LP, HARVEST, FLASH_LOAN',
      },
    },
  },
  handler: async (input: ListBuildingBlocksInput) => {
    const validated = listBuildingBlocksSchema.parse(input);

    let blocks = getKnownBuildingBlocks();

    if (validated.adapter) {
      const adapter = validated.adapter.toLowerCase();
      blocks = blocks.filter(
        b => b.adapter.toLowerCase() === adapter || b.adapter === 'any'
      );
    }

    if (validated.type) {
      const type = validated.type.toUpperCase();
      blocks = blocks.filter(b => b.type === type);
    }

    return {
      buildingBlocks: blocks,
      total: blocks.length,
      chain: configManager.getConfig().chain,
      availableTypes: ['LEND', 'BORROW', 'SWAP', 'STAKE', 'LP', 'HARVEST', 'FLASH_LOAN'],
      note: 'Use building block IDs and parameters when composing strategies.',
    };
  },
};
