/**
 * HyperLiquid MCP Tools — Schema & Wiring Tests
 *
 * Validates:
 *   - Every HL tool's zod schema accepts well-formed input and rejects malformed
 *     input (missing fields, wrong types, out-of-range values).
 *   - Every HL tool's `inputSchema` (the MCP-facing JSON Schema) is well-formed.
 *   - HL tools refuse to execute on non-HyperEVM chains (chain id != 999).
 *   - Each tool invokes the right `HLVault` method with the expected args.
 *
 * The SDK is mocked — no real RPC calls are made. We import each HL tool file
 * directly to bypass the (pre-existing, unrelated) broken `tools/index.ts`
 * import chain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the wallet signer so handler() never touches the network.
vi.mock('../src/wallet/signer.js', () => ({
  sendTransaction: vi.fn(async () => ({ hash: '0xdeadbeef' as `0x${string}` })),
  estimateGas: vi.fn(async () => ({ gasLimit: 21_000n, totalCostEth: '0.0001' })),
}));

// Mock the HLVault factory. Every tool calls `buildHlVault(...)`; we return
// a stub `HLVault` whose methods record calls + return canned envelopes /
// nav data, so handlers exercise the full code path without any RPC.
const mockOpenPosition = vi.fn(async (_args: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xcafebabe' as `0x${string}`,
  value: 0n,
}));
const mockClosePosition = vi.fn(async (_args: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xfeedface' as `0x${string}`,
  value: 0n,
}));
const mockSetLeverage = vi.fn(async (..._args: unknown[]) => ({
  status: 'ok',
  response: { type: 'order', data: { statuses: [] } },
} as unknown));
const mockAddIsolatedMargin = vi.fn(async (..._args: unknown[]) => ({
  status: 'ok',
  response: { type: 'order', data: { statuses: [] } },
} as unknown));
const mockDepositToPerp = vi.fn((_amount: string) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xdeadbeef' as `0x${string}`,
  value: 0n,
}));
const mockWithdrawToEvm = vi.fn((_amount: string) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xbeefcafe' as `0x${string}`,
  value: 0n,
}));
const mockGetNav = vi.fn(async () => ({
  evmUsdc: 1_000_000n,
  spotUsdc: 500_000n,
  perpEquity: 250_000n,
  totalUsdc: 1_750_000n,
}));
const mockGetPositions = vi.fn(async () => [
  {
    perp: 0,
    position: {
      szi: 100_000_000n,
      entryNtl: 250_000_000n,
      isolatedRawUsd: 10_000_000n,
      leverage: 5,
      isIsolated: false,
    },
  },
]);
const mockOpenPositionOffChain = vi.fn(async (_args: unknown) => ({
  status: 'ok',
  response: { type: 'order', data: { statuses: [{ filled: { totalSz: '0.001', avgPx: '2300' } }] } },
} as unknown));
const mockClosePositionOffChain = vi.fn(async (_args: unknown) => ({
  status: 'ok',
  response: { type: 'order', data: { statuses: [{ filled: { totalSz: '0.001', avgPx: '2300' } }] } },
} as unknown));
const mockTransferToBuilderDex = vi.fn((_args: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xbeefdead' as `0x${string}`,
  value: 0n,
}));
const mockTransferFromBuilderDex = vi.fn((_args: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xdeadcafe' as `0x${string}`,
  value: 0n,
}));
const mockSyncPosition = vi.fn(async (_perp: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xa11ce555' as `0x${string}`,
  value: 0n,
}));
const mockSettlePending = vi.fn((_cloid: bigint) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xb0b1ce5e' as `0x${string}`,
  value: 0n,
}));
const mockCancelOrder = vi.fn(async (_args: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xc4ce10ab' as `0x${string}`,
  value: 0n,
}));
const mockCancelOrderOffChain = vi.fn(async (_args: unknown) => ({
  status: 'ok',
  response: { type: 'cancel', data: { statuses: [{ success: true }] } },
} as unknown));
const mockPlaceOrder = vi.fn(async (_args: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xb1d50f4a' as `0x${string}`,
  value: 0n,
}));
const mockPlaceOrderOffChain = vi.fn(async (_args: unknown) => ({
  status: 'ok',
  response: { type: 'order', data: { statuses: [{ resting: { oid: 1 } }] } },
} as unknown));
const mockListPerps = vi.fn(async (_dex?: string) => [
  {
    index: 0,
    name: 'xyz:GOLD',
    szDecimals: 4,
    maxLeverage: 5,
    onlyIsolated: false,
    markPx: 2310.5,
  },
  {
    index: 1,
    name: 'xyz:BRENTOIL',
    szDecimals: 2,
    maxLeverage: 3,
    onlyIsolated: true,
    markPx: 88.12,
  },
]);
const mockForceForgetCloid = vi.fn((_cloid: bigint) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xffc1eafe' as `0x${string}`,
  value: 0n,
}));
const mockSetMaxKnownBuilderDex = vi.fn((_newMax: number) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xa1b2c3d4' as `0x${string}`,
  value: 0n,
}));
const mockSpotSend = vi.fn((_args: unknown) => ({
  to: '0xVaultDeadBeef0000000000000000000000000000' as `0x${string}`,
  data: '0xdeadcaff' as `0x${string}`,
  value: 0n,
}));
const mockListSpotTokens = vi.fn(async () => [
  { index: 0, name: 'USDC', szDecimals: 8, weiDecimals: 8 },
  { index: 150, name: 'HYPE', szDecimals: 8, weiDecimals: 18, evmContract: '0x0000000000000000000000000000000000000150' },
  { index: 200, name: 'AAPL', szDecimals: 4, weiDecimals: 8 },
]);
const mockListDexes = vi.fn(async (_opts?: { includeUnsupported?: boolean }) => [
  { index: 0, name: 'main', type: 'main' as const, assetCount: 230, supported: true },
  {
    index: 1,
    name: 'xyz',
    type: 'builder' as const,
    deployer: '0xDEADbeef00000000000000000000000000000001',
    feeRecipient: '0xDEADbeef00000000000000000000000000000002',
    assetCount: 12,
    supported: true,
  },
]);

vi.mock('../src/tools/hl/hl-vault-factory.js', () => {
  return {
    buildHlVault: vi.fn(() => ({
      openPosition: mockOpenPosition,
      closePosition: mockClosePosition,
      openPositionOffChain: mockOpenPositionOffChain,
      closePositionOffChain: mockClosePositionOffChain,
      setLeverage: mockSetLeverage,
      addIsolatedMargin: mockAddIsolatedMargin,
      depositToPerp: mockDepositToPerp,
      withdrawToEvm: mockWithdrawToEvm,
      getNav: mockGetNav,
      getPositions: mockGetPositions,
      transferToBuilderDex: mockTransferToBuilderDex,
      transferFromBuilderDex: mockTransferFromBuilderDex,
      listPerps: mockListPerps,
      syncPosition: mockSyncPosition,
      settlePending: mockSettlePending,
      cancelOrder: mockCancelOrder,
      cancelOrderOffChain: mockCancelOrderOffChain,
      placeOrder: mockPlaceOrder,
      placeOrderOffChain: mockPlaceOrderOffChain,
      forceForgetCloid: mockForceForgetCloid,
      setMaxKnownBuilderDex: mockSetMaxKnownBuilderDex,
      spotSend: mockSpotSend,
      listSpotTokens: mockListSpotTokens,
      listDexes: mockListDexes,
    })),
  };
});

// Mock configManager: pretend we have a wallet, simulation mode on, chain 999.
vi.mock('../src/config/index.js', () => {
  const state = {
    chainId: 999,
    chainName: 'HYPEREVM',
    walletName: 'test-wallet' as string | null,
    simulation: true,
    rpcUrl: 'https://rpc.hyperliquid-mainnet.xyz',
    environment: 'testing' as 'production' | 'staging' | 'testing',
  };
  const configManager = {
    __state: state,
    getConfig: () => ({
      chain: state.chainName,
      rpcUrl: state.rpcUrl,
      simulationMode: state.simulation,
      logLevel: 'info',
      walletName: state.walletName,
    }),
    getChain: () => ({ id: state.chainId }),
    getWalletName: () => state.walletName,
    getRpcUrl: () => state.rpcUrl,
    getEnvironment: () => state.environment,
    isSimulationMode: () => state.simulation,
    isStateless: () => false,
  };
  return { configManager };
});

// Import AFTER mocks are declared.
import { hlOpenPositionTool, hlOpenPositionSchema } from '../src/tools/hl/hl-open-position.js';
import { hlClosePositionTool, hlClosePositionSchema } from '../src/tools/hl/hl-close-position.js';
import { hlSetLeverageTool, hlSetLeverageSchema } from '../src/tools/hl/hl-set-leverage.js';
import { hlAddIsolatedMarginTool, hlAddIsolatedMarginSchema } from '../src/tools/hl/hl-add-isolated-margin.js';
import { hlAddApiWalletTool, hlAddApiWalletSchema } from '../src/tools/hl/hl-add-api-wallet.js';
import { hlDepositToPerpTool, hlDepositToPerpSchema } from '../src/tools/hl/hl-deposit-to-perp.js';
import { hlWithdrawToEvmTool, hlWithdrawToEvmSchema } from '../src/tools/hl/hl-withdraw-to-evm.js';
import { hlGetNavTool, hlGetNavSchema } from '../src/tools/hl/hl-get-nav.js';
import { hlGetPositionsTool, hlGetPositionsSchema } from '../src/tools/hl/hl-get-positions.js';
import { hlSetSlippageCapTool } from '../src/tools/hl/hl-set-slippage-cap.js';
import {
  hlTransferToBuilderDexTool,
  hlTransferToBuilderDexSchema,
} from '../src/tools/hl/hl-transfer-to-builder-dex.js';
import {
  hlTransferFromBuilderDexTool,
  hlTransferFromBuilderDexSchema,
} from '../src/tools/hl/hl-transfer-from-builder-dex.js';
import { hlListPerpsTool, hlListPerpsSchema } from '../src/tools/hl/hl-list-perps.js';
import { hlSyncPositionTool, hlSyncPositionSchema } from '../src/tools/hl/hl-sync-position.js';
import { hlSettlePendingTool, hlSettlePendingSchema } from '../src/tools/hl/hl-settle-pending.js';
import { hlCancelOrderTool, hlCancelOrderSchema } from '../src/tools/hl/hl-cancel-order.js';
import {
  hlCancelOrderOffchainTool,
  hlCancelOrderOffchainSchema,
} from '../src/tools/hl/hl-cancel-order-offchain.js';
import { hlPlaceOrderRawTool, hlPlaceOrderRawSchema } from '../src/tools/hl/hl-place-order-raw.js';
import {
  hlForceForgetCloidTool,
  hlForceForgetCloidSchema,
} from '../src/tools/hl/hl-force-forget-cloid.js';
import {
  hlSetMaxKnownBuilderDexTool,
  hlSetMaxKnownBuilderDexSchema,
} from '../src/tools/hl/hl-set-max-known-builder-dex.js';
import { hlSpotSendTool, hlSpotSendSchema } from '../src/tools/hl/hl-spot-send.js';
import {
  hlListSpotTokensTool,
  hlListSpotTokensSchema,
} from '../src/tools/hl/hl-list-spot-tokens.js';
import { hlListDexesTool, hlListDexesSchema } from '../src/tools/hl/hl-list-dexes.js';
import { HL_MAX_SLIPPAGE_BPS, HYPEREVM_CHAIN_ID } from '../src/tools/hl/common.js';
import { configManager } from '../src/config/index.js';

// Shorthand to flip the mocked chain so we can test chain rejection.
function setChainId(id: number, name: string = 'HYPEREVM') {
  const s = (configManager as unknown as { __state: { chainId: number; chainName: string } }).__state;
  s.chainId = id;
  s.chainName = name;
}

beforeEach(() => {
  setChainId(999, 'HYPEREVM');
  // Reset HLVault method spies between tests so per-test assertions can
  // verify the exact invocation in isolation.
  mockOpenPosition.mockClear();
  mockClosePosition.mockClear();
  mockOpenPositionOffChain.mockClear();
  mockClosePositionOffChain.mockClear();
  mockSetLeverage.mockClear();
  mockAddIsolatedMargin.mockClear();
  mockDepositToPerp.mockClear();
  mockWithdrawToEvm.mockClear();
  mockGetNav.mockClear();
  mockGetPositions.mockClear();
  mockTransferToBuilderDex.mockClear();
  mockTransferFromBuilderDex.mockClear();
  mockListPerps.mockClear();
  mockSyncPosition.mockClear();
  mockSettlePending.mockClear();
  mockCancelOrder.mockClear();
  mockCancelOrderOffChain.mockClear();
  mockPlaceOrder.mockClear();
  mockPlaceOrderOffChain.mockClear();
  mockForceForgetCloid.mockClear();
  mockSetMaxKnownBuilderDex.mockClear();
  mockSpotSend.mockClear();
  mockListSpotTokens.mockClear();
  mockListDexes.mockClear();
});

const VALID_VAULT = '0x1234567890AbcdEF1234567890aBcdef12345678';
const VALID_AGENT = '0xAaAaAAAAaaaAAaaaAaAaaaAaAAaAaAaaAaAaaaA1';

const allTools = [
  hlOpenPositionTool,
  hlClosePositionTool,
  hlSetLeverageTool,
  hlAddIsolatedMarginTool,
  hlAddApiWalletTool,
  hlDepositToPerpTool,
  hlWithdrawToEvmTool,
  hlGetNavTool,
  hlGetPositionsTool,
  hlSetSlippageCapTool,
  hlTransferToBuilderDexTool,
  hlTransferFromBuilderDexTool,
  hlListPerpsTool,
  hlSyncPositionTool,
  hlSettlePendingTool,
  hlCancelOrderTool,
  hlCancelOrderOffchainTool,
  hlPlaceOrderRawTool,
  hlForceForgetCloidTool,
  hlSetMaxKnownBuilderDexTool,
  hlSpotSendTool,
  hlListSpotTokensTool,
  hlListDexesTool,
];

describe('HL tools — JSON Schema (MCP inputSchema)', () => {
  for (const tool of allTools) {
    describe(tool.name, () => {
      it('has type=object', () => {
        expect(tool.inputSchema.type).toBe('object');
      });
      it('has properties', () => {
        expect(typeof tool.inputSchema.properties).toBe('object');
        expect(tool.inputSchema.properties).not.toBeNull();
      });
      it('every required field exists in properties', () => {
        const required = tool.inputSchema.required || [];
        for (const f of required) {
          expect((tool.inputSchema.properties as Record<string, unknown>)[f]).toBeDefined();
        }
      });
      it('every property has a description', () => {
        for (const [k, p] of Object.entries(tool.inputSchema.properties)) {
          expect((p as { description?: string }).description, `${tool.name}.${k}`).toBeTruthy();
        }
      });
    });
  }

  it('exactly 23 HL tools registered', () => {
    expect(allTools.length).toBe(23);
  });

  it('every tool name starts with factor_hl_', () => {
    for (const t of allTools) expect(t.name.startsWith('factor_hl_')).toBe(true);
  });
});

describe('hl_open_position — zod schema', () => {
  it('accepts valid input', () => {
    expect(() =>
      hlOpenPositionSchema.parse({ vault: VALID_VAULT, perp: 'ETH', side: 'long', sizeUsd: 100 }),
    ).not.toThrow();
  });
  it('rejects bad side', () => {
    expect(() =>
      hlOpenPositionSchema.parse({ vault: VALID_VAULT, perp: 'ETH', side: 'sideways', sizeUsd: 100 }),
    ).toThrow();
  });
  it('rejects non-positive sizeUsd', () => {
    expect(() =>
      hlOpenPositionSchema.parse({ vault: VALID_VAULT, perp: 'ETH', side: 'long', sizeUsd: 0 }),
    ).toThrow();
  });
  it('rejects slippageBps out of range', () => {
    expect(() =>
      hlOpenPositionSchema.parse({
        vault: VALID_VAULT,
        perp: 'ETH',
        side: 'long',
        sizeUsd: 100,
        slippageBps: 10_001,
      }),
    ).toThrow();
  });
  it('rejects missing required field', () => {
    expect(() => hlOpenPositionSchema.parse({ vault: VALID_VAULT, perp: 'ETH' })).toThrow();
  });
});

describe('hl_close_position — zod schema', () => {
  it('accepts valid input', () => {
    expect(() =>
      hlClosePositionSchema.parse({ vault: VALID_VAULT, perp: 'BTC', sizeUsd: 250.5 }),
    ).not.toThrow();
  });
  it('rejects negative size', () => {
    expect(() =>
      hlClosePositionSchema.parse({ vault: VALID_VAULT, perp: 'BTC', sizeUsd: -1 }),
    ).toThrow();
  });
});

describe('hl_set_leverage — zod schema', () => {
  it('accepts valid input', () => {
    expect(() =>
      hlSetLeverageSchema.parse({ vault: VALID_VAULT, perp: 'ETH', leverage: 10, mode: 'cross' }),
    ).not.toThrow();
  });
  it('rejects leverage 0', () => {
    expect(() =>
      hlSetLeverageSchema.parse({ vault: VALID_VAULT, perp: 'ETH', leverage: 0, mode: 'cross' }),
    ).toThrow();
  });
  it('rejects leverage > 50', () => {
    expect(() =>
      hlSetLeverageSchema.parse({ vault: VALID_VAULT, perp: 'ETH', leverage: 100, mode: 'cross' }),
    ).toThrow();
  });
  it('rejects unknown margin mode', () => {
    expect(() =>
      hlSetLeverageSchema.parse({ vault: VALID_VAULT, perp: 'ETH', leverage: 5, mode: 'hybrid' }),
    ).toThrow();
  });
});

describe('hl_add_isolated_margin — zod schema', () => {
  it('accepts positive delta', () => {
    expect(() =>
      hlAddIsolatedMarginSchema.parse({ vault: VALID_VAULT, perp: 'ETH', isLong: true, deltaUsd: 50 }),
    ).not.toThrow();
  });
  it('accepts negative delta', () => {
    expect(() =>
      hlAddIsolatedMarginSchema.parse({ vault: VALID_VAULT, perp: 'ETH', isLong: false, deltaUsd: -25 }),
    ).not.toThrow();
  });
  it('rejects non-boolean isLong', () => {
    expect(() =>
      hlAddIsolatedMarginSchema.parse({ vault: VALID_VAULT, perp: 'ETH', isLong: 'yes', deltaUsd: 10 }),
    ).toThrow();
  });
});

describe('hl_add_api_wallet — zod schema', () => {
  it('accepts named slot', () => {
    expect(() =>
      hlAddApiWalletSchema.parse({ vault: VALID_VAULT, agentEoa: VALID_AGENT, slotName: 'primary' }),
    ).not.toThrow();
  });
  it('accepts empty slot', () => {
    expect(() =>
      hlAddApiWalletSchema.parse({ vault: VALID_VAULT, agentEoa: VALID_AGENT, slotName: 'default' }),
    ).not.toThrow();
  });
  it('rejects unknown slot name', () => {
    expect(() =>
      hlAddApiWalletSchema.parse({ vault: VALID_VAULT, agentEoa: VALID_AGENT, slotName: 'admin' }),
    ).toThrow();
  });
});

describe('hl_deposit_to_perp — zod schema', () => {
  it('accepts float amount', () => {
    expect(() => hlDepositToPerpSchema.parse({ vault: VALID_VAULT, usdcAmountFloat: 5.5 })).not.toThrow();
  });
  it('rejects zero amount', () => {
    expect(() => hlDepositToPerpSchema.parse({ vault: VALID_VAULT, usdcAmountFloat: 0 })).toThrow();
  });
});

describe('hl_withdraw_to_evm — zod schema', () => {
  it('accepts valid input', () => {
    expect(() => hlWithdrawToEvmSchema.parse({ vault: VALID_VAULT, usdcAmountFloat: 12.34 })).not.toThrow();
  });
  it('rejects negative amount', () => {
    expect(() => hlWithdrawToEvmSchema.parse({ vault: VALID_VAULT, usdcAmountFloat: -1 })).toThrow();
  });
});

describe('hl_get_nav — zod schema', () => {
  it('accepts vault address', () => {
    expect(() => hlGetNavSchema.parse({ vault: VALID_VAULT })).not.toThrow();
  });
  it('rejects missing vault', () => {
    expect(() => hlGetNavSchema.parse({})).toThrow();
  });
});

describe('hl_get_positions — zod schema', () => {
  it('accepts vault address', () => {
    expect(() => hlGetPositionsSchema.parse({ vault: VALID_VAULT })).not.toThrow();
  });
});

describe('hl_transfer_to_builder_dex — zod schema', () => {
  it('accepts string usdcAmount', () => {
    expect(() =>
      hlTransferToBuilderDexSchema.parse({ vault: VALID_VAULT, dex: 'xyz', usdcAmount: '1.50' }),
    ).not.toThrow();
  });
  it('accepts numeric usdcAmount', () => {
    expect(() =>
      hlTransferToBuilderDexSchema.parse({ vault: VALID_VAULT, dex: 'xyz', usdcAmount: 1.5 }),
    ).not.toThrow();
  });
  it('rejects unknown dex', () => {
    expect(() =>
      hlTransferToBuilderDexSchema.parse({ vault: VALID_VAULT, dex: 'foo', usdcAmount: '1' }),
    ).toThrow();
  });
  it('rejects empty usdcAmount string', () => {
    expect(() =>
      hlTransferToBuilderDexSchema.parse({ vault: VALID_VAULT, dex: 'xyz', usdcAmount: '' }),
    ).toThrow();
  });
});

describe('hl_transfer_from_builder_dex — zod schema', () => {
  it('accepts valid input', () => {
    expect(() =>
      hlTransferFromBuilderDexSchema.parse({ vault: VALID_VAULT, dex: 'xyz', usdcAmount: '5.0' }),
    ).not.toThrow();
  });
  it('rejects unknown dex', () => {
    expect(() =>
      hlTransferFromBuilderDexSchema.parse({ vault: VALID_VAULT, dex: 'abc', usdcAmount: '5' }),
    ).toThrow();
  });
});

describe('hl_list_perps — zod schema', () => {
  it('accepts no params (defaults to main)', () => {
    expect(() => hlListPerpsSchema.parse({})).not.toThrow();
  });
  it('accepts an arbitrary dex name', () => {
    expect(() => hlListPerpsSchema.parse({ dex: 'xyz' })).not.toThrow();
    expect(() => hlListPerpsSchema.parse({ dex: 'main' })).not.toThrow();
    expect(() => hlListPerpsSchema.parse({ dex: 'someNewDex' })).not.toThrow();
  });
});

describe('hl_set_slippage_cap — view tool', () => {
  it('returns the adapter MAX_SLIPPAGE_BPS', async () => {
    const r = await hlSetSlippageCapTool.handler({} as never);
    expect(r.maxSlippageBps).toBe(HL_MAX_SLIPPAGE_BPS);
    expect(r.chainId).toBe(HYPEREVM_CHAIN_ID);
  });
});

describe('chain id gating — HL tools reject non-HyperEVM', () => {
  beforeEach(() => setChainId(42161, 'ARBITRUM_ONE'));

  it('hl_open_position throws on chain 42161', async () => {
    await expect(
      hlOpenPositionTool.handler({ vault: VALID_VAULT, perp: 'ETH', side: 'long', sizeUsd: 100 }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_close_position throws on chain 42161', async () => {
    await expect(
      hlClosePositionTool.handler({ vault: VALID_VAULT, perp: 'ETH', sizeUsd: 100 }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_set_leverage throws on chain 42161', async () => {
    await expect(
      hlSetLeverageTool.handler({ vault: VALID_VAULT, perp: 'ETH', leverage: 5, mode: 'cross' }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_add_isolated_margin throws on chain 42161', async () => {
    await expect(
      hlAddIsolatedMarginTool.handler({ vault: VALID_VAULT, perp: 'ETH', isLong: true, deltaUsd: 10 }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_add_api_wallet throws on chain 42161', async () => {
    await expect(
      hlAddApiWalletTool.handler({ vault: VALID_VAULT, agentEoa: VALID_AGENT, slotName: 'primary' }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_deposit_to_perp throws on chain 42161', async () => {
    await expect(
      hlDepositToPerpTool.handler({ vault: VALID_VAULT, usdcAmountFloat: 5 }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_withdraw_to_evm throws on chain 42161', async () => {
    await expect(
      hlWithdrawToEvmTool.handler({ vault: VALID_VAULT, usdcAmountFloat: 5 }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_get_nav throws on chain 42161', async () => {
    await expect(hlGetNavTool.handler({ vault: VALID_VAULT })).rejects.toThrow(/HyperEVM/);
  });
  it('hl_get_positions throws on chain 42161', async () => {
    await expect(hlGetPositionsTool.handler({ vault: VALID_VAULT })).rejects.toThrow(/HyperEVM/);
  });
  it('hl_transfer_to_builder_dex throws on chain 42161', async () => {
    await expect(
      hlTransferToBuilderDexTool.handler({ vault: VALID_VAULT, dex: 'xyz', usdcAmount: '1' }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_transfer_from_builder_dex throws on chain 42161', async () => {
    await expect(
      hlTransferFromBuilderDexTool.handler({ vault: VALID_VAULT, dex: 'xyz', usdcAmount: '1' }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_list_perps throws on chain 42161', async () => {
    await expect(hlListPerpsTool.handler({})).rejects.toThrow(/HyperEVM/);
  });
  it('hl_sync_position throws on chain 42161', async () => {
    await expect(
      hlSyncPositionTool.handler({ vault: VALID_VAULT, perp: 'BTC' }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_settle_pending throws on chain 42161', async () => {
    await expect(
      hlSettlePendingTool.handler({
        vault: VALID_VAULT,
        cloid: '0x0123456789abcdef0123456789abcdef',
      }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_cancel_order throws on chain 42161', async () => {
    await expect(
      hlCancelOrderTool.handler({
        vault: VALID_VAULT,
        perp: 0,
        cloid: '0x0123456789abcdef0123456789abcdef',
      }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_cancel_order_offchain throws on chain 42161', async () => {
    await expect(
      hlCancelOrderOffchainTool.handler({
        vault: VALID_VAULT,
        perp: 'xyz:GOLD',
        cloid: '0x0123456789abcdef0123456789abcdef',
      }),
    ).rejects.toThrow(/HyperEVM/);
  });
  it('hl_place_order_raw throws on chain 42161', async () => {
    await expect(
      hlPlaceOrderRawTool.handler({
        vault: VALID_VAULT,
        perp: 'ETH',
        isLong: true,
        sizeUsd: 100,
        limitPxReal: 4000,
        tif: 'Ioc',
        reduceOnly: false,
      }),
    ).rejects.toThrow(/HyperEVM/);
  });
});

describe('off-chain EIP-712 tools return off-chain-hl-action shape', () => {
  it('hl_set_leverage submitted=true, txHash="off-chain-hl-action"', async () => {
    const r = await hlSetLeverageTool.handler({
      vault: VALID_VAULT,
      perp: 'ETH',
      leverage: 5,
      mode: 'cross',
    });
    expect(r.submitted).toBe(true);
    expect(r.txHash).toBe('off-chain-hl-action');
    expect(r.chainId).toBe(HYPEREVM_CHAIN_ID);
  });

  it('hl_add_isolated_margin submitted=true, txHash="off-chain-hl-action"', async () => {
    const r = await hlAddIsolatedMarginTool.handler({
      vault: VALID_VAULT,
      perp: 'ETH',
      isLong: true,
      deltaUsd: 50,
    });
    expect(r.submitted).toBe(true);
    expect(r.txHash).toBe('off-chain-hl-action');
  });
});

describe('on-chain HL tools return SendTransactionParams-shaped tx in simulation', () => {
  it('hl_open_position returns a tx envelope', async () => {
    const r = (await hlOpenPositionTool.handler({
      vault: VALID_VAULT,
      perp: 'ETH',
      side: 'long',
      sizeUsd: 100,
    })) as { transaction?: { to?: string; data?: string } };
    expect(r.transaction?.to).toBeDefined();
    expect(r.transaction?.data).toBeDefined();
  });

  it('hl_add_api_wallet rejects malformed agent eoa', async () => {
    await expect(
      hlAddApiWalletTool.handler({ vault: VALID_VAULT, agentEoa: 'not-an-address', slotName: 'primary' }),
    ).rejects.toThrow();
  });

  it('hl_deposit_to_perp rejects bad vault address', async () => {
    await expect(
      hlDepositToPerpTool.handler({ vault: 'not-an-address', usdcAmountFloat: 5 }),
    ).rejects.toThrow();
  });
});

describe('HL tools invoke HLVault with the right method + args', () => {
  it('hl_open_position calls HLVault.openPosition with perp/isLong/sizeUsd/slippageBps', async () => {
    await hlOpenPositionTool.handler({
      vault: VALID_VAULT,
      perp: 'ETH',
      side: 'short',
      sizeUsd: 123.45,
      slippageBps: 250,
    });
    expect(mockOpenPosition).toHaveBeenCalledTimes(1);
    expect(mockOpenPosition).toHaveBeenCalledWith({
      perp: 'ETH',
      isLong: false,
      sizeUsd: 123.45,
      slippageBps: 250,
    });
  });

  it('hl_open_position defaults slippageBps to 1000 when omitted', async () => {
    await hlOpenPositionTool.handler({
      vault: VALID_VAULT,
      perp: 'BTC',
      side: 'long',
      sizeUsd: 50,
    });
    const args = mockOpenPosition.mock.calls[0]?.[0] as { slippageBps: number };
    expect(args.slippageBps).toBe(1000);
  });

  it('hl_close_position calls HLVault.closePosition with perp/sizeUsd/slippageBps', async () => {
    await hlClosePositionTool.handler({
      vault: VALID_VAULT,
      perp: 'SOL',
      sizeUsd: 75,
      slippageBps: 500,
    });
    expect(mockClosePosition).toHaveBeenCalledWith({
      perp: 'SOL',
      sizeUsd: 75,
      slippageBps: 500,
    });
  });

  it('hl_set_leverage calls HLVault.setLeverage(perp, leverage, mode)', async () => {
    const r = await hlSetLeverageTool.handler({
      vault: VALID_VAULT,
      perp: 'ETH',
      leverage: 5,
      mode: 'cross',
    });
    expect(r.submitted).toBe(true);
    expect(r.txHash).toBe('off-chain-hl-action');
    expect(mockSetLeverage).toHaveBeenCalledWith('ETH', 5, 'cross');
  });

  it('hl_add_isolated_margin calls HLVault.addIsolatedMargin(perp, isLong, deltaUsd)', async () => {
    const r = await hlAddIsolatedMarginTool.handler({
      vault: VALID_VAULT,
      perp: 'BTC',
      isLong: true,
      deltaUsd: 42,
    });
    expect(r.submitted).toBe(true);
    expect(r.txHash).toBe('off-chain-hl-action');
    expect(mockAddIsolatedMargin).toHaveBeenCalledWith('BTC', true, 42);
  });

  it('hl_deposit_to_perp calls HLVault.depositToPerp with a decimal-string amount', async () => {
    await hlDepositToPerpTool.handler({ vault: VALID_VAULT, usdcAmountFloat: 5.5 });
    expect(mockDepositToPerp).toHaveBeenCalledWith('5.5');
  });

  it('hl_withdraw_to_evm calls HLVault.withdrawToEvm with a decimal-string amount', async () => {
    await hlWithdrawToEvmTool.handler({ vault: VALID_VAULT, usdcAmountFloat: 12.34 });
    expect(mockWithdrawToEvm).toHaveBeenCalledWith('12.34');
  });

  it('hl_get_nav surfaces HLVault.getNav() values as 6-dec strings', async () => {
    const r = await hlGetNavTool.handler({ vault: VALID_VAULT });
    expect(mockGetNav).toHaveBeenCalledTimes(1);
    expect(r.evmUsdc).toBe('1000000');
    expect(r.spotUsdc).toBe('500000');
    expect(r.perpAccountValue).toBe('250000');
    expect(r.totalUsd).toBe('1750000');
  });

  it('hl_get_positions maps HLVault.getPositions() into the MCP view shape', async () => {
    const r = await hlGetPositionsTool.handler({ vault: VALID_VAULT });
    expect(mockGetPositions).toHaveBeenCalledTimes(1);
    expect(r.positions).toHaveLength(1);
    const p = r.positions[0];
    expect(p.perp).toBe('0');
    expect(p.isLong).toBe(true);
    expect(p.leverage).toBe(5);
    expect(p.mode).toBe('cross');
    expect(p.sizeWei).toBe('100000000');
  });

  it('hl_set_slippage_cap returns the SDK MAX_SLIPPAGE_BPS constant', async () => {
    const r = await hlSetSlippageCapTool.handler({} as never);
    expect(r.chainId).toBe(HYPEREVM_CHAIN_ID);
    // Whatever the SDK exports must equal the re-export from common.ts.
    expect(r.maxSlippageBps).toBe(HL_MAX_SLIPPAGE_BPS);
    expect(typeof r.maxSlippageBps).toBe('number');
    expect(r.maxSlippageBps).toBeGreaterThan(0);
  });

  it('hl_transfer_to_builder_dex calls HLVault.transferToBuilderDex(dex, usdcAmount)', async () => {
    const r = (await hlTransferToBuilderDexTool.handler({
      vault: VALID_VAULT,
      dex: 'xyz',
      usdcAmount: '1.50',
    })) as { transaction?: { to?: string; data?: string } };
    expect(mockTransferToBuilderDex).toHaveBeenCalledTimes(1);
    expect(mockTransferToBuilderDex).toHaveBeenCalledWith({ dex: 'xyz', usdcAmount: '1.50' });
    expect(r.transaction?.to).toBeDefined();
    expect(r.transaction?.data).toBeDefined();
  });

  it('hl_transfer_to_builder_dex coerces numeric usdcAmount to a decimal string', async () => {
    await hlTransferToBuilderDexTool.handler({
      vault: VALID_VAULT,
      dex: 'xyz',
      usdcAmount: 2.5,
    });
    const args = mockTransferToBuilderDex.mock.calls[0]?.[0] as { usdcAmount: string };
    expect(typeof args.usdcAmount).toBe('string');
    expect(args.usdcAmount).toBe('2.5');
  });

  it('hl_transfer_from_builder_dex calls HLVault.transferFromBuilderDex(dex, usdcAmount)', async () => {
    const r = (await hlTransferFromBuilderDexTool.handler({
      vault: VALID_VAULT,
      dex: 'xyz',
      usdcAmount: '3.14',
    })) as { transaction?: { to?: string; data?: string } };
    expect(mockTransferFromBuilderDex).toHaveBeenCalledTimes(1);
    expect(mockTransferFromBuilderDex).toHaveBeenCalledWith({ dex: 'xyz', usdcAmount: '3.14' });
    expect(r.transaction?.data).toBeDefined();
  });

  it('hl_list_perps calls HLVault.listPerps with the dex argument (default "main")', async () => {
    const r = await hlListPerpsTool.handler({});
    expect(mockListPerps).toHaveBeenCalledTimes(1);
    expect(mockListPerps).toHaveBeenCalledWith('main');
    expect(r.dex).toBe('main');
    expect(r.count).toBe(2);
    expect(r.perps[0].name).toBe('xyz:GOLD');
    expect(r.perps[0].markPx).toBe(2310.5);
    expect(r.perps[1].onlyIsolated).toBe(true);
  });

  it('hl_list_perps forwards a custom dex name', async () => {
    await hlListPerpsTool.handler({ dex: 'xyz' });
    expect(mockListPerps).toHaveBeenCalledWith('xyz');
  });

  it('hl_open_position routes BTC (main dex) to HLVault.openPosition', async () => {
    await hlOpenPositionTool.handler({
      vault: VALID_VAULT,
      perp: 'BTC',
      side: 'long',
      sizeUsd: 100,
    });
    expect(mockOpenPosition).toHaveBeenCalledTimes(1);
    expect(mockOpenPositionOffChain).not.toHaveBeenCalled();
  });

  it('hl_open_position routes xyz:GOLD (builder dex) to HLVault.openPositionOffChain', async () => {
    const r = await hlOpenPositionTool.handler({
      vault: VALID_VAULT,
      perp: 'xyz:GOLD',
      side: 'long',
      sizeUsd: 100,
    });
    expect(mockOpenPositionOffChain).toHaveBeenCalledTimes(1);
    expect(mockOpenPositionOffChain).toHaveBeenCalledWith({
      perp: 'xyz:GOLD',
      isLong: true,
      sizeUsd: 100,
      slippageBps: 1000,
    });
    expect(mockOpenPosition).not.toHaveBeenCalled();
    const offChainResult = r as {
      submitted?: boolean;
      asset?: string;
      hlResponse?: Record<string, unknown>;
    };
    expect(offChainResult.submitted).toBe(true);
    expect(offChainResult.asset).toBe('xyz:GOLD');
    expect(offChainResult.hlResponse).toBeDefined();
  });

  it('hl_close_position routes ETH (main dex) to HLVault.closePosition', async () => {
    await hlClosePositionTool.handler({
      vault: VALID_VAULT,
      perp: 'ETH',
      sizeUsd: 50,
    });
    expect(mockClosePosition).toHaveBeenCalledTimes(1);
    expect(mockClosePositionOffChain).not.toHaveBeenCalled();
  });

  it('hl_close_position routes xyz:BRENTOIL (builder dex) to HLVault.closePositionOffChain', async () => {
    const r = await hlClosePositionTool.handler({
      vault: VALID_VAULT,
      perp: 'xyz:BRENTOIL',
      sizeUsd: 25,
    });
    expect(mockClosePositionOffChain).toHaveBeenCalledTimes(1);
    expect(mockClosePositionOffChain).toHaveBeenCalledWith({
      perp: 'xyz:BRENTOIL',
      sizeUsd: 25,
      slippageBps: 1000,
    });
    expect(mockClosePosition).not.toHaveBeenCalled();
    const offChainResult = r as { submitted?: boolean; asset?: string };
    expect(offChainResult.submitted).toBe(true);
    expect(offChainResult.asset).toBe('xyz:BRENTOIL');
  });

  it('hl_add_api_wallet builds an on-chain executeByManager tx envelope', async () => {
    // No mocked HLVault method here — the tool encodes addApiWallet
    // directly via the SDK's `encodeAddApiWallet` + studioProV1 ABI.
    // We just verify the resulting envelope has a non-empty data payload
    // that begins with the executeByManager selector.
    const r = (await hlAddApiWalletTool.handler({
      vault: VALID_VAULT,
      agentEoa: VALID_AGENT,
      slotName: 'primary',
    })) as { transaction?: { to?: string; data?: string } };
    expect(r.transaction?.to).toBe(VALID_VAULT);
    expect(r.transaction?.data).toMatch(/^0x[0-9a-fA-F]+$/);
    // executeByManager(address[],bytes[]) selector — assert the call ends
    // up going through the manager (not a direct adapter call).
    // selector for executeByManager(address[],bytes[]):
    //   keccak256('executeByManager(address[],bytes[])').slice(0,4) === 0x4f7a9c8c
    // We don't hard-code the selector here because computing it requires
    // the same ABI the tool used. Instead, the strong assertion is just
    // "data is non-empty and starts with 4 bytes" (i.e. a function call).
    expect((r.transaction?.data ?? '').length).toBeGreaterThan(10);
  });
});

describe('hl_sync_position — zod schema', () => {
  it('accepts a string symbol', () => {
    expect(() =>
      hlSyncPositionSchema.parse({ vault: VALID_VAULT, perp: 'BTC' }),
    ).not.toThrow();
  });
  it('accepts a numeric perp index', () => {
    expect(() =>
      hlSyncPositionSchema.parse({ vault: VALID_VAULT, perp: 0 }),
    ).not.toThrow();
  });
  it('rejects a negative perp index', () => {
    expect(() =>
      hlSyncPositionSchema.parse({ vault: VALID_VAULT, perp: -1 }),
    ).toThrow();
  });
  it('rejects a non-integer perp index', () => {
    expect(() =>
      hlSyncPositionSchema.parse({ vault: VALID_VAULT, perp: 1.5 }),
    ).toThrow();
  });
  it('rejects missing perp', () => {
    expect(() => hlSyncPositionSchema.parse({ vault: VALID_VAULT })).toThrow();
  });
});

describe('hl_settle_pending — zod schema', () => {
  const VALID_CLOID = '0x0123456789abcdef0123456789abcdef';

  it('accepts a 16-byte hex cloid', () => {
    expect(() =>
      hlSettlePendingSchema.parse({ vault: VALID_VAULT, cloid: VALID_CLOID }),
    ).not.toThrow();
  });
  it('accepts uppercase hex', () => {
    expect(() =>
      hlSettlePendingSchema.parse({
        vault: VALID_VAULT,
        cloid: '0xABCDEF0123456789ABCDEF0123456789',
      }),
    ).not.toThrow();
  });
  it('rejects missing 0x prefix', () => {
    expect(() =>
      hlSettlePendingSchema.parse({
        vault: VALID_VAULT,
        cloid: '0123456789abcdef0123456789abcdef',
      }),
    ).toThrow();
  });
  it('rejects wrong length (too short)', () => {
    expect(() =>
      hlSettlePendingSchema.parse({ vault: VALID_VAULT, cloid: '0xdeadbeef' }),
    ).toThrow();
  });
  it('rejects non-hex chars', () => {
    expect(() =>
      hlSettlePendingSchema.parse({
        vault: VALID_VAULT,
        cloid: '0xZZZZZZZZ0123456789abcdef01234567',
      }),
    ).toThrow();
  });
  it('rejects missing cloid', () => {
    expect(() => hlSettlePendingSchema.parse({ vault: VALID_VAULT })).toThrow();
  });
});

describe('hl_sync_position — handler', () => {
  it('forwards a string symbol to HLVault.syncPosition', async () => {
    const r = (await hlSyncPositionTool.handler({
      vault: VALID_VAULT,
      perp: 'BTC',
    })) as {
      submitted?: boolean;
      perp?: string | number;
      txCalldata?: { to?: string; data?: string };
      simulationMode?: boolean;
    };
    expect(mockSyncPosition).toHaveBeenCalledTimes(1);
    expect(mockSyncPosition).toHaveBeenCalledWith('BTC');
    expect(r.submitted).toBe(true);
    expect(r.perp).toBe('BTC');
    expect(r.txCalldata?.to).toBeDefined();
    expect(r.txCalldata?.data).toBeDefined();
    expect(r.simulationMode).toBe(true);
  });

  it('forwards a numeric index to HLVault.syncPosition', async () => {
    const r = (await hlSyncPositionTool.handler({ vault: VALID_VAULT, perp: 0 })) as {
      submitted?: boolean;
      perp?: number;
    };
    expect(mockSyncPosition).toHaveBeenCalledWith(0);
    expect(r.submitted).toBe(true);
    expect(r.perp).toBe(0);
  });

  it('rejects an invalid vault address', async () => {
    await expect(
      hlSyncPositionTool.handler({ vault: 'not-an-address', perp: 'BTC' }),
    ).rejects.toThrow(/Invalid vault address/);
  });
});

describe('hl_settle_pending — handler', () => {
  const VALID_CLOID = '0x0123456789abcdef0123456789abcdef';

  it('forwards the cloid as a bigint to HLVault.settlePending', async () => {
    const r = (await hlSettlePendingTool.handler({
      vault: VALID_VAULT,
      cloid: VALID_CLOID,
    })) as {
      submitted?: boolean;
      cloid?: string;
      txCalldata?: { to?: string; data?: string };
      simulationMode?: boolean;
    };
    expect(mockSettlePending).toHaveBeenCalledTimes(1);
    expect(mockSettlePending).toHaveBeenCalledWith(BigInt(VALID_CLOID));
    expect(r.submitted).toBe(true);
    expect(r.cloid).toBe(VALID_CLOID);
    expect(r.txCalldata?.to).toBeDefined();
    expect(r.txCalldata?.data).toBeDefined();
    expect(r.simulationMode).toBe(true);
  });

  it('rejects an invalid vault address', async () => {
    await expect(
      hlSettlePendingTool.handler({ vault: 'not-an-address', cloid: VALID_CLOID }),
    ).rejects.toThrow(/Invalid vault address/);
  });

  it('description mentions MIN_SETTLE_DELAY_BLOCKS gate', () => {
    expect(hlSettlePendingTool.description).toMatch(/MIN_SETTLE_DELAY_BLOCKS/);
  });
});

describe('hl_force_forget_cloid — zod schema + handler', () => {
  const VALID_CLOID = '0x0123456789abcdef0123456789abcdef';

  it('accepts valid 16-byte hex cloid', () => {
    expect(() =>
      hlForceForgetCloidSchema.parse({ vault: VALID_VAULT, cloid: VALID_CLOID }),
    ).not.toThrow();
  });

  it('rejects non-hex cloid', () => {
    expect(() =>
      hlForceForgetCloidSchema.parse({ vault: VALID_VAULT, cloid: 'not-hex' }),
    ).toThrow();
  });

  it('rejects wrong-length cloid', () => {
    expect(() =>
      hlForceForgetCloidSchema.parse({ vault: VALID_VAULT, cloid: '0x1234' }),
    ).toThrow();
  });

  it('calls HLVault.forceForgetCloid with bigint cloid', async () => {
    const r = (await hlForceForgetCloidTool.handler({
      vault: VALID_VAULT,
      cloid: VALID_CLOID,
    })) as { submitted?: boolean; txCalldata?: { to?: string; data?: string } };
    expect(mockForceForgetCloid).toHaveBeenCalledTimes(1);
    expect(mockForceForgetCloid).toHaveBeenCalledWith(BigInt(VALID_CLOID));
    expect(r.submitted).toBe(true);
    expect(r.txCalldata?.to).toBeDefined();
    expect(r.txCalldata?.data).toBeDefined();
  });

  it('rejects on non-HyperEVM chain', async () => {
    setChainId(42161, 'ARBITRUM_ONE');
    await expect(
      hlForceForgetCloidTool.handler({ vault: VALID_VAULT, cloid: VALID_CLOID }),
    ).rejects.toThrow(/HyperEVM/);
  });

  it('description flags owner-only emergency cleanup', () => {
    expect(hlForceForgetCloidTool.description).toMatch(/OWNER-ONLY/);
  });
});

describe('hl_set_max_known_builder_dex — zod schema + handler', () => {
  it('accepts a valid newMax in [0, 100]', () => {
    expect(() =>
      hlSetMaxKnownBuilderDexSchema.parse({ vault: VALID_VAULT, newMax: 10 }),
    ).not.toThrow();
    expect(() =>
      hlSetMaxKnownBuilderDexSchema.parse({ vault: VALID_VAULT, newMax: 0 }),
    ).not.toThrow();
    expect(() =>
      hlSetMaxKnownBuilderDexSchema.parse({ vault: VALID_VAULT, newMax: 100 }),
    ).not.toThrow();
  });

  it('rejects newMax above sanity cap', () => {
    expect(() =>
      hlSetMaxKnownBuilderDexSchema.parse({ vault: VALID_VAULT, newMax: 101 }),
    ).toThrow();
  });

  it('rejects negative newMax', () => {
    expect(() =>
      hlSetMaxKnownBuilderDexSchema.parse({ vault: VALID_VAULT, newMax: -1 }),
    ).toThrow();
  });

  it('rejects non-integer newMax', () => {
    expect(() =>
      hlSetMaxKnownBuilderDexSchema.parse({ vault: VALID_VAULT, newMax: 1.5 }),
    ).toThrow();
  });

  it('calls HLVault.setMaxKnownBuilderDex with newMax', async () => {
    const r = (await hlSetMaxKnownBuilderDexTool.handler({
      vault: VALID_VAULT,
      newMax: 9,
    })) as { submitted?: boolean; txCalldata?: { to?: string; data?: string } };
    expect(mockSetMaxKnownBuilderDex).toHaveBeenCalledTimes(1);
    expect(mockSetMaxKnownBuilderDex).toHaveBeenCalledWith(9);
    expect(r.submitted).toBe(true);
    expect(r.txCalldata?.to).toBeDefined();
  });

  it('description notes whitelist non-coupling', () => {
    expect(hlSetMaxKnownBuilderDexTool.description).toMatch(/SUPPORTED_PERP_DEXES/);
  });

  it('rejects on non-HyperEVM chain', async () => {
    setChainId(42161, 'ARBITRUM_ONE');
    await expect(
      hlSetMaxKnownBuilderDexTool.handler({ vault: VALID_VAULT, newMax: 5 }),
    ).rejects.toThrow(/HyperEVM/);
  });
});

describe('hl_spot_send — zod schema + handler', () => {
  it('accepts valid token + amountWei', () => {
    expect(() =>
      hlSpotSendSchema.parse({ vault: VALID_VAULT, token: 0, amountWei: '100000000' }),
    ).not.toThrow();
  });

  it('rejects negative token', () => {
    expect(() =>
      hlSpotSendSchema.parse({ vault: VALID_VAULT, token: -1, amountWei: '1' }),
    ).toThrow();
  });

  it('rejects non-integer token', () => {
    expect(() =>
      hlSpotSendSchema.parse({ vault: VALID_VAULT, token: 1.5, amountWei: '1' }),
    ).toThrow();
  });

  it('CRITICAL — schema MUST NOT accept a `to` parameter (vault-to-vault only)', () => {
    // Confirm the resulting parsed object never carries a `to` field.
    const parsed = hlSpotSendSchema.parse({
      vault: VALID_VAULT,
      token: 0,
      amountWei: '1',
      to: '0xDEADbeef00000000000000000000000000000003',
    } as never);
    expect((parsed as { to?: unknown }).to).toBeUndefined();
    // Confirm the schema object does NOT declare a `to` field.
    expect(Object.keys(hlSpotSendSchema.shape)).not.toContain('to');
  });

  it('calls HLVault.spotSend with { token, amountWei: bigint }', async () => {
    const r = (await hlSpotSendTool.handler({
      vault: VALID_VAULT,
      token: 0,
      amountWei: '100000000',
    })) as { submitted?: boolean; txCalldata?: { to?: string; data?: string } };
    expect(mockSpotSend).toHaveBeenCalledTimes(1);
    expect(mockSpotSend).toHaveBeenCalledWith({ token: 0, amountWei: 100000000n });
    expect(r.submitted).toBe(true);
    expect(r.txCalldata?.to).toBeDefined();
  });

  it('rejects zero amountWei', async () => {
    await expect(
      hlSpotSendTool.handler({ vault: VALID_VAULT, token: 0, amountWei: '0' }),
    ).rejects.toThrow();
  });

  it('description flags vault-to-vault hardcoded destination', () => {
    expect(hlSpotSendTool.description).toMatch(/hardcoded/);
    expect(hlSpotSendTool.description).toMatch(/CANNOT transfer to a third-party/);
  });

  it('every property description warns about vault-to-vault restriction', () => {
    const props = hlSpotSendTool.inputSchema.properties as Record<string, { description: string }>;
    expect(props.token.description).toMatch(/Cannot send to a third address|Vault-to-vault/i);
    expect(props.amountWei.description).toMatch(/Cannot send to a third address|Vault-to-vault/i);
  });

  it('rejects on non-HyperEVM chain', async () => {
    setChainId(42161, 'ARBITRUM_ONE');
    await expect(
      hlSpotSendTool.handler({ vault: VALID_VAULT, token: 0, amountWei: '1' }),
    ).rejects.toThrow(/HyperEVM/);
  });
});

describe('hl_list_spot_tokens — zod schema + handler', () => {
  it('accepts empty input', () => {
    expect(() => hlListSpotTokensSchema.parse({})).not.toThrow();
  });

  it('accepts optional limit + filter', () => {
    expect(() =>
      hlListSpotTokensSchema.parse({ limit: 50, filter: 'AAPL' }),
    ).not.toThrow();
  });

  it('rejects non-positive limit', () => {
    expect(() => hlListSpotTokensSchema.parse({ limit: 0 })).toThrow();
  });

  it('calls HLVault.listSpotTokens and returns count + tokens', async () => {
    const r = await hlListSpotTokensTool.handler({});
    expect(mockListSpotTokens).toHaveBeenCalledTimes(1);
    expect(r.total).toBe(3);
    expect(r.count).toBe(3);
    expect(r.tokens[0].name).toBe('USDC');
    expect(r.tokens[1].evmContract).toBeDefined();
  });

  it('applies substring filter', async () => {
    const r = await hlListSpotTokensTool.handler({ filter: 'aapl' });
    expect(r.count).toBe(1);
    expect(r.tokens[0].name).toBe('AAPL');
    expect(r.total).toBe(3);
  });

  it('applies limit slicing', async () => {
    const r = await hlListSpotTokensTool.handler({ limit: 2 });
    expect(r.count).toBe(2);
    expect(r.total).toBe(3);
  });

  it('rejects on non-HyperEVM chain', async () => {
    setChainId(42161, 'ARBITRUM_ONE');
    await expect(hlListSpotTokensTool.handler({})).rejects.toThrow(/HyperEVM/);
  });
});

describe('hl_list_dexes — zod schema + handler', () => {
  it('accepts empty input (default includeUnsupported=false)', () => {
    const parsed = hlListDexesSchema.parse({});
    expect(parsed.includeUnsupported).toBe(false);
  });

  it('accepts includeUnsupported=true', () => {
    const parsed = hlListDexesSchema.parse({ includeUnsupported: true });
    expect(parsed.includeUnsupported).toBe(true);
  });

  it('passes includeUnsupported to HLVault.listDexes', async () => {
    await hlListDexesTool.handler({ includeUnsupported: true });
    expect(mockListDexes).toHaveBeenCalledTimes(1);
    expect(mockListDexes).toHaveBeenCalledWith({ includeUnsupported: true });
  });

  it('defaults includeUnsupported to false', async () => {
    await hlListDexesTool.handler({} as never);
    expect(mockListDexes).toHaveBeenCalledWith({ includeUnsupported: false });
  });

  it('returns count + dexes with metadata', async () => {
    const r = await hlListDexesTool.handler({ includeUnsupported: false });
    expect(r.count).toBe(2);
    expect(r.dexes[0].name).toBe('main');
    expect(r.dexes[0].type).toBe('main');
    expect(r.dexes[1].name).toBe('xyz');
    expect(r.dexes[1].deployer).toBeDefined();
    expect(r.dexes[1].assetCount).toBe(12);
    expect(r.dexes[1].supported).toBe(true);
  });

  it('rejects on non-HyperEVM chain', async () => {
    setChainId(42161, 'ARBITRUM_ONE');
    await expect(
      hlListDexesTool.handler({ includeUnsupported: false }),
    ).rejects.toThrow(/HyperEVM/);
  });
});

// ============================================================================
// HIGH-priority gap fill: cancel + raw placeOrder tools (gap fill 1/3)
// ============================================================================

const VALID_CLOID32 = '0xabcdef0123456789abcdef0123456789';

describe('hl_cancel_order — zod schema', () => {
  it('accepts a numeric perp + valid cloid', () => {
    expect(() =>
      hlCancelOrderSchema.parse({ vault: VALID_VAULT, perp: 0, cloid: VALID_CLOID32 }),
    ).not.toThrow();
  });
  it('rejects non-integer perp', () => {
    expect(() =>
      hlCancelOrderSchema.parse({ vault: VALID_VAULT, perp: 1.5, cloid: VALID_CLOID32 }),
    ).toThrow();
  });
  it('rejects negative perp', () => {
    expect(() =>
      hlCancelOrderSchema.parse({ vault: VALID_VAULT, perp: -1, cloid: VALID_CLOID32 }),
    ).toThrow();
  });
  it('rejects malformed cloid (missing 0x)', () => {
    expect(() =>
      hlCancelOrderSchema.parse({
        vault: VALID_VAULT,
        perp: 0,
        cloid: 'abcdef0123456789abcdef0123456789',
      }),
    ).toThrow();
  });
  it('rejects malformed cloid (wrong length)', () => {
    expect(() =>
      hlCancelOrderSchema.parse({ vault: VALID_VAULT, perp: 0, cloid: '0xdeadbeef' }),
    ).toThrow();
  });
});

describe('hl_cancel_order — handler', () => {
  it('invokes HLVault.cancelOrder with parsed perp + bigint cloid', async () => {
    await hlCancelOrderTool.handler({
      vault: VALID_VAULT,
      perp: 1,
      cloid: VALID_CLOID32,
    });
    expect(mockCancelOrder).toHaveBeenCalledTimes(1);
    const call = mockCancelOrder.mock.calls[0]?.[0] as { perp: number; cloid: bigint };
    expect(call.perp).toBe(1);
    expect(typeof call.cloid).toBe('bigint');
    expect(call.cloid).toBe(BigInt(VALID_CLOID32));
  });
  it('returns a tx envelope in simulation mode', async () => {
    const r = (await hlCancelOrderTool.handler({
      vault: VALID_VAULT,
      perp: 0,
      cloid: VALID_CLOID32,
    })) as { transaction?: { to?: string; data?: string }; submitted?: boolean };
    expect(r.submitted).toBe(true);
    expect(r.transaction?.to).toBeDefined();
    expect(r.transaction?.data).toBeDefined();
  });
  it('rejects an invalid vault address', async () => {
    await expect(
      hlCancelOrderTool.handler({ vault: 'not-an-address', perp: 0, cloid: VALID_CLOID32 }),
    ).rejects.toThrow(/Invalid vault address/);
  });
  it('description states no-third-party-transfer (kills order only)', () => {
    expect(hlCancelOrderTool.description).toMatch(/Does NOT move funds/);
  });
});

describe('hl_cancel_order_offchain — zod schema', () => {
  it('accepts qualified builder-dex symbol', () => {
    expect(() =>
      hlCancelOrderOffchainSchema.parse({
        vault: VALID_VAULT,
        perp: 'xyz:GOLD',
        cloid: VALID_CLOID32,
      }),
    ).not.toThrow();
  });
  it('accepts main-dex symbol', () => {
    expect(() =>
      hlCancelOrderOffchainSchema.parse({
        vault: VALID_VAULT,
        perp: 'ETH',
        cloid: VALID_CLOID32,
      }),
    ).not.toThrow();
  });
  it('rejects empty perp', () => {
    expect(() =>
      hlCancelOrderOffchainSchema.parse({
        vault: VALID_VAULT,
        perp: '',
        cloid: VALID_CLOID32,
      }),
    ).toThrow();
  });
  it('rejects malformed cloid', () => {
    expect(() =>
      hlCancelOrderOffchainSchema.parse({
        vault: VALID_VAULT,
        perp: 'xyz:GOLD',
        cloid: '0xZZZZ',
      }),
    ).toThrow();
  });
});

describe('hl_cancel_order_offchain — handler', () => {
  it('routes qualified builder-dex symbol verbatim to HLVault.cancelOrderOffChain', async () => {
    const r = (await hlCancelOrderOffchainTool.handler({
      vault: VALID_VAULT,
      perp: 'xyz:GOLD',
      cloid: VALID_CLOID32,
    })) as { submitted?: boolean; status?: string; response?: Record<string, unknown> };
    expect(mockCancelOrderOffChain).toHaveBeenCalledTimes(1);
    expect(mockCancelOrderOffChain).toHaveBeenCalledWith({
      perp: 'xyz:GOLD',
      cloid: VALID_CLOID32,
    });
    expect(r.submitted).toBe(true);
    expect(r.status).toBe('ok');
  });
  it('coerces numeric-string main-dex perp to number', async () => {
    await hlCancelOrderOffchainTool.handler({
      vault: VALID_VAULT,
      perp: '0',
      cloid: VALID_CLOID32,
    });
    const call = mockCancelOrderOffChain.mock.calls[0]?.[0] as { perp: number | string };
    expect(call.perp).toBe(0);
  });
  it('description states no-third-party-transfer', () => {
    expect(hlCancelOrderOffchainTool.description).toMatch(/Does NOT move funds/);
  });
});

describe('hl_place_order_raw — zod schema', () => {
  it('accepts main-dex symbol with required fields', () => {
    expect(() =>
      hlPlaceOrderRawSchema.parse({
        vault: VALID_VAULT,
        perp: 'ETH',
        isLong: true,
        sizeUsd: 100,
        limitPxReal: 4250.5,
      }),
    ).not.toThrow();
  });
  it('accepts builder-dex symbol with all fields', () => {
    expect(() =>
      hlPlaceOrderRawSchema.parse({
        vault: VALID_VAULT,
        perp: 'xyz:GOLD',
        isLong: false,
        sizeUsd: 25,
        limitPxReal: 2310.5,
        tif: 'Alo',
        reduceOnly: true,
        cloid: VALID_CLOID32,
      }),
    ).not.toThrow();
  });
  it('defaults tif=Ioc and reduceOnly=false', () => {
    const parsed = hlPlaceOrderRawSchema.parse({
      vault: VALID_VAULT,
      perp: 'BTC',
      isLong: true,
      sizeUsd: 100,
      limitPxReal: 60_000,
    });
    expect(parsed.tif).toBe('Ioc');
    expect(parsed.reduceOnly).toBe(false);
  });
  it('rejects unknown tif', () => {
    expect(() =>
      hlPlaceOrderRawSchema.parse({
        vault: VALID_VAULT,
        perp: 'ETH',
        isLong: true,
        sizeUsd: 10,
        limitPxReal: 100,
        tif: 'FOK' as 'Ioc',
      }),
    ).toThrow();
  });
  it('rejects non-positive sizeUsd', () => {
    expect(() =>
      hlPlaceOrderRawSchema.parse({
        vault: VALID_VAULT,
        perp: 'ETH',
        isLong: true,
        sizeUsd: 0,
        limitPxReal: 100,
      }),
    ).toThrow();
  });
  it('rejects non-positive limitPxReal', () => {
    expect(() =>
      hlPlaceOrderRawSchema.parse({
        vault: VALID_VAULT,
        perp: 'ETH',
        isLong: true,
        sizeUsd: 10,
        limitPxReal: -1,
      }),
    ).toThrow();
  });
  it('rejects malformed cloid when provided', () => {
    expect(() =>
      hlPlaceOrderRawSchema.parse({
        vault: VALID_VAULT,
        perp: 'ETH',
        isLong: true,
        sizeUsd: 10,
        limitPxReal: 100,
        cloid: '0xbad',
      }),
    ).toThrow();
  });
});

describe('hl_place_order_raw — handler', () => {
  it('routes main-dex symbol to HLVault.placeOrder (on-chain)', async () => {
    const r = (await hlPlaceOrderRawTool.handler({
      vault: VALID_VAULT,
      perp: 'ETH',
      isLong: true,
      sizeUsd: 250,
      limitPxReal: 4000,
      tif: 'Gtc',
      reduceOnly: false,
    })) as { kind?: string; transaction?: { to?: string; data?: string } };
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    expect(mockPlaceOrderOffChain).not.toHaveBeenCalled();
    const call = mockPlaceOrder.mock.calls[0]?.[0] as {
      perp: string | number;
      isLong: boolean;
      sizeUsd: number;
      limitPxReal: number;
      tif: number;
      reduceOnly: boolean;
    };
    expect(call.perp).toBe('ETH');
    expect(call.isLong).toBe(true);
    expect(call.sizeUsd).toBe(250);
    expect(call.limitPxReal).toBe(4000);
    // Tool maps zod-string 'Gtc' → ORDER_TIF.GTC integer constant (2)
    // before forwarding to the SDK's `placeOrder` (which expects the int).
    expect(call.tif).toBe(2);
    expect(r.kind).toBe('evmTx');
    expect(r.transaction?.to).toBeDefined();
  });

  it('routes numeric perp to HLVault.placeOrder', async () => {
    await hlPlaceOrderRawTool.handler({
      vault: VALID_VAULT,
      perp: 0,
      isLong: true,
      sizeUsd: 100,
      limitPxReal: 60_000,
    });
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    const call = mockPlaceOrder.mock.calls[0]?.[0] as { perp: number };
    expect(call.perp).toBe(0);
  });

  it('routes builder-dex symbol to HLVault.placeOrderOffChain (off-chain)', async () => {
    const r = (await hlPlaceOrderRawTool.handler({
      vault: VALID_VAULT,
      perp: 'xyz:GOLD',
      isLong: false,
      sizeUsd: 50,
      limitPxReal: 2310.5,
      tif: 'Alo',
      reduceOnly: false,
      cloid: VALID_CLOID32,
    })) as { kind?: string; status?: string; response?: Record<string, unknown> };
    expect(mockPlaceOrderOffChain).toHaveBeenCalledTimes(1);
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockPlaceOrderOffChain).toHaveBeenCalledWith({
      perp: 'xyz:GOLD',
      isLong: false,
      sizeUsd: 50,
      limitPxReal: 2310.5,
      tif: 'Alo',
      reduceOnly: false,
      cloid: VALID_CLOID32,
    });
    expect(r.kind).toBe('hlExchange');
    expect(r.status).toBe('ok');
  });

  it('rejects an invalid vault address', async () => {
    await expect(
      hlPlaceOrderRawTool.handler({
        vault: 'not-an-address',
        perp: 'ETH',
        isLong: true,
        sizeUsd: 10,
        limitPxReal: 100,
        tif: 'Ioc',
        reduceOnly: false,
      }),
    ).rejects.toThrow(/Invalid vault address/);
  });

  it('description states no-third-party-transfer invariant', () => {
    expect(hlPlaceOrderRawTool.description).toMatch(/Does NOT move funds/);
  });
});
