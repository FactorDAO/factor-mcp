import type { Hash } from 'viem';

export interface SendTransactionParams {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}

export interface VaultInfo {
  address: string;
  name: string;
  symbol: string;
  depositToken: string;
  totalAssets: string;
  totalSupply: string;
  managementFee: number;
  performanceFee: number;
  owner: string;
}

export interface VaultPosition {
  vaultAddress: string;
  vaultName: string;
  shares: string;
  shareValue: string;
  depositToken: string;
}

export interface DepositPreview {
  sharesReceived: string;
  exchangeRate: string;
  priceImpact: number;
}

export interface WithdrawPreview {
  assetsReceived: string;
  exchangeRate: string;
  priceImpact: number;
}

export interface AdapterInfo {
  id: string;
  name: string;
  protocol: string;
  supportedActions: string[];
  description: string;
}

export interface BuildingBlockInfo {
  id: string;
  name: string;
  type: 'LEND' | 'BORROW' | 'SWAP' | 'STAKE' | 'LP' | 'HARVEST' | 'FLASH_LOAN';
  adapter: string;
  description: string;
  parameters: ParameterSchema[];
}

export interface ParameterSchema {
  name: string;
  type: 'address' | 'uint256' | 'bytes' | 'bool' | 'string';
  required: boolean;
  description: string;
}

export interface StrategyStep {
  adapter: string;
  action: string;
  params: Record<string, unknown>;
}

export interface BuiltStrategy {
  id: string;
  steps: StrategyStep[];
  estimatedGas: string;
  encodedCalldata: string;
}

export interface StrategySimulation {
  success: boolean;
  gasUsed: string;
  returnData: unknown;
  error?: string;
}

export interface TransactionPreview {
  from: string;
  to: string;
  data: string;
  value: string;
  gasEstimate: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  totalCostEth: string;
}

export interface TransactionStatus {
  hash: Hash;
  status: 'pending' | 'success' | 'failed';
  blockNumber?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
}
