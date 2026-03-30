/**
 * Schema Tests
 *
 * Validates that every tool's inputSchema is well-formed and has consistent structure.
 * Also validates specific tool schemas for correctness.
 */
import { describe, it, expect } from 'vitest';
import { allTools } from '../src/tools/index.js';

describe('Tool Schemas', () => {
  for (const tool of allTools as any[]) {
    describe(`${tool.name} schema`, () => {
      it('has type object', () => {
        expect(tool.inputSchema.type).toBe('object');
      });

      it('has properties object', () => {
        expect(typeof tool.inputSchema.properties).toBe('object');
        expect(tool.inputSchema.properties).not.toBeNull();
      });

      it('required fields exist in properties', () => {
        const required = tool.inputSchema.required || [];
        for (const field of required) {
          expect(
            tool.inputSchema.properties[field],
            `Required field "${field}" not in properties`
          ).toBeDefined();
        }
      });

      it('every property has a type', () => {
        for (const [key, prop] of Object.entries(tool.inputSchema.properties) as [string, any][]) {
          // arrays may use items instead of type
          const hasType = prop.type || prop.items || prop.enum || prop.oneOf;
          expect(hasType, `Property "${key}" missing type definition`).toBeTruthy();
        }
      });

      it('every property has a description', () => {
        for (const [key, prop] of Object.entries(tool.inputSchema.properties) as [string, any][]) {
          expect(prop.description, `Property "${key}" missing description`).toBeTruthy();
        }
      });
    });
  }
});

describe('Swap Tool Schemas', () => {
  const swapTool = (allTools as any[]).find(t => t.name === 'factor_swap');
  const swapOOTool = (allTools as any[]).find(t => t.name === 'factor_swap_openocean');
  const swapPendleTool = (allTools as any[]).find(t => t.name === 'factor_swap_pendle');

  it('factor_swap requires vaultAddress, tokenIn, tokenOut, amount', () => {
    expect(swapTool.inputSchema.required).toEqual(
      expect.arrayContaining(['vaultAddress', 'tokenIn', 'tokenOut', 'amount'])
    );
  });

  it('factor_swap has fee property with default 3000', () => {
    expect(swapTool.inputSchema.properties.fee).toBeDefined();
  });

  it('factor_swap_openocean requires openOceanSwapData', () => {
    expect(swapOOTool.inputSchema.required).toContain('openOceanSwapData');
  });

  it('factor_swap_pendle requires marketAddress and direction', () => {
    expect(swapPendleTool.inputSchema.required).toContain('marketAddress');
    expect(swapPendleTool.inputSchema.required).toContain('direction');
  });

  it('factor_swap_pendle direction has 4 options', () => {
    const dir = swapPendleTool.inputSchema.properties.direction;
    expect(dir.enum).toEqual(
      expect.arrayContaining(['tokenToPT', 'tokenToYT', 'ptToToken', 'ytToToken'])
    );
  });
});

describe('LP Tool Schemas', () => {
  const createPos = (allTools as any[]).find(t => t.name === 'factor_lp_create_position');
  const addLiq = (allTools as any[]).find(t => t.name === 'factor_lp_add_liquidity');
  const removeLiq = (allTools as any[]).find(t => t.name === 'factor_lp_remove_liquidity');
  const collectFees = (allTools as any[]).find(t => t.name === 'factor_lp_collect_fees');

  it('create_position requires token0, token1, tickLower, tickUpper', () => {
    const req = createPos.inputSchema.required;
    expect(req).toContain('token0');
    expect(req).toContain('token1');
    expect(req).toContain('tickLower');
    expect(req).toContain('tickUpper');
  });

  it('create_position protocol has uniswapV3', () => {
    expect(createPos.inputSchema.properties.protocol.enum).toEqual(
      expect.arrayContaining(['uniswapV3'])
    );
  });

  it('add_liquidity requires tokenId', () => {
    expect(addLiq.inputSchema.required).toContain('tokenId');
  });

  it('remove_liquidity requires tokenId and liquidity', () => {
    expect(removeLiq.inputSchema.required).toContain('tokenId');
    expect(removeLiq.inputSchema.required).toContain('liquidity');
  });

  it('collect_fees requires tokenId', () => {
    expect(collectFees.inputSchema.required).toContain('tokenId');
  });
});

describe('Yield Tool Schemas', () => {
  const pendleLp = (allTools as any[]).find(t => t.name === 'factor_pendle_lp');

  it('pendle_lp has addLiquidity, removeLiquidity, collectFees actions', () => {
    expect(pendleLp.inputSchema.properties.action.enum).toEqual(
      expect.arrayContaining(['addLiquidity', 'removeLiquidity', 'collectFees'])
    );
  });
});

describe('Flashloan Tool Schema', () => {
  const fl = (allTools as any[]).find(t => t.name === 'factor_flashloan');

  it('requires vaultAddress, provider, loans, strategySteps', () => {
    expect(fl.inputSchema.required).toContain('vaultAddress');
    expect(fl.inputSchema.required).toContain('provider');
    expect(fl.inputSchema.required).toContain('loans');
    expect(fl.inputSchema.required).toContain('strategySteps');
  });

  it('provider has balancer', () => {
    expect(fl.inputSchema.properties.provider.enum).toEqual(
      expect.arrayContaining(['balancer'])
    );
  });
});
