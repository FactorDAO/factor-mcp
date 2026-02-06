import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const withdrawSchema = z.object({
  vaultAddress: z.string(),
  shares: z.string(),
  password: z.string().optional(),
});

export type WithdrawInput = z.infer<typeof withdrawSchema>;

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

export const withdrawTool = {
  name: 'factor_withdraw',
  description: 'Execute a withdrawal (redeem shares) from a Factor Pro vault. Requires a configured wallet with sufficient share balance.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      shares: {
        type: 'string',
        description: 'Amount of shares to redeem in base units (wei)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
    required: ['vaultAddress', 'shares'],
  },
  handler: async (input: WithdrawInput) => {
    const validated = withdrawSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const userAddress = getWalletAddress(walletName) as Address;
    const vaultAddress = validated.vaultAddress as Address;

    let shares: bigint;
    try {
      shares = BigInt(validated.shares);
      if (shares <= 0n) {
        throw new VaultError('Shares must be greater than 0');
      }
    } catch {
      throw new VaultError('Invalid shares - must be a non-negative integer string');
    }

    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment: configManager.getEnvironment(),
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Check user's share balance
      const balance = await proVault.balanceOf(userAddress);
      if (balance < shares) {
        throw new VaultError(
          `Insufficient shares. Have: ${balance.toString()}, Need: ${shares.toString()}`
        );
      }

      // Get the denominator asset (main withdraw asset)
      const vaultData = await proVault.getVaultData();
      const assetAddress = vaultData.metadata.assetDenominatorAddress;

      // Build withdraw transaction using SDK
      const withdrawData = proVault.withdrawAsset({
        assetAddress,
        shareAmountBN: shares.toString(),
        receiverAddress: userAddress,
        depositorAddress: userAddress,
      });

      const redeemParams: TransactionParams = {
        to: withdrawData.to as Address,
        data: withdrawData.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(redeemParams);

        return {
          success: true,
          simulationMode: true,
          vault: vaultAddress,
          withdrawal: {
            shares: validated.shares,
            receiver: userAddress,
          },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast. Set SIMULATION_MODE=false to execute.',
        };
      }

      const result = await sendTransaction(redeemParams, validated.password);

      return {
        success: true,
        simulationMode: false,
        vault: vaultAddress,
        withdrawal: {
          shares: validated.shares,
          receiver: userAddress,
          transactionHash: result.hash,
        },
        chain,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute withdrawal', error);
    }
  },
};
