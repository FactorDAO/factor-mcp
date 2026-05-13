import { describe, expect, it } from 'vitest';
import { shareAssets } from '../src/tools/vault/morpho-onchain.js';

describe('Morpho vault analytics helpers', () => {
  it('converts Morpho supply shares with stored on-chain market totals', () => {
    const supplyShares = 92034423554544n;
    const totalSupplyAssets = 1374207274720n;
    const totalSupplyShares = 1216605532774725949n;

    const assets = shareAssets(
      supplyShares,
      totalSupplyAssets,
      totalSupplyShares,
    );

    expect(assets).toBe(103956764n);
  });

  it('returns zero when market shares are zero', () => {
    expect(shareAssets(1n, 100n, 0n)).toBe(0n);
  });
});
