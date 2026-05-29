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
  parseUnits,
  type Address,
  type LocalAccount,
  type PublicClient,
} from 'viem';

import { SendTransactionParams } from '@factordao/sdk';
import { studioProV1ABI } from '@factordao/contracts';

import {
  encodeAddApiWallet,
  encodeBridgeSpotToEvm,
  encodeTransferUsdcBetweenLedgers,
  encodeCancelOrder,
  encodeClosePosition,
  encodeDepositToPerp,
  encodeForceForgetCloid,
  encodeOpenPosition,
  encodePlaceOrder,
  encodeSetMaxKnownBuilderDex,
  encodeSettlePending,
  encodeSpotSend,
  encodeSyncPosition,
  encodeWithdrawFromPerp,
  hyperLiquidPerpAdapterAbi,
} from './coreWriter.js';
import { SUPPORTED_PERP_DEXES } from './catalog.js';
import {
  evmToSpotWei,
  hlFormatDecimal,
  usdcSpotWei,
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
  HL_MIN_NOTIONAL_USD,
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
  // v5 — configurable `maxKnownBuilderDex` storage-backed (owner setter, default 1 / live 8).
  adapter: '0x904b57A05265D8Cd9c8e1eDE436FdfDaDFaE5808',
  // v3 — configurable `maxBuilderDexIndex` (default 8 — covers all live HIP-3 builder dexes).
  accounting: '0x21DE7b6aB616fF1de35640685Df7508C4904D37A',
  // v5 — wired to the v5 adapter.
  selectorSetup: '0x127d63E59126E5c0dEe0839F9C6A20e1D8359DC8',
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

// ---------------------------------------------------------------------------
// HL Info `clearinghouseState` response shape (subset used by getAllPositions)
// ---------------------------------------------------------------------------

interface ClearinghouseLeverage {
  type: 'cross' | 'isolated';
  value: number;
  rawUsd?: string; // present only when isolated
}

interface ClearinghousePosition {
  coin: string;
  szi: string; // signed decimal
  entryPx?: string;
  positionValue?: string;
  leverage: ClearinghouseLeverage;
}

interface ClearinghouseStateResponse {
  assetPositions?: Array<{ type: string; position: ClearinghousePosition }>;
}

/// @notice Project an HL Info `clearinghouseState` position (decimal-string
/// fields) onto the SDK's `HLPosition` shape (bigint, native units).
/// Mirrors the on-chain POSITION precompile decoding so a builder-dex
/// position is structurally identical to a main-dex one from the caller's
/// POV.
function projectBuilderPosition(
  raw: ClearinghousePosition,
  szDecimals: number,
): HLPosition {
  // `szi` is a signed decimal like '0.005' or '-1.2'. parseUnits doesn't
  // handle leading '-' on every viem version — split sign first.
  const negative = raw.szi.startsWith('-');
  const magnitude = negative ? raw.szi.slice(1) : raw.szi;
  const sziAbs = parseUnits(magnitude, szDecimals);
  const szi = negative ? -sziAbs : sziAbs;

  const entryNtl = raw.positionValue
    ? parseUnits(raw.positionValue, 6)
    : 0n;
  const isIsolated = raw.leverage.type === 'isolated';
  // rawUsd is HL's signed isolated-margin raw. parseUnits w/ explicit sign.
  let isolatedRawUsd = 0n;
  if (isIsolated && raw.leverage.rawUsd !== undefined) {
    const raws = raw.leverage.rawUsd;
    const rawNeg = raws.startsWith('-');
    const rawMag = rawNeg ? raws.slice(1) : raws;
    const mag = parseUnits(rawMag, 6);
    isolatedRawUsd = rawNeg ? -mag : mag;
  }
  return {
    szi,
    entryNtl,
    isolatedRawUsd,
    leverage: Number(raw.leverage.value),
    isIsolated,
  };
}

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

  /// Dynamic perp universe cache, keyed by symbol. Hydrated lazily on
  /// first symbol resolution that misses the hardcoded `PERP_INDEX` map.
  /// Holds ALL ~230 main-dex perps (BTC … PAXG … HYPE), making
  /// `openPosition({ perp: 'PAXG' })` work without the user needing the
  /// numeric index. Refresh via `refreshUniverse()` if a new perp gets
  /// listed mid-session.
  private universeByName: Map<string, { index: number; szDecimals: number; maxLeverage: number; onlyIsolated: boolean }> | null = null;

  /// @notice Resolved builder-dex symbol cache (`xyz:GOLD` → globalAsset
  /// etc). Two reasons for caching: (a) `resolveBuilderDex` makes two
  /// HL Info round-trips per call (`perpDexs` + `metaAndAssetCtxs`),
  /// and (b) the per-call resolution doubles RPC pressure when a
  /// strategy opens and closes the same builder perp in a tight loop.
  ///
  /// TTL of 5 minutes is short enough that a delisting / reindexing
  /// (which HL announces in advance) won't outlive the cache, but long
  /// enough that the same trading loop hits the cache for typical
  /// reconciliation cadences. On TTL expiry we revalidate against
  /// `perpDexs` (cheap, single call) to confirm the dex name still
  /// exists and the dex index still maps; if not, we throw
  /// `HLPreflightError('unknown-perp')` so callers don't silently
  /// trade against a stale global asset id.
  private static readonly BUILDER_DEX_TTL_MS = 5 * 60_000;
  private readonly builderDexCache = new Map<
    string,
    { value: { globalAsset: number; szDecimals: number; maxLeverage: number; markPxReal: number }; dexIdx: number; dexName: string; expiresAt: number }
  >();

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
      // Vault, not adapter — the adapter's storage is empty when called
      // standalone. The vault's fallback dispatcher routes the selector
      // through `funcSelectors` to the adapter via delegatecall, which
      // resolves `HyperLiquidPerpStorage.s()` to the VAULT's namespaced slot.
      address: this.vaultAddress,
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

  /// @notice Open positions across ALL HL perp dexes the vault is active
  /// on. Main HL dex uses the on-chain `activePerpIndices` set + POSITION
  /// precompile (same fast path as `getPositions`). HIP-3 builder dexes
  /// (`xyz`, …) have NO precompile coverage on HyperEVM yet — they're
  /// read off-chain via HL Info `clearinghouseState` per dex, then
  /// re-projected onto the `HLPosition` shape so callers don't have to
  /// branch on origin.
  ///
  /// Field mapping for builder-dex positions (HL Info JSON → `HLPosition`):
  ///   szi             = parseUnits(position.szi, szDecimals)     // signed
  ///   entryNtl        = parseUnits(position.positionValue, 6)    // 6-dec
  ///   isolatedRawUsd  = parseUnits(leverage.rawUsd, 6) if isolated else 0n
  ///   leverage        = leverage.value
  ///   isIsolated      = leverage.type === 'isolated'
  ///
  /// `szDecimals` is fetched from `metaAndAssetCtxs` per dex (cached for
  /// the duration of the call). Returned tuples carry `dex` ('main' for
  /// the main HL dex, else the builder-dex name) AND `perp` (the FULL
  /// qualified name, e.g. `'xyz:GOLD'`, or the main-dex bare ticker
  /// like `'BTC'`). The asset INDEX is intentionally not surfaced
  /// because it's not globally unique across dexes — the qualified
  /// string is what HIP-3-aware callers want.
  public async getAllPositions(): Promise<
    Array<{ dex: string; perp: string; position: HLPosition }>
  > {
    // ---- Main dex ----
    // Try the on-chain `activePerpIndices` precompile first. It covers the
    // legacy path where positions were opened via the EVM adapter's
    // `openPosition`. But positions opened in stateless mode for main perps
    // now route through `MandateHlSponsorV2.executeAsAgent` →
    // CoreWriter LimitOrder (action 1), which the perp-storage precompile
    // does NOT track in `activePerpIndices`. Those positions only show up on
    // HL Info's `clearinghouseState` (HyperCore L1 view).
    //
    // To make `getAllPositions` reflect HyperCore truth — what callers like
    // `compileClosePosition` / `closePositionOffChain` need — we ALWAYS also
    // read main-dex positions off-chain via HL Info, merge on `coin`, and
    // prefer the HL Info row when both sources see the same asset (Info has
    // the freshest mark/PnL and is the authoritative side of native L1
    // orders). Precompile-only rows still show through, in case an EVM-
    // adapter-only deployment trips through this same code path.
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');

    const [mainRaw, mainInfoRes] = await Promise.all([
      this.getPositions().catch(() => [] as Array<{ perp: number; position: HLPosition }>),
      this.exchange.fetchImpl(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: this.vaultAddress }),
      }),
    ]);

    const mainByCoin = new Map<string, { dex: string; perp: string; position: HLPosition }>();

    // Precompile-derived rows first (lower precedence).
    const precompileResolved = await Promise.all(
      mainRaw.map(async ({ perp, position }) => {
        const info = await this.getPerpAssetInfo(perp);
        return { dex: 'main', perp: info.coin, position };
      }),
    );
    for (const row of precompileResolved) {
      if (row.position.szi !== 0n) mainByCoin.set(row.perp, row);
    }

    // HL Info clearinghouseState overrides per coin (authoritative for L1).
    if (mainInfoRes.ok) {
      const cs = (await mainInfoRes.json()) as ClearinghouseStateResponse;
      const assetPositions = (cs.assetPositions ?? []).filter(
        (ap) => Number(ap.position.szi) !== 0,
      );
      if (assetPositions.length > 0) {
        // szDecimals per coin on the MAIN dex — one listPerps call covers all.
        const mainPerps = await this.listPerps('main');
        const szDecByCoin = new Map<string, number>(
          mainPerps.map((p) => [p.name, p.szDecimals]),
        );
        for (const ap of assetPositions) {
          const coin = ap.position.coin;
          // Skip qualified builder-dex coins (`xyz:NVDA`) — those should
          // surface from the builderResults branch below, not as main rows.
          if (coin.includes(':')) continue;
          const szDec = szDecByCoin.get(coin);
          if (szDec === undefined) continue;
          const position = projectBuilderPosition(ap.position, szDec);
          mainByCoin.set(coin, { dex: 'main', perp: coin, position });
        }
      }
    }

    const mainResolved = Array.from(mainByCoin.values());

    // ---- Builder dexes (HL Info API) ----
    // `perpDexs` returns an ordered array where slot 0 = main = null. Every
    // other slot is a non-null dex spec; we read positions for each.
    const dexsRes = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'perpDexs' }),
    });
    if (!dexsRes.ok) {
      throw new Error(`HL info perpDexs failed: ${dexsRes.status} ${dexsRes.statusText}`);
    }
    const dexs = (await dexsRes.json()) as Array<{ name: string } | null>;
    const builderDexes = dexs
      .map((d) => d?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);

    const builderResults = await Promise.all(
      builderDexes.map(async (dexName) => {
        const csRes = await this.exchange.fetchImpl(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'clearinghouseState',
            dex: dexName,
            user: this.vaultAddress,
          }),
        });
        if (!csRes.ok) {
          throw new Error(
            `HL info clearinghouseState(${dexName}) failed: ${csRes.status} ${csRes.statusText}`,
          );
        }
        const cs = (await csRes.json()) as ClearinghouseStateResponse;
        const assetPositions = cs.assetPositions ?? [];
        if (assetPositions.length === 0) return [] as Array<{ dex: string; perp: string; position: HLPosition }>;
        // Need szDecimals per coin in this dex — one shot per dex.
        const dexPerps = await this.listPerps(dexName);
        const szDecByCoin = new Map<string, number>(
          dexPerps.map((p) => [p.name, p.szDecimals]),
        );
        return assetPositions
          .filter((ap) => Number(ap.position.szi) !== 0)
          .map((ap) => {
            const coin = ap.position.coin;
            const szDec = szDecByCoin.get(coin);
            if (szDec === undefined) {
              throw new Error(
                `getAllPositions: no szDecimals for ${coin} on dex ${dexName}`,
              );
            }
            const position = projectBuilderPosition(ap.position, szDec);
            return { dex: dexName, perp: coin, position };
          });
      }),
    );

    return [...mainResolved, ...builderResults.flat()];
  }

  /// @notice Active perp indices as a plain `number[]` — cheap helper
  /// used by preflight to decide whether opening `perp` would push us
  /// over the `MAX_ACTIVE_PERPS` cap.
  public async getActivePerpIndices(): Promise<number[]> {
    const active = (await this.client.readContract({
      address: this.vaultAddress, // dispatched to adapter via fallback (see getPositions)
      abi: hyperLiquidPerpAdapterAbi,
      functionName: 'getActivePerpIndices',
    })) as readonly number[];
    return active.map((v) => Number(v));
  }

  public async getPendingCloids(): Promise<bigint[]> {
    const pending = (await this.client.readContract({
      address: this.vaultAddress, // dispatched to adapter via fallback
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

  // -------------------------------------------------------------------------
  // Universe — dynamic asset resolution (covers ALL 230 main-dex perps)
  // -------------------------------------------------------------------------

  /// @notice Lazy-load the main HL perp universe so every symbol
  /// (PAXG, PENDLE, TIA, …) is resolvable by name, not just the 16
  /// hardcoded in `PERP_INDEX`.
  public async ensureUniverseLoaded(): Promise<void> {
    if (this.universeByName) return;
    const all = await this.listPerps('main');
    this.universeByName = new Map(
      all.map((p) => [p.name, {
        index: p.index,
        szDecimals: p.szDecimals,
        maxLeverage: p.maxLeverage,
        onlyIsolated: p.onlyIsolated,
      }]),
    );
  }

  /// @notice Re-fetch the universe (use if a new perp gets listed and
  /// you want it without restarting the SDK).
  public async refreshUniverse(): Promise<void> {
    this.universeByName = null;
    await this.ensureUniverseLoaded();
  }

  /// @notice All perp symbols available on the main HL dex (after first
  /// fetch). Names like `'PAXG'`, `'PENDLE'`, `'HYPE'`, etc. — pass any
  /// of these to `openPosition({perp: '<name>'})`.
  public async getAvailablePerps(): Promise<string[]> {
    await this.ensureUniverseLoaded();
    return Array.from(this.universeByName!.keys()).sort();
  }

  /// @notice Async perp symbol → index resolver. Uses the hardcoded
  /// `PERP_INDEX` for fast-path on the well-known 16 perps; falls back
  /// to a live HL Info lookup for everything else. Numeric indices are
  /// passed through unchanged.
  ///
  /// @dev Used internally by `openPosition`/`closePosition`/`placeOrder`/
  /// `setLeverage`/`addIsolatedMargin` so the caller can use any of the
  /// 230 main-dex perp names.
  public async resolvePerp(perp: PerpSymbol | string | number): Promise<number> {
    if (typeof perp === 'number') {
      if (!Number.isInteger(perp) || perp < 0) {
        throw new HLPreflightError('unknown-perp', `invalid perp index ${perp}`, { perp });
      }
      return perp;
    }
    if (perp in PERP_INDEX) return PERP_INDEX[perp as PerpSymbol];
    await this.ensureUniverseLoaded();
    const hit = this.universeByName!.get(perp);
    if (!hit) {
      throw new HLPreflightError(
        'unknown-perp',
        `unknown perp symbol "${perp}". Use getAvailablePerps() for the full list.`,
        { perp },
      );
    }
    return hit.index;
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

  /// @notice Fetch the live asset universe from HL Info API. Useful for
  /// discovering all perps available, including HIP-3 builder dexes like
  /// `xyz` (which carries non-crypto assets: BRENTOIL, GOLD, COPPER,
  /// AAPL, etc).
  ///
  /// @param dex Which perp dex to query.
  ///   - `'main'` (default): the canonical HL perp dex (230+ crypto perps).
  ///   - `'xyz'`: the xyz builder dex (75 mixed: commodities, stocks, FX, ...).
  ///   - any other string: passed through as a builder dex name to HL.
  /// @returns Array of `{ index, name, szDecimals, maxLeverage,
  ///                       onlyIsolated, markPx? }` ordered by asset index
  ///          within the dex (NOT the global asset index — builder dexes
  ///          use a separate namespace).
  ///
  /// @dev Trading on builder dexes (`dex !== 'main'`) is NOT YET supported
  /// by this SDK's `openPosition` / `closePosition` — HIP-3 needs distinct
  /// CoreWriter routing. This method is read-only discovery for now.
  /// @notice List ALL HyperLiquid perp dexes (main + builder dexes) with
  /// index, name, type, asset count and metadata. Single HL Info round-trip
  /// (`perpDexs`). Use this to discover what trading venues exist on HL
  /// without hardcoding names. `index 0` is always the main dex (encoded as
  /// `null` upstream, normalised to `'main'` here).
  ///
  /// @returns Array `[{ index, name, type, deployer?, feeRecipient?,
  ///                    assetCount }]` in HL's canonical order. The
  ///          `index` doubles as the `perpDexIndex` used by the on-chain
  ///          adapter for cross-dex USDC transfers (action 13 sendAsset).
  public async listDexes(opts: { includeUnsupported?: boolean } = {}): Promise<
    Array<{
      index: number;
      name: string;
      type: 'main' | 'builder';
      deployer?: string;
      feeRecipient?: string;
      assetCount: number;
      supported: boolean;
    }>
  > {
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');
    const res = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'perpDexs' }),
    });
    if (!res.ok) throw new Error(`HL info perpDexs failed: ${res.status} ${res.statusText}`);
    const raw = (await res.json()) as Array<{
      name: string;
      deployer?: string;
      feeRecipient?: string;
      assetToStreamingOiCap?: Array<[string, string]>;
    } | null>;
    const all = raw.map((d, i) => {
      const name = d?.name ?? 'main';
      const supported = SUPPORTED_PERP_DEXES.has(name);
      if (!d) {
        return { index: i, name: 'main', type: 'main' as const, assetCount: 0, supported };
      }
      return {
        index: i,
        name,
        type: 'builder' as const,
        deployer: d.deployer,
        feeRecipient: d.feeRecipient,
        assetCount: d.assetToStreamingOiCap?.length ?? 0,
        supported,
      };
    });
    return opts.includeUnsupported ? all : all.filter((d) => d.supported);
  }

  /// @notice Full market map: every dex × every asset in one structure.
  /// Use this for UI dropdowns, dashboards, or any 'show me what I can
  /// trade'-style flow. Fetches `perpDexs` (1 call) + `metaAndAssetCtxs`
  /// per dex (N parallel calls). Total ~N+1 HTTP round-trips for N dexes.
  /// Currently ~9 dexes → 10 round-trips, completes in <1s.
  ///
  /// For per-dex `assetCount` only (no asset details), use `listDexes()`.
  /// For a single dex's assets, use `listPerps(dexName)`.
  public async getMarketMap(opts: { includeUnsupported?: boolean } = {}): Promise<
    Array<{
      dex: { index: number; name: string; type: 'main' | 'builder' };
      assets: Array<{
        index: number;
        name: string;
        szDecimals: number;
        maxLeverage: number;
        onlyIsolated: boolean;
        markPx?: number;
      }>;
    }>
  > {
    const dexes = await this.listDexes(opts);
    const withAssets = await Promise.all(
      dexes.map(async (d) => {
        const assets = await this.listPerps(d.name === 'main' ? 'main' : d.name);
        return {
          dex: { index: d.index, name: d.name, type: d.type },
          assets,
        };
      }),
    );
    return withAssets;
  }

  public async listPerps(
    dex: 'main' | 'xyz' | string = 'main',
  ): Promise<
    Array<{
      index: number;
      name: string;
      szDecimals: number;
      maxLeverage: number;
      onlyIsolated: boolean;
      markPx?: number;
    }>
  > {
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');
    const body =
      dex === 'main'
        ? { type: 'metaAndAssetCtxs' }
        : { type: 'metaAndAssetCtxs', dex };
    const res = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HL info failed: ${res.status} ${res.statusText}`);
    }
    const parsed = (await res.json()) as
      | [{ universe: any[] }, any[]]
      | { universe: any[] };
    const meta = Array.isArray(parsed) ? parsed[0] : parsed;
    const ctxs = Array.isArray(parsed) ? parsed[1] : [];
    return meta.universe.map((u: any, i: number) => ({
      index: i,
      name: u.name,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      onlyIsolated: u.onlyIsolated ?? false,
      markPx: ctxs[i]?.markPx ? Number(ctxs[i].markPx) : undefined,
    }));
  }

  /// @notice Fetch the live HL spot token universe (USDC plus PURR/HYPE/
  /// XAUT0/XAUM/... gold tokens etc).
  public async listSpotTokens(): Promise<
    Array<{
      index: number;
      name: string;
      szDecimals: number;
      weiDecimals: number;
      evmContract?: string;
    }>
  > {
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');
    const res = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'spotMeta' }),
    });
    if (!res.ok) {
      throw new Error(`HL info failed: ${res.status} ${res.statusText}`);
    }
    const parsed = (await res.json()) as {
      tokens: Array<{
        index: number;
        name: string;
        szDecimals: number;
        weiDecimals: number;
        evmContract?: { address: string };
      }>;
    };
    return parsed.tokens.map((t) => ({
      index: t.index,
      name: t.name,
      szDecimals: t.szDecimals,
      weiDecimals: t.weiDecimals,
      evmContract: t.evmContract?.address,
    }));
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

  // -------------------------------------------------------------------------
  // Cross-dex USDC movement (sendAsset action 13)
  // -------------------------------------------------------------------------

  /// @notice Encoding of HL ledger indices used by `sendAsset` /
  /// `transferUsdcBetweenLedgers`. Main HL perp = 0; xyz builder dex = 1;
  /// spot = 0xFFFFFFFF (uint32.max).
  public static readonly DEX_MAIN = 0;
  public static readonly DEX_XYZ = 1;
  public static readonly DEX_SPOT = 0xffffffff;

  /// @notice Move USDC between any two HL ledgers within the vault's
  /// own HL identity. Covers:
  ///   main perp ⇄ xyz perp   (fund a builder dex for HIP-3 trading)
  ///   main perp ⇄ spot       (alternative to `withdrawFromPerp` action 7)
  ///   xyz perp  ⇄ spot
  ///
  /// EMPIRICAL: HL expects amount in **8-decimal** USDC scale for ALL
  /// ledger pairs (even perp→perp where both are 6-dec on the inside).
  /// HL converts on the destination. Caller passes a decimal USD string
  /// (e.g. `'1.50'`) and the SDK does `parseUnits(amount, 8)`.
  public transferUsdcBetweenLedgers(args: {
    srcDex: number;
    dstDex: number;
    usdcAmount: string; // decimal string in USD (e.g. '1.50')
  }): SendTransactionParams {
    if (args.srcDex === args.dstDex) {
      throw new HLPreflightError('invalid-input', `srcDex == dstDex (${args.srcDex})`);
    }
    return this.executeByManager([
      encodeTransferUsdcBetweenLedgers(this.addresses.adapter, {
        srcDex: args.srcDex,
        dstDex: args.dstDex,
        amountWei8dec: usdcSpotWei(args.usdcAmount),
      }),
    ]);
  }

  /// @notice Convenience: move USDC from main HL perp to xyz builder
  /// dex. Use this to fund HIP-3 trading on `xyz:GOLD`, `xyz:BRENTOIL`,
  /// etc. After the trade, call `transferFromBuilderDex` to bring the
  /// USDC back.
  public transferToBuilderDex(args: {
    dex?: 'xyz';
    usdcAmount: string;
  }): SendTransactionParams {
    const dexName = args.dex ?? 'xyz';
    if (dexName !== 'xyz') {
      throw new HLPreflightError(
        'unknown-perp',
        `unsupported builder dex: ${dexName}`,
      );
    }
    return this.transferUsdcBetweenLedgers({
      srcDex: HLVault.DEX_MAIN,
      dstDex: HLVault.DEX_XYZ,
      usdcAmount: args.usdcAmount,
    });
  }

  /// @notice Inverse of `transferToBuilderDex`. Sweeps USDC from builder
  /// dex back to main HL perp.
  public transferFromBuilderDex(args: {
    dex?: 'xyz';
    usdcAmount: string;
  }): SendTransactionParams {
    const dexName = args.dex ?? 'xyz';
    if (dexName !== 'xyz') {
      throw new HLPreflightError(
        'unknown-perp',
        `unsupported builder dex: ${dexName}`,
      );
    }
    return this.transferUsdcBetweenLedgers({
      srcDex: HLVault.DEX_XYZ,
      dstDex: HLVault.DEX_MAIN,
      usdcAmount: args.usdcAmount,
    });
  }

  // -------------------------------------------------------------------------
  // HIP-3 builder-dex user-account initialisation
  // -------------------------------------------------------------------------

  /// @notice Read a HIP-3 builder dex's collateral (quote) token index.
  /// Each HIP-3 dex picks its own quote token at deploy time:
  ///   - xyz:  collateralToken=0   (USDC) — matches main, no extra collateral needed
  ///   - flx:  collateralToken=360 (USDH)
  ///   - vntl: collateralToken=360 (USDH)
  ///   - km:   collateralToken=360 (USDH)
  ///   - hyna: collateralToken=235 (USDE)
  ///   - cash: collateralToken=268 (USDT0)
  ///
  /// CoreWriter action 13 (`sendAsset` / `transferUsdcBetweenLedgers`) on the
  /// FACTOR adapter is HARDCODED to `token=0` (USDC). It SILENTLY SUCCEEDS
  /// on the EVM side but HL drops the action when src/dst collateral
  /// tokens disagree — i.e. main→vntl with USDC fails because vntl
  /// expects USDH. Diagnostic verified on mainnet 2026-05-14.
  public async getDexCollateralToken(dexName: string): Promise<number> {
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');
    const res = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: dexName }),
    });
    if (!res.ok) {
      throw new Error(`HL info metaAndAssetCtxs(${dexName}) failed: ${res.status}`);
    }
    const parsed = (await res.json()) as [{ collateralToken?: number }, unknown];
    const meta = Array.isArray(parsed) ? parsed[0] : (parsed as { collateralToken?: number });
    return meta.collateralToken ?? 0;
  }

  /// @notice Initialise the vault's HyperLiquid user-account on a HIP-3
  /// builder dex so that subsequent trading / sendAsset operations
  /// against that dex are honored by HL.
  ///
  /// Empirically (mainnet 2026-05-14) the missing primitive on a "fresh"
  /// HIP-3 dex is NOT a registration action — it's collateral-token
  /// alignment. The fix is:
  ///
  ///   1. Probe the dex's `collateralToken` via `metaAndAssetCtxs`.
  ///   2. If `collateralToken == 0` (USDC), the existing on-chain
  ///      `transferUsdcBetweenLedgers` is sufficient (xyz path).
  ///   3. If `collateralToken != 0`, the vault must hold the matching
  ///      spot token and CoreWriter action 13 must specify it. The
  ///      current v5 adapter HARDCODES token=0 so cross-dex USDH/USDE/
  ///      USDT0 funding is NOT possible on-chain without an adapter
  ///      upgrade. This method surfaces that constraint as a structured
  ///      error so callers can report it accurately.
  ///   4. Additionally calls `agentEnableDexAbstraction` which is HL's
  ///      mechanism to flag the master account as HIP-3-aware. Required
  ///      empirically before HL accepts orders on builder-dex assets
  ///      (otherwise orders are rejected with "User does not exist on
  ///      this dex" or similar). One-time per vault. Charges ~$0.17
  ///      USDC of activation gas on first call (HL's
  ///      `activateDexAbstraction` event).
  ///
  /// Returns a structured report. The caller is responsible for
  /// providing matching collateral via spot-token bridging when
  /// `collateralToken != 0`.
  public async initializeBuilderDex(dexName: string): Promise<{
    success: boolean;
    dexName: string;
    dexIndex: number;
    deployer?: string;
    collateralToken: number;
    collateralRequiresBridge: boolean;
    abstractionEnabled: boolean;
    activationCostUsdc?: number;
    finalAccountValue: number;
    note: string;
  }> {
    // Step 1 — look up dex metadata.
    const dexes = await this.listDexes({ includeUnsupported: true });
    const dex = dexes.find((d) => d.name === dexName);
    if (!dex) {
      throw new HLPreflightError('unknown-perp', `unknown HL perp dex: ${dexName}`, {
        perp: dexName,
      });
    }
    if (dex.type === 'main') {
      throw new HLPreflightError(
        'invalid-input',
        'initializeBuilderDex is not applicable to the main dex',
      );
    }

    const collateralToken = await this.getDexCollateralToken(dexName);
    const collateralRequiresBridge = collateralToken !== 0;

    // Step 2 — current state on the dex (before any action).
    const beforeAcct = await this.readDexAccountValue(dexName);

    // Step 3 — call agentEnableDexAbstraction (idempotent: HL no-ops if
    // already enabled, charges fee only on first activation per dex).
    // Probe the current abstraction state first so we can report
    // "already on" vs. "just enabled" vs. "failed to enable" clearly,
    // without conflating the three.
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');
    const stateRes = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'userAbstraction', user: this.vaultAddress }),
    });
    const priorAbstraction =
      stateRes.ok ? ((await stateRes.json()) as string) : 'unknown';

    let abstractionEnabled = priorAbstraction === 'dexAbstraction';
    let activationCostUsdc: number | undefined;
    if (!abstractionEnabled) {
      try {
        await this.exchange.agentEnableDexAbstraction();
        abstractionEnabled = true;
        // HL's `activateDexAbstraction` ledger event records the fee
        // amount; we don't poll for it here to keep this method cheap.
        // Caller can read `userNonFundingLedgerUpdates` if they care.
        activationCostUsdc = undefined;
      } catch (e) {
        // Agent-not-fresh / not authorized / network / etc. Surface as
        // note rather than failing the whole flow — the operator may
        // still be able to use the dex even without abstraction (xyz
        // path with `default` mode + USDC collateral).
        abstractionEnabled = false;
      }
    }

    // Step 4 — poll for credit IF the on-chain path is viable (USDC dex).
    let finalAccountValue = beforeAcct;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && finalAccountValue === beforeAcct) {
      await new Promise((r) => setTimeout(r, 5_000));
      finalAccountValue = await this.readDexAccountValue(dexName);
    }

    const note = collateralRequiresBridge
      ? `Dex "${dexName}" uses non-USDC collateral (token ${collateralToken}). On-chain transferUsdcBetweenLedgers is hardcoded to USDC=0 and cannot fund this dex. The vault must acquire the matching spot token (e.g. USDH for vntl/flx/km) and a new adapter function transferAssetBetweenLedgers(token, srcDex, dstDex, amount) needs to be deployed. Until then, this dex is read-only.`
      : `Dex "${dexName}" uses USDC collateral — standard transferToBuilderDex / transferUsdcBetweenLedgers should now credit. agentEnableDexAbstraction status: ${abstractionEnabled ? 'OK' : 'failed'}.`;

    return {
      success: !collateralRequiresBridge && abstractionEnabled,
      dexName,
      dexIndex: dex.index,
      deployer: dex.deployer,
      collateralToken,
      collateralRequiresBridge,
      abstractionEnabled,
      activationCostUsdc,
      finalAccountValue,
      note,
    };
  }

  /// @notice Read accountValue on a named perp dex via HL Info API. Used
  /// by `initializeBuilderDex` polling.
  private async readDexAccountValue(dexName: string): Promise<number> {
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');
    const r = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: this.vaultAddress, dex: dexName }),
    });
    if (!r.ok) return 0;
    const cs = (await r.json()) as { marginSummary?: { accountValue?: string } };
    return Number(cs.marginSummary?.accountValue ?? '0');
  }

  /// @notice Read the vault's balance on a specific HL perp dex
  /// (`accountValue` from `accountMarginSummary`). Useful for sizing
  /// cross-dex transfers without losing precision.
  public async getAccountValue(perpDexIndex: number): Promise<bigint> {
    // SDK uses the precompile directly via the raw call helper; main dex
    // is exposed via getNav().perpEquity. For arbitrary perpDexIndex,
    // re-call the precompile.
    const { readAccountMarginSummary } = await import('./precompiles.js');
    const ams = await readAccountMarginSummary(this.client, this.vaultAddress);
    void perpDexIndex; // currently main only; xyz path uses Info API below
    return ams.accountValue;
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
    const perp = await this.resolvePerp(args.perp);
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
    let sizeWire = sizeUsdToWire(args.sizeUsd, markReal, info.szDecimals);
    // Auto-bump size up by one lot if the lot-floored notional lands
    // under HL's $10 min-notional. Same fix as openPositionOffChain —
    // a flat sizeUsd=10 with NVDA-class assets can floor to $9.79 and
    // CoreWriter silently drops the limitOrder action. See README §3.
    const lotStepWire = 10n ** BigInt(8 - info.szDecimals);
    const minNotionalWire = BigInt(Math.floor(HL_MIN_NOTIONAL_USD * 1.005 * 1e8));
    const notionalWire = (sizeWire * limitPxWire) / 10n ** 8n;
    if (sizeWire > 0n && notionalWire < minNotionalWire) {
      sizeWire += lotStepWire;
    }
    if (sizeWire <= 0n) {
      const minNeeded = HL_MIN_NOTIONAL_USD + markReal * Number(lotStepWire) / 1e8 + 0.05;
      throw new HLPreflightError(
        'min-notional',
        `sizeUsd ${args.sizeUsd} too small for ${info.coin}: lot-floor at mark ${markReal.toFixed(2)} yields $0 notional. Pass at least sizeUsd=${minNeeded.toFixed(2)}.`,
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
      // Pre-flight IOC band MUST use the platform minimum (HL_IOC_MIN_BAND_BPS,
      // 1000bps = 10%), NOT the user's aggressiveness target. The user's
      // `slippageBps` is the TARGET past-mark distance — `alignIocLimit` aims
      // at that and then tick-rounds. After rounding the limit can land
      // slightly inside the target (e.g. BTC at integer ticks): that's fine
      // as long as it still clears the platform minimum.
      bandBps: undefined,
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
    const perp = await this.resolvePerp(args.perp);
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
    // Size from LIMIT price (worst-case fill) rather than mark so the
    // notional check against `limitPx × size` clears `MIN_NOTIONAL` even
    // when the IOC limit is FAR from mark (sell-close has limit < mark,
    // buy-close has limit > mark — both work out to notional ≈ sizeUsd).
    const sizeWire = sizeUsdToWire(args.sizeUsd, limitPxReal, info.szDecimals);
    if (sizeWire <= 0n) {
      throw new HLPreflightError(
        'min-notional',
        `computed sizeWire is 0 — sizeUsd ${args.sizeUsd} too small for lot step at limit ${limitPxReal}`,
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
      // Use platform minimum (HL_IOC_MIN_BAND_BPS), NOT user's slippage target.
      // See openPosition comment for the rationale.
      bandBps: undefined,
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
    const perp = await this.resolvePerp(args.perp);
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

  public async cancelOrder(args: {
    perp: PerpSymbol | string | number;
    cloid: bigint;
  }): Promise<SendTransactionParams> {
    return this.executeByManager([
      encodeCancelOrder(this.addresses.adapter, {
        perp: await this.resolvePerp(args.perp),
        cloid: args.cloid,
      }),
    ]);
  }

  public async syncPosition(perp: PerpSymbol | string | number): Promise<SendTransactionParams> {
    return this.executeByManager([
      encodeSyncPosition(this.addresses.adapter, await this.resolvePerp(perp)),
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

  /// @notice `setMaxKnownBuilderDex` is owner-only on the adapter — wraps
  /// in `executeByOwner`. Bumps the on-chain ceiling for
  /// `transferUsdcBetweenLedgers` destination dex. Bumping this here does
  /// NOT auto-update the SDK `SUPPORTED_PERP_DEXES` whitelist — that is a
  /// separate product decision. Sanity-capped at 100.
  public setMaxKnownBuilderDex(newMax: number): SendTransactionParams {
    if (!Number.isInteger(newMax) || newMax < 0 || newMax > 100) {
      throw new Error(
        `setMaxKnownBuilderDex: newMax must be an integer in [0, 100] (got ${newMax})`,
      );
    }
    return this.executeByOwner([
      encodeSetMaxKnownBuilderDex(this.addresses.adapter, newMax),
    ]);
  }

  // -------------------------------------------------------------------------
  // Off-chain (HL Exchange API)
  // -------------------------------------------------------------------------

  /// @notice Set DEFAULT leverage for `perp` (DOES NOT change existing
  /// positions — HL semantics). Signed by `agentSigner` and posted to
  /// `api.hyperliquid.xyz/exchange`.
  public async setLeverage(
    perp: PerpSymbol | string | number,
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
      asset: await this.resolvePerp(perp),
      isCross: mode === 'cross',
      leverage,
    });
  }

  /// @notice Add (positive) or remove (negative) isolated margin on an
  /// open position. `deltaUsd` is in 6-dec USDC; converted to HL's
  /// `ntli` wire scale (also 6-dec, signed).
  public async addIsolatedMargin(
    perp: PerpSymbol | string | number,
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
      asset: await this.resolvePerp(perp),
      isBuy: isLong,
      ntli,
    });
  }

  // -------------------------------------------------------------------------
  // HIP-3 builder-dex trading (off-chain via Exchange API)
  // -------------------------------------------------------------------------

  /// @notice Resolve a builder-dex symbol like `'xyz:GOLD'` to its global
  /// asset index per HL HIP-3: `asset = 100000 + perp_dex_index * 10000 +
  /// asset_idx_within_dex`. Cached for `BUILDER_DEX_TTL_MS` (5 min);
  /// on TTL expiry we revalidate against `perpDexs` to confirm the dex
  /// name/index still maps before returning the cached resolution.
  ///
  /// NOTE on `markPxReal`: this is captured at FIRST resolution and
  /// kept in the cache for the lifetime of the entry. It's good
  /// enough for the min-notional preflight in `openPositionOffChain`,
  /// but callers needing a live mark for limit-price computation
  /// MUST re-fetch via `metaAndAssetCtxs` (see `closePositionOffChain`).
  public async resolveBuilderDex(symbol: string): Promise<{ globalAsset: number; szDecimals: number; maxLeverage: number; markPxReal: number }> {
    const colon = symbol.indexOf(':');
    if (colon < 0) throw new HLPreflightError('unknown-perp', `not a builder-dex symbol: ${symbol}`, { perp: symbol });
    const dexName = symbol.slice(0, colon);
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');

    const now = Date.now();
    const cached = this.builderDexCache.get(symbol);
    if (cached) {
      if (cached.expiresAt > now) {
        // Fresh — return as-is.
        return cached.value;
      }
      // Stale: cheap single-call revalidation against `perpDexs` to
      // confirm the dex name still exists at the same index. If the
      // builder dex was delisted or reindexed, every cached
      // `globalAsset` for that symbol is wrong — fall through to a
      // full re-resolution OR throw if the dex disappeared.
      const dexsRes = await this.exchange.fetchImpl(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'perpDexs' }),
      });
      const dexs = (await dexsRes.json()) as Array<{ name: string } | null>;
      const liveIdx = dexs.findIndex((d) => d?.name === cached.dexName);
      if (liveIdx === cached.dexIdx) {
        // Still maps — extend TTL without re-fetching the universe.
        cached.expiresAt = now + HLVault.BUILDER_DEX_TTL_MS;
        return cached.value;
      }
      // Mismatch (or removed): invalidate and let the full path either
      // re-resolve cleanly or surface `unknown-perp`.
      this.builderDexCache.delete(symbol);
      if (liveIdx < 0) {
        throw new HLPreflightError('unknown-perp', `builder dex ${cached.dexName} no longer registered`, { perp: symbol });
      }
      // dexIdx shifted — fall through to full re-resolution.
    }

    // Full resolution path.
    // Need: perp_dex_index of `dexName` + asset_idx of `symbol` in that dex's universe.
    // Step 1: perpDexs lists all dexes by name in order (slot 0 = main = null).
    const dexsRes = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'perpDexs' }),
    });
    const dexs = (await dexsRes.json()) as Array<{ name: string } | null>;
    const dexIdx = dexs.findIndex((d) => d?.name === dexName);
    if (dexIdx < 0) throw new HLPreflightError('unknown-perp', `unknown perp dex: ${dexName}`, { perp: symbol });
    // Step 2: list assets within that dex.
    const dexPerps = await this.listPerps(dexName);
    const hit = dexPerps.find((p) => p.name === symbol);
    if (!hit) throw new HLPreflightError('unknown-perp', `${symbol} not found in dex ${dexName}`, { perp: symbol });
    const value = {
      globalAsset: 100_000 + dexIdx * 10_000 + hit.index,
      szDecimals: hit.szDecimals,
      maxLeverage: hit.maxLeverage,
      markPxReal: hit.markPx ?? 0,
    };
    this.builderDexCache.set(symbol, {
      value,
      dexIdx,
      dexName,
      expiresAt: now + HLVault.BUILDER_DEX_TTL_MS,
    });
    return value;
  }

  /// @notice Fetch a LIVE mark for a builder-dex perp. Used by close
  /// flows where stale-cached mark would mis-price the IOC limit and
  /// cause partial / unfilled close orders. Reuses the same
  /// `metaAndAssetCtxs` path as `listPerps` but only round-trips once
  /// and only extracts the one mark.
  private async getBuilderDexMarkPxReal(symbol: string): Promise<number> {
    const colon = symbol.indexOf(':');
    if (colon < 0) throw new HLPreflightError('unknown-perp', `not a builder-dex symbol: ${symbol}`, { perp: symbol });
    const dexName = symbol.slice(0, colon);
    const dexPerps = await this.listPerps(dexName);
    const hit = dexPerps.find((p) => p.name === symbol);
    if (!hit) throw new HLPreflightError('unknown-perp', `${symbol} not found in dex ${dexName}`, { perp: symbol });
    if (!hit.markPx || hit.markPx <= 0) {
      throw new HLPreflightError('invalid-input', `no mark for ${symbol}`, { perp: symbol });
    }
    return hit.markPx;
  }

  /// @notice Open a position on a builder-dex perp (xyz:GOLD, xyz:BRENTOIL,
  /// xyz:AAPL, etc) via the HL Exchange API. Same surface as
  /// `openPosition` but routes through the off-chain agent path because
  /// CoreWriter does not (yet) handle HIP-3 routing.
  ///
  /// Returns the HL Exchange API response — NOT a `SendTransactionParams`.
  /// No EVM tx involved; the agent signs the action off-chain and HL
  /// applies it directly against the vault's HL account.
  public async openPositionOffChain(args: {
    perp: string; // builder-dex qualified, e.g. 'xyz:GOLD'
    isLong: boolean;
    sizeUsd: number;
    slippageBps?: number;
  }): Promise<HlExchangeResponse> {
    const info = await this.resolveBuilderDex(args.perp);
    if (info.markPxReal <= 0) throw new HLPreflightError('invalid-input', `no mark for ${args.perp}`, { perp: args.perp });
    // Compute IOC limit + size in REAL units (HL exchange API uses
    // decimal strings, NOT 1e8 wire scale).
    const bandBps = args.slippageBps ?? 1500;
    const limitReal = args.isLong
      ? info.markPxReal * (1 + bandBps / 10_000)
      : info.markPxReal * (1 - bandBps / 10_000);
    const limitRounded = tickRound(limitReal, info.szDecimals);
    // Size = lot-floored quantity that hits sizeUsd. HL has TWO independent
    // constraints we must clear simultaneously:
    //   (1) lot precision: size must be a multiple of 10^-szDecimals
    //   (2) min-notional: size × markPx must be ≥ MIN_NOTIONAL ($10)
    // Naively flooring sizeRaw can produce a notional UNDER $10 (e.g.
    // sizeUsd=10 at NVDA mark $233 floors to 0.042 → $9.79 notional,
    // silently rejected with "Order must have minimum value of $10").
    // We auto-bump to the next lot above MIN_NOTIONAL + 0.5% safety buffer.
    const lotStep = 10 ** -info.szDecimals;
    let sizeFloored = Math.floor((args.sizeUsd / info.markPxReal) / lotStep) * lotStep;
    const effectiveNotional = sizeFloored * info.markPxReal;
    const minNotionalCushion = HL_MIN_NOTIONAL_USD * 1.005;
    if (sizeFloored > 0 && effectiveNotional < minNotionalCushion) {
      sizeFloored += lotStep;
    }
    if (sizeFloored <= 0 || sizeFloored * info.markPxReal < HL_MIN_NOTIONAL_USD) {
      throw new HLPreflightError(
        'min-notional',
        `sizeUsd ${args.sizeUsd} too small for ${args.perp}: lot-floor at mark ${info.markPxReal.toFixed(2)} yields ${(sizeFloored * info.markPxReal).toFixed(2)} < $${HL_MIN_NOTIONAL_USD} min. Pass at least sizeUsd=${(HL_MIN_NOTIONAL_USD + info.markPxReal * lotStep + 0.05).toFixed(2)}.`,
        { notionalUsd: args.sizeUsd },
      );
    }
    return this.exchange.placeOrder({
      asset: info.globalAsset,
      isBuy: args.isLong,
      limitPxReal: String(limitRounded),
      sizeReal: hlFormatDecimal(sizeFloored, info.szDecimals),
      reduceOnly: false,
      tif: 'Ioc',
    });
  }

  /// @notice Close (reduce-only) a builder-dex position. Reads the
  /// current position via HL Info API (no precompile available for
  /// builder dexes). `sizeUsd` is best-effort; pass current position
  /// notional for a full close, or smaller for partial.
  public async closePositionOffChain(args: {
    perp: string;
    sizeUsd: number;
    slippageBps?: number;
  }): Promise<HlExchangeResponse> {
    const info = await this.resolveBuilderDex(args.perp);
    // `info.markPxReal` comes from `resolveBuilderDex` which is cached
    // up to BUILDER_DEX_TTL_MS — fine for the min-notional preflight
    // (sizing is a rough sanity check anyway) but NOT for limit-price
    // computation, where a stale mark can put the IOC band the wrong
    // side of true price and cause an unfilled close. Re-fetch the
    // live mark for the limit and keep the cached mark for preflight.
    if (info.markPxReal <= 0) throw new HLPreflightError('invalid-input', `no mark for ${args.perp}`, { perp: args.perp });
    // Read current position via clearinghouseState (dex-aware).
    const dexName = args.perp.split(':')[0];
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');
    const [csRes, markRealLive] = await Promise.all([
      this.exchange.fetchImpl(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', dex: dexName, user: this.vaultAddress }),
      }),
      this.getBuilderDexMarkPxReal(args.perp),
    ]);
    const cs = (await csRes.json()) as { assetPositions?: Array<{ position: { coin: string; szi: string } }> };
    // HL returns the FULL qualified coin name (e.g. 'xyz:GOLD'), not the
    // bare symbol after the colon — match against args.perp directly.
    const pos = cs.assetPositions?.find((p) => p.position.coin === args.perp);
    if (!pos || Number(pos.position.szi) === 0) {
      throw new HLPreflightError('invalid-input', `no open position on ${args.perp}`, { perp: args.perp });
    }
    const sziAbs = Math.abs(Number(pos.position.szi));
    const isLong = Number(pos.position.szi) > 0;
    // Widened default IOC band 1500 → 3000 bps. Mirrors the change in
    // buildClosePositionOffChainAction below — see the longer comment
    // there. Same dust-residual failure mode this side too.
    const bandBps = args.slippageBps ?? 3000;
    // Close side flips: long → sell, short → buy.
    const isClosingBuy = !isLong;
    // Use the FRESH mark for limit-price band so an old cached mark
    // can't drag the IOC limit to the wrong side of true price.
    const limitReal = isClosingBuy
      ? markRealLive * (1 + bandBps / 10_000)
      : markRealLive * (1 - bandBps / 10_000);
    const limitRounded = tickRound(limitReal, info.szDecimals);
    // Preflight min-notional uses the cached mark (it's good enough as
    // a "did the user pass something absurdly small?" check).
    const sizeRaw = args.sizeUsd / info.markPxReal;
    const lotStep = 10 ** -info.szDecimals;
    let sizeFloored = Math.floor(sizeRaw / lotStep) * lotStep;
    // Heuristic full-close: with the wider 3000 bps band, snap to the
    // actual position any time the rounded computation reaches ≥95%
    // of szi. The widened threshold (was 0.99) avoids leaving dust
    // when mark moves between the caller's fetch and our pricing.
    if (sizeFloored >= sziAbs * 0.95) {
      sizeFloored = sziAbs;
    }
    if (sizeFloored <= 0) {
      throw new HLPreflightError('min-notional', `sizeUsd too small for ${args.perp} lot`, { notionalUsd: args.sizeUsd });
    }
    return this.exchange.placeOrder({
      asset: info.globalAsset,
      isBuy: isClosingBuy,
      limitPxReal: String(limitRounded),
      sizeReal: hlFormatDecimal(sizeFloored, info.szDecimals),
      reduceOnly: true,
      tif: 'Ioc',
    });
  }

  /// @notice Build an UNSIGNED HL Exchange `order` action that opens a
  /// position on a builder-dex perp (`xyz:GOLD`, `xyz:AAPL`, …). Returns
  /// the canonical action object plus nonce + vault address — the caller
  /// is expected to ship this to a remote signer (typically the kairos
  /// signing-service `/sign-hl-exchange` route) which holds the agent
  /// private key, then POST the signed envelope to HL's exchange API.
  ///
  /// This is the stateless-mode equivalent of `openPositionOffChain` —
  /// same preflight (mark resolution, min-notional, lot-floor, IOC band),
  /// same canonical key order, but produces NO signature. Used by
  /// factor-mcp tools when `STATELESS_MODE=true` and the SDK cannot
  /// access a private key locally.
  ///
  /// The returned `action` is shaped exactly as HL expects (msgpack
  /// canonical insertion order `{type, orders, grouping}`), so the
  /// signing service can hash it with `connectionId(...)` and the
  /// signature will recover to the correct agent EOA.
  public async buildOpenPositionOffChainAction(args: {
    perp: string; // builder-dex qualified, e.g. 'xyz:NVDA'
    isLong: boolean;
    sizeUsd: number;
    slippageBps?: number;
  }): Promise<{
    action: {
      type: 'order';
      orders: Array<{
        a: number;
        b: boolean;
        p: string;
        s: string;
        r: boolean;
        t: { limit: { tif: 'Ioc' } };
      }>;
      grouping: 'na';
    };
    nonce: number;
    vaultAddress: Address;
    asset: number;
    limitPxReal: string;
    sizeReal: string;
    sizeUsdEffective: number;
    markPxReal: number;
  }> {
    const info = await this.resolveBuilderDex(args.perp);
    if (info.markPxReal <= 0) {
      throw new HLPreflightError('invalid-input', `no mark for ${args.perp}`, { perp: args.perp });
    }
    const bandBps = args.slippageBps ?? 1500;
    const limitReal = args.isLong
      ? info.markPxReal * (1 + bandBps / 10_000)
      : info.markPxReal * (1 - bandBps / 10_000);
    const limitRounded = tickRound(limitReal, info.szDecimals);
    // Mirror of the sizing logic in `openPositionOffChain` — lot-floor +
    // min-notional auto-bump. See that method for the rationale.
    const lotStep = 10 ** -info.szDecimals;
    let sizeFloored = Math.floor((args.sizeUsd / info.markPxReal) / lotStep) * lotStep;
    const effectiveNotional = sizeFloored * info.markPxReal;
    const minNotionalCushion = HL_MIN_NOTIONAL_USD * 1.005;
    if (sizeFloored > 0 && effectiveNotional < minNotionalCushion) {
      sizeFloored += lotStep;
    }
    if (sizeFloored <= 0 || sizeFloored * info.markPxReal < HL_MIN_NOTIONAL_USD) {
      throw new HLPreflightError(
        'min-notional',
        `sizeUsd ${args.sizeUsd} too small for ${args.perp}: lot-floor at mark ${info.markPxReal.toFixed(2)} yields ${(sizeFloored * info.markPxReal).toFixed(2)} < $${HL_MIN_NOTIONAL_USD} min. Pass at least sizeUsd=${(HL_MIN_NOTIONAL_USD + info.markPxReal * lotStep + 0.05).toFixed(2)}.`,
        { notionalUsd: args.sizeUsd },
      );
    }
    const limitPxReal = String(limitRounded);
    const sizeReal = hlFormatDecimal(sizeFloored, info.szDecimals);
    // Canonical key order — MUST match the exchange.ts `canonicalizeAction`
    // path so the signing service computes the same connection id.
    const action = {
      type: 'order' as const,
      orders: [
        {
          a: info.globalAsset,
          b: args.isLong,
          p: limitPxReal,
          s: sizeReal,
          r: false,
          t: { limit: { tif: 'Ioc' as const } },
        },
      ],
      grouping: 'na' as const,
    };
    return {
      action,
      nonce: Date.now(),
      vaultAddress: this.vaultAddress,
      asset: info.globalAsset,
      limitPxReal,
      sizeReal,
      sizeUsdEffective: sizeFloored * info.markPxReal,
      markPxReal: info.markPxReal,
    };
  }

  /// @notice Stateless-mode counterpart to `setLeverage`. Builds the
  /// `updateLeverage` L1 action without a signer. Caller (agent-executor)
  /// routes the returned envelope to signing-service `/sign-hl-exchange`
  /// for signing + POSTing to `https://api.hyperliquid.xyz/exchange`.
  public async buildSetLeverageOffChainAction(args: {
    perp: string; // 'BTC' / 'ETH' (main) or 'xyz:NVDA' (builder dex)
    leverage: number;
    isCross: boolean;
  }): Promise<{
    action: {
      type: 'updateLeverage';
      asset: number;
      isCross: boolean;
      leverage: number;
    };
    nonce: number;
    vaultAddress: Address;
    asset: number;
  }> {
    if (!Number.isInteger(args.leverage) || args.leverage < 1) {
      throw new HLPreflightError(
        'invalid-input',
        `buildSetLeverageOffChainAction: leverage must be a positive integer (got ${args.leverage})`,
      );
    }
    const asset = await this.resolvePerp(args.perp);
    const action = {
      type: 'updateLeverage' as const,
      asset,
      isCross: args.isCross,
      leverage: args.leverage,
    };
    return {
      action,
      nonce: Date.now(),
      vaultAddress: this.vaultAddress,
      asset,
    };
  }

  /// @notice Stateless-mode counterpart to `closePositionOffChain`. Same
  /// flow: reads the current position via `clearinghouseState`, picks the
  /// reduce-only side, lot-floors the size, and computes the IOC band off
  /// the LIVE mark — but returns the unsigned action for an external
  /// signer instead of signing locally. See
  /// `buildOpenPositionOffChainAction` for the wider rationale.
  public async buildClosePositionOffChainAction(args: {
    perp: string;
    sizeUsd: number;
    slippageBps?: number;
  }): Promise<{
    action: {
      type: 'order';
      orders: Array<{
        a: number;
        b: boolean;
        p: string;
        s: string;
        r: boolean;
        t: { limit: { tif: 'Ioc' } };
      }>;
      grouping: 'na';
    };
    nonce: number;
    vaultAddress: Address;
    asset: number;
    limitPxReal: string;
    sizeReal: string;
    isClosingBuy: boolean;
  }> {
    // Branch on `:` — builder-dex perps are qualified (`xyz:GOLD`), main-dex
    // perps are bare (`BTC`). Builder uses `resolveBuilderDex` (HIP-3 catalog,
    // per-dex globalAsset offset). Main uses the regular perp universe via
    // `resolvePerp` + `getPerpAssetInfo`, with HL Info `clearinghouseState`
    // queried with NO `dex` field (the master account view).
    const isBuilderDex = args.perp.includes(':');
    const baseUrl = this.exchange.endpointUrl.replace('/exchange', '/info');

    let assetIndex: number;
    let markPxReal: number;
    let szDecimals: number;
    let positionCoinKey: string;
    let infoBody: object;

    if (isBuilderDex) {
      const info = await this.resolveBuilderDex(args.perp);
      if (info.markPxReal <= 0) {
        throw new HLPreflightError('invalid-input', `no mark for ${args.perp}`, { perp: args.perp });
      }
      assetIndex = info.globalAsset;
      markPxReal = await this.getBuilderDexMarkPxReal(args.perp);
      szDecimals = info.szDecimals;
      // HL Info returns the qualified `coin: "xyz:GOLD"` on builder dexes.
      positionCoinKey = args.perp;
      const dexName = args.perp.split(':')[0];
      infoBody = { type: 'clearinghouseState', dex: dexName, user: this.vaultAddress };
    } else {
      // Main dex path.
      const perpIdx = await this.resolvePerp(args.perp);
      const assetInfo = await this.getPerpAssetInfo(perpIdx);
      const liveMark = await this.getMarkPxReal(perpIdx);
      if (!Number.isFinite(liveMark) || liveMark <= 0) {
        throw new HLPreflightError('invalid-input', `no mark for ${args.perp}`, { perp: args.perp });
      }
      assetIndex = perpIdx;
      markPxReal = liveMark;
      szDecimals = assetInfo.szDecimals;
      positionCoinKey = assetInfo.coin; // bare ticker, e.g. "BTC"
      // No `dex` field — HL Info treats absence as the main perp ledger.
      infoBody = { type: 'clearinghouseState', user: this.vaultAddress };
    }

    const csRes = await this.exchange.fetchImpl(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(infoBody),
    });
    const cs = (await csRes.json()) as { assetPositions?: Array<{ position: { coin: string; szi: string } }> };
    const pos = cs.assetPositions?.find((p) => p.position.coin === positionCoinKey);
    if (!pos || Number(pos.position.szi) === 0) {
      throw new HLPreflightError('invalid-input', `no open position on ${args.perp}`, { perp: args.perp });
    }
    const sziAbs = Math.abs(Number(pos.position.szi));
    const isLong = Number(pos.position.szi) > 0;
    // Widened default IOC band 1500 → 3000 bps (15% → 30%). The 15% band
    // was leaving sub-atomic dust residuals on volatile/thin-liquidity
    // closes: an IOC at mark ± 15% would fill the inner book depth and
    // cancel the rest, locking the residual at the lot floor (e.g. $0.6
    // on a HYPE close of $14). HL's oracle-floor protection (~10%) is
    // safely inside the wider band, and the wider price tolerance
    // converts the cancelled tail into actual fills — at most a 30 bp
    // slippage cost in chop markets, far less than the dust loss.
    const bandBps = args.slippageBps ?? 3000;
    const isClosingBuy = !isLong;
    const limitReal = isClosingBuy
      ? markPxReal * (1 + bandBps / 10_000)
      : markPxReal * (1 - bandBps / 10_000);
    const limitRounded = tickRound(limitReal, szDecimals);
    const sizeRaw = args.sizeUsd / markPxReal;
    const lotStep = 10 ** -szDecimals;
    let sizeFloored = Math.floor(sizeRaw / lotStep) * lotStep;
    // Same heuristic-full-close as closePositionOffChain — collapse near-
    // full closes to the actual on-chain size so we don't leave dust.
    // Threshold loosened 99% → 95% in lockstep with the wider IOC band:
    // the bigger band reduces partial-fill risk so even slightly less
    // optimistic raw computations can safely snap to the actual position.
    if (sizeFloored >= sziAbs * 0.95) {
      sizeFloored = sziAbs;
    }
    if (sizeFloored <= 0) {
      throw new HLPreflightError(
        'min-notional',
        `sizeUsd too small for ${args.perp} lot`,
        { notionalUsd: args.sizeUsd },
      );
    }
    const limitPxReal = String(limitRounded);
    const sizeReal = hlFormatDecimal(sizeFloored, szDecimals);
    const action = {
      type: 'order' as const,
      orders: [
        {
          a: assetIndex,
          b: isClosingBuy,
          p: limitPxReal,
          s: sizeReal,
          r: true,
          t: { limit: { tif: 'Ioc' as const } },
        },
      ],
      grouping: 'na' as const,
    };
    return {
      action,
      nonce: Date.now(),
      vaultAddress: this.vaultAddress,
      asset: assetIndex,
      limitPxReal,
      sizeReal,
      isClosingBuy,
    };
  }

  /// @notice Cancel an order by cloid via the off-chain HL Exchange API.
  /// Used for HIP-3 builder-dex perps (xyz:GOLD, etc) which CoreWriter
  /// does not route. Main-dex callers should prefer `cancelOrder()`
  /// (on-chain via CoreWriter).
  ///
  /// SAFETY: this method only kills a resting order. It does NOT move
  /// funds — neither to third parties nor between the vault's own accounts.
  ///
  /// @param perp Qualified builder-dex symbol ('xyz:GOLD') OR main-dex
  ///   symbol/index ('ETH' / 0). The presence of ':' is the routing signal.
  /// @param cloid Client order id as 0x-prefixed 32-hex string.
  public async cancelOrderOffChain(args: {
    perp: string | number;
    cloid: string;
  }): Promise<HlExchangeResponse> {
    let asset: number;
    if (typeof args.perp === 'string' && args.perp.includes(':')) {
      const info = await this.resolveBuilderDex(args.perp);
      asset = info.globalAsset;
    } else {
      asset = await this.resolvePerp(args.perp);
    }
    return this.exchange.cancelByCloid(asset, args.cloid);
  }

  /// @notice Place a raw order on a HIP-3 builder dex via the off-chain
  /// HL Exchange API. Caller supplies an exact USD limit price + tif.
  /// Main-dex callers should prefer `placeOrder()` (on-chain via CoreWriter).
  ///
  /// SAFETY: this method routes to the vault's own HL account — it does
  /// NOT move funds to any third party. The position created (if filled)
  /// belongs to the vault.
  ///
  /// Min-notional and lot-floor checks are applied; pass a `sizeUsd` that
  /// clears HL_MIN_NOTIONAL_USD ($10) at the current builder-dex mark.
  public async placeOrderOffChain(args: {
    perp: string;
    isLong: boolean;
    sizeUsd: number;
    limitPxReal: number;
    tif: 'Ioc' | 'Alo' | 'Gtc';
    reduceOnly?: boolean;
    cloid?: string;
  }): Promise<HlExchangeResponse> {
    const info = await this.resolveBuilderDex(args.perp);
    if (info.markPxReal <= 0) {
      throw new HLPreflightError(
        'invalid-input',
        `no mark for ${args.perp}`,
        { perp: args.perp },
      );
    }
    const limitRounded = tickRound(args.limitPxReal, info.szDecimals);
    const lotStep = 10 ** -info.szDecimals;
    const sizeFloored =
      Math.floor((args.sizeUsd / info.markPxReal) / lotStep) * lotStep;
    if (sizeFloored <= 0 || sizeFloored * info.markPxReal < HL_MIN_NOTIONAL_USD) {
      throw new HLPreflightError(
        'min-notional',
        `sizeUsd ${args.sizeUsd} too small for ${args.perp}: lot-floor at mark ${info.markPxReal.toFixed(2)} yields ${(sizeFloored * info.markPxReal).toFixed(2)} < $${HL_MIN_NOTIONAL_USD} min`,
        { notionalUsd: args.sizeUsd },
      );
    }
    return this.exchange.placeOrder({
      asset: info.globalAsset,
      isBuy: args.isLong,
      limitPxReal: String(limitRounded),
      sizeReal: hlFormatDecimal(sizeFloored, info.szDecimals),
      reduceOnly: args.reduceOnly ?? false,
      tif: args.tif,
      cloid: args.cloid,
    });
  }

  // -------------------------------------------------------------------------
  // Convenience: real-units summary for a single perp
  // -------------------------------------------------------------------------

  /// @notice Combined position + mark snapshot for UI display.
  public async positionSnapshot(perp: PerpSymbol | string | number): Promise<{
    perp: number;
    coin: string;
    szi: bigint;
    szReal: number;
    leverage: number;
    isIsolated: boolean;
    entryNtl: bigint;
    markPxReal: number;
  }> {
    const idx = await this.resolvePerp(perp);
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

  // -------------------------------------------------------------------------
  // Catalog / search / batch convenience wrappers (see catalog.ts, search.ts,
  // batch.ts for full type definitions). These are thin pass-throughs so
  // strategy / MCP code can stay one-import deep.
  // -------------------------------------------------------------------------

  /// @notice Build the unified instrument catalog (perps + spot) for this
  /// vault. Single-shot fetch, ~1 second total.
  public async getInstrumentCatalog(opts?: import('./catalog.js').BuildInstrumentCatalogOptions) {
    const { buildInstrumentCatalog } = await import('./catalog.js');
    return buildInstrumentCatalog(this, opts);
  }

  /// @notice Fuzzy search over a pre-built catalog. Returns scored matches.
  public async searchInstruments(
    catalog: import('./catalog.js').Instrument[],
    query: string,
    opts?: import('./search.js').SearchOptions,
  ): Promise<import('./search.js').SearchHit[]> {
    const { searchInstruments } = await import('./search.js');
    return searchInstruments(catalog, query, opts);
  }

  /// @notice Strict single-match resolver. Throws on ambiguity / no match.
  public async resolveInstrument(catalog: import('./catalog.js').Instrument[], queryOrId: string) {
    const { resolveInstrument } = await import('./search.js');
    return resolveInstrument(catalog, queryOrId);
  }

  /// @notice Compile an open-position batch plan.
  public async compileOpenPosition(
    catalog: import('./catalog.js').Instrument[],
    args: import('./batch.js').CompileOpenArgs,
  ): Promise<import('./batch.js').BatchPlan> {
    const { compileOpenPosition } = await import('./batch.js');
    return compileOpenPosition(this, catalog, args);
  }

  /// @notice Compile a close-position batch plan.
  public async compileClosePosition(
    catalog: import('./catalog.js').Instrument[],
    args: import('./batch.js').CompileCloseArgs,
  ): Promise<import('./batch.js').BatchPlan> {
    const { compileClosePosition } = await import('./batch.js');
    return compileClosePosition(this, catalog, args);
  }
}
