// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Pure adapter-call encoders for the HyperLiquidPerpAdapter.
//
// Each function returns a `SendTransactionParams`-shaped object:
//   { to: adapterAddress, data: encodeFunctionData(...), value? }
// ready to be wrapped into `executeByManager([block])` (or
// `executeByOwner` for `forceForgetCloid`).
//
// No signer, no network — trivially testable.
//
// Adapter ABI is inlined here (the `@factordao/contracts` package does
// not yet export the HL adapter ABI). When that export becomes available
// the inline definitions can be swapped out without breaking callers.

import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';

import { ORDER_TIF, type OrderTif, type UnsignedTx } from './types.js';

// ---------------------------------------------------------------------------
// HL adapter ABI fragments
// ---------------------------------------------------------------------------

/// Inline ABI for the subset of `HyperLiquidPerpAdapter` functions the SDK
/// encodes. Mirrors `contracts/adapters/perp/HyperLiquidPerpAdapter.sol`.
export const hyperLiquidPerpAdapterAbi = [
  // ----- write -----
  {
    type: 'function',
    name: 'depositToPerp',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'usdcAmount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawFromPerp',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'usdcAmount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'spotSend',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'uint64' },
      { name: 'amountWei', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'bridgeSpotToEvm',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'uint64' },
      { name: 'amountWei', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'transferUsdcBetweenLedgers',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'srcDex', type: 'uint32' },
      { name: 'dstDex', type: 'uint32' },
      { name: 'amountWei', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'openPosition',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'perp', type: 'uint32' },
      { name: 'isLong', type: 'bool' },
      { name: 'sizeWei', type: 'uint64' },
      { name: 'acceptablePxWei', type: 'uint64' },
    ],
    outputs: [{ name: 'cloid', type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'closePosition',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'perp', type: 'uint32' },
      { name: 'sizeWei', type: 'uint64' },
      { name: 'acceptablePxWei', type: 'uint64' },
    ],
    outputs: [{ name: 'cloid', type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'placeOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'perp', type: 'uint32' },
      { name: 'isLong', type: 'bool' },
      { name: 'sizeWei', type: 'uint64' },
      { name: 'limitPx', type: 'uint64' },
      { name: 'reduceOnly', type: 'bool' },
      { name: 'tif', type: 'uint8' },
    ],
    outputs: [{ name: 'cloid', type: 'uint128' }],
  },
  {
    type: 'function',
    name: 'cancelOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'perp', type: 'uint32' },
      { name: 'cloid', type: 'uint128' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'syncPosition',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'perp', type: 'uint32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'settlePending',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'cloid', type: 'uint128' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'forceForgetCloid',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'cloid', type: 'uint128' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'addApiWallet',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'apiWallet', type: 'address' },
      { name: 'name', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setMaxKnownBuilderDex',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newMax', type: 'uint32' }],
    outputs: [],
  },
  // ----- view -----
  {
    type: 'function',
    name: 'perpEquityUsdc',
    stateMutability: 'view',
    inputs: [{ name: 'vault', type: 'address' }],
    outputs: [{ name: 'totalUsdc6dec', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getActivePerpIndices',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint32[]' }],
  },
  {
    type: 'function',
    name: 'getPendingCloids',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint128[]' }],
  },
  // ----- events (used by HLVault.ts to decode cloid from receipts) -----
  {
    type: 'event',
    name: 'PositionOpenRequested',
    inputs: [
      { name: 'cloid', type: 'uint128', indexed: true },
      { name: 'perp', type: 'uint32', indexed: false },
      { name: 'isLong', type: 'bool', indexed: false },
      { name: 'sizeWei', type: 'uint64', indexed: false },
      { name: 'limitPxWei', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PositionCloseRequested',
    inputs: [
      { name: 'cloid', type: 'uint128', indexed: true },
      { name: 'perp', type: 'uint32', indexed: false },
      { name: 'sizeWei', type: 'uint64', indexed: false },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Encoders (HL adapter → calldata blocks)
// ---------------------------------------------------------------------------

/// @notice Action 1 (limit order, IOC) — opens or increases a perp
/// position. Wrapper for adapter `openPosition`.
export function encodeOpenPosition(
  adapter: Address,
  args: {
    perp: number;
    isLong: boolean;
    sizeWire: bigint;
    limitPxWire: bigint;
  },
): UnsignedTx {
  assertUint32(args.perp, 'perp');
  assertUint64(args.sizeWire, 'sizeWire');
  assertUint64(args.limitPxWire, 'limitPxWire');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'openPosition',
      args: [args.perp, args.isLong, args.sizeWire, args.limitPxWire],
    }),
  };
}

/// @notice Action 1 (limit order, IOC, reduceOnly) — partial or full
/// close of an existing position. Wrapper for adapter `closePosition`.
export function encodeClosePosition(
  adapter: Address,
  args: {
    perp: number;
    sizeWire: bigint;
    limitPxWire: bigint;
  },
): UnsignedTx {
  assertUint32(args.perp, 'perp');
  assertUint64(args.sizeWire, 'sizeWire');
  assertUint64(args.limitPxWire, 'limitPxWire');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'closePosition',
      args: [args.perp, args.sizeWire, args.limitPxWire],
    }),
  };
}

