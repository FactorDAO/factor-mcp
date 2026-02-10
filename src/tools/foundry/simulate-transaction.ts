import { z } from 'zod';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { configManager } from '../../config/index.js';
import { getWalletAddress, getPrivateKey } from '../../wallet/key-manager.js';
import { SdkError, WalletError } from '../../utils/errors.js';

const execAsync = promisify(exec);

const transactionStepSchema = z.object({
  to: z.string().describe('Target contract address'),
  data: z.string().optional().describe('Calldata (hex string)'),
  value: z.string().optional().describe('ETH value in wei'),
  signature: z.string().optional().describe('Function signature (alternative to data)'),
  args: z.array(z.string()).optional().describe('Function arguments (used with signature)'),
  label: z.string().optional().describe('Label for this step (e.g., "approve USDC", "deploy vault")'),
});

export const simulateTransactionSchema = z.object({
  to: z.string().optional().describe('Target contract address (for single transaction)'),
  data: z.string().optional().describe('Calldata (hex string)'),
  value: z.string().optional().describe('ETH value in wei'),
  signature: z.string().optional().describe('Function signature for cast (alternative to data)'),
  args: z.array(z.string()).optional().describe('Function arguments (used with signature)'),
  gasLimit: z.string().optional().describe('Gas limit'),
  password: z.string().optional().describe('Wallet password if encrypted'),
  steps: z.array(transactionStepSchema).optional().describe('Array of transactions to execute sequentially on the same fork. Use this for multi-step flows like approve + deploy.'),
  balanceOverrides: z.array(z.object({
    address: z.string().describe('Address to override balances for'),
    ethBalance: z.string().optional().describe('ETH balance in wei'),
  })).optional().describe('Override ETH balances on the forked network before executing the transactions'),
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

async function setEthBalance(forkRpcUrl: string, address: string, amountWei: string): Promise<void> {
  const hexAmount = '0x' + BigInt(amountWei).toString(16);
  await execAsync(
    `cast rpc anvil_setBalance ${address} ${hexAmount} --rpc-url "${forkRpcUrl}"`,
    { timeout: 10000 }
  );
}

async function applyBalanceOverrides(
  forkRpcUrl: string,
  overrides: NonNullable<SimulateTransactionInput['balanceOverrides']>
): Promise<{ applied: Array<{ address: string; type: string; success: boolean; error?: string }> }> {
  const applied: Array<{ address: string; type: string; success: boolean; error?: string }> = [];

  for (const override of overrides) {
    if (override.ethBalance) {
      try {
        await setEthBalance(forkRpcUrl, override.address, override.ethBalance);
        applied.push({ address: override.address, type: 'ETH', success: true });
      } catch (err: any) {
        applied.push({ address: override.address, type: 'ETH', success: false, error: err.message });
      }
    }
  }

  return { applied };
}

function buildCastSendCommand(
  step: { to: string; data?: string; value?: string; signature?: string; args?: string[] },
  forkRpcUrl: string,
  privateKey: string,
  gasLimit?: string,
): string {
  let command: string;

  if (step.signature) {
    const args = step.args?.join(' ') || '';
    command = `cast send ${step.to} "${step.signature}" ${args} --rpc-url "${forkRpcUrl}" --private-key ${privateKey}`;
  } else if (step.data) {
    command = `cast send ${step.to} ${step.data} --rpc-url "${forkRpcUrl}" --private-key ${privateKey}`;
  } else {
    throw new Error('Either data or signature must be provided for each step');
  }

  if (step.value) {
    command += ` --value ${step.value}`;
  }

  if (gasLimit) {
    command += ` --gas-limit ${gasLimit}`;
  }

  return command;
}

function parseCastOutput(stdout: string): Record<string, string> {
  const lines = stdout.trim().split('\n');
  const result: Record<string, string> = {};

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      result[key.trim().toLowerCase().replace(/\s+/g, '_')] = valueParts.join(':').trim();
    }
  }

  return result;
}

