// SPDX-FileCopyrightText: 2026 FACTOR
// SPDX-License-Identifier: MIT
//
// HyperLiquid Exchange API client for EIP-712-signed off-chain actions.
//
// Only `updateLeverage` and `updateIsolatedMargin` flow through this path
// — every other adapter call is on-chain via `executeByManager`.
//
// The HL Exchange domain is a known platform quirk: typed-data signing
// uses `chainId = 1337` regardless of the actual network (HyperEVM mainnet
// is 999), and `verifyingContract = 0x0`. The `vaultAddress` field on the
// signed envelope is what makes HL apply the action against the vault's
// HL identity instead of the agent EOA's own (otherwise leverage updates
// would land in an empty agent account).
//
// No npm dep — we sign with `viem`'s `LocalAccount.signTypedData` and post
// raw JSON to `https://api.hyperliquid.xyz/exchange`.

import type { Address, Hex, LocalAccount } from 'viem';
import { hashTypedData, keccak256, toBytes } from 'viem';
import { encode as msgpackEncode } from '@msgpack/msgpack';

import type { HlExchangeResponse, SignedHlAction } from './types.js';

// ---------------------------------------------------------------------------
// Endpoints + domain
// ---------------------------------------------------------------------------

export const HL_EXCHANGE_URL_MAINNET =
  'https://api.hyperliquid.xyz/exchange';
export const HL_EXCHANGE_URL_TESTNET =
  'https://api.hyperliquid-testnet.xyz/exchange';

/// @notice HL's fixed typed-data domain. `chainId` is always 1337 (HL
/// quirk — the signed action is verified on HL's L1, NOT HyperEVM).
const HL_DOMAIN = {
  name: 'Exchange',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000',
} as const;

// ---------------------------------------------------------------------------
// Action payload shapes (HL canonical JSON)
// ---------------------------------------------------------------------------

/// @notice CoreWriter action 2 — set default leverage for a perp. Note
/// this DOES NOT change leverage on already-open positions; it only
/// affects subsequent fills.
export interface UpdateLeverageAction {
  type: 'updateLeverage';
  asset: number;
  isCross: boolean;
  leverage: number;
}

/// @notice CoreWriter action 10 — change isolated margin on a position.
/// `ntli` is signed; positive adds margin, negative removes.
export interface UpdateIsolatedMarginAction {
  type: 'updateIsolatedMargin';
  asset: number;
  isBuy: boolean;
  ntli: number;
}

/// @notice Place an order on any HL perp dex (main = asset 0-65535,
///         builder dex `xyz` = asset 100000+). HL routes by the global
///         asset index. Required for HIP-3 builder-dex trading because
///         CoreWriter action 1 has been empirically shown NOT to handle
///         builder-dex routing (consumes all gas and reverts on
///         asset≥100000 as of mainnet 2026-05-14).
///
/// HL's canonical msgpack key order for `order`:
///   { type, orders: [{ a, b, p, s, r, t }], grouping, builder? }
/// where:
///   a = asset (uint32, global)
///   b = isBuy (bool)
///   p = limit price as string (real USD, NOT 1e8-wire) — HL uses string
///       to preserve exact decimal representation
///   s = size as string (real units, NOT 1e8-wire)
///   r = reduceOnly
///   t = TIF object: {limit: {tif: 'Ioc'|'Alo'|'Gtc'}} OR
///                   {trigger: {triggerPx, isMarket, tpsl}}
///   grouping: "na" for plain orders
export interface OrderAction {
  type: 'order';
  orders: Array<{
    a: number;
    b: boolean;
    p: string;
    s: string;
    r: boolean;
    t: { limit: { tif: 'Ioc' | 'Alo' | 'Gtc' } };
    c?: string; // optional client order id (hex)
  }>;
  grouping: 'na' | 'normalTpsl' | 'positionTpsl';
}

