/**
 * Adapter Registry Tests
 *
 * Validates the comprehensive adapter registry in sdk/client.ts.
 * Ensures all adapters have required fields and chain filtering works.
 * Updated to reflect production address book reality (SDK v2.1.16).
 */
import { describe, it, expect } from 'vitest';
import { getKnownAdapters } from '../src/sdk/client.js';

const VALID_CHAINS = ['ARBITRUM_ONE', 'BASE', 'MAINNET'] as const;
const VALID_CATEGORIES = ['lending', 'dex', 'lp', 'yield', 'flashloan', 'policy', 'automation'] as const;

describe('Adapter Registry', () => {
  const adapters = getKnownAdapters();

  it('has at least 12 adapters registered', () => {
    expect(adapters.length).toBeGreaterThanOrEqual(12);
  });

  it('no duplicate adapter IDs', () => {
    const ids = adapters.map(a => a.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('every adapter has all required fields', () => {
    for (const a of adapters) {
      expect(a.id, `adapter missing id`).toBeTruthy();
      expect(a.name, `${a.id}: missing name`).toBeTruthy();
      expect(a.protocol, `${a.id}: missing protocol`).toBeTruthy();
      expect(a.description, `${a.id}: missing description`).toBeTruthy();
      expect(a.supportedActions.length, `${a.id}: no supportedActions`).toBeGreaterThan(0);
      expect(a.chains.length, `${a.id}: no chains`).toBeGreaterThan(0);
      expect(VALID_CATEGORIES, `${a.id}: invalid category "${a.category}"`).toContain(a.category);
      for (const chain of a.chains) {
        expect(VALID_CHAINS, `${a.id}: invalid chain "${chain}"`).toContain(chain);
      }
    }
  });

  // --- Category coverage ---
  it('has lending adapters', () => {
    const lending = adapters.filter(a => a.category === 'lending');
    expect(lending.length).toBeGreaterThanOrEqual(3);
  });

  it('has dex adapters', () => {
    const dex = adapters.filter(a => a.category === 'dex');
    expect(dex.length).toBeGreaterThanOrEqual(3);
  });

  it('has lp adapters', () => {
    const lp = adapters.filter(a => a.category === 'lp');
    expect(lp.length).toBeGreaterThanOrEqual(1);
  });

  it('has yield adapters', () => {
    const y = adapters.filter(a => a.category === 'yield');
    expect(y.length).toBeGreaterThanOrEqual(1);
  });

  it('has flashloan adapters', () => {
    const fl = adapters.filter(a => a.category === 'flashloan');
    expect(fl.length).toBeGreaterThanOrEqual(1);
  });

  // --- Specific adapter checks (only adapters with deployed pro addresses) ---
  const requiredAdapters: Record<string, { category: string; minActions: number }> = {
    aave: { category: 'lending', minActions: 8 },
    compoundV3: { category: 'lending', minActions: 5 },
    morpho: { category: 'lending', minActions: 10 },
    uniswap: { category: 'dex', minActions: 3 },
    openOcean: { category: 'dex', minActions: 2 },
    pendlePy: { category: 'dex', minActions: 4 },
    uniswapV3Lp: { category: 'lp', minActions: 4 },
    pendle: { category: 'yield', minActions: 3 },
    balancerFL: { category: 'flashloan', minActions: 1 },
  };

  for (const [id, spec] of Object.entries(requiredAdapters)) {
    it(`adapter "${id}" is registered with correct category and actions`, () => {
      const adapter = adapters.find(a => a.id === id);
      expect(adapter, `Missing required adapter: ${id}`).toBeDefined();
      expect(adapter!.category).toBe(spec.category);
      expect(adapter!.supportedActions.length).toBeGreaterThanOrEqual(spec.minActions);
    });
  }

  // --- Chain filtering ---
  it('filters adapters by ARBITRUM_ONE', () => {
    const arb = adapters.filter(a => a.chains.includes('ARBITRUM_ONE'));
    expect(arb.length).toBeGreaterThanOrEqual(8);
  });

  it('filters adapters by BASE', () => {
    const base = adapters.filter(a => a.chains.includes('BASE'));
    expect(base.length).toBeGreaterThanOrEqual(6);
  });

  it('filters adapters by MAINNET', () => {
    const eth = adapters.filter(a => a.chains.includes('MAINNET'));
    expect(eth.length).toBeGreaterThanOrEqual(8);
  });

  // --- Morpho is Base + Ethereum only (no pro adapter on Arbitrum) ---
  it('morpho does NOT include ARBITRUM_ONE', () => {
    const adapter = adapters.find(a => a.id === 'morpho');
    expect(adapter?.chains).not.toContain('ARBITRUM_ONE');
  });

  // --- Uniswap V3 LP is Ethereum only for pro adapter ---
  it('uniswapV3Lp is Ethereum only', () => {
    const adapter = adapters.find(a => a.id === 'uniswapV3Lp');
    expect(adapter?.chains).toEqual(['MAINNET']);
  });

  // --- Removed adapters should NOT be in registry ---
  const removedAdapters = ['gmx', 'gns', 'glpV2', 'penpie', 'pirex', 'umami', 'yieldVault', 'aaveFL', 'morphoFL', 'camelotV3Lp', 'aerodromeLp', 'aqua', 'silo', 'siloV2', 'tender', 'lodestar'];
  for (const id of removedAdapters) {
    it(`removed adapter "${id}" is NOT in the registry`, () => {
      const adapter = adapters.find(a => a.id === id);
      expect(adapter, `${id} should not be in the registry (no deployed pro adapter)`).toBeUndefined();
    });
  }
});
