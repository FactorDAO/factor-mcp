/**
 * Vault Management Tool Tests
 *
 * Static tests (no RPC) for the 12 vault management tools:
 * - Fee Management (6): setWithdrawFee, setDepositFee, setPerformanceFee, setManagementFee, chargePerformanceFee, setFeeReceiver
 * - Risk Management (3): setMaxCap, setMaxDebtRatio, setPriceDeviationAllowance
 * - Manager Management (3): addVaultManager, removeVaultManager, setRiskManager
 */
import { describe, it, expect } from 'vitest';
import { allTools } from '../src/tools/index.js';

function findTool(name: string) {
  return (allTools as any[]).find((t) => t.name === name);
}

describe('Vault Management Tools', () => {
  const MANAGE_TOOL_NAMES = [
    'factor_set_withdraw_fee',
    'factor_set_deposit_fee',
    'factor_set_performance_fee',
    'factor_set_management_fee',
    'factor_charge_performance_fee',
    'factor_set_fee_receiver',
    'factor_set_max_cap',
    'factor_set_max_debt_ratio',
    'factor_set_price_deviation_allowance',
    'factor_add_vault_manager',
    'factor_remove_vault_manager',
    'factor_set_risk_manager',
  ];

  it('all 12 management tools exist in allTools', () => {
    const registeredNames = (allTools as any[]).map((t) => t.name);
    for (const name of MANAGE_TOOL_NAMES) {
      expect(registeredNames, `Missing tool: ${name}`).toContain(name);
    }
  });

  describe('Fee Tools', () => {
    const FEE_BPS_TOOLS = [
      'factor_set_withdraw_fee',
      'factor_set_deposit_fee',
      'factor_set_performance_fee',
      'factor_set_management_fee',
    ];

    for (const toolName of FEE_BPS_TOOLS) {
      describe(toolName, () => {
        it('requires vaultAddress and feeBps', () => {
          const tool = findTool(toolName);
          expect(tool).toBeDefined();
          expect(tool.inputSchema.required).toContain('vaultAddress');
          expect(tool.inputSchema.required).toContain('feeBps');
        });

        it('has feeBps property with description', () => {
          const tool = findTool(toolName);
          expect(tool.inputSchema.properties.feeBps).toBeDefined();
          expect(tool.inputSchema.properties.feeBps.type).toBe('string');
          expect(tool.inputSchema.properties.feeBps.description).toBeTruthy();
        });

        it('has optional password', () => {
          const tool = findTool(toolName);
          expect(tool.inputSchema.properties.password).toBeDefined();
          expect(tool.inputSchema.required).not.toContain('password');
        });
      });
    }

    describe('factor_charge_performance_fee', () => {
      it('only requires vaultAddress', () => {
        const tool = findTool('factor_charge_performance_fee');
        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toEqual(['vaultAddress']);
      });

      it('has optional password', () => {
        const tool = findTool('factor_charge_performance_fee');
        expect(tool.inputSchema.properties.password).toBeDefined();
        expect(tool.inputSchema.required).not.toContain('password');
      });
    });

    describe('factor_set_fee_receiver', () => {
      it('requires vaultAddress and receiverAddress', () => {
        const tool = findTool('factor_set_fee_receiver');
        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toContain('vaultAddress');
        expect(tool.inputSchema.required).toContain('receiverAddress');
      });

      it('has receiverAddress property', () => {
        const tool = findTool('factor_set_fee_receiver');
        expect(tool.inputSchema.properties.receiverAddress).toBeDefined();
        expect(tool.inputSchema.properties.receiverAddress.type).toBe('string');
      });

      it('has optional password', () => {
        const tool = findTool('factor_set_fee_receiver');
        expect(tool.inputSchema.properties.password).toBeDefined();
        expect(tool.inputSchema.required).not.toContain('password');
      });
    });
  });

  describe('Risk Tools', () => {
    describe('factor_set_max_cap', () => {
      it('requires vaultAddress and maxCap', () => {
        const tool = findTool('factor_set_max_cap');
        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toContain('vaultAddress');
        expect(tool.inputSchema.required).toContain('maxCap');
      });

      it('has maxCap property', () => {
        const tool = findTool('factor_set_max_cap');
        expect(tool.inputSchema.properties.maxCap).toBeDefined();
        expect(tool.inputSchema.properties.maxCap.type).toBe('string');
      });

      it('has optional password', () => {
        const tool = findTool('factor_set_max_cap');
        expect(tool.inputSchema.properties.password).toBeDefined();
        expect(tool.inputSchema.required).not.toContain('password');
      });
    });

    describe('factor_set_max_debt_ratio', () => {
      it('requires vaultAddress and maxDebtRatioBps', () => {
        const tool = findTool('factor_set_max_debt_ratio');
        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toContain('vaultAddress');
        expect(tool.inputSchema.required).toContain('maxDebtRatioBps');
      });

      it('has maxDebtRatioBps property', () => {
        const tool = findTool('factor_set_max_debt_ratio');
        expect(tool.inputSchema.properties.maxDebtRatioBps).toBeDefined();
        expect(tool.inputSchema.properties.maxDebtRatioBps.type).toBe('string');
      });

      it('has optional password', () => {
        const tool = findTool('factor_set_max_debt_ratio');
        expect(tool.inputSchema.properties.password).toBeDefined();
        expect(tool.inputSchema.required).not.toContain('password');
      });
    });

    describe('factor_set_price_deviation_allowance', () => {
      it('requires vaultAddress and allowanceBps', () => {
        const tool = findTool('factor_set_price_deviation_allowance');
        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toContain('vaultAddress');
        expect(tool.inputSchema.required).toContain('allowanceBps');
      });

      it('has allowanceBps property', () => {
        const tool = findTool('factor_set_price_deviation_allowance');
        expect(tool.inputSchema.properties.allowanceBps).toBeDefined();
        expect(tool.inputSchema.properties.allowanceBps.type).toBe('string');
      });

      it('has optional password', () => {
        const tool = findTool('factor_set_price_deviation_allowance');
        expect(tool.inputSchema.properties.password).toBeDefined();
        expect(tool.inputSchema.required).not.toContain('password');
      });
    });
  });

  describe('Manager Tools', () => {
    const MANAGER_TOOLS = [
      'factor_add_vault_manager',
      'factor_remove_vault_manager',
      'factor_set_risk_manager',
    ];

    for (const toolName of MANAGER_TOOLS) {
      describe(toolName, () => {
        it('requires vaultAddress and managerAddress', () => {
          const tool = findTool(toolName);
          expect(tool).toBeDefined();
          expect(tool.inputSchema.required).toContain('vaultAddress');
          expect(tool.inputSchema.required).toContain('managerAddress');
        });

        it('has managerAddress property', () => {
          const tool = findTool(toolName);
          expect(tool.inputSchema.properties.managerAddress).toBeDefined();
          expect(tool.inputSchema.properties.managerAddress.type).toBe('string');
        });

        it('has optional password', () => {
          const tool = findTool(toolName);
          expect(tool.inputSchema.properties.password).toBeDefined();
          expect(tool.inputSchema.required).not.toContain('password');
        });
      });
    }
  });

  describe('All management tools', () => {
    for (const toolName of MANAGE_TOOL_NAMES) {
      it(`${toolName} has vaultAddress as required`, () => {
        const tool = findTool(toolName);
        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toContain('vaultAddress');
        expect(tool.inputSchema.properties.vaultAddress).toBeDefined();
        expect(tool.inputSchema.properties.vaultAddress.type).toBe('string');
      });

      it(`${toolName} has a handler function`, () => {
        const tool = findTool(toolName);
        expect(typeof tool.handler).toBe('function');
      });

      it(`${toolName} has a description`, () => {
        const tool = findTool(toolName);
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      });
    }
  });
});
