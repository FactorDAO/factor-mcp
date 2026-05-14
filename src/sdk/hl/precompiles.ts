// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// HyperLiquid precompile readers.
//
// Each HL precompile is a plain `eth_call` against a fixed address in the
// `0x0000…0800..0x0000…0810` range. The viem `PublicClient.call` /
// `readContract` paths work transparently — no special transport.
//
// Mirrors the on-chain typed wrappers in `HLPrecompiles.sol`. The result
// types match `HLTypes.sol` after bigint normalization.

import type { Address, PublicClient } from 'viem';
import { decodeAbiParameters, encodeAbiParameters } from 'viem';

import type {
  AccountMarginSummary,
  HLPosition,
  HLSpotBalance,
  PerpAssetInfo,
} from './types.js';

// ---------------------------------------------------------------------------
// Precompile addresses (immutable across HyperEVM mainnet 999 and testnet 998)
// ---------------------------------------------------------------------------

export const PRECOMPILE = Object.freeze({
  POSITION: '0x0000000000000000000000000000000000000800',
  SPOT_BALANCE: '0x0000000000000000000000000000000000000801',
  VAULT_EQUITY: '0x0000000000000000000000000000000000000802',
  WITHDRAWABLE: '0x0000000000000000000000000000000000000803',
  MARK_PX: '0x0000000000000000000000000000000000000806',
  ORACLE_PX: '0x0000000000000000000000000000000000000807',
  SPOT_PX: '0x0000000000000000000000000000000000000808',
  L1_BLOCK_NUMBER: '0x0000000000000000000000000000000000000809',
  PERP_ASSET_INFO: '0x000000000000000000000000000000000000080a',
  SPOT_INFO: '0x000000000000000000000000000000000000080b',
  TOKEN_INFO: '0x000000000000000000000000000000000000080c',
  ACCOUNT_MARGIN_SUMMARY: '0x000000000000000000000000000000000000080f',
  CORE_USER_EXISTS: '0x0000000000000000000000000000000000000810',
} as const satisfies Record<string, Address>);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function rawCall(
  client: PublicClient,
  to: Address,
  data: `0x${string}`,
): Promise<`0x${string}`> {
  const { data: out } = await client.call({ to, data });
  if (!out || out === '0x') {
    throw new Error(`HL precompile ${to} returned empty data`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// User-state readers
// ---------------------------------------------------------------------------

/// @notice `POSITION` precompile (0x0800). Reads the vault's position on
/// a single perp index. Returns the unpacked `HLPosition` struct.
export async function readPosition(
  client: PublicClient,
  user: Address,
  perp: number,
): Promise<HLPosition> {
  assertPerp(perp);
  const data = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint32' }],
    [user, perp],
  );
  const result = await rawCall(client, PRECOMPILE.POSITION, data);
  const [szi, entryNtl, isolatedRawUsd, leverage, isIsolated] =
    decodeAbiParameters(
      [
        { type: 'int64' },
        { type: 'uint64' },
        { type: 'int64' },
        { type: 'uint32' },
        { type: 'bool' },
      ],
      result,
    );
  return {
    szi: szi as bigint,
    entryNtl: entryNtl as bigint,
    isolatedRawUsd: isolatedRawUsd as bigint,
    leverage: Number(leverage),
    isIsolated: isIsolated as boolean,
  };
}

/// @notice `SPOT_BALANCE` precompile (0x0801).
export async function readSpotBalance(
  client: PublicClient,
  user: Address,
  token: bigint,
): Promise<HLSpotBalance> {
  if (token < 0n || token > 0xffffffffffffffffn) {
    throw new Error(`spotBalance: token out of uint64 range (got ${token})`);
  }
  const data = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint64' }],
    [user, token],
  );
  const result = await rawCall(client, PRECOMPILE.SPOT_BALANCE, data);
  const [total, hold, entryNtl] = decodeAbiParameters(
    [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }],
    result,
  );
  return {
    total: total as bigint,
    hold: hold as bigint,
    entryNtl: entryNtl as bigint,
  };
}

