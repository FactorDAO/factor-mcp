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
import { saveVaultMetadataTool } from './vault/save-vault-metadata.js';

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
import { transferOwnershipTool } from './vault/transfer-ownership.js';
import { vaultAnalyticsTool } from './vault/vault-analytics.js';

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

// Profile tools
import { saveProfileTool } from './profile/save-profile.js';
import { getProfileTool } from './profile/get-profile.js';
import { uploadIpfsTool } from './profile/upload-ipfs.js';

// Strategy tools
import { listAdaptersTool } from './strategy/list-adapters.js';
import { saveStrategyTool } from './strategy/save-strategy.js';
import { deleteStrategyTool } from './strategy/delete-strategy.js';
import { getStrategyTool } from './strategy/get-strategy.js';
import { getStrategiesTool } from './strategy/get-strategies.js';

// Swap tools
import { swapTool } from './swap/swap.js';
import { swapExactOutputTool } from './swap/swap-exact-output.js';
import { swapOpenOceanTool } from './swap/swap-openocean.js';
import { swapPendleTool } from './swap/swap-pendle.js';

// LP tools
import { lpCreatePositionTool } from './lp/lp-create-position.js';
import { lpAddLiquidityTool } from './lp/lp-add-liquidity.js';
import { lpRemoveLiquidityTool } from './lp/lp-remove-liquidity.js';
import { lpCollectFeesTool } from './lp/lp-collect-fees.js';

// HyperLiquid tools (chain 999 only)
import { hlOpenPositionTool } from './hl/hl-open-position.js';
import { hlClosePositionTool } from './hl/hl-close-position.js';
import { hlSetLeverageTool } from './hl/hl-set-leverage.js';
import { hlAddIsolatedMarginTool } from './hl/hl-add-isolated-margin.js';
import { hlAddApiWalletTool } from './hl/hl-add-api-wallet.js';
import { hlDepositToPerpTool } from './hl/hl-deposit-to-perp.js';
import { hlWithdrawToEvmTool } from './hl/hl-withdraw-to-evm.js';
import { hlGetNavTool } from './hl/hl-get-nav.js';
import { hlGetPositionsTool } from './hl/hl-get-positions.js';
import { hlSetSlippageCapTool } from './hl/hl-set-slippage-cap.js';
import { hlTransferToBuilderDexTool } from './hl/hl-transfer-to-builder-dex.js';
import { hlTransferFromBuilderDexTool } from './hl/hl-transfer-from-builder-dex.js';
import { hlListPerpsTool } from './hl/hl-list-perps.js';
import { hlListInstrumentsTool } from './hl/hl-list-instruments.js';
import { hlSearchInstrumentTool } from './hl/hl-search-instrument.js';
import { hlResolveInstrumentTool } from './hl/hl-resolve-instrument.js';
import { hlCompileOpenTool } from './hl/hl-compile-open.js';
import { hlCompileCloseTool } from './hl/hl-compile-close.js';
import { hlInitializeBuilderDexTool } from './hl/hl-initialize-builder-dex.js';
import { hlSyncPositionTool } from './hl/hl-sync-position.js';
import { hlSettlePendingTool } from './hl/hl-settle-pending.js';
import { hlCancelOrderTool } from './hl/hl-cancel-order.js';
import { hlCancelOrderOffchainTool } from './hl/hl-cancel-order-offchain.js';
import { hlPlaceOrderRawTool } from './hl/hl-place-order-raw.js';
import { hlForceForgetCloidTool } from './hl/hl-force-forget-cloid.js';
import { hlSetMaxKnownBuilderDexTool } from './hl/hl-set-max-known-builder-dex.js';
import { hlSpotSendTool } from './hl/hl-spot-send.js';
import { hlListSpotTokensTool } from './hl/hl-list-spot-tokens.js';
import { hlListDexesTool } from './hl/hl-list-dexes.js';
import { hlVaultStatsTool } from './hl/hl-vault-stats.js';
import { hlVaultPositionsDetailTool } from './hl/hl-vault-positions-detail.js';
import { hlVaultFillsTool } from './hl/hl-vault-fills.js';
import { hlVaultFundingTool } from './hl/hl-vault-funding.js';
import { hlVaultRealizedPnlTool } from './hl/hl-vault-realized-pnl.js';

