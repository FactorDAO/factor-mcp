import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const actionEnum = z.enum(['stake', 'stakeAll', 'unstake', 'claim']);

export const gmxSchema = z.object({
  vaultAddress: z.string(),
  action: actionEnum,
  tokenAddress: z.string().optional(),
  amount: z.string().optional(),
  password: z.string().optional(),
});

export type GmxInput = z.infer<typeof gmxSchema>;

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

export const gmxTool = {
  name: 'factor_gmx',
  description: 'GMX staking operations through a Factor vault (Arbitrum only). Stake GMX/esGMX tokens, unstake, or claim rewards.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      action: {
        type: 'string',
        enum: ['stake', 'stakeAll', 'unstake', 'claim'],
        description: 'GMX action: stake (specific amount), stakeAll (entire balance), unstake, claim (rewards)',
      },
      tokenAddress: {
        type: 'string',
        description: 'Token address to stake/unstake (required for stake, stakeAll, unstake)',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei). Required for stake and unstake.',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'action'],
  },
  handler: async (input: GmxInput) => {
    const validated = gmxSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) throw new VaultError('Invalid vault address');

    const chain = configManager.getConfig().chain;
    if (chain !== 'ARBITRUM_ONE') {
      throw new VaultError('GMX is only available on Arbitrum');
    }

    if ((validated.action === 'stake' || validated.action === 'unstake') && !validated.amount) {
      throw new VaultError(`amount is required for ${validated.action}`);
    }
    if (validated.action !== 'claim' && !validated.tokenAddress) {
      throw new VaultError(`tokenAddress is required for ${validated.action}`);
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment,
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      const strategyBuilder = new StrategyBuilder({
        chainId,
        isProAdapter: true,
        environment,
      });

      const adapter = (strategyBuilder.adapter as any).gmx;
      let block: SendTransactionParams;

      switch (validated.action) {
        case 'stake':
          block = adapter.stake({ tokenAddress: validated.tokenAddress, amountBN: validated.amount });
          break;
        case 'stakeAll':
          block = adapter.stakeAll({ tokenAddress: validated.tokenAddress });
          break;
        case 'unstake':
          block = adapter.unstake({ tokenAddress: validated.tokenAddress, amountBN: validated.amount });
          break;
        case 'claim':
          block = adapter.claim();
          break;
      }

      const executeData = proVault.executeByManager([block]);

      const txParams: TransactionParams = {
        to: executeData.to as Address,
        data: executeData.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams);

        return {
          success: true,
          simulationMode: true,
          action: validated.action,
          protocol: 'gmx',
          vaultAddress,
          transaction: {
            to: executeData.to,
            data: executeData.data,
          },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast. Set SIMULATION_MODE=false to execute.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);

      return {
        success: true,
        simulationMode: false,
        action: validated.action,
        protocol: 'gmx',
        vaultAddress,
        transactionHash: result.hash,
        chain,
        note: `GMX ${validated.action} transaction submitted. Use factor_get_transaction_status to monitor progress.`,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to execute GMX operation', error);
    }
  },
};
