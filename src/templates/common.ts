/**
 * Common Solidity template helpers for forge scripts.
 *
 * All generated scripts extend `Test` from forge-std/Test.sol (NOT Script.sol)
 * because `deal(token, to, amount)` for ERC20 overrides is only available in Test.
 */

/** Standard IERC20 interface used by all templates */
export const IERC20_INTERFACE = `interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}`;

/** Standard script header (SPDX + pragma + import) */
export const SCRIPT_HEADER = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";`;

/**
 * Generate the funding section that gives the sender ETH and ERC20 tokens.
 */
export function fundingSection(params: {
  tokenAddress: string;
  tokenAmount: string;
  ethAmount?: string;
}): string {
  const ethAmt = params.ethAmount || '10 ether';
  return [
    '        // Fund the sender with ETH for gas and tokens',
    `        vm.deal(msg.sender, ${ethAmt});`,
    `        deal(${params.tokenAddress}, msg.sender, ${params.tokenAmount});`,
  ].join('\n');
}

/**
 * Generate a funding section for ETH only (no ERC20).
 */
export function ethFundingSection(ethAmount?: string): string {
  const ethAmt = ethAmount || '10 ether';
  return `        // Fund the sender with ETH for gas\n        vm.deal(msg.sender, ${ethAmt});`;
}

/**
 * Wrap a body inside a standard forge script contract.
 */
export function wrapInContract(params: {
  contractName: string;
  body: string;
  extraInterfaces?: string;
}): string {
  const interfaces = params.extraInterfaces ? `\n${params.extraInterfaces}\n` : '';
  return [
    SCRIPT_HEADER,
    interfaces,
    IERC20_INTERFACE,
    '',
    `contract ${params.contractName} is Test {`,
    '    function run() external {',
    params.body,
    '    }',
    '}',
  ].join('\n');
}
