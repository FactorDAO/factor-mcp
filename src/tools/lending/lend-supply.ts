import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const protocolEnum = z.enum(['aave', 'compoundV3', 'morpho']);

export const lendSupplySchema = z.object({
  vaultAddress: z.string(),
  protocol: protocolEnum,
  assetAddress: z.string().optional(),
  marketAddress: z.string().optional(),
  marketId: z.string().optional(),
  amount: z.string(),
  password: z.string().optional(),
});

export type LendSupplyInput = z.infer<typeof lendSupplySchema>;

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

export const lendSupplyTool = {
  name: 'factor_lend_supply',
  description: 'Supply/deposit assets to a lending protocol (Aave, Compound V3, or Morpho) through a Factor vault. Use amount "all" to supply the entire vault balance of the asset.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      protocol: {
        type: 'string',
        enum: ['aave', 'compoundV3', 'morpho'],
        description: 'The lending protocol to use',
      },
      assetAddress: {
        type: 'string',
        description: 'Token address to supply (required for aave and compoundV3)',
      },
      marketAddress: {
        type: 'string',
        description: 'Compound V3 market address (required for compoundV3)',
      },
      marketId: {
        type: 'string',
        description: 'Morpho market ID (required for morpho)',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei), or "all" to supply the entire vault balance',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'protocol', 'amount'],
  },
  handler: async (input: LendSupplyInput) => {
    const validated = lendSupplySchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    // Protocol-specific validation
    if (validated.protocol === 'aave' && !validated.assetAddress) {
      throw new VaultError('assetAddress is required for Aave');
    }
    if (validated.protocol === 'compoundV3') {
      if (!validated.marketAddress) throw new VaultError('marketAddress is required for Compound V3');
      if (!validated.assetAddress) throw new VaultError('assetAddress is required for Compound V3');
    }
    if (validated.protocol === 'morpho' && !validated.marketId) {
      throw new VaultError('marketId is required for Morpho');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();
    const isAll = validated.amount.toLowerCase() === 'all';

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

      let block: SendTransactionParams;

      switch (validated.protocol) {
        case 'aave':
          block = isAll
            ? (strategyBuilder.adapter as any).aave.supplyAll({ assetAddress: validated.assetAddress })
            : (strategyBuilder.adapter as any).aave.supplyBN({ assetAddress: validated.assetAddress, amountBN: validated.amount });
          break;
        case 'compoundV3':
          block = isAll
            ? (strategyBuilder.adapter as any).compoundV3.supplyAll({ marketAddress: validated.marketAddress, assetAddress: validated.assetAddress })
            : (strategyBuilder.adapter as any).compoundV3.supplyBN({ marketAddress: validated.marketAddress, assetAddress: validated.assetAddress, amountBN: validated.amount });
          break;
        case 'morpho':
          block = isAll
            ? (strategyBuilder.adapter as any).morpho.supplyAll({ marketId: validated.marketId })
            : (strategyBuilder.adapter as any).morpho.supplyBN({ marketId: validated.marketId, amountBN: validated.amount });
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
          action: 'supply',
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
        action: 'supply',
        protocol: validated.protocol,
        vaultAddress,
        amount: validated.amount,
        transactionHash: result.hash,
        chain,
        note: 'Supply transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute lending supply', error);
    }
  },
};
