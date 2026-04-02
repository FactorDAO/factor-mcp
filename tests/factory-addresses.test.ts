/**
 * Factory Addresses — Accounting Filter Tests
 *
 * Verifies that factor_get_factory_addresses filters out stale accounting
 * adapters from the subgraph, keeping only those present in the current
 * SDK address book.
 *
 * Run: pnpm vitest tests/factory-addresses.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { allTools } from '../src/tools/index.js';
import { getContractAddressesForChainOrThrow } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';
import { configManager } from '../src/config/index.js';

function getTool(name: string) {
  return (allTools as any[]).find((t) => t.name === name);
}

const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('Factory Addresses: accounting filter (Base)', () => {
  let currentAccounting: Set<string>;

  beforeAll(async () => {
    const setChain = getTool('factor_set_chain');
    await setChain.handler({ chain: 'BASE' });

    const environment = configManager.getEnvironment();
    const contracts = getContractAddressesForChainOrThrow(ChainId.BASE, environment);
    currentAccounting = new Set<string>();
    for (const [key, value] of Object.entries(contracts as Record<string, any>)) {
      if (key.includes('accounting') && typeof value === 'string' && value !== '') {
        currentAccounting.add(value.toLowerCase());
      }
    }
  });

  it('WETH returns exactly one entry with current accounting', async () => {
    const tool = getTool('factor_get_factory_addresses');
    const result = await tool.handler({ search: BASE_WETH });

    expect(result.success).toBe(true);
    const wethAssets = result.assets.filter(
      (a: any) => a.asset.toLowerCase() === BASE_WETH.toLowerCase(),
    );

    expect(wethAssets.length).toBe(1);
    expect(currentAccounting.has(wethAssets[0].accounting.toLowerCase())).toBe(true);
  });

  it('USDC returns exactly one entry with current accounting', async () => {
    const tool = getTool('factor_get_factory_addresses');
    const result = await tool.handler({ search: BASE_USDC });

    expect(result.success).toBe(true);
    const usdcAssets = result.assets.filter(
      (a: any) => a.asset.toLowerCase() === BASE_USDC.toLowerCase(),
    );

    expect(usdcAssets.length).toBe(1);
    expect(currentAccounting.has(usdcAssets[0].accounting.toLowerCase())).toBe(true);
  });

  it('full list has no stale accounting addresses', async () => {
    const tool = getTool('factor_get_factory_addresses');
    const result = await tool.handler({});

    expect(result.success).toBe(true);
    for (const asset of result.assets) {
      expect(currentAccounting.has(asset.accounting.toLowerCase())).toBe(true);
    }
    for (const debt of result.debts) {
      expect(currentAccounting.has(debt.accounting.toLowerCase())).toBe(true);
    }
  });

  it('Aave aToken (aWETH) keeps aave accounting', async () => {
    const tool = getTool('factor_get_factory_addresses');
    const result = await tool.handler({});

    const environment = configManager.getEnvironment();
    const contracts = getContractAddressesForChainOrThrow(ChainId.BASE, environment);
    const aaveAccounting = (contracts as any).factor_aave_accounting_adapter_pro?.toLowerCase();

    if (aaveAccounting) {
      const aaveAssets = result.assets.filter(
        (a: any) => a.accounting.toLowerCase() === aaveAccounting,
      );
      expect(aaveAssets.length).toBeGreaterThan(0);
    }
  });
});
