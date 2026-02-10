// Configuration tools
import { setChainTool } from './config/set-chain.js';
import { setRpcTool } from './config/set-rpc.js';
import { getConfigTool } from './config/get-config.js';
import { walletSetupTool } from './config/wallet-setup.js';
import { getAddressBookTool } from './config/get-address-book.js';

// Vault tools
import { getVaultInfoTool } from './vault/get-vault-info.js';
import { previewDepositTool } from './vault/preview-deposit.js';
import { previewWithdrawTool } from './vault/preview-withdraw.js';
import { depositTool } from './vault/deposit.js';
import { withdrawTool } from './vault/withdraw.js';
import { createVaultTool } from './vault/create-vault.js';
import { getOwnedVaultsTool } from './vault/get-owned-vaults.js';
import { getSharesTool } from './vault/get-shares.js';
import { getExecutionsTool } from './vault/get-executions.js';
import { executeManagerTool } from './vault/execute-manager.js';
import { getFactoryAddressesTool } from './vault/get-factory-addresses.js';
import { validateVaultConfigTool } from './vault/validate-vault-config.js';
import { addAdapterTool } from './vault/add-adapter.js';
import { vaultTemplatesTool } from './vault/vault-templates.js';

// Vault Management tools
import { setWithdrawFeeTool } from './vault/manage-fees.js';
import { setDepositFeeTool } from './vault/manage-fees.js';
import { setPerformanceFeeTool } from './vault/manage-fees.js';
import { setManagementFeeTool } from './vault/manage-fees.js';
import { chargePerformanceFeeTool } from './vault/manage-fees.js';
import { setFeeReceiverTool } from './vault/manage-fees.js';
import { setMaxCapTool } from './vault/manage-risk.js';
import { setMaxDebtRatioTool } from './vault/manage-risk.js';
import { setPriceDeviationAllowanceTool } from './vault/manage-risk.js';
import { addVaultManagerTool } from './vault/manage-managers.js';
import { removeVaultManagerTool } from './vault/manage-managers.js';
import { setRiskManagerTool } from './vault/manage-managers.js';

// Tokenlist tools
import { getLendingTokensTool } from './tokenlist/get-lending-tokens.js';
import { addVaultTokenTool } from './tokenlist/add-vault-token.js';

// Token tools
import { approveTool } from './token/approve.js';

// Lending tools
import { lendSupplyTool } from './lending/lend-supply.js';
import { lendWithdrawTool } from './lending/lend-withdraw.js';
import { lendBorrowTool } from './lending/lend-borrow.js';
import { lendRepayTool } from './lending/lend-repay.js';

// Strategy tools
import { listAdaptersTool } from './strategy/list-adapters.js';

// Swap tools
import { swapTool } from './swap/swap.js';
import { swapOpenOceanTool } from './swap/swap-openocean.js';
import { swapPendleTool } from './swap/swap-pendle.js';

// LP tools
import { lpCreatePositionTool } from './lp/lp-create-position.js';
import { lpAddLiquidityTool } from './lp/lp-add-liquidity.js';
import { lpRemoveLiquidityTool } from './lp/lp-remove-liquidity.js';
import { lpCollectFeesTool } from './lp/lp-collect-fees.js';

// Yield tools
import { gmxTool } from './yield/gmx.js';
import { pendleLpTool } from './yield/pendle-lp.js';
import { penpieTool } from './yield/penpie.js';

// Flash loan tools
import { flashloanTool } from './flashloan/flashloan.js';

// Transaction tools
import { previewTransactionTool } from './transaction/preview-transaction.js';
import { getTransactionStatusTool } from './transaction/get-transaction-status.js';

// Foundry tools
import { checkFoundryTool } from './foundry/check-foundry.js';
import { castCallTool } from './foundry/cast-call.js';
import { simulateTransactionTool } from './foundry/simulate-transaction.js';
import { decodeErrorTool } from './foundry/decode-error.js';
import { runForgeScriptTool } from './foundry/run-forge-script.js';

// Re-export
export {
  setChainTool,
  setRpcTool,
  getConfigTool,
  walletSetupTool,
  getAddressBookTool,
  getVaultInfoTool,
  previewDepositTool,
  previewWithdrawTool,
  depositTool,
  withdrawTool,
  createVaultTool,
  getOwnedVaultsTool,
  getSharesTool,
  getExecutionsTool,
  executeManagerTool,
  getFactoryAddressesTool,
  validateVaultConfigTool,
  addAdapterTool,
  vaultTemplatesTool,
  setWithdrawFeeTool,
  setDepositFeeTool,
  setPerformanceFeeTool,
  setManagementFeeTool,
  chargePerformanceFeeTool,
  setFeeReceiverTool,
  setMaxCapTool,
  setMaxDebtRatioTool,
  setPriceDeviationAllowanceTool,
  addVaultManagerTool,
  removeVaultManagerTool,
  setRiskManagerTool,
  getLendingTokensTool,
  addVaultTokenTool,
  approveTool,
  lendSupplyTool,
  lendWithdrawTool,
  lendBorrowTool,
  lendRepayTool,
  listAdaptersTool,
  swapTool,
  swapOpenOceanTool,
  swapPendleTool,
  lpCreatePositionTool,
  lpAddLiquidityTool,
  lpRemoveLiquidityTool,
  lpCollectFeesTool,
  gmxTool,
  pendleLpTool,
  penpieTool,
  flashloanTool,
  previewTransactionTool,
  getTransactionStatusTool,
  checkFoundryTool,
  castCallTool,
  simulateTransactionTool,
  decodeErrorTool,
  runForgeScriptTool,
};

