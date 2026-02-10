/**
 * Forge script templates for Factory operations (vault deployment).
 *
 * These templates generate complete Solidity scripts that can be passed
 * to `factor_run_forge_script`. They use pre-built calldata from the SDK
 * so the LLM never needs to handle ABIs or complex encoding.
 */

import { wrapInContract, fundingSection } from './common.js';

export interface DeployVaultScriptParams {
  /** Factory contract address (checksummed) */
  factoryAddress: string;
  /** Denominator token address (checksummed) */
  tokenAddress: string;
  /** Initial deposit amount in base units (wei) */
  depositAmount: string;
  /** Pre-built calldata from SDK's proFactory.deployVault() — hex string WITH 0x prefix */
  calldata: string;
  /** Vault name (for comments) */
  vaultName?: string;
}

/**
 * Generate a forge script that deploys a vault on a forked network.
 *
 * The script:
 * 1. Funds msg.sender with ETH (for gas) and tokens (for initial deposit)
 * 2. Approves the factory to spend the denominator token
 * 3. Calls the factory with pre-built calldata
 * 4. Logs the deployed vault address
 */
export function generateDeployVaultScript(params: DeployVaultScriptParams): string {
  const calldataHex = params.calldata.startsWith('0x')
    ? params.calldata.slice(2)
    : params.calldata;

  const comment = params.vaultName
    ? `        // Deploy vault: ${params.vaultName}`
    : '        // Deploy vault';

  const body = [
    `        address token = ${params.tokenAddress};`,
    `        address factory = ${params.factoryAddress};`,
    '',
    fundingSection({
      tokenAddress: 'token',
      tokenAmount: params.depositAmount,
    }),
    '',
    '        vm.startBroadcast();',
    '',
    '        // Approve factory to spend tokens',
    '        IERC20(token).approve(factory, type(uint256).max);',
    '',
    comment,
    `        (bool ok, bytes memory result) = factory.call(hex"${calldataHex}");`,
    '        require(ok, "vault deploy failed");',
    '',
    '        // Log the deployed vault address',
    '        if (result.length >= 32) {',
    '            address vault = abi.decode(result, (address));',
    '            console.log("Deployed vault:", vault);',
    '        }',
    '',
    '        vm.stopBroadcast();',
  ].join('\n');

  return wrapInContract({
    contractName: 'DeployVault',
    body,
  });
}
