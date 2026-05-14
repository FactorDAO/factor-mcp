// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Unified HyperLiquid instrument catalog.
//
// `Instrument` is the canonical SDK projection of "anything a vault can
// trade on HL" — every perp on every dex (main + HIP-3 builder dexes) plus
// every spot token. The catalog is built deterministically from HL Info
// (`perpDexs` + `metaAndAssetCtxs` + `spotMeta`) and tagged with a coarse
// category so UI / strategy / MCP can group / filter without reimplementing
// the same regex matchers.
//
// `vaultTradable` is a HARD gate: it's `false` when the on-chain adapter
// (current version) cannot yet route an order for that instrument. The
// reason string is intentionally surface-level so the caller doesn't have
// to inspect adapter internals.

import type { HLVault } from './HLVault.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InstrumentType = 'perp' | 'spot';

export type InstrumentCategory =
  | 'crypto'
  | 'stock'
  | 'commodity'
  | 'fx'
  | 'index'
  | 'meme'
  | 'lst'
  | 'stablecoin'
  | 'other';

export interface Instrument {
  /// Stable, unambiguous identifier:
  ///   perp main:  `perp:main:BTC`
  ///   perp xyz:   `perp:xyz:BRENTOIL`
  ///   spot:       `spot:OPENAI`
  id: string;
  /// Bare ticker without dex prefix (`BRENTOIL`, `BTC`, `OPENAI`).
  symbol: string;
  /// HL canonical name as passed to trading methods. For builder-dex perps
  /// this is `dex:SYMBOL` (e.g. `xyz:BRENTOIL`). For main-dex perps it's
  /// the bare ticker. For spot it's the bare ticker.
  qualifiedSymbol: string;
  /// Optional human label, only populated for the small handful of
  /// instruments where the bare ticker is opaque (BRENTOIL → Brent Crude
  /// Oil, AAPL → Apple, ...).
  displayName?: string;
  type: InstrumentType;
  venue: {
    /// 0 = main HL perp dex; 1 = xyz; 2... future builder dexes. For spot
    /// instruments we use `SPOT_DEX_SENTINEL` (0xFFFFFFFF), matching the
    /// `sendAsset` action 13 convention on the adapter.
    dexIndex: number;
    /// Canonical dex name (`main`, `xyz`, `vntl`, `spot`, ...).
    dexName: string;
    ledger: 'perp' | 'spot';
  };
  /// True if the current vault adapter can route a trade for this instrument
  /// end-to-end. For perp: `dexIndex === 0 || dexIndex <= currentMaxKnownBuilderDex`.
  /// For spot: always true (spotSend lives in every adapter version).
  vaultTradable: boolean;
  /// Populated when `vaultTradable === false` with a short reason.
  vaultTradableReason?: string;
  /// Perp only.
  maxLeverage?: number;
  /// Number of decimals for contract size (perps) / token wei (spot).
  szDecimals: number;
  /// Perp only — when true, only isolated-margin mode is permitted.
  onlyIsolated?: boolean;
  /// Live mark price in USD (when HL returned an assetCtx for this market).
  markPx?: number;
  /// Spot only — bridge-side ERC-20 address on HyperEVM. Present iff HL
  /// has registered an `evmContract` for the spot token.
  evmContract?: string;
  category: InstrumentCategory;
}

export const SPOT_DEX_SENTINEL = 0xffffffff;

