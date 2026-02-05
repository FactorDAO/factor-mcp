import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';

export const addAdapterSchema = z.object({
  vaultAddress: z.string(),
  adapterAddress: z.string(),
  password: z.string().optional(),
});

export type AddAdapterInput = z.infer<typeof addAdapterSchema>;

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

export const addAdapterTool = {
  name: 'factor_add_adapter',
  description: 'Add a manager adapter to a Factor Pro vault. This allows the vault to interact with specific DeFi protocols (e.g., Uniswap, Aave, Pendle). Use factor_get_factory_addresses to see available adapters.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      adapterAddress: {
        type: 'string',
        description: 'The adapter contract address to add (e.g., UniswapAdapter, AaveAdapter)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'adapterAddress'],
  },
  handler: async (input: AddAdapterInput) => {
    const validated = addAdapterSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    if (!isAddress(validated.adapterAddress)) {
      throw new VaultError('Invalid adapter address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const adapterAddress = validated.adapterAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    try {
      // Initialize SDK classes
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

      // Build the addAdapter call using the AdapterManagementAdapter
      const addAdapterData = strategyBuilder.adapter.adapterManagement.addAdapter(adapterAddress);

      // Wrap with executeByManager
      const executeData = proVault.executeByManager([addAdapterData]);

      const txParams: TransactionParams = {
        to: executeData.to as Address,
        data: executeData.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams);

        return {
          success: true,
          simulationMode: true,
          vaultAddress,
          adapterAddress,
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
        vaultAddress,
        adapterAddress,
        transactionHash: result.hash,
        chain,
        note: 'Adapter added. Use factor_get_transaction_status to verify, then factor_get_vault_info to see updated adapters.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to add adapter to vault', error);
    }
  },
};
