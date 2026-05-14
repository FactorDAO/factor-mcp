// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// SDK-side preflight validators for HyperLiquid actions.
//
// The on-chain adapter reverts on most of these too, but its reverts are
// opaque-selector and only fire AFTER a tx is broadcast. SDK-side checks
// give callers fast structured feedback before paying any gas.
//
// Every validator throws `HLPreflightError(kind, message, details)`.
// MCP / Studio UI consumers branch on `.kind` to render structurally.

import type { Address } from 'viem';

import { tickRound } from './tickMath.js';
import {
  HL_IOC_MIN_BAND_BPS,
  HL_MAX_ACTIVE_PERPS,
  HL_MAX_PENDING_CLOIDS,
  HL_MAX_SLIPPAGE_BPS,
  HL_MIN_NOTIONAL_USD,
  HL_USDC_SPOT_TOKEN_ID,
  HLPreflightError,
} from './types.js';

// ---------------------------------------------------------------------------
// 1. Min notional
// ---------------------------------------------------------------------------

/// @notice HL silently drops orders below $10 USD notional. Mirror the
/// adapter formula exactly: `(sizeWire × limitPxWire) / 1e8` in
/// 1e8-scaled USD must be ≥ 10 × 1e8.
export function checkMinNotional(args: {
  sizeWire: bigint;
  limitPxWire: bigint;
}): void {
  const notional1e8 = (args.sizeWire * args.limitPxWire) / 10n ** 8n;
  const min1e8 = BigInt(HL_MIN_NOTIONAL_USD) * 10n ** 8n;
  if (notional1e8 < min1e8) {
    throw new HLPreflightError(
      'min-notional',
      `order notional ${Number(notional1e8) / 1e8} USD is below HL minimum of ${HL_MIN_NOTIONAL_USD} USD`,
      {
        notionalUsd: Number(notional1e8) / 1e8,
        minNotionalUsd: HL_MIN_NOTIONAL_USD,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Tick alignment
// ---------------------------------------------------------------------------

/// @notice Caller-supplied `limitPxReal` must equal `tickRound(.., szDec)`.
/// Anything else gets silently dropped by HL (no event, no fill).
export function checkTick(args: {
  limitPxReal: number;
  szDecimals: number;
}): void {
  const rounded = tickRound(args.limitPxReal, args.szDecimals);
  // Half-a-tick tolerance — anything closer than that IS the same tick.
  const tickSize = 10 ** -Math.max(0, 6 - args.szDecimals);
  if (Math.abs(rounded - args.limitPxReal) > tickSize / 2) {
    throw new HLPreflightError(
      'tick',
      `price ${args.limitPxReal} is not tick-aligned for szDecimals=${args.szDecimals} (nearest legal tick: ${rounded})`,
      { limitPxReal: args.limitPxReal },
    );
  }
}

// ---------------------------------------------------------------------------
// 3. IOC oracle-band
// ---------------------------------------------------------------------------

/// @notice For IOC orders, HL silently drops if the limit price is
/// inside the ~10% oracle band. Enforce ≥10% aggressive deviation on the
/// buy side (limit ≥ mark × 1.10) and sell side (limit ≤ mark × 0.90).
export function checkIocBand(args: {
  limitPxReal: number;
  markReal: number;
  isBuy: boolean;
  bandBps?: number;
}): void {
  const bandBps = args.bandBps ?? HL_IOC_MIN_BAND_BPS;
  const minDelta = (args.markReal * bandBps) / 10_000;
  if (args.isBuy) {
    if (args.limitPxReal < args.markReal + minDelta) {
      throw new HLPreflightError(
        'ioc-band',
        `IOC buy limit ${args.limitPxReal} must be ≥ mark+${bandBps}bps (${args.markReal + minDelta})`,
        {
          limitPxReal: args.limitPxReal,
          markReal: args.markReal,
          side: 'long',
          deviationBps: bandBps,
        },
      );
    }
  } else {
    if (args.limitPxReal > args.markReal - minDelta) {
      throw new HLPreflightError(
        'ioc-band',
        `IOC sell limit ${args.limitPxReal} must be ≤ mark-${bandBps}bps (${args.markReal - minDelta})`,
        {
          limitPxReal: args.limitPxReal,
          markReal: args.markReal,
          side: 'short',
          deviationBps: bandBps,
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Slippage cap (mirrors adapter MAX_SLIPPAGE_BPS = 3000)
// ---------------------------------------------------------------------------

/// @notice `|limit − mark| / mark` must be ≤ MAX_SLIPPAGE_BPS (default
/// 3000 = 30%). Matches the adapter `_checkSlippage` guard.
export function checkSlippage(args: {
  limitPxReal: number;
  markReal: number;
  maxBps?: number;
}): void {
  const maxBps = args.maxBps ?? HL_MAX_SLIPPAGE_BPS;
  if (args.markReal <= 0) {
    throw new HLPreflightError(
      'slippage',
      `mark price must be > 0 (got ${args.markReal})`,
      { markReal: args.markReal },
    );
  }
  const diff = Math.abs(args.limitPxReal - args.markReal);
  const bps = (diff / args.markReal) * 10_000;
  if (bps > maxBps) {
    throw new HLPreflightError(
      'slippage',
      `|limit-mark|/mark = ${bps.toFixed(2)}bps exceeds max ${maxBps}bps`,
      {
        limitPxReal: args.limitPxReal,
        markReal: args.markReal,
        deviationBps: Math.round(bps),
        maxDeviationBps: maxBps,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Agent freshness
// ---------------------------------------------------------------------------

/// @notice Before calling `addApiWallet(agent, name)`, the agent EOA
/// MUST have `coreUserExists == false`. HL silently drops action 9 if
/// the agent already has its own HL identity.
export function checkAgentFresh(args: {
  agent: Address;
  exists: boolean;
}): void {
  if (args.exists) {
    throw new HLPreflightError(
      'agent-not-fresh',
      `agent ${args.agent} already has an HL identity — HL silently drops addApiWallet for known users`,
      { agent: args.agent },
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Bridge token whitelist
// ---------------------------------------------------------------------------

/// @notice `bridgeSpotToEvm` only handles USDC (token id 0). HYPE and
/// other tokens have non-trivial system addresses; bridging them via
/// this path orphans funds at a dead address.
export function checkBridgeToken(args: { token: number | bigint }): void {
  const id = typeof args.token === 'bigint' ? args.token : BigInt(args.token);
  if (id !== BigInt(HL_USDC_SPOT_TOKEN_ID)) {
    throw new HLPreflightError(
      'bridge-token',
      `bridgeSpotToEvm only supports USDC (token id 0); got ${id}`,
      { tokenId: Number(id) },
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Pending-cap & active-cap
// ---------------------------------------------------------------------------

/// @notice Adapter caps pending cloids at `MAX_PENDING_CLOIDS` (default
/// 32). Beyond that every new order reverts with
/// `HL__MaxPendingCloidsExceeded`.
export function checkPendingCap(args: {
  pendingCount: number;
  cap?: number;
}): void {
  const cap = args.cap ?? HL_MAX_PENDING_CLOIDS;
  if (args.pendingCount >= cap) {
    throw new HLPreflightError(
      'pending-cap',
      `pending cloids cap reached (${args.pendingCount}/${cap}); settle or cancel before submitting new orders`,
      { pendingCount: args.pendingCount, cap },
    );
  }
}

/// @notice Opening a new perp index needs room in `activePerpIndices`
/// (default cap 16). Checked when `isNewPerp` is true (perp not already
/// registered in the active set).
export function checkActiveCap(args: {
  activeCount: number;
  isNewPerp: boolean;
  cap?: number;
}): void {
  if (!args.isNewPerp) return;
  const cap = args.cap ?? HL_MAX_ACTIVE_PERPS;
  if (args.activeCount >= cap) {
    throw new HLPreflightError(
      'active-cap',
      `active perp cap reached (${args.activeCount}/${cap}); close a position before opening a new market`,
      { activeCount: args.activeCount, cap },
    );
  }
}

// ---------------------------------------------------------------------------
// 8. Balance preconditions
// ---------------------------------------------------------------------------

/// @notice Generic enough-balance check. `kind` is a free-form short
/// label ("evm-usdc", "spot-usdc", "perp-withdrawable", …) reported back
/// as part of the error details for caller formatting.
export function checkSufficientBalance(args: {
  required: bigint;
  available: bigint;
  label?: string;
}): void {
  if (args.required <= 0n) {
    throw new HLPreflightError(
      'invalid-input',
      `balance check: required must be > 0 (got ${args.required})`,
    );
  }
  if (args.available < args.required) {
    const lbl = args.label ?? 'balance';
    throw new HLPreflightError(
      'balance',
      `insufficient ${lbl}: required ${args.required}, available ${args.available}`,
      { required: args.required, available: args.available },
    );
  }
}

// ---------------------------------------------------------------------------
// Composite validators (handy entry points for the HLVault layer)
// ---------------------------------------------------------------------------

/// @notice Run the full pre-flight chain for an `openPosition` IOC.
/// Throws on the first failure. Skips checks for which the caller has no
/// data — e.g. omit `markReal` to skip slippage + ioc-band when running
/// in a degraded-precompile environment.
export function preflightOpenPosition(args: {
  sizeWire: bigint;
  limitPxWire: bigint;
  limitPxReal: number;
  szDecimals: number;
  isBuy: boolean;
  markReal?: number;
  pendingCount: number;
  activeCount: number;
  isNewPerp: boolean;
  bandBps?: number;
}): void {
  checkMinNotional({ sizeWire: args.sizeWire, limitPxWire: args.limitPxWire });
  checkTick({ limitPxReal: args.limitPxReal, szDecimals: args.szDecimals });
  if (typeof args.markReal === 'number') {
    checkSlippage({ limitPxReal: args.limitPxReal, markReal: args.markReal });
    checkIocBand({
      limitPxReal: args.limitPxReal,
      markReal: args.markReal,
      isBuy: args.isBuy,
      bandBps: args.bandBps,
    });
  }
  checkPendingCap({ pendingCount: args.pendingCount });
  checkActiveCap({
    activeCount: args.activeCount,
    isNewPerp: args.isNewPerp,
  });
}

/// @notice Pre-flight for `placeOrder` — the IOC-band guard is skipped
/// for ALO/GTC TIFs (HL only enforces the oracle band on IOC).
export function preflightPlaceOrder(args: {
  sizeWire: bigint;
  limitPxWire: bigint;
  limitPxReal: number;
  szDecimals: number;
  isBuy: boolean;
  isIoc: boolean;
  markReal?: number;
  pendingCount: number;
  activeCount: number;
  isNewPerp: boolean;
  bandBps?: number;
}): void {
  checkMinNotional({ sizeWire: args.sizeWire, limitPxWire: args.limitPxWire });
  checkTick({ limitPxReal: args.limitPxReal, szDecimals: args.szDecimals });
  if (typeof args.markReal === 'number') {
    checkSlippage({ limitPxReal: args.limitPxReal, markReal: args.markReal });
    if (args.isIoc) {
      checkIocBand({
        limitPxReal: args.limitPxReal,
        markReal: args.markReal,
        isBuy: args.isBuy,
        bandBps: args.bandBps,
      });
    }
  }
  checkPendingCap({ pendingCount: args.pendingCount });
  checkActiveCap({
    activeCount: args.activeCount,
    isNewPerp: args.isNewPerp,
  });
}
