/**
 * End-to-End MCP Protocol Tests
 *
 * Tests the FULL MCP protocol flow exactly as an agent (like Claude Code) uses it:
 *   1. Spawns the Factor MCP server as a child process
 *   2. Connects via StdioClientTransport (JSON-RPC over stdio)
 *   3. Lists tools via tools/list
 *   4. Calls tools via tools/call
 *   5. Validates responses
 *
 * This ensures the server is correctly wired end-to-end — not just handler functions,
 * but the full transport → JSON-RPC → handler → response pipeline.
 *
 * Requirements:
 * - `pnpm build` must be run first (uses dist/index.js)
 * - Default Alchemy RPC must be reachable for integration calls
 *
 * Run only these: pnpm test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'index.js');

// Shared client for all tests — spawned once, reused across suites
let client: Client;
let transport: StdioClientTransport;

function parseToolResult(result: any): any {
  // MCP tool results come as { content: [{ type: 'text', text: '...' }] }
  const text = result.content?.[0]?.text;
  if (!text) throw new Error('Empty tool result');
  return JSON.parse(text);
}

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH],
    env: { ...process.env, LOG_LEVEL: 'error' },
  });

  client = new Client(
    { name: 'factor-mcp-test', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
}, 15000);

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // Server may already be closed
  }
});

// ─── Tool Discovery ──────────────────────────────────────────────────────────

describe('E2E: Tool Discovery (tools/list)', () => {
  let tools: any[];

  beforeAll(async () => {
    const response = await client.listTools();
    tools = response.tools;
  });

  it('returns a non-empty list of tools', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('returns at least 40 tools', () => {
    expect(tools.length).toBeGreaterThanOrEqual(40);
  });

  it('every tool has name, description, and inputSchema', () => {
    for (const tool of tools) {
      expect(tool.name, 'tool missing name').toBeTruthy();
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('contains core vault tools', () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('factor_get_config');
    expect(names).toContain('factor_set_chain');
    expect(names).toContain('factor_get_vault_info');
    expect(names).toContain('factor_create_vault');
    expect(names).toContain('factor_deposit');
    expect(names).toContain('factor_withdraw');
  });

  it('contains lending tools', () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('factor_lend_supply');
    expect(names).toContain('factor_lend_withdraw');
    expect(names).toContain('factor_lend_borrow');
    expect(names).toContain('factor_lend_repay');
  });

  it('contains swap tools', () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('factor_swap');
    expect(names).toContain('factor_swap_openocean');
    expect(names).toContain('factor_swap_pendle');
  });

  it('contains LP tools', () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('factor_lp_create_position');
    expect(names).toContain('factor_lp_add_liquidity');
    expect(names).toContain('factor_lp_remove_liquidity');
    expect(names).toContain('factor_lp_collect_fees');
  });

  it('contains yield/perp tools', () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('factor_gmx');
    expect(names).toContain('factor_pendle_lp');
    expect(names).toContain('factor_penpie');
  });

  it('contains strategy tools', () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('factor_list_adapters');
  });

  it('contains flashloan tool', () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('factor_flashloan');
  });

  it('has no duplicate tool names', () => {
    const names = tools.map((t: any) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ─── Config & Chain Tools ────────────────────────────────────────────────────

describe('E2E: Config & Chain (tools/call)', () => {
  it('factor_get_config returns runtime info', async () => {
    const result = await client.callTool({
      name: 'factor_get_config',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result);
    expect(data).toHaveProperty('runtime');
    expect(data.runtime).toHaveProperty('chain');
    expect(data.runtime).toHaveProperty('rpcUrl');
  });

  it('factor_set_chain switches to BASE and back', async () => {
    // Switch to BASE
    const toBase = await client.callTool({
      name: 'factor_set_chain',
      arguments: { chain: 'BASE' },
    });
    expect(toBase.isError).toBeFalsy();
    const baseData = parseToolResult(toBase);
    expect(baseData.currentChain).toBe('BASE');

    // Verify config reflects BASE
    const config = await client.callTool({
      name: 'factor_get_config',
      arguments: {},
    });
    const configData = parseToolResult(config);
    expect(configData.runtime.chain).toBe('BASE');

    // Switch back to ARBITRUM_ONE
    const toArb = await client.callTool({
      name: 'factor_set_chain',
      arguments: { chain: 'ARBITRUM_ONE' },
    });
    expect(toArb.isError).toBeFalsy();
    const arbData = parseToolResult(toArb);
    expect(arbData.currentChain).toBe('ARBITRUM_ONE');
  });
});

// ─── Adapter Registry ────────────────────────────────────────────────────────

describe('E2E: Adapter Registry (tools/call)', () => {
  it('factor_list_adapters returns adapters for ARBITRUM_ONE', async () => {
    const result = await client.callTool({
      name: 'factor_list_adapters',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result);
    expect(data.adapters.length).toBeGreaterThan(0);
    expect(data.chain).toBe('ARBITRUM_ONE');

    // Every adapter should support ARBITRUM_ONE
    for (const a of data.adapters) {
      expect(a.chains).toContain('ARBITRUM_ONE');
    }
  });

  it('factor_list_adapters filters by protocol', async () => {
    const result = await client.callTool({
      name: 'factor_list_adapters',
      arguments: { protocol: 'Aave' },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result);
    expect(data.adapters.length).toBeGreaterThan(0);
    for (const a of data.adapters) {
      const matches =
        a.protocol.toLowerCase().includes('aave') ||
        a.name.toLowerCase().includes('aave') ||
        a.id.toLowerCase().includes('aave');
      expect(matches).toBe(true);
    }
  });
});

// ─── Factory & Address Book ──────────────────────────────────────────────────

describe('E2E: Factory & Address Book (tools/call)', () => {
  it('factor_get_factory_addresses returns data', async () => {
    const result = await client.callTool({
      name: 'factor_get_factory_addresses',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
  }, 30000);

  it('factor_get_address_book returns SDK addresses', async () => {
    const result = await client.callTool({
      name: 'factor_get_address_book',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
  }, 30000);
});

// ─── Tokenlist ───────────────────────────────────────────────────────────────

describe('E2E: Tokenlist (tools/call)', () => {
  it('factor_get_lending_tokens returns aave tokens', async () => {
    const result = await client.callTool({
      name: 'factor_get_lending_tokens',
      arguments: { protocol: 'aave' },
    });

    expect(result.isError).toBeFalsy();
    const data = parseToolResult(result);
    expect(data).toBeDefined();
  }, 30000);
});

// ─── Error Handling ──────────────────────────────────────────────────────────

describe('E2E: Error Handling', () => {
  it('returns isError for invalid tool arguments', async () => {
    const result = await client.callTool({
      name: 'factor_lend_supply',
      arguments: {
        vaultAddress: 'not-an-address',
        protocol: 'aave',
        amount: '1000',
        assetAddress: '0x0000000000000000000000000000000000000001',
      },
    });

    // Server catches errors and returns them as { isError: true }
    expect(result.isError).toBe(true);
  });

  it('returns error for unknown tool', async () => {
    await expect(
      client.callTool({
        name: 'factor_nonexistent_tool',
        arguments: {},
      })
    ).rejects.toThrow();
  });
});