// Yield tools
import { pendleLpTool } from './yield/pendle-lp.js';

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
  transferOwnershipTool,
  vaultAnalyticsTool,
  getLendingTokensTool,
  addVaultTokenTool,
  approveTool,
  lendSupplyTool,
  lendWithdrawTool,
  lendBorrowTool,
  lendRepayTool,
  saveProfileTool,
  getProfileTool,
  uploadIpfsTool,
  saveVaultMetadataTool,
  listAdaptersTool,
  saveStrategyTool,
  deleteStrategyTool,
  getStrategyTool,
  getStrategiesTool,
  swapTool,
  swapExactOutputTool,
  swapOpenOceanTool,
  swapPendleTool,
  lpCreatePositionTool,
  lpAddLiquidityTool,
  lpRemoveLiquidityTool,
  lpCollectFeesTool,
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
  hlListInstrumentsTool,
  hlSearchInstrumentTool,
  hlResolveInstrumentTool,
  hlCompileOpenTool,
  hlCompileCloseTool,
  hlInitializeBuilderDexTool,
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
  hlVaultStatsTool,
  hlVaultPositionsDetailTool,
  hlVaultFillsTool,
  hlVaultFundingTool,
  hlVaultRealizedPnlTool,
  pendleLpTool,
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
  transferOwnershipTool,
  vaultAnalyticsTool,

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

  // Profile & IPFS (3)
  saveProfileTool,
  getProfileTool,
  uploadIpfsTool,

  // Vault Metadata (1)
  saveVaultMetadataTool,

  // Strategy (5)
  listAdaptersTool,
  saveStrategyTool,
  deleteStrategyTool,
  getStrategyTool,
  getStrategiesTool,

  // Swap (4)
  swapTool,
  swapExactOutputTool,
  swapOpenOceanTool,
  swapPendleTool,

  // LP (4)
  lpCreatePositionTool,
  lpAddLiquidityTool,
  lpRemoveLiquidityTool,
  lpCollectFeesTool,

  // HyperLiquid (34)
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
  hlListInstrumentsTool,
  hlSearchInstrumentTool,
  hlResolveInstrumentTool,
  hlCompileOpenTool,
  hlCompileCloseTool,
  hlInitializeBuilderDexTool,
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
  hlVaultStatsTool,
  hlVaultPositionsDetailTool,
  hlVaultFillsTool,
  hlVaultFundingTool,
  hlVaultRealizedPnlTool,

  // Yield (1)
  pendleLpTool,

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
  | 'factor_vault_analytics'
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
  | 'factor_save_profile'
  | 'factor_get_profile'
  | 'factor_upload_ipfs'
  | 'factor_save_vault_metadata'
  | 'factor_list_adapters'
  | 'factor_save_strategy'
  | 'factor_delete_strategy'
  | 'factor_get_strategy'
  | 'factor_get_strategies'
  | 'factor_swap_uniswap'
  | 'factor_swap_uniswap_exact_output'
  | 'factor_swap_openocean'
  | 'factor_swap_pendle'
  | 'factor_lp_create_position'
  | 'factor_lp_add_liquidity'
  | 'factor_lp_remove_liquidity'
  | 'factor_lp_collect_fees'
  | 'factor_hl_open_position'
  | 'factor_hl_close_position'
  | 'factor_hl_set_leverage'
  | 'factor_hl_add_isolated_margin'
  | 'factor_hl_add_api_wallet'
  | 'factor_hl_deposit_to_perp'
  | 'factor_hl_withdraw_to_evm'
  | 'factor_hl_get_nav'
  | 'factor_hl_get_positions'
  | 'factor_hl_set_slippage_cap'
  | 'factor_hl_transfer_to_builder_dex'
  | 'factor_hl_transfer_from_builder_dex'
  | 'factor_hl_list_perps'
  | 'factor_hl_list_instruments'
  | 'factor_hl_search_instrument'
  | 'factor_hl_resolve_instrument'
  | 'factor_hl_compile_open'
  | 'factor_hl_compile_close'
  | 'factor_hl_sync_position'
  | 'factor_hl_settle_pending'
  | 'factor_hl_cancel_order'
  | 'factor_hl_cancel_order_offchain'
  | 'factor_hl_place_order_raw'
  | 'factor_hl_force_forget_cloid'
  | 'factor_hl_set_max_known_builder_dex'
  | 'factor_hl_spot_send'
  | 'factor_hl_list_spot_tokens'
  | 'factor_hl_list_dexes'
  | 'factor_pendle_lp'
  | 'factor_flashloan'
  | 'factor_preview_transaction'
  | 'factor_get_transaction_status'
  | 'factor_check_foundry'
  | 'factor_cast_call'
  | 'factor_simulate_transaction'
  | 'factor_decode_error'
  | 'factor_run_forge_script';
