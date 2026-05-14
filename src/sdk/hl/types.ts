// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// HyperLiquid SDK shared types.
//
// All numeric fields documented as "1e8" use HyperCore's CoreWriter wire
// format (realValue × 10^8). Fields documented as "6-dec" are USDC raw
// (HyperEVM ERC-20 / HL perp ledger native scale). Fields documented as
// "8-dec" are HL spot ledger USDC scale.

import type { Address, Hex } from 'viem';

// ---------------------------------------------------------------------------
// Perp symbol map
// ---------------------------------------------------------------------------

/// @notice Curated subset of HL perp symbols whose index is hardcoded for
/// fast SDK paths. Anything outside this list is resolved at boot via the
/// `PerpAssetInfo` precompile and cached. Indices verified on mainnet
/// 2026-05-13.
export const PERP_INDEX: Readonly<Record<string, number>> = Object.freeze({
  BTC: 0,
  ETH: 1,
  ATOM: 2,
  MATIC: 3,
  DYDX: 4,
  SOL: 5,
  AVAX: 6,
  BNB: 7,
  APE: 8,
  OP: 9,
  LTC: 10,
  ARB: 11,
  DOGE: 12,
  INJ: 13,
  SUI: 14,
  kPEPE: 15,
});

export type PerpSymbol = keyof typeof PERP_INDEX;

// ---------------------------------------------------------------------------
// Trade primitives
// ---------------------------------------------------------------------------

/// @notice Position direction in the trade-result domain.
export type Side = 'long' | 'short';

/// @notice Time-in-force enum (HL CoreWriter action 1 `tif` byte).
///   1 = ALO (post-only, rests on book)
///   2 = GTC (rests until cancel)
///   3 = IOC (immediate-or-cancel, market-like with limit cap)
export const ORDER_TIF = {
  ALO: 1,
  GTC: 2,
  IOC: 3,
} as const;
export type OrderTif = (typeof ORDER_TIF)[keyof typeof ORDER_TIF];

/// @notice Margin mode for an HL position.
export type MarginMode = 'cross' | 'isolated';

// ---------------------------------------------------------------------------
// Precompile result shapes (mirror HLTypes.sol)
// ---------------------------------------------------------------------------

export interface HLPosition {
  /// Signed contract size in HL native units (× 10^szDecimals). Positive
  /// = long, negative = short.
  szi: bigint;
  /// Notional value at entry (USDC, 6-dec).
  entryNtl: bigint;
  /// Raw isolated margin attributed to this position (USDC, 6-dec).
  isolatedRawUsd: bigint;
  /// Effective leverage (integer).
  leverage: number;
  /// True if margin mode is isolated; false if cross.
  isIsolated: boolean;
}

export interface HLSpotBalance {
  /// Total balance (HL wei, token-native).
  total: bigint;
  /// Portion currently locked in resting orders.
  hold: bigint;
  /// Cost basis notional.
  entryNtl: bigint;
}

/// @notice Aggregated margin state — single source of truth for perp NAV.
/// All amounts in USDC 6-dec. `accountValue` is signed; the rest are not.
export interface AccountMarginSummary {
  /// Total perp account equity (USDC, 6-dec), signed — sum of cross &
  /// isolated equity including unrealized PnL.
  accountValue: bigint;
  /// Total initial margin currently locked across all positions (6-dec).
  marginUsed: bigint;
  /// Total notional exposure across all positions (6-dec).
  ntlPos: bigint;
  /// Signed raw USDC balance on the perp ledger.
  rawUsd: bigint;
}

export interface PerpAssetInfo {
  /// Ticker, e.g. "ETH".
  coin: string;
  /// HL margin tier identifier.
  marginTableId: number;
  /// Decimals for contract size; price scale is 10^(6-szDecimals).
  szDecimals: number;
  /// Maximum leverage allowed for this market.
  maxLeverage: number;
  /// If true, only isolated margin mode is permitted.
  onlyIsolated: boolean;
}

// ---------------------------------------------------------------------------
// HL Exchange API signed-action plumbing
// ---------------------------------------------------------------------------

