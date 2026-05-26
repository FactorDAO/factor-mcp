// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// HLVaultMetrics — analytics surface for a HyperLiquid-enabled FACTOR vault.
//
// Mirrors the role of the per-adapter `IAdapterMetrics` classes in the
// multi-chain `factor-studio-core` SDK (e.g. `uniswap-v3-lp-adapter.metrics.ts`)
// but tailored to HL's data model: a vault holds equity across the main
// HL perp ledger AND any HIP-3 builder dexes it's active on, and the
// authoritative position state lives off-chain (HL Info API), not in a
// subgraph or per-protocol Reader contract.
//
// This class is the single read surface for:
//   • aggregate stats (NAV breakdown, share price, position counts, PnL)
//   • per-position detail (mark px, uPnL, funding accrued, liquidation px)
//   • historical fills (userFills) — for realized PnL & trade journal
//   • historical funding payments (userFunding)
//   • realized PnL aggregation over a time window
//
// All money fields are surfaced as plain `number` (USD) for ergonomic UI
// consumption AND as raw bigint where 1:1 fidelity matters (shares, NAV
// in 6-dec). Caller picks the field.

import {
  type Address,
  type PublicClient,
} from 'viem';

import { HLVault } from './HLVault.js';
import type { HLVaultNav } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HLOpenPositionDetail {
  /// 'main' for the main HL dex, else builder-dex name (e.g. 'xyz').
  dex: string;
  /// Bare ticker on main ('BTC'), or qualified on builder dexes ('xyz:GOLD').
  perp: string;
  side: 'long' | 'short';
  /// Position size as a real float (units of base asset).
  sizeReal: number;
  /// Average entry price (real float USD).
  entryPxReal: number;
  /// Current mark price (real float USD).
  markPxReal: number;
  /// Liquidation price as reported by HL (may be null if unknown).
  liquidationPxReal: number | null;
  /// Absolute current notional |size * mark| in USD.
  notionalUsd: number;
  /// Absolute entry notional |size * entry| in USD.
  entryNotionalUsd: number;
  /// Unrealized PnL in USD (signed — positive = profit).
  unrealizedPnlUsd: number;
  /// uPnL / |entryNotional| × 100 — percent return on notional.
  unrealizedPnlPct: number;
  /// uPnL / marginUsed × 100 — leveraged ROE percent.
  roeOnMarginPct: number;
  /// Initial margin allocated to this position (USD).
  marginUsedUsd: number;
  /// Cumulative funding paid (negative) or received (positive) on this
  /// position since opening, in USD. From HL clearinghouseState.
  cumulativeFundingUsd: number;
  leverage: number;
  marginMode: 'cross' | 'isolated';
}

export interface HLPerDexMarginSummary {
  /// 'main' or builder-dex name.
  dex: string;
  /// Total account equity (uPnL included) — USD.
  accountValueUsd: number;
  /// Initial margin currently locked — USD.
  marginUsedUsd: number;
  /// Free margin (accountValue − margin used) — USD.
  withdrawableUsd: number;
  /// Total open-position notional — USD.
  totalNotionalUsd: number;
}

export interface HLPositionsAggregate {
  count: number;
  longCount: number;
  shortCount: number;
  /// Sum of absolute notionals across all positions — USD.
  totalNotionalUsd: number;
  /// Net long-vs-short notional (longs positive, shorts negative) — USD.
  netDirectionalNotionalUsd: number;
  /// Sum of uPnL across all positions — USD.
  totalUnrealizedPnlUsd: number;
  /// Sum of initial margin locked across positions — USD.
  totalMarginUsedUsd: number;
  /// Sum of cumulative funding accrued across positions — USD.
  totalCumulativeFundingUsd: number;
  /// Breakdown by dex name for quick attribution.
  byDex: Record<string, { count: number; notionalUsd: number; unrealizedPnlUsd: number }>;
}

