import { z } from 'zod';
import { isAddress, type Address, encodeFunctionData, parseAbi, maxUint256 } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, getPublicClient, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

export const approveSchema = z.object({
  tokenAddress: z.string().describe('The ERC20 token address to approve'),
  spenderAddress: z.string().describe('The address to approve spending (e.g., vault address)'),
  amount: z.string().default('max').describe('Amount to approve in base units (wei), or "max" for unlimited approval. Default: "max"'),
  password: z.string().optional().describe('Wallet password if encrypted'),
});

export type ApproveInput = z.infer<typeof approveSchema>;

export const approveTool = {
  name: 'factor_give_approval',
  description: 'Approve an ERC20 token for spending by a spender address (e.g., a vault). This MUST be called before depositing tokens into a vault if the vault does not have sufficient allowance. Use "max" amount for unlimited approval, or specify an exact amount in base units. Always call this before factor_deposit if the vault needs allowance.',
  inputSchema: {
    type: 'object',
    properties: {
      tokenAddress: {
        type: 'string',
        description: 'The ERC20 token address to approve',
      },
      spenderAddress: {
        type: 'string',
        description: 'The address to approve spending for (e.g., vault address, factory address)',
      },
      amount: {
        type: 'string',
        description: 'Amount to approve in base units (wei), or "max" for unlimited approval. Default: "max"',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
    required: ['tokenAddress', 'spenderAddress'],
  },
  handler: async (input: ApproveInput) => {
    const validated = approveSchema.parse(input);

    if (!isAddress(validated.tokenAddress)) {
      throw new VaultError('Invalid token address');
    }

    if (!isAddress(validated.spenderAddress)) {
      throw new VaultError('Invalid spender address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const userAddress = getWalletAddress(walletName) as Address;
    const tokenAddress = validated.tokenAddress as Address;
    const spenderAddress = validated.spenderAddress as Address;

    try {
      const publicClient = getPublicClient();

      // Get token info for better response
      let tokenSymbol = 'UNKNOWN';
      let tokenDecimals = 18;
      try {
        [tokenSymbol, tokenDecimals] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'symbol',
          }),
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'decimals',
          }),
        ]);
      } catch {
        // Non-standard token, continue with defaults
      }

      // Check current allowance
      const currentAllowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [userAddress, spenderAddress],
      });

      // Determine approval amount
      const approvalAmount = validated.amount === 'max' ? maxUint256 : BigInt(validated.amount);

      // Check if approval is already sufficient
      if (currentAllowance >= approvalAmount) {
        return {
          success: true,
          alreadyApproved: true,
          token: tokenAddress,
          tokenSymbol,
          spender: spenderAddress,
          currentAllowance: currentAllowance.toString(),
          requestedAmount: validated.amount === 'max' ? 'max (unlimited)' : validated.amount,
          note: `Token ${tokenSymbol} already has sufficient allowance for ${spenderAddress}. No transaction needed.`,
        };
      }

      // Build approve transaction
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spenderAddress, approvalAmount],
      });

      const txParams: TransactionParams = {
        to: tokenAddress,
        data: approveData,
      };

      if (configManager.isSimulationMode()) {
        return {
          success: true,
          simulationMode: true,
          token: tokenAddress,
          tokenSymbol,
          spender: spenderAddress,
          previousAllowance: currentAllowance.toString(),
          newAllowance: validated.amount === 'max' ? 'max (unlimited)' : validated.amount,
          note: 'Simulation mode - approval was not broadcast. Set SIMULATION_MODE=false to execute.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);

      return {
        success: true,
        simulationMode: false,
        token: tokenAddress,
        tokenSymbol,
        spender: spenderAddress,
        previousAllowance: currentAllowance.toString(),
        newAllowance: validated.amount === 'max' ? 'max (unlimited)' : validated.amount,
        transactionHash: result.hash,
        chain: configManager.getConfig().chain,
        note: `Approved ${tokenSymbol} for spending by ${spenderAddress}. You can now proceed with the deposit or other operation.`,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to approve token', error);
    }
  },
};
