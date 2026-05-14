// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// HyperLiquid tick-alignment math.
//
// HL silently drops orders whose limit price violates:
//   - ≤ 5 significant figures, AND
//   - ≤ max(0, 6 − szDecimals) decimal places.
// Integer prices are always allowed.
//
// On-chain enforcement is gas-prohibitive (sig-fig math); the adapter does
// NOT check. This module is the canonical SDK-side rounding helper.

import { HLPreflightError } from './types.js';

/// @notice Round a real-world price to the nearest HL-legal tick for the
/// given `szDecimals` value. Pure / deterministic / dependency-free.
///
/// Algorithm:
///   1. clamp to max(0, 6 - szDec) decimal places first;
///   2. if result ≥ 10^5, snap to integer (sig-fig budget exhausted);
///   3. else allow min(maxDec, 5 - intDigits) further decimals.
///
/// Reference vectors (from DESIGN.md §2):
///   tickRound(2256.789, 4) === 2256.8
///   tickRound(22.5678,  2) === 22.568
///   tickRound(80123.45, 5) === 80123
///   tickRound(0.001234, 2) === 0.0012
///   tickRound(1.23456,  6) === 1
export function tickRound(realPrice: number, szDecimals: number): number {
  if (!Number.isFinite(realPrice) || realPrice <= 0) {
    throw new HLPreflightError(
      'invalid-input',
      `tickRound: price must be a positive finite number (got ${realPrice})`,
      { limitPxReal: realPrice },
    );
  }
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 6) {
    throw new HLPreflightError(
      'invalid-input',
      `tickRound: szDecimals must be an integer in [0, 6] (got ${szDecimals})`,
    );
  }

  const maxDec = Math.max(0, 6 - szDecimals);

  // Once we cross the 5-sig-fig integer ceiling, sig figs dominate and we
  // must integer-snap regardless of `szDecimals`.
  if (realPrice >= 1e5) return Math.round(realPrice);

  // Compute the tighter of: maxDec ceiling and sig-fig ceiling.
  // intDigits = number of digits left of the decimal point of realPrice.
  // sigFigDec = max decimal places allowed by the 5-sig-fig budget given
  // how many digits the integer part already consumes.
  const intDigits = realPrice >= 1
    ? Math.floor(Math.log10(realPrice)) + 1
    : 1;
  const sigFigDec = Math.max(0, 5 - intDigits);
  const allowedDec = Math.min(maxDec, sigFigDec);

  // SINGLE-SHOT rounding to the final precision. Doing two sequential rounds
  // (first to maxDec, then to allowedDec) drifts via the intermediate
  // half-up snap — e.g. 80123.45 with szDec=5 rounds to 80123.5 first
  // (half-up), then to 80124 — but the closer integer is actually 80123.
  const scale = 10 ** allowedDec;
  return Math.round(realPrice * scale) / scale;
}

/// @notice Throws if `realPrice` would not survive `tickRound` unchanged.
/// Use to validate caller-supplied limit prices before submission.
/// @dev We require STRICT alignment (rounded === realPrice up to FP eps) —
/// a price within half-a-tick of a legal price is still off-tick and would
/// be silent-dropped by HL.
export function validateTick(realPrice: number, szDecimals: number): void {
  const rounded = tickRound(realPrice, szDecimals);
  // 4 × Number.EPSILON × |price| covers IEEE 754 representation slack on
  // the rounded/realPrice pair without admitting any visible misalignment.
  const eps = Math.max(Math.abs(realPrice), 1) * Number.EPSILON * 4;
  if (Math.abs(rounded - realPrice) > eps) {
    throw new HLPreflightError(
      'tick',
      `price ${realPrice} is not tick-aligned for szDecimals=${szDecimals} (nearest legal tick: ${rounded})`,
      { limitPxReal: realPrice },
    );
  }
}

/// @notice Snap a USD-notional buy size to the nearest valid lot (in HL
/// wire format, 1e8 scale). Lot step = `10^(8 - szDecimals)` wire units.
///
/// `markReal` is the current mark price in real USD. We compute the raw
/// wire size as `(usd / markReal) × 1e8`, then truncate to the nearest
/// lot floor.
export function sizeUsdToWire(
  usd: number,
  markReal: number,
  szDecimals: number,
): bigint {
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new HLPreflightError(
      'invalid-input',
      `sizeUsdToWire: usd must be a positive finite number (got ${usd})`,
    );
  }
  if (!Number.isFinite(markReal) || markReal <= 0) {
    throw new HLPreflightError(
      'invalid-input',
      `sizeUsdToWire: markReal must be a positive finite number (got ${markReal})`,
    );
  }
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 8) {
    throw new HLPreflightError(
      'invalid-input',
      `sizeUsdToWire: szDecimals must be an integer in [0, 8] (got ${szDecimals})`,
    );
  }
  const lotStep = 10n ** BigInt(8 - szDecimals);
  const raw = BigInt(Math.round((usd / markReal) * 1e8));
  return (raw / lotStep) * lotStep;
}

/// @notice Compute an aggressive, tick-aligned IOC limit price guaranteed
/// to clear HL's 10% oracle band AND stay inside the 30% slippage cap.
///
/// `bandBps` defaults to 1200 (12%) — comfortably above the 1000 bps HL
/// floor and well below the 3000 bps adapter cap so it survives a few
/// percent of mid-flight drift.
export function alignIocLimit(
  markReal: number,
  isBuy: boolean,
  szDecimals: number,
  bandBps = 1200,
): number {
  if (!Number.isFinite(markReal) || markReal <= 0) {
    throw new HLPreflightError(
      'invalid-input',
      `alignIocLimit: markReal must be a positive finite number (got ${markReal})`,
    );
  }
  const k = 1 + (isBuy ? 1 : -1) * (bandBps / 10_000);
  const raw = markReal * k;
  return tickRound(raw, szDecimals);
}
