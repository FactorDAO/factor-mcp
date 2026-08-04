import { z } from 'zod';
import { isAddress, type Address, parseAbi } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, getPublicClient, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProFactory, StudioProVaultStats, getContractAddressesForChainOrThrow } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';
import { generateDeployVaultScript } from '../../templates/index.js';
import { saveForgeScript } from '../foundry/run-forge-script.js';
import { formatWei, getTokenDecimals } from '../../utils/format.js';

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
  maxCap: z.string().default('1000000000000'),
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
  ownerAddress: z.string().optional(),
  feeReceiverAddress: z.string().optional(),
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
    case 'ROBINHOOD':
      return 4663 as ChainId;
    default:
      return ChainId.ARBITRUM_ONE;
  }
}

/**
 * Resolve the final deposit/withdraw asset arrays for a vault deploy. The
 * denominator MUST appear in both lists — vaults whose `withdrawAssets`
 * exclude the denominator ship un-redeemable (Smart Withdraw reverts on
 * `withdrawAsset(asset)` when the asset isn't whitelisted). When the caller
 * omits or passes an empty `withdrawAssetAddresses`, mirror the deposit list.
 * Exported as a pure helper so the resolution can be unit-tested without an
 * RPC endpoint.
 */
export function resolveVaultAssetLists(input: {
  denominatorAddress: string;
  initialAssetAddresses?: string[];
  initialDepositAssetAddresses?: string[];
  initialWithdrawAssetAddresses?: string[];
}): { depositAssets: string[]; withdrawAssets: string[] } {
  const denominator = input.denominatorAddress;
  const denominatorLower = denominator.toLowerCase();
  const depositCandidates =
    input.initialDepositAssetAddresses && input.initialDepositAssetAddresses.length > 0
      ? input.initialDepositAssetAddresses
      : input.initialAssetAddresses && input.initialAssetAddresses.length > 0
        ? input.initialAssetAddresses
        : [denominator];
  const depositAssets = depositCandidates.some((a) => a.toLowerCase() === denominatorLower)
    ? [...depositCandidates]
    : [denominator, ...depositCandidates];
  const withdrawCandidates =
    input.initialWithdrawAssetAddresses && input.initialWithdrawAssetAddresses.length > 0
      ? input.initialWithdrawAssetAddresses
      : depositAssets;
  const withdrawAssets = withdrawCandidates.some((a) => a.toLowerCase() === denominatorLower)
    ? [...withdrawCandidates]
    : [denominator, ...withdrawCandidates];
  return { depositAssets, withdrawAssets };
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
  description: 'Deploy a new Factor Studio Pro vault. IMPORTANT: Always call factor_vault_templates first to get ready-to-use createVaultParams. If the task involves lending, call factor_vault_templates with lendingProtocol set (aave/compoundV3/morpho) — each protocol has its own token design and the template pre-configures the correct adapters and tokens. Fees are in percentage (0-100). Requires token approval via factor_give_approval before deployment.',
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
        description: 'Maximum vault cap in base units. Default: 1000000000000 (1M for 6-decimal tokens like USDC)',
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
      ownerAddress: {
        type: 'string',
        description: 'Owner address for vault (required in stateless mode). This address will own the vault.',
      },
      feeReceiverAddress: {
        type: 'string',
        description: 'Optional address that receives vault fees. Defaults to ownerAddress/local wallet when omitted.',
      },
    },
    required: ['name', 'symbol', 'assetDenominatorAddress'],
  },
  handler: async (input: CreateVaultInput) => {
    const validated = createVaultSchema.parse(input);

    if (!isAddress(validated.assetDenominatorAddress)) {
      throw new VaultError('Invalid asset denominator address');
    }

    // Resolve the address that will own the vault.
    //
    // IMPORTANT — order matters. In stateless mode `configManager.getWalletName()`
    // returns the literal placeholder string `'__stateless__'` (truthy) so logs
    // have something to print. The previous order checked `walletName` FIRST
    // and only fell through to the stateless branch when walletName was falsy
    // — which never happened, so the stateless branch was unreachable and
    // every stateless deploy threw `Stateless mode has no wallet address. Pass
    // ownerAddress explicitly to the calling tool.` from inside getWalletAddress.
    //
    // Check `isStateless()` FIRST and use the caller-supplied `ownerAddress`
    // before touching getWalletAddress at all.
    let userAddress: Address;
    if (configManager.isStateless()) {
      const ownerAddr = validated.ownerAddress;
      if (ownerAddr && isAddress(ownerAddr)) {
        userAddress = ownerAddr as Address;
      } else {
        throw new VaultError('Stateless mode requires ownerAddress parameter (the wallet that will own the vault).');
      }
    } else {
      const walletName = configManager.getWalletName();
      if (walletName) {
        userAddress = getWalletAddress(walletName) as Address;
      } else {
        throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
      }
    }

    let feeReceiverAddress = userAddress;
    if (validated.feeReceiverAddress) {
      if (!isAddress(validated.feeReceiverAddress)) {
        throw new VaultError('Invalid feeReceiverAddress');
      }
      feeReceiverAddress = validated.feeReceiverAddress as Address;
    }

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

      // Resolve final deposit/withdraw asset arrays. The denominator MUST be
      // in BOTH lists — vaults whose withdrawAssets exclude the denominator
      // ship un-redeemable (Smart Withdraw reverts on `withdrawAsset(asset)`
      // when the asset isn't whitelisted). See `resolveVaultAssetLists` above
      // for the exact rules; the helper is unit-tested.
      const { depositAssets: resolvedDepositAssetsRaw, withdrawAssets: resolvedWithdrawAssetsRaw } = resolveVaultAssetLists({
        denominatorAddress: validated.assetDenominatorAddress,
        initialAssetAddresses: assetAddresses,
        initialDepositAssetAddresses: validated.initialDepositAssetAddresses,
        initialWithdrawAssetAddresses: validated.initialWithdrawAssetAddresses,
      });
      const resolvedDepositAssets = resolvedDepositAssetsRaw as Address[];
      const resolvedWithdrawAssets = resolvedWithdrawAssetsRaw as Address[];
      if (resolvedWithdrawAssets.length === 0) {
        throw new VaultError(
          'withdrawAssetAddresses cannot be empty after resolution. ' +
          'Pass initialWithdrawAssetAddresses explicitly or rely on auto-mirror from initialDepositAssetAddresses.'
        );
      }

      // Validate strategy before deployment
      const validationResult = await proFactory.validateStrategy({
        managerAdapters: managerAdapters,
        ownerAdapters: (validated.initialOwnerAdapters || []) as Address[],
        withdrawAdapters: (validated.initialWithdrawAdapters || []) as Address[],
        assetAddresses: assetAddresses as Address[],
        depositAssetAddresses: resolvedDepositAssets,
        withdrawAssetAddresses: resolvedWithdrawAssets,
        assetAccountingAddresses: assetAccountingAddresses as Address[],
        debtAddresses: (validated.initialDebtAddresses || []) as Address[],
        debtAccountingAddresses: (validated.initialDebtAccountingAddresses || []) as Address[],
      });

      // ── Withdraw-adapter validation fallback for factories with no
      // standalone withdrawAdapters mapping (e.g. StudioProV1Factory.sol,
      // deployed on newer chains like Robinhood Chain) ────────────────────
      // validateStrategy() probes `withdrawAdapters(address)` on the factory
      // whenever the subgraph has no withdraw-adapter data. On a
      // V1-shaped factory that function doesn't exist at all — the probe
      // reverts, and the SDK's try/catch treats a revert identically to a
      // clean `false`, so every withdraw adapter is misreported as "not
      // whitelisted" even when it's genuinely fine. StudioProV1Factory's own
      // on-chain deployVault() constructor validates initialWithdrawAdapters
      // against `managerAdapters`, not a separate mapping (confirmed against
      // the real Solidity source — StudioProV1Factory.sol has no
      // `withdrawAdapters` state at all), so that's the correct fallback —
      // but only once we've independently proven the probe reverts rather
      // than returning a real boolean, so a genuine V3/V4-factory rejection
      // (a real, separate withdraw-adapter whitelist gap) still fails.
      const failedWithdrawAdapters = validationResult.withdrawAdapters.filter(
        (a: { address: string; isValid: boolean }) => !a.isValid
      );
      if (failedWithdrawAdapters.length > 0) {
        const client = getPublicClient();
        // proFactory.factoryAddress is private in the SDK's type declarations
        // (even though it's a plain runtime property) — re-resolve the same
        // address the SDK itself used, via the same address-book lookup.
        const { factor_studio_pro_factory: factoryAddress } = getContractAddressesForChainOrThrow(chainId, environment);
        const withdrawAdaptersAbi = parseAbi(['function withdrawAdapters(address) view returns (bool)']);
        const managerAdaptersAbi = parseAbi(['function managerAdapters(address) view returns (bool)']);
        for (const entry of failedWithdrawAdapters) {
          let withdrawAdapterFnExists = true;
          try {
            await client.readContract({
              address: factoryAddress as Address,
              abi: withdrawAdaptersAbi,
              functionName: 'withdrawAdapters',
              args: [entry.address as Address],
            });
          } catch {
            withdrawAdapterFnExists = false;
          }
          if (!withdrawAdapterFnExists) {
            const isManagerAdapter = await client.readContract({
              address: factoryAddress as Address,
              abi: managerAdaptersAbi,
              functionName: 'managerAdapters',
              args: [entry.address as Address],
            });
            if (isManagerAdapter) {
              entry.isValid = true;
            }
          }
        }
        validationResult.isValid =
          validationResult.managerAdapters.every((a: { isValid: boolean }) => a.isValid) &&
          validationResult.ownerAdapters.every((a: { isValid: boolean }) => a.isValid) &&
          validationResult.withdrawAdapters.every((a: { isValid: boolean }) => a.isValid) &&
          validationResult.assetAddresses.every((a: { isValid: boolean }) => a.isValid) &&
          validationResult.assetAccountingAddresses.every((a: { isValid: boolean }) => a.isValid) &&
          validationResult.debtAddresses.every((a: { isValid: boolean }) => a.isValid);
      }

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

      // Build the deploy vault transaction using SDK (before checking allowance so we can include tx data in errors)
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
          initialDepositAssetAddresses: resolvedDepositAssets,
          initialWithdrawAssetAddresses: resolvedWithdrawAssets,
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
          feeReceiver: feeReceiverAddress,
        },
      });

      const txParams: TransactionParams = {
        to: createData.to as Address,
        data: createData.data as `0x${string}`,
      };

      // Check allowance for initial deposit (skip in stateless mode — sponsorship handles approval)
      const initialDeposit = BigInt(validated.initialDepositAmount);
      if (initialDeposit > 0n && !configManager.isStateless()) {
        const ERC20_ALLOWANCE_ABI = parseAbi([
          'function allowance(address owner, address spender) view returns (uint256)',
        ]);

        const publicClient = getPublicClient();
        const denominatorDecimals = await getTokenDecimals(publicClient, validated.assetDenominatorAddress as Address);
        const allContractAddresses = getContractAddressesForChainOrThrow(chainId, environment);
        const factoryAddr = (allContractAddresses as any).factor_studio_pro_factory as string | undefined;
        if (factoryAddr) {
          const allowance = await publicClient.readContract({
            address: validated.assetDenominatorAddress as Address,
            abi: ERC20_ALLOWANCE_ABI,
            functionName: 'allowance',
            args: [userAddress, factoryAddr as Address],
          });

          if (allowance < initialDeposit) {
            const forgeScript = generateDeployVaultScript({
              factoryAddress: factoryAddr,
              tokenAddress: validated.assetDenominatorAddress,
              depositAmount: initialDeposit.toString(),
              calldata: txParams.data as string,
              vaultName: validated.name,
            });

            // Save script to disk so the LLM only needs to pass a short reference
            const scriptRef = saveForgeScript(forgeScript, 'vault_deploy');

            return {
              success: false,
              error: 'INSUFFICIENT_ALLOWANCE',
              message: `Insufficient token allowance for vault deployment. The factory needs at least ${initialDeposit.toString()} wei of the denominator token (${validated.assetDenominatorAddress}) approved. Current allowance: ${allowance.toString()}. Call factor_give_approval first, or use factor_run_forge_script with the simulationHint below to simulate the full deployment on a forked network.`,
              currentAllowance: allowance.toString(),
              currentAllowanceFmt: formatWei(allowance.toString(), denominatorDecimals),
              requiredAmount: initialDeposit.toString(),
              requiredAmountFmt: formatWei(initialDeposit.toString(), denominatorDecimals),
              approvalHint: {
                tool: 'factor_give_approval',
                params: {
                  tokenAddress: validated.assetDenominatorAddress,
                  spenderAddress: factoryAddr,
                  amount: 'max',
                },
              },
              simulationHint: {
                tool: 'factor_run_forge_script',
                params: {
                  scriptRef,
                },
              },
              note: 'Call factor_run_forge_script with the scriptRef above to simulate the full deployment on a forked network. The script handles ETH funding, token approval, and vault creation.',
            };
          }
        }
      }

      // Stateless mode: return calldata without gas estimation or signing
      if (configManager.isStateless()) {
        return {
          success: true,
          statelessMode: true,
          calldata: {
            to: txParams.to,
            data: txParams.data,
            value: (txParams.value ?? 0n).toString(),
            chainId: configManager.getChainId(),
          },
          vault: {
            name: validated.name,
            symbol: validated.symbol,
            assetDenominator: validated.assetDenominatorAddress,
            assetDenominatorAccounting: denominatorAccountingAddress,
            owner: userAddress,
            feeReceiver: feeReceiverAddress,
            fees: {
              deposit: validated.depositFee,
              withdraw: validated.withdrawFee,
              management: validated.managementFee,
              performance: validated.performanceFee,
            },
          },
          note: 'Stateless mode - calldata returned for external signing. Use sign_and_send to broadcast.',
        };
      }

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
            feeReceiver: feeReceiverAddress,
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

      // Wait for receipt and decode vault address from logs
      let vaultAddress: string | null = null;
      try {
        const publicClient = getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: result.hash as `0x${string}`,
          timeout: 60_000,
        });

        if (receipt.status === 'success') {
          // Find the vault address from Transfer(address(0), ...) log (share minting)
          for (const log of receipt.logs) {
            if (
              log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
              log.topics[1] === '0x0000000000000000000000000000000000000000000000000000000000000000'
            ) {
              vaultAddress = log.address;
              break;
            }
          }
        }
      } catch {
        // Receipt wait failed — return hash without address
      }

      return {
        success: true,
        simulationMode: false,
        vault: {
          name: validated.name,
          symbol: validated.symbol,
          assetDenominator: validated.assetDenominatorAddress,
          assetDenominatorAccounting: denominatorAccountingAddress,
          owner: userAddress,
          feeReceiver: feeReceiverAddress,
          fees: {
            deposit: validated.depositFee,
            withdraw: validated.withdrawFee,
            management: validated.managementFee,
            performance: validated.performanceFee,
          },
        },
        transactionHash: result.hash,
        vaultAddress: vaultAddress || 'pending — use factor_get_transaction_status to check',
        chain,
        note: vaultAddress
          ? `Vault deployed at ${vaultAddress}. Use this address for all subsequent operations.`
          : 'Vault creation transaction submitted. Use factor_get_transaction_status to check the result.',
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to create vault', error);
    }
  },
};
