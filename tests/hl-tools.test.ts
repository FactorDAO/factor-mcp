/**
 * HyperLiquid MCP Tools — Schema & Wiring Tests
 *
 * Validates:
 *   - Every HL tool's zod schema accepts well-formed input and rejects malformed
 *     input (missing fields, wrong types, out-of-range values).
 *   - Every HL tool's `inputSchema` (the MCP-facing JSON Schema) is well-formed.
 *   - HL tools refuse to execute on non-HyperEVM chains (chain id != 999).
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

  it('exactly 10 HL tools registered', () => {
    expect(allTools.length).toBe(10);
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
      hlAddApiWalletSchema.parse({ vault: VALID_VAULT, agentEoa: VALID_AGENT, slotName: '' }),
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