/// @notice Cancel by cloid (off-chain). The on-chain counterpart is
/// CoreWriter action 11 — exposed for the builder-dex case where on-chain
/// cancel also fails. Cancels via oid use `cancel` action with `o`.
export interface CancelByCloidAction {
  type: 'cancelByCloid';
  cancels: Array<{ asset: number; cloid: string }>;
}

/// @notice Enable HIP-3 builder-dex abstraction for the agent's master
/// account. L1-signed action. Empirically verified on mainnet 2026-05-14
/// (factor-sdk-studio side). Mirror of the SDK action — see SDK
/// `exchange.ts` for the full docstring + caveats around the LEGACY
/// `dexAbstraction` mode it puts the master into.
export interface AgentEnableDexAbstractionAction {
  type: 'agentEnableDexAbstraction';
}

/// @notice Set agent's master abstraction mode (L1-signed).
export interface AgentSetAbstractionAction {
  type: 'agentSetAbstraction';
  abstraction: 'u' | 'p' | 'i';
}

/// @notice User-signed approveBuilderFee. REJECTED for vault accounts on
/// mainnet — exposed for parity with the SDK. Use
/// `agentEnableDexAbstraction` for the vault HIP-3 init flow.
export interface ApproveBuilderFeeAction {
  type: 'approveBuilderFee';
  builder: Address;
  maxFeeRate: string;
  nonce: number;
  hyperliquidChain?: 'Mainnet' | 'Testnet';
  signatureChainId?: Hex;
}

export type HlExchangeAction =
  | UpdateLeverageAction
  | UpdateIsolatedMarginAction
  | OrderAction
  | CancelByCloidAction
  | AgentEnableDexAbstractionAction
  | AgentSetAbstractionAction
  | ApproveBuilderFeeAction;

// ---------------------------------------------------------------------------
// EIP-712 helpers
// ---------------------------------------------------------------------------

/// @notice HL signs a hash of the canonical JSON payload (`Agent` typed
/// data) rather than the action object directly. The flow used by the
/// reference HL SDKs is:
///   1. encode `action` + `nonce` + `vaultAddress` → 32-byte connection-id
///   2. sign `Agent { source, connectionId }` typed data with the HL domain
///   3. wrap signature + raw `action` into the wire envelope.
///
/// We replicate that exactly so an agent signature is wire-compatible with
/// every HL backend / SDK.
const AGENT_TYPES = {
  Agent: [
    { name: 'source', type: 'string' },
    { name: 'connectionId', type: 'bytes32' },
  ],
} as const;

