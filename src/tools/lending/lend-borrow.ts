import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';
import { checkAdapterRegistered, AdapterNotRegisteredError } from '../../utils/adapter-check.js';

const protocolEnum = z.enum(['aave', 'compoundV3', 'morpho', 'siloV2']);

export const lendBorrowSchema = z.object({
  vaultAddress: z.string(),
  protocol: protocolEnum,
  debtAddress: z.string().optional(),
  marketAddress: z.string().optional(),
  marketId: z.string().optional(),
  amount: z.string(),
  password: z.string().optional(),
});

export type LendBorrowInput = z.infer<typeof lendBorrowSchema>;

function getChainIdEnum(chain: string): ChainId {
  switch (chain) {
    case 'ARBITRUM_ONE':
      return ChainId.ARBITRUM_ONE;
    case 'BASE':
      return ChainId.BASE;
    case 'MAINNET':
      return ChainId.MAINNET;
    case 'ROBINHOOD':
      return 4663 as ChainId;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

export const lendBorrowTool = {
  name: 'factor_lend_borrow',
  description: 'Borrow assets from a lending protocol (Aave, Compound V3, Morpho, or Silo V2) through a Factor vault. Requires collateral to be supplied first.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      protocol: {
        type: 'string',
        enum: ['aave', 'compoundV3', 'morpho', 'siloV2'],
        description: 'The lending protocol to borrow from',
      },
      debtAddress: {
        type: 'string',
        description: 'Token address to borrow (required for aave, compoundV3, siloV2)',
      },
      marketAddress: {
        type: 'string',
        description: 'Market address (required for compoundV3 and siloV2)',
      },
      marketId: {
        type: 'string',
        description: 'Morpho market ID (required for morpho)',
      },
      amount: {
        type: 'string',
        description: 'Amount to borrow in base units (wei)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'protocol', 'amount'],
  },
  handler: async (input: LendBorrowInput) => {
    const validated = lendBorrowSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    if (validated.protocol === 'aave' && !validated.debtAddress) {
      throw new VaultError('debtAddress is required for Aave');
    }
    if (validated.protocol === 'compoundV3') {
      if (!validated.marketAddress) throw new VaultError('marketAddress is required for Compound V3');
      if (!validated.debtAddress) throw new VaultError('debtAddress is required for Compound V3');
    }
    if (validated.protocol === 'morpho' && !validated.marketId) {
      throw new VaultError('marketId is required for Morpho');
    }
    if (validated.protocol === 'siloV2') {
      if (!validated.debtAddress) throw new VaultError('debtAddress is required for Silo V2');
      if (!validated.marketAddress) throw new VaultError('marketAddress is required for Silo V2');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
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

      const adapter = (strategyBuilder.adapter as any)[validated.protocol];
      await checkAdapterRegistered(vaultAddress, adapter.adapterAddress as Address, validated.protocol);

      let block: SendTransactionParams;

      switch (validated.protocol) {
        case 'aave':
          block = (strategyBuilder.adapter as any).aave.borrowBN({ debtAddress: validated.debtAddress, amountBN: validated.amount });
          break;
        case 'compoundV3':
          block = (strategyBuilder.adapter as any).compoundV3.borrowBN({ marketAddress: validated.marketAddress, debtAddress: validated.debtAddress, amountBN: validated.amount });
          break;
        case 'morpho':
          block = (strategyBuilder.adapter as any).morpho.borrowBN({ marketId: validated.marketId, amountBN: validated.amount });
          break;
        case 'siloV2':
          block = (strategyBuilder.adapter as any).siloV2.borrowBN({ marketAddress: validated.marketAddress, debtAddress: validated.debtAddress, amountBN: validated.amount });
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
          action: 'borrow',
          protocol: validated.protocol,
          vaultAddress,
          amount: validated.amount,
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
        action: 'borrow',
        protocol: validated.protocol,
        vaultAddress,
        amount: validated.amount,
        transactionHash: result.hash,
        chain,
        note: 'Borrow transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof AdapterNotRegisteredError) {
        return {
          success: false,
          error: 'ADAPTER_NOT_REGISTERED',
          message: error.message,
          adapterAddress: error.adapterAddress,
          adapterName: error.adapterName,
          fix: `Call factor_add_adapter with vaultAddress "${vaultAddress}" and adapterAddress "${error.adapterAddress}", then sign_and_send. After that, retry this borrow.`,
        };
      }
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute lending borrow', error);
    }
  },
};
