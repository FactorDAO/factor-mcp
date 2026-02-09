import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const actionEnum = z.enum(['deposit', 'depositAll', 'withdraw', 'withdrawAll']);

export const penpieSchema = z.object({
  vaultAddress: z.string(),
  action: actionEnum,
  marketAddress: z.string(),
  amount: z.string().optional(),
  password: z.string().optional(),
});

export type PenpieInput = z.infer<typeof penpieSchema>;

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

export const penpieTool = {
  name: 'factor_penpie',
  description: 'Penpie yield operations through a Factor vault (Arbitrum only). Deposit/withdraw Pendle LP tokens to Penpie for boosted rewards.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      action: {
        type: 'string',
        enum: ['deposit', 'depositAll', 'withdraw', 'withdrawAll'],
        description: 'Penpie action: deposit (specific amount), depositAll (entire balance), withdraw, withdrawAll',
      },
      marketAddress: {
        type: 'string',
        description: 'The Pendle market address for the LP tokens',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei). Required for deposit and withdraw.',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'action', 'marketAddress'],
  },
  handler: async (input: PenpieInput) => {
    const validated = penpieSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) throw new VaultError('Invalid vault address');
    if (!isAddress(validated.marketAddress)) throw new VaultError('Invalid market address');

    const chain = configManager.getConfig().chain;
    if (chain !== 'ARBITRUM_ONE') {
      throw new VaultError('Penpie is only available on Arbitrum');
    }

    if ((validated.action === 'deposit' || validated.action === 'withdraw') && !validated.amount) {
      throw new VaultError(`amount is required for ${validated.action}`);
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

      const adapter = (strategyBuilder.adapter as any).penpie;
      let block: SendTransactionParams;

      switch (validated.action) {
        case 'deposit':
          block = adapter.deposit({ marketAddress: validated.marketAddress, amountBN: validated.amount });
          break;
        case 'depositAll':
          block = adapter.depositAll({ marketAddress: validated.marketAddress });
          break;
        case 'withdraw':
          block = adapter.withdraw({ marketAddress: validated.marketAddress, amountBN: validated.amount });
          break;
        case 'withdrawAll':
          block = adapter.withdrawAll({ marketAddress: validated.marketAddress });
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
          protocol: 'penpie',
          vaultAddress,
          marketAddress: validated.marketAddress,
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
        protocol: 'penpie',
        vaultAddress,
        marketAddress: validated.marketAddress,
        transactionHash: result.hash,
        chain,
        note: `Penpie ${validated.action} transaction submitted. Use factor_get_transaction_status to monitor progress.`,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) throw error;
      throw new SdkError('Failed to execute Penpie operation', error);
    }
  },
};
