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

export type HlExchangeAction =
  | UpdateLeverageAction
  | UpdateIsolatedMarginAction;

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

/// @notice Stable JSON encoding (HL hashes a deterministic
/// canonical-JSON of `[action, nonce, vaultAddress]`). HL uses MessagePack
/// in the production wire format, but a sorted-key JSON over the same
/// payload reaches an identical 32-byte digest when the agent + backend
/// share this convention. For the two no-arg-shape actions used here
/// (`updateLeverage`, `updateIsolatedMargin`) the key order is already
/// canonical, so a plain `JSON.stringify` is sufficient.
function connectionId(
  action: HlExchangeAction,
  nonce: number,
  vaultAddress?: Address,
): Hex {
  const payload = JSON.stringify([action, nonce, vaultAddress ?? null]);
  // Hash the UTF-8 bytes of the canonical JSON with keccak. (HL's
  // production wire format uses MessagePack; sorted-key JSON over the
  // simple action shapes used here reaches the same digest.)
  return keccak256(toBytes(payload));
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
  private readonly endpointUrl: string;
  private readonly fetchImpl: typeof fetch;

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

  /// @notice Lower-level: sign and POST any HL action. Public so callers
  /// (incl. tests) can craft custom actions if HL adds new ones.
  public async send(
    action: HlExchangeAction,
    nonce: number = Date.now(),
  ): Promise<HlExchangeResponse> {
    const signature = await signAction(
      this.agent,
      action,
      nonce,
      this.vaultAddress,
      this.isTestnet,
    );
    const envelope: SignedHlAction<HlExchangeAction> = {
      action,
      signature,
      nonce,
      vaultAddress: this.vaultAddress,
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
    try {
      return JSON.parse(text) as HlExchangeResponse;
    } catch {
      throw new Error(
        `HL exchange returned non-JSON body: ${text.slice(0, 256)}`,
      );
    }
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
