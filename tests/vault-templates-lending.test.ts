/**
 * Vault Templates Lending Tests
 *
 * Static tests (no RPC) for the lending protocol extensions to factor_vault_templates.
 * Verifies input schema, backward compatibility, and lending protocol enum.
 */
import { describe, it, expect } from 'vitest';
import { allTools } from '../src/tools/index.js';

function findTool(name: string) {
  return (allTools as any[]).find((t) => t.name === name);
}

describe('Vault Templates - Lending Protocol Support', () => {
  const tool = findTool('factor_vault_templates');

  it('factor_vault_templates tool exists', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('factor_vault_templates');
  });

  it('has a handler function', () => {
    expect(typeof tool.handler).toBe('function');
  });

  describe('inputSchema', () => {
    it('has denominator property (backward compatible)', () => {
      expect(tool.inputSchema.properties.denominator).toBeDefined();
      expect(tool.inputSchema.properties.denominator.type).toBe('string');
      expect(tool.inputSchema.properties.denominator.enum).toContain('USDC');
      expect(tool.inputSchema.properties.denominator.enum).toContain('WETH');
    });

    it('has lendingProtocol property', () => {
      expect(tool.inputSchema.properties.lendingProtocol).toBeDefined();
      expect(tool.inputSchema.properties.lendingProtocol.type).toBe('string');
    });

    it('lendingProtocol enum includes aave, compoundV3, morpho', () => {
      const lendingEnum = tool.inputSchema.properties.lendingProtocol.enum;
      expect(lendingEnum).toContain('aave');
      expect(lendingEnum).toContain('compoundV3');
      expect(lendingEnum).toContain('morpho');
    });

    it('lendingProtocol is not required (backward compatible)', () => {
      const required = tool.inputSchema.required || [];
      expect(required).not.toContain('lendingProtocol');
    });

    it('denominator is not required (backward compatible)', () => {
      const required = tool.inputSchema.required || [];
      expect(required).not.toContain('denominator');
    });
  });

  describe('description', () => {
    it('mentions lending protocol in description', () => {
      expect(tool.description).toContain('lendingProtocol');
    });

    it('mentions all three protocols in description', () => {
      expect(tool.description).toContain('Aave');
      expect(tool.description).toContain('Compound');
      expect(tool.description).toContain('Morpho');
    });

    it('mentions postDeploySteps in description', () => {
      expect(tool.description).toContain('postDeploySteps');
    });
  });
});
