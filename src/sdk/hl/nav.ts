// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Tri-ledger NAV reader for HL-enabled FACTOR vaults.
//
// A HyperLiquid vault carries USDC across three independent ledgers:
//   1. HyperEVM USDC ERC-20 (6-dec)  — settled-out, idle funds
//   2. HL spot ledger USDC (8-dec)   — bridge transit between perp & EVM
//   3. HL perp ledger equity (6-dec) — open positions + free margin
//
// `getNav()` reads all three in parallel, normalizes to USDC 6-dec and
// returns both the per-ledger and total figures so the caller can render
// a breakdown or just consume `totalUsdc` for share-price math.

import type { Address, PublicClient } from 'viem';

import { spotWeiToEvm } from './decimals.js';

/// Minimal ERC-20 ABI fragment for `balanceOf`. Inlined to avoid
/// depending on viem's `erc20Abi` (only added in v2.x; this package
/// still ships viem v1.21.x).
const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
import {
  readAccountMarginSummary,
  readSpotBalance,
} from './precompiles.js';
import { HL_USDC_SPOT_TOKEN_ID, type HLVaultNav } from './types.js';

/// @notice Read the tri-ledger NAV breakdown for `vault`.
///
/// All amounts are returned in USDC 6-dec (HyperEVM ERC-20 native scale).
/// `spotUsdc` is `(total - hold) / 100` so we report the *free* spot
/// balance (anything held against open spot orders is excluded). The
/// perp leg uses `accountMarginSummary.accountValue` directly, floored
/// at 0 to match the on-chain `HyperLiquidPositionAccounting` convention.
export async function getNav(args: {
  client: PublicClient;
  vault: Address;
  usdc: Address;
}): Promise<HLVaultNav> {
  const { client, vault, usdc } = args;

  const [evmUsdcRaw, spot, ams] = await Promise.all([
    client.readContract({
      address: usdc,
      abi: erc20BalanceOfAbi,
      functionName: 'balanceOf',
      args: [vault],
    }),
    readSpotBalance(client, vault, BigInt(HL_USDC_SPOT_TOKEN_ID)),
    readAccountMarginSummary(client, vault),
  ]);

  // `total` and `hold` are uint64s in spot 8-dec scale; subtract holds
  // for the free balance and rescale to 6-dec. `total >= hold` is a
  // protocol invariant — clamp anyway as a belt-and-suspenders measure.
  const spotFreeWei = spot.total > spot.hold ? spot.total - spot.hold : 0n;
  const spotUsdc = spotWeiToEvm(spotFreeWei);

  // `accountValue` is signed (int64) — equity can go briefly negative
  // mid-funding before liquidation closes the position. We floor at 0
  // for NAV reporting to match the adapter view.
  const perpEquity = ams.accountValue > 0n ? ams.accountValue : 0n;

  const evmUsdc = evmUsdcRaw as bigint;

  return {
    evmUsdc,
    spotUsdc,
    perpEquity,
    totalUsdc: evmUsdc + spotUsdc + perpEquity,
  };
}