/// @notice `WITHDRAWABLE` precompile (0x0803). Free perp-ledger margin
/// in USDC 6-dec. Includes accrued funding.
export async function readWithdrawable(
  client: PublicClient,
  user: Address,
): Promise<bigint> {
  const data = encodeAbiParameters([{ type: 'address' }], [user]);
  const result = await rawCall(client, PRECOMPILE.WITHDRAWABLE, data);
  const [w] = decodeAbiParameters([{ type: 'uint64' }], result);
  return w as bigint;
}

/// @notice `ACCOUNT_MARGIN_SUMMARY` precompile (0x080F). Single source
/// of truth for perp NAV (`accountValue`).
export async function readAccountMarginSummary(
  client: PublicClient,
  user: Address,
): Promise<AccountMarginSummary> {
  const data = encodeAbiParameters(
    [{ type: 'uint32' }, { type: 'address' }],
    [0, user],
  );
  const result = await rawCall(
    client,
    PRECOMPILE.ACCOUNT_MARGIN_SUMMARY,
    data,
  );
  const [accountValue, marginUsed, ntlPos, rawUsd] = decodeAbiParameters(
    [
      { type: 'int64' },
      { type: 'uint64' },
      { type: 'uint64' },
      { type: 'int64' },
    ],
    result,
  );
  return {
    accountValue: accountValue as bigint,
    marginUsed: marginUsed as bigint,
    ntlPos: ntlPos as bigint,
    rawUsd: rawUsd as bigint,
  };
}

/// @notice `CORE_USER_EXISTS` precompile (0x0810). Gate for
/// `addApiWallet`: HL silently drops action 9 if the agent already has
/// an HL identity.
export async function readCoreUserExists(
  client: PublicClient,
  user: Address,
): Promise<boolean> {
  const data = encodeAbiParameters([{ type: 'address' }], [user]);
  const result = await rawCall(client, PRECOMPILE.CORE_USER_EXISTS, data);
  const [exists] = decodeAbiParameters([{ type: 'bool' }], result);
  return exists as boolean;
}

// ---------------------------------------------------------------------------
// Price readers
// ---------------------------------------------------------------------------

/// @notice `MARK_PX` precompile (0x0806). Returns the price in HL's
/// quirky `realPrice × 10^(6-szDecimals)` scale — call `markPxToReal`
/// from `decimals.ts` (or `markToWire1e8`) to convert.
export async function readMarkPx(
  client: PublicClient,
  perp: number,
): Promise<bigint> {
  assertPerp(perp);
  const data = encodeAbiParameters([{ type: 'uint32' }], [perp]);
  const result = await rawCall(client, PRECOMPILE.MARK_PX, data);
  const [px] = decodeAbiParameters([{ type: 'uint64' }], result);
  return px as bigint;
}

// ---------------------------------------------------------------------------
// Static asset metadata
// ---------------------------------------------------------------------------

/// @notice `PERP_ASSET_INFO` precompile (0x080A). Returns `coin`,
/// `szDecimals`, `maxLeverage`, etc. Cached per `(chainId, index)` by
/// the higher-level `HLVault` layer.
export async function readPerpAssetInfo(
  client: PublicClient,
  perp: number,
): Promise<PerpAssetInfo> {
  assertPerp(perp);
  const data = encodeAbiParameters([{ type: 'uint32' }], [perp]);
  const result = await rawCall(client, PRECOMPILE.PERP_ASSET_INFO, data);
  const [coin, marginTableId, szDecimals, maxLeverage, onlyIsolated] =
    decodeAbiParameters(
      [
        { type: 'string' },
        { type: 'uint32' },
        { type: 'uint8' },
        { type: 'uint8' },
        { type: 'bool' },
      ],
      result,
    );
  return {
    coin: coin as string,
    marginTableId: Number(marginTableId),
    szDecimals: Number(szDecimals),
    maxLeverage: Number(maxLeverage),
    onlyIsolated: onlyIsolated as boolean,
  };
}

function assertPerp(perp: number): void {
  if (!Number.isInteger(perp) || perp < 0 || perp > 0xffffffff) {
    throw new Error(`perp index out of uint32 range (got ${perp})`);
  }
}
