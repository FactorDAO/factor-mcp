import { z } from 'zod';
import { isAddress, isHex } from 'viem';

// Custom Zod validators for Ethereum types
export const addressSchema = z.string().refine(
  (val) => isAddress(val),
  { message: 'Invalid Ethereum address' }
);

export const hashSchema = z.string().refine(
  (val) => isHex(val) && val.length === 66,
  { message: 'Invalid transaction hash' }
);

export const amountSchema = z.string().refine(
  (val) => {
    try {
      const num = BigInt(val);
      return num >= 0n;
    } catch {
      return false;
    }
  },
  { message: 'Invalid amount - must be a non-negative integer string' }
);

export const percentageSchema = z.number().min(0).max(100);

export const slippageSchema = z.number().min(0).max(50).default(0.5);

// Tool input schemas
export const setChainSchema = z.object({
  chain: z.enum(['ARBITRUM_ONE', 'BASE', 'MAINNET']),
});

export const setRpcSchema = z.object({
  url: z.string().url(),
});

export const walletSetupSchema = z.object({
  privateKey: z.string().optional(),
  name: z.string().default('default'),
  password: z.string().optional(),
  generateNew: z.boolean().default(false),
});

export const vaultAddressSchema = z.object({
  vaultAddress: addressSchema,
});

export const depositSchema = z.object({
  vaultAddress: addressSchema,
  tokenAddress: addressSchema,
  amount: amountSchema,
  slippage: slippageSchema,
});

export const withdrawSchema = z.object({
  vaultAddress: addressSchema,
  shares: amountSchema,
  slippage: slippageSchema,
});

export const createVaultSchema = z.object({
  name: z.string().min(1).max(50),
  symbol: z.string().min(1).max(10),
  depositToken: addressSchema,
  managementFee: percentageSchema.default(0),
  performanceFee: percentageSchema.default(0),
});

export const buildStrategySchema = z.object({
  vaultAddress: addressSchema,
  steps: z.array(z.object({
    adapter: z.string(),
    action: z.string(),
    params: z.record(z.unknown()),
  })).min(1),
});

export const executeStrategySchema = z.object({
  vaultAddress: addressSchema,
  strategyId: z.string(),
  slippage: slippageSchema,
});

export const transactionHashSchema = z.object({
  hash: hashSchema,
});

export const listPositionsSchema = z.object({
  userAddress: addressSchema.optional(),
});

export const listAdaptersSchema = z.object({
  protocol: z.string().optional(),
});

export const listBuildingBlocksSchema = z.object({
  adapter: z.string().optional(),
});

export const simulateStrategySchema = z.object({
  vaultAddress: addressSchema,
  steps: z.array(z.object({
    adapter: z.string(),
    action: z.string(),
    params: z.record(z.unknown()),
  })).min(1),
});

export const previewTransactionSchema = z.object({
  to: addressSchema,
  data: z.string(),
  value: amountSchema.optional(),
});
