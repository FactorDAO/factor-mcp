import { z } from 'zod';
import { isAddress, type Address, encodeFunctionData, parseAbi } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, getPublicClient, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const depositSchema = z.object({
  vaultAddress: z.string(),
  assetAddress: z.string(),
  amount: z.string(),
  password: z.string().optional(),
});

export type DepositInput = z.infer<typeof depositSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const depositTool = {
  name: 'factor_deposit',
  description: 'Execute a deposit to a Factor Pro vault. Will automatically approve tokens if needed. Requires a configured wallet with sufficient balance.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      assetAddress: {
        type: 'string',
        description: 'The address of the token to deposit',
      },
      amount: {
        type: 'string',
        description: 'Amount to deposit in base units (wei)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
    required: ['vaultAddress', 'assetAddress', 'amount'],
  },
  handler: async (input: DepositInput) => {
    const validated = depositSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    if (!isAddress(validated.assetAddress)) {
      throw new VaultError('Invalid asset address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const userAddress = getWalletAddress(walletName) as Address;
    const vaultAddress = validated.vaultAddress as Address;
    const assetAddress = validated.assetAddress as Address;

    let amount: bigint;
    try {
      amount = BigInt(validated.amount);
      if (amount <= 0n) {
        throw new VaultError('Amount must be greater than 0');
      }
    } catch {
      throw new VaultError('Invalid amount - must be a non-negative integer string');
    }

    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment: 'production',
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Check if asset is a valid deposit asset
      const isDepositAsset = await proVault.isDepositAsset(assetAddress);
      if (!isDepositAsset) {
        throw new VaultError(`Token ${assetAddress} is not a valid deposit asset for this vault`);
      }

      const publicClient = getPublicClient();

      // Check user balance
      const balance = await publicClient.readContract({
        address: assetAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      });

      if (balance < amount) {
        throw new VaultError(
          `Insufficient balance. Have: ${balance.toString()}, Need: ${amount.toString()}`
        );
      }

      // Check allowance and approve if needed
      const allowance = await publicClient.readContract({
        address: assetAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [userAddress, vaultAddress],
      });

      const transactions: Array<{ type: string; hash: string; simulationMode: boolean }> = [];

      if (allowance < amount) {
        // Need to approve
        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [vaultAddress, amount],
        });

        const approveParams: TransactionParams = {
          to: assetAddress,
          data: approveData,
        };

        if (configManager.isSimulationMode()) {
          transactions.push({
            type: 'approve',
            hash: '0x0 (simulation)',
            simulationMode: true,
          });
        } else {
          const approveResult = await sendTransaction(approveParams, validated.password);
          transactions.push({
            type: 'approve',
            hash: approveResult.hash,
            simulationMode: false,
          });
        }
      }

      // Build deposit transaction using SDK
      const depositData = proVault.depositAsset({
        assetAddress,
        amountBN: amount.toString(),
        receiverAddress: userAddress,
      });

      const depositParams: TransactionParams = {
        to: depositData.to as Address,
        data: depositData.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(depositParams);
        transactions.push({
          type: 'deposit',
          hash: '0x0 (simulation)',
          simulationMode: true,
        });

        return {
          success: true,
          simulationMode: true,
          vault: vaultAddress,
          asset: assetAddress,
          deposit: {
            amount: validated.amount,
            from: userAddress,
          },
          transactions,
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast. Set SIMULATION_MODE=false to execute.',
        };
      }

      const depositResult = await sendTransaction(depositParams, validated.password);
      transactions.push({
        type: 'deposit',
        hash: depositResult.hash,
        simulationMode: false,
      });

      return {
        success: true,
        simulationMode: false,
        vault: vaultAddress,
        asset: assetAddress,
        deposit: {
          amount: validated.amount,
          from: userAddress,
        },
        transactions,
        chain,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute deposit', error);
    }
  },
};
