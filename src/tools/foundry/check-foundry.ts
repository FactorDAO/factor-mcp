import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const checkFoundrySchema = z.object({});

export type CheckFoundryInput = z.infer<typeof checkFoundrySchema>;

export interface FoundryStatus {
  installed: boolean;
  cast: { available: boolean; version?: string };
  anvil: { available: boolean; version?: string };
  forge: { available: boolean; version?: string };
  rustInstalled: boolean;
  rustVersion?: string;
}

async function checkCommand(command: string): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await execAsync(`${command} --version`);
    return { available: true, version: stdout.trim().split('\n')[0] };
  } catch {
    return { available: false };
  }
}

async function checkRust(): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await execAsync('rustc --version');
    return { installed: true, version: stdout.trim() };
  } catch {
    return { installed: false };
  }
}

export const checkFoundryTool = {
  name: 'factor_check_foundry',
  description: 'Check if Foundry suite (cast, anvil, forge) and Rust are installed. Foundry enables advanced features like transaction simulation on forked networks.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input: CheckFoundryInput): Promise<FoundryStatus & { note: string }> => {
    const [cast, anvil, forge, rust] = await Promise.all([
      checkCommand('cast'),
      checkCommand('anvil'),
      checkCommand('forge'),
      checkRust(),
    ]);

    const installed = cast.available && anvil.available && forge.available;

    let note = '';
    if (installed) {
      note = 'Foundry is fully installed. Advanced simulation features are available.';
    } else if (!rust.installed) {
      note = 'Rust is not installed. Install Rust first with: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh\n' +
        'Then install Foundry with: curl -L https://foundry.paradigm.xyz | bash && foundryup';
    } else {
      note = 'Foundry is not installed. Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup\n' +
        'Some advanced features like fork simulation will not be available.';
    }

    return {
      installed,
      cast,
      anvil,
      forge,
      rustInstalled: rust.installed,
      rustVersion: rust.version,
      note,
    };
  },
};
