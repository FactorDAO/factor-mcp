import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProFactory, StudioProVaultStats, getContractAddressesForChainOrThrow } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';

export const createVaultSchema = z.object({
  name: z.string().min(1).max(50),
  symbol: z.string().min(1).max(10),
  assetDenominatorAddress: z.string(),
  assetDenominatorAccountingAddress: z.string().optional(),
  initialDepositAmount: z.string().default('1600'), // Minimum 1500 wei required
  // Config params
  upgradeable: z.boolean().default(false),
  upgradeTimelockSeconds: z.number().default(86400), // 1 day
  cooldownTimeSeconds: z.number().default(0),
  maxCap: z.string().default('0'),
  maxDebtRatio: z.string().default('10000'), // 100% in basis points
  // Immutable option - if true, no default adapters are added
  immutable: z.boolean().default(false),
  // Initial assets
  initialAssetAddresses: z.array(z.string()).optional(),
  initialAssetAccountingAddresses: z.array(z.string()).optional(),
  initialDepositAssetAddresses: z.array(z.string()).optional(),
  initialWithdrawAssetAddresses: z.array(z.string()).optional(),
  // Initial debts
  initialDebtAddresses: z.array(z.string()).optional(),
  initialDebtAccountingAddresses: z.array(z.string()).optional(),
  // Initial adapters
  initialManagerAdapters: z.array(z.string()).optional(),
  initialOwnerAdapters: z.array(z.string()).optional(),
  initialWithdrawAdapters: z.array(z.string()).optional(),
  // Fees (in percentage 0-100)
  depositFee: z.number().min(0).max(100).default(0),
  withdrawFee: z.number().min(0).max(100).default(0),
  managementFee: z.number().min(0).max(100).default(0),
  performanceFee: z.number().min(0).max(100).default(0),
  // Wallet
  password: z.string().optional(),
});

export type CreateVaultInput = z.infer<typeof createVaultSchema>;

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

