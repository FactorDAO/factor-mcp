/**
 * Tool Registration Tests
 *
 * Validates that ALL tools are properly exported and registered in the allTools array.
 * Run after every change to ensure no tool is accidentally dropped.
 */
import { describe, it, expect } from 'vitest';
import { allTools } from '../src/tools/index.js';

// The canonical list of every MCP tool that must be registered.
// UPDATE THIS LIST when adding or removing tools.
const EXPECTED_TOOL_NAMES = [
  // Config (5)
  'factor_set_chain',
  'factor_set_rpc',
  'factor_get_config',
  'factor_wallet_setup',
  'factor_get_address_book',

  // Vault (14)
  'factor_get_owned_vaults',
  'factor_get_vault_info',
  'factor_get_shares',
  'factor_get_executions',
  'factor_preview_deposit',
  'factor_preview_withdraw',
  'factor_deposit',
  'factor_withdraw',
  'factor_create_vault',
  'factor_execute_manager',
  'factor_get_factory_addresses',
  'factor_validate_vault_config',
  'factor_add_adapter',
  'factor_vault_templates',

  // Vault Management (12)
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

  // Tokenlist (2)
  'factor_get_lending_tokens',
  'factor_add_vault_token',

  // Token (1)
  'factor_give_approval',

  // Lending (4)
  'factor_lend_supply',
  'factor_lend_withdraw',
  'factor_lend_borrow',
  'factor_lend_repay',

  // Profile & IPFS (3)
  'factor_save_profile',
  'factor_get_profile',
  'factor_upload_ipfs',

  // Vault Metadata (1)
  'factor_save_vault_metadata',

  // Strategy (5)
  'factor_list_adapters',
  'factor_save_strategy',
  'factor_delete_strategy',
  'factor_get_strategy',
  'factor_get_strategies',

  // Swap (4)
  'factor_swap',
  'factor_swap_exact_output',
  'factor_swap_openocean',
  'factor_swap_pendle',

  // LP (4)
  'factor_lp_create_position',
  'factor_lp_add_liquidity',
  'factor_lp_remove_liquidity',
  'factor_lp_collect_fees',

  // HyperLiquid (10)
  'factor_hl_open_position',
  'factor_hl_close_position',
  'factor_hl_set_leverage',
  'factor_hl_add_isolated_margin',
  'factor_hl_add_api_wallet',
  'factor_hl_deposit_to_perp',
  'factor_hl_withdraw_to_evm',
  'factor_hl_get_nav',
  'factor_hl_get_positions',
  'factor_hl_set_slippage_cap',

  // Yield (1)
  'factor_pendle_lp',

  // Flash Loan (1)
  'factor_flashloan',

  // Transaction (2)
  'factor_preview_transaction',
  'factor_get_transaction_status',

  // Foundry (5)
  'factor_check_foundry',
  'factor_cast_call',
  'factor_simulate_transaction',
  'factor_decode_error',
  'factor_run_forge_script',
];

describe('Tool Registration', () => {
  it('allTools array has correct count', () => {
    expect(allTools.length).toBe(EXPECTED_TOOL_NAMES.length);
  });

  it('every expected tool is registered in allTools', () => {
    const registeredNames = allTools.map((t: any) => t.name);
    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(registeredNames, `Missing tool: ${expected}`).toContain(expected);
    }
  });

  it('no duplicate tool names in allTools', () => {
    const names = allTools.map((t: any) => t.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it('every tool has required structure', () => {
    for (const tool of allTools as any[]) {
      expect(tool, `Tool missing 'name': ${JSON.stringify(tool)}`).toHaveProperty('name');
      expect(tool, `Tool missing 'description': ${tool.name}`).toHaveProperty('description');
      expect(tool, `Tool missing 'inputSchema': ${tool.name}`).toHaveProperty('inputSchema');
      expect(tool, `Tool missing 'handler': ${tool.name}`).toHaveProperty('handler');
      expect(typeof tool.handler, `handler for ${tool.name} is not a function`).toBe('function');
    }
  });

  it('every tool has a valid inputSchema with type object', () => {
    for (const tool of allTools as any[]) {
      expect(tool.inputSchema.type, `${tool.name}: inputSchema.type should be 'object'`).toBe('object');
      expect(tool.inputSchema.properties, `${tool.name}: inputSchema.properties is missing`).toBeDefined();
    }
  });
});
