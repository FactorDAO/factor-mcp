// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// Batch operation compiler — turns a high-level "open / close instrument X
// at size Y" intent into the concrete list of EVM transactions and HL
// off-chain Exchange actions the vault needs to execute, in the right
// order, with the right pre-flight checks.
//
// Two failure tiers:
//   - `blockers[]`: the plan cannot execute (no funds, instrument not
//     tradable, leverage out of range, etc.). `ops[]` will be empty.
//   - `warnings[]`: the plan can execute but the caller should be aware
//     (e.g. resulting position exceeds free margin headroom, IOC may
//     partial-fill at this size).
//
// `executeBatchPlan` is a transport-agnostic runner (see bottom).

import type { Address, Hex } from 'viem';

import type { HLVault } from './HLVault.js';
import type { Instrument } from './catalog.js';
import { resolveInstrument } from './search.js';
import type { HlExchangeAction } from './exchange.js';
import { HL_MIN_NOTIONAL_USD } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Operation =
  | { kind: 'evmTx'; to: Address; data: Hex; value: bigint; description: string }
  | { kind: 'hlExchange'; action: HlExchangeAction; description: string };

export interface BatchPlanParams {
  sizeUsd: number;
  isLong?: boolean;
  leverage?: number;
  slippageBps?: number;
}

export interface BatchPlanEstimates {
  marginRequired: number;
  notionalUsd: number;
  liquidationPxApprox?: number;
  totalGasEvm?: bigint;
  hlActionCount: number;
}

export interface BatchPlan {
  instrument: Instrument;
  intent: 'open' | 'close';
  params: BatchPlanParams;
  ops: Operation[];
  warnings: string[];
  blockers: string[];
  estimates: BatchPlanEstimates;
}

export interface CompileOpenArgs {
  instrumentId: string;
  sizeUsd: number;
  isLong: boolean;
  leverage?: number;
  slippageBps?: number;
}