async function getAccountingForAsset(
  chainId: ChainId,
  environment: 'production' | 'staging' | 'testing',
  assetAddress: string
): Promise<string | null> {
  try {
    const proVaultStats = new StudioProVaultStats({
      chainId,
      environment,
    });

    const activeAddresses = await proVaultStats.getFactoryActiveAddresses();
    const normalizedAsset = assetAddress.toLowerCase();

    for (const asset of activeAddresses.assets) {
      if (asset.asset.toLowerCase() === normalizedAsset) {
        return asset.accounting;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const createVaultTool = {
  name: 'factor_create_vault',
  description: 'Deploy a new Factor Studio Pro vault with full configuration options. Fees are in percentage (0-100). Use factor_get_factory_addresses to find valid accounting adapters for assets.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the vault (max 50 characters)',
      },
      symbol: {
        type: 'string',
        description: 'Symbol for the vault token (max 10 characters)',
      },
      assetDenominatorAddress: {
        type: 'string',
        description: 'Address of the denominator token (main deposit token, e.g., USDC)',
      },
      assetDenominatorAccountingAddress: {
        type: 'string',
        description: 'Address of the accounting adapter for the denominator (e.g., chainlink accounting adapter). If not provided, will attempt to auto-detect from factory.',
      },
      initialDepositAmount: {
        type: 'string',
        description: 'Initial deposit amount in base units (wei). Minimum 1500 wei required. Default: 1600',
      },
      upgradeable: {
        type: 'boolean',
        description: 'Whether the vault is upgradeable. Default: false',
      },
      upgradeTimelockSeconds: {
        type: 'number',
        description: 'Upgrade timelock in seconds. Default: 86400 (1 day)',
      },
      cooldownTimeSeconds: {
        type: 'number',
        description: 'Cooldown time between withdrawals in seconds. Default: 0',
      },
      maxCap: {
        type: 'string',
        description: 'Maximum vault cap in base units. Default: 0 (no cap)',
      },
      maxDebtRatio: {
        type: 'string',
        description: 'Maximum debt ratio in basis points. Default: 10000 (100%)',
      },
      immutable: {
        type: 'boolean',
        description: 'If true, creates an immutable vault without default management adapters. Default: false. When false, AdapterManagementAdapter and AssetDebtAdapter are automatically added.',
      },
      initialAssetAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Initial asset addresses the vault can hold',
      },
      initialAssetAccountingAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Accounting adapter addresses for each asset (must match initialAssetAddresses length)',
      },
      initialDepositAssetAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Initial deposit asset addresses',
      },
      initialWithdrawAssetAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Initial withdraw asset addresses',
      },
      initialDebtAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Initial debt token addresses (e.g., aToken addresses)',
      },
      initialDebtAccountingAddresses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Accounting adapter addresses for each debt (must match initialDebtAddresses length)',
      },
      initialManagerAdapters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Initial manager adapter addresses',
      },
      initialOwnerAdapters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Initial owner adapter addresses',
      },
      initialWithdrawAdapters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Initial withdraw adapter addresses',
      },
      depositFee: {
        type: 'number',
        description: 'Deposit fee percentage (0-100). Default: 0',
      },
      withdrawFee: {
        type: 'number',
        description: 'Withdraw fee percentage (0-100). Default: 0',
      },
      managementFee: {
        type: 'number',
        description: 'Annual management fee percentage (0-100). Default: 0',
      },
      performanceFee: {
        type: 'number',
        description: 'Performance fee percentage (0-100). Default: 0',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['name', 'symbol', 'assetDenominatorAddress'],
  },
  handler: async (input: CreateVaultInput) => {
    const validated = createVaultSchema.parse(input);

    if (!isAddress(validated.assetDenominatorAddress)) {
      throw new VaultError('Invalid asset denominator address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const userAddress = getWalletAddress(walletName) as Address;
    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);
    const environment = configManager.getEnvironment();

    try {
      // Auto-detect accounting address if not provided
      let denominatorAccountingAddress = validated.assetDenominatorAccountingAddress;
      if (!denominatorAccountingAddress) {
        const detectedAccounting = await getAccountingForAsset(
          chainId,
          environment,
          validated.assetDenominatorAddress
        );
        if (detectedAccounting) {
          denominatorAccountingAddress = detectedAccounting;
        } else {
          throw new VaultError(
            `Could not auto-detect accounting adapter for ${validated.assetDenominatorAddress}. ` +
            'Please provide assetDenominatorAccountingAddress or use factor_get_factory_addresses to find valid pairs.'
          );
        }
      }

      // Auto-detect accounting for initial assets if not provided
      let assetAccountingAddresses = validated.initialAssetAccountingAddresses;
      const assetAddresses = validated.initialAssetAddresses || [validated.assetDenominatorAddress];

      if (!assetAccountingAddresses || assetAccountingAddresses.length === 0) {
        assetAccountingAddresses = [];
        for (const asset of assetAddresses) {
          const accounting = await getAccountingForAsset(chainId, environment, asset);
          if (accounting) {
            assetAccountingAddresses.push(accounting);
          } else {
            throw new VaultError(
              `Could not auto-detect accounting adapter for asset ${asset}. ` +
              'Please provide initialAssetAccountingAddresses or use factor_get_factory_addresses.'
            );
          }
        }
      }

      const proFactory = new StudioProFactory({
        chainId,
        environment,
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Get default adapters for non-immutable vaults
      let managerAdapters = [...(validated.initialManagerAdapters || [])] as Address[];

      if (!validated.immutable) {
        // Add essential management adapters by default
        const contractAddresses = getContractAddressesForChainOrThrow(chainId, environment);
        const adapterManagementAdapter = contractAddresses.factor_adapter_management_adapter_pro as Address;
        const assetDebtAdapter = contractAddresses.factor_asset_debt_adapter_pro as Address;

        // Add if not already present
        if (adapterManagementAdapter && !managerAdapters.includes(adapterManagementAdapter)) {
          managerAdapters.push(adapterManagementAdapter);
        }
        if (assetDebtAdapter && !managerAdapters.includes(assetDebtAdapter)) {
          managerAdapters.push(assetDebtAdapter);
        }
      }

      // Validate strategy before deployment
      const validationResult = await proFactory.validateStrategy({
        managerAdapters: managerAdapters,
        ownerAdapters: (validated.initialOwnerAdapters || []) as Address[],
        withdrawAdapters: (validated.initialWithdrawAdapters || []) as Address[],
        assetAddresses: assetAddresses as Address[],
        depositAssetAddresses: (validated.initialDepositAssetAddresses || assetAddresses) as Address[],
        withdrawAssetAddresses: (validated.initialWithdrawAssetAddresses || []) as Address[],
        assetAccountingAddresses: assetAccountingAddresses as Address[],
        debtAddresses: (validated.initialDebtAddresses || []) as Address[],
        debtAccountingAddresses: (validated.initialDebtAccountingAddresses || []) as Address[],
      });

      if (!validationResult.isValid) {
        // Build detailed error message
        const invalidItems: string[] = [];

        for (const adapter of validationResult.managerAdapters) {
          if (!adapter.isValid) invalidItems.push(`Manager adapter ${adapter.address} not whitelisted`);
        }
        for (const adapter of validationResult.ownerAdapters) {
          if (!adapter.isValid) invalidItems.push(`Owner adapter ${adapter.address} not whitelisted`);
        }
        for (const adapter of validationResult.withdrawAdapters) {
          if (!adapter.isValid) invalidItems.push(`Withdraw adapter ${adapter.address} not whitelisted`);
        }
        for (const asset of validationResult.assetAddresses) {
          if (!asset.isValid) invalidItems.push(`Asset ${asset.address} not whitelisted`);
        }
        for (const asset of validationResult.assetAccountingAddresses) {
          if (!asset.isValid) invalidItems.push(`Asset accounting ${asset.address} not whitelisted`);
        }
        for (const debt of validationResult.debtAddresses) {
          if (!debt.isValid) invalidItems.push(`Debt ${debt.address} not whitelisted`);
        }

        throw new VaultError(
          `Vault configuration validation failed:\n${invalidItems.join('\n')}\n\n` +
          'Use factor_get_factory_addresses to see valid addresses.'
        );
      }

      // Convert percentages to basis points (1% = 100 basis points)
      const depositFeeBps = Math.round(validated.depositFee * 100).toString();
      const withdrawFeeBps = Math.round(validated.withdrawFee * 100).toString();
      const managementFeeBps = Math.round(validated.managementFee * 100).toString();
      const performanceFeeBps = Math.round(validated.performanceFee * 100).toString();

      // Build the deploy vault transaction using SDK
      const createData = proFactory.deployVault({
        initialDepositBN: validated.initialDepositAmount,
        name: validated.name,
        symbol: validated.symbol,
        configParams: {
          upgradeTimelockBN: validated.upgradeTimelockSeconds.toString(),
          cooldownTimeBN: validated.cooldownTimeSeconds.toString(),
          upgradeable: validated.upgradeable,
          assetDenominatorAddress: validated.assetDenominatorAddress,
          assetDenominatorAccountingAddress: denominatorAccountingAddress,
          initialAssetAddresses: assetAddresses,
          initialDepositAssetAddresses: validated.initialDepositAssetAddresses || assetAddresses,
          initialWithdrawAssetAddresses: validated.initialWithdrawAssetAddresses || [],
          initialDebtAddresses: validated.initialDebtAddresses || [],
          initialAssetAccountingAddresses: assetAccountingAddresses,
          initialDebtAccountingAddresses: validated.initialDebtAccountingAddresses || [],
          initialWithdrawAdapters: validated.initialWithdrawAdapters || [],
          initialManagerAdapters: managerAdapters,
          initialOwnerAdapters: validated.initialOwnerAdapters || [],
          maxCapBN: validated.maxCap,
          maxDebtRatioBN: validated.maxDebtRatio,
          cumulativePriceDeviationAllowanceBpsBN: '10000', // 100% default
        },
        feeParams: {
          depositFeeBN: depositFeeBps,
          withdrawFeeBN: withdrawFeeBps,
          performanceFeeBN: performanceFeeBps,
          managementFeeBN: managementFeeBps,
          feeReceiver: userAddress,
        },
      });

      const txParams: TransactionParams = {
        to: createData.to as Address,
        data: createData.data as `0x${string}`,
      };

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(txParams);

        return {
          success: true,
          simulationMode: true,
          vault: {
            name: validated.name,
            symbol: validated.symbol,
            assetDenominator: validated.assetDenominatorAddress,
            assetDenominatorAccounting: denominatorAccountingAddress,
            owner: userAddress,
            fees: {
              deposit: validated.depositFee,
              withdraw: validated.withdrawFee,
              management: validated.managementFee,
              performance: validated.performanceFee,
            },
          },
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - vault was not deployed. Set SIMULATION_MODE=false to deploy.',
        };
      }

      const result = await sendTransaction(txParams, validated.password);

      return {
        success: true,
        simulationMode: false,
        vault: {
          name: validated.name,
          symbol: validated.symbol,
          assetDenominator: validated.assetDenominatorAddress,
          assetDenominatorAccounting: denominatorAccountingAddress,
          owner: userAddress,
          fees: {
            deposit: validated.depositFee,
            withdraw: validated.withdrawFee,
            management: validated.managementFee,
            performance: validated.performanceFee,
          },
        },
        transactionHash: result.hash,
        chain,
        note: 'Vault creation transaction submitted. Use factor_get_transaction_status to check the result.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to create vault', error);
    }
  },
};
