/**
 * Integration Tests
 *
 * Tests read-only MCP tool handlers against real RPC.
 * These call actual handler functions to verify end-to-end tool behavior.
 *
 * Requirements:
 * - Default Alchemy RPC must be reachable (ARBITRUM_ONE)
 * - No wallet needed (read-only operations)
 *
 * Run only these: pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { allTools } from '../src/tools/index.js';

function getTool(name: string) {
  return (allTools as any[]).find(t => t.name === name);
}

describe('Integration: Config & Registry', () => {
  // Ensure we start on ARBITRUM_ONE
  beforeAll(async () => {
    const setChain = getTool('factor_set_chain');
    await setChain.handler({ chain: 'ARBITRUM_ONE' });
  });

  it('factor_get_config returns server config', async () => {
    const tool = getTool('factor_get_config');
    const result = await tool.handler({});
    // Response is nested under runtime.*
    expect(result).toHaveProperty('runtime');
    expect(result.runtime).toHaveProperty('chain');
    expect(result.runtime).toHaveProperty('rpcUrl');
    expect(result.runtime.chain).toBe('ARBITRUM_ONE');
  });

  it('factor_list_adapters returns adapters for current chain', async () => {
    const tool = getTool('factor_list_adapters');
    const result = await tool.handler({});
    expect(result.adapters.length).toBeGreaterThan(0);
    expect(result.chain).toBe('ARBITRUM_ONE');
    // Every returned adapter should support ARBITRUM_ONE
    for (const a of result.adapters) {
      expect(a.chains).toContain('ARBITRUM_ONE');
    }
  });

  it('factor_list_adapters filters by protocol', async () => {
    const tool = getTool('factor_list_adapters');
    const result = await tool.handler({ protocol: 'Aave' });
    expect(result.adapters.length).toBeGreaterThan(0);
    for (const a of result.adapters) {
      const matchesFilter =
        a.protocol.toLowerCase().includes('aave') ||
        a.name.toLowerCase().includes('aave') ||
        a.id.toLowerCase().includes('aave');
      expect(matchesFilter).toBe(true);
    }
  });

  it('factor_list_adapters filters by category', async () => {
    const tool = getTool('factor_list_adapters');
    const result = await tool.handler({ protocol: 'lending' });
    expect(result.adapters.length).toBeGreaterThan(0);
    for (const a of result.adapters) {
      expect(a.category).toBe('lending');
    }
  });
});

describe('Integration: Factory & Address Book', () => {
  it('factor_get_factory_addresses returns whitelisted data', async () => {
    const tool = getTool('factor_get_factory_addresses');
    const result = await tool.handler({});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  }, 30000);

  it('factor_get_address_book returns SDK addresses', async () => {
    const tool = getTool('factor_get_address_book');
    const result = await tool.handler({});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  }, 30000);
});

describe('Integration: Tokenlist', () => {
  it('factor_get_lending_tokens returns aave tokens', async () => {
    const tool = getTool('factor_get_lending_tokens');
    const result = await tool.handler({ protocol: 'aave' });
    expect(result).toBeDefined();
  }, 30000);
});

describe('Integration: Chain Switching', () => {
  it('factor_set_chain switches to BASE and back', async () => {
    const setChain = getTool('factor_set_chain');
    const getConfig = getTool('factor_get_config');

    // Switch to BASE
    const switchResult = await setChain.handler({ chain: 'BASE' });
    expect(switchResult.currentChain).toBe('BASE');

    const configBase = await getConfig.handler({});
    expect(configBase.runtime.chain).toBe('BASE');

    // Verify chain-aware adapter filtering on BASE
    const listAdapters = getTool('factor_list_adapters');
    const baseAdapters = await listAdapters.handler({});
    const aero = baseAdapters.adapters.find((a: any) => a.id === 'aerodromeLp');
    expect(aero).toBeDefined();
    const camelot = baseAdapters.adapters.find((a: any) => a.id === 'camelotV3Lp');
    expect(camelot).toBeUndefined();

    // Switch back
    await setChain.handler({ chain: 'ARBITRUM_ONE' });
    const configArb = await getConfig.handler({});
    expect(configArb.runtime.chain).toBe('ARBITRUM_ONE');
  });
});
