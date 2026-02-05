import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
  parseAbi,
  formatUnits,
} from 'viem';
import { configManager } from '../config/index.js';
import { SdkError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type {
  VaultInfo,
  VaultPosition,
  DepositPreview,
  WithdrawPreview,
  AdapterInfo,
  BuildingBlockInfo,
  SendTransactionParams,
} from './types.js';

// ERC20 ABI for basic token operations
const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

// Studio Pro Vault ABI (subset for read operations)
const VAULT_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewWithdraw(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function maxWithdraw(address) view returns (uint256)',
  'function owner() view returns (address)',
  'function managementFee() view returns (uint256)',
  'function performanceFee() view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
]);

// Factory ABI for vault creation
const FACTORY_ABI = parseAbi([
  'function createVault(string name, string symbol, address asset, uint256 managementFee, uint256 performanceFee) returns (address)',
  'function getVaults() view returns (address[])',
  'function getVaultsByOwner(address owner) view returns (address[])',
]);

let cachedPublicClient: PublicClient | null = null;
let cachedChainId: number | null = null;

export function getClient(): PublicClient {
  const currentChainId = configManager.getChainId();

  if (cachedPublicClient && cachedChainId === currentChainId) {
    return cachedPublicClient;
  }

  cachedPublicClient = createPublicClient({
    chain: configManager.getChain(),
    transport: http(configManager.getRpcUrl()),
  });
  cachedChainId = currentChainId;

  return cachedPublicClient;
}

export async function getVaultInfo(vaultAddress: Address): Promise<VaultInfo> {
  const client = getClient();

  try {
    const [name, symbol, asset, totalAssets, totalSupply, owner, managementFee, performanceFee] =
      await Promise.all([
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'name' }),
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'symbol' }),
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'asset' }),
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalAssets' }),
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalSupply' }),
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'owner' }),
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'managementFee' }).catch(() => 0n),
        client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'performanceFee' }).catch(() => 0n),
      ]);

    return {
      address: vaultAddress,
      name,
      symbol,
      depositToken: asset,
      totalAssets: totalAssets.toString(),
      totalSupply: totalSupply.toString(),
      managementFee: Number(managementFee) / 100, // Convert from basis points
      performanceFee: Number(performanceFee) / 100,
      owner,
    };
  } catch (error) {
    throw new SdkError(`Failed to get vault info for ${vaultAddress}`, error);
  }
}

export async function getUserVaultPosition(
  vaultAddress: Address,
  userAddress: Address
): Promise<VaultPosition | null> {
  const client = getClient();

  try {
    const [shares, name, asset] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'balanceOf', args: [userAddress] }),
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'name' }),
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'asset' }),
    ]);

    if (shares === 0n) {
      return null;
    }

    const shareValue = await client.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'convertToAssets',
      args: [shares],
    });

    return {
      vaultAddress,
      vaultName: name,
      shares: shares.toString(),
      shareValue: shareValue.toString(),
      depositToken: asset,
    };
  } catch (error) {
    logger.warn(`Failed to get position for vault ${vaultAddress}`, error);
    return null;
  }
}

export async function previewDeposit(
  vaultAddress: Address,
  amount: bigint
): Promise<DepositPreview> {
  const client = getClient();

  try {
    const [sharesReceived, totalAssets, totalSupply] = await Promise.all([
      client.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'previewDeposit',
        args: [amount],
      }),
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalAssets' }),
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalSupply' }),
    ]);

    // Calculate exchange rate
    const exchangeRate = totalSupply > 0n ? Number(totalAssets) / Number(totalSupply) : 1;

    // Calculate price impact (simple estimate)
    const expectedShares = totalSupply > 0n ? (amount * totalSupply) / totalAssets : amount;
    const priceImpact = expectedShares > 0n
      ? Math.abs(Number(sharesReceived - expectedShares) / Number(expectedShares)) * 100
      : 0;

    return {
      sharesReceived: sharesReceived.toString(),
      exchangeRate: exchangeRate.toFixed(8),
      priceImpact,
    };
  } catch (error) {
    throw new SdkError('Failed to preview deposit', error);
  }
}