/// Perp dexes the FACTOR vault officially supports as trading venues.
/// Restricting this list is a PRODUCT decision, not a contract one:
///
/// - `main`     — HL-operated tier-1 venue (BTC, ETH, SOL, all ~230 crypto perps).
/// - `xyz`      — first HIP-3 builder dex (tier-1 third-party). 75 mixed:
///                commodities, blue-chip stocks, FX, indices. Already
///                initialised on the live vault since Phase 8.
/// - `vntl`     — unlocked specifically for asset uniqueness — OPENAI,
///                ANTHROPIC, SPACEX, MAG7, SEMIS, NUCLEAR, BIOTECH,
///                DEFENSE, ENERGY, ROBOT — none of which exist on other
///                dexes. Required init action documented in `HLVault.ts`.
///
/// EXCLUDED from this list (visible on HL, but the FACTOR product does
/// NOT expose them):
/// - `flx`, `km`, `cash`, `hyna` — duplicate main/xyz tickers with
///   STRICTLY worse conditions (lower leverage, isolated-only,
///   coarser lot, ghost-liquidity orderbooks with mark-price drift
///   up to ±13% vs main). They exist as deployer promo venues; surfacing
///   them would let users accidentally route into thin liquidity.
/// - `para` — niche market-cap indices (BTCD, OTHERS, TOTAL2). Skipped
///   pending product-level decision on whether to expose.
/// - `abcd` — empty.
///
/// To expand:
///   1. Confirm the dex's `approveBuilderFee` (or equivalent init) flow
///      against the live vault — see [[reference-hyperliquid-builder-dex-init]].
///   2. Add the dex name to this set + bump `MAX_KNOWN_BUILDER_DEX` on
///      the live adapter via `executeByManager(setMaxKnownBuilderDex)`.
///   3. Bump `maxBuilderDexIndex` on the accounting contract via
///      `setMaxBuilderDexIndex` so NAV reads the new dex's equity.
export const SUPPORTED_PERP_DEXES: ReadonlySet<string> = new Set([
  'main',
  'xyz',
  'vntl',
]);

/// @notice Default ceiling for builder-dex routing. The on-chain adapter
/// gates which `perpDexIndex` values are reachable via
/// `transferUsdcBetweenLedgers` (whitelist of `srcDex/dstDex`). Until v5,
/// `1` (xyz) is the only reachable builder dex.
export const DEFAULT_MAX_KNOWN_BUILDER_DEX = 1;

// ---------------------------------------------------------------------------
// Categorizer
// ---------------------------------------------------------------------------

const STABLECOINS = new Set([
  'USDC', 'USDT0', 'USDE', 'USDH', 'USDXL', 'USDHL', 'USDN', 'FEUSD',
  'RLUSD', 'BRLA', 'BUSD', 'DAI', 'USDY', 'USDR', 'USR', 'USPYX', 'HUSDE',
  'USDUC', 'USDV', 'USDG', 'DUSD', 'PEUR',
]);

const LST_TOKENS = new Set([
  'KHYPE', 'STHYPE', 'HPL', 'HWHYPE', 'MHYPE', 'DHYPE', 'WHLP', 'HWHLP',
  'STLOOP', 'UPHL', 'HYPE', 'WHYPE',
]);

const COMMODITIES = new Set([
  'GOLD', 'SILVER', 'COPPER', 'BRENTOIL', 'PLATINUM', 'PALLADIUM',
  'URANIUM', 'URNM', 'NATGAS', 'WHEAT', 'CORN', 'ALUMINIUM', 'CL', 'TTF',
  'USAR', 'XAUT0', 'XAUM', 'GLD', 'SLV',
]);

const FX = new Set([
  'EUR', 'JPY', 'KRW', 'GBP', 'DXY', 'RUB', 'AUD', 'CAD', 'NZD', 'CNY',
  'INR', 'BRL', 'MXN', 'ZAR', 'PEUR',
]);

const INDICES = new Set([
  'SP500', 'NASDAQ', 'NIFTY', 'JP225', 'KR200', 'VIX', 'VOL', 'XYZ100',
  'H100', 'DXY', 'XLE', 'EWJ', 'EWT', 'EWY', 'EWZ', 'SPY', 'QQQ', 'QQQM',
]);

const STOCKS = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'ORCL', 'AVGO',
  'MU', 'MSTR', 'COIN', 'COST', 'NFLX', 'EBAY', 'HOOD', 'RIVN', 'PLTR',
  'INTC', 'AMD', 'ARM', 'BABA', 'BX', 'CRCL', 'CRWV', 'DKNG', 'GME', 'HIMS',
  'HYUNDAI', 'KIOXIA', 'LITE', 'LLY', 'MRVL', 'OPENAI', 'PYPL', 'RKLB',
  'SKHX', 'SMSN', 'SNDK', 'SOFTBANK', 'SPACEX', 'TSM', 'ZM', 'BIRD',
  'CBRS', 'DRAM', 'OAI', 'NQ',
]);

const MEME_NAMES = new Set([
  'PEPE', 'kPEPE', 'SHIB', 'WIF', 'BONK', 'DOGE', 'FLOKI', 'BOME',
  'POPCAT', 'MOG', 'BRETT', 'TRUMP', 'MELANIA', 'FARTCOIN', 'GIGA',
  'MOODENG', 'CHILLGUY', 'PNUT', 'GOAT',
]);

