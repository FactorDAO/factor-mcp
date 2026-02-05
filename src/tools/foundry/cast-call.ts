import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { configManager } from '../../config/index.js';
import { SdkError } from '../../utils/errors.js';

const execAsync = promisify(exec);

export const castCallSchema = z.object({
  to: z.string().describe('Contract address to call'),
  signature: z.string().describe('Function signature (e.g., "balanceOf(address)" or "0x70a08231")'),
  args: z.array(z.string()).optional().describe('Function arguments'),
  block: z.string().optional().describe('Block number or "latest"'),
  decode: z.boolean().default(true).describe('Decode the output'),
});

export type CastCallInput = z.infer<typeof castCallSchema>;

export const castCallTool = {
  name: 'factor_cast_call',
  description: 'Execute a read-only contract call using Foundry cast. Useful for checking balances, allowances, and contract state.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Contract address to call',
      },
      signature: {
        type: 'string',
        description: 'Function signature (e.g., "balanceOf(address)(uint256)" or just "balanceOf(address)")',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Function arguments',
      },
      block: {
        type: 'string',
        description: 'Block number or "latest" (default: latest)',
      },
      decode: {
        type: 'boolean',
        description: 'Decode the output (default: true)',
      },
    },
    required: ['to', 'signature'],
  },
  handler: async (input: CastCallInput) => {
    const validated = castCallSchema.parse(input);
    const rpcUrl = configManager.getRpcUrl();

    // Check if cast is available
    try {
      await execAsync('cast --version');
    } catch {
      return {
        success: false,
        error: 'FOUNDRY_NOT_INSTALLED',
        message: 'Foundry cast is not installed. Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup',
      };
    }

    try {
      const args = validated.args?.join(' ') || '';
      const blockArg = validated.block ? `--block ${validated.block}` : '';

      const command = `cast call ${validated.to} "${validated.signature}" ${args} --rpc-url "${rpcUrl}" ${blockArg}`.trim();

      const { stdout, stderr } = await execAsync(command);

      if (stderr && !stdout) {
        throw new Error(stderr);
      }

      return {
        success: true,
        result: stdout.trim(),
        command: command.replace(rpcUrl, '<RPC_URL>'), // Hide RPC URL in response
      };
    } catch (error: any) {
      throw new SdkError('Cast call failed', error);
    }
  },
};
