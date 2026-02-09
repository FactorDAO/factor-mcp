import { z } from 'zod';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { configManager } from '../../config/index.js';
import { getWalletAddress, getPrivateKey } from '../../wallet/key-manager.js';
import { SdkError, WalletError } from '../../utils/errors.js';

const execAsync = promisify(exec);

export const simulateTransactionSchema = z.object({
  to: z.string().describe('Target contract address'),
  data: z.string().optional().describe('Calldata (hex string)'),
  value: z.string().optional().describe('ETH value in wei'),
  signature: z.string().optional().describe('Function signature for cast (alternative to data)'),
  args: z.array(z.string()).optional().describe('Function arguments (used with signature)'),
  gasLimit: z.string().optional().describe('Gas limit'),
  password: z.string().optional().describe('Wallet password if encrypted'),
});

export type SimulateTransactionInput = z.infer<typeof simulateTransactionSchema>;

// Track running anvil instance
let anvilProcess: ChildProcess | null = null;
let anvilPort = 8545;

async function startAnvilFork(rpcUrl: string): Promise<number> {
  // Kill any existing anvil process
  if (anvilProcess) {
    anvilProcess.kill();
    anvilProcess = null;
  }

  // Find an available port
  anvilPort = 8545 + Math.floor(Math.random() * 1000);

  return new Promise((resolve, reject) => {
    anvilProcess = spawn('anvil', [
      '--fork-url', rpcUrl,
      '--port', anvilPort.toString(),
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;

    anvilProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Listening on') && !started) {
        started = true;
        resolve(anvilPort);
      }
    });

    anvilProcess.stderr?.on('data', (data) => {
      if (!started) {
        reject(new Error(`Anvil error: ${data.toString()}`));
      }
    });

    anvilProcess.on('error', (err) => {
      reject(new Error(`Failed to start anvil: ${err.message}`));
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!started) {
        anvilProcess?.kill();
        anvilProcess = null;
        reject(new Error('Anvil startup timeout'));
      }
    }, 10000);
  });
}

function stopAnvil() {
  if (anvilProcess) {
    anvilProcess.kill();
    anvilProcess = null;
  }
}

export const simulateTransactionTool = {
  name: 'factor_simulate_transaction',
  description: 'Simulate a transaction on a forked network using Foundry anvil. This allows testing transactions without spending real gas or tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Target contract address',
      },
      data: {
        type: 'string',
        description: 'Calldata (hex string starting with 0x)',
      },
      value: {
        type: 'string',
        description: 'ETH value in wei (default: 0)',
      },
      signature: {
        type: 'string',
        description: 'Function signature (e.g., "transfer(address,uint256)") - alternative to data',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Function arguments (used with signature)',
      },
      gasLimit: {
        type: 'string',
        description: 'Gas limit (default: auto)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['to'],
  },
  handler: async (input: SimulateTransactionInput) => {
    const validated = simulateTransactionSchema.parse(input);
    const rpcUrl = configManager.getRpcUrl();

    // Check if anvil is available
    try {
      await execAsync('anvil --version');
    } catch {
      return {
        success: false,
        error: 'FOUNDRY_NOT_INSTALLED',
        message: 'Foundry anvil is not installed. Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup',
        note: 'Fork simulation requires Foundry. The transaction was NOT simulated.',
      };
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const userAddress = getWalletAddress(walletName);
    const privateKey = getPrivateKey(walletName, validated.password);

    try {
      // Start anvil with fork
      const port = await startAnvilFork(rpcUrl);
      const forkRpcUrl = `http://127.0.0.1:${port}`;

      // Give anvil a moment to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Build the cast send command
      let command: string;

      if (validated.signature) {
        const args = validated.args?.join(' ') || '';
        command = `cast send ${validated.to} "${validated.signature}" ${args} --rpc-url "${forkRpcUrl}" --private-key ${privateKey}`;
      } else if (validated.data) {
        command = `cast send ${validated.to} --data ${validated.data} --rpc-url "${forkRpcUrl}" --private-key ${privateKey}`;
      } else {
        throw new Error('Either data or signature must be provided');
      }

      if (validated.value) {
        command += ` --value ${validated.value}`;
      }

      if (validated.gasLimit) {
        command += ` --gas-limit ${validated.gasLimit}`;
      }

      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });

      // Stop anvil
      stopAnvil();

      // Parse the output
      const lines = stdout.trim().split('\n');
      const result: Record<string, string> = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          result[key.trim().toLowerCase().replace(/\s+/g, '_')] = valueParts.join(':').trim();
        }
      }

      return {
        success: true,
        simulated: true,
        from: userAddress,
        to: validated.to,
        status: result.status || 'success',
        gasUsed: result.gas_used || result.gasused,
        blockNumber: result.block_number || result.blocknumber,
        transactionHash: result.transaction_hash || result.transactionhash,
        logs: result.logs,
        rawOutput: stdout.trim(),
        note: 'Transaction simulated on forked network. No real tokens were spent.',
      };
    } catch (error: any) {
      stopAnvil();

      // Check for specific revert reasons
      const errorMessage = error.message || error.toString();

      if (errorMessage.includes('revert')) {
        // Try to extract revert reason
        const revertMatch = errorMessage.match(/revert[:\s]*(.*?)(?:\n|$)/i);
        const revertReason = revertMatch ? revertMatch[1].trim() : 'Unknown revert reason';

        return {
          success: false,
          simulated: true,
          reverted: true,
          revertReason,
          from: userAddress,
          to: validated.to,
          rawError: errorMessage,
          note: 'Transaction would revert if sent. Check the revert reason above.',
        };
      }

      throw new SdkError('Simulation failed', error);
    }
  },
};

// Cleanup on process exit
process.on('exit', stopAnvil);
process.on('SIGINT', () => { stopAnvil(); process.exit(); });
process.on('SIGTERM', () => { stopAnvil(); process.exit(); });