export interface CompileCloseArgs {
  instrumentId: string;
  sizeUsd?: number; // default: full close
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// @notice Wraps `resolveInstrument` but never throws — returns either the
/// instrument or a blocker reason. Lets the compile* functions emit a
/// uniform `{ blockers, ops: [] }` shape instead of throwing.
function tryResolve(catalog: Instrument[], id: string): { instrument?: Instrument; blocker?: string } {
  try {
    return { instrument: resolveInstrument(catalog, id) };
  } catch (err) {
    return { blocker: (err as Error).message };
  }
}

function emptyEstimates(): BatchPlanEstimates {
  return { marginRequired: 0, notionalUsd: 0, hlActionCount: 0 };
}

/// @notice Rough liquidation price approximation. Real HL liquidation
/// math considers maintenance-margin tiers per market; the approx is
/// `mark × (1 ± 1/leverage)` which is correct for the maintenance-margin
/// = 0 case (i.e. it's the entry-cushion floor, not the true liq).
function approxLiqPx(markPx: number, leverage: number, isLong: boolean): number {
  if (!Number.isFinite(markPx) || markPx <= 0 || !Number.isFinite(leverage) || leverage <= 0) {
    return 0;
  }
  return isLong ? markPx * (1 - 1 / leverage) : markPx * (1 + 1 / leverage);
}

interface HLPositionLike {
  szi: bigint;
  entryNtl: bigint;
  leverage: number;
}

/// @notice Best-effort fetch of the current vault position for `instrument`.
/// Returns `undefined` if the vault has no open position. Tries `getAllPositions`
/// first (HL Info-backed, dex-aware), falls back to `getPositions` on the
/// main-perp precompile for older HLVault revisions that pre-date the
/// `getAllPositions` method.
async function fetchPositionFor(
  vault: HLVault,
  instrument: Instrument,
): Promise<HLPositionLike | undefined> {
  const v = vault as unknown as {
    getAllPositions?: () => Promise<Array<{ dex: string; perp: string; position: HLPositionLike }>>;
    getPositions: () => Promise<Array<{ perp: number; position: HLPositionLike }>>;
    resolvePerp: (s: string | number) => Promise<number>;
  };

  if (typeof v.getAllPositions === 'function') {
    try {
      const all = await v.getAllPositions();
      const hit = all.find((p) =>
        p.dex === instrument.venue.dexName && p.perp === instrument.qualifiedSymbol,
      ) ?? all.find((p) => p.perp === instrument.symbol);
      return hit?.position;
    } catch {
      // fall through to main-perp fast path
    }
  }

  if (instrument.venue.dexIndex !== 0) return undefined;
  try {
    const idx = await v.resolvePerp(instrument.symbol);
    const positions = await v.getPositions();
    const hit = positions.find((p) => p.perp === idx);
    return hit?.position;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// compileOpenPosition
// ---------------------------------------------------------------------------

export async function compileOpenPosition(
  vault: HLVault,
  catalog: Instrument[],
  args: CompileOpenArgs,
): Promise<BatchPlan> {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const params: BatchPlanParams = {
    sizeUsd: args.sizeUsd,
    isLong: args.isLong,
    leverage: args.leverage,
    slippageBps: args.slippageBps,
  };

  const { instrument, blocker } = tryResolve(catalog, args.instrumentId);
  if (!instrument) {
    return {
      instrument: {
        id: args.instrumentId,
        symbol: args.instrumentId,
        qualifiedSymbol: args.instrumentId,
        type: 'perp',
        venue: { dexIndex: 0, dexName: 'main', ledger: 'perp' },
        vaultTradable: false,
        szDecimals: 0,
        category: 'other',
      },
      intent: 'open',
      params,
      ops: [],
      warnings,
      blockers: [blocker ?? `unknown instrument ${args.instrumentId}`],
      estimates: emptyEstimates(),
    };
  }

  // ---- Hard checks ----

  if (!instrument.vaultTradable) {
    blockers.push(instrument.vaultTradableReason ?? `instrument ${instrument.id} not tradable by current adapter`);
  }

  if (instrument.type === 'spot') {
    blockers.push(`spot instrument ${instrument.id} cannot be opened as a position — use a swap / bridge flow instead`);
  }

  if (!Number.isFinite(args.sizeUsd) || args.sizeUsd <= 0) {
    blockers.push(`sizeUsd must be positive (got ${args.sizeUsd})`);
  } else if (args.sizeUsd < HL_MIN_NOTIONAL_USD) {
    blockers.push(`sizeUsd ${args.sizeUsd} below HL min notional ($${HL_MIN_NOTIONAL_USD})`);
  }

  const leverage = args.leverage ?? 1;
  if (!Number.isFinite(leverage) || leverage < 1) {
    blockers.push(`leverage must be ≥ 1 (got ${leverage})`);
  } else if (instrument.maxLeverage !== undefined && leverage > instrument.maxLeverage) {
    blockers.push(`leverage ${leverage} exceeds maxLeverage ${instrument.maxLeverage} for ${instrument.symbol}`);
  }

  if (blockers.length > 0) {
    return {
      instrument,
      intent: 'open',
      params,
      ops: [],
      warnings,
      blockers,
      estimates: emptyEstimates(),
    };
  }

  // ---- Vault-state checks (soft) ----

  const marginRequired = (args.sizeUsd / leverage) * 1.05; // 5% buffer
  let freeMarginUsd: number | undefined;
  try {
    const summary = await (vault as unknown as { accountSummary: () => Promise<{ accountValue: bigint; marginUsed: bigint }> }).accountSummary();
    // accountValue and marginUsed are USDC 6-dec bigints.
    const av = Number(summary.accountValue) / 1e6;
    const mu = Number(summary.marginUsed) / 1e6;
    freeMarginUsd = Math.max(av - mu, 0);
    if (freeMarginUsd < marginRequired) {
      warnings.push(
        `vault free margin $${freeMarginUsd.toFixed(2)} below required $${marginRequired.toFixed(2)} (incl. 5% buffer)`,
      );
    }
  } catch {
    warnings.push('could not read vault accountSummary — proceeding without free-margin check');
  }

  const existing = await fetchPositionFor(vault, instrument);
  if (existing && existing.szi !== 0n) {
    const existingLong = existing.szi > 0n;
    if (existingLong !== args.isLong) {
      warnings.push(
        `existing ${existingLong ? 'long' : 'short'} position on ${instrument.symbol} — opening the opposite side will net-close before flipping`,
      );
    } else if (existing.leverage && existing.leverage !== leverage) {
      warnings.push(
        `existing position on ${instrument.symbol} uses leverage ${existing.leverage}; setLeverage(${leverage}) only affects future orders`,
      );
    }
  }

  // ---- Op list ----

  const ops: Operation[] = [];
  let hlActionCount = 0;

  if (instrument.venue.dexIndex === 0) {
    // Main-dex perp: single on-chain `openPosition` call via the adapter.
    const tx = await vault.openPosition({
      perp: instrument.symbol,
      isLong: args.isLong,
      sizeUsd: args.sizeUsd,
      slippageBps: args.slippageBps,
    });
    ops.push({
      kind: 'evmTx',
      to: tx.to as Address,
      data: tx.data as Hex,
      value: tx.value ?? 0n,
      description: `openPosition ${args.isLong ? 'long' : 'short'} ${args.sizeUsd.toFixed(2)} USD on ${instrument.symbol} @ ${leverage}x`,
    });
  } else {
    // Builder-dex perp (xyz, ...): fund the builder ledger, then place
    // the order off-chain. We emit `transferUsdcBetweenLedgers` for the
    // margin (best-effort sizing) UNLESS the vault already has funds on
    // that ledger — the caller is responsible for skipping the transfer
    // if a positive accountValue is observable on the dst dex.
    const dstDex = instrument.venue.dexIndex;
    const transfer = (vault as unknown as {
      transferUsdcBetweenLedgers: (a: { srcDex: number; dstDex: number; usdcAmount: string }) => { to: string; data: string; value?: bigint };
    }).transferUsdcBetweenLedgers({
      srcDex: 0,
      dstDex,
      usdcAmount: marginRequired.toFixed(6),
    });
    ops.push({
      kind: 'evmTx',
      to: transfer.to as Address,
      data: transfer.data as Hex,
      value: transfer.value ?? 0n,
      description: `transferUsdcBetweenLedgers main→${instrument.venue.dexName} $${marginRequired.toFixed(2)}`,
    });

    if (args.leverage !== undefined && args.leverage > 1) {
      const setLevAction: HlExchangeAction = {
        type: 'updateLeverage',
        asset: 0, // resolved at execution time by HLVault.setLeverage; we
        // emit a placeholder action so the plan is structurally complete.
        // The runner calls `vault.setLeverage(instrument.qualifiedSymbol, leverage)`
        // which does the actual asset resolution + signing.
        isCross: true,
        leverage: args.leverage,
      };
      ops.push({
        kind: 'hlExchange',
        action: setLevAction,
        description: `setLeverage ${args.leverage}x on ${instrument.qualifiedSymbol}`,
      });
      hlActionCount++;
    }

    // For builder dexes we don't have direct CoreWriter routing, so the
    // order action is itself a placeholder for `vault.openPositionOffChain`.
    // The runner intercepts `kind: 'hlExchange'` actions of type 'order'
    // with `__placeholder: 'openPositionOffChain'` and calls the SDK helper.
    const orderAction = {
      type: 'order',
      orders: [],
      grouping: 'na',
      __placeholder: 'openPositionOffChain',
      __args: {
        perp: instrument.qualifiedSymbol,
        isLong: args.isLong,
        sizeUsd: args.sizeUsd,
        slippageBps: args.slippageBps,
      },
    } as unknown as HlExchangeAction;
    ops.push({
      kind: 'hlExchange',
      action: orderAction,
      description: `openPositionOffChain ${args.isLong ? 'long' : 'short'} ${args.sizeUsd.toFixed(2)} USD on ${instrument.qualifiedSymbol}`,
    });
    hlActionCount++;
  }

  return {
    instrument,
    intent: 'open',
    params,
    ops,
    warnings,
    blockers,
    estimates: {
      marginRequired,
      notionalUsd: args.sizeUsd,
      liquidationPxApprox: instrument.markPx
        ? approxLiqPx(instrument.markPx, leverage, args.isLong)
        : undefined,
      hlActionCount,
    },
  };
}

// ---------------------------------------------------------------------------
// compileClosePosition
// ---------------------------------------------------------------------------

export async function compileClosePosition(
  vault: HLVault,
  catalog: Instrument[],
  args: CompileCloseArgs,
): Promise<BatchPlan> {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const params: BatchPlanParams = { sizeUsd: args.sizeUsd ?? 0 };

  const { instrument, blocker } = tryResolve(catalog, args.instrumentId);
  if (!instrument) {
    return {
      instrument: {
        id: args.instrumentId,
        symbol: args.instrumentId,
        qualifiedSymbol: args.instrumentId,
        type: 'perp',
        venue: { dexIndex: 0, dexName: 'main', ledger: 'perp' },
        vaultTradable: false,
        szDecimals: 0,
        category: 'other',
      },
      intent: 'close',
      params,
      ops: [],
      warnings,
      blockers: [blocker ?? `unknown instrument ${args.instrumentId}`],
      estimates: emptyEstimates(),
    };
  }

  if (!instrument.vaultTradable) {
    blockers.push(instrument.vaultTradableReason ?? `instrument ${instrument.id} not tradable by current adapter`);
  }
  if (instrument.type === 'spot') {
    blockers.push(`spot instrument ${instrument.id} cannot be closed as a position — use withdrawToEvm / spotSend for token moves`);
  }

  const existing = await fetchPositionFor(vault, instrument);
  if (!existing || existing.szi === 0n) {
    blockers.push(`no open position on ${instrument.qualifiedSymbol}`);
  }

  if (blockers.length > 0) {
    return {
      instrument,
      intent: 'close',
      params,
      ops: [],
      warnings,
      blockers,
      estimates: emptyEstimates(),
    };
  }

  // Position notional approximation: |szi| × markPx (szDecimals scales szi).
  const sziAbs = existing!.szi < 0n ? -existing!.szi : existing!.szi;
  const sziReal = Number(sziAbs) / 10 ** instrument.szDecimals;
  const positionNotional = instrument.markPx ? sziReal * instrument.markPx : 0;
  const sizeUsd = args.sizeUsd ?? positionNotional;
  params.sizeUsd = sizeUsd;

  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    blockers.push(`close sizeUsd ${sizeUsd} must be positive (could not infer position notional — pass sizeUsd explicitly)`);
    return {
      instrument,
      intent: 'close',
      params,
      ops: [],
      warnings,
      blockers,
      estimates: emptyEstimates(),
    };
  }

  if (sizeUsd > positionNotional && positionNotional > 0) {
    warnings.push(
      `close sizeUsd $${sizeUsd.toFixed(2)} exceeds estimated position notional $${positionNotional.toFixed(2)} — adapter will clamp to position size`,
    );
  }

  const ops: Operation[] = [];
  let hlActionCount = 0;
  const isFullClose = sizeUsd >= positionNotional * 0.99;

  if (instrument.venue.dexIndex === 0) {
    const tx = await vault.closePosition({
      perp: instrument.symbol,
      sizeUsd,
    });
    ops.push({
      kind: 'evmTx',
      to: tx.to as Address,
      data: tx.data as Hex,
      value: tx.value ?? 0n,
      description: `closePosition ${sizeUsd.toFixed(2)} USD on ${instrument.symbol}${isFullClose ? ' (full close)' : ''}`,
    });
  } else {
    // Builder-dex close: off-chain order action. Optionally sweep USDC
    // back to main after a full close (best-effort — sweep amount unknown
    // pre-fill, so the caller can choose to skip this step).
    const orderAction = {
      type: 'order',
      orders: [],
      grouping: 'na',
      __placeholder: 'closePositionOffChain',
      __args: {
        perp: instrument.qualifiedSymbol,
        sizeUsd,
      },
    } as unknown as HlExchangeAction;
    ops.push({
      kind: 'hlExchange',
      action: orderAction,
      description: `closePositionOffChain ${sizeUsd.toFixed(2)} USD on ${instrument.qualifiedSymbol}${isFullClose ? ' (full close)' : ''}`,
    });
    hlActionCount++;

    if (isFullClose) {
      // Sweep the freed margin back to main HL perp. The amount here is
      // best-effort (we use sizeUsd as a proxy — exact freed margin
      // depends on PnL); the runner can re-compute pre-broadcast.
      const sweep = (vault as unknown as {
        transferUsdcBetweenLedgers: (a: { srcDex: number; dstDex: number; usdcAmount: string }) => { to: string; data: string; value?: bigint };
      }).transferUsdcBetweenLedgers({
        srcDex: instrument.venue.dexIndex,
        dstDex: 0,
        usdcAmount: sizeUsd.toFixed(6),
      });
      ops.push({
        kind: 'evmTx',
        to: sweep.to as Address,
        data: sweep.data as Hex,
        value: sweep.value ?? 0n,
        description: `transferUsdcBetweenLedgers ${instrument.venue.dexName}→main $${sizeUsd.toFixed(2)} (post-close sweep)`,
      });
    }
  }

  return {
    instrument,
    intent: 'close',
    params,
    ops,
    warnings,
    blockers,
    estimates: {
      marginRequired: 0, // closing releases margin, doesn't consume it
      notionalUsd: sizeUsd,
      hlActionCount,
    },
  };
}

// ---------------------------------------------------------------------------
// executeBatchPlan
// ---------------------------------------------------------------------------

export interface BatchExecutor {
  /// Broadcast an EVM tx. Returns the tx hash. In simulation / preview
  /// flows this can be a no-op that returns a stub hash.
  sendEvmTx: (op: Extract<Operation, { kind: 'evmTx' }>) => Promise<string>;
  /// Submit an HL Exchange API action via an `HLExchangeClient` (or
  /// equivalent). The runner uses the vault's own client to ensure the
  /// agent wallet is the signer.
  sendHlAction: (op: Extract<Operation, { kind: 'hlExchange' }>) => Promise<unknown>;
}

export interface ExecuteBatchPlanResult {
  executed: Array<{ op: Operation; result: string | unknown }>;
  failure?: { op: Operation; error: Error };
  dryRun: boolean;
}

export interface ExecuteBatchPlanOptions {
  dryRun?: boolean;
}

/// @notice Thin runner: walk `plan.ops` in order, stop on first error.
/// Returns the structured result so the caller can render a step-by-step
/// progress UI. Set `dryRun: true` to skip every transport call and just
/// emit the plan structure (useful for the MCP preview tool).
export async function executeBatchPlan(
  plan: BatchPlan,
  executor: BatchExecutor,
  opts: ExecuteBatchPlanOptions = {},
): Promise<ExecuteBatchPlanResult> {
  const dryRun = opts.dryRun ?? false;
  const executed: ExecuteBatchPlanResult['executed'] = [];

  if (plan.blockers.length > 0) {
    return {
      executed: [],
      failure: {
        op: { kind: 'evmTx', to: '0x0000000000000000000000000000000000000000' as Address, data: '0x' as Hex, value: 0n, description: 'plan has blockers' },
        error: new Error(`cannot execute: ${plan.blockers.join('; ')}`),
      },
      dryRun,
    };
  }

  if (dryRun) {
    return { executed: plan.ops.map((op) => ({ op, result: 'dry-run' })), dryRun };
  }

  for (const op of plan.ops) {
    try {
      if (op.kind === 'evmTx') {
        const hash = await executor.sendEvmTx(op);
        executed.push({ op, result: hash });
      } else {
        const result = await executor.sendHlAction(op);
        executed.push({ op, result });
      }
    } catch (err) {
      return {
        executed,
        failure: { op, error: err instanceof Error ? err : new Error(String(err)) },
        dryRun,
      };
    }
  }

  return { executed, dryRun };
}
