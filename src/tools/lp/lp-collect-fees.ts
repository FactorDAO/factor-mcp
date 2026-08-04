import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const protocolEnum = z.enum(['uniswapV3']);

export const lpCollectFeesSchema = z.object({
  vaultAddress: z.string(),
  protocol: protocolEnum,
  tokenId: z.string(),
  password: z.string().optional(),
});

export type LpCollectFeesInput = z.infer<typeof lpCollectFeesSchema>;

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
    case 'GNOSIS':
      return 100 as ChainId;
    case 'GNOSIS': return 100 as ChainId;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

const adapterMap: Record<string, string> = {
  uniswapV3: 'uniswapV3Lp',
};

export const lpCollectFeesTool = {
  name: 'factor_lp_collect_fees',
  description: 'Collect accumulated fees from a concentrated liquidity position through a Factor vault. Supports Uniswap V3 (Ethereum).',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      protocol: {
        type: 'string',
        enum: ['uniswapV3'],
        description: 'The LP protocol to use',
      },
      tokenId: {
        type: 'string',
        description: 'The NFT token ID of the LP position',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'protocol', 'tokenId'],
  },
  handler: async (input: LpCollectFeesInput) => {
    const validated = lpCollectFeesSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    const chain = configManager.getConfig().chain;
    if (chain !== 'MAINNET') {
      throw new VaultError('Uniswap V3 LP (Pro adapter) is currently only available on Ethereum. Use factor_get_address_book to check adapter availability on your chain.');
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

      const adapterId = adapterMap[validated.protocol];
      const block: SendTransactionParams = (strategyBuilder.adapter as any)[adapterId].collectFees({
        tokenId: validated.tokenId,
      });

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
          action: 'collectFees',
          protocol: validated.protocol,
          vaultAddress,
          tokenId: validated.tokenId,
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
        action: 'collectFees',
        protocol: validated.protocol,
        vaultAddress,
        tokenId: validated.tokenId,
        transactionHash: result.hash,
        chain,
        note: 'Collect fees transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to collect LP fees', error);
    }
  },
};
