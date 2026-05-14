// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// `HLVault` — high-level facade composing every HyperLiquid module into
// a single ergonomic surface for the MCP server and Studio UI.
//
// Every on-chain method returns `SendTransactionParams` already wrapped
// in `executeByManager` (or `executeByOwner` for `forceForgetCloid`).
// The caller is responsible for signing/broadcasting via `managerSigner`
// — the SDK is deliberately transport-agnostic so the same surface
// works for Safe, MCP, and the in-app signer path.
//
// Off-chain methods (`setLeverage`, `addIsolatedMargin`) flow through
// `HLExchangeClient` and bypass the EVM entirely.

import {
  encodeFunctionData,
  type Address,
  type LocalAccount,
  type PublicClient,
} from 'viem';

import { SendTransactionParams } from '@factordao/sdk';
import { studioProV1ABI } from '@factordao/contracts';

import {
  encodeAddApiWallet,
  encodeBridgeSpotToEvm,
  encodeCancelOrder,
  encodeClosePosition,
  encodeDepositToPerp,
  encodeForceForgetCloid,
  encodeOpenPosition,
  encodePlaceOrder,
  encodeSettlePending,
  encodeSpotSend,
  encodeSyncPosition,
  encodeWithdrawFromPerp,
  hyperLiquidPerpAdapterAbi,
} from './coreWriter.js';
import {
  evmToSpotWei,
  markPxToReal,
  sizeWireToReal,
  toWire1e8,
  usdcEvm,
} from './decimals.js';
import { HLExchangeClient } from './exchange.js';
import { getNav } from './nav.js';
import {
  readAccountMarginSummary,
  readCoreUserExists,
  readMarkPx,
  readPerpAssetInfo,
  readPosition,
} from './precompiles.js';
import {
  preflightOpenPosition,
  preflightPlaceOrder,
} from './preflight.js';
import { alignIocLimit, sizeUsdToWire, tickRound } from './tickMath.js';
import {
  HLPreflightError,
  HL_USDC_SPOT_TOKEN_ID,
  ORDER_TIF,
  PERP_INDEX,
  type HlExchangeResponse,
  type HLPosition,
  type HLVaultNav,
  type MarginMode,
  type OrderTif,
  type PerpAssetInfo,
  type PerpSymbol,
  type UnsignedTx,
} from './types.js';

// ---------------------------------------------------------------------------
// Default chain config (HyperEVM mainnet, chainId 999)
// ---------------------------------------------------------------------------

/// @notice On-chain addresses for the HL module per HyperEVM chain. The
/// defaults below match the production HyperEVM mainnet deployment (Apr
/// 2026). Override for testnet or staging by passing `addresses` to the
/// `HLVault` constructor.
export interface HLChainAddresses {
  adapter: Address;
  accounting: Address;
  selectorSetup: Address;
  factory: Address;
  usdc: Address;
  cdw: Address;
  coreWriter: Address;
}

export const HL_ADDRESSES_999: HLChainAddresses = Object.freeze({
  adapter: '0xa2f0fF03b7E14A53552E15b9A1e549493509a9c9',
  accounting: '0x606d70dAc972c145ced21A789E0B175be5ffE3ad',
  selectorSetup: '0x53027c4f9808c2FF06b9248f8d42ECE6c60e143f',
  factory: '0x4416ddaA726e2A4b537e652d00D8EeB8A80Dc704',
  usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
  cdw: '0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24',
  coreWriter: '0x3333333333333333333333333333333333333333',
}) as HLChainAddresses;

// ---------------------------------------------------------------------------
// Method param shapes
// ---------------------------------------------------------------------------

export interface HLVaultOptions {
  client: PublicClient;
  managerSigner: LocalAccount;
  /// Optional agent EOA used for off-chain EIP-712 actions. If omitted,
  /// `managerSigner` is reused (subset of trust, default per DESIGN §9.2).
  agentSigner?: LocalAccount;
  /// Override the default chainId=999 address book.
  addresses?: HLChainAddresses;
  /// HL is HyperEVM mainnet by default. Set true to route off-chain
  /// requests at `api.hyperliquid-testnet.xyz`.
  isTestnet?: boolean;
  /// Inject a fetch impl for tests / non-Node-18 hosts.
  fetchImpl?: typeof fetch;
}