/// @notice Action 1 (general limit order) — caller-controlled TIF
/// (ALO/GTC/IOC) and `reduceOnly` flag.
export function encodePlaceOrder(
  adapter: Address,
  args: {
    perp: number;
    isLong: boolean;
    sizeWire: bigint;
    limitPxWire: bigint;
    reduceOnly: boolean;
    tif: OrderTif;
  },
): UnsignedTx {
  assertUint32(args.perp, 'perp');
  assertUint64(args.sizeWire, 'sizeWire');
  assertUint64(args.limitPxWire, 'limitPxWire');
  if (
    args.tif !== ORDER_TIF.ALO &&
    args.tif !== ORDER_TIF.GTC &&
    args.tif !== ORDER_TIF.IOC
  ) {
    throw new Error(`encodePlaceOrder: invalid tif ${String(args.tif)}`);
  }
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'placeOrder',
      args: [
        args.perp,
        args.isLong,
        args.sizeWire,
        args.limitPxWire,
        args.reduceOnly,
        args.tif,
      ],
    }),
  };
}

/// @notice Action 11 (cancel by cloid).
export function encodeCancelOrder(
  adapter: Address,
  args: { perp: number; cloid: bigint },
): UnsignedTx {
  assertUint32(args.perp, 'perp');
  assertUint128(args.cloid, 'cloid');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'cancelOrder',
      args: [args.perp, args.cloid],
    }),
  };
}

/// @notice Sync local activePerpIndices with HL truth for `perp`.
export function encodeSyncPosition(
  adapter: Address,
  perp: number,
): UnsignedTx {
  assertUint32(perp, 'perp');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'syncPosition',
      args: [perp],
    }),
  };
}

/// @notice Clean up a pending cloid (gated by MIN_SETTLE_DELAY_BLOCKS).
export function encodeSettlePending(
  adapter: Address,
  cloid: bigint,
): UnsignedTx {
  assertUint128(cloid, 'cloid');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'settlePending',
      args: [cloid],
    }),
  };
}

/// @notice Last-resort cloid purge. MUST be wrapped via `executeByOwner`,
/// not `executeByManager`, by the caller.
export function encodeForceForgetCloid(
  adapter: Address,
  cloid: bigint,
): UnsignedTx {
  assertUint128(cloid, 'cloid');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'forceForgetCloid',
      args: [cloid],
    }),
  };
}

/// @notice Bridge USDC HyperEVM ERC-20 → vault HL perp ledger
/// (CoreDepositWallet.deposit + activation handled inside the adapter).
export function encodeDepositToPerp(
  adapter: Address,
  usdcAmount: bigint,
): UnsignedTx {
  if (usdcAmount <= 0n) {
    throw new Error('encodeDepositToPerp: usdcAmount must be > 0');
  }
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'depositToPerp',
      args: [usdcAmount],
    }),
  };
}

/// @notice Move USDC from perp ledger to spot ledger (CoreWriter action 7).
export function encodeWithdrawFromPerp(
  adapter: Address,
  usdcAmount: bigint,
): UnsignedTx {
  if (usdcAmount <= 0n) {
    throw new Error('encodeWithdrawFromPerp: usdcAmount must be > 0');
  }
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'withdrawFromPerp',
      args: [usdcAmount],
    }),
  };
}