/// @notice Build a NEW action object with keys in HL's canonical order
/// for msgpack encoding. Previously we relied on JS object insertion
/// order via `{ sortKeys: false }`, which works today but is fragile:
/// a minifier, a transpiler IIFE, or any innocuous refactor that
/// reorders the literal would silently change the msgpack digest and
/// break HL signature recovery (HL would recover a different agent
/// address than we expect, and the action would be rejected).
///
/// The canonical order matches the reference HL Python SDK
/// (`hyperliquid-python-sdk/hyperliquid/utils/signing.py`) and the
/// per-action comments at the top of this file:
///   - OrderAction:               { type, orders, grouping, builder? }
///     each order:                { a, b, p, s, r, t, c? }
///   - CancelByCloidAction:       { type, cancels }
///     each cancel:               { asset, cloid }
///   - UpdateLeverageAction:      { type, asset, isCross, leverage }
///   - UpdateIsolatedMarginAction:{ type, asset, isBuy, ntli }
function canonicalizeAction(a: HlExchangeAction): unknown {
  switch (a.type) {
    case 'order': {
      const orders = a.orders.map((o) => {
        const co: Record<string, unknown> = {
          a: o.a,
          b: o.b,
          p: o.p,
          s: o.s,
          r: o.r,
          t: o.t,
        };
        if (o.c !== undefined) co.c = o.c;
        return co;
      });
      const out: Record<string, unknown> = {
        type: a.type,
        orders,
        grouping: a.grouping,
      };
      // `builder` is not in our typed `OrderAction` today, but mirror
      // the HL canonical slot so adding it later doesn't change the
      // digest of pre-existing fields.
      const maybeBuilder = (a as unknown as { builder?: unknown }).builder;
      if (maybeBuilder !== undefined) out.builder = maybeBuilder;
      return out;
    }
    case 'cancelByCloid': {
      return {
        type: a.type,
        cancels: a.cancels.map((c) => ({ asset: c.asset, cloid: c.cloid })),
      };
    }
    case 'updateLeverage': {
      return {
        type: a.type,
        asset: a.asset,
        isCross: a.isCross,
        leverage: a.leverage,
      };
    }
    case 'updateIsolatedMargin': {
      return {
        type: a.type,
        asset: a.asset,
        isBuy: a.isBuy,
        ntli: a.ntli,
      };
    }
    case 'agentEnableDexAbstraction': {
      return { type: a.type };
    }
    case 'agentSetAbstraction': {
      return { type: a.type, abstraction: a.abstraction };
    }
    case 'approveBuilderFee': {
      const out: Record<string, unknown> = { type: a.type };
      if (a.hyperliquidChain !== undefined) out.hyperliquidChain = a.hyperliquidChain;
      if (a.signatureChainId !== undefined) out.signatureChainId = a.signatureChainId;
      out.maxFeeRate = a.maxFeeRate;
      out.builder = a.builder;
      out.nonce = a.nonce;
      return out;
    }
    default: {
      // Exhaustiveness: TS will surface a missing case here at compile time.
      const _exhaustive: never = a;
      throw new Error(`canonicalizeAction: unknown action ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/// @notice HL's canonical action hash. Verified against the reference
/// Python SDK (`hyperliquid-python-sdk/hyperliquid/utils/signing.py`):
///
///   data = msgpack(action) || nonce_u64_be || (b"\x00" if no vault
///                                                else b"\x01" || vault_addr_20)
///   connection_id = keccak256(data)
///
/// We tried sorted-JSON first — HL recovered a wrong agent address
/// because the msgpack digest is different. Don't substitute msgpack
/// with anything else here.
export function connectionId(
  action: HlExchangeAction,
  nonce: number,
  vaultAddress?: Address,
): Hex {
  // Canonicalize key order BEFORE msgpack so we don't depend on JS
  // engine insertion order. `sortKeys: false` is intentional — HL's
  // canonical order is NOT alphabetical (e.g. OrderAction is
  // {type, orders, grouping}, not {grouping, orders, type}).
  const actionBytes = msgpackEncode(canonicalizeAction(action), { sortKeys: false });
  const nonceBytes = new Uint8Array(8);
  // Big-endian u64 nonce — HL uses millisecond timestamps so fits in 53 bits.
  const view = new DataView(nonceBytes.buffer);
  view.setBigUint64(0, BigInt(nonce), false /* big-endian */);
  let vaultBytes: Uint8Array;
  if (vaultAddress) {
    const addrHex = vaultAddress.replace(/^0x/, '').toLowerCase();
    vaultBytes = new Uint8Array(21);
    vaultBytes[0] = 0x01;
    for (let i = 0; i < 20; i++) {
      vaultBytes[1 + i] = parseInt(addrHex.slice(i * 2, i * 2 + 2), 16);
    }
  } else {
    vaultBytes = new Uint8Array([0x00]);
  }
  const data = new Uint8Array(actionBytes.length + 8 + vaultBytes.length);
  data.set(actionBytes, 0);
  data.set(nonceBytes, actionBytes.length);
  data.set(vaultBytes, actionBytes.length + 8);
  return keccak256(data);
}

async function signAction(
  agent: LocalAccount,
  action: HlExchangeAction,
  nonce: number,
  vaultAddress?: Address,
  isTestnet = false,
): Promise<{ r: Hex; s: Hex; v: number }> {
  const cid = connectionId(action, nonce, vaultAddress);
  const sigHex = await agent.signTypedData({
    domain: HL_DOMAIN,
    types: AGENT_TYPES,
    primaryType: 'Agent',
    message: {
      source: isTestnet ? 'b' : 'a',
      connectionId: cid,
    },
  });
  return splitSignature(sigHex);
}

function splitSignature(sig: Hex): { r: Hex; s: Hex; v: number } {
  if (sig.length !== 132) {
    throw new Error(`unexpected signature length ${sig.length} (expected 132)`);
  }
  const r = ('0x' + sig.slice(2, 66)) as Hex;
  const s = ('0x' + sig.slice(66, 130)) as Hex;
  const vRaw = parseInt(sig.slice(130, 132), 16);
  const v = vRaw < 27 ? vRaw + 27 : vRaw;
  return { r, s, v };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface HLExchangeClientOptions {
  agent: LocalAccount;
  /// Vault contract address — HL applies the signed action to THIS account
  /// (not the agent's own). Without this, leverage updates land in the
  /// agent EOA's empty HL account.
  vaultAddress: Address;
  isTestnet?: boolean;
  /// Override the HL endpoint (e.g. for mocking in tests).
  endpointUrl?: string;
  /// Inject a fetch impl for non-browser / non-Node-18 envs and tests.
  fetchImpl?: typeof fetch;
}

export class HLExchangeClient {
  private readonly agent: LocalAccount;
  private readonly vaultAddress: Address;
  private readonly isTestnet: boolean;
  // Public so HLVault can reach the matching /info endpoint + fetch impl
  // without re-instantiating its own. Replacing the URL on a live client
  // is not supported (treat as readonly even though the type permits it).
  public readonly endpointUrl: string;
  public readonly fetchImpl: typeof fetch;

  constructor(opts: HLExchangeClientOptions) {
    this.agent = opts.agent;
    this.vaultAddress = opts.vaultAddress;
    this.isTestnet = opts.isTestnet ?? false;
    this.endpointUrl =
      opts.endpointUrl ??
      (this.isTestnet ? HL_EXCHANGE_URL_TESTNET : HL_EXCHANGE_URL_MAINNET);
    // `fetch` is globally available in Node ≥ 18 and all browsers — fall
    // back to the global if not injected.
    this.fetchImpl =
      opts.fetchImpl ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (() => {
            throw new Error(
              'HLExchangeClient: no global fetch available; inject `fetchImpl`',
            );
          })());
  }

  /// @notice Set default leverage for `asset` (perp index). DOES NOT
  /// retroactively change leverage on open positions — HL semantics.
  public async updateLeverage(args: {
    asset: number;
    isCross: boolean;
    leverage: number;
  }): Promise<HlExchangeResponse> {
    if (!Number.isInteger(args.leverage) || args.leverage < 1) {
      throw new Error(
        `updateLeverage: leverage must be a positive integer (got ${args.leverage})`,
      );
    }
    const action: UpdateLeverageAction = {
      type: 'updateLeverage',
      asset: args.asset,
      isCross: args.isCross,
      leverage: args.leverage,
    };
    return this.send(action);
  }

  /// @notice Add or remove isolated margin on an existing position.
  /// `ntli` is in HL 6-dec USDC (positive = add, negative = remove).
  public async updateIsolatedMargin(args: {
    asset: number;
    isBuy: boolean;
    ntli: number;
  }): Promise<HlExchangeResponse> {
    if (!Number.isFinite(args.ntli)) {
      throw new Error(`updateIsolatedMargin: ntli must be finite`);
    }
    const action: UpdateIsolatedMarginAction = {
      type: 'updateIsolatedMargin',
      asset: args.asset,
      isBuy: args.isBuy,
      ntli: args.ntli,
    };
    return this.send(action);
  }

  /// @notice Place a single order via the HL Exchange API. Used for HIP-3
  /// builder-dex perps (asset≥100000) where CoreWriter does not yet route
  /// correctly. The agent EOA's signature authenticates the action; HL
  /// applies it against the master account (= this vault, via the
  /// agent→master mapping established by `addApiWallet`).
  ///
  /// @param asset Global asset index. Main dex: 0..N. xyz dex: 100000+.
  /// @param isBuy true = long open / short close. false = short open / long close.
  /// @param limitPxReal Limit price in REAL USD (NOT 1e8-wire). HL's
  ///        exchange API uses string for exact decimal — pass e.g. "5406"
  ///        for $5406.
  /// @param sizeReal Size in REAL units (NOT 1e8-wire). E.g. "0.0023" GOLD.
  /// @param reduceOnly true to make the order reduce-only.
  /// @param tif "Ioc" | "Alo" | "Gtc".
  public async placeOrder(args: {
    asset: number;
    isBuy: boolean;
    limitPxReal: string;
    sizeReal: string;
    reduceOnly: boolean;
    tif: 'Ioc' | 'Alo' | 'Gtc';
    cloid?: string;
  }): Promise<HlExchangeResponse> {
    const order: OrderAction['orders'][number] = {
      a: args.asset,
      b: args.isBuy,
      p: args.limitPxReal,
      s: args.sizeReal,
      r: args.reduceOnly,
      t: { limit: { tif: args.tif } },
    };
    if (args.cloid) order.c = args.cloid;
    const action: OrderAction = {
      type: 'order',
      orders: [order],
      grouping: 'na',
    };
    return this.send(action);
  }

  /// @notice Enable HIP-3 builder-dex abstraction for the agent's master
  /// account. See SDK `exchange.ts::agentEnableDexAbstraction` for full
  /// caveats about LEGACY `dexAbstraction` mode.
  public async agentEnableDexAbstraction(): Promise<HlExchangeResponse> {
    const action: AgentEnableDexAbstractionAction = { type: 'agentEnableDexAbstraction' };
    return this.send(action);
  }

  /// @notice Set master abstraction mode (u/p/i). Many transitions return
  /// "Abstraction transition not allowed"; see SDK for the allowed graph.
  public async agentSetAbstraction(abstraction: 'u' | 'p' | 'i'): Promise<HlExchangeResponse> {
    const action: AgentSetAbstractionAction = { type: 'agentSetAbstraction', abstraction };
    return this.send(action);
  }

  /// @notice Approve a builder address to charge fees. REJECTED for vault
  /// accounts — exposed for parity. Use `agentEnableDexAbstraction` for
  /// HIP-3 builder-dex init flows.
  public async approveBuilderFee(args: {
    builder: Address;
    maxFeeRate: string;
  }): Promise<HlExchangeResponse> {
    const nonce = this.nextNonce();
    const action: ApproveBuilderFeeAction = {
      type: 'approveBuilderFee',
      builder: args.builder,
      maxFeeRate: args.maxFeeRate,
      nonce,
      hyperliquidChain: this.isTestnet ? 'Testnet' : 'Mainnet',
      signatureChainId: '0x66eee' as Hex,
    };
    const sigHex = await this.agent.signTypedData({
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: 421614,
        verifyingContract: '0x0000000000000000000000000000000000000000',
      },
      types: {
        'HyperliquidTransaction:ApproveBuilderFee': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'maxFeeRate', type: 'string' },
          { name: 'builder', type: 'address' },
          { name: 'nonce', type: 'uint64' },
        ],
      },
      primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
      message: {
        hyperliquidChain: action.hyperliquidChain!,
        maxFeeRate: action.maxFeeRate,
        builder: action.builder,
        nonce: BigInt(action.nonce),
      },
    });
    const signature = splitSignature(sigHex);
    const envelope: SignedHlAction<ApproveBuilderFeeAction> = {
      action,
      signature,
      nonce,
    };
    const res = await this.fetchImpl(this.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HL exchange ${res.status} ${res.statusText}: ${text.slice(0, 256)}`);
    }
    const parsed = JSON.parse(text) as HlExchangeResponse;
    if (parsed.status === 'err') {
      throw new Error(`HL exchange rejected approveBuilderFee: ${parsed.response}`);
    }
    return parsed;
  }

  /// @notice Cancel by client order id (off-chain).
  public async cancelByCloid(asset: number, cloid: string): Promise<HlExchangeResponse> {
    const action: CancelByCloidAction = {
      type: 'cancelByCloid',
      cancels: [{ asset, cloid }],
    };
    return this.send(action);
  }

  /// @notice Lower-level: sign and POST any HL action. Public so callers
  /// (incl. tests) can craft custom actions if HL adds new ones.
  public async send(
    action: HlExchangeAction,
    nonce: number = this.nextNonce(),
  ): Promise<HlExchangeResponse> {
    // CRITICAL: do NOT pass vaultAddress in the connectionId hash OR in the
    // wire envelope. HL reserves `vaultAddress` for its MANAGED share-vault
    // product (where the master IS a registered HL-vault entity). Our pattern
    // is agent → master mapping via `addApiWallet` — HL applies the signed
    // action to the master account (our vault contract) automatically via
    // the agent→master link. Passing vaultAddress triggers HL's vault-lookup
    // path and fails with "Vault not registered" because our contract is a
    // regular HL user, not a HL-vault.
    const signature = await signAction(
      this.agent,
      action,
      nonce,
      undefined,
      this.isTestnet,
    );
    const envelope: SignedHlAction<HlExchangeAction> = {
      action,
      signature,
      nonce,
    };
    const res = await this.fetchImpl(this.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const text = await res.text();
    // HL returns 200 + JSON `{status:'ok'|'err', response:...}` for
    // every well-formed request. Surface non-200s explicitly because
    // they indicate transport / nonce-window errors, not action errors.
    if (!res.ok) {
      throw new Error(
        `HL exchange ${res.status} ${res.statusText}: ${text.slice(0, 256)}`,
      );
    }
    let parsed: HlExchangeResponse;
    try {
      parsed = JSON.parse(text) as HlExchangeResponse;
    } catch {
      throw new Error(
        `HL exchange returned non-JSON body: ${text.slice(0, 256)}`,
      );
    }
    // HL signals action-level rejections (insufficient margin, bad limit
    // price, unknown asset, etc.) via `{status:'err', response:<reason>}`
    // on a 200 OK. The previous behavior of silently returning the err
    // object made caller code easy to write but easy to misread — every
    // call site has to remember to inspect `.status`. Failing loudly is
    // the safer default; callers that intentionally tolerate err can
    // wrap in try/catch.
    if (parsed.status === 'err') {
      throw new Error(`HL exchange rejected action: ${parsed.response}`);
    }
    return parsed;
  }

  /// Monotonically-increasing per-instance nonce. HL requires nonces to
  /// be strictly increasing per agent inside a sliding window; using bare
  /// `Date.now()` collides when two send() calls land in the same
  /// millisecond. We anchor to wall time so cross-instance replays still
  /// pass HL's freshness window.
  private _lastNonce = 0;
  private nextNonce(): number {
    const now = Date.now();
    const next = now > this._lastNonce ? now : this._lastNonce + 1;
    this._lastNonce = next;
    return next;
  }
}

/// @notice Convenience factory mirroring the design doc shape.
export function makeExchange(
  agent: LocalAccount,
  vaultAddress: Address,
  opts: { isTestnet?: boolean; endpointUrl?: string; fetchImpl?: typeof fetch } = {},
): HLExchangeClient {
  return new HLExchangeClient({ agent, vaultAddress, ...opts });
}

// Re-export the typed-data hasher so callers / tests can independently
// compute the expected digest if they need to verify signatures.
export { hashTypedData };
