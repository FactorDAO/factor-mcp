/**
 * Lending Tool Tests
 *
 * Validates input schemas and protocol-specific validation for lending tools.
 * Tests that market-based protocols (morpho, compoundV3, siloV2) require their market params.
 */
import { describe, it, expect } from 'vitest';
import {
  lendSupplyTool,
  lendWithdrawTool,
  lendBorrowTool,
  lendRepayTool,
} from '../src/tools/index.js';

const LENDING_PROTOCOLS = ['aave', 'compoundV3', 'morpho', 'siloV2'];

describe('Lending Tools - Schema Validation', () => {
  const tools = [
    { name: 'supply', tool: lendSupplyTool },
    { name: 'withdraw', tool: lendWithdrawTool },
    { name: 'borrow', tool: lendBorrowTool },
    { name: 'repay', tool: lendRepayTool },
  ];

  for (const { name, tool } of tools) {
    describe(`lend_${name}`, () => {
      it('supports all four lending protocols', () => {
        const protocolProp = (tool as any).inputSchema.properties.protocol;
        expect(protocolProp.enum).toEqual(LENDING_PROTOCOLS);
      });

      it('has vaultAddress, protocol, and amount as required', () => {
        expect((tool as any).inputSchema.required).toContain('vaultAddress');
        expect((tool as any).inputSchema.required).toContain('protocol');
        expect((tool as any).inputSchema.required).toContain('amount');
      });

      it('has marketAddress property', () => {
        expect((tool as any).inputSchema.properties.marketAddress).toBeDefined();
      });

      it('has marketId property', () => {
        expect((tool as any).inputSchema.properties.marketId).toBeDefined();
      });

      it('has password property', () => {
        expect((tool as any).inputSchema.properties.password).toBeDefined();
      });
    });
  }

  // Supply and Withdraw have extra features
  describe('lend_supply extra features', () => {
    it('has collateral property for Morpho', () => {
      expect((lendSupplyTool as any).inputSchema.properties.collateral).toBeDefined();
    });

    it('description mentions Morpho collateral', () => {
      expect(lendSupplyTool.description).toContain('collateral');
    });
  });

  describe('lend_withdraw extra features', () => {
    it('has collateral property for Morpho', () => {
      expect((lendWithdrawTool as any).inputSchema.properties.collateral).toBeDefined();
    });
  });
});

describe('Lending Tools - Handler Validation', () => {
  // These tests call the handlers with invalid inputs to verify validation works
  // They should throw without hitting the blockchain

  it('supply rejects invalid vault address', async () => {
    await expect(
      (lendSupplyTool as any).handler({
        vaultAddress: 'not-an-address',
        protocol: 'aave',
        amount: '1000',
        assetAddress: '0x0000000000000000000000000000000000000001',
      })
    ).rejects.toThrow();
  });

  it('borrow rejects missing debtAddress for aave', async () => {
    await expect(
      (lendBorrowTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'aave',
        amount: '1000',
        // no debtAddress
      })
    ).rejects.toThrow('debtAddress is required for Aave');
  });

  it('borrow rejects missing marketAddress for compoundV3', async () => {
    await expect(
      (lendBorrowTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'compoundV3',
        amount: '1000',
        debtAddress: '0x0000000000000000000000000000000000000002',
        // no marketAddress
      })
    ).rejects.toThrow('marketAddress is required for Compound V3');
  });

  it('borrow rejects missing marketId for morpho', async () => {
    await expect(
      (lendBorrowTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'morpho',
        amount: '1000',
        // no marketId
      })
    ).rejects.toThrow('marketId is required for Morpho');
  });

  it('borrow rejects missing marketAddress for siloV2', async () => {
    await expect(
      (lendBorrowTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'siloV2',
        amount: '1000',
        debtAddress: '0x0000000000000000000000000000000000000002',
        // no marketAddress
      })
    ).rejects.toThrow('marketAddress is required for Silo V2');
  });

  it('repay rejects missing marketId for morpho', async () => {
    await expect(
      (lendRepayTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'morpho',
        amount: '1000',
      })
    ).rejects.toThrow('marketId is required for Morpho');
  });

  it('repay rejects missing marketAddress for siloV2', async () => {
    await expect(
      (lendRepayTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'siloV2',
        amount: '1000',
        debtAddress: '0x0000000000000000000000000000000000000002',
      })
    ).rejects.toThrow('marketAddress is required for Silo V2');
  });

  it('supply rejects invalid percentage', async () => {
    await expect(
      (lendSupplyTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'aave',
        amount: '150%',
        assetAddress: '0x0000000000000000000000000000000000000002',
      })
    ).rejects.toThrow('Percentage must be between 0 and 100');
  });

  it('supply rejects missing assetAddress for siloV2', async () => {
    await expect(
      (lendSupplyTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'siloV2',
        amount: '1000',
        marketAddress: '0x0000000000000000000000000000000000000003',
        // no assetAddress
      })
    ).rejects.toThrow('assetAddress is required for Silo V2');
  });

  it('supply rejects missing marketAddress for siloV2', async () => {
    await expect(
      (lendSupplyTool as any).handler({
        vaultAddress: '0x0000000000000000000000000000000000000001',
        protocol: 'siloV2',
        amount: '1000',
        assetAddress: '0x0000000000000000000000000000000000000002',
        // no marketAddress
      })
    ).rejects.toThrow('marketAddress is required for Silo V2');
  });
});
