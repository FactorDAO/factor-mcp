import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { configManager } from '../../config/index.js';
import { getWalletAddress, getPrivateKey } from '../../wallet/key-manager.js';
import { SdkError, WalletError } from '../../utils/errors.js';
import { redactSecrets } from '../../utils/redact-secrets.js';

const execAsync = promisify(exec);

const FORGE_PROJECT_DIR = join(homedir(), '.factor-mcp', 'forge-project');

/**
 * Save a forge script to disk and return a short reference ID.
 * Other tools call this to persist scripts so the LLM doesn't have to
 * re-pass large hex blobs — it just passes the scriptRef string.
 *
 * If FACTOR_ARTIFACTS_DIR is set, also copies the script there for persistence
 * (e.g. when running inside a Docker container with an ephemeral filesystem).
 */
export function saveForgeScript(content: string, refPrefix: string = 'sim'): string {
  const scriptDir = join(FORGE_PROJECT_DIR, 'script');
  if (!existsSync(scriptDir)) {
    mkdirSync(scriptDir, { recursive: true });
  }
  const ref = `${refPrefix}_${Date.now()}`;
  writeFileSync(join(scriptDir, `${ref}.sol`), content);

  // Persist to artifacts dir if configured (for Docker/openbowie)
  const artifactsDir = process.env.FACTOR_ARTIFACTS_DIR;
  if (artifactsDir) {
    const artifactScriptDir = join(artifactsDir, 'forge-scripts');
    if (!existsSync(artifactScriptDir)) {
      mkdirSync(artifactScriptDir, { recursive: true });
    }
    writeFileSync(join(artifactScriptDir, `${ref}.sol`), content);
  }

  return ref;
}

export const runForgeScriptSchema = z.object({
  scriptContent: z.string().optional().describe('Solidity script source code. Must include a contract extending Script from forge-std with a run() function.'),
  scriptRef: z.string().optional().describe('Reference to a pre-saved script (returned in simulationHint by other tools). Pass this instead of scriptContent — the script is already saved on disk.'),
  scriptName: z.string().optional().describe('Name for the script file (default: Script.sol). Must end in .sol'),
  password: z.string().optional().describe('Wallet password if encrypted'),
});

export type RunForgeScriptInput = z.infer<typeof runForgeScriptSchema>;