/// @notice Wire-format envelope for an EIP-712 signed HL Exchange API
/// request. `nonce` is a millisecond timestamp; `vaultAddress` makes HL
/// apply the action against the vault's HL identity instead of the
/// signer's own.
export interface SignedHlAction<TAction = unknown> {
  action: TAction;
  signature: { r: Hex; s: Hex; v: number };
  nonce: number;
  vaultAddress?: Address;
}

/// @notice Response envelope from `https://api.hyperliquid.xyz/exchange`.
/// Discriminated by `status`.
export type HlExchangeResponse =
  | { status: 'ok'; response: unknown }
  | { status: 'err'; response: string };

// ---------------------------------------------------------------------------
// SDK-side preflight errors
// ---------------------------------------------------------------------------

/// @notice Discriminated union of every SDK-side preflight failure. MCP /
/// UI consumers branch on `.kind` to render structurally rather than
/// stringifying.
export type HLPreflightErrorKind =
  | 'min-notional'
  | 'tick'
  | 'ioc-band'
  | 'slippage'
  | 'agent-not-fresh'
  | 'bridge-token'
  | 'pending-cap'
  | 'active-cap'
  | 'balance'
  | 'unknown-perp'
  | 'invalid-input';

export interface HLPreflightErrorDetails {
  readonly limitPxReal?: number;
  readonly markReal?: number;
  readonly notionalUsd?: number;
  readonly minNotionalUsd?: number;
  readonly deviationBps?: number;
  readonly maxDeviationBps?: number;
  readonly side?: Side;
  readonly perp?: string | number;
  readonly tokenId?: number;
  readonly pendingCount?: number;
  readonly activeCount?: number;
  readonly cap?: number;
  readonly required?: bigint;
  readonly available?: bigint;
  readonly agent?: Address;
}

/// @notice Rich, structured preflight failure. Thrown by `preflight.*`
/// validators and any HL SDK entry point that delegates to them.
export class HLPreflightError extends Error {
  public readonly kind: HLPreflightErrorKind;
  public readonly details: HLPreflightErrorDetails;

  constructor(
    kind: HLPreflightErrorKind,
    message: string,
    details: HLPreflightErrorDetails = {},
  ) {
    super(message);
    this.name = 'HLPreflightError';
    this.kind = kind;
    this.details = details;
    // Preserve prototype chain when transpiled to ES5.
    Object.setPrototypeOf(this, HLPreflightError.prototype);
  }
}

// ---------------------------------------------------------------------------
// NAV
// ---------------------------------------------------------------------------

/// @notice Tri-ledger NAV breakdown for a HyperLiquid-enabled vault.
/// Every amount is in USDC 6-dec, matching the on-chain accounting.
export interface HLVaultNav {
  /// HyperEVM USDC ERC-20 balance.
  evmUsdc: bigint;
  /// HL spot-ledger USDC, converted from 8-dec to 6-dec via /100n.
  spotUsdc: bigint;
  /// HL perp-ledger account equity (floor 0), from `perpEquityUsdc(vault)`.
  perpEquity: bigint;
  /// Sum of the three above.
  totalUsdc: bigint;
}

// ---------------------------------------------------------------------------
// Limits (HL platform constants — keep in sync with the adapter)
// ---------------------------------------------------------------------------

export const HL_MIN_NOTIONAL_USD = 10;
export const HL_MAX_SLIPPAGE_BPS = 3000;
export const HL_IOC_MIN_BAND_BPS = 1000;
export const HL_MIN_SETTLE_DELAY_BLOCKS = 5;
// MUST match HyperLiquidPerpStorage.MAX_PENDING_CLOIDS on the adapter (= 100).
// SDK previously had 32 which caused spurious pending-cap rejections.
export const HL_MAX_PENDING_CLOIDS = 100;
// MUST match HyperLiquidPerpStorage.MAX_ACTIVE_PERPS (= 50).
export const HL_MAX_ACTIVE_PERPS = 50;
export const HL_USDC_SPOT_TOKEN_ID = 0;

// ---------------------------------------------------------------------------
// Adapter call-side return shapes
// ---------------------------------------------------------------------------

/// @notice Wire output of an unsigned-tx encoder (mirrors
/// `@factordao/sdk` `SendTransactionParams`). Re-exported locally so the
/// HL module compiles standalone.
export interface UnsignedTx {
  to: Address;
  data: Hex;
  value?: bigint;
}