export interface HLShareMetrics {
  /// convertToAssets(1e18) — USDC 6-dec per 1.0 share (bigint).
  sharePrice6: bigint;
  /// Friendly float: sharePrice in USDC.
  sharePriceUsdc: number;
  /// totalSupply (18-dec wei).
  totalSupply: bigint;
  /// totalAssets() — USDC 6-dec.
  totalAssets: bigint;
  /// totalAssets in USDC float.
  totalAssetsUsdc: number;
}

export interface HLVaultStats {
  vault: Address;
  asOf: string; // ISO timestamp
  nav: HLVaultNav;
  /// NAV in USDC float. INCLUDES builder-dex sub-account equity
  /// (xyz, flx, …) — `nav.perpEquity` itself only carries the main-dex
  /// precompile read, so `navUsdc !== Number(nav.totalUsdc)/1e6` whenever
  /// the vault has positions on a HIP-3 dex. Consumers should always
  /// prefer this field over the raw `nav.totalUsdc`.
  navUsdc: number;
  /// Per-dex perp account equity (USD) — 'main' matches the precompile
  /// (`nav.perpEquity`), builder dexes ('xyz', …) come from the HL Info
  /// `clearinghouseState.marginSummary.accountValue` read. Sums to
  /// `navUsdc - (evmUsdc + spotUsdc)`.
  perpEquityByDex: Record<string, number>;
  share: HLShareMetrics;
  positions: HLPositionsAggregate;
  /// One per dex the vault has equity on. Always includes 'main'.
  marginSummaries: HLPerDexMarginSummary[];
}

export interface HLFillRecord {
  /// Unix ms.
  time: number;
  /// Ticker (bare on main, qualified on builder dexes).
  coin: string;
  /// 'main' if from main dex, else builder dex name.
  dex: string;
  side: 'buy' | 'sell';
  px: number;
  sz: number;
  /// Realized PnL closed by this fill (USD) — 0 for openers.
  closedPnlUsd: number;
  /// Fee paid (USD-equivalent of `feeToken`).
  feeUsd: number;
  feeToken: string;
  /// HL transaction hash if present.
  hash?: string;
  /// HL order id.
  oid?: number;
}

export interface HLFundingRecord {
  time: number;
  coin: string;
  dex: string;
  /// Signed USDC — POSITIVE means paid OUT, NEGATIVE means received.
  /// (Matches HL convention. Subtract this from PnL to get net.)
  usdc: number;
  /// Position size at the time of the funding accrual.
  szi: number;
  /// Hourly funding rate at the accrual point (decimal — 0.0001 = 1bps).
  fundingRate: number;
}

