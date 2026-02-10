/**
 * Forge script templates for Vault operations (deposit, withdraw, execute manager).
 *
 * These templates generate complete Solidity scripts that can be passed
 * to `factor_run_forge_script`. They use pre-built calldata from the SDK
 * so the LLM never needs to handle ABIs or complex encoding.
 */

import { wrapInContract, fundingSection, ethFundingSection } from './common.js';

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

export interface DepositScriptParams {
  /** Vault contract address (checksummed) */
  vaultAddress: string;
  /** Token address to deposit (checksummed) */
  tokenAddress: string;
  /** Deposit amount in base units (wei) */
  amount: string;
  /** Pre-built calldata from SDK's proVault.depositAsset() — hex WITH 0x prefix */
  calldata: string;
}

/**
 * Generate a forge script that deposits tokens into a vault on a forked network.
 *
 * The script:
 * 1. Funds msg.sender with ETH and the deposit token
 * 2. Approves the vault to spend the token
 * 3. Calls the vault with pre-built deposit calldata
 */
export function generateDepositScript(params: DepositScriptParams): string {
  const calldataHex = params.calldata.startsWith('0x')
    ? params.calldata.slice(2)
    : params.calldata;

  const body = [
    `        address token = ${params.tokenAddress};`,
    `        address vault = ${params.vaultAddress};`,
    '',
    fundingSection({
      tokenAddress: 'token',
      tokenAmount: params.amount,
    }),
    '',
    '        vm.startBroadcast();',
    '',
    '        // Approve vault to spend tokens',
    '        IERC20(token).approve(vault, type(uint256).max);',
    '',
    '        // Deposit into vault',
    `        (bool ok, ) = vault.call(hex"${calldataHex}");`,
    '        require(ok, "deposit failed");',
    '',
    '        console.log("Deposit successful");',
    '',
    '        vm.stopBroadcast();',
  ].join('\n');

  return wrapInContract({
    contractName: 'DepositToVault',
    body,
  });
}

// ---------------------------------------------------------------------------
// Withdraw
// ---------------------------------------------------------------------------

export interface WithdrawScriptParams {
  /** Vault contract address (checksummed) */
  vaultAddress: string;
  /** Share amount to redeem in base units (wei) */
  shares: string;
  /** Pre-built calldata from SDK's proVault.withdrawAsset() — hex WITH 0x prefix */
  calldata: string;
}

/**
 * Generate a forge script that withdraws from a vault on a forked network.
 *
 * The script:
 * 1. Funds msg.sender with ETH for gas
 * 2. Gives msg.sender vault shares (via deal)
 * 3. Calls the vault with pre-built withdraw calldata
 */
export function generateWithdrawScript(params: WithdrawScriptParams): string {
  const calldataHex = params.calldata.startsWith('0x')
    ? params.calldata.slice(2)
    : params.calldata;

  const body = [
    `        address vault = ${params.vaultAddress};`,
    '',
    ethFundingSection(),
    '        // Give msg.sender vault shares for withdrawal',
    `        deal(vault, msg.sender, ${params.shares});`,
    '',
    '        vm.startBroadcast();',
    '',
    '        // Withdraw from vault',
    `        (bool ok, ) = vault.call(hex"${calldataHex}");`,
    '        require(ok, "withdraw failed");',
    '',
    '        console.log("Withdrawal successful");',
    '',
    '        vm.stopBroadcast();',
  ].join('\n');

  return wrapInContract({
    contractName: 'WithdrawFromVault',
    body,
  });
}

// ---------------------------------------------------------------------------
// Execute Manager (swap, lend, borrow, add adapter, etc.)
// ---------------------------------------------------------------------------

export interface ExecuteManagerScriptParams {
  /** Vault contract address (checksummed) */
  vaultAddress: string;
  /** Pre-built calldata from SDK's proVault.executeByManager() — hex WITH 0x prefix */
  calldata: string;
  /** Human-readable description of what this execution does */
  description?: string;
  /** Optional: tokens the vault needs to have for this operation */
  vaultTokens?: Array<{
    tokenAddress: string;
    amount: string;
  }>;
}

/**
 * Generate a forge script that executes a manager operation on a vault (forked network).
 *
 * The script:
 * 1. Funds msg.sender with ETH for gas
 * 2. Optionally funds the vault with tokens it needs
 * 3. Calls the vault with pre-built executeByManager calldata
 */
export function generateExecuteManagerScript(params: ExecuteManagerScriptParams): string {
  const calldataHex = params.calldata.startsWith('0x')
    ? params.calldata.slice(2)
    : params.calldata;

  const desc = params.description || 'Execute manager strategy';

  const tokenFunding = (params.vaultTokens || []).map((t) => [
    `        // Fund vault with tokens for ${desc}`,
    `        deal(${t.tokenAddress}, ${params.vaultAddress}, ${t.amount});`,
  ].join('\n')).join('\n');

  const body = [
    `        address vault = ${params.vaultAddress};`,
    '',
    ethFundingSection(),
    tokenFunding ? `\n${tokenFunding}` : '',
    '',
    '        vm.startBroadcast();',
    '',
    `        // ${desc}`,
    `        (bool ok, ) = vault.call(hex"${calldataHex}");`,
    `        require(ok, "${desc} failed");`,
    '',
    `        console.log("${desc}: success");`,
    '',
    '        vm.stopBroadcast();',
  ].join('\n');

  return wrapInContract({
    contractName: 'ExecuteManager',
    body,
  });
}
