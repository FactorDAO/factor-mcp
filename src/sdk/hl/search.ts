// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Catalog search + strict resolver.
//
// `searchInstruments` is a deterministic scorer (no fuzzy library — the
// scorer is <60 lines and we need predictable ordering for the MCP tools
// and the tests that pin scoring shape).
//
// Scoring tiers (higher wins):
//   1000 — exact `id` match
//    900 — exact `symbol` match (case-insensitive)
//    850 — exact `qualifiedSymbol` match
//    700 — `symbol` starts with `query`
//    650 — `qualifiedSymbol` starts with `query`
//    500 — substring of `symbol`
//    400 — substring of `qualifiedSymbol`
//    300 — substring of `displayName`
//
// Tiebreaks: perp > spot, main dex > builder dex, higher `markPx` (skips
// cheap meme spam pumping the top of an empty-query result), shorter
// symbol last (so "BTC" beats "BTCUP" for the bare query "BT").

import type { Instrument, InstrumentCategory, InstrumentType } from './catalog.js';

export interface SearchOptions {
  type?: InstrumentType;
  category?: InstrumentCategory;
  venue?: string; // dex name filter
  vaultTradable?: boolean;
  limit?: number;
}

export interface SearchHit {
  instrument: Instrument;
  score: number;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreOne(inst: Instrument, q: string): number {
  if (!q) return 0;
  const ql = q.toLowerCase();
  const qu = q.toUpperCase();

  if (inst.id === q || inst.id.toLowerCase() === ql) return 1000;
  if (inst.symbol === qu || inst.symbol === q) return 900;
  if (inst.qualifiedSymbol === q || inst.qualifiedSymbol === qu) return 850;

  const sLower = inst.symbol.toLowerCase();
  if (sLower.startsWith(ql)) return 700;

  const qsLower = inst.qualifiedSymbol.toLowerCase();
  if (qsLower.startsWith(ql)) return 650;

  if (sLower.includes(ql)) return 500;
  if (qsLower.includes(ql)) return 400;

  const dn = inst.displayName?.toLowerCase();
  if (dn && dn.includes(ql)) return 300;

  return 0;
}

function tieBreak(a: Instrument, b: Instrument): number {
  // perp > spot
  if (a.type !== b.type) return a.type === 'perp' ? -1 : 1;
  // main > builder for perps
  if (a.type === 'perp') {
    if (a.venue.dexIndex !== b.venue.dexIndex) return a.venue.dexIndex - b.venue.dexIndex;
  }
  // higher markPx first (presence > absence)
  const am = a.markPx ?? -1;
  const bm = b.markPx ?? -1;
  if (am !== bm) return bm - am;
  // shorter symbol last (more specific = higher rank)
  return a.symbol.length - b.symbol.length;
}

function applyFilters(inst: Instrument, opts?: SearchOptions): boolean {
  if (!opts) return true;
  if (opts.type && inst.type !== opts.type) return false;
  if (opts.category && inst.category !== opts.category) return false;
  if (opts.venue && inst.venue.dexName !== opts.venue) return false;
  if (typeof opts.vaultTradable === 'boolean' && inst.vaultTradable !== opts.vaultTradable) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function searchInstruments(
  catalog: Instrument[],
  query: string,
  opts?: SearchOptions,
): SearchHit[] {
  const limit = opts?.limit ?? 20;
  const q = query.trim();

  // Empty query — return filtered catalog sorted by tiebreak only (most-
  // "primary" instruments first).
  if (!q) {
    const filtered = catalog.filter((i) => applyFilters(i, opts));
    filtered.sort(tieBreak);
    return filtered.slice(0, limit).map((instrument) => ({ instrument, score: 0 }));
  }

  const hits: SearchHit[] = [];
  for (const inst of catalog) {
    if (!applyFilters(inst, opts)) continue;
    const score = scoreOne(inst, q);
    if (score > 0) hits.push({ instrument: inst, score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return tieBreak(a.instrument, b.instrument);
  });

  return hits.slice(0, limit);
}

/// @notice Strict single-match resolver — throws on ambiguity or zero hits.
/// Accepts either an `id` (preferred) or any single symbol form (`BTC`,
/// `xyz:BRENTOIL`, `OPENAI`). If multiple instruments share the same
/// symbol across dexes (rare but possible: same ticker on main + builder),
/// the caller must disambiguate with the full `id`.
export function resolveInstrument(catalog: Instrument[], queryOrId: string): Instrument {
  const q = queryOrId.trim();
  if (!q) throw new Error('resolveInstrument: empty query');

  // 1. Exact id match.
  const byId = catalog.find((i) => i.id === q);
  if (byId) return byId;

  // 2. Exact qualifiedSymbol (handles `xyz:BRENTOIL`).
  const byQs = catalog.filter((i) => i.qualifiedSymbol === q);
  if (byQs.length === 1) return byQs[0];
  if (byQs.length > 1) {
    throw new Error(
      `resolveInstrument: qualifiedSymbol "${q}" is ambiguous (${byQs.length} matches: ${byQs
        .map((i) => i.id)
        .join(', ')}). Use the full id.`,
    );
  }

  // 3. Exact symbol (case-insensitive).
  const byBare = catalog.filter((i) => i.symbol.toUpperCase() === q.toUpperCase());
  if (byBare.length === 1) return byBare[0];
  if (byBare.length > 1) {
    throw new Error(
      `resolveInstrument: symbol "${q}" is ambiguous (${byBare.length} matches: ${byBare
        .map((i) => i.id)
        .join(', ')}). Use the full id.`,
    );
  }

  throw new Error(`resolveInstrument: no match for "${q}"`);
}
