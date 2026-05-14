/**
 * HyperLiquid catalog + batch-compiler MCP tools — schema and wiring tests.
 *
 * Validates the five new tools added in the catalog + batch-compiler PR:
 *   - factor_hl_list_instruments
 *   - factor_hl_search_instrument
 *   - factor_hl_resolve_instrument
 *   - factor_hl_compile_open
 *   - factor_hl_compile_close
 *
 * Pattern mirrors `tests/hl-tools.test.ts` — every external dependency is
 * mocked, no real RPC calls. Imports are deferred until after the mocks
 * are declared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Wallet signer mock (unused by these read-only tools but kept for parity).
vi.mock('../src/wallet/signer.js', () => ({
  sendTransaction: vi.fn(async () => ({ hash: '0xdeadbeef' as `0x${string}` })),
  estimateGas: vi.fn(async () => ({ gasLimit: 21_000n, totalCostEth: '0.0001' })),
}));

// Canned catalog data the stub HLVault returns. Shapes mirror what the SDK
// emits (perpDexs gives names; listPerps gives index/szDec/maxLeverage).
const FIXTURE_DEXES = [null, { name: 'xyz' }, { name: 'vntl' }];
const FIXTURE_PERPS: Record<string, Array<{ index: number; name: string; szDecimals: number; maxLeverage: number; onlyIsolated: boolean; markPx?: number }>> = {
  main: [
    { index: 0, name: 'BTC', szDecimals: 5, maxLeverage: 50, onlyIsolated: false, markPx: 70_000 },
    { index: 1, name: 'ETH', szDecimals: 4, maxLeverage: 25, onlyIsolated: false, markPx: 3_500 },
    { index: 2, name: 'SOL', szDecimals: 2, maxLeverage: 20, onlyIsolated: false, markPx: 150 },
  ],
  xyz: [
    { index: 0, name: 'xyz:GOLD', szDecimals: 4, maxLeverage: 5, onlyIsolated: false, markPx: 2_300 },
    { index: 1, name: 'xyz:BRENTOIL', szDecimals: 2, maxLeverage: 3, onlyIsolated: true, markPx: 88 },
    { index: 2, name: 'xyz:AAPL', szDecimals: 4, maxLeverage: 5, onlyIsolated: false, markPx: 220 },
  ],
  vntl: [
    { index: 0, name: 'vntl:VOLBET', szDecimals: 2, maxLeverage: 3, onlyIsolated: false },
  ],
};
const FIXTURE_SPOT_TOKENS = [
  { index: 0, name: 'USDC', szDecimals: 6, weiDecimals: 8 },
  { index: 100, name: 'OPENAI', szDecimals: 4, weiDecimals: 8, evmContract: '0xabc' },
];

const FIXTURE_POSITIONS: Array<{ dex: string; perp: string; position: { szi: bigint; entryNtl: bigint; isolatedRawUsd: bigint; leverage: number; isIsolated: boolean } }> = [
  // 1 BTC long position
  {
    dex: 'main',
    perp: 'BTC',
    position: { szi: 100_000n, entryNtl: 70_000_000_000n, isolatedRawUsd: 0n, leverage: 5, isIsolated: false },
  },
];

vi.mock('../src/tools/hl/hl-vault-factory.js', () => {
  // The stub vault implements only what `buildInstrumentCatalog` +
  // `compileOpen/ClosePosition` reach for. Anything else throws to make a
  // missing path obvious in test output.
  function makeStub() {
    return {
      exchange: {
        endpointUrl: 'https://api.hyperliquid.xyz/exchange',
        fetchImpl: vi.fn(async (_url: unknown, init: RequestInit) => {
          const body = JSON.parse(init.body as string);
          if (body.type === 'perpDexs') {
            return new Response(JSON.stringify(FIXTURE_DEXES), { status: 200 });
          }
          throw new Error('unexpected fetch: ' + JSON.stringify(body));
        }),
      },
      listPerps: vi.fn(async (dex?: string) => FIXTURE_PERPS[dex ?? 'main'] ?? []),
      listSpotTokens: vi.fn(async () => FIXTURE_SPOT_TOKENS),
      openPosition: vi.fn(async (_a: unknown) => ({
        to: '0x000000000000000000000000000000000000VAULT' as `0x${string}`,
        data: '0xopen' as `0x${string}`,
        value: 0n,
      })),
      closePosition: vi.fn(async (_a: unknown) => ({
        to: '0x000000000000000000000000000000000000VAULT' as `0x${string}`,
        data: '0xclose' as `0x${string}`,
        value: 0n,
      })),
      transferUsdcBetweenLedgers: vi.fn((_a: unknown) => ({
        to: '0x000000000000000000000000000000000000VAULT' as `0x${string}`,
        data: '0xxfer' as `0x${string}`,
        value: 0n,
      })),
      accountSummary: vi.fn(async () => ({
        accountValue: 1_000_000_000n, // $1000
        marginUsed: 0n,
        ntlPos: 0n,
        rawUsd: 1_000_000_000n,
      })),
      getAllPositions: vi.fn(async () => FIXTURE_POSITIONS),
      getPositions: vi.fn(async () => FIXTURE_POSITIONS.map((p) => ({ perp: 0, position: p.position }))),
      resolvePerp: vi.fn(async (s: string | number) => (typeof s === 'number' ? s : 0)),
    };
  }
  return { buildHlVault: vi.fn(() => makeStub()) };
});

// Mock configManager — chain 999, simulation mode on, fake wallet present.
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

// Imports after mocks.
import { hlListInstrumentsTool, hlListInstrumentsSchema } from '../src/tools/hl/hl-list-instruments.js';
import { hlSearchInstrumentTool, hlSearchInstrumentSchema } from '../src/tools/hl/hl-search-instrument.js';
import { hlResolveInstrumentTool, hlResolveInstrumentSchema } from '../src/tools/hl/hl-resolve-instrument.js';
import { hlCompileOpenTool, hlCompileOpenSchema } from '../src/tools/hl/hl-compile-open.js';
import { hlCompileCloseTool, hlCompileCloseSchema } from '../src/tools/hl/hl-compile-close.js';
import { configManager } from '../src/config/index.js';

function setChainId(id: number, name = 'HYPEREVM') {
  const s = (configManager as unknown as { __state: { chainId: number; chainName: string } }).__state;
  s.chainId = id;
  s.chainName = name;
}

beforeEach(() => setChainId(999, 'HYPEREVM'));

const VALID_VAULT = '0x1234567890AbcdEF1234567890aBcdef12345678';

const newTools = [
  hlListInstrumentsTool,
  hlSearchInstrumentTool,
  hlResolveInstrumentTool,
  hlCompileOpenTool,
  hlCompileCloseTool,
];

// ---------------------------------------------------------------------------
// Schema / wiring
// ---------------------------------------------------------------------------

describe('HL catalog tools — JSON Schema (MCP inputSchema)', () => {
  for (const tool of newTools) {
    describe(tool.name, () => {
      it('has type=object', () => {
        expect(tool.inputSchema.type).toBe('object');
      });
      it('properties is an object', () => {
        expect(typeof tool.inputSchema.properties).toBe('object');
        expect(tool.inputSchema.properties).not.toBeNull();
      });
      it('every required field is defined in properties', () => {
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
  it('all tool names start with factor_hl_', () => {
    for (const t of newTools) expect(t.name.startsWith('factor_hl_')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Zod schema cases
// ---------------------------------------------------------------------------

describe('hl_list_instruments — zod', () => {
  it('accepts empty input', () => {
    expect(() => hlListInstrumentsSchema.parse({})).not.toThrow();
  });
  it('accepts filters', () => {
    expect(() =>
      hlListInstrumentsSchema.parse({ type: 'perp', category: 'commodity', venue: 'xyz', limit: 50 }),
    ).not.toThrow();
  });
  it('rejects bad type', () => {
    expect(() => hlListInstrumentsSchema.parse({ type: 'bogus' })).toThrow();
  });
  it('rejects negative limit', () => {
    expect(() => hlListInstrumentsSchema.parse({ limit: -1 })).toThrow();
  });
  it('rejects limit > 500', () => {
    expect(() => hlListInstrumentsSchema.parse({ limit: 1000 })).toThrow();
  });
});

describe('hl_search_instrument — zod', () => {
  it('accepts valid input', () => {
    expect(() => hlSearchInstrumentSchema.parse({ query: 'BTC' })).not.toThrow();
  });
  it('rejects empty query', () => {
    expect(() => hlSearchInstrumentSchema.parse({ query: '' })).toThrow();
  });
  it('rejects missing query', () => {
    expect(() => hlSearchInstrumentSchema.parse({})).toThrow();
  });
});

describe('hl_resolve_instrument — zod', () => {
  it('accepts valid input', () => {
    expect(() => hlResolveInstrumentSchema.parse({ query: 'perp:main:BTC' })).not.toThrow();
  });
  it('rejects empty query', () => {
    expect(() => hlResolveInstrumentSchema.parse({ query: '' })).toThrow();
  });
});

describe('hl_compile_open — zod', () => {
  it('accepts minimal input', () => {
    expect(() =>
      hlCompileOpenSchema.parse({ vault: VALID_VAULT, instrumentId: 'BTC', sizeUsd: 100, isLong: true }),
    ).not.toThrow();
  });
  it('accepts full input', () => {
    expect(() =>
      hlCompileOpenSchema.parse({
        vault: VALID_VAULT,
        instrumentId: 'perp:xyz:GOLD',
        sizeUsd: 250.5,
        isLong: false,
        leverage: 3,
        slippageBps: 1500,
      }),
    ).not.toThrow();
  });
  it('rejects non-positive sizeUsd', () => {
    expect(() =>
      hlCompileOpenSchema.parse({ vault: VALID_VAULT, instrumentId: 'BTC', sizeUsd: 0, isLong: true }),
    ).toThrow();
  });
  it('rejects missing isLong', () => {
    expect(() =>
      hlCompileOpenSchema.parse({ vault: VALID_VAULT, instrumentId: 'BTC', sizeUsd: 100 }),
    ).toThrow();
  });
});

describe('hl_compile_close — zod', () => {
  it('accepts input without sizeUsd', () => {
    expect(() =>
      hlCompileCloseSchema.parse({ vault: VALID_VAULT, instrumentId: 'BTC' }),
    ).not.toThrow();
  });
  it('accepts input with sizeUsd', () => {
    expect(() =>
      hlCompileCloseSchema.parse({ vault: VALID_VAULT, instrumentId: 'BTC', sizeUsd: 500 }),
    ).not.toThrow();
  });
  it('rejects negative sizeUsd', () => {
    expect(() =>
      hlCompileCloseSchema.parse({ vault: VALID_VAULT, instrumentId: 'BTC', sizeUsd: -1 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Chain gating
// ---------------------------------------------------------------------------

describe('HL catalog tools — chain gating', () => {
  for (const tool of newTools) {
    it(`${tool.name} refuses non-HyperEVM chain`, async () => {
      setChainId(42161, 'ARBITRUM_ONE');
      const input = tool.name === 'factor_hl_compile_open'
        ? { vault: VALID_VAULT, instrumentId: 'BTC', sizeUsd: 100, isLong: true }
        : tool.name === 'factor_hl_compile_close'
          ? { vault: VALID_VAULT, instrumentId: 'BTC' }
          : tool.name === 'factor_hl_search_instrument' || tool.name === 'factor_hl_resolve_instrument'
            ? { query: 'BTC' }
            : {};
      await expect((tool.handler as (input: unknown) => Promise<unknown>)(input)).rejects.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// Happy-path execution
// ---------------------------------------------------------------------------

describe('hl_list_instruments — handler', () => {
  it('returns the full unified catalog', async () => {
    const r = await hlListInstrumentsTool.handler({});
    expect(r.chainId).toBe(999);
    expect(r.count).toBeGreaterThan(0);
    // 3 main perps + 3 xyz + 1 vntl + 1 spot (USDC filtered) = 8
    expect(r.total).toBe(8);
  });

  it('filters by type=spot', async () => {
    const r = await hlListInstrumentsTool.handler({ type: 'spot' });
    for (const i of r.instruments) expect(i.type).toBe('spot');
  });

  it('filters by category=commodity', async () => {
    const r = await hlListInstrumentsTool.handler({ category: 'commodity' });
    for (const i of r.instruments) expect(i.category).toBe('commodity');
  });

  it('filters by vaultTradable=false to surface unreachable builder dexes', async () => {
    const r = await hlListInstrumentsTool.handler({ vaultTradable: false });
    expect(r.instruments.length).toBeGreaterThan(0);
    for (const i of r.instruments) expect(i.vaultTradable).toBe(false);
  });
});

describe('hl_search_instrument — handler', () => {
  it('finds an exact main-dex match', async () => {
    const r = await hlSearchInstrumentTool.handler({ query: 'BTC' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].instrument.symbol).toBe('BTC');
    expect(r.hits[0].score).toBeGreaterThanOrEqual(900);
  });

  it('finds a builder-dex match by qualifiedSymbol', async () => {
    const r = await hlSearchInstrumentTool.handler({ query: 'xyz:BRENTOIL' });
    expect(r.hits[0].instrument.id).toBe('perp:xyz:BRENTOIL');
  });

  it('respects filters', async () => {
    // Search for a substring present in all xyz perp names ("xyz") to
    // surface the dex through scoring, then filter to that venue.
    const r = await hlSearchInstrumentTool.handler({ query: 'xyz', type: 'perp', venue: 'xyz', limit: 50 });
    expect(r.hits.length).toBeGreaterThan(0);
    for (const h of r.hits) {
      expect(h.instrument.type).toBe('perp');
      expect(h.instrument.venue.dexName).toBe('xyz');
    }
  });
});

describe('hl_resolve_instrument — handler', () => {
  it('resolves by id', async () => {
    const r = await hlResolveInstrumentTool.handler({ query: 'perp:main:BTC' });
    expect(r.instrument.id).toBe('perp:main:BTC');
  });

  it('resolves by bare symbol', async () => {
    const r = await hlResolveInstrumentTool.handler({ query: 'OPENAI' });
    expect(r.instrument.symbol).toBe('OPENAI');
  });

  it('throws on no match', async () => {
    await expect(hlResolveInstrumentTool.handler({ query: 'NOTATHING_AT_ALL' })).rejects.toThrow();
  });
});

describe('hl_compile_open — handler', () => {
  it('emits a JSON-safe plan for a main-dex perp', async () => {
    const r = await hlCompileOpenTool.handler({
      vault: VALID_VAULT,
      instrumentId: 'perp:main:BTC',
      sizeUsd: 200,
      isLong: true,
      leverage: 5,
    });
    expect(r.plan.blockers).toEqual([]);
    expect(r.plan.ops.length).toBeGreaterThan(0);
    expect(r.plan.ops[0].kind).toBe('evmTx');
    // value must be a string (BigInt → string conversion happened)
    expect(typeof r.plan.ops[0].value).toBe('string');
  });

  it('blocks builder-dex routing when not vaultTradable', async () => {
    const r = await hlCompileOpenTool.handler({
      vault: VALID_VAULT,
      instrumentId: 'perp:vntl:VOLBET',
      sizeUsd: 100,
      isLong: true,
    });
    expect(r.plan.blockers.length).toBeGreaterThan(0);
    expect(r.plan.ops).toEqual([]);
  });

  it('rejects invalid vault address', async () => {
    await expect(
      hlCompileOpenTool.handler({ vault: 'notahex', instrumentId: 'BTC', sizeUsd: 100, isLong: true }),
    ).rejects.toThrow();
  });
});

describe('hl_compile_close — handler', () => {
  it('emits a JSON-safe plan for a main-dex full close', async () => {
    const r = await hlCompileCloseTool.handler({
      vault: VALID_VAULT,
      instrumentId: 'perp:main:BTC',
    });
    expect(r.plan.blockers).toEqual([]);
    expect(r.plan.ops.length).toBeGreaterThanOrEqual(1);
    expect(r.plan.ops[0].kind).toBe('evmTx');
  });

  it('blocks when no position', async () => {
    const r = await hlCompileCloseTool.handler({
      vault: VALID_VAULT,
      instrumentId: 'perp:main:ETH', // not in FIXTURE_POSITIONS
    });
    expect(r.plan.blockers.some((b) => /no open position/.test(b))).toBe(true);
  });
});
