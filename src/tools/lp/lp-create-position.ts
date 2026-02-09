import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

const protocolEnum = z.enum(['uniswapV3', 'camelotV3', 'aerodrome']);

export const lpCreatePositionSchema = z.object({
  vaultAddress: z.string(),
  protocol: protocolEnum,
  token0: z.string(),
  token1: z.string(),
  amount0: z.string(),
  amount1: z.string(),
  fee: z.number().optional(),
  tickLower: z.number(),
  tickUpper: z.number(),
  password: z.string().optional(),
});

export type LpCreatePositionInput = z.infer<typeof lpCreatePositionSchema>;

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

const adapterMap: Record<string, string> = {
  uniswapV3: 'uniswapV3Lp',
  camelotV3: 'camelotV3Lp',
  aerodrome: 'aerodromeLp',
};

export const lpCreatePositionTool = {
  name: 'factor_lp_create_position',
  description: 'Create a concentrated liquidity position through a Factor vault. Supports Uniswap V3, Camelot V3 (Arbitrum), and Aerodrome (Base).',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      protocol: {
        type: 'string',
        enum: ['uniswapV3', 'camelotV3', 'aerodrome'],
        description: 'The LP protocol to use',
      },
      token0: {
        type: 'string',
        description: 'Address of token0',
      },
      token1: {
        type: 'string',
        description: 'Address of token1',
      },
      amount0: {
        type: 'string',
        description: 'Amount of token0 in base units (wei)',
      },
      amount1: {
        type: 'string',
        description: 'Amount of token1 in base units (wei)',
      },
      fee: {
        type: 'number',
        description: 'Fee tier (e.g., 500, 3000, 10000). Required for Uniswap V3.',
      },
      tickLower: {
        type: 'number',
        description: 'Lower tick boundary for the position',
      },
      tickUpper: {
        type: 'number',
        description: 'Upper tick boundary for the position',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'protocol', 'token0', 'token1', 'amount0', 'amount1', 'tickLower', 'tickUpper'],
  },
  handler: async (input: LpCreatePositionInput) => {
    const validated = lpCreatePositionSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) throw new VaultError('Invalid vault address');
    if (!isAddress(validated.token0)) throw new VaultError('Invalid token0 address');
    if (!isAddress(validated.token1)) throw new VaultError('Invalid token1 address');

    const chain = configManager.getConfig().chain;
    if (validated.protocol === 'camelotV3' && chain !== 'ARBITRUM_ONE') {
      throw new VaultError('Camelot V3 is only available on Arbitrum');
    }
    if (validated.protocol === 'aerodrome' && chain !== 'BASE') {
      throw new VaultError('Aerodrome is only available on Base');
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
      const block: SendTransactionParams = (strategyBuilder.adapter as any)[adapterId].createPosition({
        token0: validated.token0,
        token1: validated.token1,
        amount0BN: validated.amount0,
        amount1BN: validated.amount1,
        fee: validated.fee,
        tickLower: validated.tickLower,
        tickUpper: validated.tickUpper,
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
          action: 'createPosition',
          protocol: validated.protocol,
          vaultAddress,
          token0: validated.token0,
          token1: validated.token1,
          tickLower: validated.tickLower,
          tickUpper: validated.tickUpper,
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
        action: 'createPosition',
        protocol: validated.protocol,
        vaultAddress,
        token0: validated.token0,
        token1: validated.token1,
        tickLower: validated.tickLower,
        tickUpper: validated.tickUpper,
        transactionHash: result.hash,
        chain,
        note: 'Create position transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to create LP position', error);
    }
  },
};