export const simulateTransactionTool = {
  name: 'factor_simulate_transaction',
  description: 'Simulate one or more transactions on a forked network using Foundry anvil. Supports balanceOverrides to set ETH balances before execution. Use "steps" for multi-step flows (e.g., approve + deploy vault) that need to run sequentially on the same fork.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Target contract address (for single transaction mode)',
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
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Target contract address' },
            data: { type: 'string', description: 'Calldata (hex string)' },
            value: { type: 'string', description: 'ETH value in wei' },
            signature: { type: 'string', description: 'Function signature (alternative to data)' },
            args: { type: 'array', items: { type: 'string' }, description: 'Function arguments' },
            label: { type: 'string', description: 'Label for this step (e.g., "approve USDC")' },
          },
          required: ['to'],
        },
        description: 'Array of transactions to execute sequentially on the same fork. Use for multi-step flows like approve + deploy. Each step runs after the previous one succeeds.',
      },
      balanceOverrides: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'Address to override balances for',
            },
            ethBalance: {
              type: 'string',
              description: 'ETH balance in wei (e.g., "10000000000000000000" for 10 ETH)',
            },
          },
          required: ['address'],
        },
        description: 'Override ETH balances on the forked network before executing the transactions.',
      },
    },
    required: [],
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

    // Build the list of steps to execute
    const steps: Array<{ to: string; data?: string; value?: string; signature?: string; args?: string[]; label?: string }> = [];

    if (validated.steps && validated.steps.length > 0) {
      // Multi-step mode
      steps.push(...validated.steps);
    } else if (validated.to) {
      // Single transaction mode (backward compatible)
      steps.push({
        to: validated.to,
        data: validated.data,
        value: validated.value,
        signature: validated.signature,
        args: validated.args,
        label: 'transaction',
      });
    } else {
      throw new Error('Either "to" (single transaction) or "steps" (multi-step) must be provided');
    }

    try {
      // Start anvil with fork
      const port = await startAnvilFork(rpcUrl);
      const forkRpcUrl = `http://127.0.0.1:${port}`;

      // Give anvil a moment to fully initialize
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Apply balance overrides if provided
      let overrideResults: Awaited<ReturnType<typeof applyBalanceOverrides>> | undefined;
      if (validated.balanceOverrides && validated.balanceOverrides.length > 0) {
        overrideResults = await applyBalanceOverrides(forkRpcUrl, validated.balanceOverrides);

        // Check if any critical overrides failed
        const failedOverrides = overrideResults.applied.filter(r => !r.success);
        if (failedOverrides.length > 0) {
          stopAnvil();
          return {
            success: false,
            simulated: false,
            error: 'BALANCE_OVERRIDE_FAILED',
            message: 'Some balance overrides failed. The transaction was NOT simulated.',
            overrideResults: overrideResults.applied,
            failedOverrides,
          };
        }
      }

      // Execute each step sequentially
      const stepResults: Array<{
        step: number;
        label?: string;
        to: string;
        status: string;
        gasUsed?: string;
        transactionHash?: string;
        rawOutput: string;
      }> = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const command = buildCastSendCommand(step, forkRpcUrl, privateKey, i === steps.length - 1 ? validated.gasLimit : undefined);

        try {
          const { stdout } = await execAsync(command, { timeout: 60000 });
          const parsed = parseCastOutput(stdout);

          stepResults.push({
            step: i + 1,
            label: step.label,
            to: step.to,
            status: parsed.status === '1' || parsed.status === '1 (success)' ? 'success' : parsed.status || 'success',
            gasUsed: parsed.gas_used || parsed.gasused,
            transactionHash: parsed.transaction_hash || parsed.transactionhash,
            rawOutput: stdout.trim(),
          });
        } catch (stepError: any) {
          // Step failed — stop execution and report
          stopAnvil();

          const errorMessage = stepError.message || stepError.toString();
          const revertMatch = errorMessage.match(/revert[:\s]*(.*?)(?:\n|$)/i);
          const revertReason = revertMatch ? revertMatch[1].trim() : undefined;

          return {
            success: false,
            simulated: true,
            reverted: true,
            failedStep: i + 1,
            failedStepLabel: step.label,
            revertReason: revertReason || 'Unknown revert reason',
            completedSteps: stepResults,
            from: userAddress,
            to: step.to,
            rawError: errorMessage,
            ...(overrideResults ? { balanceOverrides: overrideResults.applied } : {}),
            note: `Step ${i + 1}${step.label ? ` (${step.label})` : ''} reverted. Previous steps succeeded on the fork.`,
          };
        }
      }

      // All steps succeeded
      stopAnvil();

      const lastStep = stepResults[stepResults.length - 1];

      return {
        success: true,
        simulated: true,
        from: userAddress,
        totalSteps: stepResults.length,
        steps: stepResults,
        // For backward compatibility, expose last step's fields at top level
        to: lastStep.to,
        status: lastStep.status,
        gasUsed: lastStep.gasUsed,
        transactionHash: lastStep.transactionHash,
        rawOutput: lastStep.rawOutput,
        ...(overrideResults ? { balanceOverrides: overrideResults.applied } : {}),
        note: stepResults.length > 1
          ? `All ${stepResults.length} steps simulated successfully on forked network. No real tokens were spent.`
          : 'Transaction simulated on forked network. No real tokens were spent.',
      };
    } catch (error: any) {
      stopAnvil();

      const errorMessage = error.message || error.toString();

      if (errorMessage.includes('revert')) {
        const revertMatch = errorMessage.match(/revert[:\s]*(.*?)(?:\n|$)/i);
        const revertReason = revertMatch ? revertMatch[1].trim() : 'Unknown revert reason';

        return {
          success: false,
          simulated: true,
          reverted: true,
          revertReason,
          from: userAddress,
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
