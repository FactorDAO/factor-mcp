import { z } from 'zod';
import { isAddress, type Address, formatUnits } from 'viem';
import { configManager } from '../../config/index.js';
import { sendTransaction, estimateGas, getPublicClient, type TransactionParams } from '../../wallet/signer.js';
import { VaultError, WalletError, SdkError } from '../../utils/errors.js';
import { StudioProVault, StrategyBuilder, getContractAddressesForChainOrThrow } from '@factordao/sdk-studio';
import { ChainId, SendTransactionParams } from '@factordao/sdk';
import { getTokenDecimals } from '../../utils/format.js';
import { checkAdapterRegistered, AdapterNotRegisteredError } from '../../utils/adapter-check.js';

export const swapOpenOceanSchema = z.object({
  vaultAddress: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amount: z.string(),
  slippage: z.number().optional(),
  password: z.string().optional(),
});

export type SwapOpenOceanInput = z.infer<typeof swapOpenOceanSchema>;

const CHAIN_TO_OO: Record<string, string> = {
  ARBITRUM_ONE: 'arbitrum',
  BASE: 'base',
  MAINNET: 'eth',
  // OpenOcean uses numeric chainId for Robinhood Chain (v3/4663 and v4/4663).
  ROBINHOOD: '4663',
};

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

async function fetchOpenOceanSwapQuote(params: {
  chain: string;
  inTokenAddress: string;
  outTokenAddress: string;
  amount: string;
  slippage: string;
  account: string;
}): Promise<{ data: string; outAmount: string; inAmount: string }> {
  const ooChain = CHAIN_TO_OO[params.chain] || 'base';
  const url = new URL(`https://open-api.openocean.finance/v3/${ooChain}/swap_quote`);
  url.searchParams.set('inTokenAddress', params.inTokenAddress);
  url.searchParams.set('outTokenAddress', params.outTokenAddress);
  url.searchParams.set('amount', params.amount);
  url.searchParams.set('slippage', params.slippage);
  url.searchParams.set('account', params.account);
  url.searchParams.set('gasPrice', '1');
  url.searchParams.set('disabledDexIds', '2,14,8');
  url.searchParams.set('referrer', '0x95C34a4efFc5eEF480c65E2865C63EE28F2f9C7e');

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OpenOcean API error: ${response.status}`);
  const json = await response.json() as { code: number; data: { data: string; outAmount: string; inAmount: string }; error?: string };
  if (json.code !== 200) throw new Error(`OpenOcean API: ${json.error || 'unknown error'}`);
  return json.data;
}

export const swapOpenOceanTool = {
  name: 'factor_swap_openocean',
  description: 'Swap tokens through OpenOcean DEX aggregator via a Factor vault. Works on all chains including Base. Automatically fetches the best swap route from OpenOcean. Supports "all" to swap entire vault balance, percentage amounts like "50%", or exact amounts in base units (wei).',
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
        description: 'Amount in base units (wei), or "all" to swap entire vault balance, or "50%" for percentage',
      },
      slippage: {
        type: 'number',
        description: 'Slippage tolerance as a percentage (e.g., 1 for 1%). Default: 1',
      },
      password: {
        type: 'string',
        description: 'Wallet password if encrypted',
      },
    },
    required: ['vaultAddress', 'tokenIn', 'tokenOut', 'amount'],
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
    const slippage = validated.slippage || 1;
    const isAll = validated.amount.toLowerCase() === 'all';
    const percentageMatch = validated.amount.match(/^(\d+(?:\.\d+)?)%$/);
    const isPercentage = !!percentageMatch;
    const percentage = isPercentage ? parseFloat(percentageMatch![1]) : 0;

    if (isPercentage && (percentage <= 0 || percentage > 100)) {
      throw new VaultError('Percentage must be between 0 and 100');
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

      const publicClient = getPublicClient();
      const tokenInDecimals = await getTokenDecimals(publicClient, validated.tokenIn as Address);

      // Resolve the actual amount in wei
      let amountWei: bigint;
      if (isAll || isPercentage) {
        const balanceResult = await publicClient.readContract({
          address: validated.tokenIn as Address,
          abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
          functionName: 'balanceOf',
          args: [vaultAddress],
        });
        const balance = balanceResult as bigint;
        amountWei = isAll ? balance : (balance * BigInt(Math.round(percentage * 100))) / 10000n;
      } else {
        amountWei = BigInt(validated.amount);
      }

      if (amountWei === 0n) {
        throw new VaultError('Vault has zero balance of the input token');
      }

      // Format amount for OpenOcean API (human-readable)
      const amountHuman = formatUnits(amountWei, tokenInDecimals);

      // Get the OpenOcean adapter address and verify it's registered in the vault
      const contracts = getContractAddressesForChainOrThrow(chainId, environment);
      const ooAdapterAddress = (contracts as unknown as Record<string, string>).factor_openocean_adapter_pro;
      if (!ooAdapterAddress) {
        throw new VaultError('OpenOcean adapter not found for this chain');
      }

      await checkAdapterRegistered(vaultAddress, ooAdapterAddress as Address, 'OpenOcean');

      // Fetch swap quote from OpenOcean — account must be the vault (delegatecall context)
      const quote = await fetchOpenOceanSwapQuote({
        chain,
        inTokenAddress: validated.tokenIn,
        outTokenAddress: validated.tokenOut,
        amount: amountHuman,
        slippage: slippage.toString(),
        account: vaultAddress,
      });

      // Build the swap block — always use swapBN with the pre-calculated amountWei
      const block: SendTransactionParams = (strategyBuilder.adapter as any).openOcean.swapBN({
        tokenInAddress: validated.tokenIn,
        tokenOutAddress: validated.tokenOut,
        amountInBN: amountWei.toString(),
        openOceanSwapData: quote.data,
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
          action: 'swap',
          protocol: 'openOcean',
          vaultAddress,
          tokenIn: validated.tokenIn,
          tokenOut: validated.tokenOut,
          amount: validated.amount,
          amountWei: amountWei.toString(),
          estimatedOutput: quote.outAmount,
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
        amountWei: amountWei.toString(),
        estimatedOutput: quote.outAmount,
        transactionHash: result.hash,
        chain,
        note: 'Swap transaction submitted. Use factor_get_transaction_status to monitor progress.',
      };
    } catch (error) {
      if (error instanceof AdapterNotRegisteredError) {
        return {
          success: false,
          error: 'ADAPTER_NOT_REGISTERED',
          message: error.message,
          adapterAddress: error.adapterAddress,
          adapterName: error.adapterName,
          fix: `Call factor_add_adapter with vaultAddress "${vaultAddress}" and adapterAddress "${error.adapterAddress}", then sign_and_send. After that, retry this swap.`,
        };
      }
      if (error instanceof VaultError || error instanceof WalletError) {
        throw error;
      }
      throw new SdkError('Failed to execute OpenOcean swap', error);
    }
  },
};