const MEME_PREFIX = /^(PEPE|CAT|DOG|MOON|FROG|SHIB|WIF|BONK|FLOKI)/i;

const DISPLAY_NAMES: Record<string, string> = {
  BRENTOIL: 'Brent Crude Oil',
  NATGAS: 'Natural Gas',
  SP500: 'S&P 500',
  JP225: 'Nikkei 225',
  DXY: 'US Dollar Index',
  AAPL: 'Apple',
  MSFT: 'Microsoft',
  GOOGL: 'Alphabet',
  AMZN: 'Amazon',
  META: 'Meta Platforms',
  NVDA: 'Nvidia',
  TSLA: 'Tesla',
  ORCL: 'Oracle',
  AVGO: 'Broadcom',
  COIN: 'Coinbase',
  NFLX: 'Netflix',
  INTC: 'Intel',
  AMD: 'AMD',
  ARM: 'ARM Holdings',
  BABA: 'Alibaba',
  HOOD: 'Robinhood',
  PLTR: 'Palantir',
  COST: 'Costco',
  MSTR: 'MicroStrategy',
  OPENAI: 'OpenAI',
  SPACEX: 'SpaceX',
  TSM: 'TSMC',
};

/// @notice Strip the `k` size prefix HL uses for "1000x" tokens (kPEPE,
/// kSHIB, kBONK) so categorization sees the underlying name.
function stripKilo(name: string): string {
  if (name.length > 1 && name[0] === 'k' && /^[A-Z]/.test(name[1] ?? '')) {
    return name.slice(1);
  }
  return name;
}

/// @notice Deterministic instrument categorizer. First-match-wins; the
/// ordering matters because some tickers are ambiguous (DXY is both an FX
/// thing and an index — we tag it `fx` first because the SET defines it
/// there before INDICES; SET-order is also explicit in the spec).
export function categorize(
  symbol: string,
  type: InstrumentType,
  dexName: string,
): InstrumentCategory {
  const upper = symbol.toUpperCase();
  const bare = stripKilo(symbol).toUpperCase();

  if (STABLECOINS.has(upper) || STABLECOINS.has(bare)) return 'stablecoin';
  if (LST_TOKENS.has(upper) || LST_TOKENS.has(bare)) return 'lst';
  if (COMMODITIES.has(upper) || COMMODITIES.has(bare)) return 'commodity';
  if (FX.has(upper) || FX.has(bare)) return 'fx';
  if (INDICES.has(upper) || INDICES.has(bare)) return 'index';
  if (STOCKS.has(upper) || STOCKS.has(bare)) return 'stock';
  if (MEME_NAMES.has(upper) || MEME_NAMES.has(symbol) || MEME_PREFIX.test(symbol)) return 'meme';

  // Catch-all for main-dex perps — these are the ~230 crypto majors by definition.
  if (type === 'perp' && dexName === 'main') return 'crypto';

  // Short, all-uppercase tokens are typically stocks (covered above) or
  // crypto majors. For builder-dex perps that didn't match any explicit set,
  // we lean stock if it looks ticker-shaped; otherwise crypto.
  if (type === 'perp' && /^[A-Z]{1,5}$/.test(bare)) {
    return 'stock';
  }

  return 'other';
}

export function displayNameFor(symbol: string): string | undefined {
  return DISPLAY_NAMES[symbol.toUpperCase()];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/// @notice One-shot fetcher for the HL `perpDexs` endpoint. We avoid using
/// `HLVault.listDexes` (added in v4 of the SDK class) so this module
/// compiles against older HLVault revisions still living in factor-mcp.
async function fetchPerpDexes(vault: HLVault): Promise<Array<{ index: number; name: string }>> {
  type HLExchangeLike = { endpointUrl: string; fetchImpl: typeof fetch };
  // Reach into the (readonly) exchange client through a structural type;
  // both the SDK and MCP copies expose `endpointUrl` and `fetchImpl`.
  const exch = (vault as unknown as { exchange: HLExchangeLike }).exchange;
  if (!exch || typeof exch.endpointUrl !== 'string' || typeof exch.fetchImpl !== 'function') {
    // Fallback for very old HLVault revisions that don't expose the exchange
    // client — only `main` dex visible.
    return [{ index: 0, name: 'main' }];
  }
  const url = exch.endpointUrl.replace('/exchange', '/info');
  const res = await exch.fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'perpDexs' }),
  });
  if (!res.ok) {
    throw new Error(`perpDexs failed: ${res.status} ${res.statusText}`);
  }
  const raw = (await res.json()) as Array<{ name: string } | null>;
  return raw.map((d, i) => ({ index: i, name: d?.name ?? 'main' }));
}

