/**
 * Unit tests for create-vault asset-list resolution.
 *
 * Locks the auto-mirror + force-include-denominator behaviour that prevents
 * un-redeemable vaults (see `infra/debugs/withdraw-assets-audit.md`). 9 prod
 * vaults shipped with empty `withdrawAssets` before this fix.
 */
import { describe, it, expect } from 'vitest';
import { resolveVaultAssetLists } from '../src/tools/vault/create-vault.js';

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const WETH = '0x4200000000000000000000000000000000000006';

describe('resolveVaultAssetLists', () => {
  it('mirrors deposits into withdraw when withdraw is omitted', () => {
    const r = resolveVaultAssetLists({
      denominatorAddress: USDC,
      initialDepositAssetAddresses: [USDC, WETH],
    });
    expect(r.depositAssets).toEqual([USDC, WETH]);
    expect(r.withdrawAssets).toEqual([USDC, WETH]);
  });

  it('mirrors deposits into withdraw when withdraw is explicit empty', () => {
    const r = resolveVaultAssetLists({
      denominatorAddress: USDC,
      initialDepositAssetAddresses: [USDC, WETH],
      initialWithdrawAssetAddresses: [],
    });
    expect(r.withdrawAssets).toEqual([USDC, WETH]);
  });

  it('preserves explicit non-empty withdraw list when denominator is present', () => {
    const r = resolveVaultAssetLists({
      denominatorAddress: USDC,
      initialDepositAssetAddresses: [USDC, WETH],
      initialWithdrawAssetAddresses: [USDC],
    });
    expect(r.withdrawAssets).toEqual([USDC]);
  });

  it('force-includes denominator in withdraw when caller omits it', () => {
    const r = resolveVaultAssetLists({
      denominatorAddress: USDC,
      initialDepositAssetAddresses: [USDC, WETH],
      initialWithdrawAssetAddresses: [WETH],
    });
    expect(r.withdrawAssets[0].toLowerCase()).toBe(USDC);
    expect(r.withdrawAssets).toContain(WETH);
  });

  it('force-includes denominator in deposits when caller omits it', () => {
    const r = resolveVaultAssetLists({
      denominatorAddress: USDC,
      initialDepositAssetAddresses: [WETH],
    });
    expect(r.depositAssets[0].toLowerCase()).toBe(USDC);
    expect(r.depositAssets).toContain(WETH);
    expect(r.withdrawAssets).toEqual(r.depositAssets);
  });

  it('falls back to [denominator] when both deposits and assets are empty', () => {
    const r = resolveVaultAssetLists({ denominatorAddress: USDC });
    expect(r.depositAssets).toEqual([USDC]);
    expect(r.withdrawAssets).toEqual([USDC]);
  });

  it('uses initialAssetAddresses when initialDepositAssetAddresses is omitted', () => {
    const r = resolveVaultAssetLists({
      denominatorAddress: USDC,
      initialAssetAddresses: [USDC, WETH],
    });
    expect(r.depositAssets).toEqual([USDC, WETH]);
    expect(r.withdrawAssets).toEqual([USDC, WETH]);
  });

  it('is case-insensitive on the denominator dedupe check', () => {
    const r = resolveVaultAssetLists({
      denominatorAddress: USDC.toUpperCase(),
      initialDepositAssetAddresses: [USDC, WETH], // lowercase, same address
    });
    // Should not duplicate the denominator just because case differs
    expect(r.depositAssets.filter((a) => a.toLowerCase() === USDC).length).toBe(1);
  });
});