export async function previewWithdraw(
  vaultAddress: Address,
  shares: bigint
): Promise<WithdrawPreview> {
  const client = getClient();

  try {
    const [assetsReceived, totalAssets, totalSupply] = await Promise.all([
      client.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'previewRedeem',
        args: [shares],
      }),
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalAssets' }),
      client.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalSupply' }),
    ]);

    const exchangeRate = totalSupply > 0n ? Number(totalAssets) / Number(totalSupply) : 1;

    // Calculate price impact
    const expectedAssets = totalSupply > 0n ? (shares * totalAssets) / totalSupply : shares;
    const priceImpact = expectedAssets > 0n
      ? Math.abs(Number(assetsReceived - expectedAssets) / Number(expectedAssets)) * 100
      : 0;

    return {
      assetsReceived: assetsReceived.toString(),
      exchangeRate: exchangeRate.toFixed(8),
      priceImpact,
    };
  } catch (error) {
    throw new SdkError('Failed to preview withdraw', error);
  }
}

export function encodeDepositCall(
  assets: bigint,
  receiver: Address
): SendTransactionParams {
  const client = getClient();

  // Manual ABI encoding for deposit(uint256, address)
  const selector = '0x6e553f65'; // deposit(uint256,address)
  const encodedAssets = assets.toString(16).padStart(64, '0');
  const encodedReceiver = receiver.slice(2).toLowerCase().padStart(64, '0');

  return {
    to: '0x0000000000000000000000000000000000000000' as Address, // Will be set by caller
    data: `${selector}${encodedAssets}${encodedReceiver}` as `0x${string}`,
  };
}

export function encodeWithdrawCall(
  shares: bigint,
  receiver: Address,
  owner: Address
): SendTransactionParams {
  // Manual ABI encoding for redeem(uint256, address, address)
  const selector = '0xba087652'; // redeem(uint256,address,address)
  const encodedShares = shares.toString(16).padStart(64, '0');
  const encodedReceiver = receiver.slice(2).toLowerCase().padStart(64, '0');
  const encodedOwner = owner.slice(2).toLowerCase().padStart(64, '0');

  return {
    to: '0x0000000000000000000000000000000000000000' as Address,
    data: `${selector}${encodedShares}${encodedReceiver}${encodedOwner}` as `0x${string}`,
  };
}

export function encodeApproveCall(
  spender: Address,
  amount: bigint
): SendTransactionParams {
  const selector = '0x095ea7b3'; // approve(address,uint256)
  const encodedSpender = spender.slice(2).toLowerCase().padStart(64, '0');
  const encodedAmount = amount.toString(16).padStart(64, '0');

  return {
    to: '0x0000000000000000000000000000000000000000' as Address,
    data: `${selector}${encodedSpender}${encodedAmount}` as `0x${string}`,
  };
}

export async function getTokenAllowance(
  tokenAddress: Address,
  ownerAddress: Address,
  spenderAddress: Address
): Promise<bigint> {
  const client = getClient();

  return client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  });
}

export async function getTokenBalance(
  tokenAddress: Address,
  userAddress: Address
): Promise<bigint> {
  const client = getClient();

  return client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  });
}

