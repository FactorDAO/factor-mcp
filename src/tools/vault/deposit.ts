import { z } from 'zod';
import { isAddress, type Address, parseAbi } from 'viem';
import { configManager } from '../../config/index.js';
import { getWalletAddress } from '../../wallet/key-manager.js';
import { sendTransaction, estimateGas, getPublicClient, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault } from '@factordao/sdk-studio';
import { ChainId } from '@factordao/sdk';
import { generateDepositScript } from '../../templates/index.js';
import { saveForgeScript } from '../foundry/run-forge-script.js';
import { formatWei, getTokenDecimals } from '../../utils/format.js';

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const depositSchema = z.object({
  vaultAddress: z.string(),
  assetAddress: z.string(),
  amount: z.string(),
  password: z.string().optional(),
});

export type DepositInput = z.infer<typeof depositSchema>;

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

export const depositTool = {
  name: 'factor_deposit',
  description: 'Execute a deposit to a Factor Pro vault. Will automatically approve tokens if needed. Requires a configured wallet with sufficient balance.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultAddress: {
        type: 'string',
        description: 'The vault contract address',
      },
      assetAddress: {
        type: 'string',
        description: 'The address of the token to deposit',
      },
      amount: {
        type: 'string',
        description: 'Amount to deposit in base units (wei)',
      },
      password: {
        type: 'string',
        description: 'Wallet password if the wallet is encrypted',
      },
    },
    required: ['vaultAddress', 'assetAddress', 'amount'],
  },
  handler: async (input: DepositInput) => {
    const validated = depositSchema.parse(input);

    if (!isAddress(validated.vaultAddress)) {
      throw new VaultError('Invalid vault address');
    }

    if (!isAddress(validated.assetAddress)) {
      throw new VaultError('Invalid asset address');
    }

    const walletName = configManager.getWalletName();
    if (!walletName) {
      throw new WalletError('No wallet configured. Use factor_wallet_setup first.');
    }

    const userAddress = getWalletAddress(walletName) as Address;
    const vaultAddress = validated.vaultAddress as Address;
    const assetAddress = validated.assetAddress as Address;

    let amount: bigint;
    try {
      amount = BigInt(validated.amount);
      if (amount <= 0n) {
        throw new VaultError('Amount must be greater than 0');
      }
    } catch {
      throw new VaultError('Invalid amount - must be a non-negative integer string');
    }

    const chain = configManager.getConfig().chain;
    const chainId = getChainIdEnum(chain);

    try {
      const proVault = new StudioProVault({
        chainId,
        vaultAddress,
        environment: configManager.getEnvironment(),
        jsonRpcUrl: configManager.getRpcUrl(),
      });

      // Check if asset is a valid deposit asset
      const isDepositAsset = await proVault.isDepositAsset(assetAddress);
      if (!isDepositAsset) {
        throw new VaultError(`Token ${assetAddress} is not a valid deposit asset for this vault`);
      }

      const publicClient = getPublicClient();

      // Read asset token decimals for formatting
      const assetDecimals = await getTokenDecimals(publicClient, assetAddress);

      // Check user balance
      const balance = await publicClient.readContract({
        address: assetAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      });

      // Build deposit transaction using SDK (before balance/allowance checks so we can include calldata in hints)
      const depositData = proVault.depositAsset({
        assetAddress,
        amountBN: amount.toString(),
        receiverAddress: userAddress,
      });

      const depositParams: TransactionParams = {
        to: depositData.to as Address,
        data: depositData.data as `0x${string}`,
      };

      // Check balance
      if (balance < amount) {
        const forgeScript = generateDepositScript({
          vaultAddress: validated.vaultAddress,
          tokenAddress: validated.assetAddress,
          amount: amount.toString(),
          calldata: depositParams.data as string,
        });
        const scriptRef = saveForgeScript(forgeScript, 'deposit');

        return {
          success: false,
          error: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Have: ${balance.toString()}, Need: ${amount.toString()}. Use factor_run_forge_script with the scriptRef below to simulate the deposit.`,
          currentBalance: balance.toString(),
          currentBalanceFmt: formatWei(balance.toString(), assetDecimals),
          requiredAmount: amount.toString(),
          requiredAmountFmt: formatWei(amount.toString(), assetDecimals),
          simulationHint: {
            tool: 'factor_run_forge_script',
            params: { scriptRef },
          },
          note: 'Call factor_run_forge_script with the scriptRef above to simulate the deposit on a forked network.',
        };
      }

      // Check allowance — if insufficient, tell the LLM to use factor_give_approval first
      const allowance = await publicClient.readContract({
        address: assetAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [userAddress, vaultAddress],
      });

      if (allowance < amount) {
        const forgeScript = generateDepositScript({
          vaultAddress: validated.vaultAddress,
          tokenAddress: validated.assetAddress,
          amount: amount.toString(),
          calldata: depositParams.data as string,
        });
        const scriptRef = saveForgeScript(forgeScript, 'deposit');

        return {
          success: false,
          error: 'INSUFFICIENT_ALLOWANCE',
          message: `Insufficient token allowance. The vault ${vaultAddress} is only approved to spend ${allowance.toString()} but ${amount.toString()} is needed. Call factor_give_approval first to approve the token.`,
          currentAllowance: allowance.toString(),
          currentAllowanceFmt: formatWei(allowance.toString(), assetDecimals),
          requiredAmount: amount.toString(),
          requiredAmountFmt: formatWei(amount.toString(), assetDecimals),
          approvalHint: {
            tool: 'factor_give_approval',
            params: {
              tokenAddress: assetAddress,
              spenderAddress: vaultAddress,
              amount: 'max',
            },
          },
          simulationHint: {
            tool: 'factor_run_forge_script',
            params: { scriptRef },
          },
          note: 'Call factor_give_approval then retry, or call factor_run_forge_script with the scriptRef to simulate the deposit on a forked network.',
        };
      }

      const transactions: Array<{ type: string; hash: string; simulationMode: boolean }> = [];

      if (configManager.isSimulationMode()) {
        const gasEstimate = await estimateGas(depositParams);
        transactions.push({
          type: 'deposit',
          hash: '0x0 (simulation)',
          simulationMode: true,
        });

        return {
          success: true,
          simulationMode: true,
          vault: vaultAddress,
          asset: assetAddress,
          deposit: {
            amount: validated.amount,
            amountFmt: formatWei(validated.amount, assetDecimals),
            from: userAddress,
          },
          transactions,
          gasEstimate: {
            gasLimit: gasEstimate.gasLimit.toString(),
            totalCostEth: gasEstimate.totalCostEth,
          },
          note: 'Simulation mode - transaction was not broadcast. Set SIMULATION_MODE=false to execute.',
        };
      }

      const depositResult = await sendTransaction(depositParams, validated.password);
      transactions.push({
        type: 'deposit',
        hash: depositResult.hash,
        simulationMode: false,
      });

      return {
        success: true,
        simulationMode: false,
        vault: vaultAddress,
        asset: assetAddress,
        deposit: {
          amount: validated.amount,
          amountFmt: formatWei(validated.amount, assetDecimals),
          from: userAddress,
        },
        transactions,
        chain,
      };
    } catch (error) {
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute deposit', error);
    }
  },
};
