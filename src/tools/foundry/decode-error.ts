import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SdkError } from '../../utils/errors.js';

const execAsync = promisify(exec);

export const decodeErrorSchema = z.object({
  data: z.string().describe('Error data to decode (hex string)'),
  signature: z.string().optional().describe('Known error signature to try'),
});

export type DecodeErrorInput = z.infer<typeof decodeErrorSchema>;

// Common error signatures
const KNOWN_ERRORS: Record<string, string> = {
  '0x08c379a0': 'Error(string)',
  '0x4e487b71': 'Panic(uint256)',
  '0x9fde12b3': 'FACTORY_InvalidDenominator()',
  '0x': 'Empty revert',
};

export const decodeErrorTool = {
  name: 'factor_decode_error',
  description: 'Decode contract error data using Foundry cast. Useful for understanding why a transaction reverted.',
  inputSchema: {
    type: 'object',
    properties: {
      data: {
        type: 'string',
        description: 'Error data to decode (hex string starting with 0x)',
      },
      signature: {
        type: 'string',
        description: 'Known error signature to try decoding with',
      },
    },
    required: ['data'],
  },
  handler: async (input: DecodeErrorInput) => {
    const validated = decodeErrorSchema.parse(input);

    // Check if cast is available
    let castAvailable = true;
    try {
      await execAsync('cast --version');
    } catch {
      castAvailable = false;
    }

    const selector = validated.data.slice(0, 10).toLowerCase();
    const knownError = KNOWN_ERRORS[selector];

    // Try to decode with cast if available
    if (castAvailable) {
      try {
        // Try standard Error(string) decoding
        if (selector === '0x08c379a0') {
          const { stdout } = await execAsync(`cast --abi-decode "Error(string)" ${validated.data}`);
          return {
            success: true,
            selector,
            errorType: 'Error(string)',
            decoded: stdout.trim(),
            note: 'Standard Solidity error with message',
          };
        }

        // Try Panic decoding
        if (selector === '0x4e487b71') {
          const { stdout } = await execAsync(`cast --abi-decode "Panic(uint256)" ${validated.data}`);
          const panicCode = parseInt(stdout.trim());
          const panicReasons: Record<number, string> = {
            0x00: 'Generic compiler panic',
            0x01: 'Assert failed',
            0x11: 'Arithmetic overflow/underflow',
            0x12: 'Division by zero',
            0x21: 'Invalid enum value',
            0x22: 'Storage byte array encoding error',
            0x31: 'Pop on empty array',
            0x32: 'Array index out of bounds',
            0x41: 'Too much memory allocated',
            0x51: 'Called invalid internal function',
          };
          return {
            success: true,
            selector,
            errorType: 'Panic(uint256)',
            panicCode,
            panicReason: panicReasons[panicCode] || 'Unknown panic code',
            note: 'Solidity panic error',
          };
        }

        // Try custom error decoding with provided signature
        if (validated.signature) {
          const { stdout } = await execAsync(`cast --abi-decode "${validated.signature}" ${validated.data}`);
          return {
            success: true,
            selector,
            errorType: validated.signature,
            decoded: stdout.trim(),
          };
        }

        // Try to decode using 4byte directory
        try {
          const { stdout } = await execAsync(`cast 4byte-decode ${validated.data}`);
          if (stdout.trim()) {
            return {
              success: true,
              selector,
              decoded: stdout.trim(),
              source: '4byte directory',
            };
          }
        } catch {
          // 4byte lookup failed, continue
        }
      } catch (decodeError: any) {
        // Decoding failed, return what we know
      }
    }

    // Return basic info if we couldn't decode
    return {
      success: true,
      selector,
      knownError: knownError || null,
      rawData: validated.data,
      castAvailable,
      note: castAvailable
        ? 'Could not fully decode error. The selector is shown above.'
        : 'Foundry not installed. Install for better error decoding: curl -L https://foundry.paradigm.xyz | bash && foundryup',
    };
  },
};