export interface HLRealizedPnlAggregate {
  /// Sum of `closedPnl` across all fills in window (USD).
  totalUsd: number;
  /// Sum of fees paid across all fills in window (USD).
  totalFeesUsd: number;
  /// Net realized PnL after fees (totalUsd − totalFeesUsd).
  netUsd: number;
  /// Number of closing fills (closedPnl != 0).
  closeFillCount: number;
  /// Total number of fills considered (open + close).
  totalFillCount: number;
  /// PnL attribution by coin.
  byCoin: Record<string, number>;
  /// PnL attribution by dex.
  byDex: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Internal HL Info response shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface CHPositionRaw {
  position: {
    coin: string;
    szi: string;
    entryPx?: string;
    positionValue?: string;
    unrealizedPnl?: string;
    marginUsed?: string;
    liquidationPx?: string | null;
    cumFunding?: { sinceOpen?: string };
    leverage: { type: 'cross' | 'isolated'; value: number; rawUsd?: string };
  };
}

interface CHStateRaw {
  marginSummary?: {
    accountValue?: string;
    totalNtlPos?: string;
    totalRawUsd?: string;
    totalMarginUsed?: string;
  };
  withdrawable?: string;
  assetPositions?: CHPositionRaw[];
}

interface UserFillRaw {
  time: number;
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  closedPnl: string;
  fee: string;
  feeToken: string;
  hash?: string;
  oid?: number;
}

interface UserFundingRaw {
  time: number;
  delta: { coin: string; usdc: string; szi: string; fundingRate: string };
}

interface PerpDexRaw {
  name?: string;
}

interface UniverseAsset {
  name: string;
  szDecimals: number;
}

interface AssetCtx {
  markPx?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function n(v: string | undefined | null): number {
  if (v === undefined || v === null || v === '') return 0;
  const f = Number(v);
  return Number.isFinite(f) ? f : 0;
}

// ERC-4626 minimal ABI for share-price reads.
const erc4626MinimalAbi = [
  { type: 'function', name: 'convertToAssets', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// ---------------------------------------------------------------------------
// HLVaultMetrics
// ---------------------------------------------------------------------------

export interface HLVaultMetricsOptions {
  /// Public client for the on-chain ERC-4626 reads (sharePrice, totalSupply).
  /// Required because the parent HLVault holds it privately.
  client: PublicClient;
  /// Override the HL Info endpoint (default: derived from the parent
  /// HLVault's exchange URL — `/exchange` → `/info`).
  infoUrl?: string;
  /// Inject fetch for tests / non-Node-18 hosts. Defaults to the parent
  /// HLVault's `fetchImpl`.
  fetchImpl?: typeof fetch;
}

export class HLVaultMetrics {
  public readonly vault: HLVault;
  private readonly client: PublicClient;
  private readonly infoUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(vault: HLVault, opts: HLVaultMetricsOptions) {
    this.vault = vault;
    this.client = opts.client;
    const ex = (vault as unknown as { exchange: { endpointUrl: string; fetchImpl: typeof fetch } }).exchange;
    this.infoUrl = opts.infoUrl ?? ex.endpointUrl.replace('/exchange', '/info');
    this.fetchImpl = opts.fetchImpl ?? ex.fetchImpl;
  }

  public static create(vault: HLVault, opts: HLVaultMetricsOptions): HLVaultMetrics {
    return new HLVaultMetrics(vault, opts);
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /// @notice Aggregate dashboard snapshot — NAV + share price + position
  /// aggregates + per-dex margin summary. One method, ~6 round-trips,
  /// suitable for a single dashboard refresh.
  public async getStats(): Promise<HLVaultStats> {
    const [nav, positions, share, marginSummaries] = await Promise.all([
      this.vault.getNav(),
      this.getOpenPositions(),
      this.getShareMetrics(),
      this.getMarginSummariesAllDexes(),
    ]);

    // `nav.totalUsdc` only carries main-dex perp equity (the precompile
    // read in `nav.ts` is hardcoded to `perpDex=0`). Builder-dex
    // sub-accounts (xyz, flx, …) are read off-chain via HL Info's
    // `clearinghouseState.marginSummary.accountValue` and surfaced here
    // in `marginSummaries`. We assemble the *true* NAV by replacing the
    // partial perp leg with the per-dex sum so callers (the MCP tool,
    // the UI's NAV card, the jobs snapshot writer) all agree on a single
    // TVL number. Until this was added, the wizard showed e.g.
    // $15.31 on a vault that actually held $49.92 on `xyz`.
    const perpEquityByDex: Record<string, number> = {};
    let perpEquitySumUsd = 0;
    for (const m of marginSummaries) {
      perpEquityByDex[m.dex] = m.accountValueUsd;
      perpEquitySumUsd += m.accountValueUsd;
    }
    const evmUsdcUsd = Number(nav.evmUsdc) / 1e6;
    const spotUsdcUsd = Number(nav.spotUsdc) / 1e6;
    const navUsdc = evmUsdcUsd + spotUsdcUsd + perpEquitySumUsd;

    let longCount = 0;
    let shortCount = 0;
    let totalNotionalUsd = 0;
    let netDirectionalNotionalUsd = 0;
    let totalUnrealizedPnlUsd = 0;
    let totalMarginUsedUsd = 0;
    let totalCumulativeFundingUsd = 0;
    const byDex: HLPositionsAggregate['byDex'] = {};

    for (const p of positions) {
      if (p.side === 'long') longCount += 1;
      else shortCount += 1;
      totalNotionalUsd += p.notionalUsd;
      netDirectionalNotionalUsd += p.side === 'long' ? p.notionalUsd : -p.notionalUsd;
      totalUnrealizedPnlUsd += p.unrealizedPnlUsd;
      totalMarginUsedUsd += p.marginUsedUsd;
      totalCumulativeFundingUsd += p.cumulativeFundingUsd;
      const bucket = byDex[p.dex] ?? { count: 0, notionalUsd: 0, unrealizedPnlUsd: 0 };
      bucket.count += 1;
      bucket.notionalUsd += p.notionalUsd;
      bucket.unrealizedPnlUsd += p.unrealizedPnlUsd;
      byDex[p.dex] = bucket;
    }

    return {
      vault: this.vault.vaultAddress,
      asOf: new Date().toISOString(),
      nav,
      navUsdc,
      perpEquityByDex,
      share,
      positions: {
        count: positions.length,
        longCount,
        shortCount,
        totalNotionalUsd,
        netDirectionalNotionalUsd,
        totalUnrealizedPnlUsd,
        totalMarginUsedUsd,
        totalCumulativeFundingUsd,
        byDex,
      },
      marginSummaries,
    };
  }

  /// @notice ERC-4626 share-token metrics: sharePrice, totalSupply, totalAssets.
  public async getShareMetrics(): Promise<HLShareMetrics> {
    const addr = this.vault.vaultAddress;
    const [sharePrice6, totalSupply, totalAssets] = await Promise.all([
      this.client.readContract({ address: addr, abi: erc4626MinimalAbi, functionName: 'convertToAssets', args: [10n ** 18n] }) as Promise<bigint>,
      this.client.readContract({ address: addr, abi: erc4626MinimalAbi, functionName: 'totalSupply' }) as Promise<bigint>,
      this.client.readContract({ address: addr, abi: erc4626MinimalAbi, functionName: 'totalAssets' }) as Promise<bigint>,
    ]);
    return {
      sharePrice6,
      sharePriceUsdc: Number(sharePrice6) / 1e6,
      totalSupply,
      totalAssets,
      totalAssetsUsdc: Number(totalAssets) / 1e6,
    };
  }

  /// @notice Detailed open positions across all dexes — mark price,
  /// unrealized PnL, funding accrued, liquidation px, etc. Sourced from
  /// HL `clearinghouseState` (which carries mark-side fields HL has
  /// already computed for us; cheaper than re-reading the mark precompile
  /// per coin).
  public async getOpenPositions(): Promise<HLOpenPositionDetail[]> {
    const dexNames = await this.listAllDexNames();
    const results = await Promise.all(
      dexNames.map(async (dexName) => {
        const ch = await this.fetchClearinghouseState(dexName === 'main' ? undefined : dexName);
        const ap = ch.assetPositions ?? [];
        return ap
          .filter((row) => Number(row.position.szi) !== 0)
          .map((row): HLOpenPositionDetail => {
            const pos = row.position;
            const szi = n(pos.szi);
            const side: 'long' | 'short' = szi >= 0 ? 'long' : 'short';
            const sizeReal = Math.abs(szi);
            const entryPxReal = n(pos.entryPx);
            const entryNotionalUsd = n(pos.positionValue) === 0
              ? sizeReal * entryPxReal
              : (() => {
                  // `positionValue` is current mark notional, not entry — keep entry math explicit.
                  return sizeReal * entryPxReal;
                })();
            const positionValueUsd = n(pos.positionValue); // current mark notional
            const markPxReal = sizeReal > 0 && positionValueUsd > 0
              ? positionValueUsd / sizeReal
              : entryPxReal; // fallback if HL omitted
            const unrealizedPnlUsd = n(pos.unrealizedPnl);
            const marginUsedUsd = n(pos.marginUsed);
            const cumulativeFundingUsd = -n(pos.cumFunding?.sinceOpen); // HL signs cumFunding as paid-out; flip to "from vault's POV"
            const liqRaw = pos.liquidationPx;
            const liquidationPxReal = liqRaw === undefined || liqRaw === null || liqRaw === '' ? null : Number(liqRaw);
            const unrealizedPnlPct = entryNotionalUsd > 0 ? (unrealizedPnlUsd / entryNotionalUsd) * 100 : 0;
            const roeOnMarginPct = marginUsedUsd > 0 ? (unrealizedPnlUsd / marginUsedUsd) * 100 : 0;
            return {
              dex: dexName,
              perp: pos.coin,
              side,
              sizeReal,
              entryPxReal,
              markPxReal,
              liquidationPxReal,
              notionalUsd: positionValueUsd > 0 ? positionValueUsd : sizeReal * markPxReal,
              entryNotionalUsd,
              unrealizedPnlUsd,
              unrealizedPnlPct,
              roeOnMarginPct,
              marginUsedUsd,
              cumulativeFundingUsd,
              leverage: Number(pos.leverage.value),
              marginMode: pos.leverage.type,
            };
          });
      }),
    );
    return results.flat();
  }

  /// @notice Per-dex `marginSummary` view — what HL would show on its UI
  /// per perp account. Includes the main HL ledger and every builder dex
  /// the vault has equity on.
  public async getMarginSummariesAllDexes(): Promise<HLPerDexMarginSummary[]> {
    const dexNames = await this.listAllDexNames();
    return Promise.all(
      dexNames.map(async (dexName) => {
        const ch = await this.fetchClearinghouseState(dexName === 'main' ? undefined : dexName);
        const ms = ch.marginSummary ?? {};
        return {
          dex: dexName,
          accountValueUsd: n(ms.accountValue),
          marginUsedUsd: n(ms.totalMarginUsed),
          withdrawableUsd: n(ch.withdrawable),
          totalNotionalUsd: n(ms.totalNtlPos),
        };
      }),
    );
  }

  /// @notice Historical fills (closes + opens) — `userFills` on HL Info
  /// API. Optionally filter by [startTime, endTime] in unix ms.
  ///
  /// HL caps `userFillsByTime` at 2000 fills per request; if you hit that
  /// bound, narrow the window and call again.
  public async getFills(opts: { startTime?: number; endTime?: number } = {}): Promise<HLFillRecord[]> {
    const dexNames = await this.listAllDexNames();
    const builderDexCoins = await this.builderDexCoinSet(dexNames);
    const useWindow = opts.startTime !== undefined || opts.endTime !== undefined;
    const body = useWindow
      ? {
          type: 'userFillsByTime',
          user: this.vault.vaultAddress,
          startTime: opts.startTime ?? 0,
          ...(opts.endTime !== undefined ? { endTime: opts.endTime } : {}),
          aggregateByTime: false,
        }
      : { type: 'userFills', user: this.vault.vaultAddress };

    const raw = await this.infoFetch<UserFillRaw[]>(body);
    return (raw ?? []).map((f): HLFillRecord => ({
      time: f.time,
      coin: f.coin,
      dex: builderDexCoins.get(f.coin) ?? 'main',
      side: f.side === 'B' ? 'buy' : 'sell',
      px: n(f.px),
      sz: n(f.sz),
      closedPnlUsd: n(f.closedPnl),
      feeUsd: n(f.fee),
      feeToken: f.feeToken,
      hash: f.hash,
      oid: f.oid,
    }));
  }

  /// @notice Historical funding accruals — `userFunding` on HL Info API.
  /// HL reports per-coin per-funding-tick (hourly on most markets).
  public async getFundingHistory(opts: { startTime?: number; endTime?: number } = {}): Promise<HLFundingRecord[]> {
    const dexNames = await this.listAllDexNames();
    const builderDexCoins = await this.builderDexCoinSet(dexNames);
    const body = {
      type: 'userFunding',
      user: this.vault.vaultAddress,
      startTime: opts.startTime ?? 0,
      ...(opts.endTime !== undefined ? { endTime: opts.endTime } : {}),
    };
    const raw = await this.infoFetch<UserFundingRaw[]>(body);
    return (raw ?? []).map((row): HLFundingRecord => ({
      time: row.time,
      coin: row.delta.coin,
      dex: builderDexCoins.get(row.delta.coin) ?? 'main',
      usdc: n(row.delta.usdc),
      szi: n(row.delta.szi),
      fundingRate: n(row.delta.fundingRate),
    }));
  }

  /// @notice Realized PnL over a window, attributed by coin and by dex.
  /// Fees are subtracted from the gross sum for `netUsd`.
  public async getRealizedPnl(opts: { startTime?: number; endTime?: number } = {}): Promise<HLRealizedPnlAggregate> {
    const fills = await this.getFills(opts);
    let totalUsd = 0;
    let totalFeesUsd = 0;
    let closeFillCount = 0;
    const byCoin: Record<string, number> = {};
    const byDex: Record<string, number> = {};
    for (const f of fills) {
      totalFeesUsd += f.feeUsd;
      if (f.closedPnlUsd !== 0) {
        totalUsd += f.closedPnlUsd;
        closeFillCount += 1;
        byCoin[f.coin] = (byCoin[f.coin] ?? 0) + f.closedPnlUsd;
        byDex[f.dex] = (byDex[f.dex] ?? 0) + f.closedPnlUsd;
      }
    }
    return {
      totalUsd,
      totalFeesUsd,
      netUsd: totalUsd - totalFeesUsd,
      closeFillCount,
      totalFillCount: fills.length,
      byCoin,
      byDex,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /// @notice All dex names the vault could have positions on: 'main' plus
  /// every non-null entry in HL's `perpDexs`. We don't filter by
  /// "has-positions" here — empty dexes return an empty assetPositions
  /// array and are skipped by callers.
  private async listAllDexNames(): Promise<string[]> {
    const dexs = await this.infoFetch<Array<PerpDexRaw | null>>({ type: 'perpDexs' });
    const builderNames = (dexs ?? [])
      .map((d) => d?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
    return ['main', ...builderNames];
  }

  /// @notice Build a Map<coin, dexName> for the builder dexes — used to
  /// attribute fills / funding events back to the originating dex (HL
  /// returns `coin` on both main and builder-dex events, but `coin` on a
  /// builder dex is the qualified form `'xyz:GOLD'`, while main fills are
  /// just `'BTC'`. The presence of the prefix is the discriminator.)
  private async builderDexCoinSet(dexNames: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const d of dexNames) {
      if (d === 'main') continue;
      const meta = await this.infoFetch<[{ universe: UniverseAsset[] }, AssetCtx[]]>({
        type: 'metaAndAssetCtxs',
        dex: d,
      });
      const universe = meta?.[0]?.universe ?? [];
      for (const a of universe) map.set(a.name, d);
    }
    return map;
  }

  /// @notice One-shot HL Info `clearinghouseState`. Pass `undefined` dex
  /// for main; HL omits the `dex` key entirely for main-account reads.
  private async fetchClearinghouseState(dex?: string): Promise<CHStateRaw> {
    const body: Record<string, unknown> = {
      type: 'clearinghouseState',
      user: this.vault.vaultAddress,
    };
    if (dex) body.dex = dex;
    return this.infoFetch<CHStateRaw>(body);
  }

  /// @notice POST to HL Info, parse JSON, throw on HTTP error.
  private async infoFetch<T>(body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(this.infoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HL info ${String(body.type)} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }
}

/// @notice Factory matching the design-doc shape: `factor.hl.metrics(vault, opts)`.
export const metrics = (vault: HLVault, opts: HLVaultMetricsOptions): HLVaultMetrics =>
  HLVaultMetrics.create(vault, opts);