// Tool registry
export const allTools = [
  // Configuration (5)
  setChainTool,
  setRpcTool,
  getConfigTool,
  walletSetupTool,
  getAddressBookTool,

  // Vault (14)
  getOwnedVaultsTool,
  getVaultInfoTool,
  getSharesTool,
  getExecutionsTool,
  previewDepositTool,
  previewWithdrawTool,
  depositTool,
  withdrawTool,
  createVaultTool,
  executeManagerTool,
  getFactoryAddressesTool,
  validateVaultConfigTool,
  addAdapterTool,
  vaultTemplatesTool,

  // Vault Management (12)
  setWithdrawFeeTool,
  setDepositFeeTool,
  setPerformanceFeeTool,
  setManagementFeeTool,
  chargePerformanceFeeTool,
  setFeeReceiverTool,
  setMaxCapTool,
  setMaxDebtRatioTool,
  setPriceDeviationAllowanceTool,
  addVaultManagerTool,
  removeVaultManagerTool,
  setRiskManagerTool,

  // Tokenlist (2)
  getLendingTokensTool,
  addVaultTokenTool,

  // Token (1)
  approveTool,

  // Lending (4)
  lendSupplyTool,
  lendWithdrawTool,
  lendBorrowTool,
  lendRepayTool,

  // Strategy (1)
  listAdaptersTool,

  // Swap (3)
  swapTool,
  swapOpenOceanTool,
  swapPendleTool,

  // LP (4)
  lpCreatePositionTool,
  lpAddLiquidityTool,
  lpRemoveLiquidityTool,
  lpCollectFeesTool,

  // Yield (3)
  gmxTool,
  pendleLpTool,
  penpieTool,

  // Flash Loan (1)
  flashloanTool,

  // Transaction (2)
  previewTransactionTool,
  getTransactionStatusTool,

  // Foundry (5)
  checkFoundryTool,
  castCallTool,
  simulateTransactionTool,
  decodeErrorTool,
  runForgeScriptTool,
];

export type ToolName =
  | 'factor_set_chain'
  | 'factor_set_rpc'
  | 'factor_get_config'
  | 'factor_wallet_setup'
  | 'factor_get_address_book'
  | 'factor_get_owned_vaults'
  | 'factor_get_vault_info'
  | 'factor_get_shares'
  | 'factor_get_executions'
  | 'factor_preview_deposit'
  | 'factor_preview_withdraw'
  | 'factor_deposit'
  | 'factor_withdraw'
  | 'factor_create_vault'
  | 'factor_execute_manager'
  | 'factor_get_factory_addresses'
  | 'factor_validate_vault_config'
  | 'factor_add_adapter'
  | 'factor_vault_templates'
  | 'factor_set_withdraw_fee'
  | 'factor_set_deposit_fee'
  | 'factor_set_performance_fee'
  | 'factor_set_management_fee'
  | 'factor_charge_performance_fee'
  | 'factor_set_fee_receiver'
  | 'factor_set_max_cap'
  | 'factor_set_max_debt_ratio'
  | 'factor_set_price_deviation_allowance'
  | 'factor_add_vault_manager'
  | 'factor_remove_vault_manager'
  | 'factor_set_risk_manager'
  | 'factor_get_lending_tokens'
  | 'factor_add_vault_token'
  | 'factor_give_approval'
  | 'factor_lend_supply'
  | 'factor_lend_withdraw'
  | 'factor_lend_borrow'
  | 'factor_lend_repay'
  | 'factor_list_adapters'
  | 'factor_swap'
  | 'factor_swap_openocean'
  | 'factor_swap_pendle'
  | 'factor_lp_create_position'
  | 'factor_lp_add_liquidity'
  | 'factor_lp_remove_liquidity'
  | 'factor_lp_collect_fees'
  | 'factor_gmx'
  | 'factor_pendle_lp'
  | 'factor_penpie'
  | 'factor_flashloan'
  | 'factor_preview_transaction'
  | 'factor_get_transaction_status'
  | 'factor_check_foundry'
  | 'factor_cast_call'
  | 'factor_simulate_transaction'
  | 'factor_decode_error'
  | 'factor_run_forge_script';
