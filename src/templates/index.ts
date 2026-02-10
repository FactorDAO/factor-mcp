/**
 * Forge script templates for Factor MCP.
 *
 * Templates generate complete Solidity scripts that can be passed directly
 * to `factor_run_forge_script`. Each template:
 * - Extends `Test` from forge-std (for `deal()` cheatcode)
 * - Uses pre-built calldata from the SDK (no ABI handling needed)
 * - Dynamically funds the sender with ETH and ERC20 tokens via deal()
 * - Works on forked networks without real funds
 */

// Common helpers
export {
  SCRIPT_HEADER,
  IERC20_INTERFACE,
  fundingSection,
  ethFundingSection,
  wrapInContract,
} from './common.js';

// Factory templates (vault deployment)
export {
  generateDeployVaultScript,
  type DeployVaultScriptParams,
} from './factory-scripts.js';

// Vault templates (deposit, withdraw, execute manager)
export {
  generateDepositScript,
  generateWithdrawScript,
  generateExecuteManagerScript,
  type DepositScriptParams,
  type WithdrawScriptParams,
  type ExecuteManagerScriptParams,
} from './vault-scripts.js';
