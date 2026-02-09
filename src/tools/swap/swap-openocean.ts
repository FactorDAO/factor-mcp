import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

export const swapOpenOceanSchema = z.object({
  vaultAddress: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amount: z.string(),
  openOceanSwapData: z.string(),
  password: z.string().optional(),
});

export type SwapOpenOceanInput = z.infer<typeof swapOpenOceanSchema>;

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

export const swapOpenOceanTool = {
  name: 'factor_swap_openocean',
  description: 'Swap tokens through OpenOcean DEX aggregator via a Factor vault. Requires openOceanSwapData from the OpenOcean API (get a quote first). Use amount "all" to swap entire vault balance.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      tokenIn: {
        type: 'string',
        description: 'Address of the input token',
      },
      tokenOut: {
        type: 'string',
        description: 'Address of the output token',
      },
      amount: {
        type: 'string',
        description: 'Amount in base units (wei), or "all" to swap entire vault balance',
      },
      openOceanSwapData: {
        type: 'string',
        description: 'Swap data from OpenOcean API (hex encoded calldata)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'tokenIn', 'tokenOut', 'amount', 'openOceanSwapData'],
  },
  handler: async (input: SwapOpenOceanInput) => {
    const validated = swapOpenOceanSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }
    if (!isAddress(validated.tokenIn)) {
      throw new VaultError('Invalid tokenIn address');
    }
    if (!isAddress(validated.tokenOut)) {
      throw new VaultError('Invalid tokenOut address');
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

      const swapParams = {
        tokenIn: validated.tokenIn,
        tokenOut: validated.tokenOut,
        openOceanSwapData: validated.openOceanSwapData,
      };

      if (isAll) {
        block = (strategyBuilder.adapter as any).openOcean.swapAll(swapParams);
      } else {
        block = (strategyBuilder.adapter as any).openOcean.swapBN({ ...swapParams, amountBN: validated.amount });
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
          action: 'swap',
          protocol: 'openOcean',
          vaultAddress,
          tokenIn: validated.tokenIn,
          tokenOut: validated.tokenOut,
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
        action: 'swap',
        protocol: 'openOcean',
        vaultAddress,
        tokenIn: validated.tokenIn,
        tokenOut: validated.tokenOut,
        amount: validated.amount,
        transactionHash: result.hash,
        chain,
        note: 'Swap transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute OpenOcean swap', error);
    }
  },
};
