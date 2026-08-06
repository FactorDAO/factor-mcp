import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault } from '@factordao/sdk-studio';
import { ChainId, type SendTransactionParams } from '@factordao/sdk';

export function getChainIdEnum(chain: string): ChainId {
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

export interface SchemaProperty {
  type: string;
  description: string;
  enum?: string[];
}

interface ManageToolConfig {
  name: string;
  description: string;
  extraParams: Record<string, SchemaProperty>;
  requiredExtra: string[];
  buildTx: (proVault: StudioProVault, input: Record<string, any>) => SendTransactionParams;
}

export function createManageTool(config: ManageToolConfig) {
  const properties: Record<string, SchemaProperty> = {
    vaultAddress: {
      type: 'string',
      description: 'The vault contract address',
    },
    ...config.extraParams,
    password: {
      type: 'string',
      description: 'Wallet password if encrypted',
    },
  };

  const required = ['vaultAddress', ...config.requiredExtra];

  // Build Zod schema dynamically
  const zodShape: Record<string, z.ZodTypeAny> = {
    vaultAddress: z.string(),
    password: z.string().optional(),
  };
  for (const key of Object.keys(config.extraParams)) {
    zodShape[key] = config.requiredExtra.includes(key) ? z.string() : z.string().optional();
  }
  const schema = z.object(zodShape);

  return {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: 'object' as const,
      properties,
      required,
    },
    handler: async (input: Record<string, any>) => {
      const validated = schema.parse(input);

      if (!isAddress(validated.vaultAddress)) {
        throw new VaultError('Invalid vault address');
      }

      // Validate any address params in extraParams
      for (const [key, prop] of Object.entries(config.extraParams)) {
        if (prop.type === 'string' && key.toLowerCase().includes('address') && validated[key]) {
          if (!isAddress(validated[key])) {
            throw new VaultError(`Invalid ${key}: ${validated[key]}`);
          }
        }
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

        const txData = config.buildTx(proVault, validated);

        const txParams: TransactionParams = {
          to: txData.to as Address,
          data: txData.data as `0x${string}`,
        };

        if (configManager.isSimulationMode()) {
          const gasEstimate = await estimateGas(txParams);

          return {
            success: true,
            simulationMode: true,
            vaultAddress,
            transaction: {
              to: txData.to,
              data: txData.data,
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
          vaultAddress,
          transactionHash: result.hash,
          chain,
        };
      } catch (error) {
        if (error instanceof VaultError || error instanceof WalletError) {
          throw error;
        }
        throw new SdkError(`Failed to execute ${config.name}`, error);
      }
    },
  };
}