/// @notice Intra-HL spot transfer (CoreWriter action 6) — adapter locks
/// destination to the vault itself.
export function encodeSpotSend(
  adapter: Address,
  args: { token: bigint; amountWei: bigint },
): UnsignedTx {
  assertUint64(args.token, 'token');
  assertUint64(args.amountWei, 'amountWei');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'spotSend',
      args: [args.token, args.amountWei],
    }),
  };
}

/// @notice Bridge HL spot USDC → HyperEVM ERC-20 (CoreWriter action 13 to
/// the per-token system address). Adapter hard-restricts to token=0.
export function encodeBridgeSpotToEvm(
  adapter: Address,
  args: { token: bigint; amountWei: bigint },
): UnsignedTx {
  assertUint64(args.token, 'token');
  assertUint64(args.amountWei, 'amountWei');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'bridgeSpotToEvm',
      args: [args.token, args.amountWei],
    }),
  };
}

/// @notice Move USDC between any two HL ledgers within the vault's own
/// HL identity (main perp ⇄ xyz builder perp ⇄ spot). Wraps CoreWriter
/// action 13 `sendAsset`. Adapter hard-restricts destination to the
/// vault itself and token to 0 (USDC).
/// @param srcDex 0 = main HL perp, 1 = xyz builder dex, `0xFFFFFFFF` = spot
/// @param dstDex same encoding
/// @param amountWei8dec USDC amount in 8-decimal spot scale. Empirically
///        HL expects 8-dec for ALL ledger pairs even when transferring
///        between two 6-dec perp dexes — HL converts on the destination.
export function encodeTransferUsdcBetweenLedgers(
  adapter: Address,
  args: { srcDex: number; dstDex: number; amountWei8dec: bigint },
): UnsignedTx {
  assertUint64(args.amountWei8dec, 'amountWei8dec');
  if (args.srcDex === args.dstDex) {
    throw new Error('encodeTransferUsdcBetweenLedgers: srcDex == dstDex');
  }
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'transferUsdcBetweenLedgers',
      args: [args.srcDex, args.dstDex, args.amountWei8dec],
    }),
  };
}

/// @notice Authorize an EOA as the vault's HL API wallet / agent
/// (CoreWriter action 9). Slot is selected by `name`:
///   - "" (empty) selects the primary unnamed slot
///   - any non-empty string selects one of the 3 named slots.
export function encodeAddApiWallet(
  adapter: Address,
  args: { apiWallet: Address; name: string },
): UnsignedTx {
  if (!args.apiWallet || args.apiWallet === '0x0000000000000000000000000000000000000000') {
    throw new Error('encodeAddApiWallet: apiWallet cannot be zero');
  }
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'addApiWallet',
      args: [args.apiWallet, args.name],
    }),
  };
}

/// @notice Bump the on-chain ceiling for `transferUsdcBetweenLedgers`
/// destination dex (`maxKnownBuilderDex`). Adapter gates this to OWNER
/// only — wrap in `executeByOwner`, not `executeByManager`. This does
/// NOT auto-update the SDK's `SUPPORTED_PERP_DEXES` whitelist — that is
/// a separate product decision.
export function encodeSetMaxKnownBuilderDex(
  adapter: Address,
  newMax: number,
): UnsignedTx {
  assertUint32(newMax, 'newMax');
  return {
    to: adapter,
    data: encodeFunctionData({
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'setMaxKnownBuilderDex',
      args: [newMax],
    }),
  };
}

// ---------------------------------------------------------------------------
// Small input guards. Using assertion functions keeps call sites flat.
// ---------------------------------------------------------------------------

const U32_MAX = 0xffffffffn;
const U64_MAX = 0xffffffffffffffffn;
const U128_MAX = (1n << 128n) - 1n;

function assertUint32(v: number, field: string): void {
  if (!Number.isInteger(v) || v < 0 || BigInt(v) > U32_MAX) {
    throw new Error(`${field}: out of uint32 range (got ${v})`);
  }
}

function assertUint64(v: bigint, field: string): void {
  if (typeof v !== 'bigint' || v < 0n || v > U64_MAX) {
    throw new Error(`${field}: out of uint64 range (got ${String(v)})`);
  }
}

function assertUint128(v: bigint, field: string): void {
  if (typeof v !== 'bigint' || v < 0n || v > U128_MAX) {
    throw new Error(`${field}: out of uint128 range (got ${String(v)})`);
  }
}