export interface BuildInstrumentCatalogOptions {
  /// Maximum perp-dex index considered reachable by the current adapter
  /// version. Anything strictly greater is tagged `vaultTradable: false`.
  /// Defaults to `DEFAULT_MAX_KNOWN_BUILDER_DEX` (= 1 — xyz only).
  currentMaxKnownBuilderDex?: number;
  /// Skip the spot-token enumeration entirely (useful for tests that only
  /// care about perps and want to avoid the extra round-trip).
  includeSpot?: boolean;
  /// Include perps from unsupported dexes (default: false). End-user
  /// flows MUST default this to false so the catalog only surfaces
  /// venues the FACTOR product officially supports. Useful set to true
  /// for analytics / monitoring / catalog diffing.
  includeUnsupportedDexes?: boolean;
}

/// @notice Build the full instrument catalog for `vault`. Single SDK call
/// shape — every consumer (UI, MCP, strategy) gets the same projection.
///
/// Performance: 1 `perpDexs` call + N `metaAndAssetCtxs` calls (1 per dex)
/// + 1 `spotMeta` call (unless disabled). N is typically <10. Total <1s.
export async function buildInstrumentCatalog(
  vault: HLVault,
  opts: BuildInstrumentCatalogOptions = {},
): Promise<Instrument[]> {
  const maxBuilder = opts.currentMaxKnownBuilderDex ?? DEFAULT_MAX_KNOWN_BUILDER_DEX;
  const includeSpot = opts.includeSpot ?? true;
  const includeUnsupported = opts.includeUnsupportedDexes ?? false;

  const allDexes = await fetchPerpDexes(vault);
  const dexes = includeUnsupported
    ? allDexes
    : allDexes.filter((d) => SUPPORTED_PERP_DEXES.has(d.name));
  const perpPromises = dexes.map(async (d) => {
    const list = await vault.listPerps(d.name === 'main' ? 'main' : d.name);
    return list.map((p) => {
      const tradable = d.index === 0 || d.index <= maxBuilder;
      const symbol = d.index === 0
        ? p.name
        : (p.name.includes(':') ? p.name.slice(p.name.indexOf(':') + 1) : p.name);
      const qualifiedSymbol = d.index === 0 ? symbol : `${d.name}:${symbol}`;
      const inst: Instrument = {
        id: `perp:${d.name}:${symbol}`,
        symbol,
        qualifiedSymbol,
        displayName: displayNameFor(symbol),
        type: 'perp',
        venue: {
          dexIndex: d.index,
          dexName: d.name,
          ledger: 'perp',
        },
        vaultTradable: tradable,
        vaultTradableReason: tradable
          ? undefined
          : `dex ${d.index} (${d.name}) exceeds maxKnownBuilderDex=${maxBuilder}`,
        maxLeverage: p.maxLeverage,
        szDecimals: p.szDecimals,
        onlyIsolated: p.onlyIsolated,
        markPx: p.markPx,
        category: categorize(symbol, 'perp', d.name),
      };
      return inst;
    });
  });

  const perpLists = await Promise.all(perpPromises);
  const perps = perpLists.flat();

  if (!includeSpot) return perps;

  // Spot tokens are flat — one list, no per-dex nesting. We exclude USDC
  // (spot token 0) because it's not a tradable instrument from the
  // strategy POV; it's the funding rail itself.
  const spotTokens = await vault.listSpotTokens();
  const spots: Instrument[] = spotTokens
    .filter((t) => t.name !== 'USDC' && t.index !== 0)
    .map((t) => ({
      id: `spot:${t.name}`,
      symbol: t.name,
      qualifiedSymbol: t.name,
      displayName: displayNameFor(t.name),
      type: 'spot' as const,
      venue: {
        dexIndex: SPOT_DEX_SENTINEL,
        dexName: 'spot',
        ledger: 'spot' as const,
      },
      vaultTradable: true, // spotSend is available in every adapter version
      szDecimals: t.szDecimals,
      evmContract: t.evmContract,
      category: categorize(t.name, 'spot', 'spot'),
    }));

  return [...perps, ...spots];
}
