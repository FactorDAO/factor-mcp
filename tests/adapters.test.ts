/**
 * Adapter Registry Tests
 *
 * Validates the comprehensive adapter registry in sdk/client.ts.
 * Ensures all adapters have required fields and chain filtering works.
 */
import { describe, it, expect } from 'vitest';
import { getKnownAdapters } from '../src/sdk/client.js';

const VALID_CHAINS = ['ARBITRUM_ONE', 'BASE', 'MAINNET'] as const;
const VALID_CATEGORIES = ['lending', 'dex', 'lp', 'yield', 'perp', 'flashloan', 'policy', 'automation'] as const;

describe('Adapter Registry', () => {
  const adapters = getKnownAdapters();

  it('has at least 25 adapters registered', () => {
    expect(adapters.length).toBeGreaterThanOrEqual(25);
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
    expect(lending.length).toBeGreaterThanOrEqual(4);
  });

  it('has dex adapters', () => {
    const dex = adapters.filter(a => a.category === 'dex');
    expect(dex.length).toBeGreaterThanOrEqual(3);
  });

  it('has lp adapters', () => {
    const lp = adapters.filter(a => a.category === 'lp');
    expect(lp.length).toBeGreaterThanOrEqual(3);
  });

  it('has yield adapters', () => {
    const y = adapters.filter(a => a.category === 'yield');
    expect(y.length).toBeGreaterThanOrEqual(3);
  });

  it('has flashloan adapters', () => {
    const fl = adapters.filter(a => a.category === 'flashloan');
    expect(fl.length).toBeGreaterThanOrEqual(2);
  });

  // --- Specific adapter checks ---
  const requiredAdapters: Record<string, { category: string; minActions: number }> = {
    aave: { category: 'lending', minActions: 8 },
    compoundV3: { category: 'lending', minActions: 5 },
    morpho: { category: 'lending', minActions: 10 },
    siloV2: { category: 'lending', minActions: 5 },
    uniswap: { category: 'dex', minActions: 3 },
    openOcean: { category: 'dex', minActions: 2 },
    pendlePy: { category: 'dex', minActions: 4 },
    uniswapV3Lp: { category: 'lp', minActions: 4 },
    camelotV3Lp: { category: 'lp', minActions: 4 },
    aerodromeLp: { category: 'lp', minActions: 4 },
    pendle: { category: 'yield', minActions: 3 },
    penpie: { category: 'yield', minActions: 4 },
    gmx: { category: 'perp', minActions: 3 },
    aaveFL: { category: 'flashloan', minActions: 1 },
    morphoFL: { category: 'flashloan', minActions: 1 },
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
    expect(arb.length).toBeGreaterThanOrEqual(20);
  });

  it('filters adapters by BASE', () => {
    const base = adapters.filter(a => a.chains.includes('BASE'));
    expect(base.length).toBeGreaterThanOrEqual(10);
  });

  it('camelotV3Lp is Arbitrum only', () => {
    const adapter = adapters.find(a => a.id === 'camelotV3Lp');
    expect(adapter?.chains).toEqual(['ARBITRUM_ONE']);
  });

  it('aerodromeLp is Base only', () => {
    const adapter = adapters.find(a => a.id === 'aerodromeLp');
    expect(adapter?.chains).toEqual(['BASE']);
  });

  // --- No Silo V1 (sunsetted) ---
  it('does NOT contain Silo V1 adapter (sunsetted)', () => {
    const silo = adapters.find(a => a.id === 'silo');
    expect(silo, 'Silo V1 is sunsetted and must not be in the registry').toBeUndefined();
  });
});
