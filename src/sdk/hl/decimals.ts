// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// HyperLiquid decimal / wire-format converters.
//
// HL uses THREE different USDC scales plus a separate 1e8 CoreWriter wire
// format and a `markPx` precompile scale that depends on `szDecimals`.
// Getting any of these wrong silently drops the action on HL.

import { parseUnits } from 'viem';
import { HLPreflightError } from './types.js';

/// @notice HyperEVM USDC ERC-20 raw scale (6 decimals).
/// Example: `usdcEvm('1.50')` → 1_500_000n.
export const usdcEvm = (usd: string): bigint => parseUnits(usd, 6);

/// @notice HL perp ledger USDC raw scale (6 decimals, same as EVM USDC).
/// Kept as a separate name to make call-sites self-documenting.
export const usdcPerp = (usd: string): bigint => parseUnits(usd, 6);

/// @notice HL spot ledger USDC raw scale (8 decimals). The bridge layer
/// uses this representation.
/// Example: `usdcSpotWei('1.50')` → 150_000_000n.
export const usdcSpotWei = (usd: string): bigint => parseUnits(usd, 8);

/// @notice Convert a HL spot-ledger USDC value (8-dec) to a USDC perp /
/// EVM value (6-dec) via integer divide by 100. Used in NAV math.
export const spotWeiToEvm = (w: bigint): bigint => w / 100n;

/// @notice Convert a USDC EVM / perp value (6-dec) to a HL spot value
/// (8-dec). Multiply by 100. Used when bridging perp → spot → EVM.
export const evmToSpotWei = (w: bigint): bigint => w * 100n;

/// @notice Convert a real-world price into CoreWriter wire format
/// (realPrice × 1e8). Inputs that aren't finite positives are rejected
/// early so a `0` doesn't quietly turn into a denied order.
export function toWire1e8(real: number): bigint {
  if (!Number.isFinite(real) || real <= 0) {
    throw new HLPreflightError(
      'invalid-input',
      `toWire1e8: real must be a positive finite number (got ${real})`,
      { limitPxReal: real },
    );
  }
  return BigInt(Math.round(real * 1e8));
}

/// @notice Inverse of `toWire1e8`. JS `number` is good for 15 sig figs so
/// roundtripping a sane HL price (max ~$10^6) is safe.
export const wire1e8ToReal = (wire: bigint): number => Number(wire) / 1e8;

/// @notice Rescale a value read from the `MARK_PX` precompile
/// (`realPrice × 10^(6-szDecimals)`) into the CoreWriter wire scale
/// (1e8). Multiply by `10^(2 + szDec)`.
///
///   markPx_1e8 = markPxPrecompile × 10^(2 + szDecimals)
export function markToWire1e8(mark: bigint, szDec: number): bigint {
  assertSzDec(szDec);
  return mark * 10n ** BigInt(2 + szDec);
}

/// @notice Convert a precompile mark reading into a JS `number` real
/// price. Loses precision below 1e-9 USD; acceptable for SDK math.
export function markPxToReal(mark: bigint, szDec: number): number {
  assertSzDec(szDec);
  const scale = 10 ** (6 - szDec);
  return Number(mark) / scale;
}

/// @notice `sizeUsdToWire` is also exported from `tickMath` (single
/// canonical implementation lives there to keep tick + size math
/// co-located). Re-export here for callers that import from `decimals`.
export { sizeUsdToWire } from './tickMath.js';

/// @notice Convert a wire-format size (1e8 scale) into a real-units
/// size. Useful for UI display.
export const sizeWireToReal = (wire: bigint): number => Number(wire) / 1e8;

/// @notice Compute notional in 1e8 scale for a given wire-size and
/// wire-limit price: `(size × limit) / 1e8`. Mirrors the on-chain
/// `_checkMinNotional` formula exactly.
export function notional1e8(sizeWire: bigint, limitPxWire: bigint): bigint {
  return (sizeWire * limitPxWire) / 10n ** 8n;
}

function assertSzDec(szDec: number): void {
  if (!Number.isInteger(szDec) || szDec < 0 || szDec > 6) {
    throw new HLPreflightError(
      'invalid-input',
      `szDecimals must be an integer in [0, 6] (got ${szDec})`,
    );
  }
}

/// HL Exchange API canonical decimal-string format. Mirrors the
/// reference Python SDK:
///
///   `"{:.{dec}f}".format(x).rstrip("0").rstrip(".")`
///
/// i.e. format to `szDecimals` digits, strip trailing zeros, strip a
/// dangling decimal point. CRITICAL because the action is hashed via
/// msgpack and "0.10" vs "0.1" produce different byte sequences. HL's
/// reference encoder always emits the rstrip'd form; if the SDK sends
/// "0.10" the recovered agent address is garbage and HL rejects with
/// "User or API Wallet 0x… does not exist".
///
/// Examples:
///   hlFormatDecimal(0.10,   2) → "0.1"
///   hlFormatDecimal(0.0023, 4) → "0.0023"
///   hlFormatDecimal(1.00,   2) → "1"
///   hlFormatDecimal(10,     0) → "10"
///   hlFormatDecimal(10,     2) → "10"
export function hlFormatDecimal(n: number, szDecimals: number): string {
  const s = n.toFixed(szDecimals);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}
