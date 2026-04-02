import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder, getContractAddressesForChainOrThrow } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

const tokenTypeEnum = z.enum(['asset', 'debt']);

export const addVaultTokenSchema = z.object({
  vaultAddress: z.string(),
  tokenAddress: z.string(),
  accountingAddress: z.string().optional(),
  type: tokenTypeEnum,
  password: z.string().optional(),
});

export type AddVaultTokenInput = z.infer<typeof addVaultTokenSchema>;

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

export const addVaultTokenTool = {
  name: 'factor_add_vault_token',
  description:
    'Add an asset or debt token to a Factor Pro vault using the AssetDebtAdapter via executeByManager. Use this to register aTokens (as assets) or debt tokens (as debts) before lending/borrowing. The accounting address must match a whitelisted pair in the factory (use factor_get_factory_addresses to find the correct one).',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      tokenAddress: {
        type: 'string',
        description:
          'The token address to add (e.g., aToken address for assets, variableDebtToken for debts)',
      },
      accountingAddress: {
        type: 'string',
        description:
          'Optional. The accounting adapter address. If omitted, auto-detects using the Chainlink accounting adapter for this chain.',
      },
      type: {
        type: 'string',
        enum: ['asset', 'debt'],
        description: 'Whether to add as an asset or debt',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'tokenAddress', 'type'],
  },
  handler: async (input: AddVaultTokenInput) => {
    const validated = addVaultTokenSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }
    if (!isAddress(validated.tokenAddress)) {
      throw new VaultError('Invalid token address');
    }
    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const vaultAddress = validated.vaultAddress as Address;
    const tokenAddress = validated.tokenAddress as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    // Auto-detect accounting address if not provided — use Chainlink accounting from SDK
    let accountingAddress: Address;
    if (validated.accountingAddress && isAddress(validated.accountingAddress)) {
      accountingAddress = validated.accountingAddress as Address;
    } else {
      try {
        const contracts = getContractAddressesForChainOrThrow(chainId, environment);
        const chainlinkAccounting = (contracts as unknown as Record<string, string>).factor_chainlink_accounting_adapter_pro;
        if (!chainlinkAccounting) {
          throw new VaultError('Could not find Chainlink accounting adapter for this chain. Provide accountingAddress manually.');
        }
        accountingAddress = chainlinkAccounting as Address;
      } catch (err) {
        if (err instanceof VaultError) throw err;
        throw new VaultError('Failed to auto-detect accounting address. Provide accountingAddress manually.');
      }
    }

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

      const block =
        validated.type === 'asset'
          ? strategyBuilder.adapter.assetDebt.addAsset(tokenAddress, accountingAddress)
          : strategyBuilder.adapter.assetDebt.addDebt(tokenAddress, accountingAddress);

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
          action: validated.type === 'asset' ? 'addAsset' : 'addDebt',
          vaultAddress,
          tokenAddress,
          accountingAddress,
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
        action: validated.type === 'asset' ? 'addAsset' : 'addDebt',
        vaultAddress,
        tokenAddress,
        accountingAddress,
        transactionHash: result.hash,
        chain,
        note: `${validated.type === 'asset' ? 'Asset' : 'Debt'} token added. Use factor_get_transaction_status to verify, then factor_get_vault_info to confirm.`,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError(`Failed to add ${validated.type} token to vault`, error);
    }
  },
};