// Known adapters - in production these would come from SDK
export function getKnownAdapters(): AdapterInfo[] {
  return [
    {
      id: 'aave-v3',
      name: 'Aave V3',
      protocol: 'Aave',
      supportedActions: ['LEND', 'BORROW', 'REPAY', 'WITHDRAW'],
      description: 'Aave V3 lending protocol adapter',
    },
    {
      id: 'morpho',
      name: 'Morpho',
      protocol: 'Morpho',
      supportedActions: ['LEND', 'BORROW', 'REPAY', 'WITHDRAW'],
      description: 'Morpho lending optimizer adapter',
    },
    {
      id: 'uniswap-v3',
      name: 'Uniswap V3',
      protocol: 'Uniswap',
      supportedActions: ['SWAP', 'LP', 'COLLECT_FEES'],
      description: 'Uniswap V3 DEX adapter',
    },
    {
      id: 'gmx-v2',
      name: 'GMX V2',
      protocol: 'GMX',
      supportedActions: ['LP', 'STAKE', 'HARVEST'],
      description: 'GMX V2 perpetuals adapter',
    },
    {
      id: 'camelot',
      name: 'Camelot',
      protocol: 'Camelot',
      supportedActions: ['SWAP', 'LP', 'STAKE'],
      description: 'Camelot DEX adapter',
    },
    {
      id: 'pendle',
      name: 'Pendle',
      protocol: 'Pendle',
      supportedActions: ['LP', 'STAKE', 'HARVEST'],
      description: 'Pendle yield trading adapter',
    },
  ];
}

export function getKnownBuildingBlocks(): BuildingBlockInfo[] {
  return [
    {
      id: 'lend',
      name: 'Lend',
      type: 'LEND',
      adapter: 'any',
      description: 'Supply assets to a lending protocol',
      parameters: [
        { name: 'asset', type: 'address', required: true, description: 'Token to lend' },
        { name: 'amount', type: 'uint256', required: true, description: 'Amount to lend' },
      ],
    },
    {
      id: 'borrow',
      name: 'Borrow',
      type: 'BORROW',
      adapter: 'any',
      description: 'Borrow assets from a lending protocol',
      parameters: [
        { name: 'asset', type: 'address', required: true, description: 'Token to borrow' },
        { name: 'amount', type: 'uint256', required: true, description: 'Amount to borrow' },
      ],
    },
    {
      id: 'swap',
      name: 'Swap',
      type: 'SWAP',
      adapter: 'any',
      description: 'Swap tokens via DEX',
      parameters: [
        { name: 'tokenIn', type: 'address', required: true, description: 'Input token' },
        { name: 'tokenOut', type: 'address', required: true, description: 'Output token' },
        { name: 'amountIn', type: 'uint256', required: true, description: 'Input amount' },
        { name: 'minAmountOut', type: 'uint256', required: true, description: 'Minimum output' },
      ],
    },
    {
      id: 'stake',
      name: 'Stake',
      type: 'STAKE',
      adapter: 'any',
      description: 'Stake tokens for rewards',
      parameters: [
        { name: 'asset', type: 'address', required: true, description: 'Token to stake' },
        { name: 'amount', type: 'uint256', required: true, description: 'Amount to stake' },
      ],
    },
    {
      id: 'lp',
      name: 'Provide Liquidity',
      type: 'LP',
      adapter: 'any',
      description: 'Provide liquidity to a pool',
      parameters: [
        { name: 'tokenA', type: 'address', required: true, description: 'First token' },
        { name: 'tokenB', type: 'address', required: true, description: 'Second token' },
        { name: 'amountA', type: 'uint256', required: true, description: 'Amount of first token' },
        { name: 'amountB', type: 'uint256', required: true, description: 'Amount of second token' },
      ],
    },
    {
      id: 'harvest',
      name: 'Harvest Rewards',
      type: 'HARVEST',
      adapter: 'any',
      description: 'Claim accumulated rewards',
      parameters: [
        { name: 'pool', type: 'address', required: true, description: 'Pool address' },
      ],
    },
    {
      id: 'flash-loan',
      name: 'Flash Loan',
      type: 'FLASH_LOAN',
      adapter: 'aave-v3',
      description: 'Execute a flash loan',
      parameters: [
        { name: 'asset', type: 'address', required: true, description: 'Token to borrow' },
        { name: 'amount', type: 'uint256', required: true, description: 'Amount to borrow' },
        { name: 'calldata', type: 'bytes', required: true, description: 'Actions to execute' },
      ],
    },
  ];
}
