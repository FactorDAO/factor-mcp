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

// Tokenlist tools
import { getLendingTokensTool } from './tokenlist/get-lending-tokens.js';
import { addVaultTokenTool } from './tokenlist/add-vault-token.js';

// Lending tools
import { lendSupplyTool } from './lending/lend-supply.js';
import { lendWithdrawTool } from './lending/lend-withdraw.js';
import { lendBorrowTool } from './lending/lend-borrow.js';
import { lendRepayTool } from './lending/lend-repay.js';

// Strategy tools
import { listAdaptersTool } from './strategy/list-adapters.js';
import { buildStrategyTool } from './strategy/build-strategy.js';
import { simulateStrategyTool } from './strategy/simulate-strategy.js';
import { executeStrategyTool } from './strategy/execute-strategy.js';

// Transaction tools
import { previewTransactionTool } from './transaction/preview-transaction.js';
import { getTransactionStatusTool } from './transaction/get-transaction-status.js';

// Foundry tools
import { checkFoundryTool } from './foundry/check-foundry.js';
import { castCallTool } from './foundry/cast-call.js';
import { simulateTransactionTool } from './foundry/simulate-transaction.js';
import { decodeErrorTool } from './foundry/decode-error.js';

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
  getLendingTokensTool,
  addVaultTokenTool,
  lendSupplyTool,
  lendWithdrawTool,
  lendBorrowTool,
  lendRepayTool,
  listAdaptersTool,
  buildStrategyTool,
  simulateStrategyTool,
  executeStrategyTool,
  previewTransactionTool,
  getTransactionStatusTool,
  checkFoundryTool,
  castCallTool,
  simulateTransactionTool,
  decodeErrorTool,
};

// Tool registry
export const allTools = [
  // Configuration (5)
  setChainTool,
  setRpcTool,
  getConfigTool,
  walletSetupTool,
  getAddressBookTool,

  // Vault (13)
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

  // Tokenlist (2)
  getLendingTokensTool,
  addVaultTokenTool,

  // Lending (4)
  lendSupplyTool,
  lendWithdrawTool,
  lendBorrowTool,
  lendRepayTool,

  // Strategy (4)
  listAdaptersTool,
  buildStrategyTool,
  simulateStrategyTool,
  executeStrategyTool,

  // Transaction (2)
  previewTransactionTool,
  getTransactionStatusTool,

  // Foundry (4)
  checkFoundryTool,
  castCallTool,
  simulateTransactionTool,
  decodeErrorTool,
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
  | 'factor_get_lending_tokens'
  | 'factor_add_vault_token'
  | 'factor_lend_supply'
  | 'factor_lend_withdraw'
  | 'factor_lend_borrow'
  | 'factor_lend_repay'
  | 'factor_list_adapters'
  | 'factor_build_strategy'
  | 'factor_simulate_strategy'
  | 'factor_execute_strategy'
  | 'factor_preview_transaction'
  | 'factor_get_transaction_status'
  | 'factor_check_foundry'
  | 'factor_cast_call'
  | 'factor_simulate_transaction'
  | 'factor_decode_error';
