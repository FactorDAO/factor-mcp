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

// Comprehensive registry of all SDK Pro adapters
export function getKnownAdapters(): AdapterInfo[] {
  return [
    // === LENDING ===
    {
      id: 'aave',
      name: 'Aave V3',
      protocol: 'Aave',
      supportedActions: ['supplyBN', 'supplyAll', 'supplyByPercentage', 'borrowBN', 'repayBN', 'repayAll', 'repayByPercentage', 'withdrawBN', 'withdrawAll', 'withdrawByPercentage'],
      description: 'Aave V3 lending protocol - supply, borrow, repay, withdraw',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'lending',
    },
    {
      id: 'compoundV3',
      name: 'Compound V3',
      protocol: 'Compound',
      supportedActions: ['supplyBN', 'supplyAll', 'supplyByPercentage', 'borrowBN', 'repayBN', 'repayAll', 'repayByPercentage', 'withdrawBN', 'withdrawAll', 'withdrawByPercentage'],
      description: 'Compound V3 (Comet) lending protocol - market-based supply, borrow, repay, withdraw',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'lending',
    },
    {
      id: 'compoundV3Market',
      name: 'Compound V3 Market',
      protocol: 'Compound',
      supportedActions: ['addMarketToAsset', 'addMarketToDebt'],
      description: 'Compound V3 market management - add assets and debts to markets',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'lending',
    },
    {
      id: 'morpho',
      name: 'Morpho',
      protocol: 'Morpho',
      supportedActions: ['supplyBN', 'supplyAll', 'supplyByPercentage', 'supplyCollateralBN', 'supplyCollateralAll', 'borrowBN', 'repayBN', 'repayAll', 'repayByPercentage', 'withdrawBN', 'withdrawAll', 'withdrawByPercentage', 'withdrawCollateralBN', 'withdrawCollateral'],
      description: 'Morpho lending protocol - supply, borrow, repay, withdraw, plus collateral operations',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'lending',
    },
    {
      id: 'siloV2',
      name: 'Silo V2',
      protocol: 'Silo',
      supportedActions: ['supplyBN', 'supplyAll', 'borrowBN', 'repayBN', 'repayAll', 'withdrawBN', 'withdrawAll'],
      description: 'Silo V2 lending protocol - supply, borrow, repay, withdraw',
      chains: ['BASE'],
      category: 'lending',
    },
    {
      id: 'tender',
      name: 'Tender',
      protocol: 'Tender',
      supportedActions: ['mintBN', 'mintAll', 'redeemBN', 'redeemAll'],
      description: 'Tender lending protocol (Compound-compatible) - mint cTokens and redeem',
      chains: ['ARBITRUM_ONE'],
      category: 'lending',
    },
    {
      id: 'lodestar',
      name: 'Lodestar',
      protocol: 'Lodestar',
      supportedActions: ['mintBN', 'mintAll', 'redeemBN', 'redeemAll'],
      description: 'Lodestar lending protocol (Compound-compatible) - mint cTokens and redeem',
      chains: ['ARBITRUM_ONE'],
      category: 'lending',
    },

    // === DEX ===
    {
      id: 'uniswap',
      name: 'Uniswap V3',
      protocol: 'Uniswap',
      supportedActions: ['exactInputSingle', 'exactInputSingleAll', 'exactInputSingleByPercentage', 'exactOutputSingle'],
      description: 'Uniswap V3 swaps - exact input/output single-hop token swaps with fee tiers (100/500/3000/10000)',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'dex',
    },
    {
      id: 'openOcean',
      name: 'OpenOcean',
      protocol: 'OpenOcean',
      supportedActions: ['swapBN', 'swapAll'],
      description: 'OpenOcean DEX aggregator - aggregated swaps across multiple DEXes. Requires openOceanSwapData from OpenOcean API.',
      chains: ['ARBITRUM_ONE', 'BASE'],
      category: 'dex',
    },
    {
      id: 'aqua',
      name: 'Aqua',
      protocol: 'Aqua',
      supportedActions: ['swapBN', 'swapAll'],
      description: 'Aqua DEX - swap operations on Base chain',
      chains: ['BASE'],
      category: 'dex',
    },
    {
      id: 'pendlePy',
      name: 'Pendle PT/YT',
      protocol: 'Pendle',
      supportedActions: ['swapExactTokenForYtAll', 'swapExactTokenForPTAll', 'swapExactYtForToken', 'swapExactPTForToken'],
      description: 'Pendle PT/YT swaps - swap between tokens and Principal Tokens (PT) or Yield Tokens (YT)',
      chains: ['ARBITRUM_ONE', 'BASE'],
      category: 'dex',
    },

    // === LP ===
    {
      id: 'uniswapV3Lp',
      name: 'Uniswap V3 LP',
      protocol: 'Uniswap',
      supportedActions: ['createPosition', 'addLiquidity', 'removeLiquidity', 'collectFees'],
      description: 'Uniswap V3 concentrated liquidity - create positions, add/remove liquidity, collect fees',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'lp',
    },
    {
      id: 'camelotV3Lp',
      name: 'Camelot V3 LP',
      protocol: 'Camelot',
      supportedActions: ['createPosition', 'addLiquidity', 'removeLiquidity', 'collectFees'],
      description: 'Camelot V3 concentrated liquidity on Arbitrum - create positions, add/remove liquidity, collect fees',
      chains: ['ARBITRUM_ONE'],
      category: 'lp',
    },
    {
      id: 'aerodromeLp',
      name: 'Aerodrome LP',
      protocol: 'Aerodrome',
      supportedActions: ['createPosition', 'addLiquidity', 'removeLiquidity', 'collectFees'],
      description: 'Aerodrome concentrated liquidity on Base - create positions, add/remove liquidity, collect fees',
      chains: ['BASE'],
      category: 'lp',
    },

    // === YIELD ===
    {
      id: 'pendle',
      name: 'Pendle LP',
      protocol: 'Pendle',
      supportedActions: ['addLiquidity', 'removeLiquidity', 'collectFees'],
      description: 'Pendle LP operations - add/remove liquidity to Pendle markets, collect fees',
      chains: ['ARBITRUM_ONE', 'BASE'],
      category: 'yield',
    },
    {
      id: 'penpie',
      name: 'Penpie',
      protocol: 'Penpie',
      supportedActions: ['deposit', 'depositAll', 'withdraw', 'withdrawAll'],
      description: 'Penpie yield protocol - deposit/withdraw Pendle LP tokens for boosted rewards',
      chains: ['ARBITRUM_ONE'],
      category: 'yield',
    },
    {
      id: 'pirex',
      name: 'Pirex',
      protocol: 'Pirex',
      supportedActions: ['depositGmx', 'depositGmxAll', 'withdrawGmx', 'claimRewards', 'compound'],
      description: 'Pirex yield protocol - GMX staking wrapper with auto-compounding',
      chains: ['ARBITRUM_ONE'],
      category: 'yield',
    },
    {
      id: 'umami',
      name: 'Umami',
      protocol: 'Umami',
      supportedActions: ['depositGMVault', 'depositAllGMVault', 'withdrawGMVault'],
      description: 'Umami yield vaults - GMX-based yield strategies',
      chains: ['ARBITRUM_ONE'],
      category: 'yield',
    },
    {
      id: 'yieldVault',
      name: 'Yield Vault',
      protocol: 'YieldVault',
      supportedActions: ['deposit', 'depositAll', 'withdraw', 'withdrawAll'],
      description: 'Generic yield vault wrapper - deposit/withdraw to ERC-4626 compatible yield vaults',
      chains: ['ARBITRUM_ONE', 'BASE'],
      category: 'yield',
    },

    // === PERP ===
    {
      id: 'gmx',
      name: 'GMX',
      protocol: 'GMX',
      supportedActions: ['stake', 'stakeAll', 'unstake', 'claim'],
      description: 'GMX perpetuals protocol - stake GMX/esGMX, unstake, claim rewards',
      chains: ['ARBITRUM_ONE'],
      category: 'perp',
    },
    {
      id: 'gns',
      name: 'Gains Network',
      protocol: 'GNS',
      supportedActions: ['stake', 'unstake'],
      description: 'Gains Network perpetuals - staking operations',
      chains: ['ARBITRUM_ONE'],
      category: 'perp',
    },
    {
      id: 'glpV2',
      name: 'GLP V2',
      protocol: 'GMX',
      supportedActions: ['deposit', 'withdraw'],
      description: 'GLP V2 - GMX liquidity provider token operations',
      chains: ['ARBITRUM_ONE'],
      category: 'perp',
    },

    // === FLASH LOANS ===
    {
      id: 'aaveFL',
      name: 'Aave Flash Loan',
      protocol: 'Aave',
      supportedActions: ['executeFL'],
      description: 'Aave flash loans - borrow and repay within a single transaction for arbitrage, liquidation, or collateral swaps',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'flashloan',
    },
    {
      id: 'morphoFL',
      name: 'Morpho Flash Loan',
      protocol: 'Morpho',
      supportedActions: ['executeFL'],
      description: 'Morpho flash loans - borrow and repay within a single transaction',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'flashloan',
    },

    // === POLICY / MANAGEMENT ===
    {
      id: 'adapterManagement',
      name: 'Adapter Management',
      protocol: 'Factor',
      supportedActions: ['addAdapter', 'removeAdapter'],
      description: 'Vault adapter management - add or remove protocol adapters from a vault',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'policy',
    },
    {
      id: 'assetDebt',
      name: 'Asset & Debt Management',
      protocol: 'Factor',
      supportedActions: ['addAsset', 'addDebt', 'removeAsset', 'removeDebt'],
      description: 'Vault asset/debt management - register or remove asset and debt tokens with accounting adapters',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'policy',
    },
    {
      id: 'depositPolicy',
      name: 'Deposit Policy',
      protocol: 'Factor',
      supportedActions: ['setDepositPolicy'],
      description: 'Vault deposit policy management - configure deposit restrictions and strategies',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'policy',
    },

    // === AUTOMATION ===
    {
      id: 'gelato',
      name: 'Gelato',
      protocol: 'Gelato',
      supportedActions: ['addStrategy'],
      description: 'Gelato automation - create automated strategy execution with conditions and tasks',
      chains: ['ARBITRUM_ONE', 'BASE', 'MAINNET'],
      category: 'automation',
    },
  ];
}