async function ensureForgeProject(): Promise<void> {
  const foundryToml = join(FORGE_PROJECT_DIR, 'foundry.toml');
  const forgeStdScript = join(FORGE_PROJECT_DIR, 'lib', 'forge-std', 'src', 'Script.sol');

  if (existsSync(foundryToml) && existsSync(forgeStdScript)) {
    return;
  }

  // Initialize forge project (creates git repo + installs forge-std)
  await execAsync(`forge init "${FORGE_PROJECT_DIR}" --force`, {
    timeout: 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

  // Verify forge-std was installed
  if (!existsSync(forgeStdScript)) {
    await execAsync(`forge install foundry-rs/forge-std`, {
      cwd: FORGE_PROJECT_DIR,
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }
}

function extractTraces(output: string): string[] {
  const traces: string[] = [];
  const lines = output.split('\n');
  let inTrace = false;
  let currentTrace = '';

  for (const line of lines) {
    if (line.includes('Traces:') || line.includes('├─') || line.includes('└─') || line.includes('│')) {
      inTrace = true;
      currentTrace += line + '\n';
    } else if (inTrace && line.trim() === '') {
      if (currentTrace) {
        traces.push(currentTrace.trim());
        currentTrace = '';
      }
      inTrace = false;
    } else if (inTrace) {
      currentTrace += line + '\n';
    }
  }

  if (currentTrace) {
    traces.push(currentTrace.trim());
  }

  return traces;
}

export const runForgeScriptTool = {
  name: 'factor_run_forge_script',
  description: 'Run a Solidity forge script on a forked network. Pass EITHER scriptRef (a reference returned by other tools in simulationHint — preferred, just pass the string) OR scriptContent (inline Solidity source). No real tokens are spent.',
  inputSchema: {
    type: 'object',
    properties: {
      scriptRef: {
        type: 'string',
        description: 'Reference to a pre-saved script (from simulationHint). PREFERRED — just pass this string as-is. The script is already saved on disk.',
      },
      scriptContent: {
        type: 'string',
        description: 'Inline Solidity source code. Only use if no scriptRef is available.',
      },
      scriptName: {
        type: 'string',
        description: 'Name for the script file (default: Script.sol)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
  },
  handler: async (input: RunForgeScriptInput) => {
    const validated = runForgeScriptSchema.parse(input);
    const rpcUrl = configManager.getRpcUrl();

    // Resolve script content: scriptRef takes priority over scriptContent
    let scriptContent: string;
    let scriptName: string;

    if (validated.scriptRef) {
      // Load pre-saved script by reference
      const refPath = join(FORGE_PROJECT_DIR, 'script', `${validated.scriptRef}.sol`);
      if (!existsSync(refPath)) {
        return {
          success: false,
          error: 'SCRIPT_NOT_FOUND',
          message: `Script reference "${validated.scriptRef}" not found. The script may have been cleaned up. Try the original tool again to get a new scriptRef.`,
        };
      }
      scriptContent = readFileSync(refPath, 'utf-8');
      scriptName = `${validated.scriptRef}.sol`;
    } else if (validated.scriptContent) {
      scriptContent = validated.scriptContent;
      scriptName = validated.scriptName || 'Script.sol';
    } else {
      return {
        success: false,
        error: 'MISSING_INPUT',
        message: 'Provide either scriptRef (preferred — from simulationHint) or scriptContent (inline Solidity source).',
      };
    }

    // Check forge is available
    try {
      await execAsync('forge --version');
    } catch {
      return {
        success: false,
        error: 'FOUNDRY_NOT_INSTALLED',
        message: 'Foundry forge is not installed. Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup',
      };
    }

    // Get wallet
    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const userAddress = getWalletAddress(walletName);
    const privateKey = getPrivateKey(walletName, validated.password);

    try {
      // Ensure forge project exists with forge-std
      await ensureForgeProject();

      // Write script file (for scriptRef, it's already there but we overwrite to be safe)
      const scriptDir = join(FORGE_PROJECT_DIR, 'script');
      if (!existsSync(scriptDir)) {
        mkdirSync(scriptDir, { recursive: true });
      }
      writeFileSync(join(scriptDir, scriptName), scriptContent);

      // Run forge script on fork (simulation only, no broadcast)
      const command = [
        'forge', 'script',
        `script/${scriptName}`,
        '--fork-url', `"${rpcUrl}"`,
        '--sender', userAddress,
        '--private-key', privateKey,
        '-vvvv',
      ].join(' ');

      const { stdout, stderr } = await execAsync(command, {
        cwd: FORGE_PROJECT_DIR,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      // MND-1036: `--fork-url` above carries the Alchemy-keyed RPC URL.
      // forge/reqwest connection-error text can echo it back into
      // stdout/stderr, and every branch below returns a slice of this
      // combined output directly as the tool result (none of them go
      // through the SdkError/FactorMcpError choke point) — redact once
      // here so every downstream field (rawOutput, traces, revertReason)
      // is safe.
      const output = redactSecrets(stdout + '\n' + stderr);
      const gasMatch = output.match(/Gas used:\s*(\d+)/);
      const successMatch = output.match(/Script ran successfully/i);
      const traces = extractTraces(output);

      return {
        success: !!successMatch,
        simulated: true,
        from: userAddress,
        gasUsed: gasMatch ? gasMatch[1] : undefined,
        traces,
        rawOutput: output.slice(0, 50000),
        note: successMatch
          ? 'Forge script simulated successfully on forked network. No real tokens were spent.'
          : 'Forge script completed. Check rawOutput for details.',
      };
    } catch (error: any) {
      // MND-1036: same rationale as the success-path `output` above.
      const errorOutput = redactSecrets([error.stdout, error.stderr, error.message].filter(Boolean).join('\n'));

      // Compilation error
      if (errorOutput.includes('Compiler run failed') || errorOutput.match(/Error \(\d+\)/)) {
        return {
          success: false,
          error: 'COMPILATION_ERROR',
          message: 'Script failed to compile. Check the Solidity source for errors.',
          rawOutput: errorOutput.slice(0, 50000),
        };
      }

      // Script ran successfully but forge exited non-zero (e.g. dry-run validation
      // failed because deal() cheatcodes don't persist in broadcast replay).
      // This is still a success — the simulation completed on the forked network.
      const successMatch = errorOutput.match(/Script ran successfully/i);
      if (successMatch) {
        const gasMatch = errorOutput.match(/Gas used:\s*(\d+)/);
        const traces = extractTraces(errorOutput);

        return {
          success: true,
          simulated: true,
          from: userAddress,
          gasUsed: gasMatch ? gasMatch[1] : undefined,
          traces,
          rawOutput: errorOutput.slice(0, 50000),
          note: 'Forge script simulated successfully on forked network. No real tokens were spent. (Note: forge dry-run validation may have failed because cheatcodes like deal() do not persist in broadcast replay — this is expected.)',
        };
      }

      // Revert
      if (errorOutput.toLowerCase().includes('revert')) {
        const revertMatch = errorOutput.match(/revert[:\s]*(.*?)(?:\n|$)/i);
        return {
          success: false,
          simulated: true,
          reverted: true,
          revertReason: revertMatch ? revertMatch[1].trim() : 'Unknown revert reason',
          from: userAddress,
          rawOutput: errorOutput.slice(0, 50000),
          note: 'Script reverted during execution. Check the revert reason and traces.',
        };
      }

      throw new SdkError('Forge script failed', error);
    }
  },
};