export interface OpenPositionParams {
  perp: PerpSymbol | number;
  isLong: boolean;
  sizeUsd: number;
  /// IOC aggressive band in bps (default 1200 — clears HL's 10% floor
  /// with margin and stays inside the adapter's 30% slippage cap).
  slippageBps?: number;
}

export interface ClosePositionParams {
  perp: PerpSymbol | number;
  sizeUsd: number;
  slippageBps?: number;
}

export interface PlaceOrderParams {
  perp: PerpSymbol | number;
  isLong: boolean;
  sizeUsd: number;
  limitPxReal: number;
  tif: OrderTif;
  reduceOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePerpIndex(perp: PerpSymbol | number): number {
  if (typeof perp === 'number') {
    if (!Number.isInteger(perp) || perp < 0) {
      throw new HLPreflightError(
        'unknown-perp',
        `invalid perp index ${perp}`,
        { perp },
      );
    }
    return perp;
  }
  const idx = PERP_INDEX[perp];
  if (idx === undefined) {
    throw new HLPreflightError('unknown-perp', `unknown perp symbol ${perp}`, {
      perp,
    });
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Vault class
// ---------------------------------------------------------------------------

export class HLVault {
  public readonly vaultAddress: Address;
  public readonly addresses: HLChainAddresses;

  private readonly client: PublicClient;
  private readonly managerSigner: LocalAccount;
  private readonly agentSigner: LocalAccount;
  private readonly exchange: HLExchangeClient;

  /// PerpAssetInfo cache. Keyed by perp index. `PERP_ASSET_INFO` results
  /// are immutable for the lifetime of a market, so a one-shot fetch
  /// per perp is sufficient.
  private readonly assetInfoCache = new Map<number, PerpAssetInfo>();

  constructor(
    vaultAddress: Address,
    publicClient: PublicClient,
    managerSigner: LocalAccount,
    agentSigner?: LocalAccount,
    options: { addresses?: HLChainAddresses; isTestnet?: boolean; fetchImpl?: typeof fetch } = {},
  ) {
    this.vaultAddress = vaultAddress;
    this.client = publicClient;
    this.managerSigner = managerSigner;
    this.agentSigner = agentSigner ?? managerSigner;
    this.addresses = options.addresses ?? HL_ADDRESSES_999;
    this.exchange = new HLExchangeClient({
      agent: this.agentSigner,
      vaultAddress: this.vaultAddress,
      isTestnet: options.isTestnet ?? false,
      fetchImpl: options.fetchImpl,
    });
  }

  // -------------------------------------------------------------------------
  // Static factory mirroring `factor.hl.vault(addr, opts)` from DESIGN
  // -------------------------------------------------------------------------

  public static create(
    vaultAddress: Address,
    opts: HLVaultOptions,
  ): HLVault {
    return new HLVault(
      vaultAddress,
      opts.client,
      opts.managerSigner,
      opts.agentSigner,
      {
        addresses: opts.addresses,
        isTestnet: opts.isTestnet,
        fetchImpl: opts.fetchImpl,
      },
    );
  }

  // -------------------------------------------------------------------------
  // Internal: vault-call wrappers
  // -------------------------------------------------------------------------

  /// @notice Wrap one or more adapter calls in a `executeByManager`
  /// vault call. Encodes against `studioProV1ABI` to keep this in sync
  /// with the on-chain definition (avoids a parallel-truth ABI).
  private executeByManager(blocks: UnsignedTx[]): SendTransactionParams {
    if (blocks.length === 0) {
      throw new Error('executeByManager: at least one block required');
    }
    const adapterAddresses = blocks.map((b) => b.to);
    const adapterData = blocks.map((b) => b.data);
    const value = blocks.reduce((acc, b) => acc + (b.value ?? 0n), 0n);
    return {
      to: this.vaultAddress,
      data: encodeFunctionData({
        abi: studioProV1ABI,
        functionName: 'executeByManager',
        args: [adapterAddresses, adapterData],
      }),
      value,
    };
  }

  private executeByOwner(blocks: UnsignedTx[]): SendTransactionParams {
    if (blocks.length === 0) {
      throw new Error('executeByOwner: at least one block required');
    }
    const adapterAddresses = blocks.map((b) => b.to);
    const adapterData = blocks.map((b) => b.data);
    const value = blocks.reduce((acc, b) => acc + (b.value ?? 0n), 0n);
    return {
      to: this.vaultAddress,
      data: encodeFunctionData({
        abi: studioProV1ABI,
        functionName: 'executeByOwner',
        args: [adapterAddresses, adapterData],
      }),
      value,
    };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /// @notice Tri-ledger NAV breakdown — see `nav.ts` for the math.
  public async getNav(): Promise<HLVaultNav> {
    return getNav({
      client: this.client,
      vault: this.vaultAddress,
      usdc: this.addresses.usdc,
    });
  }

  /// @notice Active positions for this vault — one call per index in the
  /// adapter's `activePerpIndices` set. Caller can filter `szi === 0n`
  /// to drop stale entries that should be sync'd away.
  public async getPositions(): Promise<
    Array<{ perp: number; position: HLPosition }>
  > {
    const active = (await this.client.readContract({
      address: this.addresses.adapter,
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'getActivePerpIndices',
    })) as readonly number[];

    const reads = await Promise.all(
      active.map(async (perp) => ({
        perp: Number(perp),
        position: await readPosition(this.client, this.vaultAddress, Number(perp)),
      })),
    );
    return reads;
  }

  /// @notice Active perp indices as a plain `number[]` — cheap helper
  /// used by preflight to decide whether opening `perp` would push us
  /// over the `MAX_ACTIVE_PERPS` cap.
  public async getActivePerpIndices(): Promise<number[]> {
    const active = (await this.client.readContract({
      address: this.addresses.adapter,
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'getActivePerpIndices',
    })) as readonly number[];
    return active.map((v) => Number(v));
  }

  public async getPendingCloids(): Promise<bigint[]> {
    const pending = (await this.client.readContract({
      address: this.addresses.adapter,
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'getPendingCloids',
    })) as readonly bigint[];
    return [...pending];
  }

  public async getPerpAssetInfo(perp: number): Promise<PerpAssetInfo> {
    const cached = this.assetInfoCache.get(perp);
    if (cached) return cached;
    const info = await readPerpAssetInfo(this.client, perp);
    this.assetInfoCache.set(perp, info);
    return info;
  }

  /// @notice Read the current mark in real USD. Convenience over
  /// `readMarkPx` + `markPxToReal`.
  public async getMarkPxReal(perp: number): Promise<number> {
    const [mark, info] = await Promise.all([
      readMarkPx(this.client, perp),
      this.getPerpAssetInfo(perp),
    ]);
    return markPxToReal(mark, info.szDecimals);
  }

  // -------------------------------------------------------------------------
  // Agent management
  // -------------------------------------------------------------------------

  /// @notice Register `agentSigner.address` as the vault's HL API
  /// wallet (CoreWriter action 9) IF the agent isn't already a known HL
  /// user. If `coreUserExists(agent) == true`, HL silently drops action
  /// 9 — so we no-op rather than emitting a guaranteed-to-fail tx.
  ///
  /// Returns `undefined` when the agent is already initialized; returns
  /// a tx envelope otherwise. Caller broadcasts via `managerSigner`.
  public async ensureAgent(
    name = '',
  ): Promise<SendTransactionParams | undefined> {
    const agent = this.agentSigner.address;
    const exists = await readCoreUserExists(this.client, agent);
    if (exists) return undefined;
    return this.executeByManager([
      encodeAddApiWallet(this.addresses.adapter, { apiWallet: agent, name }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Bridge (EVM ↔ perp / spot)
  // -------------------------------------------------------------------------

  /// @notice Move HyperEVM USDC into the vault's HL perp ledger.
  /// `usdcAmount` is a decimal string (e.g. `'100.50'`) — converted to
  /// 6-dec raw via `usdcEvm`.
  public depositToPerp(usdcAmount: string): SendTransactionParams {
    const raw = usdcEvm(usdcAmount);
    return this.executeByManager([
      encodeDepositToPerp(this.addresses.adapter, raw),
    ]);
  }

  /// @notice Composite withdraw flow: perp → spot → HyperEVM ERC-20.
  ///   1. `withdrawFromPerp(amount)` — moves perp ledger USDC to spot
  ///      ledger (6-dec → 8-dec on HL side).
  ///   2. `bridgeSpotToEvm(0, amountSpotWei)` — burns the spot balance
  ///      and credits the vault's EVM USDC ERC-20 balance.
  /// Both blocks ship inside a single `executeByManager` so the spot
  /// transit balance is never observable across blocks (front-run safe).
  public withdrawToEvm(usdcAmount: string): SendTransactionParams {
    const evm6 = usdcEvm(usdcAmount);
    const spot8 = evmToSpotWei(evm6);
    return this.executeByManager([
      encodeWithdrawFromPerp(this.addresses.adapter, evm6),
      encodeBridgeSpotToEvm(this.addresses.adapter, {
        token: BigInt(HL_USDC_SPOT_TOKEN_ID),
        amountWei: spot8,
      }),
    ]);
  }

  /// @notice Raw `spotSend` — adapter locks the destination to `self`,
  /// so this is only useful for intra-spot consolidation of unusual
  /// tokens. USDC bridging should go via `withdrawToEvm` instead.
  public spotSend(args: {
    token: number | bigint;
    amountWei: bigint;
  }): SendTransactionParams {
    return this.executeByManager([
      encodeSpotSend(this.addresses.adapter, {
        token: typeof args.token === 'bigint' ? args.token : BigInt(args.token),
        amountWei: args.amountWei,
      }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Trade — IOC market-like flows
  // -------------------------------------------------------------------------

  /// @notice Open or increase a perp position with an aggressive IOC
  /// limit guaranteed to clear HL's oracle band. Runs the full preflight
  /// chain (tick / min-notional / ioc-band / slippage / caps) before
  /// returning the tx envelope.
  public async openPosition(
    args: OpenPositionParams,
  ): Promise<SendTransactionParams> {
    const perp = resolvePerpIndex(args.perp);
    const info = await this.getPerpAssetInfo(perp);

    const [markReal, active, pending] = await Promise.all([
      this.getMarkPxReal(perp),
      this.getActivePerpIndices(),
      this.getPendingCloids(),
    ]);

    const limitPxReal = alignIocLimit(
      markReal,
      args.isLong,
      info.szDecimals,
      args.slippageBps,
    );
    const limitPxWire = toWire1e8(limitPxReal);
    const sizeWire = sizeUsdToWire(args.sizeUsd, markReal, info.szDecimals);
    if (sizeWire <= 0n) {
      throw new HLPreflightError(
        'min-notional',
        `computed sizeWire is 0 — sizeUsd ${args.sizeUsd} too small for lot step at mark ${markReal}`,
        { notionalUsd: args.sizeUsd },
      );
    }

    preflightOpenPosition({
      sizeWire,
      limitPxWire,
      limitPxReal,
      szDecimals: info.szDecimals,
      isBuy: args.isLong,
      markReal,
      pendingCount: pending.length,
      activeCount: active.length,
      isNewPerp: !active.includes(perp),
      bandBps: args.slippageBps,
    });

    return this.executeByManager([
      encodeOpenPosition(this.addresses.adapter, {
        perp,
        isLong: args.isLong,
        sizeWire,
        limitPxWire,
      }),
    ]);
  }

  /// @notice Reduce or fully close a position. `sizeUsd` is the USD
  /// notional to close; pass the current position notional for a full
  /// close. The reduceOnly flag is implicit in the adapter's
  /// `closePosition` selector.
  public async closePosition(
    args: ClosePositionParams,
  ): Promise<SendTransactionParams> {
    const perp = resolvePerpIndex(args.perp);
    const info = await this.getPerpAssetInfo(perp);

    const [markReal, current, pending] = await Promise.all([
      this.getMarkPxReal(perp),
      readPosition(this.client, this.vaultAddress, perp),
      this.getPendingCloids(),
    ]);

    // Closing flips the side: a long position is reduced by a sell.
    const isLong = current.szi > 0n;
    if (current.szi === 0n) {
      throw new HLPreflightError(
        'invalid-input',
        `closePosition: no open position on perp ${perp}`,
        { perp },
      );
    }
    const limitPxReal = alignIocLimit(
      markReal,
      // For a close, the directional aggression flips:
      //   long position → we SELL → aggressive limit is BELOW mark
      //   short position → we BUY → aggressive limit is ABOVE mark
      !isLong,
      info.szDecimals,
      args.slippageBps,
    );
    const limitPxWire = toWire1e8(limitPxReal);
    const sizeWire = sizeUsdToWire(args.sizeUsd, markReal, info.szDecimals);
    if (sizeWire <= 0n) {
      throw new HLPreflightError(
        'min-notional',
        `computed sizeWire is 0 — sizeUsd ${args.sizeUsd} too small for lot step at mark ${markReal}`,
        { notionalUsd: args.sizeUsd },
      );
    }

    // closePosition uses the same preflight as openPosition but `isNewPerp`
    // is always false (we have a position, hence it's in the active set).
    preflightOpenPosition({
      sizeWire,
      limitPxWire,
      limitPxReal,
      szDecimals: info.szDecimals,
      isBuy: !isLong,
      markReal,
      pendingCount: pending.length,
      activeCount: 0,
      isNewPerp: false,
      bandBps: args.slippageBps,
    });

    return this.executeByManager([
      encodeClosePosition(this.addresses.adapter, {
        perp,
        sizeWire,
        limitPxWire,
      }),
    ]);
  }

  /// @notice Lower-level `placeOrder` — caller picks the exact limit
  /// and TIF. Useful for ALO post-only and GTC resting orders.
  public async placeOrder(
    args: PlaceOrderParams,
  ): Promise<SendTransactionParams> {
    const perp = resolvePerpIndex(args.perp);
    const info = await this.getPerpAssetInfo(perp);

    const [markReal, active, pending] = await Promise.all([
      this.getMarkPxReal(perp),
      this.getActivePerpIndices(),
      this.getPendingCloids(),
    ]);

    // Caller-supplied price must already be tick-aligned — we DON'T
    // silently snap it. (The preflight chain enforces this.)
    const limitPxRounded = tickRound(args.limitPxReal, info.szDecimals);
    const limitPxWire = toWire1e8(limitPxRounded);
    const sizeWire = sizeUsdToWire(args.sizeUsd, markReal, info.szDecimals);

    preflightPlaceOrder({
      sizeWire,
      limitPxWire,
      limitPxReal: args.limitPxReal,
      szDecimals: info.szDecimals,
      isBuy: args.isLong,
      isIoc: args.tif === ORDER_TIF.IOC,
      markReal,
      pendingCount: pending.length,
      activeCount: active.length,
      isNewPerp: !active.includes(perp),
    });

    return this.executeByManager([
      encodePlaceOrder(this.addresses.adapter, {
        perp,
        isLong: args.isLong,
        sizeWire,
        limitPxWire,
        reduceOnly: args.reduceOnly ?? false,
        tif: args.tif,
      }),
    ]);
  }

  public cancelOrder(args: {
    perp: PerpSymbol | number;
    cloid: bigint;
  }): SendTransactionParams {
    return this.executeByManager([
      encodeCancelOrder(this.addresses.adapter, {
        perp: resolvePerpIndex(args.perp),
        cloid: args.cloid,
      }),
    ]);
  }

  public syncPosition(perp: PerpSymbol | number): SendTransactionParams {
    return this.executeByManager([
      encodeSyncPosition(this.addresses.adapter, resolvePerpIndex(perp)),
    ]);
  }

  public settlePending(cloid: bigint): SendTransactionParams {
    return this.executeByManager([
      encodeSettlePending(this.addresses.adapter, cloid),
    ]);
  }

  /// @notice `forceForgetCloid` is gated to OWNER (not manager) on the
  /// adapter — wrap in `executeByOwner`. Caller must hold owner role.
  public forceForgetCloid(cloid: bigint): SendTransactionParams {
    return this.executeByOwner([
      encodeForceForgetCloid(this.addresses.adapter, cloid),
    ]);
  }

  // -------------------------------------------------------------------------
  // Off-chain (HL Exchange API)
  // -------------------------------------------------------------------------

  /// @notice Set DEFAULT leverage for `perp` (DOES NOT change existing
  /// positions — HL semantics). Signed by `agentSigner` and posted to
  /// `api.hyperliquid.xyz/exchange`.
  public async setLeverage(
    perp: PerpSymbol | number,
    leverage: number,
    mode: MarginMode,
  ): Promise<HlExchangeResponse> {
    if (!Number.isInteger(leverage) || leverage < 1) {
      throw new HLPreflightError(
        'invalid-input',
        `setLeverage: leverage must be a positive integer (got ${leverage})`,
      );
    }
    return this.exchange.updateLeverage({
      asset: resolvePerpIndex(perp),
      isCross: mode === 'cross',
      leverage,
    });
  }

  /// @notice Add (positive) or remove (negative) isolated margin on an
  /// open position. `deltaUsd` is in 6-dec USDC; converted to HL's
  /// `ntli` wire scale (also 6-dec, signed).
  public async addIsolatedMargin(
    perp: PerpSymbol | number,
    isLong: boolean,
    deltaUsd: number,
  ): Promise<HlExchangeResponse> {
    if (!Number.isFinite(deltaUsd) || deltaUsd === 0) {
      throw new HLPreflightError(
        'invalid-input',
        `addIsolatedMargin: deltaUsd must be a non-zero finite number (got ${deltaUsd})`,
      );
    }
    // `ntli` is in 6-dec units (1_000_000 = $1.00).
    const ntli = Math.round(deltaUsd * 1e6);
    return this.exchange.updateIsolatedMargin({
      asset: resolvePerpIndex(perp),
      isBuy: isLong,
      ntli,
    });
  }

  // -------------------------------------------------------------------------
  // Convenience: real-units summary for a single perp
  // -------------------------------------------------------------------------

  /// @notice Combined position + mark snapshot for UI display.
  public async positionSnapshot(perp: PerpSymbol | number): Promise<{
    perp: number;
    coin: string;
    szi: bigint;
    szReal: number;
    leverage: number;
    isIsolated: boolean;
    entryNtl: bigint;
    markPxReal: number;
  }> {
    const idx = resolvePerpIndex(perp);
    const info = await this.getPerpAssetInfo(idx);
    const [pos, mark] = await Promise.all([
      readPosition(this.client, this.vaultAddress, idx),
      readMarkPx(this.client, idx),
    ]);
    return {
      perp: idx,
      coin: info.coin,
      szi: pos.szi,
      szReal: sizeWireToReal(pos.szi * 10n ** BigInt(8 - info.szDecimals)),
      leverage: pos.leverage,
      isIsolated: pos.isIsolated,
      entryNtl: pos.entryNtl,
      markPxReal: markPxToReal(mark, info.szDecimals),
    };
  }

  /// @notice Aggregate perp ledger view (free margin + open exposure).
  public async accountSummary() {
    return readAccountMarginSummary(this.client, this.vaultAddress);
  }
}
