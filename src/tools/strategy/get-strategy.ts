import { z } from 'zod';
import { SdkError } from '../../utils/errors.js';
import { statsApiFetch } from '../../utils/stats-api.js';

export const getStrategySchema = z.object({
  hash: z.string(),
});

export type GetStrategyInput = z.infer<typeof getStrategySchema>;

export const getStrategyTool = {
  name: 'factor_get_strategy',
  description: 'Get a strategy by its hash or vault address from the Factor Studio Stats API. No wallet or signature required.',
  inputSchema: {
    type: 'object',
    properties: {
      hash: {
        type: 'string',
        description: 'The hash or vault address of the strategy to retrieve',
      },
    },
    required: ['hash'],
  },
  handler: async (input: GetStrategyInput) => {
    const validated = getStrategySchema.parse(input);

    try {
      const response = await statsApiFetch(`/strategies/${validated.hash}`, {
        method: 'GET',
      });

      const data: any = await response.json();

      if (!response.ok || data.error) {
        throw new SdkError(data.message || `Stats API error: ${response.status}`, data);
      }

      return {
        success: true,
        data,
      };
    } catch (error) {
      if (error instanceof SdkError) {
        throw error;
      }
      throw new SdkError('Failed to get strategy', error);
    }
  },
};
